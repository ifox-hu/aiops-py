// Live UI regression; model success is covered with a test double in test_platform.py.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const base = process.env.ONCALL_URL || 'http://127.0.0.1:9900';
const output = path.join(__dirname, 'previews');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const browser = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', [
    '--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=9928',
    '--user-data-dir=' + path.join(__dirname, '.edge-qa-profile'), 'about:blank'
  ], { windowsHide: true, stdio: 'ignore' });
  let socket;
  try {
    let tabs;
    for (let i = 0; i < 60; i++) {
      try { tabs = await (await fetch('http://127.0.0.1:9928/json/list')).json(); } catch {}
      if (tabs?.some(tab => tab.type === 'page')) break;
      await pause(200);
    }
    assert(tabs?.some(tab => tab.type === 'page'), 'Edge did not start');
    socket = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    let id = 0;
    const pending = new Map();
    const errors = [];
    socket.onmessage = event => {
      const message = JSON.parse(event.data);
      const task = pending.get(message.id);
      if (task) {
        clearTimeout(task.timer);
        pending.delete(message.id);
        message.error ? task.reject(new Error(message.error.message)) : task.resolve(message.result);
      }
      if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
    };
    function command(method, params = {}) {
      return new Promise((resolve, reject) => {
        const requestId = ++id;
        const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('CDP timeout: ' + method)); }, 15000);
        pending.set(requestId, { resolve, reject, timer });
        socket.send(JSON.stringify({ id: requestId, method, params }));
      });
    }
    async function evaluate(expression) {
      const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    }
    async function until(expression) {
      for (let i = 0; i < 60; i++) {
        if (await evaluate(expression)) return;
        await pause(150);
      }
      throw new Error('UI condition not reached: ' + expression);
    }
    async function layout(name, width, height) {
      await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 700 });
      await pause(200);
      const overflow = await evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth');
      assert(overflow <= 2, `${name} at ${width}: horizontal overflow ${overflow}`);
      const clipped = await evaluate(`Array.from(document.querySelectorAll('button,h1,h2,h3')).filter(el => {
        const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && el.scrollWidth > el.clientWidth + 2 && s.overflowX !== 'visible';
      }).map(el => el.textContent.trim())`);
      assert.deepEqual(clipped, [], 'Clipped controls: ' + clipped.join(', '));
      const screenshot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      fs.writeFileSync(path.join(output, `${name}-${width}.png`), Buffer.from(screenshot.data, 'base64'));
    }
    await command('Runtime.enable');
    await command('Page.enable');
    await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1080, deviceScaleFactor: 1, mobile: false });
    await command('Page.navigate', { url: base + '/designs/workbench-v2.html' });
    await until("document.querySelectorAll('#v2-alert-list .v2-alert-row').length === 3");
    await evaluate("document.querySelector('#v2-diagnose').click()");
    await until("document.querySelector('#v2-diagnose').disabled === false && document.querySelector('#v2-report').textContent.includes('DASHSCOPE_API_KEY')");
    await layout('workbench', 1440, 1080);
    await layout('workbench', 390, 844);
    await evaluate("document.querySelectorAll('#v2-alert-list .v2-alert-row')[1].click()");
    const chosen = await evaluate("document.querySelector('#v2-focus-title').textContent");
    await evaluate("document.querySelector('#v2-detail').click()");
    await until("location.pathname.endsWith('incident-v2.html') && document.querySelector('#iv-title')?.textContent === " + JSON.stringify(chosen));
    assert.equal(await evaluate("document.querySelector('#iv-title').textContent"), chosen);
    await evaluate("document.querySelector('[data-iv-tab=evidence]').click()");
    await until("document.querySelectorAll('#iv-log .iv-log-line').length > 0");
    await evaluate("document.querySelector('[data-iv-tab=handover]').click(); document.querySelector('#iv-add-note').click(); document.querySelector('#iv-note-form textarea').value='QA evidence checked'; document.querySelector('#iv-note-form').requestSubmit()");
    await until("document.querySelector('#iv-check-note').classList.contains('done')");
    await evaluate("document.querySelector('#iv-handover-note').value='QA handover'; document.querySelector('#iv-save-handover').click()");
    await until("document.querySelector('#iv-check-handover').classList.contains('done')");
    await layout('incident', 1440, 1080);
    await layout('incident', 390, 844);
    await command('Page.navigate', { url: base + '/designs/knowledge-v2.html' });
    await until("document.readyState === 'complete' && !!document.querySelector('#kv-form textarea') && document.querySelector('#kv-doc-status').textContent !== ''");
    await evaluate("document.querySelector('#kv-form textarea').value='CPU alert'; document.querySelector('#kv-form').requestSubmit()");
    await until("Array.from(document.querySelectorAll('.kv-answer-text')).some(el => el.textContent.includes('DASHSCOPE_API_KEY'))");
    await layout('knowledge', 1440, 1080);
    await layout('knowledge', 390, 844);
    assert.deepEqual(errors, [], 'Browser runtime exceptions');
    console.log('PASS: alert selection, missing-key error, incident navigation, logs, notes, handover, knowledge error');
    console.log('PASS: six desktop/mobile screenshots in ' + output);
  } finally {
    socket?.close();
    browser.kill();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });

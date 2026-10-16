// Real-browser regression of the standalone demo under a GitHub project subpath.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '../docs');
const prefix = '/aiops-py/';
const screenshots = process.argv.includes('--screenshots');
const output = path.join(root, 'assets/previews');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png' };

async function main() {
  const edge = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  assert(fs.existsSync(edge), 'Set EDGE_PATH to your Microsoft Edge executable.');
  const requests = [];
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    requests.push(pathname);
    if (!pathname.startsWith(prefix)) return response.writeHead(404).end();
    const relative = decodeURIComponent(pathname.slice(prefix.length)) || 'index.html';
    const filename = path.resolve(root, relative);
    if (!filename.startsWith(root + path.sep) || !types[path.extname(filename)]) return response.writeHead(404).end();
    fs.readFile(filename, (error, data) => {
      if (error) return response.writeHead(404).end();
      response.writeHead(200, { 'Content-Type': types[path.extname(filename)] + '; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(data);
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = 'http://127.0.0.1:' + server.address().port + prefix;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'aiops-py-pages-'));
  const browser = spawn(edge, [
    '--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'
  ], { windowsHide: true, stdio: 'ignore' });
  let socket;
  let browserError;
  browser.on('error', error => { browserError = error; });
  async function wait(check, label) {
    for (let i = 0; i < 100; i++) {
      if (browserError) throw browserError;
      if (await check()) return;
      await pause(100);
    }
    throw new Error('Timed out: ' + label);
  }
  try {
    const portFile = path.join(profile, 'DevToolsActivePort');
    await wait(() => fs.existsSync(portFile), 'Edge DevTools');
    const port = fs.readFileSync(portFile, 'utf8').split(/\r?\n/)[0];
    const tabs = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
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
        const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('CDP timeout: ' + method)); }, 12000);
        pending.set(requestId, { resolve, reject, timer });
        socket.send(JSON.stringify({ id: requestId, method, params }));
      });
    }
    async function evaluate(expression) {
      const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    }
    const until = expression => wait(() => evaluate(expression), expression);
    async function navigate(page) {
      await command('Page.navigate', { url: base + page });
      await until('location.pathname === ' + JSON.stringify(prefix + page) + ' && document.readyState === "complete"');
    }
    async function enter(selector, value) {
      await evaluate('document.querySelector(' + JSON.stringify(selector) + ').focus();document.querySelector(' +
        JSON.stringify(selector) + ').value=' + JSON.stringify(value));
      await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
      await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    }
    async function layout(name) {
      await evaluate('document.activeElement?.blur();document.querySelectorAll(".v2-toast").forEach(el => el.remove())');
      for (const [width, height] of [[1440, 1080], [390, 844]]) {
        await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 700 });
        await pause(180);
        assert(await evaluate('document.documentElement.scrollWidth <= innerWidth + 2'), name + ': horizontal overflow at ' + width);
        if (screenshots && name !== 'index') {
          fs.mkdirSync(output, { recursive: true });
          const shot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
          fs.writeFileSync(path.join(output, name + '-' + width + '.png'), Buffer.from(shot.data, 'base64'));
        }
      }
      await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1080, deviceScaleFactor: 1, mobile: false });
    }
    await command('Runtime.enable');
    await command('Page.enable');
    await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1080, deviceScaleFactor: 1, mobile: false });
    await navigate('index.html');
    assert.equal(await evaluate('document.querySelectorAll(".gallery-card").length'), 3);
    await layout('index');

    await navigate('workbench-v2.html');
    await until('document.querySelectorAll("#v2-alert-list .v2-alert-row").length === 3');
    assert.equal(await evaluate('document.querySelector("#v2-source").textContent'), '模拟数据');
    assert.notEqual(await evaluate('document.querySelector("#v2-fact-instance").textContent'), '未返回实例');
    await evaluate('document.querySelector("#v2-diagnose").click()');
    await until('!document.querySelector("#v2-diagnose").disabled && document.querySelector("#v2-report").textContent.includes("建议排查顺序")');
    const report = await evaluate('document.querySelector("#v2-report").textContent');
    const chosen = await evaluate('document.querySelector("#v2-focus-title").textContent');
    await until('document.querySelectorAll("[data-history-alert]").length === 1');
    await evaluate('document.querySelectorAll("#v2-alert-list .v2-alert-row")[1].click();document.querySelectorAll("#v2-alert-list .v2-alert-row")[0].click()');
    assert.equal(await evaluate('document.querySelector("#v2-report").textContent'), report);
    await command('Page.reload', { ignoreCache: true });
    await until('document.querySelector("#v2-report")?.textContent.includes("建议排查顺序")');
    await evaluate('document.querySelector("[data-tab=logs]").click()');
    await until('document.querySelectorAll("#v2-log .v2-log-line").length > 0');
    await evaluate('document.querySelector("[data-tab=diagnosis]").click()');
    await enter('#v2-form textarea', '这个告警先检查什么？');
    await until('!document.querySelector("#v2-send").disabled && document.querySelector("#v2-chat").textContent.includes("静态演示")');
    assert.equal(await evaluate('document.querySelector("#v2-form textarea").value'), '');
    await layout('workbench');

    await evaluate('document.querySelector("#v2-detail").click()');
    await until('location.pathname.endsWith("incident-v2.html") && document.querySelector("#iv-title")?.textContent === ' + JSON.stringify(chosen));
    assert.equal(await evaluate('document.querySelector("#iv-report").textContent'), report);
    await evaluate('document.querySelector("[data-iv-tab=evidence]").click()');
    await until('document.querySelectorAll("#iv-log .iv-log-line").length > 0');
    await evaluate('document.querySelector("[data-iv-tab=handover]").click();document.querySelector("#iv-add-note").click()');
    await enter('#iv-note-form textarea', '已核对时间窗口和日志，继续观察热点线程。');
    await until('document.querySelector("#iv-check-note").classList.contains("done")');
    await evaluate('document.querySelector("#iv-handover-note").value="下一班继续核对最近发布与 CPU 曲线。";document.querySelector("#iv-save-handover").click()');
    await until('document.querySelector("#iv-check-handover").classList.contains("done")');
    await evaluate('window.__originalBlobURL=URL.createObjectURL;URL.createObjectURL=blob=>{window.__exportBlob=blob;return window.__originalBlobURL(blob)};document.addEventListener("click",event=>{if(event.target.closest("a[download]"))event.preventDefault()});document.querySelector("#iv-export").click()');
    assert(await evaluate('window.__exportBlob.text().then(text=>text.includes("下一班") && text.includes("建议排查顺序"))'));
    await layout('incident');
    await navigate('workbench-v2.html');
    await until('document.querySelectorAll("[data-history-delete]").length === 1');
    await evaluate('document.querySelector("[data-history-delete]").click()');
    assert.equal(await evaluate('document.querySelectorAll("[data-history-alert]").length'), 0);
    assert(await evaluate('Object.values(JSON.parse(localStorage.getItem(' + JSON.stringify('v2-incident-' + chosen) + '))).some(v => JSON.stringify(v).includes("下一班"))'));

    await navigate('knowledge-v2.html');
    await until('document.querySelectorAll("#kv-doc-list .kv-doc").length === 5');
    assert(await evaluate('document.querySelector("#kv-upload").disabled'));
    assert.equal(await evaluate('fetch("/api/upload",{method:"POST"}).then(r=>r.status)'), 409);
    await evaluate('document.querySelector("[data-kv-mode=general]").click()');
    await enter('#kv-form textarea', '什么是 TCP 三次握手？');
    await until('!document.querySelector("#kv-send").disabled && document.querySelector(".kv-answer-text")?.textContent.includes("SYN-ACK")');
    assert.equal(await evaluate('document.querySelectorAll("#kv-sources .kv-source").length'), 0);
    await evaluate('document.querySelector("[data-kv-mode=knowledge]").click()');
    await enter('#kv-form textarea', '内存使用率过高应该检查什么？');
    await until('!document.querySelector("#kv-send").disabled && document.querySelectorAll("#kv-sources .kv-source").length === 1');
    assert(await evaluate('document.querySelector("#kv-sources").textContent.includes("memory_high_usage")'));
    assert(await evaluate('document.querySelectorAll(".kv-answer-head")[1].textContent.includes("召回 1 个片段")'));
    await evaluate('document.querySelector("#kv-form textarea").focus();document.querySelector("#kv-form textarea").value="多行输入"');
    await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', modifiers: 8, windowsVirtualKeyCode: 13 });
    await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', modifiers: 8, windowsVirtualKeyCode: 13 });
    assert(await evaluate('document.querySelector("#kv-form textarea").value.startsWith("多行输入")'));
    await evaluate('document.querySelector("#kv-form textarea").value=""');
    await layout('knowledge');
    await command('Page.reload', { ignoreCache: true });
    await until('document.querySelectorAll(".kv-answer-text").length === 2');
    assert.deepEqual(errors, [], 'Browser runtime errors');
    assert.deepEqual(requests.filter(url => url.includes('/api/')), [], 'Demo leaked API traffic to server');
    assert.equal(await evaluate('fetch("/api/not-implemented").then(r=>r.status)'), 404);
    console.log('PASS: project-subpath navigation, mock alerts/logs/streams, Enter send, history restore/delete, handover, knowledge modes, disabled upload, desktop/mobile layouts; no backend API requests.');
    if (screenshots) console.log('Screenshots: ' + output);
    await command('Browser.close');
  } finally {
    socket?.close();
    browser.kill();
    await new Promise(resolve => server.close(resolve));
    // Temporary profile belongs to this run. Leave it for OS temp cleanup.
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

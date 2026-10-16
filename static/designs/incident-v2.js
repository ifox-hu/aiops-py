'use strict';

const state = {
  alerts: [],
  documents: [],
  selected: null,
  report: '',
  logs: [],
  notes: [],
  handover: '',
  mock: true,
  busy: false
};

const $ = selector => document.querySelector(selector);
const $$ = selector => Array.from(document.querySelectorAll(selector));
const escapeHtml = value => String(value == null ? '' : value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const severityRules = { SlowResponse: 'P1', HighMemoryUsage: 'P1', HighCPUUsage: 'P2', HighDiskUsage: 'P1', ServiceUnavailable: 'P1' };

function severity(alert) {
  return severityRules[alert?.alert_name] || 'P3';
}

function durationSeconds(alert) {
  const match = String(alert?.duration || '').match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/);
  if (match) return Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0);
  return Math.max(0, (Date.now() - new Date(alert?.active_at).getTime()) / 1000);
}

function durationText(alert) {
  const total = Math.round(durationSeconds(alert));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours) return hours + 'h ' + minutes + 'm';
  if (minutes) return minutes + 'm ' + seconds + 's';
  return seconds + 's';
}

function timeText(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function parseAlert(alert) {
  const description = alert?.description || '';
  const serviceMatch = description.match(/服务\s+([^\s的]+)/);
  const instanceMatch = description.match(/实例[:：]\s*([^，,\s]+)/);
  const namespaceMatch = description.match(/命名空间[:：]\s*([^，,\s]+)/);
  const valueMatch = description.match(/(?:当前值|当前值为)[:：]?\s*([0-9.]+\s*(?:%|秒|s|GB|MB)?)/);
  const causeMatch = description.match(/可能原因[:：]\s*(.+)$/);
  return {
    service: serviceMatch ? serviceMatch[1] : '待确认',
    instance: instanceMatch ? instanceMatch[1] : '未返回实例',
    namespace: namespaceMatch ? namespaceMatch[1] : '未返回命名空间',
    value: valueMatch ? valueMatch[1] : '未返回当前值',
    cause: causeMatch ? causeMatch[1].trim() : '告警描述未给出候选原因，需要由日志和知识库进一步验证。'
  };
}

function knowledgeFor(alert) {
  const name = alert?.alert_name;
  if (name === 'HighCPUUsage') return 'cpu_high_usage.md';
  if (name === 'HighMemoryUsage') return 'memory_high_usage.md';
  if (name === 'HighDiskUsage') return 'disk_high_usage.md';
  if (name === 'ServiceUnavailable') return 'service_unavailable.md';
  return 'slow_response.md';
}

function toast(message) {
  document.querySelector('.v2-toast')?.remove();
  const node = document.createElement('div');
  node.className = 'v2-toast';
  node.setAttribute('role', 'status');
  node.textContent = message;
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 2600);
}

async function api(url, options = {}) {
  const response = await fetch(url, { ...options, signal: options.signal || AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error('请求失败（' + response.status + '）');
  return response.json();
}

async function stream(url, body, onEvent, timeoutMs = 180000) {
  const controller = new AbortController();
  let timer;
  const reset = () => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(), timeoutMs);
  };
  reset();
  let reader;
  try {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
    if (!response.ok) throw new Error('请求失败（' + response.status + '）');
    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let complete = false;
    while (!complete) {
      const { done, value } = await reader.read();
      if (done) break;
      reset();
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const event = JSON.parse(line.slice(5).trim());
        if (event.type === 'error') throw new Error(event.data || '服务处理失败');
        onEvent(event);
        if (event.type === 'done') complete = true;
      }
    }
    if (!complete) throw new Error('响应中断，请重试');
  } catch (error) {
    throw new Error(controller.signal.aborted ? '服务响应超时，请稍后重试' : error.message);
  } finally {
    clearTimeout(timer);
    if (reader) {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    controller.abort();
  }
}

function currentKey() {
  return 'v2-incident-' + (state.selected?.alert_name || 'unknown');
}

function loadLocalState() {
  if (!state.selected) return;
  try {
    const saved = JSON.parse(localStorage.getItem(currentKey()) || '{}');
    state.report = saved.report || '';
    state.notes = Array.isArray(saved.notes) ? saved.notes : [];
    state.handover = saved.handover || '';
  } catch {
    state.report = '';
    state.notes = [];
    state.handover = '';
  }
}

function saveLocalState() {
  if (!state.selected) return;
  try {
    localStorage.setItem(currentKey(), JSON.stringify({ report: state.report, notes: state.notes, handover: state.handover }));
  } catch {}
}

function renderReport() {
  const report = $('#iv-report');
  if (report) report.textContent = state.report || '开始诊断后，报告会显示在这里。';
  $('#iv-diagnosis-prompt').hidden = Boolean(state.report);
}

function renderEvidence(parsed) {
  $('#iv-observed').textContent = state.selected?.description || '后端未返回描述。';
  $('#iv-candidate').textContent = parsed.cause;
}

function renderSources() {
  const list = $('#iv-sources');
  if (!list || !state.selected) return;
  const primary = knowledgeFor(state.selected);
  const docs = state.documents;
  list.innerHTML = docs.map(doc => {
    const matched = doc.name === primary;
    return '<div class="iv-source"><span><strong>' + escapeHtml(doc.name) + (matched ? ' · 当前匹配' : '') + '</strong><small>' + (doc.size ? Math.ceil(doc.size / 1024) + ' KB · ' : '') + escapeHtml(timeText(doc.updatedAt)) + '</small></span><span>' + (matched ? 'MATCH' : 'DOC') + '</span></div>';
  }).join('') || '<div class="iv-empty">知识库暂无文档</div>';
}

function renderLogs() {
  const container = $('#iv-log');
  if (!container) return;
  container.innerHTML = state.logs.length
    ? state.logs.map(log => '<div class="iv-log-line"><time>' + escapeHtml(log.timestamp) + '</time><span class="level ' + escapeHtml(log.level) + '">' + escapeHtml(log.level) + '</span><span>' + escapeHtml(log.service) + ' · ' + escapeHtml(log.instance) + ' · ' + escapeHtml(log.message) + '</span></div>').join('')
    : '<div class="iv-empty">未查询到日志</div>';
}

function renderNotes() {
  const timeline = $('#iv-timeline');
  if (timeline) timeline.innerHTML = state.notes.length
    ? state.notes.map(note => '<div class="iv-timeline-item"><time>' + escapeHtml(note.time) + '</time><p>' + escapeHtml(note.text) + '</p></div>').join('')
    : '<div class="iv-empty">尚未添加处理记录。</div>';
  const textarea = $('#iv-handover-note');
  if (textarea && textarea.value !== state.handover) textarea.value = state.handover;
  const summary = $('#iv-handover-summary');
  if (summary) summary.innerHTML = '<small>REPORT PREVIEW</small><p>' + escapeHtml(state.handover || '导出时会合并告警事实、诊断报告、知识依据和处理记录。') + '</p>';
}

function renderChecklist() {
  $('#iv-check-diagnosis').classList.toggle('done', Boolean(state.report.trim()));
  $('#iv-check-note').classList.toggle('done', state.notes.length > 0);
  $('#iv-check-handover').classList.toggle('done', Boolean(state.handover.trim()));
}

function render() {
  if (!state.selected) return;
  const alert = state.selected;
  const parsed = parseAlert(alert);
  const level = severity(alert);
  $('#iv-title').textContent = alert.alert_name;
  $('#iv-summary').textContent = alert.description || '后端未返回告警描述';
  $('#iv-source').textContent = state.mock ? '模拟告警' : 'Prometheus';
  $('#iv-duration').textContent = durationText(alert);
  $('#iv-state').textContent = alert.state || 'firing';
  $('#iv-level').textContent = level;
  $('#iv-level').className = 'v2-priority ' + level.toLowerCase();
  $('#iv-selected-title').textContent = alert.alert_name;
  $('#iv-selected-level').textContent = level;
  $('#iv-selected-level').className = 'v2-priority ' + level.toLowerCase();
  $('#iv-selected-service').textContent = parsed.service + ' · ' + (alert.state || 'firing');
  $('#iv-meta-alert').textContent = alert.alert_name;
  $('#iv-meta-instance').textContent = parsed.instance;
  $('#iv-meta-time').textContent = timeText(alert.active_at);
  $('#iv-meta-duration').textContent = durationText(alert);
  $('#iv-facts').innerHTML = [
    ['服务', parsed.service],
    ['实例', parsed.instance],
    ['命名空间', parsed.namespace],
    ['首次触发', timeText(alert.active_at)]
  ].map(([label, value]) => '<div class="v2-fact"><small>' + escapeHtml(label) + '</small><strong title="' + escapeHtml(value) + '">' + escapeHtml(value) + '</strong></div>').join('');
  renderReport();
  renderEvidence(parsed);
  renderSources();
  renderNotes();
  renderChecklist();
}

async function loadLogs(force = false) {
  if (!state.selected || (state.logs.length && !force)) {
    renderLogs();
    return;
  }
  const alert = state.selected;
  const topic = alert.alert_name === 'SlowResponse' ? 'database-slow-query' : (alert.alert_name === 'ServiceUnavailable' ? 'application-logs' : 'system-metrics');
  const query = alert.alert_name === 'HighCPUUsage' ? 'cpu_usage:>80' : (alert.alert_name === 'HighMemoryUsage' ? 'memory_usage:>85' : '');
  $('#iv-log').innerHTML = '<div class="iv-empty">正在读取日志…</div>';
  $('#iv-log-source').textContent = topic + ' · ap-guangzhou · ' + (state.mock ? '模拟日志' : '日志服务');
  try {
    const data = await api('/api/platform/logs?topic=' + encodeURIComponent(topic) + '&query=' + encodeURIComponent(query));
    $('#iv-log-source').textContent = topic + ' · ap-guangzhou · ' + (data.mock ? '模拟日志' : '日志服务');
    state.logs = data.result?.logs || [];
    renderLogs();
  } catch (error) {
    state.logs = [];
    $('#iv-log').innerHTML = '<div class="iv-empty">' + escapeHtml(error.message) + '</div>';
  }
}

async function diagnose() {
  if (!state.selected || state.busy) return;
  state.busy = true;
  state.report = '';
  $('#iv-diagnose').disabled = true;
  $('#iv-diagnose-inline').disabled = true;
  $('#iv-report').textContent = '正在读取告警，并调用诊断工具…';
  $('#iv-diagnosis-prompt').hidden = true;
  const alert = state.selected;
  const prompt = '请针对以下告警调用运维工具进行诊断，生成 Markdown 报告，严格区分观测事实、根因假设、待验证项和排查建议，不执行变更。告警名称：' + alert.alert_name + '；描述：' + alert.description + '；持续时间：' + durationText(alert) + '。页面数据来源：' + (state.mock ? '模拟告警，必须明确标注' : '配置的 Prometheus 服务') + '。只根据工具返回内容，不编造指标、时间线或概率。';
  try {
    await stream('/api/chat_stream', { Id: 'v2-incident-' + crypto.randomUUID(), Question: prompt }, event => {
      if (event.type === 'content') state.report += event.data || '';
      if (state.report) $('#iv-report').textContent = state.report;
    });
    if (!state.report.trim()) throw new Error('模型未返回诊断内容');
    saveLocalState();
    renderChecklist();
    toast('诊断报告已生成');
  } catch (error) {
    state.report = state.report || '诊断未完成：' + error.message;
    $('#iv-report').textContent = state.report;
    toast(error.message);
  } finally {
    state.busy = false;
    $('#iv-diagnose').disabled = false;
    $('#iv-diagnose-inline').disabled = false;
  }
}

function exportReport() {
  if (!state.selected) return;
  const parsed = parseAlert(state.selected);
  const lines = [
    '# ' + state.selected.alert_name + ' 故障深挖与交接报告',
    '',
    '> 数据来源：' + (state.mock ? '后端模拟告警（不是生产事实）' : '配置的 Prometheus 服务') + '。模型建议不执行系统变更。',
    '',
    '## 故障事实',
    '- 服务：' + parsed.service,
    '- 实例：' + parsed.instance,
    '- 命名空间：' + parsed.namespace,
    '- 首次触发：' + timeText(state.selected.active_at),
    '- 持续时间：' + durationText(state.selected),
    '- 原始描述：' + (state.selected.description || '未返回描述'),
    '',
    '## 诊断报告',
    state.report || '尚未生成诊断报告。',
    '',
    '## 知识依据',
    '- 当前匹配：' + knowledgeFor(state.selected),
    '',
    '## 处理记录',
    state.notes.length ? state.notes.map(note => '- ' + note.time + '：' + note.text).join('\n') : '- 尚未添加处理记录。',
    '',
    '## 交接备注',
    state.handover || '尚未填写交接备注。',
    '',
    '## 使用边界',
    '- 诊断结果来自工具返回内容，不能替代现场核验。',
    '- 本页不展示没有真实数据支撑的趋势、评分或时间线。'
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'AIOps-故障交接-' + state.selected.alert_name + '.md';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function switchTab(tab) {
  $$('.iv-tab').forEach(button => {
    const active = button.dataset.ivTab === tab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  $$('.iv-pane').forEach(pane => pane.classList.toggle('active', pane.dataset.ivPane === tab));
  if (tab === 'evidence') loadLogs();
}

function bindEvents() {
  $$('.iv-tab').forEach(button => button.addEventListener('click', () => switchTab(button.dataset.ivTab)));
  $('#iv-diagnose').addEventListener('click', diagnose);
  $('#iv-diagnose-inline').addEventListener('click', diagnose);
  $('#iv-export').addEventListener('click', exportReport);
  $('#iv-refresh-logs').addEventListener('click', () => loadLogs(true));
  $('#iv-claim').addEventListener('click', event => {
    const button = event.currentTarget;
    const claimed = button.dataset.claimed === 'true';
    button.dataset.claimed = String(!claimed);
    button.textContent = claimed ? '认领故障' : '已认领';
    $('#iv-shift-owner').textContent = claimed ? '尚未认领' : '张晓 · 已认领';
    toast(claimed ? '已取消认领' : '已认领当前故障');
  });
  $('#iv-add-note').addEventListener('click', () => {
    const form = $('#iv-note-form');
    form.hidden = false;
    form.elements.note.focus();
  });
  // 回车直接发送，Shift+Enter 换行；输入法组合期间的回车不触发发送
  $$('textarea').forEach(area => {
    area.addEventListener('keydown', event => {
      if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
      const form = area.closest('form');
      if (!form) return;
      event.preventDefault();
      form.requestSubmit();
    });
  });

  $('#iv-note-form').addEventListener('submit', event => {
    event.preventDefault();
    const textarea = event.currentTarget.elements.note;
    const text = textarea.value.trim();
    if (!text) return;
    state.notes.push({ time: new Date().toLocaleTimeString('zh-CN', { hour12: false }), text });
    textarea.value = '';
    event.currentTarget.hidden = true;
    saveLocalState();
    renderNotes();
    renderChecklist();
    toast('处理记录已保存');
  });
  $('#iv-save-handover').addEventListener('click', () => {
    state.handover = $('#iv-handover-note').value.trim();
    saveLocalState();
    renderNotes();
    renderChecklist();
    toast('交接备注已保存');
  });
}

async function load() {
  try {
    const [alertData, documents] = await Promise.all([api('/api/platform/alerts'), api('/api/platform/documents')]);
    state.alerts = alertData.alerts || [];
    state.documents = documents || [];
    state.mock = Boolean(alertData.mock);
    const requested = sessionStorage.getItem('v2-alert');
    state.selected = state.alerts.find(alert => alert.alert_name === requested) || state.alerts[0] || null;
    if (!state.selected) throw new Error('后端未返回活动告警');
    $('#iv-status').textContent = state.mock ? '后端已连接 · 模拟告警' : '后端已连接 · Prometheus';
    loadLocalState();
    render();
  } catch (error) {
    $('#iv-status').textContent = '后端连接失败';
    $('#iv-title').textContent = '无法读取故障';
    $('#iv-summary').textContent = error.message;
    toast(error.message);
  }
}

bindEvents();
load();

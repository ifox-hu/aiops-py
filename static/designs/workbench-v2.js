'use strict';

const state = {
  alerts: [],
  selected: null,
  severityRules: { SlowResponse: 'P1', HighMemoryUsage: 'P1', HighCPUUsage: 'P2', HighDiskUsage: 'P1', ServiceUnavailable: 'P1' },
  documents: [],
  logsLoadedFor: '',
  report: '',
  conversation: [],
  busy: false,
  mock: true
};

const $ = selector => document.querySelector(selector);
const $$ = selector => Array.from(document.querySelectorAll(selector));
const escapeHtml = value => String(value == null ? '' : value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const icon = () => '';

const HISTORY_KEY = 'aiops-workbench-v2';

function readHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '{}'); } catch { return {}; }
}

function historyTime(value) {
  if (!value) return '\u2014';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function loadDiagnosis(alertName) {
  const entry = readHistory()[alertName];
  return entry && entry.report ? entry.report : '';
}

function saveDiagnosis(alertName, report) {
  const history = readHistory();
  history[alertName] = { report: report, updatedAt: new Date().toISOString() };
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); } catch {}
  try {
    const key = 'v2-incident-' + alertName;
    const incident = JSON.parse(localStorage.getItem(key) || '{}');
    incident.report = report;
    localStorage.setItem(key, JSON.stringify(incident));
  } catch {}
}

function renderHistory() {
  const list = $('#v2-diagnosis-history');
  if (!list) return;
  const history = readHistory();
  const names = Object.keys(history).sort((a, b) => String((history[b] || {}).updatedAt || '').localeCompare(String((history[a] || {}).updatedAt || '')));
  if (!names.length) {
    list.innerHTML = '<div class="v2-empty">\u5c1a\u672a\u751f\u6210\u8bca\u65ad\u62a5\u544a</div>';
    return;
  }
  list.innerHTML = names.map(function (name) {
    const entry = history[name] || {};
    const current = state.selected && state.selected.alert_name === name;
    return '<div class="v2-source v2-history-item' + (current ? ' current' : '') + '">' +
      '<button class="v2-history-open" type="button" data-history-alert="' + escapeHtml(name) + '"><span><strong>' + escapeHtml(name) + (current ? ' \u00b7 \u5f53\u524d\u544a\u8b66' : '') + '</strong><small>' + escapeHtml(historyTime(entry.updatedAt)) + ' \u00b7 ' + String(entry.report || '').length + ' \u5b57\u7b26</small></span><span class="v2-score">' + (current ? '\u5f53\u524d' : '\u67e5\u770b') + '</span></button>' +
      '<button class="v2-history-delete" type="button" data-history-delete="' + escapeHtml(name) + '" title="\u5220\u9664\u8fd9\u6761\u8bca\u65ad\u8bb0\u5f55" aria-label="\u5220\u9664 ' + escapeHtml(name) + ' \u7684\u8bca\u65ad\u8bb0\u5f55">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6"></path></svg>' +
      '</button></div>';
  }).join('');
}

function deleteDiagnosis(alertName) {
  const history = readHistory();
  if (!history[alertName]) return;
  delete history[alertName];
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); } catch {}
  try {
    const key = 'v2-incident-' + alertName;
    const incident = JSON.parse(localStorage.getItem(key) || '{}');
    delete incident.report;
    localStorage.setItem(key, JSON.stringify(incident));
  } catch {}
  if (state.selected && state.selected.alert_name === alertName) {
    state.report = '';
    $('#v2-report').textContent = '';
    $('#v2-diagnosis-prompt').hidden = false;
  }
  renderHistory();
  toast('\u5df2\u5220\u9664 ' + alertName + ' \u7684\u8bca\u65ad\u8bb0\u5f55');
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

function severity(alert) {
  return state.severityRules[alert.alert_name] || 'P3';
}

function durationSeconds(alert) {
  if (alert.duration) {
    const match = alert.duration.match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/);
    if (match) return Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0);
  }
  return Math.max(0, (Date.now() - new Date(alert.active_at).getTime()) / 1000);
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
  return new Date(value).toLocaleTimeString('zh-CN', { hour12: false });
}

function parseAlert(alert) {
  const description = alert.description || '';
  const serviceMatch = description.match(/服务\s+([^\s的]+)/);
  const instanceMatch = description.match(/实例[:：]\s*([^，,\s]+)/);
  const valueMatch = description.match(/(?:当前值|当前值为)[:：]?\s*([0-9.]+\s*(?:%|秒|s|GB)?)/);
  const causeMatch = description.match(/可能原因[:：]\s*(.+)$/);
  return {
    service: serviceMatch ? serviceMatch[1] : '待确认',
    instance: instanceMatch ? instanceMatch[1] : '未返回实例',
    value: valueMatch ? valueMatch[1] : '查看原始告警',
    cause: causeMatch ? causeMatch[1].trim() : '未在告警描述中给出候选原因，需要结合日志与知识库验证。'
  };
}

function sortedAlerts() {
  return [...state.alerts].sort((a, b) => {
    const severityOrder = { P1: 0, P2: 1, P3: 2 };
    const bySeverity = severityOrder[severity(a)] - severityOrder[severity(b)];
    if (bySeverity) return bySeverity;
    return durationSeconds(b) - durationSeconds(a);
  });
}

function filteredAlerts(filter) {
  if (filter === 'long') return sortedAlerts().filter(alert => durationSeconds(alert) >= 20 * 60);
  if (filter === 'recent') return sortedAlerts().filter(alert => durationSeconds(alert) <= 15 * 60);
  return sortedAlerts();
}

function renderQueue(filter = 'all') {
  const alerts = filteredAlerts(filter);
  const list = $('#v2-alert-list');
  if (!list) return;
  list.innerHTML = alerts.map(alert => {
    const parsed = parseAlert(alert);
    const selected = state.selected && state.selected.alert_name === alert.alert_name;
    return `<button class="v2-alert-row${selected ? ' selected' : ''}" type="button" role="listitem" data-alert-name="${escapeHtml(alert.alert_name)}" aria-pressed="${selected}">
      <span class="v2-priority ${severity(alert).toLowerCase()}">${severity(alert)}</span>
      <span><span class="v2-alert-title">${escapeHtml(alert.alert_name)}</span><span class="v2-alert-sub">${escapeHtml(parsed.service)} · ${escapeHtml(alert.state || 'firing')}</span></span>
      <span class="v2-alert-duration">${escapeHtml(durationText(alert))}</span>
    </button>`;
  }).join('') || '<div class="v2-empty">当前筛选条件下没有告警</div>';
  const foot = $('#v2-queue-foot');
  if (foot) foot.textContent = '共 ' + state.alerts.length + ' 条活动告警 · 当前显示 ' + alerts.length + ' 条';
}

function renderFocus() {
  const alert = state.selected;
  if (!alert) return;
  const parsed = parseAlert(alert);
  const level = severity(alert);
  $('#v2-focus-level').textContent = level;
  $('#v2-focus-level').className = 'v2-priority ' + level.toLowerCase();
  $('#v2-focus-title').textContent = alert.alert_name;
  $('#v2-focus-desc').textContent = alert.description || '暂无告警描述';
  $('#v2-fact-service').textContent = parsed.service;
  $('#v2-fact-instance').textContent = parsed.instance;
  $('#v2-fact-time').textContent = timeText(alert.active_at);
  $('#v2-fact-duration').textContent = durationText(alert);
  $('#v2-context-title').textContent = alert.alert_name + ' · ' + parsed.service;
  $('#v2-report').textContent = state.report;
  $('#v2-diagnosis-prompt').hidden = Boolean(state.report);
  renderEvidence();
  renderSources();
  renderHistory();
}

function renderEvidence() {
  const alert = state.selected;
  const list = $('#v2-evidence-list');
  if (!alert || !list) return;
  const parsed = parseAlert(alert);
  const items = [
    { label: 'OBSERVED / 观测事实', title: parsed.service + ' 触发 ' + alert.alert_name, text: alert.description || '后端未返回描述。' },
    { label: 'CANDIDATE / 候选原因', title: parsed.cause, text: '候选原因来自告警描述，尚不能作为根因结论；需要结合日志、指标与知识库证据验证。' },
    { label: 'PENDING / 待确认', title: '影响范围与持续时间需要现场核验', text: '当前展示的信息来自后端告警接口。若来源为 Prometheus，请进一步确认实例、命名空间、影响接口和最近变更。' }
  ];
  list.innerHTML = items.map(item => `<article class="v2-evidence"><small>${escapeHtml(item.label)}</small><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.text)}</p></article>`).join('');
}

function knowledgeFor(alert) {
  const name = alert.alert_name;
  if (name === 'HighCPUUsage') return 'cpu_high_usage.md';
  if (name === 'HighMemoryUsage') return 'memory_high_usage.md';
  if (name === 'HighDiskUsage') return 'disk_high_usage.md';
  if (name === 'ServiceUnavailable') return 'service_unavailable.md';
  return 'slow_response.md';
}

function renderSources() {
  const list = $('#v2-source-list');
  if (!list || !state.selected) return;
  const primary = knowledgeFor(state.selected);
  const docs = state.documents;
  if (!docs.length) {
    list.innerHTML = '<div class="v2-empty">暂无知识文档</div>';
    return;
  }
  list.innerHTML = docs.map(doc => {
    const isMatch = doc.name === primary;
    return `<div class="v2-source"><span><strong>${escapeHtml(doc.name)}${isMatch ? ' · 当前匹配' : ''}</strong><small>${doc.size ? Math.ceil(doc.size / 1024) + ' KB · ' : ''}已保存文档，检索来源以实际召回为准</small></span><span class="v2-score">${isMatch ? 'MATCH' : 'DOC'}</span></div>`;
  }).join('');
}

async function loadLogs(force = false) {
  const alert = state.selected;
  if (!alert) return;
  const parsed = parseAlert(alert);
  const topic = alert.alert_name === 'SlowResponse' ? 'database-slow-query' : (alert.alert_name === 'ServiceUnavailable' ? 'application-logs' : 'system-metrics');
  const query = alert.alert_name === 'HighCPUUsage' ? 'cpu_usage:>80' : (alert.alert_name === 'HighMemoryUsage' ? 'memory_usage:>85' : '');
  const key = alert.alert_name + '|' + topic + '|' + query;
  if (!force && state.logsLoadedFor === key) return;
  const container = $('#v2-log');
  container.innerHTML = '<div class="v2-empty">正在读取日志…</div>';
  try {
    const data = await api('/api/platform/logs?topic=' + encodeURIComponent(topic) + '&query=' + encodeURIComponent(query));
    const logs = data.result?.logs || [];
    container.innerHTML = logs.map(log => `<div class="v2-log-line"><time>${escapeHtml(log.timestamp)}</time><span class="level ${escapeHtml(log.level)}">${escapeHtml(log.level)}</span><span>${escapeHtml(log.service)} · ${escapeHtml(log.instance)} · ${escapeHtml(log.message)}</span></div>`).join('') || '<div class="v2-empty">未查询到日志</div>';
    state.logsLoadedFor = key;
  } catch (error) {
    container.innerHTML = '<div class="v2-empty">' + escapeHtml(error.message) + '</div>';
  }
}

function switchTab(tab) {
  $$('.v2-tab').forEach(button => {
    const active = button.dataset.tab === tab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  $$('.v2-tab-pane').forEach(pane => pane.classList.toggle('active', pane.dataset.pane === tab));
  if (tab === 'logs') loadLogs();
}

async function stream(url, body, onEvent, timeoutMs = 180000) {
  const controller = new AbortController();
  let timer;
  const reset = () => { clearTimeout(timer); timer = setTimeout(() => controller.abort(), timeoutMs); };
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

async function diagnose() {
  const alert = state.selected;
  if (!alert || state.busy) return;
  state.busy = true;
  state.report = '';
  $('#v2-diagnose').disabled = true;
  $('#v2-diagnose-inline').disabled = true;
  $('#v2-report').textContent = '正在读取告警，并调用诊断工具…';
  $('#v2-diagnosis-prompt').hidden = true;
  const prompt = '请针对以下告警调用运维工具进行诊断，生成 Markdown 报告，严格区分观测事实、根因假设、待验证项和排查建议，不执行变更。告警名称：' + alert.alert_name + '；描述：' + alert.description + '；持续时间：' + durationText(alert) + '。页面数据来源：' + (state.mock ? '模拟告警，必须明确标注' : '配置的 Prometheus 服务') + '。只根据工具返回内容，不编造指标、时间线或概率。';
  try {
    await stream('/api/chat_stream', { Id: 'v2-diagnosis-' + crypto.randomUUID(), Question: prompt }, event => {
      if (event.type === 'content') state.report += event.data || '';
      if (state.report) $('#v2-report').textContent = state.report;
    });
    if (!state.report.trim()) throw new Error('模型未返回诊断内容');
    saveDiagnosis(alert.alert_name, state.report);
    renderHistory();
    toast('诊断报告已生成');
    switchTab('diagnosis');
  } catch (error) {
    state.report = state.report || '诊断未完成：' + error.message;
    $('#v2-report').textContent = state.report;
    toast(error.message);
  } finally {
    state.busy = false;
    $('#v2-diagnose').disabled = false;
    $('#v2-diagnose-inline').disabled = false;
  }
}

async function askAssistant(question) {
  const alert = state.selected;
  if (!alert || state.busy) return;
  state.busy = true;
  const chat = $('#v2-chat');
  chat.insertAdjacentHTML('beforeend', '<div class="v2-message user">' + escapeHtml(question) + '</div>');
  const answer = document.createElement('div');
  answer.className = 'v2-message assistant';
  answer.textContent = '正在结合当前告警检索知识库…';
  chat.appendChild(answer);
  chat.scrollTop = chat.scrollHeight;
  $('#v2-send').disabled = true;
  const contextQuestion = '当前告警：' + alert.alert_name + '，' + alert.description + '。用户追问：' + question;
  let full = '';
  try {
    await stream('/api/platform/knowledge/stream', { question: contextQuestion, history: state.conversation, mode: 'knowledge' }, event => {
      if (event.type === 'content') full += event.data || '';
      if (event.type === 'done' && !full) full = event.data || '';
      if (full) answer.textContent = full;
      chat.scrollTop = chat.scrollHeight;
    });
    state.conversation.push({ role: 'user', content: question }, { role: 'assistant', content: full });
    state.conversation = state.conversation.slice(-12);
  } catch (error) {
    answer.textContent = '请求未完成：' + error.message;
  } finally {
    state.busy = false;
    $('#v2-send').disabled = false;
  }
}

function exportReport() {
  if (!state.report) {
    toast('请先生成诊断报告');
    return;
  }
  const blob = new Blob([state.report], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'AIOps-诊断报告-' + (state.selected?.alert_name || 'incident') + '.md';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function selectAlert(alert) {
  state.selected = alert;
  state.report = loadDiagnosis(alert.alert_name);
  state.logsLoadedFor = '';
  state.conversation = [];
  $('#v2-report').textContent = state.report;
  renderQueue($('.v2-filter.active')?.dataset.filter || 'all');
  renderFocus();
  switchTab('diagnosis');
}

function bindEvents() {
  $('#v2-alert-list')?.addEventListener('click', event => {
    const row = event.target.closest('[data-alert-name]');
    if (!row) return;
    const alert = state.alerts.find(item => item.alert_name === row.dataset.alertName);
    if (alert) selectAlert(alert);
  });
  $$('.v2-filter').forEach(button => button.addEventListener('click', () => {
    $$('.v2-filter').forEach(item => item.classList.toggle('active', item === button));
    renderQueue(button.dataset.filter);
  }));
  $$('.v2-tab').forEach(button => button.addEventListener('click', () => switchTab(button.dataset.tab)));
  $('#v2-diagnosis-history')?.addEventListener('click', event => {
    const remove = event.target.closest('[data-history-delete]');
    if (remove) {
      deleteDiagnosis(remove.dataset.historyDelete);
      return;
    }
    const button = event.target.closest('[data-history-alert]');
    if (!button) return;
    const target = state.alerts.find(item => item.alert_name === button.dataset.historyAlert);
    if (target) selectAlert(target);
  });
  $('#v2-diagnose').addEventListener('click', diagnose);
  $('#v2-diagnose-inline').addEventListener('click', diagnose);
  $('#v2-export').addEventListener('click', exportReport);
  $('#v2-detail').addEventListener('click', () => {
    if (!state.selected) return;
    sessionStorage.setItem('v2-alert', state.selected.alert_name);
    location.href = 'incident-v2.html';
  });
  $('#v2-refresh').addEventListener('click', () => load(true));
  $('#v2-claim').addEventListener('click', event => {
    const button = event.currentTarget;
    const claimed = button.dataset.claimed === 'true';
    button.dataset.claimed = String(!claimed);
    button.textContent = claimed ? '认领' : '已认领';
    toast(claimed ? '已取消认领' : '已认领当前告警');
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

  $('#v2-form').addEventListener('submit', event => {
    event.preventDefault();
    const input = event.currentTarget.elements.question;
    const question = input.value.trim();
    if (!question) return;
    input.value = '';
    askAssistant(question);
  });
}

async function load(force = false) {
  const status = $('#v2-status');
  if (status) status.textContent = '正在连接后端';
  try {
    const [alertData, documents] = await Promise.all([api('/api/platform/alerts'), api('/api/platform/documents')]);
    state.alerts = alertData.alerts || [];
    state.documents = documents || [];
    state.mock = Boolean(alertData.mock);
    state.selected = state.alerts.find(item => item.alert_name === sessionStorage.getItem('v2-alert')) || sortedAlerts()[0] || null;
    $('#v2-status').textContent = state.mock ? '后端已连接 · 模拟告警' : '后端已连接 · Prometheus';
    $('#v2-count').textContent = state.alerts.length;
    $('#v2-source').textContent = state.mock ? '模拟数据' : 'Prometheus';
    $('#v2-updated').textContent = timeText(alertData.updatedAt);
    $('#v2-live-count').textContent = state.alerts.length + ' firing';
    renderQueue($('.v2-filter.active')?.dataset.filter || 'all');
    state.report = state.selected ? loadDiagnosis(state.selected.alert_name) : '';
    if (state.selected) renderFocus();
    if (force) toast('告警已刷新');
  } catch (error) {
    if (status) status.textContent = '后端连接失败';
    $('#v2-alert-list').innerHTML = '<div class="v2-empty">' + escapeHtml(error.message) + '</div>';
    toast(error.message);
  }
}

bindEvents();
load();

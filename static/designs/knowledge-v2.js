'use strict';

const state = {
  documents: [],
  sources: [],
  conversation: [],
  sessions: [],
  activeSessionId: '',
  mode: 'knowledge',
  busy: false
};

const $ = selector => document.querySelector(selector);
const $$ = selector => Array.from(document.querySelectorAll(selector));
const escapeHtml = value => String(value == null ? '' : value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const STORAGE_KEY = 'aiops-knowledge-v2';

function toast(message) {
  document.querySelector('.v2-toast')?.remove();
  const node = document.createElement('div');
  node.className = 'v2-toast';
  node.setAttribute('role', 'status');
  node.textContent = message;
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 2600);
}

function showModal(title, body) {
  $('#kv-modal-title').textContent = title;
  $('#kv-modal-body').textContent = body;
  $('#kv-modal').hidden = false;
}

function hideModal() {
  $('#kv-modal').hidden = true;
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

function sourceName(source) {
  try {
    return JSON.parse(source.metadata || '{}')._file_name || source.id || '检索片段';
  } catch {
    return source.id || '检索片段';
  }
}

function loadSaved() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    state.sessions = Array.isArray(saved.sessions) ? saved.sessions : [];
    state.activeSessionId = saved.activeSessionId || '';
    const active = state.sessions.find(session => session.id === state.activeSessionId);
    state.conversation = active ? active.conversation || [] : [];
  } catch {
    state.sessions = [];
    state.conversation = [];
  }
  if (!state.sessions.length) {
    newSession(false);
  } else if (!activeSession()) {
    state.activeSessionId = state.sessions[0].id;
    state.conversation = state.sessions[0].conversation || [];
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ sessions: state.sessions, activeSessionId: state.activeSessionId }));
  } catch {}
}

function activeSession() {
  return state.sessions.find(session => session.id === state.activeSessionId);
}

function newSession(render = true) {
  const session = {
    id: crypto.randomUUID(),
    title: '新的知识问答',
    updatedAt: new Date().toISOString(),
    conversation: []
  };
  state.sessions.unshift(session);
  state.activeSessionId = session.id;
  state.conversation = session.conversation;
  state.sources = [];
  if (render) {
    renderConversation();
    renderSources();
    renderHistory();
    $('#kv-form').elements.question.focus();
  }
  save();
}

function renderConversation() {
  const chat = $('#kv-chat');
  if (!chat) return;
  if (!state.conversation.length) {
    chat.innerHTML = '<div class="kv-welcome"><div class="kv-welcome-mark">AI</div><div><h3>运维知识问答</h3><p>可以问“CPU 持续过高怎么排查”，也可以问“什么是连接池”。知识库优先模式会告诉你答案依据来自哪些片段。</p></div></div>';
    return;
  }
  chat.innerHTML = state.conversation.map(turn => {
    const note = turn.mode === 'general'
      ? '通用问答 · 未检索知识库'
      : '知识库优先 · 召回 ' + (turn.sources?.length || 0) + ' 个片段';
    return '<article class="kv-turn"><div class="kv-question">' + escapeHtml(turn.question) + '</div><div class="kv-answer"><div class="kv-answer-head"><span>AI 知识助手</span><span>' + escapeHtml(note) + '</span></div><div class="kv-answer-text">' + escapeHtml(turn.answer || '正在生成回答…') + '</div><div class="kv-answer-note">回答仅供参考，请结合现场证据核验。</div></div></article>';
  }).join('');
  chat.scrollTop = chat.scrollHeight;
}

function renderSources() {
  const list = $('#kv-sources');
  if (!list) return;
  if (state.mode === 'general') {
    $('#kv-source-summary').textContent = '通用问答未执行知识库检索';
    list.innerHTML = '<div class="kv-empty">通用问答回答来自模型已有知识，不展示知识库来源。</div>';
    return;
  }
  $('#kv-source-summary').textContent = state.sources.length ? '实际召回 ' + state.sources.length + ' 个片段' : '等待提问';
  list.innerHTML = state.sources.length
    ? state.sources.map((source, index) => '<button class="kv-source" type="button" data-kv-source="' + index + '"><small>SOURCE ' + String(index + 1).padStart(2, '0') + '</small><strong>' + escapeHtml(sourceName(source)) + '</strong><p>' + escapeHtml(source.content || '') + '</p><span>L2 距离 ' + escapeHtml(source.score) + ' · 查看完整片段</span></button>').join('')
    : '<div class="kv-empty">知识库优先模式下，发送问题后显示实际召回片段。</div>';
}

function renderDocuments() {
  const list = $('#kv-doc-list');
  const keyword = ($('#kv-filter-input')?.value || '').trim().toLowerCase();
  const documents = state.documents.filter(doc => !keyword || doc.name.toLowerCase().includes(keyword));
  if (!documents.length) {
    list.innerHTML = '<div class="kv-empty">' + (state.documents.length ? '没有匹配的文档' : '暂无知识文档，请上传 Markdown 或 TXT。') + '</div>';
    return;
  }
  list.innerHTML = documents.map(doc => {
    const index = state.documents.indexOf(doc);
    return '<div class="kv-doc"><span class="kv-doc-mark">MD</span><span><strong title="' + escapeHtml(doc.name) + '">' + escapeHtml(doc.name) + '</strong><small>' + Math.ceil(doc.size / 1024) + ' KB · ' + escapeHtml(new Date(doc.updatedAt).toLocaleString('zh-CN', { hour12: false })) + ' · 已保存</small></span><button type="button" data-kv-document="' + index + '">查看</button></div>';
  }).join('');
}

function renderHistory() {
  const list = $('#kv-history');
  if (!list) return;
  list.innerHTML = state.sessions.length
    ? state.sessions.map(session => '<div class="kv-history-item"><span><strong>' + escapeHtml(session.title) + '</strong><small>' + escapeHtml(new Date(session.updatedAt).toLocaleString('zh-CN', { hour12: false })) + ' · ' + (session.conversation?.length || 0) + ' 轮</small></span><button type="button" data-kv-session="' + escapeHtml(session.id) + '">打开</button></div>').join('')
    : '<div class="kv-empty">还没有历史会话。</div>';
}

function historyForModel() {
  return state.conversation.slice(0, -1).slice(-6).flatMap(turn => [
    { role: 'user', content: turn.question },
    { role: 'assistant', content: turn.answer || '' }
  ]).filter(item => item.content);
}

async function ask(question) {
  if (!question || state.busy) return;
  state.busy = true;
  const session = activeSession();
  const turn = { question, answer: '', mode: state.mode, sources: [] };
  session.conversation.push(turn);
  session.title = question.slice(0, 32) + (question.length > 32 ? '…' : '');
  session.updatedAt = new Date().toISOString();
  state.conversation = session.conversation;
  state.sources = [];
  renderConversation();
  renderSources();
  renderHistory();
  save();

  const answerNode = document.querySelectorAll('.kv-answer-text')[state.conversation.length - 1];
  answerNode.textContent = state.mode === 'knowledge' ? '正在检索知识库并生成回答…' : '正在生成回答…';
  answerNode.classList.add('is-loading');
  $('#kv-send').disabled = true;
  let full = '';
  try {
    await stream('/api/platform/knowledge/stream', { question, history: historyForModel(), mode: state.mode }, event => {
      if (event.type === 'sources') {
        state.sources = event.data || [];
        turn.sources = state.sources;
        renderSources();
        if (state.mode === 'knowledge') answerNode.textContent = '已检索 ' + state.sources.length + ' 个片段，正在生成回答…';
      }
      if (event.type === 'content') full += event.data || '';
      if (event.type === 'done' && !full) full = event.data || '';
      if (full) answerNode.textContent = full;
    });
    if (!full.trim()) throw new Error('模型没有返回内容');
    turn.answer = full;
    turn.updatedAt = new Date().toISOString();
    session.updatedAt = turn.updatedAt;
    answerNode.classList.remove('is-loading');
    save();
  } catch (error) {
    turn.answer = '请求未完成：' + error.message;
    answerNode.textContent = turn.answer;
    answerNode.classList.remove('is-loading');
    save();
  } finally {
    state.busy = false;
    $('#kv-send').disabled = false;
    renderConversation();
  }
}

async function loadDocuments() {
  try {
    state.documents = await api('/api/platform/documents');
    $('#kv-doc-count').textContent = state.documents.length + ' 篇文档';
    $('#kv-doc-count-head').textContent = state.documents.length + ' 篇';
    $('#kv-doc-status').textContent = state.documents.length ? '共 ' + state.documents.length + ' 篇，检索来源以实际召回为准' : '暂无文档';
    renderDocuments();
  } catch (error) {
    $('#kv-doc-status').textContent = '文档加载失败';
    $('#kv-doc-list').innerHTML = '<div class="kv-empty">' + escapeHtml(error.message) + '</div>';
  }
}

function switchMode(mode) {
  state.mode = mode;
  $$('.kv-mode-switch button').forEach(button => {
    const active = button.dataset.kvMode === mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  $('#kv-mode-label').textContent = mode === 'knowledge' ? '知识库优先' : '通用问答';
  $('#kv-composer-note').textContent = mode === 'knowledge' ? '基于实际检索内容生成 · 请结合现场证据核验' : '通用问答不检索知识库 · 事实性内容请自行核验';
  $('#kv-chat-context').textContent = mode === 'knowledge' ? '已检索内容会出现在答案下方' : '回答来自模型已有知识，不展示召回来源';
  renderSources();
}

function bindEvents() {
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

  $('#kv-form').addEventListener('submit', event => {
    event.preventDefault();
    const input = event.currentTarget.elements.question;
    const question = input.value.trim();
    if (!question || state.busy) return;
    input.value = '';
    ask(question);
  });
  $$('.kv-mode-switch button').forEach(button => button.addEventListener('click', () => switchMode(button.dataset.kvMode)));
  $$('#kv-suggestions button').forEach(button => button.addEventListener('click', () => {
    $('#kv-form').elements.question.value = button.dataset.kvPrompt;
    $('#kv-form').requestSubmit();
  }));
  $('#kv-new-chat').addEventListener('click', () => newSession());
  $('#kv-clear-history').addEventListener('click', () => {
    if (state.busy) return toast('请等待当前请求完成');
    state.sessions = [];
    state.conversation = [];
    newSession();
    toast('本地会话已清空');
  });
  $('#kv-upload').addEventListener('click', () => $('#kv-file').click());
  $('#kv-file').addEventListener('change', async event => {
    const file = event.target.files[0];
    if (!file) return;
    const status = $('#kv-doc-status');
    status.textContent = '正在上传并建立索引…';
    try {
      const body = new FormData();
      body.append('file', file);
      const result = await api('/api/upload', { method: 'POST', body });
      if (result.code !== 200) throw new Error(result.message || '上传失败');
      await loadDocuments();
      toast('文档已加入知识库');
    } catch (error) {
      status.textContent = error.message;
    } finally {
      event.target.value = '';
    }
  });
  $('#kv-filter-input').addEventListener('input', renderDocuments);
  $('#kv-doc-list').addEventListener('click', async event => {
    const button = event.target.closest('[data-kv-document]');
    if (!button) return;
    const doc = state.documents[Number(button.dataset.kvDocument)];
    if (!doc) return;
    try {
      const result = await api('/api/platform/documents/content?name=' + encodeURIComponent(doc.name));
      showModal(doc.name, result.content || '文档为空');
    } catch (error) {
      toast(error.message);
    }
  });
  $('#kv-sources').addEventListener('click', event => {
    const button = event.target.closest('[data-kv-source]');
    if (!button) return;
    const source = state.sources[Number(button.dataset.kvSource)];
    if (!source) return;
    showModal(sourceName(source), (source.content || '') + '\n\n向量距离：' + source.score + '（L2 距离，不代表可信度）');
  });
  $('#kv-history').addEventListener('click', event => {
    const button = event.target.closest('[data-kv-session]');
    if (!button) return;
    const session = state.sessions.find(item => item.id === button.dataset.kvSession);
    if (!session) return;
    state.activeSessionId = session.id;
    state.conversation = session.conversation || [];
    state.sources = state.conversation.at(-1)?.sources || [];
    save();
    renderConversation();
    renderSources();
    renderHistory();
  });
  $('#kv-modal').addEventListener('click', event => {
    if (event.target.closest('[data-kv-close]')) hideModal();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') hideModal();
  });
}

async function init() {
  bindEvents();
  loadSaved();
  switchMode('knowledge');
  renderConversation();
  renderSources();
  renderHistory();
  try {
    await loadDocuments();
    $('#kv-status').textContent = '后端已连接 · 文档列表可用';
  } catch (error) {
    $('#kv-status').textContent = '后端连接失败';
  }
}

init();

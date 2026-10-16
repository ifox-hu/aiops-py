// Browser-only demo: no Python server, model calls or cloud credentials.
// UI adapted from the Java project; see LICENSE-JAVA-UI.
(() => {
  'use strict';
  const nativeFetch = window.fetch.bind(window);
  const encoder = new TextEncoder();
  const now = Date.now();
  const ago = minutes => new Date(now - minutes * 60000).toISOString();
  const definitions = [
    ['HighCPUUsage', 38, 'order-service', 'order-service-7f9c', '94.2%', '批处理任务或请求量突增导致 CPU 持续占用'],
    ['SlowResponse', 25, 'order-service', 'order-service-7f9c', '2.8 秒', '数据库连接池等待或慢 SQL'],
    ['HighMemoryUsage', 12, 'payment-service', 'payment-service-58d4', '88.6%', '对象缓存增长或内存泄漏']
  ];
  const alerts = definitions.map(([alert_name, minutes, service, instance, value, reason]) => ({
    alert_name, state: 'firing', active_at: ago(minutes), duration: minutes + 'm',
    description: '服务 ' + service + ' 的 ' + alert_name + ' 告警，当前值为 ' + value +
      '，实例：' + instance + '，命名空间：demo，可能原因：' + reason + '。'
  }));
  const content = {
    'cpu_high_usage.md': '# CPU 使用率过高排查\n\n1. 确认实例与告警时间窗口。\n2. 对比请求量、热点线程与 GC。\n3. 核对批处理任务和最近发布。',
    'slow_response.md': '# 服务响应变慢排查\n\n1. 对齐网关、应用与数据库耗时。\n2. 观察连接池 active、idle、pending 和超时次数。\n3. 分析慢 SQL、锁等待与下游重试。',
    'memory_high_usage.md': '# 内存使用率过高排查\n\n1. 区分堆、非堆和容器内存限制。\n2. 观察 GC 后存活对象。\n3. 检查缓存容量与对象增长。',
    'disk_high_usage.md': '# 磁盘使用率过高排查\n\n1. 定位增长最快的挂载点与目录。\n2. 检查日志轮转、临时文件和镜像缓存。',
    'service_unavailable.md': '# 服务不可用排查\n\n1. 检查实例存活、监听端口与注册状态。\n2. 核对依赖服务、配置及最近变更。'
  };
  const documents = Object.entries(content).map(([name, text]) => ({
    name, size: encoder.encode(text).length, updatedAt: ago(180)
  }));
  function json(value, status = 200) {
    return new Response(JSON.stringify(value), {
      status, headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }
  function stream(events, signal) {
    let timer;
    let closed = false;
    let controller;
    const cleanup = () => {
      closed = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    };
    const abort = () => {
      if (closed) return;
      cleanup();
      controller.error(new DOMException('Request aborted', 'AbortError'));
    };
    return new Response(new ReadableStream({
      start(target) {
        controller = target;
        if (signal?.aborted) return abort();
        signal?.addEventListener('abort', abort, { once: true });
        let index = 0;
        function push() {
          if (closed) return;
          if (index === events.length) {
            cleanup();
            controller.close();
            return;
          }
          controller.enqueue(encoder.encode('data: ' + JSON.stringify(events[index++]) + '\n\n'));
          timer = setTimeout(push, 18);
        }
        push();
      },
      cancel() { cleanup(); }
    }), { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
  }
  function sourcesFor(question) {
    let name = 'cpu_high_usage.md';
    if (/内存|memory/i.test(question)) name = 'memory_high_usage.md';
    else if (/慢|连接池|sql|SlowResponse/i.test(question)) name = 'slow_response.md';
    else if (/磁盘|disk/i.test(question)) name = 'disk_high_usage.md';
    else if (/不可用|unavailable/i.test(question)) name = 'service_unavailable.md';
    return [{ id: 'demo-source', content: content[name],
      metadata: JSON.stringify({ _file_name: name }), score: 0.1842 }];
  }
  function reportFor(question) {
    const alert = alerts.find(item => question.includes(item.alert_name)) || alerts[0];
    return [
      '# ' + alert.alert_name + ' · 演示诊断报告', '',
      '> 本报告由浏览器内的固定演示数据生成。', '',
      '## 观测事实', '- ' + alert.description, '- 告警、日志均为模拟数据。', '',
      '## 候选原因', '- ' + (alert.alert_name === 'HighMemoryUsage' ? '缓存或对象增长，需要核对内存曲线和 GC。' :
        alert.alert_name === 'SlowResponse' ? '连接池等待或慢 SQL，需要核对数据库耗时。' :
        '请求量或批处理任务增加，需要核对热点线程和发布记录。'), '',
      '## 建议排查顺序', '1. 确认告警实例与时间窗口。',
      '2. 对齐指标、日志与知识依据，验证候选原因。',
      '3. 记录排查结果，在故障深挖页填写交接备注。', '',
      '## 待验证', '演示无法验证真实根因；没有执行重启、扩容或回滚。'
    ].join('\n');
  }
  function answerFor(question, general) {
    if (general) return '【通用问答 · 静态演示】实际 Python 服务会直接调用聊天模型，不检索知识库。' +
      '例如 TCP 三次握手依次交换 SYN、SYN-ACK 和 ACK，以确认双方收发能力并同步序列号。' +
      '当前回答为固定示例，没有调用模型。';
    const source = sourcesFor(question)[0];
    return '【知识库优先 · 静态演示】参考示例文档 ' +
      JSON.parse(source.metadata)._file_name + '：\n\n' + source.content +
      '\n\n右侧展示模拟召回片段。完整 Python 服务使用向量模型和 Milvus 检索后，再调用聊天模型生成回答。';
  }
  function textEvents(text) {
    return (text.match(/[\s\S]{1,30}/g) || []).map(data => ({ type: 'content', data }));
  }
  window.__AIOPS_STATIC_DEMO__ = true;
  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href);
    if (url.origin !== location.origin) return nativeFetch(input, init);
    const index = url.pathname.indexOf('/api/');
    if (index < 0) return nativeFetch(input, init);
    const path = url.pathname.slice(index);
    const method = String(init.method || input?.method || 'GET').toUpperCase();
    const signal = init.signal || input?.signal;
    if (signal?.aborted) throw new DOMException('Request aborted', 'AbortError');
    let body = {};
    if (method === 'POST' && path !== '/api/upload') {
      try { body = JSON.parse(init.body || (input instanceof Request ? await input.clone().text() : '{}')); }
      catch { return json({ message: 'Invalid JSON' }, 400); }
    }
    if (path === '/api/platform/alerts' && method === 'GET') {
      return json({ alerts, mock: true, updatedAt: new Date().toISOString() });
    }
    if (path === '/api/platform/documents' && method === 'GET') return json(documents);
    if (path === '/api/platform/documents/content' && method === 'GET') {
      const name = url.searchParams.get('name');
      return Object.hasOwn(content, name) ? json({ name, content: content[name] }) : json({ message: '文档不存在' }, 404);
    }
    if (path === '/api/platform/logs' && method === 'GET') {
      const topic = url.searchParams.get('topic') || 'application-logs';
      const logs = ['WARN', 'INFO', 'ERROR'].map((level, i) => ({
        timestamp: new Date(now - (3 - i) * 60000).toISOString(), level,
        service: topic.includes('payment') ? 'payment-service' : 'order-service',
        instance: topic.includes('payment') ? 'payment-service-58d4' : 'order-service-7f9c',
        message: ['[demo] CPU load above 90%; connection wait exceeded 1200ms',
          '[demo] Health check passed; pending requests increased',
          '[demo] Downstream request timeout'][i]
      }));
      const query = (url.searchParams.get('query') || '').toLowerCase();
      const filtered = query ? logs.filter(item => JSON.stringify(item).toLowerCase().includes(query)) : logs;
      return json({ mock: true, result: { success: true, logs: filtered, total: filtered.length } });
    }
    if (path === '/api/upload') return json({ message: '静态演示不保存文件，请启动 Python 完整版后上传。' }, 409);
    if (path === '/api/platform/knowledge/stream' && method === 'POST') {
      const general = body.mode === 'general';
      return stream([{ type: 'sources', data: general ? [] : sourcesFor(body.question || '') },
        ...textEvents(answerFor(body.question || '', general)), { type: 'done', data: '' }], signal);
    }
    if (path === '/api/chat_stream' && method === 'POST') {
      return stream([...textEvents(reportFor(body.Question || '')), { type: 'done', data: '' }], signal);
    }
    return json({ message: '此 API 未纳入静态演示：' + path }, 404);
  };
  document.addEventListener('DOMContentLoaded', () => {
    const notice = document.createElement('aside');
    notice.className = 'demo-notice';
    notice.setAttribute('aria-label', '演示模式说明');
    notice.innerHTML = '<strong>Python AIOps · 静态演示</strong><span>告警、日志与回答均为模拟数据</span>' +
      '<a href="index.html">页面入口</a><a href="https://github.com/ifox-hu/aiops-py">源码与本地运行</a>';
    document.body.prepend(notice);
    const upload = document.querySelector('#kv-upload');
    if (upload) {
      upload.disabled = true;
      upload.textContent = '本地完整版可上传';
      upload.title = '静态演示不保存文件，也不建立向量索引';
    }
  });
})();

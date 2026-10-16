'use strict';
// Independent UI prototypes. All incidents, metrics, citations and answers below are illustrative.
const DESIGN = document.body.dataset.design;
const icons = {
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    pulse: '<path d="M2 12h5l3-8 4 16 3-8h5"/>',
    book: '<path d="M12 5v15M12 5C9 3 5 3 3 4v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-2-1-6-1-9 1Z"/>',
    chat: '<path d="M21 11a8 8 0 0 1-8 8H5l-3 3V11a9 9 0 0 1 19 0Z"/><path d="M7 10h10M7 14h6"/>',
    arrow: '<path d="m7 17 10-10M7 7h10v10"/>',
    send: '<path d="m5 12 7-7 7 7M12 5v15"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M15 8V4H4v11h4"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    file: '<path d="M14 3H5v18h14V8l-5-5Zm0 0v5h5M8 12h8M8 16h6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.grid}</svg>`;
const escapeHtml = text => String(text).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const button = (label, action, primary = false, glyph = '') => `<button class="btn${primary ? ' primary' : ''}" data-action="${action}">${glyph ? icon(glyph) : ''}${label}</button>`;
const brand = `<a class="brand" href="index.html" aria-label="返回三版设计方案"><span class="brand-mark">${icon('pulse')}</span><span><strong>AIOps</strong><small>智能运维与知识助手平台</small></span></a>`;
const demoBadge = `<span class="pill amber"><span class="dot"></span>交互原型 · 示例数据</span>`;
const footer = `<footer class="footer"><span>AI 辅助开发 · Apache-2.0</span><span><a href="index.html">比较三版设计</a> · <a href="http://localhost:9900/" target="_blank" rel="noopener">打开已部署应用 ↗</a></span></footer>`;
const alerts = [
    {id:'ALT-1024', level:'P1', title:'订单服务响应延迟升高', service:'order-service', metric:'P95 延迟 > 2,000 ms', time:'14:32:08', root:'数据库连接池等待时间升高', detail:'订单服务慢请求与数据库连接池等待日志在同一时间窗口出现。建议先核对连接占用情况，再检查近期慢 SQL；目前证据不足以直接认定根因。'},
    {id:'ALT-1023', level:'P2', title:'应用实例 CPU 持续偏高', service:'api-gateway', metric:'CPU 使用率 > 85%', time:'14:28:41', root:'流量峰值与 CPU 升高存在时间关联', detail:'网关 CPU 使用率升高与请求量增长同时出现。建议对比每个实例的流量分布，并检查热点接口与线程栈。'},
    {id:'ALT-1022', level:'P2', title:'容器内存接近阈值', service:'payment-service', metric:'内存使用率 > 80%', time:'14:21:16', root:'堆内存回收后仍然增长', detail:'示例日志显示 GC 后内存未完全回落。建议采集堆使用趋势，检查缓存容量和对象引用，不建议仅凭单次指标重启实例。'}
];
let selectedAlert = alerts[0];
const docs = [
    {title:'数据库连接池排查指南', tag:'故障排查', text:'检查 active / idle / pending 连接数，关注 connection timeout 日志。结合慢 SQL 与事务时长判断连接占用原因。示例文档片段，不代表实际检索结果。'},
    {title:'订单服务运维手册', tag:'服务手册', text:'先确认影响范围与告警时间窗口，再依次核对网关、应用实例和数据库。变更前记录现状与回滚方案。示例文档片段。'},
    {title:'慢 SQL 分析与优化', tag:'数据库', text:'通过执行计划识别全表扫描、索引失效和锁等待。比较问题发生前后的 SQL 耗时，避免仅根据平均响应时间作出判断。示例文档片段。'}
];
function sidebar(active = 'workbench', knowledge = false) {
    const entries = [['workbench','grid','工作台'],['incidents','pulse','告警与诊断'],['knowledge','book','知识库'],['assistant','chat','智能助手']];
    return `<aside class="sidebar">${brand}${knowledge ? button('新建对话','new-chat',true,'plus') : ''}<nav class="nav-group" aria-label="主导航"><div class="nav-label">WORKSPACE</div>${entries.map(([key,glyph,label]) => `<button class="nav-item ${key === active ? 'active' : ''}" data-action="nav-${key}">${icon(glyph)}<span>${label}</span>${key === 'incidents' ? '<span class="count">03</span>' : ''}</button>`).join('')}</nav>${knowledge ? `<div><div class="history-caption">最近对话 · 示例</div><button class="history-item active" data-action="history">数据库连接池超时如何排查？</button><button class="history-item" data-action="history">整理一次服务延迟排查流程</button></div>` : `<div class="nav-group secondary"><div class="nav-label">RESOURCES</div><button class="nav-item" data-action="report">${icon('file')}<span>诊断报告</span></button><button class="nav-item" data-action="about">${icon('book')}<span>项目说明</span></button></div>`}<div class="sidebar-bottom"><div class="profile"><div class="avatar">OP</div><div><strong style="font-size:11px">运维演示空间</strong><small>本地演示 / 设计预览</small></div></div></div></aside>`;
}
function topbar(label) { return `<header class="topbar"><span class="product-name">AIOps 智能运维与知识助手平台</span><div class="top-actions">${demoBadge}<a class="design-link" href="index.html">${label} · 返回预览 ↗</a></div></header>`; }
function alertRows(filter = 'all') {
    return alerts.filter(alert => filter === 'all' || alert.level === filter).map(alert => `<button class="alert-row ${selectedAlert?.id === alert.id ? 'selected' : ''}" data-alert="${escapeHtml(alert.id)}" aria-pressed="${selectedAlert?.id === alert.id}"><span class="alert-level ${escapeHtml(alert.level.toLowerCase())}">${escapeHtml(alert.level)}</span><span class="alert-info"><strong>${escapeHtml(alert.title)}</strong><p><span class="mono">${escapeHtml(alert.service)}</span> · ${escapeHtml(alert.metric)}</p></span><time class="alert-time">${escapeHtml(alert.time)}</time></button>`).join('');
}
function docRows() {return docs.map((doc,index) => `<div class="doc-row"><span class="doc-icon">MD</span><div class="doc-copy"><strong>${doc.title}</strong><small>${doc.tag} · 已索引（示例）</small></div><button class="text-btn" data-source="${index}" aria-label="查看${doc.title}">查看 ↗</button></div>`).join('');}
function workbench() {
    return `<div class="app-shell">${sidebar()}<div class="workspace">${topbar('工作台')}<main class="content"><div class="page-heading"><div><div class="eyebrow" style="margin-bottom:5px">OPERATIONS OVERVIEW</div><h1>把异常，变成可行动的线索。</h1><p>查看告警、关联日志，并从运维知识库中找到处理依据。</p></div><div class="heading-actions">${button('上传知识文档','upload',false,'upload')}${button('开始智能诊断','diagnose',true,'pulse')}</div></div>
    <section class="stats" aria-label="示例运行概览"><article class="panel stat"><div class="stat-label">待处理告警 ${icon('pulse')}</div><div class="stat-value">03<small>条</small></div><div class="stat-foot"><span style="color:var(--red)">1 条 P1</span> · 2 条 P2</div></article><article class="panel stat"><div class="stat-label">已索引知识文档 ${icon('book')}</div><div class="stat-value">05<small>篇</small></div><div class="stat-foot">运维手册与常见故障指南</div></article><article class="panel stat"><div class="stat-label">本次诊断证据 ${icon('file')}</div><div class="stat-value">03<small>项</small></div><div class="stat-foot">指标 · 日志 · 知识文档</div></article><article class="panel stat"><div class="stat-label">服务延迟趋势 <div class="spark" aria-hidden="true">${[7,11,9,15,13,19,24,18,12,10].map(height => `<i style="height:${height}px"></i>`).join('')}</div></div><div class="stat-value">2.4<small>s / P95</small></div><div class="stat-foot">order-service · 最近 30 分钟（示例）</div></article></section>
    <div class="work-grid"><section class="panel"><div class="panel-head"><h2>${icon('pulse')}需要关注的告警 <span class="pill">03</span></h2><span class="muted">示例时间 14:35</span></div><div class="section-row" role="group" aria-label="按告警等级筛选"><button class="filter active" data-filter="all">全部告警</button><button class="filter" data-filter="P1">P1 · 严重</button><button class="filter" data-filter="P2">P2 · 警告</button></div><div id="alert-list">${alertRows()}</div><div class="panel-bottom"><span>点击告警，查看对应诊断建议</span><span class="mono">3 / 3</span></div></section>
    <section class="panel"><div class="panel-head"><h2>${icon('chat')}AI 诊断摘要</h2><span class="pill green">示例分析完成</span></div><div class="diagnosis-body"><div class="diagnosis-intro"><span class="ai-badge">AI</span><span id="diagnosis-title">${selectedAlert.title}</span></div><div class="steps"><span class="step done">✓ 获取告警</span><i class="step-line"></i><span class="step done">✓ 关联日志</span><i class="step-line"></i><span class="step done">✓ 检索知识</span></div><div class="result-box"><h3 id="diagnosis-root">${selectedAlert.root}</h3><p id="diagnosis-detail">${selectedAlert.detail}</p><button class="evidence-link" data-action="evidence">${icon('file')}查看 3 项诊断依据 ↗</button></div><div class="suggestion">${icon('book')}建议由值班人员核对证据后，按排查手册处理。</div><div class="diagnosis-actions">${button('查看完整报告','report',true)}${button('继续追问','ask')}</div></div></section></div>
    <div class="lower-grid"><section class="panel"><div class="panel-head"><h2>运维知识库</h2><button class="text-btn" data-action="nav-knowledge">查看全部 ↗</button></div>${docRows()}</section><section class="panel"><div class="quick-assistant"><div class="eyebrow">ASK YOUR OPERATIONS ASSISTANT</div><h2 style="margin-top:7px">把问题交给知识助手</h2><p>从排查步骤到处理依据，用自然语言找到答案。</p><form class="composer-inline" data-chat-form><input name="question" aria-label="输入运维问题" placeholder="例如：数据库连接池超时怎么排查？" required maxlength="1000"><button class="btn primary" type="submit">${icon('arrow')}提问</button></form></div></section></div>${footer}</main></div></div>`;
}
function incident() {
    return `<div class="app-shell">${sidebar('incidents')}<div class="workspace incident-shell"><header class="incident-topbar"><div class="incident-brand"><span class="product-name">AIOps 智能运维与知识助手平台</span><nav class="horizontal-nav" aria-label="主导航"><button class="active" data-action="nav-incidents">故障指挥台</button><button data-action="nav-knowledge">运维知识库</button><button data-action="report">诊断报告</button></nav></div><div class="top-actions">${demoBadge}<a class="design-link" href="index.html">故障详情 · 页面预览 ↗</a></div></header><main class="incident-content"><div class="incident-breadcrumb">AIOps / 智能运维与知识助手平台 / INCIDENT-1024</div><div class="incident-heading"><div><span class="pill red">P1 · 处理中</span><h1>订单服务响应延迟升高</h1><div class="incident-meta"><span class="mono">order-service</span><span>示例环境 · 3 个实例</span><span class="mono">14:32:08 首次触发</span></div></div><div class="heading-actions">${button('导出诊断报告','export',false,'file')}${button('重新分析','diagnose',true,'pulse')}</div></div>
    <div class="incident-grid"><section class="panel"><div class="panel-head"><h2>事件时间线</h2><span class="pill">示例</span></div><div class="timeline"><article class="timeline-item"><time>14:25:00</time><h3>订单服务发布</h3><p>版本 v1.8.3 部署完成</p></article><article class="timeline-item"><time>14:32:08</time><h3>P95 延迟触发告警</h3><p>阈值 2,000 ms，持续 3 分钟</p></article><article class="timeline-item"><time>14:32:15</time><h3>开始关联分析</h3><p>拉取指标和相关日志</p></article><article class="timeline-item current"><time>14:33:26</time><h3>生成诊断建议</h3><p>等待值班人员验证</p></article></div></section>
    <div class="incident-center"><section class="panel"><div class="panel-head"><h2>指标关联</h2><span class="muted mono">14:10 — 14:40 · 示例</span></div><div class="metrics-row"><div class="metric-item"><small>P95 响应时间</small><strong class="danger">2,400 <span style="font-size:10px">ms</span></strong><small>告警阈值 2,000 ms</small></div><div class="metric-item"><small>连接池等待数</small><strong>24</strong><small>与延迟同步升高</small></div><div class="metric-item"><small>请求错误率</small><strong class="danger">3.8<span style="font-size:10px">%</span></strong><small>基线 0.2%（示例）</small></div></div><div class="chart"><svg viewBox="0 0 600 130" role="img" aria-label="示例趋势图：发布之后服务延迟与连接池等待数均上升"><defs><linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#315ce8" stop-opacity=".16"/><stop offset="1" stop-color="#315ce8" stop-opacity="0"/></linearGradient></defs><path d="M0 25H600M0 65H600M0 105H600" stroke="#e5eaf1" stroke-width="1"/><path d="M335 4V124" stroke="#68778c" stroke-dasharray="3 5"/><text x="344" y="15" fill="#68778c" font-size="9">14:25 发布</text><path d="M0 105 30 100 60 105 90 97 120 102 150 96 180 100 210 98 240 94 270 97 300 91 330 86 360 68 390 48 420 27 450 37 480 22 510 31 540 24 570 30 600 26V130H0Z" fill="url(#area)"/><path d="M0 105 30 100 60 105 90 97 120 102 150 96 180 100 210 98 240 94 270 97 300 91 330 86 360 68 390 48 420 27 450 37 480 22 510 31 540 24 570 30 600 26" fill="none" stroke="#315ce8" stroke-width="2"/><path d="M0 118 60 115 120 117 180 112 240 116 300 108 330 105 360 90 390 73 420 60 450 55 480 57 510 49 540 57 570 46 600 50" fill="none" stroke="#8aabef" stroke-width="1.5"/></svg><div class="chart-labels"><span>14:10</span><span style="color:var(--accent)">— 响应延迟</span><span style="color:#8aabef">— 连接池等待</span><span>14:40</span></div></div></section>
    <section class="panel"><div class="panel-head"><h2>关联日志</h2><button class="text-btn" data-action="logs">展开日志 ↗</button></div><div class="terminal"><div><span class="log-time">14:32:10.024</span> <span class="log-error">ERROR</span> Connection is not available</div><div><span class="log-time">14:32:10.025</span> request timed out after 30000ms</div><div><span class="log-time">14:32:12.118</span> <span class="log-warn">WARN </span> HikariPool — pending threads: 24</div><div><span class="log-time">14:32:14.332</span> <span class="log-warn">WARN </span> Slow query: duration=2840ms</div><div><span class="log-time">14:32:15.009</span> trace=demo-a72f service=order-service</div></div><div class="panel-bottom"><span>以上为演示日志，未连接生产日志服务</span><span>5 行</span></div></section></div>
    <aside class="incident-right"><section class="panel"><div class="panel-head"><h2>${icon('chat')}AI 根因假设</h2></div><div class="hypothesis"><span class="pill green">待验证</span><h3 style="margin-top:13px">连接池耗尽引发请求阻塞</h3><p>连接池等待数与响应延迟同时上升，日志出现连接获取超时。慢 SQL 或长事务可能导致连接长期占用。</p><div class="confidence"><span>证据关联度 · 示例评分</span><span class="mono">78 / 100</span></div><div class="confidence-bar"><span></span></div><button class="evidence-link" data-action="evidence">查看依据与不确定项 ↗</button></div><div class="safe-note">关联度不代表根因概率。需要结合真实指标、日志和变更记录核验。</div></section>
    <section class="panel"><div class="panel-head"><h2>建议排查顺序</h2></div><div class="runbook-list"><button class="runbook" data-source="0"><span style="color:var(--accent)">01</span> 检查连接池占用<small>核对 active / idle / pending 连接数 ↗</small></button><button class="runbook" data-source="2"><span style="color:var(--accent)">02</span> 定位慢 SQL 与长事务<small>结合执行计划与锁等待分析 ↗</small></button><button class="runbook" data-source="1"><span style="color:var(--accent)">03</span> 比较发布前后差异<small>确认影响范围，准备回滚方案 ↗</small></button></div><div class="safe-note">仅提供排查建议，不自动执行变更。</div></section></aside></div>
    <form class="incident-command" data-chat-form><span class="command-prefix">›_</span><input name="question" aria-label="输入故障追问" placeholder="继续追问：如何判断是连接池配置问题还是慢 SQL？" required maxlength="1000"><span class="pill">示例问答</span><button class="btn primary" type="submit">询问助手 ${icon('arrow')}</button></form>${footer}</main></div></div>`;
}
const sampleAnswer = `<p>建议沿着 <strong>连接占用 → SQL 与事务 → 配置与变更</strong> 的顺序排查。连接池超时通常意味着请求没能在规定时间内获取到可用连接。</p><h3>1. 先确认连接池的真实状态</h3><p>检查 <code>active</code>、<code>idle</code> 和 <code>pending</code>。如果活跃连接长期达到上限、等待队列持续增长，优先查找长时间占用连接的操作。</p><button class="source-chip" data-source="0">[1] 数据库连接池排查指南 ↗</button><h3>2. 定位慢 SQL 与长事务</h3><p>对照告警时间窗口中的慢查询日志，检查锁等待和执行计划。关注连接是否在异常路径中正确释放。</p><button class="source-chip" data-source="2">[2] 慢 SQL 分析与优化 ↗</button><h3>3. 核对近期发布与配置变更</h3><p>比较发布前后的请求量和连接池配置。盲目扩大连接池可能增加数据库负担，应先确认数据库承载能力。</p><div class="answer-notice">以上为设计原型中的示例回答和引用。正式接入后，应展示实际检索文档与依据。</div>`;
function knowledge() {
    return `<div class="knowledge-shell">${sidebar('assistant',true)}<div class="workspace">${topbar('知识问答')}<main class="knowledge-body"><section class="conversation"><div class="conversation-header"><div class="eyebrow" style="margin-bottom:6px">KNOWLEDGE, WITH CONTEXT</div><h1>每个答案，都有迹可循。</h1><p>面向运维场景的知识助手，让排查经验成为随时可用的依据。</p></div><div class="chat-scroll" id="chat-scroll"><article class="user-question"><p>数据库连接池获取连接超时，应该按什么顺序排查？</p></article><article class="assistant-answer"><div class="answer-header"><span class="ai-badge">AI</span>知识助手 <span class="pill">示例回答</span></div><div class="answer-text">${sampleAnswer}<div class="answer-controls"><button class="icon-btn" data-action="copy" aria-label="复制回答">${icon('copy')}</button><button class="text-btn" data-action="feedback">有帮助</button><small>引用 2 篇示例文档</small></div></div></article></div><div class="chat-composer-area"><div class="prompt-chips"><button class="prompt-chip" data-prompt="整理一份连接池超时排查清单">整理排查清单</button><button class="prompt-chip" data-prompt="慢 SQL 和连接池超时有什么关系？">解释慢 SQL 的影响</button><button class="prompt-chip" data-prompt="如何判断是否需要调整连接池大小？">判断是否需要调整配置</button></div><form class="chat-composer" data-chat-form><textarea name="question" aria-label="输入知识库问题" placeholder="描述你的问题，或补充日志与故障现象…" required maxlength="1000"></textarea><div class="composer-bottom"><div class="composer-tools"><button class="text-btn" type="button" data-action="upload">${icon('plus')}添加文档</button><span class="pill">运维知识库 · 示例</span></div><button class="send-square" type="submit" aria-label="发送问题">${icon('send')}</button></div></form><p class="composer-note">设计交互演示 · 不连接模型 · <a href="http://localhost:9900/" target="_blank" rel="noopener">体验已部署应用 ↗</a></p></div></section><aside class="sources-pane"><h2>本次回答的来源</h2><p class="muted">示例引用，点击查看文档片段</p>${[0,2].map((index,position) => `<button class="source-card" data-source="${index}"><span class="source-index">SOURCE 0${position+1} / MARKDOWN</span><h3>${docs[index].title}</h3><p>${docs[index].text.split('。')[0]}。</p><div class="source-meta">${docs[index].tag} · 示例片段 ↗</div></button>`).join('')}<div class="retrieval-meta"><h2>检索上下文</h2><p><span>检索方式</span><span>向量检索（设计示意）</span></p><p><span>候选文档</span><span class="mono">5 篇 / 示例</span></p><p><span>回答引用</span><span class="mono">2 篇 / 示例</span></p><p style="margin-top:18px;line-height:1.8">正式接入后展示真实检索结果，不使用演示评分。</p></div></aside></main></div></div>`;
}
document.getElementById('app').innerHTML = ({workbench,incident,knowledge}[DESIGN] || workbench)();
let toastTimer;
function toast(message) {
    document.querySelector('.toast')?.remove();
    const node = document.createElement('div'); node.className = 'toast'; node.setAttribute('role','status'); node.textContent = message; document.body.append(node);
    clearTimeout(toastTimer); toastTimer = setTimeout(() => node.remove(), 4000);
}
let previousFocus;
function closeModal() {document.querySelector('.modal-overlay')?.remove(); previousFocus?.focus();}
function modal(title, content) {
    closeModal(); previousFocus = document.activeElement;
    const overlay = document.createElement('div'); overlay.className = 'modal-overlay';
    overlay.innerHTML = `<section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-heading"><h2 id="modal-title">${escapeHtml(title)}</h2><button class="icon-btn" data-action="close-modal" aria-label="关闭弹窗">${icon('close')}</button></div>${content}</section>`;
    overlay.addEventListener('click',event => {if(event.target === overlay) closeModal();}); document.body.append(overlay); overlay.querySelector('button').focus();
}
function sourceModal(index) {const doc = docs[index]; if(doc) modal(doc.title, `<span class="pill">${doc.tag} · 示例文档</span><div class="result-box"><p>${escapeHtml(doc.text)}</p></div><p>此片段用于展示引用与来源交互，不是后端实际检索结果。</p>`);}
function reportText() {return `# AIOps 示例诊断报告\n\n> 设计原型中的示例数据，不是生产系统分析结果。\n\n## 告警\n${selectedAlert.title} / ${selectedAlert.service}\n\n## 根因假设\n${selectedAlert.root}\n\n${selectedAlert.detail}\n\n## 验证步骤\n1. 对照告警时间窗口核对指标。\n2. 检查相关日志与发布记录。\n3. 结合运维手册验证假设。\n\n仅提供排查建议，不执行运维变更。\n`;}
function exportReport() {const blob = new Blob([reportText()],{type:'text/markdown;charset=utf-8'}); const url = URL.createObjectURL(blob); const link = document.createElement('a');link.href=url;link.download='AIOps-示例诊断报告.md';link.click();setTimeout(() => URL.revokeObjectURL(url),1000);toast('已导出示例报告');}
let diagnosing = false;
async function diagnose() {
    if(diagnosing) return; diagnosing = true;
    const buttons = [...document.querySelectorAll('[data-action="diagnose"]')]; const labels = buttons.map(node => node.innerHTML);
    buttons.forEach(node => {node.disabled=true;node.textContent='演示分析中…';});
    toast('演示流程：关联告警 → 查询日志 → 检索知识');
    await new Promise(resolve => setTimeout(resolve,1400));
    buttons.forEach((node,index) => {node.disabled=false;node.innerHTML=labels[index];});diagnosing=false;
    modal('示例诊断已完成',`<span class="pill">${selectedAlert.level} · ${escapeHtml(selectedAlert.service)}</span><div class="result-box"><h3>${escapeHtml(selectedAlert.root)}</h3><p>${escapeHtml(selectedAlert.detail)}</p></div><p>本次为原型交互演示，不代表模型实时分析结果。</p><div class="modal-actions">${button('查看诊断依据','evidence')}${button('导出示例报告','export',true)}</div>`);
}
const actions = {
    'close-modal':closeModal,
    'nav-workbench':() => {location.href='workbench.html';},
    'nav-incidents':() => {location.href='incident.html';},
    'nav-assistant':() => {location.href='knowledge.html';},
    'nav-knowledge':() => modal('运维知识库',`<p>已索引文档的呈现示例。点击文档可查看片段。</p>${docRows()}<div class="modal-actions">${button('添加文档','upload',true,'upload')}</div>`),
    about:() => modal('关于本项目',`<p>AIOps 智能运维与知识助手平台</p><p>本项目采用 AI 辅助开发，使用 Apache-2.0 许可。本组页面为三版 UI 设计原型。</p><p>核心能力包括：Agent 对话、工具调用、Milvus 知识检索、智能运维分析、模型接入适配、本地向量化部署、连接与超时处理，以及页面设计探索。</p><p>此处为交互预览；告警、图表、引用与回答均为示例。点击“打开已部署应用”可体验现有真实接口。</p>`),
    report:() => modal('诊断报告 · 示例',`<span class="pill">${selectedAlert.id}</span><div class="result-box"><h3>${escapeHtml(selectedAlert.title)}</h3><p>${escapeHtml(selectedAlert.detail)}</p></div><h3>下一步排查</h3><ul><li>核对告警时间窗口中的指标和日志。</li><li>比较近期发布与配置变更。</li><li>验证根因假设后，由值班人员决定处理方案。</li></ul><p>本报告为设计演示，未对真实服务执行诊断或变更。</p><div class="modal-actions">${button('导出 Markdown','export',true,'file')}</div>`),
    evidence:() => modal('诊断依据与不确定项',`<div class="result-box"><h3>01 / 指标 · 示例</h3><p>P95 延迟与连接池等待数在同一时间窗口升高。</p></div><div class="result-box"><h3>02 / 日志 · 示例</h3><p>Connection is not available；pending threads: 24。</p></div><div class="result-box"><h3>03 / 运维知识</h3><p>连接池排查指南建议优先核对长事务与慢 SQL。</p><button class="evidence-link" data-source="0">查看文档片段 ↗</button></div><p>尚未验证：数据库负载、锁等待、连接泄漏与发布影响。相关性不足以证明因果关系。</p>`),
    logs:() => modal('关联日志 · 示例',`<p class="mono">14:32:10 ERROR Connection is not available\n14:32:10 request timed out after 30000ms\n14:32:12 WARN HikariPool — pending threads: 24\n14:32:14 WARN Slow query: duration=2840ms\n14:32:15 trace=demo-a72f service=order-service</p><p>未连接生产日志服务。此日志仅用于展示故障分析工作流。</p>`),
    export:exportReport,
    diagnose,
    ask:() => {location.href='knowledge.html';},
    upload:() => modal('添加知识文档 · 交互演示',`<p>正式应用支持上传 Markdown / TXT 文档后进行切片与向量化。此预览仅显示文件选择结果。</p><input type="file" id="demo-file" accept=".md,.markdown,.txt" aria-label="选择知识文档"><p id="file-result" role="status">尚未选择文档</p><p>需要真实上传与索引，请使用已部署应用中的上传入口。</p>`),
    'new-chat':() => {const chat=document.getElementById('chat-scroll'); if(chat) {chat.innerHTML='<div class="result-box"><h3>新的知识问答</h3><p>输入运维问题体验示例交互。原型不连接模型。</p></div>';document.querySelector('textarea')?.focus();}},
    history:() => {location.reload();},
    feedback:() => toast('已收到你的示例反馈'),
    copy:async () => {try {await navigator.clipboard.writeText(document.querySelector('.answer-text')?.innerText || '');toast('回答已复制');} catch {toast('浏览器无法访问剪贴板，请选中文本复制');}}
};
document.addEventListener('click',event => {
    const target = event.target.closest('button'); if(!target) return;
    if(target.dataset.action) actions[target.dataset.action]?.();
    if(target.dataset.source !== undefined) sourceModal(Number(target.dataset.source));
    if(target.dataset.filter) {
        document.querySelectorAll('[data-filter]').forEach(node => {node.classList.toggle('active',node===target);node.setAttribute('aria-pressed',String(node===target));});
        document.getElementById('alert-list').innerHTML=alertRows(target.dataset.filter);
    }
    if(target.dataset.alert) {
        selectedAlert=alerts.find(alert => alert.id===target.dataset.alert);
        document.querySelectorAll('[data-alert]').forEach(node => {node.classList.toggle('selected',node===target);node.setAttribute('aria-pressed',String(node===target));});
        document.getElementById('diagnosis-title').textContent=selectedAlert.title;
        document.getElementById('diagnosis-root').textContent=selectedAlert.root;
        document.getElementById('diagnosis-detail').textContent=selectedAlert.detail;
    }
    if(target.dataset.prompt) {const input=document.querySelector('textarea[name="question"]');input.value=target.dataset.prompt;input.focus();}
});
document.addEventListener('keydown',event => {
    const overlay=document.querySelector('.modal-overlay');
    if(overlay && event.key==='Escape') closeModal();
    if(overlay && event.key==='Tab') {const nodes=[...overlay.querySelectorAll('button,a,input,textarea')].filter(node=>!node.disabled);const first=nodes[0],last=nodes.at(-1);if(event.shiftKey && document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first.focus();}}
    if(event.target.matches('textarea[name="question"]') && event.key==='Enter' && !event.shiftKey && !event.isComposing) {event.preventDefault();event.target.closest('form').requestSubmit();}
});
document.addEventListener('change',event => {if(event.target.id==='demo-file') {const file=event.target.files[0];document.getElementById('file-result').textContent=file ? `已选择 ${file.name}（${Math.ceil(file.size/1024)} KB）。原型不会上传该文件。` : '尚未选择文档';}});
document.addEventListener('submit',event => {
    if (window.platformLive) return;
    const form=event.target.closest('[data-chat-form]');if(!form)return;event.preventDefault();
    const input=form.elements.question;const question=input.value.trim();if(!question)return;
    if(DESIGN!=='knowledge') {modal('知识助手 · 示例问答',`<div class="result-box"><h3>${escapeHtml(question)}</h3><p>此处为交互示例。正式应用会根据提问检索知识库，并结合上下文生成回答。</p></div><p>你可以进入知识助手方案查看带来源引用的完整回答结构。</p><div class="modal-actions">${button('打开知识助手','ask',true)}</div>`);return;}
    const chat=document.getElementById('chat-scroll');
    chat.insertAdjacentHTML('beforeend',`<article class="user-question"><p>${escapeHtml(question)}</p></article><article class="assistant-answer"><div class="answer-header"><span class="ai-badge">AI</span>知识助手 <span class="pill">演示回复</span></div><div class="answer-text"><p>已收到你的问题。这是界面原型，不会调用模型。</p><p>针对连接池排查，建议先检查活跃连接和等待队列，再关联慢 SQL、长事务与变更记录。其他问题请在已部署应用中获取实际回答。</p><button class="source-chip" data-source="0">查看示例排查指南 ↗</button><div class="answer-notice">上方为固定演示内容，不是根据问题检索生成的结果。</div></div></article>`);
    input.value='';chat.scrollTop=chat.scrollHeight;
});

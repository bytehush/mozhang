/* AI 军师对话模块：Agent 循环 + 流式打字机聊天
   方法（五层）：
   1) 传输：POST /api/ai {stream:true} → 本地服务器 SSE 透传 → fetch 流读取
   2) 节奏：网络块先进平滑缓冲器，渲染循环自适应匀速取出——观感始终是打字机，
      网络快则出字快、网络慢也不卡顿，不会出现"干等几十秒"
   3) 渲染：每帧把已显示原文整体过迷你 Markdown 渲染器（先转义再解析，安全），
      末尾挂闪烁光标
   4) Agent 循环（V0.10.0）：数据不再预先塞进提示词，而是把"查账本"封装成工具
      （js/aitools.js）——模型自主决策是否调用（寒暄不查、数据问题必查），本地
      执行后把结果回喂，最多 AGENT_ROUNDS 轮工具调用，随后强制作答；工具调用
      以折叠卡片内联展示在回答上方（点击展开真实查询结果，参照 ZCode 风格）
   5) 会话与记忆：每本账多会话（独立历史/状态/存储，活动指针按账本记忆）；
      长对话用"滚动摘要"——本地全量保留，发给模型时 = 人设 + 账本目录 + 工具
      规则 + 旧对话滚动摘要 + 最近若干条原文，摘要由模型后台自动压缩更新 */
(function () {
  'use strict';

  const SESSION_MSG_CAP = 80; // 每个会话最多保留的消息条数（本地全量，供摘要滚动压缩）
  const CTX_TURNS = 8;        // 发给模型的最近上下文条数（原文窗口）
  const MSG_CAP = 4000;       // 单条上下文截断长度
  const SUM_TRIG = 6;         // 超出原文窗口多少条时触发滚动摘要
  const AGENT_ROUNDS = 3;     // Agent 循环最多几轮工具调用（之后强制作答，防止无限循环）
  const TOOL_TEXT_CAP = 1600; // 工具结果持久化到历史时的截断长度（控制 localStorage 体积）

  let listEl, scrollEl, inputEl, sendBtn, stopBtn, emptyEl, jumpBtn;
  let msgs = [];              // 当前账本的聊天历史 [{role, content}]
  let storeLedgerId = null;   // 历史所属账本
  let streaming = false;
  let controller = null;
  let active = null;          // { typer, bubble, el } 当前流式交换
  let userStopped = false;    // 区分「用户手动停止」与「看门狗超时」
  let sessions = [];          // 当前账本的会话列表
  let sessionId = null;       // 当前会话 id
  let summarizeBusy = false;  // 滚动摘要后台压缩中
  let thinkStart = 0;         // 本轮思考开始时刻（思考行显示"思考 · N 秒"用）
  let tlEl = null;            // 回合时间线（右侧锚点列）
  // 已知不支持工具调用的模型（本会话记忆）：命中后直接走"数据直读"模式，不再反复试探
  const toolIncapableModels = new Set();
  // 伪工具调用特征：模型不支持 function calling 时会把"调用"写进正文
  // （如"我去调取数据。get_ledger {"name":"…"}" 或裸写 tool_calls/JSON 参数）
  const FAKE_TOOL_RE = /\{\s*"name"\s*:|\b(?:get_ledger|get_stats|get_daily|get_day_records|list_ledgers|create_ledger)\b\s*[\(\n{]|tool_calls/;

  // ---------- 工具（公共版在 js/utils.js） ----------
  const { $, esc, uid, wait, toast, REDUCED } = window.UTIL;
  // 极简 Markdown 渲染（先转义再解析，流式半截语法只是短暂原样显示）
  function renderMarkdown(md) {
    const lines = esc(md).split(/\r?\n/);
    const out = [];
    let inList = false;
    const closeList = () => { if (inList) { out.push(`</${inList}>`); inList = null; } };
    const inline = s => s
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    lines.forEach(raw => {
      const line = raw.trimEnd();
      if (/^#{1,3}\s/.test(line)) {
        closeList();
        const level = line.match(/^#+/)[0].length;
        out.push(`<h${level}>${inline(line.replace(/^#+\s*/, ''))}</h${level}>`);
      } else if (/^\s*[-*·]\s+/.test(line)) {
        if (inList !== 'ul') { closeList(); out.push('<ul>'); inList = 'ul'; }
        out.push(`<li>${inline(line.replace(/^\s*[-*·]\s+/, ''))}</li>`);
      } else if (/^\s*\d+[.、)]\s+/.test(line)) {
        if (inList !== 'ol') { closeList(); out.push('<ol>'); inList = 'ol'; }
        out.push(`<li>${inline(line.replace(/^\s*\d+[.、)]\s+/, ''))}</li>`);
      } else if (line.trim() === '') {
        closeList();
      } else {
        closeList();
        out.push(`<p>${inline(line)}</p>`);
      }
    });
    closeList();
    return out.join('\n');
  }

  // ---------- 会话存取（每账本多会话；会话对象自带 messages，删会话即删数据，无孤儿键） ----------
  const sessKey = () => 'jigong_sessions_' + storeLedgerId;
  const legacyChatKey = () => 'jigong_chat_' + storeLedgerId;
  const actKey = () => 'jigong_active_session_' + storeLedgerId;
  function newSessionObj(title) {
    return { id: uid(), title, createdAt: Date.now(), updatedAt: Date.now(),
      summary: '', summarizedCount: 0, messages: [] };
  }
  function loadSessions() {
    try { return JSON.parse(localStorage.getItem(sessKey())) || []; } catch { return []; }
  }
  function saveSessionsStore() { localStorage.setItem(sessKey(), JSON.stringify(sessions)); }
  function currentSession() { return sessions.find(x => x.id === sessionId) || null; }
  function saveSessionMsgs() {
    const sx = currentSession();
    if (!sx) return;
    sx.messages = msgs.slice(-SESSION_MSG_CAP);
    sx.updatedAt = Date.now();
    saveSessionsStore();
  }
  function fmtTime(ts) {
    const d = new Date(ts), now = new Date();
    const hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    const md = (d.getMonth() + 1) + '月' + d.getDate() + '日';
    return d.toDateString() === now.toDateString() ? hm : md + ' ' + hm;
  }


  // ---------- 渲染 ----------
  // 用户消息与 AI 同构：头像+名头行在上，内容向下（头像朱砂「我」区分身份）
  function userBubble(text) {
    const wrap = document.createElement('div');
    wrap.className = 'chat-msg me';
    wrap.innerHTML = `
      <div class="cm-headrow">
        <div class="cm-avatar me">我</div>
        <span class="cm-name me">我</span>
      </div>
      <div class="cm-bubble">${esc(text).replace(/\n/g, '<br>')}</div>`;
    return wrap;
  }
  function aiBubble() {
    const wrap = document.createElement('div');
    wrap.className = 'chat-msg ai';
    wrap.innerHTML = `
      <div class="cm-headrow">
        <div class="cm-avatar" data-icon="nav-ai" data-fallback="🎴"></div>
        <span class="cm-name">AI 军师</span>
      </div>
      <div class="cm-body">
        <div class="cm-acts hidden"></div>
        <div class="cm-bubble"></div>
      </div>`;
    if (window.JGIcons) window.JGIcons.mount(wrap);
    return wrap;
  }
  // ---------- 引用溯源：把回答里的每个数字反向定位到账本的具体记录（可点击跳转核对） ----------
  const TRACE_FIELDS = {
    hourly: [
      ['nRate', '正常时薪', 'money'], ['oRate', '加班时薪', 'money'],
      ['nHours', '正常工时', 'hours'], ['oHours', '加班工时', 'hours'], ['totalHours', '总工时', 'hours'],
      ['nPay', '正常工资', 'money'], ['oPay', '加班费', 'money'], ['totalPay', '工资', 'money'],
    ],
    piece: [['count', '完成件数', 'count'], ['price', '单价', 'money'], ['pay', '工钱', 'money']],
    general: [['income', '收入', 'money'], ['expense', '支出', 'money'], ['net', '结余', 'money']],
  };
  const traceEps = (a, b) => Math.abs(a - b) < 0.005;
  // 提取回答中引用的数字（带单位；跳过日期、年份与列表序号），最多 14 条防窗口爆炸
  function extractNumRefs(text) {
    const clean = String(text)
      .replace(/[*_`#>]/g, ' ')
      .replace(/\d{4}-\d{1,2}-\d{1,2}/g, ' ')
      .replace(/\b(19|20)\d{2}\b/g, ' ');
    const seen = [];
    const re = /(\d+(?:\.\d+)?)(\s*(?:元|块|小时|h|件|条|天))?/g;
    let m;
    while ((m = re.exec(clean)) !== null && seen.length < 14) {
      const value = parseFloat(m[1]);
      const unit = (m[2] || '').trim();
      if (!isFinite(value)) continue;
      const after = clean.slice(m.index + m[0].length, m.index + m[0].length + 2);
      if (!unit && /^[.、)]/.test(after)) continue;         // "1." 列表序号
      if (seen.some(x => x.value === value && x.unit === unit)) continue;
      seen.push({ value, unit, quote: m[1] + (unit ? ' ' + unit : '') });
    }
    return seen;
  }
  // 归因：数字 → 账本原数（哪条记录哪个字段）/ 合计·推算 / 统计聚合 / 无匹配
  function traceRefs(answerText, toolCalls) {
    const refs = extractNumRefs(answerText);
    if (!refs.length) return [];
    const JG = window.JG;
    // 本次交换涉及的账本（工具参数里的 ledger；没传默认当前账本）
    const involved = new Map();
    (toolCalls || []).forEach(tc => {
      const nm = tc.args && tc.args.ledger;
      const all = JG.getLedgers() || [];
      let led = null;
      if (nm) led = all.find(l => l.name === nm) || all.find(l => l.name.includes(nm) || String(nm).includes(l.name));
      if (led) involved.set(led.id, led);
    });
    if (!involved.size) { const led = JG.getActiveLedger(); if (led) involved.set(led.id, led); }
    // 先为每个账本的每个数值字段建数字池（一次构建，全部数字复用）
    const pools = [];
    const activeId = (JG.getActiveLedger() || {}).id;
    involved.forEach(led => {
      const recs = led.id === activeId ? JG.getRecords() : (window.STORE.loadLedRecords(led.id) || []);
      (TRACE_FIELDS[led.templateId] || []).forEach(([key, label, kind]) => {
        const items = [];
        recs.forEach(r => {
          const v = r.v[key] != null ? Number(r.v[key]) : (r.m ? Number(r.m[key]) : NaN);
          if (isFinite(v)) items.push({ ledgerId: led.id, ledgerName: led.name, recId: r.id, date: r.v.date, label, value: v });
        });
        if (items.length) pools.push({ key, label, kind, ledgerId: led.id, ledgerName: led.name, items });
      });
    });
    return refs.map(ref => {
      const unitOk = k => !ref.unit ||
        (k === 'money' && /元|块/.test(ref.unit)) ||
        (k === 'hours' && /小时|h/.test(ref.unit)) ||
        (k === 'count' && /件|条|天/.test(ref.unit)) ||
        (ref.unit === '天' && k === 'count');
      // ① 账本原数：某条记录的某字段恰好等于这个数
      const hits = [];
      pools.filter(p => unitOk(p.kind)).forEach(p => p.items.forEach(it => {
        if (traceEps(it.value, ref.value)) hits.push(it);
      }));
      if (hits.length) {
        hits.sort((a, b) => String(a.date).localeCompare(String(b.date)));
        return Object.assign({}, ref, { kind: 'hit', items: hits.slice(0, 8), hitTotal: hits.length });
      }
      // ② 合计 / 平均：整字段聚合恰好等于这个数（推算值，列出构成）
      for (const p of pools.filter(p => unitOk(p.kind))) {
        if (p.items.length < 2) continue;
        const sum = p.items.reduce((s, it) => s + it.value, 0);
        if (traceEps(sum, ref.value)) return Object.assign({}, ref, { kind: 'sum', items: p.items.slice(0, 8), fieldLabel: p.label });
        if (traceEps(sum / p.items.length, ref.value)) return Object.assign({}, ref, { kind: 'avg', items: p.items.slice(0, 8), fieldLabel: p.label });
      }
      // ③ 统计聚合：数字确实出现在某工具返回的 JSON 里（如"记录天数": 3）
      const raw = (toolCalls || []).find(tc => tc.resultText &&
        new RegExp('":\\s*' + String(ref.value).replace('.', '\\.') + '\\s*[,}\n]').test(tc.resultText));
      if (raw) return Object.assign({}, ref, { kind: 'stat', toolLabel: raw.label });
      return Object.assign({}, ref, { kind: 'none' });
    });
  }
  function renderTrace(refs) {
    if (!refs.length) return '<p class="tr-empty">这条回答没有引用具体数字。</p>';
    const TAG = {
      hit: ['账本原数', ''],
      sum: ['合计 · 推算', 'derived'],
      avg: ['平均 · 推算', 'derived'],
      stat: ['统计聚合', 'stat'],
      none: ['未见账本原数', 'miss'],
    };
    return refs.map(ref => {
      const [tag, cls] = TAG[ref.kind];
      let body = '';
      if (ref.kind === 'hit') {
        body = '<div class="tr-evis">' + ref.items.map(it =>
          `<button class="tr-ev" data-led="${it.ledgerId}" data-rec="${it.recId}">` +
          `<span class="tr-ev-date">${esc(it.date)}</span><span class="tr-ev-label">${esc(it.label)}</span>` +
          `<span class="tr-ev-val">${it.value}</span><span class="tr-ev-led">${esc(it.ledgerName)}</span></button>`).join('') +
          (ref.hitTotal > ref.items.length ? `<div class="tr-more">另有 ${ref.hitTotal - ref.items.length} 条相同数值</div>` : '') + '</div>';
      } else if (ref.kind === 'sum' || ref.kind === 'avg') {
        const op = ref.kind === 'sum' ? ' + ' : ' ÷ ';
        body = `<div class="tr-formula">${esc(ref.fieldLabel)}：${ref.items.map(it => it.value).join(op)}${ref.kind === 'sum' ? '' : ' ÷ ' + ref.items.length}</div>` +
          '<div class="tr-evis">' + ref.items.map(it =>
            `<button class="tr-ev" data-led="${it.ledgerId}" data-rec="${it.recId}">` +
            `<span class="tr-ev-date">${esc(it.date)}</span><span class="tr-ev-label">${esc(it.label)}</span>` +
            `<span class="tr-ev-val">${it.value}</span><span class="tr-ev-led">${esc(it.ledgerName)}</span></button>`).join('') + '</div>';
      } else if (ref.kind === 'stat') {
        body = `<div class="tr-formula">来自工具「${esc(ref.toolLabel)}」返回的统计值</div>`;
      } else {
        body = '<div class="tr-formula">账本里找不到这个数——多为推算值，也可能是无依据数字，请留意。</div>';
      }
      return `<div class="tr-ref"><div class="tr-head"><span class="tr-quote">「${esc(ref.quote)}」</span><span class="tr-tag ${cls}">${tag}</span></div>${body}</div>`;
    }).join('');
  }
  // ---------- 数据依据查看器（POP 悬浮窗）：溯源清单 + 原始数据折叠 ----------
  function fillSnapViewer(snap, toolCalls, answerText) {
    $('snap-meta').textContent = [snap.ledger, snap.model, snap.time ? fmtTime(snap.time) : '']
      .filter(Boolean).join(' · ');
    $('snap-detail').innerHTML = renderTrace(traceRefs(answerText || '', toolCalls));
    const raw = toolCalls && toolCalls.length
      ? toolCalls.map(t => `【${t.label}】${t.argsText ? '参数：' + t.argsText + '；' : ''}\n${t.resultText}`).join('\n\n')
      : String(snap.text || '');
    const old = $('snap-raw'); if (old) old.remove();
    const det = document.createElement('details');
    det.id = 'snap-raw';
    det.className = 'sv-raw-wrap';
    det.innerHTML = '<summary>查看原始查询数据（JSON）</summary><pre>' + esc(raw) + '</pre>';
    $('snap-detail').appendChild(det);
  }

  // ---------- 消息操作行：悬停整条消息才淡入的图标组（与正文左轴线对齐）+ 数字核对徽章 ----------
  // appendMsg（历史渲染）与 finishExchange（实时收尾）共用，保证两处行为一致
  function buildMsgActions(el, content, snap, toolCalls) {
    const actions = document.createElement('div');
    actions.className = 'cm-actions';
    const mkBtn = (icon, fallback, tip, fn) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ia-btn';
      b.dataset.tip = tip;
      b.setAttribute('aria-label', tip);
      b.innerHTML = `<span data-icon="${icon}" data-fallback="${fallback}"></span>`;
      b.addEventListener('click', fn);
      return b;
    };
    actions.appendChild(mkBtn('ui-copy', '⧉', '复制', () => {
      navigator.clipboard.writeText(content).then(() => toast('已复制 ✓'), () => toast('复制失败'));
    }));
    if (snap) {
      actions.appendChild(mkBtn('ui-data', '⛁', '引用数据', (e) => {
        fillSnapViewer(snap, toolCalls, content);
        window.MODAL.open('modal-snap', e.currentTarget);   // 悬浮窗从图标生长，ESC/遮罩原路归回
      }));
      const g = groundingCheck(content, snap.source);
      if (g) {
        const badge = document.createElement('div');
        badge.className = 'cm-check ' + (g.miss ? 'warn' : 'ok');
        badge.textContent = g.miss ? `△ ${g.miss} 个数字未见出处，请留意` : `✓ ${g.refs} 个数字均有出处`;
        actions.appendChild(badge);
      }
    }
    el.appendChild(actions);
    if (window.JGIcons) window.JGIcons.mount(actions);
    return actions;
  }
  function appendMsg(role, content, { save = true, snap = null, toolCalls = null } = {}) {
    emptyEl.classList.add('hidden');
    let el;
    if (role === 'user') el = userBubble(content);
    else {
      el = aiBubble();
      el.querySelector('.cm-bubble').innerHTML = renderMarkdown(content);
      // 历史消息里的工具行（Agent 查询记录，点击展开当时查到的结果）
      if (toolCalls && toolCalls.length) fillToolChips(el.querySelector('.cm-acts'), toolCalls);
      buildMsgActions(el, content, snap, toolCalls);
    }
    listEl.appendChild(el);
    if (save) {
      msgs.push({ role, content, ...(snap ? { snapshot: snap } : {}), ...(toolCalls && toolCalls.length ? { toolCalls } : {}) });
      saveSessionMsgs();
    }
    if (role === 'user') stick = true;
    follow();
    updateJump();
    return el;
  }
  // 数字核对：提取回答中的数字逐一比对数据快照（日期整串匹配；其余按数值匹配）
  function groundingCheck(text, source) {
    if (!source) return null;
    const dateRe = /\d{4}-\d{1,2}-\d{1,2}/g;
    const srcDates = new Set(source.match(dateRe) || []);
    const dates = text.match(dateRe) || [];
    if (dates.length && !dates.every(d => srcDates.has(d))) return null; // 日期对不上就不给出"全部来自"的结论
    const clean = text.replace(dateRe, ' ').replace(/,/g, '');
    const collect = t => (t.match(/\d+(?:\.\d+)?/g) || []).map(parseFloat);
    const srcVals = new Set(collect(source));
    const ans = collect(clean);
    if (!ans.length) return null;
    let miss = 0;
    ans.forEach(v => { if (!srcVals.has(v)) miss++; });
    return { refs: ans.length, miss };
  }
  // 滚动跟随（stick 模型）：用户停在底部才自动跟随；
  // 一旦向上滚动看历史，流式输出绝不拽人，改为显示「回到底部」按钮
  let stick = true;
  function follow() { if (stick) scrollEl.scrollTop = scrollEl.scrollHeight; }
  function onScroll() {
    stick = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 48;
    updateJump();
    updateTimelineCur();
  }
  function updateJump() {
    jumpBtn.classList.toggle('show', !stick && listEl.children.length > 0);
  }

  // ---------- 回合时间线：右侧锚点列，一个 AI 回合一个刻度，点击快速锚定 ----------
  function renderTimeline() {
    if (!tlEl) return;
    const turns = Array.from(listEl.querySelectorAll('.chat-msg.ai'));
    const H = scrollEl.scrollHeight;
    // 页面未激活（display:none）时高度为 0：先临时显形再量，量完按需收回
    const wasHidden = tlEl.classList.contains('hidden');
    if (wasHidden) tlEl.classList.remove('hidden');
    const vh = tlEl.clientHeight;
    if (!turns.length || H < 60 || vh < 60) {
      tlEl.innerHTML = '';
      tlEl.classList.add('hidden');
      return;
    }
    tlEl.innerHTML = turns.map((m, i) => {
      const ratio = Math.min(0.98, Math.max(0.02, (m.offsetTop + 10) / H));
      const tip = esc((m.dataset.q || '（本回合）').slice(0, 16));
      return `<button class="tl-dot" data-i="${i}" style="top:${(ratio * vh).toFixed(1)}px" aria-label="第${i + 1}回合"><span class="tl-tip">${tip}</span></button>`;
    }).join('');
    tlEl.querySelectorAll('.tl-dot').forEach(d => {
      d.addEventListener('click', () => {
        const m = turns[+d.dataset.i];
        if (!m) return;
        stick = false;
        scrollEl.scrollTo({ top: Math.max(0, m.offsetTop - 10), behavior: REDUCED ? 'auto' : 'smooth' });
      });
    });
    updateTimelineCur();
  }
  function updateTimelineCur() {
    if (!tlEl || !tlEl.children.length) return;
    const turns = listEl.querySelectorAll('.chat-msg.ai');
    let cur = -1;
    turns.forEach((m, i) => { if (m.offsetTop - 10 <= scrollEl.scrollTop + 60) cur = i; });
    tlEl.querySelectorAll('.tl-dot').forEach((d, i) => d.classList.toggle('cur', i === cur));
  }

  // 思考行：过程与回答同列展示（ZCode 式一行小字），完成后收成「思考 · N 秒」可展开
  function thinkLine(acts, label) {
    let line = acts.querySelector('.act-line.think');
    if (!line) {
      acts.classList.remove('hidden');
      line = document.createElement('button');
      line.type = 'button';
      line.className = 'act-line think';
      line.innerHTML = '<span class="al-ico">💭</span><span class="al-verb"></span>' +
        '<span class="al-state"></span><div class="al-panel hidden"><div class="think-text"></div></div>';
      line.addEventListener('click', (e) => {
        if (e.target.closest('.think-text')) return;
        line.querySelector('.al-panel').classList.toggle('hidden');
      });
      acts.appendChild(line);
    }
    if (label != null) line.querySelector('.al-verb').textContent = label;
    return line;
  }
  // 思考型模型的思考过程：实时进思考行的展开区（限长）
  function showReasoning(line, delta) {
    const txt = line.querySelector('.think-text');
    txt.textContent += delta;
    if (txt.textContent.length > 3000) txt.textContent = txt.textContent.slice(-3000);
    txt.scrollTop = txt.scrollHeight;
    line.classList.add('open-text');
  }
  function finishThink(line, acts) {
    if (!line) return;
    const secs = Math.max(1, Math.round((Date.now() - thinkStart) / 1000));
    const hasText = !!line.querySelector('.think-text').textContent;
    line.classList.remove('pending');
    line.querySelector('.al-verb').textContent = '思考';
    line.querySelector('.al-state').textContent = '· ' + secs + ' 秒';
    const panel = line.querySelector('.al-panel');
    if (!hasText) panel.classList.add('hidden');
    // 纯寒暄且没有思考内容：不留过程行，回答即全部
    if (!acts.querySelector('.act-line.tool') && !hasText) acts.classList.add('hidden');
  }

  // ---------- 过程行（ZCode 式：一行一个动作，弱化灰调，点击展开详情） ----------
  const TOOL_LABELS = {
    list_ledgers: '查询账本清单',
    get_stats: '查询账本统计',
    get_daily: '查询每日明细',
    get_day_records: '查询某日记录',
  };
  const cap = (s, n) => { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n) + '…（已截断）' : s; };
  // 追加一行处于"查询中"状态的工具行；done() 后落成完成态，点击可展开真实结果
  function addToolChip(acts, label, argsText) {
    acts.classList.remove('hidden');
    const item = document.createElement('div');
    item.className = 'act-line tool pending';
    item.innerHTML = '<span class="al-ico">🔧</span><span class="al-verb">' + esc(label) + '</span>' +
      (argsText ? '<span class="al-arg">· ' + esc(argsText) + '</span>' : '') +
      '<span class="al-state"></span>';
    const panel = document.createElement('div');
    panel.className = 'al-panel hidden';
    panel.innerHTML = '<pre></pre>';
    item.addEventListener('click', () => panel.classList.toggle('hidden'));
    acts.appendChild(item);
    acts.appendChild(panel);
    follow();
    return {
      done(ok, resultText) {
        item.classList.remove('pending');
        if (!ok) item.classList.add('err');
        item.querySelector('.al-state').textContent = ok ? '✓' : '✗';
        panel.querySelector('pre').textContent = resultText || '';
        follow();
      },
    };
  }
  // 历史消息里的工具行：直接落成完成态
  function fillToolChips(acts, toolCalls) {
    (toolCalls || []).forEach(t =>
      addToolChip(acts, t.label || TOOL_LABELS[t.name] || t.name, t.argsText).done(t.ok !== false, t.resultText || '（无记录）'));
  }

  // ---------- 平滑打字机（节奏缓冲器） ----------
  function makeTyper(bubbleEl, onDone) {
    let pending = '';   // 已到达未显示
    let shown = '';     // 已显示
    let alive = true;
    let timer = null;
    function render() {
      bubbleEl.innerHTML = renderMarkdown(shown) + '<span class="cm-cursor"></span>';
      follow();
    }
    function loop() {
      if (!alive) return;
      if (pending.length) {
        // 自适应匀速：积压越多出字越快，但始终分帧，观感是打字机
        const take = Math.min(pending.length, Math.max(2, Math.ceil(pending.length / 10)));
        shown += pending.slice(0, take);
        pending = pending.slice(take);
        render();
      }
      if (pending.length) {
        timer = setTimeout(loop, 40);
      } else if (streaming) {
        timer = setTimeout(loop, 60);   // 等下一波网络数据
      } else {
        timer = null;
        render();
        onDone(shown);
      }
    }
    const self = {
      push(t) { if (!alive) return; pending += t; if (!timer) loop(); },
      finish() { streaming = false; if (!timer) { render(); onDone(shown); } },
      stop() { alive = false; clearTimeout(timer); timer = null; return shown; },
      text() { return shown + pending; },
      isAlive: () => alive,
    };
    return self;
  }

  // ---------- 上下文（Agent 化：数据按需经工具查询，系统提示只带账本目录不含数字） ----------
  const HARD_RULES = [
    '【数据引用硬规则】',
    '1) 回答中的所有数字必须来自工具返回的查询结果；',
    '2) 需要推算时（求和/差值/占比/环比等），必须写出算式来源并注明是推算；',
    '3) 查询结果中不存在的数字与事实一律不得编造；信息不足时直接说明，并建议用户补记；',
    '4) 引用数字时尽量带上日期或科目，方便用户核对。',
  ].join('\n');

  function buildBase() {
    const tpl = window.JG.getActiveTemplate();
    const today = new Date();
    const pad = n => String(n).padStart(2, '0');
    const dstr = today.getFullYear() + '-' + pad(today.getMonth() + 1) + '-' + pad(today.getDate());
    let sys = tpl.ai.persona +
      `\n\n现在以"对话"方式与用户交流：语气自然，像面对面聊天；默认回答简洁（200~500字），` +
      `答其所问，不要每次都输出完整报告结构。` +
      `\n\n今天是 ${dstr}（周${'日一二三四五六'[today.getDay()]}）。` +
      `\n\n【用户的账本目录】\n${window.AITOOLS.ledgerDir()}` +
      '\n\n【工具使用规则】\n' +
      '1) 涉及用户记账数据的问题（统计、明细、某天情况、趋势、跨账本对比），必须先调用工具查询真实数据，再回答；需要时可以连续调用多个工具；\n' +
      '2) 纯寒暄、通用生活建议等与数据无关的问题，直接回答，不要调用工具；\n' +
      '3) 工具返回的结果是唯一数据来源；没查过的信息不得编造；\n' +
      '4) 新建账本前必须能确定"给谁记的"（主体）和账本类型：用户说清楚了才可调用 create_ledger；主体或类型不明确时先在回复里反问用户，禁止默认、禁止猜测；创建前先用 list_ledgers 查重，已有同主体同名同类账本时如实告知，不要重复建；\n' +
      '5) 账本一律用"主体·账本名"称呼（如"妈妈·工资账本"）；遇到同名账本先按主体区分，拿不准就问用户，禁止猜；\n' +
      '6) 严禁在正文中书写工具名或 JSON 参数来"假装调用工具"——要么真正发起工具调用，要么直接作答。\n\n' +
      HARD_RULES;
    // 长对话记忆：旧对话的滚动摘要（后台自动压缩更新）注入系统提示
    const sx = currentSession();
    if (sx && sx.summary) {
      sys += '\n\n【此前对话的要点摘要】\n' + sx.summary;
    }
    const ctx = msgs.slice(-CTX_TURNS).map(m => ({
      role: m.role,
      content: String(m.content).slice(0, MSG_CAP),
    }));
    return { messages: [{ role: 'system', content: sys.slice(0, 9000) }].concat(ctx), snap: null };
  }
  // 降级模式（模型不支持工具调用时）：把真实数据直接装进提示词——即 V0.9.x 的"数据快照"方案。
  // 检测到伪工具调用后自动切换，保证用户依然拿到基于真实数据的回答。
  function buildDegraded() {
    const JG = window.JG;
    const led = JG.getActiveLedger();
    const tpl = JG.getActiveTemplate();
    const records = JG.getRecords();
    const stats = tpl.ai.buildStats(records);
    const daily = tpl.ai.dailyLines(records);
    const statsText = stats
      ? '【统计 JSON】\n' + JSON.stringify(stats, null, 2) + '\n【每日明细（最后90条）】\n' + daily
      : '（该账本还没有任何记录：提醒用户先记几笔才有数据可分析）';
    const today = new Date();
    const pad = n => String(n).padStart(2, '0');
    const dstr = today.getFullYear() + '-' + pad(today.getMonth() + 1) + '-' + pad(today.getDate());
    const sx = currentSession();
    let sys = tpl.ai.persona +
      `\n\n现在以"对话"方式与用户交流：语气自然，像面对面聊天；默认回答简洁（200~500字），答其所问。` +
      `\n\n今天是 ${dstr}（周${'日一二三四五六'[today.getDay()]}）。` +
      `\n\n【用户的账本目录】\n${window.AITOOLS.ledgerDir()}` +
      `\n\n【本次固定数据快照】以下是系统为你准备好的当前账本（${led.name}）真实数据，直接依据它回答：\n` + statsText +
      `\n\n【重要】你无法调用任何工具；严禁在回答中出现工具名或 JSON 参数（写了也无效）；直接依据上方快照数据作答。\n\n` +
      HARD_RULES;
    if (sx && sx.summary) sys += '\n\n【此前对话的要点摘要】\n' + sx.summary;
    const ctx = msgs.slice(-CTX_TURNS).map(m => ({
      role: m.role,
      content: String(m.content).slice(0, MSG_CAP),
    }));
    const snap = led && records.length ? {
      tool: false,
      ledger: led.name,
      model: (JG.ModelSwitch.activeInfo() || { model: null }).model?.model || '',
      time: Date.now(),
      text: '【数据直读模式（模型不支持工具调用）】\n【账本】' + led.name + '\n' + statsText,
      source: statsText + (sx && sx.summary ? '\n【摘要】' + sx.summary : ''),
    } : null;
    return { messages: [{ role: 'system', content: sys.slice(0, 9000) }].concat(ctx), snap };
  }

  // ---------- SSE 流读取（含工具调用增量拼装） ----------
  // 返回 { finishReason, toolCalls }：toolCalls 为拼装完整的工具调用数组
  // （流式下厂商把 tool_calls 拆成增量碎片，按 index 逐段合并）
  function normalizeToolCall(tc) {
    return {
      id: tc.id || '',
      type: 'function',
      function: { name: (tc.function && tc.function.name) || '', arguments: (tc.function && tc.function.arguments) || '{}' },
    };
  }
  async function streamRequest(body, controller, onDelta) {
    const resp = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const ctype = resp.headers.get('content-type') || '';
    if (!resp.ok) {
      let msg = '请求失败（HTTP ' + resp.status + '）';
      try { const j = await resp.json(); if (j.error && j.error.message) msg = j.error.message; } catch { /* 忽略 */ }
      throw new Error(msg);
    }
    // 厂商不支持流时服务器会回 JSON 200：整段返回，交给打字机
    if (!ctype.includes('text/event-stream')) {
      const data = await resp.json();
      if (data.error) throw new Error(data.error.message || '接口返回错误');
      const m = (data.choices && data.choices[0] && data.choices[0].message) || {};
      if (m.content) onDelta(m.content);
      return {
        finishReason: (data.choices && data.choices[0] && data.choices[0].finish_reason) || null,
        toolCalls: (Array.isArray(m.tool_calls) ? m.tool_calls : []).map(normalizeToolCall),
      };
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let done = false;
    let finishReason = null;
    const toolCalls = [];   // 按 index 拼装：{id, type, function:{name, arguments}}
    const handleEvent = (event) => {
      for (const line of event.split('\n')) {
        const t = line.trim();
        if (!t.startsWith('data:')) continue;
        const data = t.slice(5).trim();
        if (data === '[DONE]') { done = true; return; }
        try {
          const j = JSON.parse(data);
          const c0 = j.choices && j.choices[0];
          if (c0 && c0.finish_reason) finishReason = c0.finish_reason;
          const d = (c0 && c0.delta) || {};
          // 思考型模型（glm-4.6 / deepseek-reasoner 等）先吐 reasoning_content：交给思考气泡实时显示
          if (d.reasoning_content) onDelta(d.reasoning_content, 'reasoning');
          if (d.content) onDelta(d.content, 'content');
          // 工具调用增量：合并进对应槽位（index 对不上时顺序追加兜底）
          if (Array.isArray(d.tool_calls) && d.tool_calls.length) {
            onDelta('', 'tool');   // 通知发送方"有动静"（刷新看门狗、切换提示文案）
            d.tool_calls.forEach(tc => {
              const i = typeof tc.index === 'number' && toolCalls[tc.index] !== undefined ? tc.index
                : (typeof tc.index === 'number' ? tc.index : toolCalls.length);
              if (!toolCalls[i]) toolCalls[i] = { id: '', type: 'function', function: { name: '', arguments: '' } };
              if (tc.id) toolCalls[i].id = tc.id;
              if (tc.function) {
                if (tc.function.name) toolCalls[i].function.name += tc.function.name;
                if (tc.function.arguments) toolCalls[i].function.arguments += tc.function.arguments;
              }
            });
          }
        } catch { /* 忽略无法解析的行 */ }
      }
    };
    while (!done) {
      const { done: d, value } = await reader.read();
      if (d) break;
      // 兼容 \r\n / \r / \n 三种换行（SSE 规范都允许，厂商与网关实现不一）
      buf += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const event = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        handleEvent(event);
      }
    }
    // 流结束：把没有以空行结尾的残留事件也处理掉
    if (buf.trim()) handleEvent(buf);
    return { finishReason, toolCalls: toolCalls.filter(Boolean).map(normalizeToolCall) };
  }

  // ---------- 发送（Agent 循环：模型决策 → 本地执行工具 → 结果回喂 → 最终回答） ----------
  async function send(text) {
    if (streaming) return;
    text = (text || '').trim();
    if (!text) return;
    const led = window.JG.getActiveLedger();
    storeLedgerId = led.id;

    streaming = true;
    userStopped = false;
    inputEl.value = '';
    autosize();
    // 会话标题：首条用户消息自动命名
    const sx0 = currentSession();
    if (sx0 && (!sx0.title || sx0.title === '新会话')) {
      sx0.title = text.slice(0, 18);
      saveSessionsStore();
      updateSessionUI();
    }
    sendBtn.disabled = true;
    stopBtn.classList.remove('hidden');
    appendMsg('user', text);

    // 思考行（过程与回答同列：ZCode 式一行小字，完成后收成「思考 · N 秒」）
    const el = aiBubble();
    el.dataset.q = text.slice(0, 60);   // 回合标记：时间线悬停提示
    const bubble = el.querySelector('.cm-bubble');
    const acts = el.querySelector('.cm-acts');
    thinkStart = Date.now();
    let thinkLineRef = thinkLine(acts, '思考中');
    emptyEl.classList.add('hidden');
    listEl.appendChild(el);
    stick = true; follow(); updateJump();

    controller = new AbortController();
    // 本次交换的全部工具调用记录（UI 卡片 + 持久化 + 数字核对依据）
    const toolLog = [];
    let degradedSnap = null;   // 数据直读模式的快照（供 📦 引用数据与数字核对）
    const makeSnap = () => toolLog.length ? {
      tool: true,
      ledger: led.name,
      model: (window.JG.ModelSwitch.activeInfo() || { model: null }).model?.model || '',
      time: Date.now(),
      text: '本次 AI 通过工具查询到的真实数据：\n' + toolLog.map(t =>
        `【${t.label}】${t.argsText ? '参数：' + t.argsText + '；' : ''}结果：\n${t.resultText}`).join('\n\n'),
      source: toolLog.map(t => t.resultText).join('\n'),
    } : degradedSnap;
    const api = window.JG.ModelSwitch.activeInfo();
    const modelKey = api.provider + '/' + (api.model ? api.model.model : '');
    let degraded = toolIncapableModels.has(modelKey);   // 该模型已知不会真调用工具 → 直接数据直读
    let base = buildBase();
    let messages = base.messages;
    let typer = null;
    const onDone = (finalText) => {
      if (!active || active.typer !== typer) return;   // 已被停止终结，忽略迟到的完成
      finishExchange(el, bubble, finalText, false, makeSnap(), toolLog, degraded);
    };
    typer = makeTyper(bubble, onDone);
    active = { typer, bubble, el };
    if (degraded) {
      const d = buildDegraded();
      messages = d.messages;
      degradedSnap = d.snap;
    }
    const baseBody = {
      apiKey: api.apiKey,
      model: api.model ? api.model.model : 'glm-4-flash',
      baseUrl: api.baseUrl || '',
      temperature: 0.7,
      maxTokens: api.model ? api.model.maxOut : 3072,   // 按当前模型的档案限制输出
      stream: true,
    };

    // 首字看门狗：每轮请求独立计时，迟迟等不到任何数据时直接终结本次交换
    let watchdog = null;
    const giveUp = () => { if (controller) controller.abort(); };   // abort → catch 统一收尾
    const armWatch = () => { clearWatch(); watchdog = setTimeout(giveUp, window.JGChat_FIRST_TOKEN_MS || 15000); };
    const clearWatch = () => { if (watchdog) { clearTimeout(watchdog); watchdog = null; } };

    try {
      if (!api.apiKey) throw new Error('当前厂商「' + api.name + '」还没有填写 API Key。请到「设置 → 模型设置」填写。');
      let gotAny = false;
      let round = 0;
      while (round < AGENT_ROUNDS + 1) {   // 1~AGENT_ROUNDS 轮带工具，最后一轮强制作答
        round++;
        const withTools = !degraded && round <= AGENT_ROUNDS && window.AITOOLS && window.AITOOLS.schemas.length;
        let fakeHit = false;    // 本轮正文里出现"假工具调用"（模型不会真调用工具）
        let streamed = '';
        armWatch();
        const res = await streamRequest(Object.assign({}, baseBody, {
          messages,
          ...(withTools ? { tools: window.AITOOLS.schemas } : {}),
        }), controller, (delta, type) => {
          if (!active || active.typer !== typer) return;   // 已被终结，丢弃迟到的数据
          clearWatch();
          if (type === 'reasoning') { if (thinkLineRef) showReasoning(thinkLineRef, delta); return; }
          if (type === 'tool') {
            if (thinkLineRef) thinkLineRef.querySelector('.al-verb').textContent = '推演';
            return;
          }
          if (withTools) {
            // 假工具调用检测：模型把"调用"写进正文（如 get_ledger {"name":…}）＝ 它拿不到/不会用工具
            if (fakeHit) return;                      // 已判定的假调用内容不再展示
            streamed += delta;
            if (FAKE_TOOL_RE.test(streamed)) {
              fakeHit = true;
              if (thinkLineRef) { finishThink(thinkLineRef, acts); thinkLineRef = null; }
              return;
            }
          }
          if (!gotAny) {
            gotAny = true;
            finishThink(thinkLineRef, acts);   // 首字到达：思考行收成「思考 · N 秒」
            thinkLineRef = null;
          }
          typer.push(delta);
        });
        if (!res.toolCalls.length) {
          if (fakeHit) {
            // 该模型不会真调用工具：记住它，清掉这段"假调用"输出，切换「数据直读」模式重答
            toolIncapableModels.add(modelKey);
            degraded = true;
            typer.stop();
            bubble.innerHTML = '';
            toolLog.length = 0;
            const d = buildDegraded();
            messages = d.messages;
            degradedSnap = d.snap;
            typer = makeTyper(bubble, onDone);
            active = { typer, bubble, el };
            gotAny = false;
            toast('当前模型不支持工具调用，已切换「数据直读」模式重试');
            round = 0;
            continue;
          }
          break;   // 无工具调用：最终回答已流式吐完
        }
        // 有工具调用：逐个本地执行，结果回喂模型继续决策
        messages.push({ role: 'assistant', content: typer.text() || null, tool_calls: res.toolCalls });
        for (const rc of res.toolCalls) {
          let args = {};
          try { args = JSON.parse(rc.function.arguments || '{}'); } catch { /* 参数坏就按空处理，让模型自行纠正 */ }
          const label = TOOL_LABELS[rc.function.name] || rc.function.name;
          const argsText = Object.values(args).filter(v => v != null && v !== '').map(String).join(' · ');
          const chip = addToolChip(acts, label, argsText);
          let result, ok = true;
          try {
            if (!window.AITOOLS || typeof window.AITOOLS.run !== 'function') throw new Error('工具层未加载');
            result = window.AITOOLS.run(rc.function.name, args);
          } catch (e) { ok = false; result = { error: e.message }; }
          const resultText = JSON.stringify(result, null, 2);
          chip.done(ok, resultText);
          toolLog.push({ name: rc.function.name, label, args, argsText, ok, resultText });
          messages.push({
            role: 'tool',
            tool_call_id: rc.id || ('call_' + round + '_' + toolLog.length),
            content: resultText.slice(0, 12000),
          });
        }
        thinkStart = Date.now();
        thinkLineRef = thinkLine(acts, '继续推演');
        gotAny = false;
      }
      clearWatch();
      if (!typer.text().trim()) {
        if (round > AGENT_ROUNDS) throw new Error('AI 反复查询数据但没有给出回答，请换个问法或到「设置 → 模型设置」换个模型再试。');
        // 流式全程没吐出内容（厂商 SSE 兼容问题或思考型模型耗尽输出额度）：自动降级非流式重试一次
        const resp2 = await fetch('/api/ai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(Object.assign({}, baseBody, { messages, stream: false })),
          signal: controller.signal,
        });
        const data2 = await resp2.json().catch(() => null);
        if (!resp2.ok || !data2 || data2.error) {
          throw new Error((data2 && data2.error && data2.error.message) || `请求失败（HTTP ${resp2.status}）`);
        }
        const m2 = (data2.choices && data2.choices[0] && data2.choices[0].message) || {};
        if (m2.tool_calls && m2.tool_calls.length) {
          throw new Error('这个模型似乎不支持工具调用，请到「设置 → 模型设置」换一个支持工具的模型（如 glm-4-flash、deepseek-chat）。');
        }
        if (!m2.content) throw new Error('AI 没有返回内容，请稍后重试。');
        if (!gotAny) { finishThink(thinkLineRef, acts); thinkLineRef = null; }
        typer.push(m2.content);
      }
      typer.finish();
    } catch (err) {
      clearWatch();
      if (!active || active.typer !== typer) return;   // 已被「停止」终结，忽略迟到错误
      if (thinkLineRef && thinkLineRef.classList.contains('pending')) {
        thinkLineRef.classList.remove('pending');
        thinkLineRef.querySelector('.al-verb').textContent = '思考';
        thinkLineRef.querySelector('.al-state').textContent = '· 未完成';
      }
      const partial = typer.stop();
      active = null;
      streaming = false;
      stopBtn.classList.add('hidden');
      sendBtn.disabled = false;
      controller = null;
      renderTimeline();
      const timedOut = err && err.name === 'AbortError' && !userStopped;
      const why = userStopped ? '已停止' : (timedOut ? '等待超时' : (err.message || '已停止'));
      if (partial.trim()) {
        // 已输出一半时出错：保留已出内容并附加错误说明
        bubble.innerHTML = renderMarkdown(partial) + `<p class="cm-err">（${esc(why)}）</p>`;
      } else if (timedOut) {
        bubble.innerHTML = '<p class="cm-err">⚠️ 等了 15 秒没有收到回复，已自动停止。请重试；若反复出现，检查网络或到「设置 → 模型设置」换个模型。</p>';
      } else {
        let msg = esc(err.message || '生成失败，请确认本地服务窗口还开着。');
        // 厂商不支持 Function Calling 的典型报错：给出换模型建议
        if (/tool|function/i.test(err.message || '')) {
          msg += '（这个模型可能不支持「工具调用」，请换一个支持的模型，如 glm-4-flash、deepseek-chat）';
        }
        bubble.innerHTML = `<p class="cm-err">⚠️ ${msg}</p>`;
        // Key 类错误：附「去设置」跳转按钮，小白能一步找到入口
        if (err.message && (err.message.includes('Key') || err.message.includes('令牌') || err.message.includes('401'))) {
          const go = document.createElement('button');
          go.className = 'cm-go-setting';
          go.textContent = '去模型设置检查 →';
          go.addEventListener('click', () => { if (window.JG) window.JG.switchTab('settings'); });
          bubble.appendChild(go);
        }
      }
    }
  }

  // 终结一次交换：流式正常完成与手动停止共用，保证按钮/历史状态一致
  // snap = 本次工具查询快照（用于「📦 引用数据」展示与数字核对徽章）；toolLog = 工具调用记录
  function finishExchange(el, bubble, finalText, stopped, snap, toolLog, degraded) {
    bubble.innerHTML = renderMarkdown(finalText) +
      (stopped ? '<p class="cm-err">（已停止，内容不完整）</p>' : '');
    streaming = false;
    stopBtn.classList.add('hidden');
    sendBtn.disabled = false;
    controller = null;
    active = null;
    if (finalText.trim()) {
      const entry = { role: 'assistant', content: finalText };
      if (snap) entry.snapshot = snap;
      if (toolLog && toolLog.length) {
        entry.toolCalls = toolLog.map(t => ({
          name: t.name, label: t.label, argsText: t.argsText, ok: t.ok,
          resultText: cap(t.resultText, TOOL_TEXT_CAP),
        }));
      }
      msgs.push(entry);
      saveSessionMsgs();
      maybeSummarize();   // 长对话滚动摘要（后台压缩，不阻塞界面）
      // 操作行（悬停显现图标组 + 数字核对徽章）
      const actions = buildMsgActions(el, finalText, snap, toolLog);
      if (degraded) {
        // 该模型不支持工具调用：本条是用"数据直读"模式答的（数据依然真实，只是走快照）
        const badge = document.createElement('div');
        badge.className = 'cm-check warn';
        badge.textContent = '△ 该模型不支持工具调用，本条已自动改用数据直读';
        actions.appendChild(badge);
      } else if (!snap) {
        // 没查数据的回答若满篇数字：诚实提示"没有数据来源"，不装可靠
        const cleaned = finalText.replace(/\d{4}-\d{1,2}-\d{1,2}/g, ' ').replace(/\b(19|20)\d{2}\b/g, ' ');
        const nums = cleaned.match(/\d+(?:\.\d+)?/g) || [];
        if (nums.length >= 3) {
          const badge = document.createElement('div');
          badge.className = 'cm-check warn';
          badge.textContent = `△ 未查账本，数字仅供参考`;
          actions.appendChild(badge);
        }
      }
    }
    stick = true; follow(); updateJump();
    renderTimeline();
  }

  function stopStream() {
    if (!streaming) return;
    userStopped = true;
    if (controller) controller.abort();          // 尽力中止网络层
    if (active) {
      const partial = active.typer.stop();       // 确定性终结：不等网络层
      const { el, bubble } = active;
      finishExchange(el, bubble, partial, true);
      toast('已停止');
    }
  }

  // ---------- 界面 ----------
  function renderAll() {
    listEl.innerHTML = '';
    if (!msgs.length) {
      emptyEl.classList.remove('hidden');
      return;
    }
    emptyEl.classList.add('hidden');
    msgs.forEach((m, i) => {
      const el2 = appendMsg(m.role, m.content, { save: false, snap: m.snapshot || null, toolCalls: m.toolCalls || null });
      if (m.role === 'ai' || m.role === 'assistant') {
        // 回合标记：取本轮的用户提问（时间线悬停提示）
        for (let k = i - 1; k >= 0; k--) {
          if (msgs[k].role === 'user') { el2.dataset.q = String(msgs[k].content).slice(0, 60); break; }
        }
      }
    });
    renderTimeline();
    stick = true;
    follow();
    updateJump();
  }
  function reload() {
    // 切换账本后：装载该账本的会话列表与活动会话（含旧单会话数据自动迁移）
    const led = window.JG && window.JG.getActiveLedger && window.JG.getActiveLedger();
    if (!led) return;   // app 尚未就绪（chat.js 的 init 早于 app.js 完成），由就绪后重试覆盖
    if (streaming && controller) controller.abort();
    storeLedgerId = led.id;
    sessions = loadSessions();
    // 旧单会话数据迁移：jigong_chat_<id> → 首个会话
    const legacy = (() => { try { return JSON.parse(localStorage.getItem(legacyChatKey())); } catch { return null; } })();
    if (Array.isArray(legacy) && legacy.length && !sessions.length) {
      sessions = [Object.assign(newSessionObj('此前的对话'), { messages: legacy })];
    }
    if (!sessions.length) sessions = [newSessionObj('新会话')];
    // 活动会话指针按账本记忆；失效自动回落到第一个
    const want = localStorage.getItem(actKey());
    sessionId = sessions.find(x => x.id === want) ? want : sessions[0].id;
    localStorage.setItem(actKey(), sessionId);
    if (legacy) localStorage.removeItem(legacyChatKey());
    saveSessionsStore();
    msgs = currentSession().messages;
    if (inputEl) inputEl.placeholder = `问问你的账…`;
    renderAll();
    updateSessionUI();
    updateModelUI();
  }
  function autosize() {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 110) + 'px';
  }

  // ---------- 会话选择器 ----------
  function updateSessionUI() {
    const sx = currentSession();
    if (sx) $('session-title').textContent = sx.title;
  }
  function buildSessionMenu() {
    const menu = $('session-menu');
    menu.innerHTML = sessions.map(sx => `
      <div class="ss-item ${sx.id === sessionId ? 'active' : ''}" data-ss="${sx.id}">
        <div class="ss-info">
          <span class="ss-title">${esc(sx.title)}</span>
          <span class="ss-meta">${sx.messages.length} 条 · ${fmtTime(sx.updatedAt)}</span>
        </div>
        <button class="ss-del" data-ssdel="${sx.id}" title="删除会话">✕</button>
      </div>`).join('') +
      '<button class="ss-new" id="ss-new">＋ 新建会话</button>';
    menu.querySelectorAll('[data-ss]').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('[data-ssdel]')) return;
        switchSession(item.dataset.ss);
      });
    });
    menu.querySelectorAll('[data-ssdel]').forEach(b => {
      b.addEventListener('click', (e) => { e.stopPropagation(); deleteSession(b.dataset.ssdel); });
    });
    $('ss-new').addEventListener('click', createSession);
  }
  function toggleSessionMenu(force) {
    const menu = $('session-menu');
    const willOpen = force != null ? force : menu.classList.contains('hidden');
    if (willOpen) buildSessionMenu();
    menu.classList.toggle('hidden', !willOpen);
  }
  function createSession() {
    if (streaming) { toast('AI 正在回答，请先停止'); return; }
    const sx = newSessionObj('新会话');
    sessions.unshift(sx);
    saveSessionsStore();
    sessionId = sx.id;
    localStorage.setItem(actKey(), sessionId);
    msgs = sx.messages;
    renderAll();
    updateSessionUI();
    toggleSessionMenu(false);
    toast('新会话已创建 ✓');
  }
  function switchSession(id) {
    if (streaming) { toast('AI 正在回答，请先停止'); return; }
    if (id === sessionId) { toggleSessionMenu(false); return; }
    const sx = sessions.find(x => x.id === id);
    if (!sx) return;
    sessionId = id;
    localStorage.setItem(actKey(), id);
    msgs = sx.messages;
    renderAll();
    updateSessionUI();
    toggleSessionMenu(false);
    toast('已切换到「' + sx.title + '」');
  }
  function deleteSession(id) {
    if (streaming) { toast('AI 正在回答，请先停止'); return; }
    const sx = sessions.find(x => x.id === id);
    if (!sx) return;
    if (!confirm(`删除会话「${sx.title}」？其中 ${sx.messages.length} 条消息会一并删除，无法恢复。`)) return;
    sessions = sessions.filter(x => x.id !== id);
    saveSessionsStore();
    if (!sessions.length) {
      sessions = [newSessionObj('新会话')];
      saveSessionsStore();
      sessionId = sessions[0].id;
      msgs = sessions[0].messages;
      renderAll();
      updateSessionUI();
      toggleSessionMenu(false);
      toast('会话已删除，已为你新建空白会话');
      return;
    }
    if (id === sessionId) {
      sessionId = sessions[0].id;
      localStorage.setItem(actKey(), sessionId);
      msgs = currentSession().messages;
      renderAll();
      updateSessionUI();
    }
    toast('会话已删除');
  }

  // ---------- 模型快切（ZCode 式，输入坞左下角） ----------
  function updateModelUI() {
    const info = window.JG.ModelSwitch.activeInfo();
    $('model-label').textContent = info.model
      ? `${info.name} · ${info.model.label || info.model.model}`
      : `${info.name} · 未配置模型`;
  }
  function buildModelMenu() {
    const menu = $('model-menu');
    const apis = window.JG.ModelSwitch.apiList().filter(a => a.models.length);
    const cur = window.JG.ModelSwitch.activeInfo();
    menu.innerHTML = (apis.length ? '' : '<div class="mm-note">还没有配置任何模型，请到「设置 → 模型设置」。</div>') +
      apis.map(a =>
        `<div class="mm-group">${a.name}${a.hasKey ? '' : '（未填 Key）'}</div>` +
        a.models.map(m => `<button class="mm-item ${a.provider === cur.provider && cur.model && m.id === cur.model.id ? 'active' : ''}" data-ap="${a.provider}" data-mid="${m.id}">
          <span class="mm-label">${esc(m.label || m.model)}</span>
          <span class="mm-sub">${esc(m.model)}</span>
        </button>`).join('')
      ).join('') +
      '<div class="mm-note"><button class="mm-manage" id="mm-manage">管理模型 →</button></div>';
    menu.querySelectorAll('.mm-item').forEach(b => {
      b.addEventListener('click', () => {
        const ok = window.JG.ModelSwitch.selectModel(b.dataset.ap, b.dataset.mid);
        if (ok) { updateModelUI(); const n = window.JG.ModelSwitch.activeInfo(); toast('已切换到「' + n.name + ' · ' + (n.model.label || n.model.model) + '」 ✓'); }
        toggleModelMenu(false);
      });
    });
    const mg = document.getElementById('mm-manage');
    if (mg) mg.addEventListener('click', () => { toggleModelMenu(false); if (window.JG) window.JG.switchTab('settings'); });
  }
  function toggleModelMenu(force) {
    const menu = $('model-menu');
    const willOpen = force != null ? force : menu.classList.contains('hidden');
    if (willOpen) {
      buildModelMenu();
      // 菜单挂在舞台层（避开输入坞 clip-path 裁剪），按按钮位置用 JS 定位
      const stage = document.querySelector('.chat-stage');
      const btn = $('btn-model').getBoundingClientRect();
      const st = stage.getBoundingClientRect();
      menu.style.left = Math.max(8, btn.left - st.left) + 'px';
      menu.style.bottom = (st.bottom - btn.top + 8) + 'px';
      menu.style.top = 'auto';
      $('btn-model').classList.add('open');
    } else {
      $('btn-model').classList.remove('open');
    }
    menu.classList.toggle('hidden', !willOpen);
  }

  // ---------- 长对话滚动摘要：旧对话后台压缩成要点，注入后续上下文 ----------
  function maybeSummarize() {
    const sx = currentSession();
    if (!sx || summarizeBusy) return;
    const aged = sx.messages.length - sx.summarizedCount - CTX_TURNS;
    if (aged < SUM_TRIG) return;                     // 未超出原文窗口太多，暂不压缩
    summarizeBusy = true;
    const apiInfo = window.JG.ModelSwitch.activeInfo();
    const cover = sx.messages.slice(0, sx.messages.length - CTX_TURNS);   // 待压缩的旧消息
    const content = (sx.summary ? '【既有摘要】\n' + sx.summary + '\n\n【新增对话】\n' : '') +
      cover.map(m => (m.role === 'user' ? '用户：' : '军师：') + String(m.content).slice(0, 600)).join('\n');
    fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey: apiInfo.apiKey, model: apiInfo.model ? apiInfo.model.model : 'glm-4-flash', baseUrl: apiInfo.baseUrl || '',
        stream: false, temperature: 0.2, max_tokens: 700,
        messages: [
          { role: 'system', content: '你是会话摘要器。把对话压缩成要点摘要：保留全部数字、结论与未完成事项，去除寒暄，300 字以内，直接输出摘要正文。' },
          { role: 'user', content },
        ],
      }),
    }).then(r => r.json()).then(j => {
      const c = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
      if (c) {
        const sx2 = currentSession();
        if (sx2 && sx2.id === sx.id) {
          sx2.summary = c.trim();
          sx2.summarizedCount = sx2.messages.length - CTX_TURNS;
          saveSessionsStore();
        }
      }
    }).catch(() => { /* 摘要失败静默：仅影响旧细节，不影响最新窗口 */ })
      .finally(() => { summarizeBusy = false; });
  }

  function init() {
    listEl = $('chat-list');
    scrollEl = $('chat-scroll');
    inputEl = $('chat-input');
    sendBtn = $('btn-chat-send');
    stopBtn = $('btn-chat-stop');
    emptyEl = $('chat-empty');
    jumpBtn = $('chat-jump');
    tlEl = $('chat-timeline');
    scrollEl.addEventListener('scroll', onScroll);
    jumpBtn.addEventListener('click', () => { stick = true; follow(); updateJump(); });
    window.addEventListener('resize', renderTimeline);
    // 引用溯源：点击出处条目 → 跳到账本里那条记录亲眼核对
    $('snap-detail').addEventListener('click', (e) => {
      const ev = e.target.closest('.tr-ev');
      if (!ev) return;
      const ok = window.JG.locateRecord(ev.dataset.led, ev.dataset.rec);
      if (ok) window.MODAL.close();
      else toast('这条记录已不存在或账本数据有变动');
    });

    $('btn-session').addEventListener('click', (e) => { e.stopPropagation(); toggleSessionMenu(); });
    $('session-menu').addEventListener('click', (e) => e.stopPropagation());
    $('btn-model').addEventListener('click', (e) => { e.stopPropagation(); toggleModelMenu(); });
    $('model-menu').addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', (e) => {
      if (!$('session-menu').contains(e.target) && !$('btn-session').contains(e.target)) toggleSessionMenu(false);
      if (!$('model-menu').contains(e.target) && !$('btn-model').contains(e.target)) toggleModelMenu(false);
    });

    $('btn-chat-send').addEventListener('click', () => send(inputEl.value));
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(inputEl.value); }
    });
    inputEl.addEventListener('input', autosize);
    stopBtn.addEventListener('click', stopStream);
    $('btn-chat-clear').addEventListener('click', () => {
      if (!msgs.length) { toast('当前没有对话'); return; }
      if (!confirm('清空当前会话的全部消息？记录不会影响账本数据。')) return;
      if (streaming) { toast('AI 正在回答，请先停止'); return; }
      msgs = [];
      const sx = currentSession();
      if (sx) { sx.messages = []; sx.summary = ''; sx.summarizedCount = 0; sx.title = '新会话'; }
      saveSessionsStore();
      renderAll();
      updateSessionUI();
      toast('本会话已清空');
    });
    $('chat-chips').addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (chip) send(chip.dataset.q);
    });

    // chat.js 的 init 早于 app.js 完成账本装载：等 app 就绪后再做首次加载
    const waitAppReady = () => {
      if (window.JG && window.JG.getActiveLedger && window.JG.getActiveLedger()) reload();
      else setTimeout(waitAppReady, 60);
    };
    waitAppReady();
  }

  document.addEventListener('DOMContentLoaded', init);
  window.JGChat = { reload, onShow: renderTimeline };   // onShow：切到对话页时重算时间线
})();

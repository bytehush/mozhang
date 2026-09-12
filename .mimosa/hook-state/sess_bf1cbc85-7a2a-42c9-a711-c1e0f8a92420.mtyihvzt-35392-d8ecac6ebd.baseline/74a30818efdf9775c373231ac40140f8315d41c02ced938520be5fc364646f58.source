/* AI 军师对话模块：流式打字机聊天
   方法（四层）：
   1) 传输：POST /api/ai {stream:true} → 本地服务器 SSE 透传 → fetch 流读取
   2) 节奏：网络块先进平滑缓冲器，渲染循环自适应匀速取出——观感始终是打字机，
      网络快则出字快、网络慢也不卡顿，不会出现"干等几十秒"
   3) 渲染：每帧把已显示原文整体过迷你 Markdown 渲染器（先转义再解析，安全），
      末尾挂闪烁光标
   4) 体验：发送即出"推演中"呼吸气泡，首字到达原位变流式回答；多轮上下文 +
      每次注入最新记账统计；可停止；厂商不支持流时自动降级为"整段返回 + 打字机"
   5) 会话与记忆：每本账多会话（独立历史/状态/存储，活动指针按账本记忆）；
      长对话用"滚动摘要"——本地全量保留，发给模型时 = 人设 + 最新账本统计 +
      旧对话滚动摘要 + 最近若干条原文，摘要由模型后台自动压缩更新 */
(function () {
  'use strict';

  const SESSION_MSG_CAP = 80; // 每个会话最多保留的消息条数（本地全量，供摘要滚动压缩）
  const CTX_TURNS = 8;        // 发给模型的最近上下文条数（原文窗口）
  const MSG_CAP = 4000;       // 单条上下文截断长度
  const SUM_TRIG = 6;         // 超出原文窗口多少条时触发滚动摘要

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
      <div class="cm-bubble"></div>`;
    if (window.JGIcons) window.JGIcons.mount(wrap);
    return wrap;
  }
  function appendMsg(role, content, { save = true, snap = null } = {}) {
    emptyEl.classList.add('hidden');
    let el;
    if (role === 'user') el = userBubble(content);
    else {
      el = aiBubble();
      el.querySelector('.cm-bubble').innerHTML = renderMarkdown(content);
      // 操作行：复制 + 数据快照 + 数字核对徽章（透明化：让用户看到 AI 的依据）
      const actions = document.createElement('div');
      actions.className = 'cm-actions';
      const copy = document.createElement('button');
      copy.className = 'cm-copy';
      copy.textContent = '复制';
      copy.addEventListener('click', () => {
        navigator.clipboard.writeText(content).then(() => toast('已复制 ✓'), () => toast('复制失败'));
      });
      actions.appendChild(copy);
      if (snap) {
        const dataBtn = document.createElement('button');
        dataBtn.className = 'cm-copy';
        dataBtn.textContent = '📦 引用数据';
        const view = document.createElement('div');
        view.className = 'cm-snap hidden';
        view.innerHTML = '<div class="cs-label">本次真实发给模型的数据（AI 只能看到以下内容）：</div><pre>' +
          esc(snap.text) + '</pre>';
        dataBtn.addEventListener('click', () => {
          view.classList.toggle('hidden');
          dataBtn.textContent = view.classList.contains('hidden') ? '📦 引用数据' : '📥 收起数据';
        });
        actions.appendChild(dataBtn);
        el.appendChild(view);
        const g = groundingCheck(content, snap.source);
        if (g) {
          const badge = document.createElement('div');
          badge.className = 'cm-check ' + (g.miss ? 'warn' : 'ok');
          badge.textContent = g.miss
            ? `△ 数字核对：${g.refs} 个引用中 ${g.miss} 个未在快照中（多为推算或序号，请留意）`
            : `✓ 数字核对：回答中 ${g.refs} 个数字均来自账本数据快照`;
          actions.appendChild(badge);
        }
      }
      el.appendChild(actions);
    }
    listEl.appendChild(el);
    if (save) { msgs.push({ role, content, ...(snap ? { snapshot: snap } : {}) }); saveSessionMsgs(); }
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
  }
  function updateJump() {
    jumpBtn.classList.toggle('show', !stick && listEl.children.length > 0);
  }

  // 思考型模型的思考过程：在思考气泡里实时展示（用户能看见 AI 在想什么）
  function showReasoning(bubble, delta) {
    let box = bubble.querySelector('.cm-reasoning');
    if (!box) {
      bubble.innerHTML = '<div class="cm-reasoning"><div class="cr-label">💭 思考中</div><div class="cr-text"></div></div><div class="th-row"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>';
      box = bubble.querySelector('.cm-reasoning');
    }
    const txt = box.querySelector('.cr-text');
    txt.textContent += delta;
    if (txt.textContent.length > 3000) txt.textContent = txt.textContent.slice(-3000);
    txt.scrollTop = txt.scrollHeight;
  }
  function clearReasoning(bubble) {
    const box = bubble.querySelector('.cm-reasoning');
    if (box) box.remove();
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

  // ---------- 上下文与数据快照（透明化：AI 只能看到快照里的内容） ----------
  const HARD_RULES = [
    '【数据引用硬规则】',
    '1) 回答中的所有数字必须来自给你的统计数据或每日明细；',
    '2) 需要推算时（求和/差值/占比/环比等），必须写出算式来源并注明是推算；',
    '3) 给定材料中不存在的数字与事实一律不得编造；信息不足时直接说明，并建议用户补记；',
    '4) 引用数字时尽量带上日期或科目，方便用户核对。',
  ].join('\n');

  function buildContext() {
    const JG = window.JG;
    const led = JG.getActiveLedger();
    const tpl = JG.getActiveTemplate();
    let sys = tpl.ai.persona +
      `\n\n现在以"对话"方式与用户交流：语气自然，像面对面聊天，回答务必引用记账数据里的具体数字；` +
      `默认回答简洁（200~500字），用户要求详细报告时才展开；不要每次都输出完整报告结构，答其所问。\n\n` +
      HARD_RULES;
    const records = JG.getRecords();
    const stats = tpl.ai.buildStats(records);
    const daily = tpl.ai.dailyLines(records);
    let statsText = '';
    if (stats) {
      statsText = '【统计 JSON】\n' + JSON.stringify(stats, null, 2) + '\n【每日明细】\n' + daily;
      sys += '\n\n以下是最新记账统计与每日明细，回答时引用其中的数字：\n' + statsText;
    } else {
      sys += '\n\n（该账本还没有任何记录：可以正常聊天，但要提醒用户先记几笔才有数据可分析。）';
    }
    // 长对话记忆：旧对话的滚动摘要（后台自动压缩更新）注入系统提示
    const sx = currentSession();
    if (sx && sx.summary) {
      sys += '\n\n【此前对话的要点摘要】\n' + sx.summary;
    }
    const ctx = msgs.slice(-CTX_TURNS).map(m => ({
      role: m.role,
      content: String(m.content).slice(0, MSG_CAP),
    }));
    const messages = [{ role: 'system', content: sys.slice(0, 9000) }].concat(ctx);
    // 快照：本次真实发给模型的数据依据（用于界面展示与数字核对）
    const snapshot = led && records.length ? {
      ledger: led.name,
      model: (window.JG.ModelSwitch.activeInfo() || { model: null }).model?.model || '',
      time: Date.now(),
      text: '【账本】' + led.name + '\n【模型】' + ((window.JG.ModelSwitch.activeInfo() || { model: null }).model?.model || '') +
        '\n【统计 JSON】\n' + JSON.stringify(stats || {}, null, 2) +
        '\n【每日明细（最后90条）】\n' + (daily || '（无）'),
      source: statsText + (sx && sx.summary ? '\n【摘要】' + sx.summary : ''),
    } : null;
    return { messages, snapshot };
  }

  // ---------- SSE 流读取 ----------
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
      const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      if (content) onDelta(content);
      return;
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let done = false;
    let finishReason = null;
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
    return finishReason;
  }

  // ---------- 发送 ----------
  async function send(text) {
    if (streaming) return;
    text = (text || '').trim();
    if (!text) return;
    const JG = window.JG;
    const settings = JG.getSettings();
    const led = JG.getActiveLedger();
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

    // 思考中气泡（首字到达时原位变成流式回答）
    const el = aiBubble();
    const bubble = el.querySelector('.cm-bubble');
    bubble.classList.add('thinking');
    bubble.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span><span class="th-text">军师推演中…</span>';
    emptyEl.classList.add('hidden');
    listEl.appendChild(el);
    stick = true; follow(); updateJump();

    controller = new AbortController();
    const typer = makeTyper(bubble, (finalText) => {
      if (!active || active.typer !== typer) return;   // 已被停止终结，忽略迟到的完成
      finishExchange(el, bubble, finalText, false, ctx.snapshot);
    });
    active = { typer, bubble, el };

    const mp = window.JG.ModelSwitch.activeInfo();
    const ctx = buildContext();
    const api = window.JG.ModelSwitch.activeInfo();
    const body = {
      apiKey: api.apiKey,
      model: api.model ? api.model.model : 'glm-4-flash',
      baseUrl: api.baseUrl || '',
      messages: ctx.messages,
      temperature: 0.7,
      maxTokens: api.model ? api.model.maxOut : 3072,   // 按当前模型的档案限制输出
      stream: true,
    };

    try {
      if (!api.apiKey) throw new Error('当前厂商「' + api.name + '」还没有填写 API Key。请到「设置 → 模型设置」填写。');
      let first = true;
      let gotAny = false;
      // 首字看门狗：迟迟等不到第一个字时**直接终结本次交换**（不依赖 abort 能否打断读取——
      // 那在某些流实现上不可靠，正是"一直思考无输出"的根源），绝不无限思考
      const giveUp = () => {
        if (controller) controller.abort();
        if (!active || active.typer !== typer) return;
        const partial = typer.stop();
        finishExchange(el, bubble, partial, true);
        bubble.innerHTML = '<p class="cm-err">⚠️ 等了 15 秒没有收到回复，已自动停止。请重试；若反复出现，检查网络或到「设置 → 模型设置」换个模型。</p>';
      };
      let watchdog = setTimeout(giveUp, window.JGChat_FIRST_TOKEN_MS || 15000);
      const clearWatch = () => { if (watchdog) { clearTimeout(watchdog); watchdog = null; } };
      const finishReason = await streamRequest(body, controller, (delta, type) => {
        if (!active || active.typer !== typer) return;   // 已被终结，丢弃迟到的数据
        clearWatch();
        if (type === 'reasoning') { showReasoning(bubble, delta); return; }
        if (!gotAny) { gotAny = true; bubble.classList.remove('thinking'); clearReasoning(bubble); }
        typer.push(delta);
      });
      clearWatch();
      if (!typer.text().trim()) {
        // 流式全程没吐出内容（厂商 SSE 兼容问题或思考型模型耗尽输出额度）：自动降级非流式重试一次
        if (finishReason === 'length') {
          throw new Error('这个模型把输出额度花在了思考上没来得及回答，建议到「设置 → 模型设置」换一个非思考型模型（如 glm-4-flash）。');
        }
        const resp2 = await fetch('/api/ai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(Object.assign({}, body, { stream: false })),
          signal: controller.signal,
        });
        const data2 = await resp2.json().catch(() => null);
        if (!resp2.ok || !data2 || data2.error) {
          throw new Error((data2 && data2.error && data2.error.message) || `请求失败（HTTP ${resp2.status}）`);
        }
        const content2 = data2.choices && data2.choices[0] && data2.choices[0].message && data2.choices[0].message.content;
        if (!content2) throw new Error('AI 没有返回内容，请稍后重试。');
        bubble.classList.remove('thinking');
        typer.push(content2);
      }
      typer.finish();
    } catch (err) {
      if (watchdog) { clearTimeout(watchdog); watchdog = null; }
      const partial = typer.stop();
      active = null;
      bubble.classList.remove('thinking');
      streaming = false;
      stopBtn.classList.add('hidden');
      sendBtn.disabled = false;
      controller = null;
      const timedOut = err && err.name === 'AbortError' && !userStopped;
      if (partial.trim()) {
        // 已输出一半时出错：保留已出内容并附加错误说明
        bubble.innerHTML = renderMarkdown(partial) +
          `<p class="cm-err">（${esc(timedOut ? '等待超时' : (err.message || '已停止'))}）</p>`;
      } else if (timedOut) {
        bubble.innerHTML = '<p class="cm-err">⚠️ 等了 15 秒没有收到回复，已自动停止。请重试；若反复出现，检查网络或到「设置 → 模型设置」换个模型。</p>';
      } else {
        bubble.innerHTML = `<p class="cm-err">⚠️ ${esc(err.message || '生成失败，请确认本地服务窗口还开着。')}</p>`;
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
  // snap = 本次发给模型的数据快照（用于「📦 引用数据」展示与数字核对徽章）
  function finishExchange(el, bubble, finalText, stopped, snap) {
    bubble.classList.remove('thinking');
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
      msgs.push(entry);
      saveSessionMsgs();
      maybeSummarize();   // 长对话滚动摘要（后台压缩，不阻塞界面）
      // 操作行：复制 / 📦 引用数据（展开真实发送的数据快照）/ 数字核对徽章
      const actions = document.createElement('div');
      actions.className = 'cm-actions';
      const copy = document.createElement('button');
      copy.className = 'cm-copy';
      copy.textContent = '复制';
      copy.addEventListener('click', () => {
        navigator.clipboard.writeText(finalText).then(() => toast('已复制 ✓'), () => toast('复制失败'));
      });
      actions.appendChild(copy);
      if (snap) {
        const dataBtn = document.createElement('button');
        dataBtn.className = 'cm-copy';
        dataBtn.textContent = '📦 引用数据';
        const view = document.createElement('div');
        view.className = 'cm-snap hidden';
        view.innerHTML = '<div class="cs-label">本次真实发给模型的数据（AI 只能看到以下内容）：</div><pre>' +
          esc(snap.text) + '</pre>';
        dataBtn.addEventListener('click', () => {
          view.classList.toggle('hidden');
          dataBtn.textContent = view.classList.contains('hidden') ? '📦 引用数据' : '📥 收起数据';
        });
        actions.appendChild(dataBtn);
        el.appendChild(view);
        const g = groundingCheck(finalText, snap.source);
        if (g) {
          const badge = document.createElement('div');
          badge.className = 'cm-check ' + (g.miss ? 'warn' : 'ok');
          badge.textContent = g.miss
            ? `△ 数字核对：${g.refs} 个引用中 ${g.miss} 个未在快照中（多为推算或序号，请留意）`
            : `✓ 数字核对：回答中 ${g.refs} 个数字均来自账本数据快照`;
          actions.appendChild(badge);
        }
      }
      el.appendChild(actions);
    }
    stick = true; follow(); updateJump();
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
    msgs.forEach(m => appendMsg(m.role, m.content, { save: false, snap: m.snapshot || null }));
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
    if (inputEl) inputEl.placeholder = `问问当前账本「${led.name}」…（Enter 发送）`;
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
    scrollEl.addEventListener('scroll', onScroll);
    jumpBtn.addEventListener('click', () => { stick = true; follow(); updateJump(); });

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
  window.JGChat = { reload };
})();

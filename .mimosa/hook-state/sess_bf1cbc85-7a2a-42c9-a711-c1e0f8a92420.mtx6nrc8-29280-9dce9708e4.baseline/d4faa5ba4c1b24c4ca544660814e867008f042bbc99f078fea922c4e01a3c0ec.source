import io

p = 'js/chat.js'
s = io.open(p, encoding='utf-8').read()

# ── 会话菜单 / 模型菜单 / 滚动摘要：插在 init 之前 ──
old = """  function init() {
    listEl = $('chat-list');"""
new = """  // ---------- 会话选择器 ----------
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
    const cur = window.JG.ModelSwitch.current();
    $('model-label').textContent = providerName(cur.provider) + ' · ' + cur.model;
  }
  function buildModelMenu() {
    const menu = $('model-menu');
    const cur = window.JG.ModelSwitch.current();
    menu.innerHTML = window.JG.ModelSwitch.options().map(o =>
      `<div class="mm-group">${o.name}</div>` +
      o.models.map(m => `<button class="mm-item ${cur.provider === o.provider && cur.model === m ? 'active' : ''}" data-mp="${o.provider}" data-m="${m}">${m}</button>`).join('')
    ).join('') + '<div class="mm-note">自定义厂商请到「设置 → 模型设置」</div>';
    menu.querySelectorAll('.mm-item').forEach(b => {
      b.addEventListener('click', () => {
        const ok = window.JG.ModelSwitch.apply(b.dataset.mp, b.dataset.m);
        if (ok) { updateModelUI(); toast('已切换到 ' + b.dataset.m + ' ✓'); }
        toggleModelMenu(false);
      });
    });
  }
  function toggleModelMenu(force) {
    const menu = $('model-menu');
    const willOpen = force != null ? force : menu.classList.contains('hidden');
    if (willOpen) buildModelMenu();
    menu.classList.toggle('hidden', !willOpen);
  }

  // ---------- 长对话滚动摘要：旧对话后台压缩成要点，注入后续上下文 ----------
  function maybeSummarize() {
    const sx = currentSession();
    if (!sx || summarizeBusy) return;
    const aged = sx.messages.length - sx.summarizedCount - CTX_TURNS;
    if (aged < SUM_TRIG) return;                     // 未超出原文窗口太多，暂不压缩
    summarizeBusy = true;
    const settings = window.JG.getSettings();
    const cover = sx.messages.slice(0, sx.messages.length - CTX_TURNS);   // 待压缩的旧消息
    const content = (sx.summary ? '【既有摘要】\\n' + sx.summary + '\\n\\n【新增对话】\\n' : '') +
      cover.map(m => (m.role === 'user' ? '用户：' : '军师：') + String(m.content).slice(0, 600)).join('\\n');
    fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey: settings.apiKey, model: settings.model || 'glm-4-flash', baseUrl: settings.baseUrl || '',
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
    listEl = $('chat-list');"""
assert old in s, 'init 未匹配'
s = s.replace(old, new)

# ── init 内绑定新按钮 + 菜单外点关闭 ──
old = """    jumpBtn = $('chat-jump');
    scrollEl.addEventListener('scroll', onScroll);
    jumpBtn.addEventListener('click', () => { stick = true; follow(); updateJump(); });"""
new = """    jumpBtn = $('chat-jump');
    scrollEl.addEventListener('scroll', onScroll);
    jumpBtn.addEventListener('click', () => { stick = true; follow(); updateJump(); });

    $('btn-session').addEventListener('click', (e) => { e.stopPropagation(); toggleSessionMenu(); });
    $('session-menu').addEventListener('click', (e) => e.stopPropagation());
    $('btn-model').addEventListener('click', (e) => { e.stopPropagation(); toggleModelMenu(); });
    $('model-menu').addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', (e) => {
      if (!$('session-menu').contains(e.target) && !$('btn-session').contains(e.target)) toggleSessionMenu(false);
      if (!$('model-menu').contains(e.target) && !$('btn-model').contains(e.target)) toggleModelMenu(false);
    });"""
assert old in s, 'init 绑定未匹配'
s = s.replace(old, new)

io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('chat.js 菜单与摘要完成')

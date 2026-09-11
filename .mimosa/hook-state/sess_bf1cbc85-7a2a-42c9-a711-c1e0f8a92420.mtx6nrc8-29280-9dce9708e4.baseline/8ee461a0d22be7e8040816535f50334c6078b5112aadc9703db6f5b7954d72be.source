import io

p = 'js/chat.js'
s = io.open(p, encoding='utf-8').read()

# ── ① reload()：多会话装载（含旧单会话迁移） ──
old = """  function reload() {
    // 切换账本后重载该账本的聊天记录
    const led = window.JG && window.JG.getActiveLedger && window.JG.getActiveLedger();
    if (!led) return;   // app 尚未就绪（chat.js 的 init 早于 app.js 完成），由就绪后重试覆盖
    if (streaming && controller) controller.abort();
    storeLedgerId = led.id;
    if (inputEl) inputEl.placeholder = `问问当前账本「${led.name}」…（Enter 发送）`;
    renderAll();
  }"""
new = """  function reload() {
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
  }"""
assert old in s, 'reload 未匹配'
s = s.replace(old, new)

# ── ② buildMessages：滚动摘要注入 ──
old = """    const stats = tpl.ai.buildStats(JG.getRecords());
    if (stats) {
      sys += '\\n\\n以下是最新记账统计（JSON），回答时引用其中的数字：\\n' + JSON.stringify(stats);
    } else {
      sys += '\\n\\n（该账本还没有任何记录：可以正常聊天，但要提醒用户先记几笔才有数据可分析。）';
    }"""
new = """    const stats = tpl.ai.buildStats(JG.getRecords());
    if (stats) {
      sys += '\\n\\n以下是最新记账统计（JSON），回答时引用其中的数字：\\n' + JSON.stringify(stats);
    } else {
      sys += '\\n\\n（该账本还没有任何记录：可以正常聊天，但要提醒用户先记几笔才有数据可分析。）';
    }
    // 长对话记忆：旧对话的滚动摘要（后台自动压缩更新）注入系统提示
    const sx = currentSession();
    if (sx && sx.summary) {
      sys += '\\n\\n【此前对话的要点摘要】\\n' + sx.summary;
    }"""
assert old in s, 'buildMessages 未匹配'
s = s.replace(old, new)

# ── ③ send()：会话标题自动生成 + 存储走会话 ──
old = """    streaming = true;
    userStopped = false;
    inputEl.value = '';
    autosize();"""
new = """    streaming = true;
    userStopped = false;
    inputEl.value = '';
    autosize();
    // 会话标题：首条用户消息自动命名
    const sx0 = currentSession();
    if (sx0 && (!sx0.title || sx0.title === '新会话')) {
      sx0.title = text.slice(0, 18);
      saveSessionsStore();
      updateSessionUI();
    }"""
assert old in s, 'send 标题段未匹配'
s = s.replace(old, new)

# ── ④ finishExchange：存储走会话 + 触发滚动摘要 ──
old = """    if (finalText.trim()) {
      msgs.push({ role: 'assistant', content: finalText });
      saveChat();
    }
    stick = true; follow(); updateJump();
  }"""
new = """    if (finalText.trim()) {
      msgs.push({ role: 'assistant', content: finalText });
      saveSessionMsgs();
      maybeSummarize();   // 长对话滚动摘要（后台压缩，不阻塞界面）
    }
    stick = true; follow(); updateJump();
  }"""
assert old in s, 'finishExchange 未匹配'
s = s.replace(old, new)

# ── ⑤ 清空本会话：重置摘要 ──
old = """      if (!confirm('清空与 AI 军师的全部对话？记录不会影响账本数据。')) return;
      msgs = [];
      saveChat();
      renderAll();
      toast('对话已清空');"""
new = """      if (!confirm('清空当前会话的全部消息？记录不会影响账本数据。')) return;
      if (streaming) { toast('AI 正在回答，请先停止'); return; }
      msgs = [];
      const sx = currentSession();
      if (sx) { sx.messages = []; sx.summary = ''; sx.summarizedCount = 0; sx.title = '新会话'; }
      saveSessionsStore();
      renderAll();
      updateSessionUI();
      toast('本会话已清空');"""
assert old in s, '清空段未匹配'
s = s.replace(old, new)

io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('chat.js 核心会话逻辑完成')

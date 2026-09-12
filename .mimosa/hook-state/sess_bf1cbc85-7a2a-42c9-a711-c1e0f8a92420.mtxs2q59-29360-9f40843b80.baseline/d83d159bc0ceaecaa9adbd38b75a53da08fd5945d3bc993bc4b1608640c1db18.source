import io

p = 'js/chat.js'
s = io.open(p, encoding='utf-8').read()

# ── ① 头部注释与变量 ──
old = """   4) 体验：发送即出"推演中"呼吸气泡，首字到达原位变流式回答；多轮上下文 +
      每次注入最新记账统计；按账本保存聊天记录；可停止；厂商不支持流时自动
      降级为"整段返回 + 打字机" */"""
new = """   4) 体验：发送即出"推演中"呼吸气泡，首字到达原位变流式回答；多轮上下文 +
      每次注入最新记账统计；可停止；厂商不支持流时自动降级为"整段返回 + 打字机"
   5) 会话与记忆：每本账多会话（独立历史/状态/存储，活动指针按账本记忆）；
      长对话用"滚动摘要"——本地全量保留，发给模型时 = 人设 + 最新账本统计 +
      旧对话滚动摘要 + 最近若干条原文，摘要由模型后台自动压缩更新 */"""
assert old in s, '头部注释'
s = s.replace(old, new)

old = """  let active = null;          // { typer, bubble, el } 当前流式交换
  let userStopped = false;    // 区分「用户手动停止」与「看门狗超时」"""
new = """  let active = null;          // { typer, bubble, el } 当前流式交换
  let userStopped = false;    // 区分「用户手动停止」与「看门狗超时」
  let sessions = [];          // 当前账本的会话列表
  let sessionId = null;       // 当前会话 id
  let summarizeBusy = false;  // 滚动摘要后台压缩中"""
assert old in s, '变量声明'
s = s.replace(old, new)

# ── ② 会话存储（替换旧单会话 loadChat/saveChat） ──
old = """  // ---------- 历史存取（按账本） ----------
  function loadChat() {
    try { return JSON.parse(localStorage.getItem('jigong_chat_' + storeLedgerId)) || []; }
    catch { return []; }
  }
  function saveChat() {
    localStorage.setItem('jigong_chat_' + storeLedgerId, JSON.stringify(msgs.slice(-CHAT_CAP)));
  }"""
new = """  // ---------- 会话存取（每账本多会话；会话对象自带 messages，删会话即删数据，无孤儿键） ----------
  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    const buf = new Uint8Array(12);
    crypto.getRandomValues(buf);
    return 's-' + Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
  }
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
  function providerName(p) {
    const o = (window.JG.ModelSwitch.options() || []).find(x => x.provider === p);
    return o ? o.name : p;
  }"""
assert old in s, '会话存取段'
s = s.replace(old, new)

# 常量补充
old = """  const CHAT_CAP = 30;        // 每本账最多保留的消息条数
  const CTX_TURNS = 8;        // 发给模型的最近上下文条数
  const MSG_CAP = 4000;       // 单条上下文截断长度"""
new = """  const SESSION_MSG_CAP = 80; // 每个会话最多保留的消息条数（本地全量，供摘要滚动压缩）
  const CTX_TURNS = 8;        // 发给模型的最近上下文条数（原文窗口）
  const MSG_CAP = 4000;       // 单条上下文截断长度
  const SUM_TRIG = 6;         // 超出原文窗口多少条时触发滚动摘要"""
assert old in s, '常量段'
s = s.replace(old, new)

io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('chat.js 会话存储骨架完成')

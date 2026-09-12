import io

# ── app.js：删本地定义 → 解构引用 ──
p = 'js/app.js'
s = io.open(p, encoding='utf-8').read()

old = """  // ---------- 工具 ----------
  function $(id) { return document.getElementById(id); }
  function wait(ms) { return new Promise(r => setTimeout(r, ms)); }
  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    const buf = new Uint8Array(16);
    crypto.getRandomValues(buf);
    return 'l-' + Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  function round2(n) { return Math.round(n * 100) / 100; }
  function money(n) { return '¥' + round2(n).toFixed(2); }
  function fmtDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }"""
new = """  // ---------- 工具（公共版在 js/utils.js） ----------
  const { $, wait, uid, round2, money, fmtDate, esc, toast, REDUCED } = window.UTIL;"""
assert old in s, 'app.js 工具区未匹配'
s = s.replace(old, new)

# 旧 toast 定义（恢复版）删除
old2 = """  let toastTimer = null;
  function toast(msg) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }

"""
assert old2 in s, 'app.js toast 定义未匹配'
s = s.replace(old2, '')

# REDUCED 本地常量删除（utils 已有）
old3 = """  const REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
"""
assert old3 in s, 'app.js REDUCED 未匹配'
s = s.replace(old3, '')

io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('app.js 完成')

# ── chat.js ──
p = 'js/chat.js'
s = io.open(p, encoding='utf-8').read()

old = """  // ---------- 工具 ----------
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }"""
new = """  // ---------- 工具（公共版在 js/utils.js） ----------
  const { esc, uid, wait, toast, REDUCED } = window.UTIL;"""
assert old in s, 'chat.js 工具区未匹配'
s = s.replace(old, new)

# chat.js 旧 uid 定义删除（若无则跳过）
old2 = """  // 记录 id：优先 UUID，兜底用加密安全随机数（不用 Math.random）
  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    const buf = new Uint8Array(12);
    crypto.getRandomValues(buf);
    return 's-' + Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
  }
"""
if old2 in s:
    s = s.replace(old2, '')
    print('chat.js uid 定义删除')

# chat.js 旧 toast 委托定义删除
old3 = """  function toast(msg) { if (window.JG) window.JG.toast(msg); }
"""
if old3 in s:
    s = s.replace(old3, '')
    print('chat.js toast 委托删除')

# chat.js REDUCED/wait 本地常量删除
s = s.replace("""  const REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
""", "")
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('chat.js 完成')

# ── templates.js ──
p = 'js/templates.js'
s = io.open(p, encoding='utf-8').read()

old = """  // 记录 id：优先 UUID，兜底用加密安全随机数（不用 Math.random）
  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    const buf = new Uint8Array(16);
    crypto.getRandomValues(buf);
    return 'r-' + Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
  }"""
new = """  const { uid, round2, money, weekdayCN, hoursBetween } = window.UTIL;"""
assert old in s, 'templates uid 未匹配'
s = s.replace(old, new)

old2 = """  const round2 = n => Math.round(n * 100) / 100;
  const money = n => '¥' + round2(n).toFixed(2);
  const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
  const weekdayCN = s => { const d = new Date(s + 'T00:00:00'); return isNaN(d) ? '' : '周' + WEEK[d.getDay()]; };
"""
assert old2 in s, 'templates 基础工具未匹配'
s = s.replace(old2, '')

old3 = """  // 计算两个时间之间的小时数；结束<=开始 视为跨零点
  function hoursBetween(start, end) {
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    let mins = (eh * 60 + em) - (sh * 60 + sm);
    if (mins <= 0) mins += 24 * 60;
    return round2(mins / 60);
  }
"""
assert old3 in s, 'templates hoursBetween 未匹配'
s = s.replace(old3, '')

io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('templates.js 完成')

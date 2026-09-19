/* 冒烟测试断言（V0.15.6 从 smoke.html 内联外置）：
   ① server 已加 CSP（script-src 'self'），内联脚本会被拦截，断言必须走外部文件；
   ② 顺带修复 V0.9.9 引入的两处旧伤：错误钩子字符串内裸换行（语法错误，
      导致本页断言脚本自那时起从未执行过）、「会话存取」用例引用未定义的 key 变量。 */
(function () {
  'use strict';
  const log = [];
  let all = true;
  const ok = (name, cond) => { log.push((cond ? '✓ ' : '✗ ') + name); if (!cond) all = false; return cond; };

  window.addEventListener('load', async () => {
    await new Promise(r => setTimeout(r, 300));   // 等各模块 DOMContentLoaded 完成

    // ① 加载期零报错
    ok('页面加载零报错', (window.__errors || []).length === 0);

    // ② utils 公共工具可用
    ok('utils 工具可用', typeof window.UTIL === 'object'
      && typeof window.UTIL.esc === 'function' && typeof window.UTIL.uid === 'function'
      && typeof window.UTIL.toast === 'function');

    // ③ 模板齐备（三类账本）
    ok('模板齐备', Object.keys(window.JG_TEMPLATES.byId).length >= 3);

    // ④ 账本已装载（迁移后至少一本）
    const ledgers = window.STORE.loadLedgers();
    ok('账本已装载', ledgers.length >= 1);

    // ⑤ 厂商 API 分组齐备
    const apis = (window.JG.getSettings().apis || {});
    ok('厂商 API 就绪', Object.keys(apis).length >= 4);

    // ⑥ 当前模型档案可用（默认智谱 GLM-4-Flash 预设）
    const cur = window.JG.ModelSwitch.activeInfo();
    ok('当前模型配置存在', !!(cur && (cur.model || (cur.models && cur.models.length))));

    // ⑦ 模块挂载齐全
    ok('模块挂载齐全', !!window.JG && !!window.JGChat && !!window.JGCharts
      && !!window.JGIcons && !!window.MODAL && !!window.STORE && !!window.UTIL);

    // ⑧ 会话存取正常（写入→读回→清理）
    try {
      const ledId = localStorage.getItem('jigong_active_ledger') || 'smoke';
      const key = 'jigong_sessions_' + ledId;   // V0.15.6 修复：原用例引用了未定义的 key
      const probe = [{ id: 'smoke', title: '冒烟探针', messages: [{ role: 'user', content: 'x' }], summary: '', summarizedCount: 0 }];
      const bak = localStorage.getItem(key);
      localStorage.setItem(key, JSON.stringify(probe));
      const back = JSON.parse(localStorage.getItem(key));
      ok('会话存取正常', back[0].id === 'smoke');
      if (bak === null) localStorage.removeItem(key); else localStorage.setItem(key, bak);
    } catch { ok('会话存取正常', false); }

    document.getElementById('result').textContent = all ? '✅ 冒烟全部通过' : '❌ 存在失败项，见下方明细';
    document.getElementById('result').className = all ? 'pass' : 'fail';
    document.getElementById('log').textContent = log.join('\n');
  });
})();

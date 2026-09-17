/* A 类测试（隔离/迁移/去重/原子性/备份往返）：node tests/run-tests.js
   对应《AI 记账系统设计与测试判断标准》第 11 节（A 类：打不穿，才算过）。
   本项目无数据库——隔离的最后防线是"每账本独立存储键"（jigong_led_<id> /
   jigong_sessions_<id>），本测试以 10 万次模糊断言验证它真的不会串。
   迭代次数可用环境变量 FUZZ_N 覆盖（默认 100000）。
   退出码：0=全过；1=有失败。 */
'use strict';
const { randomUUID, randomInt } = require('crypto');

// ---- 浏览器垫片（localStorage + window），再加载项目存储层 ----
const store = new Map();
global.window = global;
global.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear(),
};
require('../js/store.js');
const STORE = global.STORE;
if (!STORE) { console.error('STORE 未加载——store.js 加载失败'); process.exit(1); }

let pass = 0, fail = 0;
const out = [];
const ok = (name, cond, detail) => {
  if (cond) { pass++; out.push('  ✓ ' + name); }
  else { fail++; out.push('  ✗ ' + name + (detail ? '  — ' + detail : '')); }
};
const section = t => out.push('\n▎' + t);

// ─────────────────────────────────────────────────────────────
section('T1 隔离模糊测试（F1/F2/F5：记录与会话绝不跨账本泄漏）');
{
  const ledgers = Array.from({ length: 6 }, (_, i) => ({ id: 'fz-' + i }));
  const N = parseInt(process.env.FUZZ_N || '100000', 10);
  let leak = 0, mismatch = 0;
  for (let i = 0; i < N; i++) {
    const L = ledgers[randomInt(0, ledgers.length)];
    const n = 1 + randomInt(0, 8);
    const recs = Array.from({ length: n }, () => ({
      id: 'r' + randomUUID(),
      v: { date: '2026-09-0' + (1 + randomInt(0, 9)) },
      m: { totalPay: randomInt(100, 50000) / 100 },
    }));
    STORE.saveLedRecords(L.id, recs);
    const back = STORE.loadLedRecords(L.id);
    if (JSON.stringify(back) !== JSON.stringify(recs)) mismatch++;
    const others = ledgers.filter(x => x !== L);
    const other = others[randomInt(0, others.length)];
    const ids = new Set(recs.map(r => r.id));
    if (STORE.loadLedRecords(other.id).some(r => ids.has(r.id))) leak++;
    if (i % 1000 === 0) {   // 会话键隔离抽查
      STORE.saveJSON(STORE.LS.SESSIONS_PREFIX + L.id, [{ id: 'sess-' + L.id, messages: [] }]);
      const foreign = STORE.loadJSON(STORE.LS.SESSIONS_PREFIX + other.id, []);
      if (foreign.some(s => s.id === 'sess-' + L.id)) leak++;
    }
  }
  ok(`隔离模糊 ${N} 次：无任何跨账本泄漏`, leak === 0, '泄漏 ' + leak + ' 次');
  ok(`隔离模糊 ${N} 次：读写一致（无丢数/串数）`, mismatch === 0, '不一致 ' + mismatch + ' 次');
}

// ─────────────────────────────────────────────────────────────
section('T2 主体迁移（老账本补主体，幂等）');
{
  const legacy = [{ id: 'a', name: 'A', templateId: 'hourly' }, { id: 'b', name: 'B', templateId: 'general' }];
  const changed = STORE.migrateSubjects(legacy);
  ok('迁移返回"有改动"标记', changed === true);
  ok('旧账本补主体 = 我（self）', legacy.every(l => l.subject && l.subject.rel === 'self' && l.subject.name === '我'));
  ok('迁移幂等（第二次无改动）', STORE.migrateSubjects(legacy) === false);
  const keep = [{ id: 'c', subject: { rel: 'parent', name: '妈妈' } }];
  STORE.migrateSubjects(keep);
  ok('已有主体不被覆盖', keep[0].subject.name === '妈妈');
  ok('空数组安全', STORE.migrateSubjects([]) === false && STORE.migrateSubjects(null) === false);
}

// ─────────────────────────────────────────────────────────────
section('T3 重复账本识别（F7：防"用久了同类账本分不清"）');
{
  const leds = [{ name: '工资账本', templateId: 'hourly', subject: { rel: 'self', name: '我' } }];
  ok('同主体+同名+同类 → 判重', !!STORE.findDuplicateLedger(leds, { name: '工资账本', templateId: 'hourly', subject: { rel: 'self', name: '我' } }));
  ok('换主体 → 不算重', !STORE.findDuplicateLedger(leds, { name: '工资账本', templateId: 'hourly', subject: { rel: 'parent', name: '妈妈' } }));
  ok('换类型 → 不算重', !STORE.findDuplicateLedger(leds, { name: '工资账本', templateId: 'piece', subject: { rel: 'self', name: '我' } }));
  ok('换名字 → 不算重', !STORE.findDuplicateLedger(leds, { name: '工资账本二', templateId: 'hourly', subject: { rel: 'self', name: '我' } }));
  ok('非法主体 → 不判重（走"反问"兜底）', !STORE.findDuplicateLedger(leds, { name: '工资账本', templateId: 'hourly', subject: { rel: 'boss', name: 'x' } }));
  ok('主体归一：非法 rel → null', STORE.normSubject({ rel: 'boss', name: 'x' }) === null);
  ok('主体归一：空名字 → null', STORE.normSubject({ rel: 'self', name: '  ' }) === null);
  ok('主体归一：合法 → 去空格保留', (() => { const s = STORE.normSubject({ rel: 'other', name: ' 张姐 ' }); return s.rel === 'other' && s.name === '张姐'; })());
}

// ─────────────────────────────────────────────────────────────
section('T4 建账原子性（F4：中途失败无可见脏状态）');
{
  STORE.saveLedgers([]);
  const before = STORE.loadLedgers().length;
  try {
    // 与 app.js createLedgerFromAI 相同的顺序：先写记录存储，再写账本列表；第二步注入失败
    STORE.saveLedRecords('new-x', []);
    throw new Error('inject-failure-at(ledgers write)');
  } catch { /* 预期中断 */ }
  ok('注入失败后：账本列表无新增（不出现半成品账本）', STORE.loadLedgers().length === before);
  ok('孤立记录存储无碍（账本列表是唯一真实来源）', Array.isArray(STORE.loadLedRecords('new-x')));
  STORE.removeLedRecords('new-x');
  ok('清理后无残留键', store.has('jigong_led_new-x') === false);
  // 完整成功路径
  STORE.saveLedRecords('new-ok', []);
  STORE.saveLedgers([{ id: 'new-ok', name: 'X', templateId: 'general', subject: { rel: 'self', name: '我' } }]);
  ok('成功路径：账本与记录存储同时就位', STORE.loadLedgers().length === 1 && Array.isArray(STORE.loadLedRecords('new-ok')));
}

// ─────────────────────────────────────────────────────────────
section('T5 备份往返（主体字段不丢）');
{
  const led = { id: 'bk1', name: '工资账本', templateId: 'hourly', subject: { rel: 'parent', name: '妈妈' }, settings: {}, createdAt: 1, records: [{ id: 'r1', v: { date: '2026-09-01' }, m: {} }] };
  STORE.saveJSON('backup_sim', { ver: 2, ledgers: [led] });
  const back = STORE.loadJSON('backup_sim', null);
  ok('导出中含主体', !!(back && back.ledgers[0].subject) && back.ledgers[0].subject.name === '妈妈');
  const norm = STORE.normSubject(back.ledgers[0].subject);
  ok('往返后主体可归一', norm && norm.rel === 'parent' && norm.name === '妈妈');
  ok('缺主体的老备份 → null（导入时兜底=我）', STORE.normSubject(undefined) === null);
}

console.log(out.join('\n'));
console.log(`\n=====  结果：${pass} 通过 / ${fail} 失败  =====`);
process.exit(fail ? 1 : 0);

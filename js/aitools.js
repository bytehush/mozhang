/* AI 工具层（V0.10.0 Agent 化）：
   把"查账本数据"封装成可被大模型调用的工具（Function Calling / 工具调用）。
   chat.js 把 schemas 随请求声明给模型；模型自主决策：需要数据时返回 tool_calls，
   chat.js 调 run() 在本地执行，把结果回喂给模型 —— 数据不再预先塞进提示词，
   模型只能通过工具拿到真实数据，没查过的就答不了，从机制上防编造。
   工具清单：
     list_ledgers    列出所有账本（主体·名称/类型/记录数/日期范围）
     get_stats       某账本整体统计指标（复用模板 buildStats，中文键）
     get_daily       某账本按天汇总明细（中文键，模型可直接引用）
     get_day_records 某天全部原始记录（含时段/单价/备注等细节）
     create_ledger   新建账本（主体+类型必须明确；创建由 app.js 确定性执行，含糊即拒绝）
   主体维度：账本带 subject{rel,name}（我/爸爸/妈妈/爱人/孩子/全家/其他），
   全名展示为"主体·账本名"；同名多本时会报歧义要求用主体区分——禁止模型猜。
   结果对象一律用中文键：模型引用更稳，界面数字核对也按这些文本比对。 */
(function () {
  'use strict';

  const { round2 } = window.UTIL;
  const T = () => window.JG_TEMPLATES;

  // ---------- 账本与记录定位 ----------
  const displayName = l => (l.subject ? l.subject.name : '我') + '·' + l.name;
  function resolveLedger(name) {
    const JG = window.JG;
    const ledgers = JG.getLedgers() || [];
    if (!ledgers.length) throw new Error('用户还没有创建任何账本');
    if (!name || !String(name).trim()) return JG.getActiveLedger();
    const q = String(name).trim();
    // ① 全名匹配（主体·账本名）
    let led = ledgers.find(l => displayName(l) === q);
    // ② 裸名匹配：同名多本时必须报歧义，让模型用主体区分或反问用户（禁止猜）
    if (!led) {
      const hits = ledgers.filter(l => l.name === q);
      if (hits.length === 1) led = hits[0];
      else if (hits.length > 1) throw new Error('有多本账本都叫「' + q + '」，请用主体区分：' + hits.map(displayName).join('、') + '（拿不准就反问用户）');
    }
    // ③ 模糊包含：唯一才接受
    if (!led) {
      const hits = ledgers.filter(l => displayName(l).includes(q) || l.name.includes(q));
      if (hits.length === 1) led = hits[0];
      else if (hits.length > 1) throw new Error('匹配到多本账本：' + hits.map(displayName).join('、') + '。请用完整名称（主体·账本名）重新调用');
    }
    if (!led) throw new Error('找不到账本「' + q + '」。可用的账本有：' + ledgers.map(displayName).join('、'));
    return led;
  }
  function recsOf(led) {
    // 当前账本直接用内存里的，其他账本从存储读取
    const active = window.JG.getActiveLedger();
    return led.id === (active && active.id) ? window.JG.getRecords() : (window.STORE.loadLedRecords(led.id) || []);
  }
  function tplOf(led) { return T().byId[led.templateId] || T().byId.hourly; }

  // ---------- 工具实现 ----------
  function toolListLedgers() {
    return (window.JG.getLedgers() || []).map(led => {
      const recs = recsOf(led);
      let range = '暂无记录';
      if (recs.length) {
        const days = T().groupByDate(recs);
        range = days[0].date + ' ~ ' + days[days.length - 1].date;
      }
      return { 账本: displayName(led), 主体: led.subject ? led.subject.name : '我', 类型: tplOf(led).name, 记录数: recs.length, 日期范围: range };
    });
  }

  function toolGetStats(args) {
    const led = resolveLedger(args.ledger);
    const recs = recsOf(led);
    const stats = tplOf(led).ai.buildStats(recs);
    return { 账本: led.name, 类型: tplOf(led).name, 统计: stats || '该账本还没有任何记录' };
  }

  function toolGetDaily(args) {
    const led = resolveLedger(args.ledger);
    const recs = recsOf(led);
    const n = Math.min(Math.max(parseInt(args.days, 10) || 30, 1), 120);
    const days = T().groupByDate(recs).slice(-n);
    const sum = (items, f) => round2(items.reduce((s, r) => s + f(r), 0));
    const tid = led.templateId;
    const rows = days.map(d => {
      const row = { 日期: d.date, 记录数: d.items.length };
      if (tid === 'hourly') {
        row['正常工时h'] = sum(d.items, r => r.m.nHours);
        row['加班工时h'] = sum(d.items, r => r.m.oHours);
        row['工资元'] = sum(d.items, r => r.m.totalPay);
      } else if (tid === 'piece') {
        row['件数'] = sum(d.items, r => r.v.count || 0);
        row['工钱元'] = sum(d.items, r => r.m.pay);
      } else {
        row['收入元'] = sum(d.items, r => r.v.income || 0);
        row['支出元'] = sum(d.items, r => r.v.expense || 0);
        row['结余元'] = sum(d.items, r => r.m.net);
      }
      return row;
    });
    return { 账本: led.name, 类型: tplOf(led).name, 返回天数: rows.length, 每日明细: rows.length ? rows : '该账本还没有任何记录' };
  }

  function toolGetDayRecords(args) {
    const date = String(args.date || '').trim();
    if (!/^\d{4}-\d{1,2}-\d{1,2}$/.test(date)) throw new Error('日期格式应为 YYYY-MM-DD，例如 2026-09-10');
    const led = resolveLedger(args.ledger);
    const recs = recsOf(led).filter(r => r.v.date === date);
    const V = {
      hourly: { date: '日期', nStart: '正常班开始', nEnd: '正常班结束', oStart: '加班开始', oEnd: '加班结束', nRate: '正常时薪元', oRate: '加班时薪元', note: '备注' },
      piece: { date: '日期', count: '完成件数', price: '单价元', note: '备注' },
      general: { date: '日期', income: '收入元', expense: '支出元', item: '项目', note: '备注' },
    }[led.templateId] || {};
    const M = {
      hourly: { nHours: '正常工时h', oHours: '加班工时h', totalHours: '总工时h', nPay: '正常工资元', oPay: '加班费元', totalPay: '合计工资元' },
      piece: { pay: '工钱元' },
      general: { net: '结余元' },
    }[led.templateId] || {};
    return {
      账本: displayName(led), 日期: date, 记录数: recs.length,
      记录: recs.map(r => {
        const row = {};
        Object.keys(r.v).forEach(k => { if (V[k]) row[V[k]] = r.v[k]; });
        Object.keys(r.m || {}).forEach(k => { if (M[k]) row[M[k]] = r.m[k]; });
        return row;
      }),
    };
  }

  // ---------- 对模型声明的工具 schema（OpenAI 兼容 tools 格式） ----------
  const schemas = [
    {
      type: 'function',
      function: {
        name: 'list_ledgers',
        description: '列出用户的所有账本：名称、类型、记录数与日期范围。想查数据但不确定账本名称时先调用它。',
        parameters: { type: 'object', properties: {}, required: [] },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_stats',
        description: '获取某个账本的整体统计指标（累计、日均、最近7天环比、最高纪录等）。涉及"总共/平均/趋势/最近一周"等整体问题时调用。',
        parameters: {
          type: 'object',
          properties: { ledger: { type: 'string', description: '账本名称，不填默认当前账本' } },
          required: [],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_daily',
        description: '获取某个账本按天汇总的明细（每天工时/工资/收支等）。涉及"每天/某段时间/这个月/逐日对比"等问题时调用。',
        parameters: {
          type: 'object',
          properties: {
            ledger: { type: 'string', description: '账本名称，不填默认当前账本' },
            days: { type: 'number', description: '返回最近多少天，默认30，最大120' },
          },
          required: [],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_day_records',
        description: '获取某一天的全部原始记账记录（含时段、单价、备注等细节）。用户问到具体某一天的情况时调用。',
        parameters: {
          type: 'object',
          properties: {
            ledger: { type: 'string', description: '账本名称（推荐用"主体·账本名"，如"妈妈·工资账本"），不填默认当前账本' },
            date: { type: 'string', description: '日期，格式 YYYY-MM-DD，如 2026-09-10' },
          },
          required: ['date'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'create_ledger',
        description: '为用户新建一本账本。仅当用户明确要求新建、并且"给谁记的"（主体）和账本类型都已明确时才可调用；主体或类型不明确时必须先在回复里反问用户，禁止默认、禁止猜测。创建前建议先用 list_ledgers 检查是否已有同主体同名的账本。',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '账本名称，如"工资账本"；用户没起名时可给一个简洁的默认名' },
            subject_rel: { type: 'string', enum: ['self', 'parent', 'spouse', 'child', 'family', 'other'], description: '给谁记的：self=用户本人，parent=父母，spouse=爱人，child=孩子，family=全家共用，other=其他（需同时给 subject_name）' },
            subject_name: { type: 'string', description: '主体称呼：self 填"我"；parent/spouse/child 填具体称呼（如"妈妈"）；other 填自定义称呼（如"张姐"）' },
            template: { type: 'string', enum: ['hourly', 'piece', 'general'], description: '账本类型：hourly=计时工账本，piece=计件工账本，general=通用收支账本' },
          },
          required: ['name', 'subject_rel', 'subject_name', 'template'],
        },
      },
    },
  ];

  // ---------- 对外 ----------
  window.AITOOLS = {
    schemas,
    // 本地执行一次工具调用（name 须是 schemas 里声明过的工具名）
    run(name, args) {
      args = args || {};
      switch (name) {
        case 'list_ledgers': return toolListLedgers();
        case 'get_stats': return toolGetStats(args);
        case 'get_daily': return toolGetDaily(args);
        case 'get_day_records': return toolGetDayRecords(args);
        case 'create_ledger': return window.JG.createLedgerFromAI(args);   // 创建由 app.js 确定性执行
        default: throw new Error('未知工具：' + name);
      }
    },
    ledgerDir() {
      return toolListLedgers().map(l =>
        `- ${l.账本}（${l.类型}，${l.记录数} 条${l.记录数 ? '，' + l.日期范围 : ''}）`).join('\n') || '（还没有账本）';
    },
  };
})();

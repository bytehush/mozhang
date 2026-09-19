/* 模板注册表：每一种账 = 一个模板
   模板声明：表单字段（kind 积木渲染）、算钱规则（安全积木 compute）、
   表格列、卡片、汇总卡、图表、筛选、AI 人设。
   内置模板：hourly 计时工 / piece 计件工 / general 通用收支。
   记录统一形态：{ id, v:{原始字段}, m:{计算指标} } */
(function () {
  'use strict';


  const { uid, round2, money, weekdayCN, hoursBetween, esc } = window.UTIL;


  // 按日期聚合（同一天多条合并），升序，label=MM-DD
  function groupByDate(records) {
    const map = new Map();
    records.forEach(r => {
      const d = r.v.date;
      if (!map.has(d)) map.set(d, { date: d, label: d.slice(5), items: [] });
      map.get(d).items.push(r);
    });
    return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
  }
  const sumBy = (items, f) => round2(items.reduce((s, r) => s + f(r), 0));

  /* ============ 图表数据集样式助手（供模板 buildCharts 使用） ============ */
  const KIT = {
    C: {
      teal: '#2e7d74', tealLight: '#4da196', tealBg: 'rgba(77,161,150,.20)',
      cinnabar: '#c4685a', cinnabarBg: 'rgba(196,104,90,.22)',
      gold: '#b08a2e', goldBright: '#d4b45a', goldBg: 'rgba(212,180,90,.20)',
      blue: '#7ba7bc', blueBg: 'rgba(123,167,188,.22)',
      grid: 'rgba(34,50,45,.10)', text: '#6f8079',
    },
    tooltip: {
      backgroundColor: 'rgba(22,36,31,.94)', padding: 12, cornerRadius: 4,
      borderColor: 'rgba(212,180,90,.5)', borderWidth: 1,
      titleColor: '#ecd9a0', titleFont: { family: '"KaiTi","STKaiti","SimSun",serif', size: 13 },
      bodyColor: '#d8e4de', boxPadding: 6,
    },
    baseOptions(yTitle, extra) {
      return Object.assign({
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { labels: { color: KIT.C.text, font: { size: 12 }, usePointStyle: true, pointStyle: 'circle' } },
          tooltip: KIT.tooltip,
        },
        scales: {
          x: { ticks: { color: KIT.C.text, font: { size: 11 }, maxRotation: 60, autoSkip: true, maxTicksLimit: 16 }, grid: { display: false } },
          y: {
            beginAtZero: true,
            title: { display: true, text: yTitle, color: KIT.C.text, font: { size: 12 } },
            ticks: { color: KIT.C.text, font: { size: 11 } },
            grid: { color: KIT.C.grid },
          },
        },
      }, extra || {});
    },
    line(cfg) { return Object.assign({ type: 'line', tension: 0.35, pointRadius: 3, pointHoverRadius: 5, borderWidth: 2.5 }, cfg); },
    bar(cfg) { return Object.assign({ type: 'bar', borderWidth: 1.5, barPercentage: 0.62, order: 2 }, cfg); },
  };

  /* ================= 模板①：计时工（按小时计薪） ================= */
  const hourly = {
    id: 'hourly',
    name: '计时工账本',
    tagline: '按小时计薪：正常班 + 加班，自动算钱',
    icon: { svg: 'tpl-hourly', emoji: '⏱️' },
    accent: '#43a79a',
    defaultsFields: [
      { key: 'nRate', label: '默认正常时薪（元/小时）', kind: 'number', step: 0.5, min: 0, def: 20 },
      { key: 'oRate', label: '默认加班时薪（元/小时）', kind: 'number', step: 0.5, min: 0, def: 30 },
    ],
    form: [
      { type: 'row', fields: [{ kind: 'date', key: 'date', label: '日期', required: true }, { kind: 'spacer' }] },
      { type: 'group', title: '正常班时间段 *', fields: [
        { kind: 'time', key: 'nStart', label: '开始时间', def: '08:00' },
        { kind: 'time', key: 'nEnd', label: '结束时间', def: '17:00' },
      ] },
      { type: 'toggle', key: 'hasOT', label: '今天有加班', block: {
        title: '加班时间段',
        fields: [
          { kind: 'time', key: 'oStart', label: '开始时间', def: '17:30' },
          { kind: 'time', key: 'oEnd', label: '结束时间', def: '20:00' },
        ] } },
      { type: 'group', title: '时薪（默认取账本设置，可单独修改）', fields: [
        { kind: 'number', key: 'nRate', label: '正常时薪（元/小时）', step: 0.5, min: 0, fromLedger: 'nRate' },
        { kind: 'number', key: 'oRate', label: '加班时薪（元/小时）', step: 0.5, min: 0, fromLedger: 'oRate' },
      ] },
    ],
    // 安全积木：时长 × 时薪（分段，加班可选，跨零点自动进位）
    compute(v) {
      const nHours = hoursBetween(v.nStart, v.nEnd);
      const hasOT = !!(v.oStart && v.oEnd);
      const oHours = hasOT ? hoursBetween(v.oStart, v.oEnd) : 0;
      const nPay = round2(nHours * (v.nRate || 0));
      const oPay = round2(oHours * (v.oRate || 0));
      return { nHours, oHours, totalHours: round2(nHours + oHours), nPay, oPay, totalPay: round2(nPay + oPay) };
    },
    preview(v) {
      if (!v.nStart || !v.nEnd) return '请先填写正常班的开始和结束时间。';
      const nHours = hoursBetween(v.nStart, v.nEnd);
      const hasOT = !!(v.oStart && v.oEnd);
      const oHours = hasOT ? hoursBetween(v.oStart, v.oEnd) : 0;
      const nPay = round2(nHours * (v.nRate || 0));
      const oPay = round2(oHours * (v.oRate || 0));
      return '正常班：<b>' + nHours + '</b> 小时 × ' + money(v.nRate || 0) + '/时 = <span class="money">' + money(nPay) + '</span><br>' +
        '加班：<b>' + oHours + '</b> 小时 × ' + money(v.oRate || 0) + '/时 = <span class="money">' + money(oPay) + '</span><br>' +
        '当日合计工资：<span class="money">' + money(nPay + oPay) + '</span>（总工时 ' + round2(nHours + oHours) + ' 小时）';
    },
    validate(v) {
      if (!v.date) return '请选择日期';
      if (!v.nStart || !v.nEnd) return '请填写正常班的开始和结束时间';
      if ((v.oStart && !v.oEnd) || (!v.oStart && v.oEnd)) return '加班开始和结束时间要填完整';
      if (v.nRate < 0 || v.oRate < 0) return '时薪不能为负数';
      return null;
    },
    signature: r => [r.v.date, r.v.nStart, r.v.nEnd, r.v.oStart, r.v.oEnd].join('|'),
    filters: [{ key: 'ot', label: '仅加班', tag: 'ot' }],
    tagsOf: r => (r.m.oHours > 0 ? ['ot'] : []),
    columns: [
      { label: '日期', get: r => esc(r.v.date) },
      { label: '星期', get: r => weekdayCN(r.v.date) },
      { label: '正常时段', get: r => esc(r.v.nStart) + '~' + esc(r.v.nEnd) },
      { label: '正常工时', get: r => esc(r.m.nHours) + 'h' },
      { label: '加班时段', get: r => r.v.oStart ? esc(r.v.oStart) + '~' + esc(r.v.oEnd) : '—' },
      { label: '加班工时', get: r => r.m.oHours ? esc(r.m.oHours) + 'h' : '—' },
      { label: '总工时', get: r => '<b>' + esc(r.m.totalHours) + 'h</b>' },
      { label: '正常工资', get: r => '<span class="money">' + money(r.m.nPay) + '</span>' },
      { label: '加班费', get: r => r.m.oPay ? '<span class="money">' + money(r.m.oPay) + '</span>' : '—' },
      { label: '当日合计', get: r => '<span class="money">' + money(r.m.totalPay) + '</span>' },
    ],
    card(r) {
      return `
        <div class="rc-top">
          <span class="rc-date">${esc(r.v.date)} ${weekdayCN(r.v.date)}</span>
          <span class="rc-pay">${money(r.m.totalPay)}</span>
        </div>
        <div class="rc-row">正常班 ${esc(r.v.nStart)}~${esc(r.v.nEnd)} · ${esc(r.m.nHours)}h · <span class="money">${money(r.m.nPay)}</span></div>
        <div class="rc-row ${r.m.oHours ? 'ot' : ''}">${r.v.oStart
          ? `加班 ${esc(r.v.oStart)}~${esc(r.v.oEnd)} · ${esc(r.m.oHours)}h · ${money(r.m.oPay)}`
          : '无加班'}</div>`;
    },
    foot(r) { return '总工时 <b>' + esc(r.m.totalHours) + 'h</b>'; },
    summary(records) {
      let totalHours = 0, totalPay = 0, totalOT = 0; const days = new Set();
      records.forEach(r => { totalHours += r.m.totalHours; totalPay += r.m.totalPay; totalOT += r.m.oHours; days.add(r.v.date); });
      return [
        { label: '总工时', value: round2(totalHours) + ' 小时', cls: '' },
        { label: '记录天数', value: days.size + ' 天', cls: '' },
        { label: '其中加班', value: round2(totalOT) + ' 小时', cls: '' },
        { label: '累计工资', value: money(totalPay), cls: 'money' },
      ];
    },
    buildCharts(records) {
      const days = groupByDate(records);
      const labels = days.map(d => d.label);
      const C = KIT.C;
      return [
        { title: '每日工资走势（折线图）', yTitle: '工资（元）', config: {
          type: 'line',
          data: { labels, datasets: [
            KIT.line({ label: '当日总工资(元)', data: days.map(d => sumBy(d.items, r => r.m.totalPay)), borderColor: C.teal, backgroundColor: 'rgba(46,125,116,.08)', fill: true, pointBackgroundColor: C.teal }),
            KIT.line({ label: '正常班工资(元)', data: days.map(d => sumBy(d.items, r => r.m.nPay)), borderColor: C.tealLight, borderDash: [6, 4], borderWidth: 1.6, pointRadius: 2 }),
            KIT.line({ label: '加班费(元)', data: days.map(d => sumBy(d.items, r => r.m.oPay)), borderColor: C.cinnabar, borderDash: [6, 4], borderWidth: 1.6, pointRadius: 2 }),
          ] },
          options: KIT.baseOptions('工资（元）'),
        } },
        { title: '每日工作时间（折线 + 条形，条形区分正常班/加班）', yTitle: '工作时间（小时）', config: {
          type: 'bar',
          data: { labels, datasets: [
            KIT.bar({ label: '正常工时(小时)', data: days.map(d => sumBy(d.items, r => r.m.nHours)), backgroundColor: C.tealBg, borderColor: C.tealLight, stack: 'hours' }),
            KIT.bar({ label: '加班工时(小时)', data: days.map(d => sumBy(d.items, r => r.m.oHours)), backgroundColor: C.cinnabarBg, borderColor: C.cinnabar, borderRadius: 5, borderSkipped: false, stack: 'hours' }),
            KIT.line({ label: '每日总时长(小时)', data: days.map(d => sumBy(d.items, r => r.m.totalHours)), borderColor: C.gold, backgroundColor: C.goldBright, stack: 'line', order: 0 }),
          ] },
          options: KIT.baseOptions('工作时间（小时）', { scales: {
            x: { stacked: true, ticks: { color: C.text, font: { size: 11 }, maxRotation: 60, autoSkip: true, maxTicksLimit: 16 }, grid: { display: false } },
            y: { stacked: true, beginAtZero: true, title: { display: true, text: '工作时间（小时）', color: C.text, font: { size: 12 } }, ticks: { color: C.text, font: { size: 11 } }, grid: { color: C.grid } },
          } }),
        } },
      ];
    },
    ai: {
      persona: [
        '你是一位既懂数据分析、又懂劳动健康与职业状态的助手。用户是一名服装厂的计时工（按小时计薪，正常班+加班两种时段，加班时薪单独计算）。',
        '请严格根据用户提供的真实工作记录统计数据，生成一份中文分析报告，输出为 Markdown 格式。',
        '报告必须包含以下部分（用二级标题组织）：',
        '1.「数据概览」— 简明汇总关键数字；',
        '2.「趋势分析」— 分析工资走势与工时走势（上升/下降/波动），结合加班占比、星期几规律、最近7天环比变化指出可能的原因；',
        '3.「工作状态建议」— 如何根据自己工时规律安排节奏、保持专注与效率；',
        '4.「健康建议」— 结合服装厂长时间缝纫/站立或久坐的岗位特点，给出睡眠作息、用眼护眼、颈肩腰椎、饮食饮水、情绪压力方面的具体做法；',
        '5.「过劳风险提示」— 若存在连续多日加班、日均工时过高（如超过10小时）或工时持续上升，必须明确指出并给出调整建议；数据正常也要说明当前风险较低；',
        '6.「收入优化建议」— 基于时薪与加班结构，分析怎样安排加班更划算、是否值得多加班等；',
        '7.「下阶段行动清单」— 3~5条可直接执行的具体事项。',
        '要求：所有结论必须引用数据中的具体数字（例如“最近7天日均工时9.5小时，比之前7天上升12%”），不要空泛套话；语气友好、贴近工人师傅的日常，避免说教；篇幅适中（约600~900字）。',
      ].join('\n'),
      buildStats(records) {
        const days = groupByDate(records);
        const n = days.length;
        if (!n) return null;
        const sum = (arr, f) => arr.reduce((s, d) => s + f(d), 0);
        const totalNH = sum(days, d => sumBy(d.items, r => r.m.nHours));
        const totalOH = sum(days, d => sumBy(d.items, r => r.m.oHours));
        const totalH = round2(totalNH + totalOH);
        const totalPay = sum(days, d => sumBy(d.items, r => r.m.totalPay));
        const otDays = days.filter(d => d.items.some(r => r.m.oHours > 0)).length;
        const last7 = days.slice(-7), prev7 = days.slice(-14, -7);
        const h7 = sum(last7, d => sumBy(d.items, r => r.m.totalHours));
        const hPrev = sum(prev7, d => sumBy(d.items, r => r.m.totalHours));
        let streak = 0, maxStreak = 0;
        days.forEach(d => { if (d.items.some(r => r.m.oHours > 0)) { streak++; maxStreak = Math.max(maxStreak, streak); } else streak = 0; });
        const maxDay = days.reduce((m, d) => (sumBy(d.items, r => r.m.totalHours) > sumBy(m.items, r => r.m.totalHours) ? d : m), days[0]);
        return {
          记录天数: n,
          起止日期: days[0].date + ' ~ ' + days[n - 1].date,
          累计正常工时: round2(totalNH),
          累计加班工时: round2(totalOH),
          累计总工时: totalH,
          日均总工时: round2(totalH / n),
          累计工资: totalPay,
          日均工资: round2(totalPay / n),
          加班天数: otDays,
          加班天数占比: Math.round(otDays / n * 100) + '%',
          工时最长的一天: maxDay.date + '（' + round2(sumBy(maxDay.items, r => r.m.totalHours)) + '小时）',
          最近7天总工时: round2(h7),
          之前7天总工时: round2(hPrev),
          最近7天工时环比: hPrev ? Math.round((h7 - hPrev) / hPrev * 100) + '%' : '无对比数据',
          最长连续加班天数: maxStreak,
        };
      },
      dailyLines(records) {
        return groupByDate(records).slice(-90).map(d =>
          `${d.date}: 正常${sumBy(d.items, r => r.m.nHours)}h + 加班${sumBy(d.items, r => r.m.oHours)}h, 工资${sumBy(d.items, r => r.m.totalPay)}元`
        ).join('\n');
      },
    },
    sample(settings) {
      const out = [];
      const today = new Date();
      for (let i = 13; i >= 0; i--) {
        const d = new Date(today); d.setDate(d.getDate() - i);
        if (d.getDay() === 0) continue;
        const y = d.getFullYear(), mth = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
        const hasOT = (i * 7 + d.getDate()) % 10 < 6;
        const oEnd = (i % 3 === 0) ? '21:00' : (i % 3 === 1 ? '20:00' : '19:30');
        const v = { date: `${y}-${mth}-${dd}`, nStart: '08:00', nEnd: '17:00',
          oStart: hasOT ? '17:30' : null, oEnd: hasOT ? oEnd : null,
          nRate: settings.nRate, oRate: settings.oRate };
        out.push({ id: uid(), v, m: hourly.compute(v) });
      }
      return out;
    },
  };

  /* ================= 模板②：计件工（按件计薪） ================= */
  const piece = {
    id: 'piece',
    name: '计件工账本',
    tagline: '按件计薪：记件数和单价，自动算工钱',
    icon: { svg: 'tpl-piece', emoji: '🏷️' },
    accent: '#d4b45a',
    defaultsFields: [
      { key: 'price', label: '默认单价（元/件）', kind: 'number', step: 0.1, min: 0, def: 0.8 },
    ],
    form: [
      { type: 'row', fields: [{ kind: 'date', key: 'date', label: '日期', required: true }, { kind: 'spacer' }] },
      { type: 'group', title: '今日产量 *', fields: [
        { kind: 'number', key: 'count', label: '完成件数（件）', step: 1, min: 0 },
        { kind: 'number', key: 'price', label: '单价（元/件）', step: 0.1, min: 0, fromLedger: 'price' },
      ] },
      { type: 'group', title: '备注（可选）', fields: [
        { kind: 'text', key: 'note', label: '今天做了什么、有什么要记的', wide: true },
      ] },
    ],
    // 安全积木：数量 × 单价
    compute(v) { return { pay: round2((v.count || 0) * (v.price || 0)) }; },
    preview(v) {
      if (!(v.count > 0)) return '填好件数后，这里会实时算出工钱。';
      const pay = round2(v.count * (v.price || 0));
      return '当日工钱：<b>' + esc(v.count) + '</b> 件 × ' + money(v.price || 0) + '/件 = <span class="money">' + money(pay) + '</span>';
    },
    validate(v) {
      if (!v.date) return '请选择日期';
      if (v.count < 0) return '完成件数不能为负数';
      if (!(v.count > 0)) return '请填写完成件数';
      if (v.price < 0) return '单价不能为负数';
      if (!(v.price >= 0)) return '请填写单价';
      return null;
    },
    signature: r => [r.v.date, r.v.count, r.v.price].join('|'),
    filters: [],
    tagsOf: () => [],
    columns: [
      { label: '日期', get: r => esc(r.v.date) },
      { label: '星期', get: r => weekdayCN(r.v.date) },
      { label: '件数', get: r => '<b>' + esc(r.v.count) + '</b> 件' },
      { label: '单价', get: r => money(r.v.price) + '/件' },
      { label: '当日工钱', get: r => '<span class="money">' + money(r.m.pay) + '</span>' },
      { label: '备注', get: r => r.v.note ? esc(r.v.note) : '—' },
    ],
    card(r) {
      return `
        <div class="rc-top">
          <span class="rc-date">${esc(r.v.date)} ${weekdayCN(r.v.date)}</span>
          <span class="rc-pay">${money(r.m.pay)}</span>
        </div>
        <div class="rc-row">完成 <b>${esc(r.v.count)}</b> 件 × ${money(r.v.price)}/件</div>
        ${r.v.note ? `<div class="rc-row">备注：${esc(r.v.note)}</div>` : ''}`;
    },
    foot(r) { return '当日工钱 <b class="money">' + money(r.m.pay) + '</b>'; },
    summary(records) {
      let totalPay = 0, totalCount = 0; const days = new Set();
      records.forEach(r => { totalPay += r.m.pay; totalCount += (r.v.count || 0); days.add(r.v.date); });
      return [
        { label: '累计工钱', value: money(totalPay), cls: 'money' },
        { label: '总件数', value: totalCount + ' 件', cls: '' },
        { label: '记录天数', value: days.size + ' 天', cls: '' },
        { label: '日均件数', value: (days.size ? round2(totalCount / days.size) : 0) + ' 件', cls: '' },
      ];
    },
    buildCharts(records) {
      const days = groupByDate(records);
      const labels = days.map(d => d.label);
      const C = KIT.C;
      return [
        { title: '每日工钱走势（折线图）', yTitle: '工钱（元）', config: {
          type: 'line',
          data: { labels, datasets: [
            KIT.line({ label: '当日工钱(元)', data: days.map(d => sumBy(d.items, r => r.m.pay)), borderColor: C.gold, backgroundColor: 'rgba(212,180,90,.10)', fill: true, pointBackgroundColor: C.gold }),
          ] },
          options: KIT.baseOptions('工钱（元）'),
        } },
        { title: '每日完成件数（条形图）', yTitle: '件数（件）', config: {
          type: 'bar',
          data: { labels, datasets: [
            KIT.bar({ label: '完成件数(件)', data: days.map(d => sumBy(d.items, r => r.v.count || 0)), backgroundColor: C.tealBg, borderColor: C.tealLight }),
          ] },
          options: KIT.baseOptions('件数（件）'),
        } },
      ];
    },
    ai: {
      persona: [
        '你是一位懂数据分析、也懂手工艺劳动者健康的助手。用户是一名按件计薪的工人（多做多得，记录每天的完成件数、单价和当日工钱）。',
        '请严格根据用户提供的真实记录统计数据，生成一份中文分析报告，输出为 Markdown 格式。',
        '报告必须包含（用二级标题组织）：',
        '1.「数据概览」；2.「产量与工钱趋势」— 结合件数波动、最近7天环比分析原因；',
        '3.「效率建议」— 如何安排节奏提升产量而不赶工出错；',
        '4.「健康建议」— 针对重复性手工劳动，给出手部/肩颈/用眼/作息方面的具体做法；',
        '5.「收入优化建议」— 基于单价与产量结构分析怎样更划算；',
        '6.「下阶段行动清单」— 3~5条可执行事项。',
        '要求：结论必须引用具体数字；语气友好贴近日常；篇幅约600~900字。',
      ].join('\n'),
      buildStats(records) {
        const days = groupByDate(records);
        const n = days.length;
        if (!n) return null;
        const sum = (arr, f) => arr.reduce((s, d) => s + f(d), 0);
        const totalPay = sum(days, d => sumBy(d.items, r => r.m.pay));
        const totalCount = sum(days, d => sumBy(d.items, r => r.v.count || 0));
        const last7 = days.slice(-7), prev7 = days.slice(-14, -7);
        const p7 = sum(last7, d => sumBy(d.items, r => r.m.pay)), pPrev = sum(prev7, d => sumBy(d.items, r => r.m.pay));
        const maxDay = days.reduce((m, d) => (sumBy(d.items, r => r.m.pay) > sumBy(m.items, r => r.m.pay) ? d : m), days[0]);
        return {
          记录天数: n,
          起止日期: days[0].date + ' ~ ' + days[n - 1].date,
          累计件数: totalCount,
          累计工钱: totalPay,
          日均件数: round2(totalCount / n),
          日均工钱: round2(totalPay / n),
          平均每件: totalCount ? round2(totalPay / totalCount) : 0,
          工钱最高的一天: maxDay.date + '（' + sumBy(maxDay.items, r => r.m.pay) + '元）',
          最近7天工钱: round2(p7),
          之前7天工钱: round2(pPrev),
          最近7天环比: pPrev ? Math.round((p7 - pPrev) / pPrev * 100) + '%' : '无对比数据',
        };
      },
      dailyLines(records) {
        return groupByDate(records).slice(-90).map(d =>
          `${d.date}: ${sumBy(d.items, r => r.v.count || 0)}件, 工钱${sumBy(d.items, r => r.m.pay)}元`
        ).join('\n');
      },
    },
    sample(settings) {
      const out = [];
      const today = new Date();
      const price = settings.price || 0.8;
      for (let i = 13; i >= 0; i--) {
        const d = new Date(today); d.setDate(d.getDate() - i);
        if (d.getDay() === 0) continue;
        const y = d.getFullYear(), mth = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
        const count = 40 + (i * 13 + d.getDate()) % 50;
        const v = { date: `${y}-${mth}-${dd}`, count, price, note: (i % 4 === 0 ? '赶一批急单' : '') };
        out.push({ id: uid(), v, m: piece.compute(v) });
      }
      return out;
    },
  };

  /* ================= 模板③：通用收支 ================= */
  const general = {
    id: 'general',
    name: '通用收支账本',
    tagline: '记收入和支出，自动算结余',
    icon: { svg: 'tpl-general', emoji: '💳' },
    accent: '#7ba7bc',
    defaultsFields: [],
    form: [
      { type: 'row', fields: [{ kind: 'date', key: 'date', label: '日期', required: true }, { kind: 'spacer' }] },
      { type: 'group', title: '收支明细 *', fields: [
        { kind: 'money', key: 'income', label: '收入（元，没有就填 0）', step: 0.01, min: 0 },
        { kind: 'money', key: 'expense', label: '支出（元，没有就填 0）', step: 0.01, min: 0 },
      ] },
      { type: 'group', title: '备注（可选）', fields: [
        { kind: 'text', key: 'item', label: '项目名称', wide: true },
        { kind: 'text', key: 'note', label: '备注', wide: true },
      ] },
    ],
    // 安全积木：收入 − 支出 = 结余
    compute(v) { return { net: round2((v.income || 0) - (v.expense || 0)) }; },
    preview(v) {
      const income = v.income || 0, expense = v.expense || 0;
      if (!income && !expense) return '填好收入或支出后，这里会实时算出结余。';
      const net = round2(income - expense);
      return '当日结余：收入 <span class="money">' + money(income) + '</span> − 支出 <span class="money">' + money(expense) + '</span> = <span class="money">' + money(net) + '</span>' + (net < 0 ? '（<b>入不敷出</b>）' : '');
    },
    validate(v) {
      if (!v.date) return '请选择日期';
      if (v.income < 0 || v.expense < 0) return '收入和支出不能为负数';
      if (!((v.income > 0) || (v.expense > 0))) return '收入和支出至少填一项';
      return null;
    },
    signature: r => [r.v.date, r.v.item, r.v.income, r.v.expense].join('|'),
    filters: [
      { key: 'income', label: '仅收入', tag: 'income' },
      { key: 'expense', label: '仅支出', tag: 'expense' },
    ],
    tagsOf: r => {
      const t = [];
      if (r.v.income > 0) t.push('income');
      if (r.v.expense > 0) t.push('expense');
      return t;
    },
    columns: [
      { label: '日期', get: r => esc(r.v.date) },
      { label: '项目', get: r => r.v.item ? esc(r.v.item) : '—' },
      { label: '收入', get: r => r.v.income ? '<span class="money">' + money(r.v.income) + '</span>' : '—' },
      { label: '支出', get: r => r.v.expense ? '<span class="money" style="color:var(--cinnabar)">' + money(r.v.expense) + '</span>' : '—' },
      { label: '当日结余', get: r => '<b class="' + (r.m.net < 0 ? 'money' : '') + '" style="' + (r.m.net < 0 ? 'color:var(--cinnabar)' : 'color:var(--gold-deep)') + '">' + money(r.m.net) + '</b>' },
      { label: '备注', get: r => r.v.note ? esc(r.v.note) : '—' },
    ],
    card(r) {
      const neg = r.m.net < 0;
      return `
        <div class="rc-top">
          <span class="rc-date">${esc(r.v.date)} ${weekdayCN(r.v.date)}</span>
          <span class="rc-pay" style="${neg ? 'color:var(--cinnabar)' : ''}">${money(r.m.net)}</span>
        </div>
        <div class="rc-row">${r.v.item ? '项目：' + esc(r.v.item) : '（未填项目）'}</div>
        <div class="rc-row">收入 <span class="money">${money(r.v.income || 0)}</span> · 支出 <span class="money" style="color:var(--cinnabar)">${money(r.v.expense || 0)}</span></div>
        ${r.v.note ? `<div class="rc-row">备注：${esc(r.v.note)}</div>` : ''}`;
    },
    foot() { return ''; },
    summary(records) {
      let income = 0, expense = 0; const days = new Set();
      records.forEach(r => { income += (r.v.income || 0); expense += (r.v.expense || 0); days.add(r.v.date); });
      const net = round2(income - expense);
      return [
        { label: '总收入', value: money(income), cls: 'money' },
        { label: '总支出', value: money(expense), cls: 'expense' },
        { label: '结余', value: money(net), cls: net < 0 ? 'expense' : 'money' },
        { label: '记录天数', value: days.size + ' 天', cls: '' },
      ];
    },
    buildCharts(records) {
      const days = groupByDate(records);
      const labels = days.map(d => d.label);
      const C = KIT.C;
      let cum = 0;
      const cumData = days.map(d => { cum += sumBy(d.items, r => r.m.net); return round2(cum); });
      return [
        { title: '每日收支（条形）与当日结余（折线）', yTitle: '金额（元）', config: {
          type: 'bar',
          data: { labels, datasets: [
            KIT.bar({ label: '收入(元)', data: days.map(d => sumBy(d.items, r => r.v.income || 0)), backgroundColor: C.tealBg, borderColor: C.tealLight, stack: 'io' }),
            KIT.bar({ label: '支出(元)', data: days.map(d => sumBy(d.items, r => r.v.expense || 0)), backgroundColor: C.cinnabarBg, borderColor: C.cinnabar, stack: 'io' }),
            KIT.line({ label: '当日结余(元)', data: days.map(d => sumBy(d.items, r => r.m.net)), borderColor: C.gold, backgroundColor: C.goldBright, stack: 'line', order: 0 }),
          ] },
          options: KIT.baseOptions('金额（元）', { scales: {
            x: { stacked: true, ticks: { color: C.text, font: { size: 11 }, maxRotation: 60, autoSkip: true, maxTicksLimit: 16 }, grid: { display: false } },
            y: { stacked: true, beginAtZero: true, title: { display: true, text: '金额（元）', color: C.text, font: { size: 12 } }, ticks: { color: C.text, font: { size: 11 } }, grid: { color: C.grid } },
          } }),
        } },
        { title: '累计结余走势（折线图）', yTitle: '累计结余（元）', config: {
          type: 'line',
          data: { labels, datasets: [
            KIT.line({ label: '累计结余(元)', data: cumData, borderColor: C.teal, backgroundColor: 'rgba(46,125,116,.08)', fill: true, pointBackgroundColor: C.teal }),
          ] },
          options: KIT.baseOptions('累计结余（元）'),
        } },
      ];
    },
    ai: {
      persona: [
        '你是一位务实贴心的家庭/小生意收支分析助手。用户用一本"通用收支账"记录每天的收入和支出（含项目与备注）。',
        '请严格根据用户提供的真实记录统计数据，生成一份中文分析报告，输出为 Markdown 格式。',
        '报告必须包含（用二级标题组织）：',
        '1.「数据概览」；2.「收支结构分析」— 收入来源与支出去向、大额支出、结余情况；',
        '3.「趋势分析」— 最近7天环比变化及可能原因；',
        '4.「省钱与增收建议」— 具体可执行；',
        '5.「储蓄建议」— 结余怎么安排；',
        '6.「下阶段行动清单」— 3~5条可执行事项。',
        '要求：结论必须引用具体数字；语气友好不评判；篇幅约600~900字。',
      ].join('\n'),
      buildStats(records) {
        const days = groupByDate(records);
        const n = days.length;
        if (!n) return null;
        const sum = (arr, f) => arr.reduce((s, d) => s + f(d), 0);
        const totalIn = sum(days, d => sumBy(d.items, r => r.v.income || 0));
        const totalOut = sum(days, d => sumBy(d.items, r => r.v.expense || 0));
        const last7 = days.slice(-7), prev7 = days.slice(-14, -7);
        const o7 = sum(last7, d => sumBy(d.items, r => r.v.expense || 0));
        const oPrev = sum(prev7, d => sumBy(d.items, r => r.v.expense || 0));
        let maxExp = null;
        records.forEach(r => { if (!maxExp || (r.v.expense || 0) > (maxExp.v.expense || 0)) maxExp = r; });
        return {
          记录天数: n,
          起止日期: days[0].date + ' ~ ' + days[n - 1].date,
          总收入: round2(totalIn),
          总支出: round2(totalOut),
          结余: round2(totalIn - totalOut),
          日均支出: round2(totalOut / n),
          最大单笔支出: maxExp ? (maxExp.v.date + ' ' + (maxExp.v.item || '未命名') + ' ' + money(maxExp.v.expense || 0)) : '无',
          有支出的天数: days.filter(d => sumBy(d.items, r => r.v.expense || 0) > 0).length,
          最近7天支出: round2(o7),
          之前7天支出: round2(oPrev),
          最近7天支出环比: oPrev ? Math.round((o7 - oPrev) / oPrev * 100) + '%' : '无对比数据',
        };
      },
      dailyLines(records) {
        return groupByDate(records).slice(-90).map(d =>
          `${d.date}: 收入${sumBy(d.items, r => r.v.income || 0)}元, 支出${sumBy(d.items, r => r.v.expense || 0)}元`
        ).join('\n');
      },
    },
    sample() {
      const out = [];
      const today = new Date();
      const ins = ['卖货收入', '加工费', '尾款到账'];
      const outs = ['面料采购', '房租', '水电费', '伙食', '交通'];
      for (let i = 13; i >= 0; i--) {
        const d = new Date(today); d.setDate(d.getDate() - i);
        const y = d.getFullYear(), mth = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
        const date = `${y}-${mth}-${dd}`;
        if (i % 2 === 0) {
          const v = { date, income: 200 + (i * 37) % 600, expense: 0, item: ins[i % ins.length], note: '' };
          out.push({ id: uid(), v, m: general.compute(v) });
        }
        if (i % 3 !== 2) {
          const v = { date, income: 0, expense: 30 + (i * 53) % 400, item: outs[i % outs.length], note: '' };
          out.push({ id: uid(), v, m: general.compute(v) });
        }
      }
      return out;
    },
  };

  // 旧版（V0.5 及之前）扁平记录 → 计时工模板新形态
  // V0.15.6：id 一律重建——外部数据（旧备份/迁移源）的 id 不可信，渲染层属性插值按内部 uid 对齐
  function convertLegacyRecord(r) {
    const v = { date: r.date, nStart: r.nStart, nEnd: r.nEnd, oStart: r.oStart || null, oEnd: r.oEnd || null, nRate: r.nRate, oRate: r.oRate };
    return { id: uid(), v, m: hourly.compute(v) };
  }

  window.JG_TEMPLATES = { list: [hourly, piece, general], byId: { hourly, piece, general }, convertLegacyRecord, groupByDate };
})();

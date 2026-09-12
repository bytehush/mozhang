/* 图表模块：由当前账本的模板 buildCharts() 生成图表配置，本模块只负责渲染壳
   （范围筛选、建卡、Chart.js 实例管理、数据变化联动） */
(function () {
  'use strict';

  let charts = [];

  function render(records) {
    const tpl = window.JG && window.JG.getActiveTemplate();
    if (!tpl || typeof Chart === 'undefined') return;
    charts.forEach(c => c.destroy());
    charts = [];

    const sel = document.getElementById('chart-range');
    const range = sel ? sel.value : 'all';
    const wrap = document.getElementById('charts-wrap');
    const emptyTip = document.getElementById('charts-empty');
    const empty = !records.length;
    emptyTip.classList.toggle('show', empty);
    wrap.classList.toggle('hidden', empty);
    if (empty) return;

    const T = window.JG_TEMPLATES;
    let groups = T.groupByDate(records);
    if (range !== 'all' && groups.length > Number(range)) groups = groups.slice(-Number(range));
    const flat = groups.flatMap(g => g.items);
    const specs = tpl.buildCharts(flat);

    wrap.innerHTML = specs.map(s => `
      <div class="chart-card">
        <h3>${s.title}</h3>
        <div class="chart-box"><canvas></canvas></div>
      </div>`).join('');
    wrap.querySelectorAll('canvas').forEach((canvas, i) => {
      charts.push(new Chart(canvas.getContext('2d'), specs[i].config));
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    const sel = document.getElementById('chart-range');
    if (sel) sel.addEventListener('change', () => {
      if (window.JG) render(window.JG.getRecords());
    });
    window.addEventListener('jigong:datachanged', () => {
      const panel = document.getElementById('tab-charts');
      if (panel && panel.classList.contains('active') && window.JG) render(window.JG.getRecords());
    });
  });

  window.JGCharts = { render };
})();

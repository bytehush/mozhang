/* 冒烟测试桩节点（V0.15.6 新增）：
   smoke.html 会真实加载 app.js / chat.js / charts.js，但本身没有 index.html 的完整
   DOM——初始化路径里 addEventListener 的目标元素不存在就会抛错，「页面加载零报错」
   断言永远过不了。本脚本在 DOMContentLoaded 之前把初始化需要的 id 全部补成隐藏桩。
   维护约定：app.js/chat.js 初始化若引用新 id，需同步加进下面的清单。 */
(function () {
  'use strict';
  const IDS = [
    // app.js 导航/切换器
    'bs-grid', 'btn-shelf', 'btn-collapse', 'btn-menu', 'drawer-backdrop',
    'ls-btn', 'ls-menu', 'ls-ico', 'ls-name', 'ledger-switch', 'page-title', 'greeting',
    // 记录表 / 表单
    'btn-add', 'btn-save', 'btn-reset-form', 'form-fields', 'preview-box',
    'records-thead', 'records-tbody', 'table-view', 'cards-view', 'page-head',
    'table-empty', 'filter-empty', 'filter-seg', 'summary-cards', 'detail-title',
    'btn-select', 'bb-toggle-all', 'bb-delete', 'bb-exit', 'bb-count', 'batch-bar',
    'bookshelf', 'ledger-workbench',
    // 账本新建/设置弹窗
    'btn-create-ledger', 'btn-save-ledger', 'btn-del-ledger',
    'tpl-pick', 'nl-name', 'nl-extra', 'nl-subject', 'nl-subject-custom',
    'stl-name', 'stl-extra', 'stl-cf',
    // 导入导出 / 数据工具
    'btn-export', 'btn-export-download', 'export-stats', 'btn-import', 'btn-import-pick', 'import-file',
    'btn-sample', 'btn-clear',
    // 设置
    'api-tabs', 's-baseurl', 's-apikey', 's-models', 'btn-add-model', 'btn-save-model',
    // AI 会话
    'chat-list', 'chat-scroll', 'chat-input', 'chat-empty', 'chat-jump', 'chat-timeline',
    'chat-chips', 'btn-chat-send', 'btn-chat-stop', 'btn-chat-clear',
    'btn-session', 'session-menu', 'session-title', 'btn-model', 'model-menu', 'model-label',
    'snap-detail', 'snap-meta',
    // 图表
    'chart-range', 'charts-wrap', 'charts-empty',
  ];
  // 本脚本放在 body 末尾：解析到这里时 DOM 已就绪、DOMContentLoaded 尚未触发，
  // 因此必须同步补桩——app.js/chat.js 在 head 注册的 DOMContentLoaded 回调会先于一切异步执行。
  IDS.forEach(id => {
    if (document.getElementById(id)) return;
    const el = document.createElement('div');
    el.id = id;
    el.hidden = true;
    document.body.appendChild(el);
  });
})();

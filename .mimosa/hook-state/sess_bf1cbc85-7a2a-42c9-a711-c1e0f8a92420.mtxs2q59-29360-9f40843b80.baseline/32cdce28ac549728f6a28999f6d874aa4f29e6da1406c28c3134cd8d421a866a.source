/* 核心逻辑：账本层（多账本+模板驱动）、侧边栏导航、悬浮窗（POP）、COMMIT 按钮、
   记录表（LAYOUT/FILTER/SELECT）、TILT、账本管理、数据迁移与备份。
   模板定义见 js/templates.js；交互设计依据《8种高级交互》：起点→变形→终点，
   动画 200-400ms，尊重系统「减少动态效果」设置。 */
(function () {
  'use strict';

  const LS_SETTINGS = 'jigong_settings';        // 全局：AI 模型配置
  const LS_LEDGERS = 'jigong_ledgers';          // 账本列表（元数据）
  const LS_ACTIVE = 'jigong_active_ledger';
  const LS_UI = 'jigong_ui';                    // { 账本id: {view, filter} }
  const LS_SIDEBAR = 'jigong_sidebar_collapsed';
  const LS_V1_BACKUP = 'jigong_records_v1_backup';

  const DEFAULT_SETTINGS = {};   // 其余（apis/activeApi）由迁移生成

  // 各厂商 OpenAI 兼容接口：预填地址与常用模型档案（一个厂商 = 一套独立 API + 模型列表）
  const API_PRESETS = {
    zhipu: { name: '智谱AI', url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', models: [
      { id: 'm-glm-flash', model: 'glm-4-flash', label: 'GLM-4-Flash（免费）', context: 128, maxOut: 4095 },
      { id: 'm-glm45-flash', model: 'glm-4.5-flash', label: 'GLM-4.5-Flash（免费）', context: 128, maxOut: 4095 },
    ]},
    deepseek: { name: 'DeepSeek', url: 'https://api.deepseek.com/chat/completions', models: [
      { id: 'm-ds-chat', model: 'deepseek-chat', label: 'DeepSeek Chat', context: 64, maxOut: 8192 },
      { id: 'm-ds-reasoner', model: 'deepseek-reasoner', label: 'DeepSeek Reasoner', context: 64, maxOut: 8192 },
    ]},
    qwen: { name: '通义千问', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', models: [
      { id: 'm-qw-flash', model: 'qwen-flash', label: '通义千问-Flash', context: 1000, maxOut: 8192 },
    ]},
    moonshot: { name: 'Kimi', url: 'https://api.moonshot.cn/v1/chat/completions', models: [
      { id: 'm-kimi-8k', model: 'moonshot-v1-8k', label: 'Kimi-8K', context: 8, maxOut: 4095 },
    ]},
    custom: { name: '自定义', url: '', models: [] },
  };
  const TPL = () => window.JG_TEMPLATES;

  const EASE_SPRING = 'cubic-bezier(.3, 1.25, .5, 1)';
  const EASE_OUT = 'ease-out';
  const EASE_IN = 'ease-in';   // EASE_* 部分供 modals.js/records 动效共用

  let settings = loadSettings();
  let ledgers = [];
  let activeId = null;
  let records = [];             // 当前账本的记录
  let editingId = null;
  let selectMode = false;
  let selectedIds = new Set();
  let ui = { view: 'table', filter: 'all' };   // 当前账本的界面偏好
  let formBuiltFor = null;      // 表单当前是为哪个账本构建的

  // ---------- 工具与悬浮窗（公共版在 js/utils.js / js/modals.js） ----------
  const { $, wait, uid, round2, money, fmtDate, esc, toast, REDUCED } = window.UTIL;
  const { open: openModal, close: closeModal, init: initModals, label: setCommitLabel, done: setCommitDone, play: commitPlay } = window.MODAL;

  function loadSettings() {
    try { return Object.assign({}, DEFAULT_SETTINGS, JSON.parse(localStorage.getItem(LS_SETTINGS)) || {}); }
    catch { return Object.assign({}, DEFAULT_SETTINGS); }
  }
  // 模型设置迁移（V0.9.6 厂商分组制）：旧扁平结构 → 每厂商独立 API（地址/Key/模型列表）
  function migrateModelSettings() {
    if (settings.apis && settings.activeApi) return;
    const apis = {};
    // 旧顶层数据（provider/baseUrl/apiKey/models）→ 对应厂商的 API
    const legacyP = ['zhipu', 'deepseek', 'qwen', 'moonshot', 'custom'].includes(settings.provider)
      ? settings.provider : null;
    if (legacyP && (settings.apiKey || settings.baseUrl || (settings.models || []).length)) {
      apis[legacyP] = {
        baseUrl: settings.baseUrl || (API_PRESETS[legacyP] || {}).url || '',
        apiKey: settings.apiKey || '',
        models: Array.isArray(settings.models) && settings.models.length
          ? settings.models : ((API_PRESETS[legacyP] || {}).models || []).map(m => ({ ...m })),
        currentModelId: settings.currentModelId || null,
      };
    }
    // 其余厂商：预填地址与预设模型，Key 留空待填
    Object.keys(API_PRESETS).forEach(pk => {
      if (apis[pk]) return;
      apis[pk] = {
        baseUrl: (API_PRESETS[pk] || {}).url || '',
        apiKey: '',
        models: ((API_PRESETS[pk] || {}).models || []).map(m => ({ ...m })),
        currentModelId: ((API_PRESETS[pk] || {}).models || [])[0]?.id || null,
      };
    });
    settings.apis = apis;
    settings.activeApi = legacyP && apis[legacyP] ? legacyP : 'zhipu';
    // 清理旧顶层字段（已全部迁入 apis）
    ['provider', 'baseUrl', 'apiKey', 'model', 'models', 'currentModelId'].forEach(k => delete settings[k]);
    saveSettingsStore();
  }
  function apiName(p) { return (API_PRESETS[p] || {}).name || p; }
  function ensureApiEntry(p) {
    if (settings.apis[p]) return settings.apis[p];
    const preset = API_PRESETS[p] || { url: '', name: p, models: [] };
    settings.apis[p] = {
      baseUrl: preset.url || '', apiKey: '',
      models: (preset.models || []).map(m => ({ ...m })),
      currentModelId: (preset.models || [])[0]?.id || null,
    };
    return settings.apis[p];
  }
  function saveSettingsStore() { localStorage.setItem(LS_SETTINGS, JSON.stringify(settings)); }

  // ---------- 账本存储 ----------
  function loadLedgers() {
    try { const l = JSON.parse(localStorage.getItem(LS_LEDGERS)); return Array.isArray(l) ? l : []; }
    catch { return []; }
  }
  function saveLedgersStore() { localStorage.setItem(LS_LEDGERS, JSON.stringify(ledgers)); }
  function loadLedRecords(id) {
    try { return JSON.parse(localStorage.getItem('jigong_led_' + id)) || []; }
    catch { return []; }
  }
  function saveLedRecords(id, recs) { localStorage.setItem('jigong_led_' + id, JSON.stringify(recs)); }

  // 首次启动 / 旧版数据：迁移到多账本（迁移前旧数据留存备份键）
  function ensureLedgers() {
    ledgers = loadLedgers();
    if (ledgers.length) return { migrated: false };
    const legacy = (() => { try { return JSON.parse(localStorage.getItem('jigong_records')); } catch { return null; } })();
    const old = settings.nRate || settings.oRate ? { nRate: settings.nRate, oRate: settings.oRate } : {};
    const led = {
      id: uid(), name: '服装厂计时工', templateId: 'hourly',
      settings: Object.assign({ nRate: 20, oRate: 30 }, old),
      createdAt: Date.now(),
    };
    const recs = Array.isArray(legacy) ? legacy.map(TPL().convertLegacyRecord) : [];
    saveLedRecords(led.id, recs);
    ledgers = [led]; saveLedgersStore();
    if (Array.isArray(legacy)) {
      localStorage.setItem(LS_V1_BACKUP, JSON.stringify(legacy));
      localStorage.removeItem('jigong_records');
      return { migrated: true, count: legacy.length };
    }
    return { migrated: false };
  }

  function activeLedger() { return ledgers.find(l => l.id === activeId) || ledgers[0]; }
  function tplOf(led) { return TPL().byId[led.templateId] || TPL().byId.hourly; }

  // ---------- 自定义字段（V0.7 渐进自定义：账本随用长） ----------
  function customFieldsOf(led, onlyEnabled = true) {
    const list = Array.isArray(led.customFields) ? led.customFields : [];
    return onlyEnabled ? list.filter(f => f.enabled !== false) : list;
  }
  const CF_KINDS = { text: '文本', number: '数字', money: '金额' };
  function formatCustom(v, kind) {
    if (v == null || v === '') return '—';
    if (kind === 'money') return money(+v || 0);
    return esc(v);
  }
  // 去重签名：模板签名 + 自定义字段已填值
  function ledgerSignature(r, led) {
    const sig = tplOf(led).signature(r);
    const extra = customFieldsOf(led, false)
      .map(f => f.key + ':' + (r.v[f.key] != null ? r.v[f.key] : ''))
      .filter(s => !s.endsWith(':'));
    return extra.length ? sig + '|' + extra.join('|') : sig;
  }

  function switchLedger(id, opts = {}) {
    const led = ledgers.find(l => l.id === id);
    if (!led) return;
    activeId = id;
    localStorage.setItem(LS_ACTIVE, id);
    records = loadLedRecords(id);
    ui = loadUI();
    formBuiltFor = null;
    editingId = null;
    if (selectMode) { selectMode = false; selectedIds.clear(); document.body.classList.remove('selecting'); }
    renderLedgerSwitcher();
    updateSegUI();
    syncViewVisibility();
    renderRecords({ flip: false });
    updateSelectUI();
    if (window.JGCharts) window.JGCharts.render(records);
    if (window.JGChat) window.JGChat.reload();
    if (!opts.silent) toast('已切换到「' + led.name + '」');
  }

  // ---------- 界面偏好（按账本记忆） ----------
  function loadUI() {
    let all = {};
    try { all = JSON.parse(localStorage.getItem(LS_UI)) || {}; } catch { /* 忽略 */ }
    const u = Object.assign({ view: null, filter: 'all' }, all[activeId] || {});
    if (!u.view) u.view = window.innerWidth < 900 ? 'cards' : 'table';
    return u;
  }
  function saveUI() {
    let all = {};
    try { all = JSON.parse(localStorage.getItem(LS_UI)) || {}; } catch { /* 忽略 */ }
    all[activeId] = ui;
    // 清理 V0.5 遗留的顶层 view/filter 键（多账本后偏好按账本存放）
    delete all.view; delete all.filter;
    localStorage.setItem(LS_UI, JSON.stringify(all));
  }

  // ---------- 侧边栏导航 ----------
  const PAGE_TITLES = { table: '记录表', charts: '数据图表', ai: 'AI 军师', settings: '设置' };
  const GREETINGS = {
    table: '账目分明，心中自有乾坤 📜',
    charts: '观工钱之势，谋进退之度 🌙',
    ai: 'AI 军师为你推演一二 🎴',
    settings: '工欲善其事，必先利其器 ⚙️',
  };
  function updateGreeting(tabName) {
    const el = $('greeting');
    if (!el || !GREETINGS[tabName]) return;
    el.textContent = GREETINGS[tabName];
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
  }
  function switchTab(name) {
    document.querySelectorAll('#side-nav .side-item').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === name);
    });
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    const panel = $('tab-' + name);
    if (panel) panel.classList.add('active');
    const title = $('page-title');
    if (title && PAGE_TITLES[name]) title.textContent = PAGE_TITLES[name];
    window.scrollTo(0, 0);
    updateGreeting(name);
    if (name === 'charts' && window.JGCharts) window.JGCharts.render(records);
    closeDrawer();
  }
  function initNav() {
    document.querySelectorAll('#side-nav .side-item').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
    $('btn-collapse').addEventListener('click', () => {
      const collapsed = document.body.classList.toggle('side-collapsed');
      localStorage.setItem(LS_SIDEBAR, collapsed ? '1' : '0');
    });
    if (localStorage.getItem(LS_SIDEBAR) === '1') document.body.classList.add('side-collapsed');
    $('btn-menu').addEventListener('click', () => document.body.classList.add('drawer-open'));
    $('drawer-backdrop').addEventListener('click', closeDrawer);
  }
  function closeDrawer() { document.body.classList.remove('drawer-open'); }

  // ---------- 账本切换器 ----------
  function setIcon(el, name, emoji) {
    el.dataset.icon = name;
    el.dataset.fallback = emoji || '';
    delete el.dataset.iconLoaded;
    el.innerHTML = '';
    if (window.JGIcons) window.JGIcons.mount(document);
  }
  function renderLedgerSwitcher() {
    const led = activeLedger();
    const tpl = tplOf(led);
    setIcon($('ls-ico'), tpl.icon.svg, tpl.icon.emoji);
    $('ls-name').textContent = led.name;
  }
  function buildLedgerMenu() {
    const menu = $('ls-menu');
    const items = ledgers.map(l => {
      const tpl = tplOf(l);
      const count = (l.id === activeId ? records : loadLedRecords(l.id)).length;
      return `<button class="ls-item ${l.id === activeId ? 'active' : ''}" data-led="${l.id}">
        <span class="ls-ico" data-icon="${tpl.icon.svg}" data-fallback="${tpl.icon.emoji}"></span>
        <span class="ls-name">${esc(l.name)}</span>
        <span class="ls-count">${count} 条</span>
      </button>`;
    }).join('');
    menu.innerHTML = items + `
      <div class="ls-divider"></div>
      <button class="bb-btn" id="ls-new">＋ 新建账本</button>
      <button class="bb-btn" id="ls-set">账本设置</button>`;
    if (window.JGIcons) window.JGIcons.mount(menu);
    menu.querySelectorAll('[data-led]').forEach(b => {
      b.addEventListener('click', () => { closeLedgerMenu(); switchLedger(b.dataset.led); });
    });
    $('ls-new').addEventListener('click', (e) => { closeLedgerMenu(); openLedgerNew(e.currentTarget); });
    $('ls-set').addEventListener('click', (e) => { closeLedgerMenu(); openLedgerSet(e.currentTarget); });
  }
  function closeLedgerMenu() { $('ls-menu').classList.add('hidden'); $('ledger-switch').classList.remove('open'); }
  function initLedgerSwitcher() {
    $('ls-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      const menu = $('ls-menu');
      const willOpen = menu.classList.contains('hidden');
      if (willOpen) buildLedgerMenu();
      menu.classList.toggle('hidden', !willOpen);
      $('ledger-switch').classList.toggle('open', willOpen);
    });
    document.addEventListener('click', (e) => {
      if (!$('ledger-switch').contains(e.target)) closeLedgerMenu();
    });
  }

  // ---------- 悬浮窗（POP）与 COMMIT 三态：实现抽到 js/modals.js，此处引用 ----------

  // ---------- FLIP / OUT（LAYOUT 与 FILTER 的动效积木） ----------
  function captureRects(viewEl) {
    const map = new Map();
    if (!REDUCED) {
      viewEl.querySelectorAll('[data-rec-id]:not(.f-out)').forEach(el => {
        map.set(el.dataset.recId, el.getBoundingClientRect());
      });
    }
    return map;
  }
  function playFlip(viewEl, before, { inNew = true } = {}) {
    if (REDUCED) return;
    viewEl.querySelectorAll('[data-rec-id]').forEach(el => {
      if (el.classList.contains('f-out')) return;
      const first = before.get(el.dataset.recId);
      const last = el.getBoundingClientRect();
      if (first) {
        const dx = first.left - last.left, dy = first.top - last.top;
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
          el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
            { duration: 340, easing: EASE_SPRING });
        }
      } else if (inNew) {
        el.animate([{ opacity: 0, transform: 'scale(.88)' }, { opacity: 1, transform: 'none' }],
          { duration: 280, easing: EASE_OUT });
      }
    });
  }
  function animateOut(els) {
    if (REDUCED) return Promise.resolve();
    return Promise.all(els.map(el =>
      el.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.86)' }],
        { duration: 200, easing: EASE_IN, fill: 'forwards' }).finished
    )).catch(() => { /* 中断不阻塞 */ });
  }

  // ---------- 模板驱动的表单 ----------
  function fieldInput(f, led) {
    const row = document.createElement('div');
    row.className = 'form-row';
    const label = document.createElement('label');
    label.textContent = f.label + (f.required ? ' *' : '');
    row.appendChild(label);
    const input = document.createElement('input');
    input.dataset.fkey = f.key;
    if (f.kind === 'date') input.type = 'date';
    else if (f.kind === 'time') input.type = 'time';
    else if (f.kind === 'number' || f.kind === 'money') { input.type = 'number'; if (f.step != null) input.step = f.step; if (f.min != null) input.min = f.min; }
    else input.type = 'text';
    if (f.wide) row.style.gridColumn = '1 / -1';
    // 默认值：编辑时由 startEdit 回填；新建取账本级默认，再退到字段默认；日期默认今天
    let val = f.def != null ? f.def : '';
    if (f.kind === 'date' && !val) val = fmtDate(new Date());
    if (f.fromLedger && led.settings[f.fromLedger] != null) val = led.settings[f.fromLedger];
    input.value = val;
    row.appendChild(input);
    return row;
  }
  function buildForm(led) {
    const tpl = tplOf(led);
    const box = $('form-fields');
    box.innerHTML = '';
    tpl.form.forEach(item => box.appendChild(renderFormItem(item, led)));
    // 自定义字段：追加在模板表单之后
    const customs = customFieldsOf(led);
    if (customs.length) {
      const wrap = document.createElement('div');
      const h = document.createElement('h3');
      h.className = 'group-title';
      h.textContent = '自定义字段';
      wrap.appendChild(h);
      const grid = document.createElement('div');
      grid.className = 'form-grid';
      customs.forEach(f => grid.appendChild(fieldInput({
        kind: f.kind, key: f.key, label: f.label,
        step: f.kind === 'money' ? 0.01 : (f.kind === 'number' ? 'any' : undefined),
        wide: f.kind === 'text',
      }, led)));
      wrap.appendChild(grid);
      box.appendChild(wrap);
    }
    box.querySelectorAll('input').forEach(inp => inp.addEventListener('input', updatePreview));
    formBuiltFor = led.id;
    updatePreview();
  }
  function renderFormItem(item, led) {
    if (item.type === 'row') {
      const grid = document.createElement('div');
      grid.className = 'form-grid';
      item.fields.forEach(f => grid.appendChild(f.kind === 'spacer' ? document.createElement('div') : fieldInput(f, led)));
      return grid;
    }
    if (item.type === 'group') {
      const wrap = document.createElement('div');
      const h = document.createElement('h3');
      h.className = 'group-title';
      h.textContent = item.title;
      wrap.appendChild(h);
      const grid = document.createElement('div');
      grid.className = 'form-grid';
      item.fields.forEach(f => grid.appendChild(fieldInput(f, led)));
      wrap.appendChild(grid);
      return wrap;
    }
    if (item.type === 'toggle') {
      const wrap = document.createElement('div');
      wrap.innerHTML = `<div class="check-row"><label class="switch-label"><input type="checkbox" data-toggle="${item.key}"> ${esc(item.label)}</label></div>`;
      const block = document.createElement('div');
      block.className = 'overtime-block hidden';
      const h = document.createElement('h3');
      h.className = 'group-title';
      h.textContent = item.block.title;
      block.appendChild(h);
      const grid = document.createElement('div');
      grid.className = 'form-grid';
      item.block.fields.forEach(f => grid.appendChild(fieldInput(f, led)));
      block.appendChild(grid);
      wrap.appendChild(block);
      const cb = wrap.querySelector('[data-toggle]');
      cb.addEventListener('change', () => { block.classList.toggle('hidden', !cb.checked); updatePreview(); });
      return wrap;
    }
    return document.createElement('div');
  }
  function readForm() {
    const led = activeLedger();
    const v = {};
    $('form-fields').querySelectorAll('[data-fkey]').forEach(inp => {
      const isNum = inp.type === 'number';
      v[inp.dataset.fkey] = isNum ? (parseFloat(inp.value) || 0) : inp.value.trim();
    });
    // 开关型（如加班）：未勾选时对应字段置空
    $('form-fields').querySelectorAll('[data-toggle]').forEach(cb => {
      if (!cb.checked) {
        const tpl = tplOf(led);
        tpl.form.forEach(item => {
          if (item.type === 'toggle' && item.key === cb.dataset.toggle) {
            item.block.fields.forEach(f => { v[f.key] = null; });
          }
        });
      }
    });
    return v;
  }
  function fillForm(rec) {
    $('form-fields').querySelectorAll('[data-fkey]').forEach(inp => {
      const val = rec.v[inp.dataset.fkey];
      inp.value = val == null ? '' : val;
    });
    $('form-fields').querySelectorAll('[data-toggle]').forEach(cb => {
      const tpl = tplOf(activeLedger());
      let has = false;
      tpl.form.forEach(item => {
        if (item.type === 'toggle' && item.key === cb.dataset.toggle) {
          has = item.block.fields.some(f => rec.v[f.key]);
        }
      });
      cb.checked = has;
      cb.dispatchEvent(new Event('change'));
    });
  }
  function updatePreview() {
    const led = activeLedger();
    const tpl = tplOf(led);
    const v = readForm();
    const box = $('preview-box');
    box.innerHTML = tpl.preview ? tpl.preview(v, led.settings) : '';
  }

  // ---------- 记录渲染（表格 / 卡片，模板驱动） ----------
  function renderSummary() {
    const tpl = tplOf(activeLedger());
    $('summary-cards').innerHTML = tpl.summary(records)
      .map(c => `<div class="sum-card"><div class="label">${c.label}</div><div class="value ${c.cls || ''}">${c.value}</div></div>`).join('');
  }
  function matchFilter(r) {
    if (ui.filter === 'all') return true;
    const tpl = tplOf(activeLedger());
    return tpl.tagsOf(r).includes(ui.filter);
  }
  function renderView(name, sorted) {
    sorted = sorted || records.slice().sort((a, b) => b.v.date.localeCompare(a.v.date));
    const led = activeLedger();
    const tpl = tplOf(led);
    const customs = customFieldsOf(led);
    if (name === 'cards') {
      const box = $('cards-view');
      box.innerHTML = sorted.map(r => {
        const customRows = customs.map(f => {
          const v = r.v[f.key];
          if (v == null || v === '') return '';
          return `<div class="rc-row">${esc(f.label)}：<span class="${f.kind === 'money' ? 'money' : ''}">${f.kind === 'money' ? money(+v || 0) : esc(v)}</span></div>`;
        }).join('');
        const foot = tpl.foot ? tpl.foot(r) : '';
        return `
        <div class="rec-card ${selectMode && selectedIds.has(r.id) ? 'selected' : ''}" data-rec-id="${r.id}" data-tags="${tpl.tagsOf(r).join(' ')}">
          <span class="sel-dot" aria-hidden="true"></span>
          ${tpl.card(r)}
          ${customRows}
          ${foot ? `<div class="rc-foot"><span>${foot}</span></div>` : ''}
          <div class="rc-ops"><button class="op-btn edit" data-edit="${r.id}">编辑</button><button class="op-btn del" data-del="${r.id}">删除</button></div>
        </div>`;
      }).join('');
      bindRecordEvents(box);
    } else {
      const customCols = customs.map(f => ({ label: esc(f.label), get: r => formatCustom(r.v[f.key], f.kind) }));
      const cols = tpl.columns.concat(customCols);
      $('records-thead').innerHTML = '<tr>' + cols.map(c => `<th>${c.label}</th>`).join('') + '<th>操作</th></tr>';
      const tbody = $('records-tbody');
      tbody.innerHTML = sorted.map(r => `
        <tr data-rec-id="${r.id}" data-tags="${tpl.tagsOf(r).join(' ')}">
          ${cols.map(c => `<td>${c.get(r)}</td>`).join('')}
          <td>
            <button class="op-btn edit" data-edit="${r.id}">编辑</button>
            <button class="op-btn del" data-del="${r.id}">删除</button>
          </td>
        </tr>`).join('');
      bindRecordEvents(tbody);
    }
  }
  function bindRecordEvents(container) {
    container.querySelectorAll('[data-edit]').forEach(b => {
      b.addEventListener('click', (e) => { e.stopPropagation(); startEdit(b.dataset.edit, b); });
    });
    container.querySelectorAll('[data-del]').forEach(b => {
      b.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm('确定删除这条记录吗？删除后无法恢复。')) return;
        const card = b.closest('[data-rec-id]');
        if (card) await animateOut([card]);
        records = records.filter(r => r.id !== b.dataset.del);
        const viewEl = getViewEl();
        const before = captureRects(viewEl);
        renderRecords({ flip: false });
        playFlip(viewEl, before);
        persistData();
        toast('已删除');
      });
    });
    container.querySelectorAll('.rec-card[data-rec-id]').forEach(card => {
      card.addEventListener('click', () => {
        if (!selectMode) return;
        const id = card.dataset.recId;
        if (selectedIds.has(id)) selectedIds.delete(id); else selectedIds.add(id);
        card.classList.toggle('selected', selectedIds.has(id));
        updateSelectUI();
      });
    });
  }
  function getViewEl() { return $(ui.view === 'cards' ? 'cards-view' : 'table-view'); }
  function updateEmptyTips(sorted) {
    sorted = sorted || records;
    const visible = sorted.filter(matchFilter).length;
    $('table-empty').style.display = sorted.length ? 'none' : 'block';
    $('filter-empty').classList.toggle('hidden', !(sorted.length && !visible));
  }
  function renderRecords(opts = {}) {
    const { flip = true } = opts;
    renderSummary();
    const sorted = records.slice().sort((a, b) => b.v.date.localeCompare(a.v.date));
    const viewEl = getViewEl();
    const before = flip ? captureRects(viewEl) : null;
    renderView(ui.view, sorted);
    updateEmptyTips(sorted);
    if (before) playFlip(viewEl, before, { inNew: true });
  }
  function persistData() {
    saveLedRecords(activeId, records);
    renderSummary();
    if (window.JGCharts) window.JGCharts.render(records);
    window.dispatchEvent(new CustomEvent('jigong:datachanged'));
  }
  function dataChanged() { persistData(); renderRecords(); }

  // ---------- LAYOUT：表格 ⇄ 卡片 ----------
  function syncViewVisibility() {
    $('table-view').classList.toggle('hidden', ui.view !== 'table');
    $('cards-view').classList.toggle('hidden', ui.view !== 'cards');
  }
  function applyView(next) {
    if (ui.view === next) return;
    if (selectMode) exitSelect();
    const oldEl = getViewEl();
    const before = captureRects(oldEl);
    ui.view = next; saveUI(); updateSegUI();
    syncViewVisibility();
    renderView(next);
    updateEmptyTips();
    const newEl = getViewEl();
    requestAnimationFrame(() => {
      if (REDUCED) return;
      newEl.querySelectorAll('[data-rec-id]:not(.f-out)').forEach(el => {
        const first = before.get(el.dataset.recId);
        const last = el.getBoundingClientRect();
        if (first) {
          const dx = first.left - last.left, dy = first.top - last.top;
          if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
            el.animate([{ transform: `translate(${dx}px, ${dy}px) scale(1)` }, { transform: 'none' }],
              { duration: 360, easing: EASE_SPRING });
          } else {
            el.animate([{ opacity: .35 }, { opacity: 1 }], { duration: 260, easing: EASE_OUT });
          }
        } else {
          el.animate([{ opacity: 0, transform: 'scale(.9)' }, { opacity: 1, transform: 'none' }],
            { duration: 280, easing: EASE_OUT });
        }
      });
    });
  }

  // ---------- FILTER：三条曲线 ----------
  async function applyFilter(next) {
    if (ui.filter === next) return;
    if (selectMode) exitSelect();
    const viewEl = getViewEl();
    const els = Array.from(viewEl.querySelectorAll('[data-rec-id]'));
    const first = captureRects(viewEl);
    const willMatch = el => next === 'all' || (el.dataset.tags || '').split(' ').includes(next);
    const toHide = els.filter(el => !el.classList.contains('f-out') && !willMatch(el));
    const toShow = els.filter(el => el.classList.contains('f-out') && willMatch(el));

    ui.filter = next; saveUI(); updateSegUI();
    await animateOut(toHide);
    toHide.forEach(el => { el.getAnimations().forEach(a => a.cancel()); el.classList.add('f-out'); });
    toShow.forEach(el => el.classList.remove('f-out'));
    updateEmptyTips();
    requestAnimationFrame(() => {
      els.forEach(el => {
        if (el.classList.contains('f-out')) return;
        const f = first.get(el.dataset.recId);
        const l = el.getBoundingClientRect();
        const moved = f && (Math.abs(f.left - l.left) > 1 || Math.abs(f.top - l.top) > 1);
        if (moved) {
          el.animate([{ transform: `translate(${f.left - l.left}px, ${f.top - l.top}px)` }, { transform: 'none' }],
            { duration: 340, easing: EASE_SPRING });
        } else if (toShow.includes(el)) {
          el.animate([{ opacity: 0, transform: 'scale(.88)' }, { opacity: 1, transform: 'none' }],
            { duration: 280, easing: EASE_OUT });
        }
      });
    });
  }
  function buildFilterSeg() {
    const tpl = tplOf(activeLedger());
    const seg = $('filter-seg');
    const defs = tpl.filters || [];
    seg.classList.toggle('hidden', defs.length === 0);
    seg.innerHTML = `<button class="seg-btn ${ui.filter === 'all' ? 'active' : ''}" data-filter="all">全部</button>` +
      defs.map(f => `<button class="seg-btn ${ui.filter === f.key ? 'active' : ''}" data-filter="${f.key}">${f.label}</button>`).join('');
  }
  function updateSegUI() {
    document.querySelectorAll('#view-seg .seg-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.view === ui.view);
    });
    buildFilterSeg();
  }

  // ---------- SELECT：整页多选 ----------
  function updateDetailTitle() {
    $('detail-title').textContent = selectMode
      ? (selectedIds.size ? `已选 ${selectedIds.size} 条` : '点卡片勾选要删除的记录')
      : '工作记录明细';
  }
  function updateSelectUI() {
    $('bb-count').textContent = selectedIds.size;
    $('batch-bar').classList.toggle('show', selectMode);
    const visible = records.filter(matchFilter);
    const allPicked = visible.length > 0 && visible.every(r => selectedIds.has(r.id));
    $('bb-toggle-all').textContent = allPicked ? '全不选' : '全选';
    updateDetailTitle();
  }
  function enterSelect() {
    if (selectMode) return;
    selectMode = true;
    selectedIds.clear();
    document.body.classList.add('selecting');
    if (ui.view !== 'cards') applyView('cards');
    renderView('cards');
    updateSelectUI();
  }
  function exitSelect() {
    selectMode = false;
    selectedIds.clear();
    document.body.classList.remove('selecting');
    renderView(ui.view);
    updateSelectUI();
  }
  async function deleteSelected() {
    if (!selectedIds.size) { toast('请先点卡片勾选记录'); return; }
    if (!confirm(`确定删除选中的 ${selectedIds.size} 条记录吗？删除后无法恢复。`)) return;
    const viewEl = getViewEl();
    const doomed = Array.from(viewEl.querySelectorAll('[data-rec-id]'))
      .filter(el => selectedIds.has(el.dataset.recId));
    await animateOut(doomed);
    const ids = new Set(selectedIds);
    records = records.filter(r => !ids.has(r.id));
    const before = captureRects(viewEl);
    renderRecords({ flip: false });
    playFlip(viewEl, before);
    persistData();
    exitSelect();
    toast(`已删除 ${ids.size} 条记录`);
  }

  // ---------- TILT：汇总铭牌 3D 倾斜 + 高光 ----------
  function initTilt() {
    if (REDUCED || !window.matchMedia('(pointer: fine)').matches) return;
    const wrap = $('summary-cards');
    wrap.addEventListener('mousemove', (e) => {
      const card = e.target.closest('.sum-card');
      if (!card) return;
      const r = card.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      card.style.setProperty('--gx', (px * 100).toFixed(1) + '%');
      card.style.setProperty('--gy', (py * 100).toFixed(1) + '%');
      card.style.transition = 'transform .07s linear, box-shadow .3s ease';
      card.style.transform =
        `perspective(700px) rotateX(${((0.5 - py) * 8).toFixed(2)}deg) rotateY(${((px - 0.5) * 10).toFixed(2)}deg) translateY(-2px)`;
      card.classList.add('tilting');
    });
    wrap.addEventListener('mouseout', (e) => {
      const card = e.target.closest('.sum-card');
      if (!card || card.contains(e.relatedTarget)) return;
      card.classList.remove('tilting');
      card.style.transition = '';
      card.style.transform = '';
    });
  }

  // ---------- 记录表单（悬浮窗内） ----------
  function initForm() {
    $('btn-add').addEventListener('click', (e) => {
      resetForm();
      openModal('modal-record', e.currentTarget);
    });
    $('btn-save').addEventListener('click', saveRecord);
    $('btn-reset-form').addEventListener('click', resetForm);
  }
  async function saveRecord() {
    const btn = $('btn-save');
    if (btn.classList.contains('is-loading') || btn.classList.contains('is-done')) return;
    const led = activeLedger();
    const tpl = tplOf(led);
    const v = readForm();
    const err = tpl.validate(v);
    if (err) { toast(err); return; }
    const m = tpl.compute(v);
    if (editingId) {
      const i = records.findIndex(r => r.id === editingId);
      if (i >= 0) records[i] = { id: editingId, v, m };
      setCommitDone(btn, '已更新');
    } else {
      records.push({ id: uid(), v, m });
      setCommitDone(btn, '已保存');
    }
    dataChanged();
    await commitPlay(btn);
    closeModal();
    resetForm();
  }
  function resetForm() {
    editingId = null;
    buildForm(activeLedger());
    const btn = $('btn-save');
    setCommitLabel(btn, '保存记录');
    setCommitDone(btn, '已保存');
  }
  function startEdit(id, triggerEl) {
    const r = records.find(x => x.id === id);
    if (!r) return;
    editingId = id;
    buildForm(activeLedger());
    fillForm(r);
    setCommitLabel($('btn-save'), '更新这条记录');
    setCommitDone($('btn-save'), '已更新');
    openModal('modal-record', triggerEl);
  }

  // ---------- 账本管理（新建 / 设置 / 删除） ----------
  function renderDefaultsBox(box, tpl, values) {
    box.innerHTML = '';
    const fields = tpl.defaultsFields || [];
    if (!fields.length) return;
    const grid = document.createElement('div');
    grid.className = 'form-grid';
    fields.forEach(f => {
      const row = document.createElement('div');
      row.className = 'form-row';
      row.innerHTML = `<label>${esc(f.label)}</label>`;
      const input = document.createElement('input');
      input.type = 'number';
      input.dataset.skey = f.key;
      if (f.step != null) input.step = f.step;
      if (f.min != null) input.min = f.min;
      input.value = values[f.key] != null ? values[f.key] : f.def;
      row.appendChild(input);
      grid.appendChild(row);
    });
    box.appendChild(grid);
  }
  function collectDefaults(box) {
    const s = {};
    box.querySelectorAll('[data-skey]').forEach(inp => { s[inp.dataset.skey] = parseFloat(inp.value) || 0; });
    return s;
  }
  let newTplId = 'hourly';
  function openLedgerNew(triggerEl) {
    newTplId = 'hourly';
    renderTplPick();
    $('nl-name').value = '';
    renderDefaultsBox($('nl-extra'), TPL().byId[newTplId], {});
    openModal('modal-ledger-new', triggerEl);
  }
  function renderTplPick() {
    const pick = $('tpl-pick');
    pick.innerHTML = TPL().list.map(t => `
      <button class="tpl-card ${t.id === newTplId ? 'active' : ''}" data-tpl="${t.id}">
        <span class="tp-ico" data-icon="${t.icon.svg}" data-fallback="${t.icon.emoji}"></span>
        <span><span class="tp-name">${t.name}</span><span class="tp-desc">${t.tagline}</span></span>
      </button>`).join('');
    if (window.JGIcons) window.JGIcons.mount(pick);
    pick.querySelectorAll('[data-tpl]').forEach(b => {
      b.addEventListener('click', () => {
        newTplId = b.dataset.tpl;
        renderTplPick();
        const tpl = TPL().byId[newTplId];
        $('nl-name').value = '';
        $('nl-name').placeholder = '如：' + tpl.name;
        renderDefaultsBox($('nl-extra'), tpl, {});
      });
    });
  }
  async function createLedger() {
    const btn = $('btn-create-ledger');
    if (btn.classList.contains('is-loading') || btn.classList.contains('is-done')) return;
    const tpl = TPL().byId[newTplId];
    const name = $('nl-name').value.trim() || tpl.name;
    const led = { id: uid(), name, templateId: newTplId, settings: collectDefaults($('nl-extra')), createdAt: Date.now() };
    saveLedRecords(led.id, []);
    ledgers.push(led);
    saveLedgersStore();
    await commitPlay(btn);
    closeModal();
    switchLedger(led.id, { silent: true });
    toast('账本「' + name + '」已创建 ✓');
  }
  // ---------- 自定义字段管理器（账本设置弹窗内编辑草稿） ----------
  let cfDraft = [];
  function renderCfManager() {
    const box = $('stl-cf');
    const rows = cfDraft.map(f => `
      <div class="cf-row" data-cf-key="${f.key}">
        <span class="cf-kind">${CF_KINDS[f.kind] || f.kind}</span>
        <input type="text" data-cf-label value="${esc(f.label)}" placeholder="字段名称">
        <label class="cf-on"><input type="checkbox" data-cf-en ${f.enabled !== false ? 'checked' : ''}> 启用</label>
        <button type="button" class="cf-del" data-cf-del="${f.key}" title="删除字段（历史值一并清除）">删除</button>
      </div>`).join('');
    box.innerHTML = (cfDraft.length ? rows : '<p class="hint" style="margin:4px 0">还没有自定义字段。</p>') + `
      <div class="cf-add">
        <select data-cf-newkind>
          <option value="text">文本</option>
          <option value="number">数字</option>
          <option value="money">金额（元）</option>
        </select>
        <input type="text" data-cf-newname placeholder="字段名称，如：布料款">
        <button type="button" class="bb-btn" data-cf-add>＋ 添加</button>
      </div>`;
    // 改名 / 启停：即时写入草稿，不重渲染（避免输入框失焦）
    box.querySelectorAll('.cf-row').forEach(row => {
      const key = row.dataset.cfKey;
      row.querySelector('[data-cf-label]').addEventListener('input', (e) => {
        const f = cfDraft.find(x => x.key === key);
        if (f) f.label = e.target.value.trim();
      });
      row.querySelector('[data-cf-en]').addEventListener('change', (e) => {
        const f = cfDraft.find(x => x.key === key);
        if (f) f.enabled = e.target.checked;
      });
      row.querySelector('[data-cf-del]').addEventListener('click', () => {
        const f = cfDraft.find(x => x.key === key);
        if (f && !confirm(`删除字段「${f.label || f.key}」？历史记录里该字段的值会一并清除。`)) return;
        cfDraft = cfDraft.filter(x => x.key !== key);
        renderCfManager();
      });
    });
    box.querySelector('[data-cf-add]').addEventListener('click', () => {
      const kind = box.querySelector('[data-cf-newkind]').value;
      const label = box.querySelector('[data-cf-newname]').value.trim();
      if (!label) { toast('请先填写字段名称'); return; }
      if (cfDraft.some(f => f.label === label)) { toast('已经有同名字段了'); return; }
      cfDraft.push({ key: uid(), kind, label, enabled: true });
      renderCfManager();
    });
  }
  function openLedgerSet(triggerEl) {
    const led = activeLedger();
    const tpl = tplOf(led);
    $('stl-name').value = led.name;
    renderDefaultsBox($('stl-extra'), tpl, led.settings);
    cfDraft = customFieldsOf(led, false).map(f => Object.assign({}, f));
    renderCfManager();
    openModal('modal-ledger-set', triggerEl);
  }
  async function saveLedgerSettings() {
    const btn = $('btn-save-ledger');
    if (btn.classList.contains('is-loading') || btn.classList.contains('is-done')) return;
    const led = activeLedger();
    const name = $('stl-name').value.trim();
    if (!name) { toast('账本名称不能为空'); return; }
    led.name = name;
    led.settings = Object.assign({}, led.settings, collectDefaults($('stl-extra')));
    // 自定义字段：空名称视为删除；被删掉的字段从历史记录里剥离数值
    const finalFields = cfDraft
      .filter(f => f.label)
      .map(f => ({ key: f.key, kind: f.kind, label: f.label, enabled: f.enabled !== false }));
    const beforeKeys = customFieldsOf(led, false).map(f => f.key);
    const afterKeys = finalFields.map(f => f.key);
    const stripped = beforeKeys.filter(k => !afterKeys.includes(k));
    led.customFields = finalFields;
    if (stripped.length) {
      records.forEach(r => stripped.forEach(k => { delete r.v[k]; }));
      saveLedRecords(activeId, records);
    }
    saveLedgersStore();
    renderLedgerSwitcher();
    formBuiltFor = null;
    await commitPlay(btn);
    closeModal();
    renderRecords({ flip: false });
    toast('账本设置已保存 ✓');
  }
  async function deleteActiveLedger() {
    const led = activeLedger();
    const count = records.length;
    if (!confirm(`确定删除账本「${led.name}」吗？里面 ${count} 条记录会一起删除，无法恢复！`)) return;
    if (!confirm('再次确认：真的要删除吗？（建议先到「设置 → 数据管理」导出备份）')) return;
    ledgers = ledgers.filter(l => l.id !== led.id);
    localStorage.removeItem('jigong_led_' + led.id);
    saveLedgersStore();
    if (!ledgers.length) {
      ensureLedgers();
      records = loadLedRecords(ledgers[0].id);
    }
    closeModal();
    switchLedger(ledgers[0].id, { silent: true });
    toast('账本已删除');
  }
  function initLedgerModals() {
    $('btn-create-ledger').addEventListener('click', createLedger);
    $('btn-save-ledger').addEventListener('click', saveLedgerSettings);
    $('btn-del-ledger').addEventListener('click', deleteActiveLedger);
  }

  // ---------- 导入 / 导出（v2 多账本；兼容 v1 旧备份） ----------
  function exportBackup() {
    const payload = {
      app: 'jigong', ver: 2, exportedAt: new Date().toISOString(), settings,
      ledgers: ledgers.map(l => ({ id: l.id, name: l.name, templateId: l.templateId, settings: l.settings, customFields: l.customFields || [], createdAt: l.createdAt, records: loadLedRecords(l.id) })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '记账备份_' + fmtDate(new Date()) + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
    toast('备份文件已导出 ✓');
    closeModal();
  }
  function openExportModal(triggerEl) {
    const total = ledgers.reduce((s, l) => s + loadLedRecords(l.id).length, 0);
    $('export-stats').textContent = total
      ? `当前共 ${ledgers.length} 本账、${total} 条记录，将连同设置一起导出。`
      : `当前有 ${ledgers.length} 本账、暂无记录，仍可导出（仅含设置）。`;
    openModal('modal-export', triggerEl);
  }
  function initImportExport() {
    $('btn-export').addEventListener('click', (e) => openExportModal(e.currentTarget));
    $('btn-export-download').addEventListener('click', exportBackup);
    $('btn-import').addEventListener('click', (e) => openModal('modal-import', e.currentTarget));
    $('btn-import-pick').addEventListener('click', () => $('import-file').click());
    $('import-file').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const obj = JSON.parse(reader.result);
          if (obj.ver === 2 && Array.isArray(obj.ledgers)) importV2(obj);
          else if (Array.isArray(obj.records)) importV1(obj);
          else throw new Error('文件里没有可识别的账本或记录数据');
        } catch (err) {
          alert('导入失败：' + err.message);
        }
      };
      reader.readAsText(file, 'utf-8');
      e.target.value = '';
    });
  }
  function importV2(obj) {
    let addedLedgers = 0, addedRecords = 0;
    if (!confirm(`备份里有 ${obj.ledgers.length} 本账，将与现有账本合并（同账本内按内容去重），继续吗？`)) return;
    obj.ledgers.forEach(inc => {
      const tpl = TPL().byId[inc.templateId] || TPL().byId.hourly;
      let led = ledgers.find(l => l.id === inc.id && l.templateId === inc.templateId);
      if (!led) {
        led = { id: uid(), name: inc.name || tpl.name, templateId: tpl.id, settings: inc.settings || {}, createdAt: Date.now() };
        ledgers.push(led);
        addedLedgers++;
      }
      // 自定义字段：按键合并（同键以备份为准），保证备份里的字段定义与值一致
      const incCf = Array.isArray(inc.customFields) ? inc.customFields : [];
      if (incCf.length) {
        const cur = Array.isArray(led.customFields) ? led.customFields.slice() : [];
        incCf.forEach(f => {
          if (!f || !f.key) return;
          const i = cur.findIndex(x => x.key === f.key);
          if (i >= 0) cur[i] = Object.assign({}, cur[i], f);
          else cur.push(f);
        });
        led.customFields = cur;
      }
      const existing = loadLedRecords(led.id);
      const sigs = new Set(existing.map(r => ledgerSignature(r, led)));
      (inc.records || []).forEach(r => {
        if (!r || !r.v || !r.v.date) return;
        const rec = { id: r.id || uid(), v: r.v, m: r.m && Object.keys(r.m).length ? r.m : tpl.compute(r.v) };
        const sig = ledgerSignature(rec, led);
        if (sigs.has(sig)) return;
        sigs.add(sig);
        existing.push(rec);
        addedRecords++;
      });
      saveLedRecords(led.id, existing);
    });
    if (obj.settings && typeof obj.settings === 'object') {
      settings = Object.assign({}, DEFAULT_SETTINGS, settings, obj.settings);
      saveSettingsStore();
      applySettingsToUI();
    }
    saveLedgersStore();
    switchLedger(activeId, { silent: true });
    dataChanged();
    closeModal();
    toast(`导入完成：新增 ${addedLedgers} 本账、${addedRecords} 条记录 ✓`);
  }
  function importV1(obj) {
    if (!confirm(`这是旧版备份，含 ${obj.records.length} 条计时工记录，将并入当前计时工账本（按内容去重），继续吗？`)) return;
    let led = activeLedger().templateId === 'hourly' ? activeLedger() : ledgers.find(l => l.templateId === 'hourly');
    if (!led) {
      led = { id: uid(), name: '导入的计时工账', templateId: 'hourly', settings: {}, createdAt: Date.now() };
      ledgers.push(led);
    }
    const existing = loadLedRecords(led.id);
    const sigs = new Set(existing.map(TPL().byId.hourly.signature));
    let added = 0;
    obj.records.forEach(r => {
      if (!r || !r.date) return;
      const rec = TPL().convertLegacyRecord(r);
      const sig = TPL().byId.hourly.signature(rec);
      if (sigs.has(sig)) return;
      sigs.add(sig);
      existing.push(rec);
      added++;
    });
    saveLedRecords(led.id, existing);
    if (obj.settings && typeof obj.settings === 'object') {
      led.settings = Object.assign({}, led.settings,
        obj.settings.nRate != null ? { nRate: obj.settings.nRate } : {},
        obj.settings.oRate != null ? { oRate: obj.settings.oRate } : {});
      settings = Object.assign({}, DEFAULT_SETTINGS, settings, obj.settings, {
        nRate: undefined, oRate: undefined,
      });
      saveSettingsStore();
      applySettingsToUI();
    }
    saveLedgersStore();
    switchLedger(led.id, { silent: true });
    dataChanged();
    closeModal();
    toast(`导入完成：新增 ${added} 条记录 ✓`);
  }

  // ---------- 设置（AI 模型） ----------
  let editProvider = null;   // 设置页当前正在编辑的厂商

  function applySettingsToUI() {
    if (!editProvider) editProvider = settings.activeApi;
    renderApiTabs();
    renderApiEditor();
  }
  function persistEditorToApi(p) {
    const api = settings.apis[p];
    if (!api) return;
    api.baseUrl = $('s-baseurl').value.trim();
    api.apiKey = $('s-apikey').value.trim();
  }

  // ---------- 模型档案管理（按厂商分组：行内直接编辑并自动保存） ----------
  function renderApiTabs() {
    const tabs = $('api-tabs');
    tabs.innerHTML = Object.keys(settings.apis).map(p =>
      `<button class="seg-btn ${p === editProvider ? 'active' : ''}" data-ap="${p}">${apiName(p)}</button>`).join('');
    tabs.querySelectorAll('[data-ap]').forEach(b => {
      b.addEventListener('click', () => switchEditApi(b.dataset.ap));
    });
  }
  function renderApiEditor() {
    const api = settings.apis[editProvider];
    $('s-baseurl').value = api.baseUrl || '';
    $('s-apikey').value = api.apiKey || '';
    renderModelRows();
  }
  function renderModelRows() {
    const api = settings.apis[editProvider];
    const box = $('s-models');
    box.innerHTML = (api.models.length ? '' : '<p class="hint" style="margin:4px 0">当前厂商还没有模型，点下方「＋ 添加模型」。</p>') +
      api.models.map(f => `
      <div class="mp-row ${f.id === api.currentModelId ? 'cur' : ''}">
        <label class="mp-cur" title="设为当前模型"><input type="radio" name="mp-cur" ${f.id === api.currentModelId ? 'checked' : ''} data-mpcur="${f.id}"></label>
        <input type="text" data-mpname="${f.id}" value="${esc(f.label)}" placeholder="显示名称">
        <input type="text" data-mpmodel="${f.id}" value="${esc(f.model)}" placeholder="模型 ID">
        <input type="number" data-mpctx="${f.id}" value="${f.context || 128}" min="1" title="上下文窗口（千 tokens）">
        <input type="number" data-mpout="${f.id}" value="${f.maxOut || 4095}" min="1" title="最大输出（tokens）">
        <button type="button" class="mp-del" data-mpdel="${f.id}" title="删除模型">✕</button>
      </div>`).join('');
    // 行内编辑：即时写回当前厂商的模型并自动持久化
    box.querySelectorAll('.mp-row').forEach(row => {
      const id = row.querySelector('[data-mpcur]').dataset.mpcur;
      const f = api.models.find(x => x.id === id);
      if (!f) return;
      row.querySelector('[data-mpname]').addEventListener('input', e => { f.label = e.target.value.trim(); saveSettingsStore(); });
      row.querySelector('[data-mpmodel]').addEventListener('input', e => { f.model = e.target.value.trim(); saveSettingsStore(); });
      row.querySelector('[data-mpctx]').addEventListener('input', e => { f.context = parseFloat(e.target.value) || 128; saveSettingsStore(); });
      row.querySelector('[data-mpout]').addEventListener('input', e => { f.maxOut = parseFloat(e.target.value) || 4095; saveSettingsStore(); });
      row.querySelector('[data-mpcur]').addEventListener('change', e => {
        if (e.target.checked) { api.currentModelId = id; saveSettingsStore(); }
        renderModelRows();
      });
      row.querySelector('[data-mpdel]').addEventListener('click', () => {
        if (!confirm(`删除模型「${f.label || f.model}」？`)) return;
        api.models = api.models.filter(x => x.id !== id);
        if (api.currentModelId === id) api.currentModelId = api.models.length ? api.models[0].id : null;
        saveSettingsStore();
        renderModelRows();
      });
    });
  }
  function switchEditApi(p) {
    ensureApiEntry(p);
    if (editProvider && settings.apis[editProvider]) persistEditorToApi(editProvider);  // 防丢：切走前存回
    editProvider = p;
    const becameActive = settings.activeApi !== p;
    settings.activeApi = p;          // 切厂商标签 = 切换当前使用的 API
    saveSettingsStore();
    renderApiTabs();
    renderApiEditor();
    if (window.JGChat && window.JGChat.updateModelUI) window.JGChat.updateModelUI();
    if (becameActive) toast('当前 API 已切换为「' + apiName(p) + '」');
  }
  function initSettings() {
    applySettingsToUI();
    $('btn-add-model').addEventListener('click', () => {
      const api = settings.apis[editProvider];
      api.models.push({ id: uid(), model: '', label: '', context: 128, maxOut: 4095 });
      api.currentModelId = api.currentModelId || api.models[api.models.length - 1].id;
      saveSettingsStore();
      renderModelRows();
    });
    $('btn-save-model').addEventListener('click', async () => {
      const btn = $('btn-save-model');
      if (btn.classList.contains('is-loading') || btn.classList.contains('is-done')) return;
      persistEditorToApi(editProvider);
      const api = settings.apis[editProvider];
      if (!api.baseUrl) { toast('请填写接口地址'); return; }
      saveSettingsStore();
      await commitPlay(btn);
      toast('「' + apiName(editProvider) + '」设置已保存 ✓');
    });
  }

    // ---------- 数据管理 ----------
  function initDataTools() {
    $('btn-sample').addEventListener('click', () => {
      const led = activeLedger();
      const tpl = tplOf(led);
      if (records.length && !confirm(`将往「${led.name}」追加 14 天示例数据，继续吗？`)) return;
      records = records.concat(tpl.sample(led.settings || {}));
      dataChanged();
      toast('示例数据已填入，去「图表」页看看吧 ✓');
    });
    $('btn-clear').addEventListener('click', () => {
      if (!records.length) { toast('当前账本没有记录'); return; }
      if (confirm(`确定清空「${activeLedger().name}」的全部记录吗？此操作无法恢复（建议先导出备份）。`)) {
        records = [];
        dataChanged();
        toast('已清空当前账本的记录');
      }
    });
  }

  // ---------- 交互入口（视图/筛选/多选） ----------
  function initInteractions() {
    document.querySelectorAll('#view-seg .seg-btn').forEach(btn => {
      btn.addEventListener('click', () => applyView(btn.dataset.view));
    });
    $('filter-seg').addEventListener('click', (e) => {
      const btn = e.target.closest('.seg-btn');
      if (btn) applyFilter(btn.dataset.filter);
    });
    $('btn-select').addEventListener('click', () => {
      if (selectMode) { exitSelect(); return; }
      enterSelect();
      toast('点卡片勾选，完成后点底部「删除」');
    });
    $('bb-toggle-all').addEventListener('click', () => {
      const visible = records.filter(matchFilter);
      const allPicked = visible.length > 0 && visible.every(r => selectedIds.has(r.id));
      if (allPicked) selectedIds.clear();
      else visible.forEach(r => selectedIds.add(r.id));
      document.querySelectorAll('#cards-view .rec-card').forEach(card => {
        card.classList.toggle('selected', selectedIds.has(card.dataset.recId));
      });
      updateSelectUI();
    });
    $('bb-delete').addEventListener('click', deleteSelected);
    $('bb-exit').addEventListener('click', exitSelect);
  }

  // ---------- 启动 ----------
  document.addEventListener('DOMContentLoaded', () => {
    const mig = ensureLedgers();
    migrateModelSettings();
    activeId = localStorage.getItem(LS_ACTIVE);
    if (!ledgers.find(l => l.id === activeId)) activeId = ledgers[0].id;
    records = loadLedRecords(activeId);
    ui = loadUI();

    initNav();
    initLedgerSwitcher();
    initModals();
    initLedgerModals();
    initForm();
    initImportExport();
    initSettings();
    initDataTools();
    initInteractions();
    initTilt();

    renderLedgerSwitcher();
    updateSegUI();
    syncViewVisibility();
    renderRecords({ flip: false });
    updateSelectUI();
    if (window.JGCharts) window.JGCharts.render(records);
    if (window.JGChat) window.JGChat.reload();
    if (mig.migrated) toast(`已自动升级为多账本：${mig.count} 条记录已迁入「服装厂计时工」✓`);
  });

  // 供 charts.js / chat.js 使用
  window.JG = {
    getRecords: () => records,
    getSettings: () => settings,
    getActiveLedger: () => activeLedger(),
    getActiveTemplate: () => tplOf(activeLedger()),
    switchTab, toast,
    // 模型快切（chat.js 输入坞菜单用）：按厂商分组，选中模型即切换其整套 API
    ModelSwitch: {
      activeInfo() {
        const p = settings.activeApi;
        const api = settings.apis[p] || {};
        const model = api.models.find(m => m.id === api.currentModelId) || api.models[0] || null;
        return { provider: p, name: (API_PRESETS[p] || {}).name || 'API',
          baseUrl: api.baseUrl || '', apiKey: api.apiKey || '', model };
      },
      apiList() {
        return Object.keys(settings.apis).map(p => ({
          provider: p, name: (API_PRESETS[p] || {}).name || p, hasKey: !!settings.apis[p].apiKey,
          models: settings.apis[p].models || [],
        }));
      },
      selectModel(provider, modelId) {
        const api = settings.apis[provider];
        if (!api || !api.models.length) return false;
        settings.activeApi = provider;
        api.currentModelId = modelId;
        saveSettingsStore();
        return true;
      },
    },
  };
})();

/* 存储层：localStorage 读写、厂商 API 预设、模型设置迁移
   （从 app.js 抽离，V0.9.8；无状态设计——数据由调用方传入，本层只负责读写与迁移） */
(function () {
  'use strict';

  const LS = {
    SETTINGS: 'jigong_settings',
    LEDGERS: 'jigong_ledgers',
    ACTIVE: 'jigong_active_ledger',
    UI: 'jigong_ui',
    V1_BACKUP: 'jigong_records_v1_backup',
    LED_PREFIX: 'jigong_led_',
    CHAT_PREFIX: 'jigong_chat_',
    SESSIONS_PREFIX: 'jigong_sessions_',
    ACTIVE_SESSION_PREFIX: 'jigong_active_session_',
  };

  // 各厂商 OpenAI 兼容接口：预填地址与常用模型档案（一个厂商 = 一套独立 API + 模型列表）
  const PRESETS = {
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

  function loadJSON(key, fallback) {
    try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; }
    catch { return fallback; }
  }
  function saveJSON(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

  function loadSettings() { return loadJSON(LS.SETTINGS, {}); }
  function saveSettings(settings) { saveJSON(LS.SETTINGS, settings); }

  function loadLedgers() {
    const l = loadJSON(LS.LEDGERS, []);
    return Array.isArray(l) ? l : [];
  }
  function saveLedgers(ledgers) { saveJSON(LS.LEDGERS, ledgers); }
  function loadLedRecords(id) { return loadJSON(LS.LED_PREFIX + id, []); }
  function saveLedRecords(id, recs) { saveJSON(LS.LED_PREFIX + id, recs); }
  function removeLedRecords(id) { localStorage.removeItem(LS.LED_PREFIX + id); }

  function apiName(p) { return (PRESETS[p] || {}).name || p; }
  // 确保 apis 映射中存在某厂商条目（缺省：预填地址 + 预设模型档案，Key 留空）
  function ensureApiEntry(apis, p) {
    if (apis[p]) return apis[p];
    const preset = PRESETS[p] || { url: '', name: p, models: [] };
    apis[p] = {
      baseUrl: preset.url || '', apiKey: '',
      models: (preset.models || []).map(m => ({ ...m })),
      currentModelId: (preset.models || [])[0]?.id || null,
    };
    return apis[p];
  }

  // 模型设置迁移（V0.9.6 厂商分组制）：旧扁平结构 → 每厂商独立 API（原地修改 settings）
  function migrateModelSettings(settings) {
    if (settings.apis && settings.activeApi) return;
    const apis = {};
    const legacyP = ['zhipu', 'deepseek', 'qwen', 'moonshot', 'custom'].includes(settings.provider)
      ? settings.provider : null;
    if (legacyP && (settings.apiKey || settings.baseUrl || (settings.models || []).length)) {
      apis[legacyP] = {
        baseUrl: settings.baseUrl || (PRESETS[legacyP] || {}).url || '',
        apiKey: settings.apiKey || '',
        models: Array.isArray(settings.models) && settings.models.length
          ? settings.models : ((PRESETS[legacyP] || {}).models || []).map(m => ({ ...m })),
        currentModelId: settings.currentModelId || null,
      };
    }
    Object.keys(PRESETS).forEach(pk => {
      if (apis[pk]) return;
      apis[pk] = {
        baseUrl: (PRESETS[pk] || {}).url || '',
        apiKey: '',
        models: ((PRESETS[pk] || {}).models || []).map(m => ({ ...m })),
        currentModelId: ((PRESETS[pk] || {}).models || [])[0]?.id || null,
      };
    });
    settings.apis = apis;
    settings.activeApi = legacyP && apis[legacyP] ? legacyP : 'zhipu';
    ['provider', 'baseUrl', 'apiKey', 'model', 'models', 'currentModelId'].forEach(k => delete settings[k]);
    saveSettings(settings);
  }

  window.STORE = {
    LS, PRESETS,
    loadJSON, saveJSON, removeKey: k => localStorage.removeItem(k),
    loadSettings, saveSettings,
    loadLedgers, saveLedgers, loadLedRecords, saveLedRecords, removeLedRecords,
    apiName, ensureApiEntry, migrateModelSettings,
  };
})();

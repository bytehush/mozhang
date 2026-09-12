import io

p = 'js/app.js'
s = io.open(p, encoding='utf-8').read()

# ── ① 删除已移往 store.js 的键名/预设/持久化定义，替换为别名 ──
old = """  const LS_SETTINGS = 'jigong_settings';        // 全局：AI 模型配置
  const LS_LEDGERS = 'jigong_ledgers';
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
  const TPL = () => window.JG_TEMPLATES;"""
new = """  // ---------- 存储（持久层在 js/store.js，此处引用） ----------
  const STORE = window.STORE;
  const { LS_SETTINGS, LS_LEDGERS, LS_ACTIVE, LS_UI, LS_SIDEBAR, LS_V1_BACKUP } = STORE.LS;
  const API_PRESETS = STORE.PRESETS;
  const TPL = () => window.JG_TEMPLATES;"""
assert old in s, '① 键名/预设段未匹配'
s = s.replace(old, new)
print('① 键名与预设别名完成')

# ── ② 删除 loadSettings/saveSettingsStore 定义 ──
old = """  function loadSettings() {
    try { return Object.assign({}, DEFAULT_SETTINGS, JSON.parse(localStorage.getItem(LS_SETTINGS)) || {}); }
    catch { return Object.assign({}, DEFAULT_SETTINGS); }
  }
  function saveSettingsStore() { localStorage.setItem(LS_SETTINGS, JSON.stringify(settings)); }

"""
assert old in s, '② settings 存取未匹配'
s = s.replace(old, '')
print('② settings 存取定义删除')

# ── ③ 删除 loadLedgers/saveLedgersStore/loadLedRecords/saveLedRecords 定义 ──
old = """  function loadLedgers() {
    try { const l = JSON.parse(localStorage.getItem(LS_LEDGERS)); return Array.isArray(l) ? l : []; }
    catch { return []; }
  }
  function saveLedgersStore() { localStorage.setItem(LS_LEDGERS, JSON.stringify(ledgers)); }
  function loadLedRecords(id) {
    try { return JSON.parse(localStorage.getItem('jigong_led_' + id)) || []; }
    catch { return []; }
  }
  function saveLedRecords(id, recs) { localStorage.setItem('jigong_led_' + id, JSON.stringify(recs)); }

"""
assert old in s, '③ ledgers 存取未匹配'
s = s.replace(old, '')
print('③ ledgers 存取定义删除')

# ── ④ 删除 migrateModelSettings 定义（已移至 store.js） ──
old = """  // 模型设置迁移（V0.9.6 厂商分组制）：旧扁平结构 → 每厂商独立 API（地址/Key/模型列表）
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
"""
new = """"""
assert old in s, '④ 迁移段未匹配'
s = s.replace(old, new)
print('④ migrateModelSettings/ensureApiEntry 定义删除')

# ── ⑤ 调用点更新 ──
pairs = [
  ("  let settings = loadSettings();", "  let settings = STORE.loadSettings();"),
  ("saveSettingsStore();", "STORE.saveSettings(settings);"),
  ("ledgers = loadLedgers();", "ledgers = STORE.loadLedgers();"),
  ("saveLedgersStore();", "STORE.saveLedgers(ledgers);"),
  ("saveLedRecords(led.id, recs);", "STORE.saveLedRecords(led.id, recs);"),
  ("saveLedRecords(id, recs);", "STORE.saveLedRecords(id, recs);"),
]
for o, n in pairs:
    cnt = s.count(o)
    s = s.replace(o, n)
    print(f'替换 {cnt} 处:', o.strip()[:44])

io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('app.js 存储层抽离完成')

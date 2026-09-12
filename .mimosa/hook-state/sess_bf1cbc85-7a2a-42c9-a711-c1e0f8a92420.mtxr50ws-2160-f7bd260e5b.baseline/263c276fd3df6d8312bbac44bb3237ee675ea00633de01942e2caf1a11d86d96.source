import io

p = 'js/app.js'
s = io.open(p, encoding='utf-8').read()

# ── ① DEFAULT_SETTINGS 清简 + API_PRESETS 重构（厂商名/地址/预设模型） ──
old = """  const DEFAULT_SETTINGS = { nRate: 20, oRate: 30, apiKey: '', model: 'glm-4-flash', provider: 'zhipu', baseUrl: '' };

  // 各厂商 OpenAI 兼容接口地址与常用模型（选自定义时可自行填写）
  const PROVIDERS = {
    zhipu: { name: '智谱AI', url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', models: ['glm-4-flash', 'glm-4.5-flash', 'glm-4.6'] },
    deepseek: { name: 'DeepSeek', url: 'https://api.deepseek.com/chat/completions', models: ['deepseek-chat', 'deepseek-reasoner'] },
    qwen: { name: '通义千问', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', models: ['qwen-flash', 'qwen-turbo', 'qwen-plus'] },
    moonshot: { name: 'Kimi', url: 'https://api.moonshot.cn/v1/chat/completions', models: ['moonshot-v1-8k', 'moonshot-v1-32k'] },
    custom: { name: '自定义', url: '', models: [] },
  };"""
new = """  const DEFAULT_SETTINGS = {};

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
  };"""
assert old in s, '① DEFAULT/PROVIDERS 未匹配'
s = s.replace(old, new)

# ── ② seedModelsIfNeeded → migrateModelSettings（厂商分组迁移） ──
old = """  // 模型档案迁移：旧单模型设置 → 模型列表（一个 API 可配多个模型，ZCode 式）
  function seedModelsIfNeeded() {
    if (Array.isArray(settings.models) && settings.models.length) return;
    const m = settings.model || 'glm-4-flash';
    const labels = {
      'glm-4-flash': 'GLM-4-Flash（免费）', 'glm-4.5-flash': 'GLM-4.5-Flash（免费）',
      'deepseek-chat': 'DeepSeek Chat', 'qwen-flash': '通义千问-Flash', 'moonshot-v1-8k': 'Kimi-8K',
    };
    settings.models = [{ id: uid(), model: m, label: labels[m] || m, context: 128, maxOut: 4095 }];
    settings.currentModelId = settings.models[0].id;
    saveSettingsStore();
  }"""
new = """  // 模型设置迁移（V0.9.6 厂商分组制）：旧扁平结构 → 每厂商独立 API（地址/Key/模型列表）
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
  function apiName(p) { return (API_PRESETS[p] || {}).name || p; }"""
assert old in s, '② 迁移段未匹配'
s = s.replace(old, new)

io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('①② 完成')

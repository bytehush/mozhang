import io

p = 'js/app.js'
s = io.open(p, encoding='utf-8').read()

# ModelSwitch 补 activeInfo/apiList/selectModel + DOMContentLoaded 迁移调用
old = """    // 模型快切（chat.js 输入坞菜单用）：只列出「配置好的」模型档案
    ModelSwitch: {
      list: () => settings.models || [],
      current: () => settings.models.find(m => m.id === settings.currentModelId)
        || (settings.models || [])[0] || null,
      apply(id) {
        const m = settings.models && settings.models.find(x => x.id === id);
        if (!m) return false;
        settings.currentModelId = id;
        saveSettingsStore();
        return true;
      },
    },
  };"""
new = """    // 模型快切（chat.js 输入坞菜单用）：按厂商分组，选中模型即切换其整套 API
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
  };"""
assert old in s, 'ModelSwitch 未匹配'
s = s.replace(old, new)

# DOMContentLoaded 调用迁移
old2 = """    const mig = ensureLedgers();
    migrateModelSettings();"""
if old2 not in s:
    s = s.replace("    const mig = ensureLedgers();", "    const mig = ensureLedgers();\n    migrateModelSettings();")
    print('迁移调用已补')
else:
    print('迁移调用已存在')

io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('app.js ModelSwitch 完成')

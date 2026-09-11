import io

p = 'js/app.js'
s = io.open(p, encoding='utf-8').read()

# ── ① 设置迁移：种子模型档案 ──
old = """  function loadSettings() {
    try { return Object.assign({}, DEFAULT_SETTINGS, JSON.parse(localStorage.getItem(LS_SETTINGS)) || {}); }
    catch { return Object.assign({}, DEFAULT_SETTINGS); }
  }"""
new = """  function loadSettings() {
    try { return Object.assign({}, DEFAULT_SETTINGS, JSON.parse(localStorage.getItem(LS_SETTINGS)) || {}); }
    catch { return Object.assign({}, DEFAULT_SETTINGS); }
  }
  // 模型档案迁移：旧单模型设置 → 模型列表（一个 API 可配多个模型，ZCode 式）
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
assert old in s, 'loadSettings 未匹配'
s = s.replace(old, new)

# ── ② ModelSwitch 改为模型档案 ──
old = """    // 模型快切（chat.js 输入坞菜单用）：列出可选厂商/模型、读取当前、一键切换
    ModelSwitch: {
      options: () => Object.keys(PROVIDERS).filter(p => p !== 'custom').map(p => ({
        provider: p, name: PROVIDERS[p].name, models: PROVIDERS[p].models,
      })),
      current: () => ({ provider: settings.provider, model: settings.model }),
      apply(provider, model) {
        if (!PROVIDERS[provider] || provider === 'custom') return false;
        settings.provider = provider;
        settings.baseUrl = PROVIDERS[provider].url;
        settings.model = model || PROVIDERS[provider].models[0];
        saveSettingsStore();
        applySettingsToUI();
        return true;
      },
    },
  };"""
new = """    // 模型快切（chat.js 输入坞菜单用）：只列出「配置好的」模型档案
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
assert old in s, 'ModelSwitch 未匹配'
s = s.replace(old, new)

# ── ③ 设置区整体重写（API 配置 + 模型档案管理） ──
old = """  function applySettingsToUI() {
    $('s-provider').value = settings.provider || 'zhipu';
    $('s-baseurl').value = settings.baseUrl || (settings.provider === 'custom' ? '' : defaultProviderUrl(settings.provider || 'zhipu'));
    $('s-apikey').value = settings.apiKey || '';
    $('s-model').value = settings.model || 'glm-4-flash';
    refreshModelList();
  }
  function defaultProviderUrl(p) { return (PROVIDERS[p] || PROVIDERS.zhipu).url; }
  function refreshModelList() {
    const p = $('s-provider').value;
    $('model-list').innerHTML = ((PROVIDERS[p] || PROVIDERS.zhipu).models || [])
      .map(m => `<option value="${m}">`).join('');
  }
  function initSettings() {
    applySettingsToUI();
    $('s-provider').addEventListener('change', () => {
      const p = $('s-provider').value;
      $('s-baseurl').value = PROVIDERS[p].url;
      $('s-model').value = PROVIDERS[p].models[0] || '';
      refreshModelList();
    });
    $('btn-save-model').addEventListener('click', async () => {
      const btn = $('btn-save-model');
      if (btn.classList.contains('is-loading') || btn.classList.contains('is-done')) return;
      settings.provider = $('s-provider').value;
      settings.baseUrl = $('s-baseurl').value.trim();
      settings.apiKey = $('s-apikey').value.trim();
      settings.model = $('s-model').value.trim() || 'glm-4-flash';
      if (settings.provider === 'custom' && !settings.baseUrl) { toast('自定义厂商需要填写接口地址'); return; }
      saveSettingsStore();
      await commitPlay(btn);
      toast('模型设置已保存 ✓');
    });
  }"""
new = """  // ---------- 模型档案管理（ZCode 式：一个 API 配多个模型） ----------
  let mpDraft = [];   // 模型档案草稿（编辑期间）
  function renderModelProfiles() {
    const box = $('s-models');
    box.innerHTML = (mpDraft.length ? '' : '<p class="hint" style="margin:4px 0">还没有配置模型，点下方「＋ 添加模型」。</p>') +
      mpDraft.map(f => `
      <div class="mp-row ${f.id === mpCurId ? 'cur' : ''}">
        <label class="mp-cur" title="设为当前模型"><input type="radio" name="mp-cur" ${f.id === mpCurId ? 'checked' : ''} data-mpcur="${f.id}"></label>
        <input type="text" class="mp-name" data-mpname="${f.id}" value="${esc(f.label)}" placeholder="显示名称">
        <input type="text" class="mp-model" data-mpmodel="${f.id}" value="${esc(f.model)}" placeholder="模型 ID">
        <input type="number" class="mp-num" data-mpctx="${f.id}" value="${f.context || 128}" min="1" title="上下文窗口（千 tokens）">
        <input type="number" class="mp-num" data-mpout="${f.id}" value="${f.maxOut || 4095}" min="1" title="最大输出（tokens）">
        <button type="button" class="mp-del" data-mpdel="${f.id}" title="删除模型">✕</button>
      </div>`).join('');
    // 行内编辑：即时写入草稿
    box.querySelectorAll('.mp-row').forEach(row => {
      const id = row.dataset.mpCur || row.querySelector('[data-mpcur]')?.dataset.mpcur;
      const f = mpDraft.find(x => x.id === id);
      if (!f) return;
      row.querySelector('[data-mpname]').addEventListener('input', e => { f.label = e.target.value.trim(); });
      row.querySelector('[data-mpmodel]').addEventListener('input', e => { f.model = e.target.value.trim(); });
      row.querySelector('[data-mpctx]').addEventListener('input', e => { f.context = parseFloat(e.target.value) || 128; });
      row.querySelector('[data-mpout]').addEventListener('input', e => { f.maxOut = parseFloat(e.target.value) || 4095; });
      row.querySelector('[data-mpcur]').addEventListener('change', e => { if (e.target.checked) mpCurId = id; renderModelProfiles(); });
      row.querySelector('[data-mpdel]').addEventListener('click', () => {
        if (!confirm(`删除模型「${f.label || f.model}」？`)) return;
        mpDraft = mpDraft.filter(x => x.id !== id);
        if (mpCurId === id) mpCurId = mpDraft[0] ? mpDraft[0].id : null;
        renderModelProfiles();
      });
    });
  }
  function openModelEditor() {
    mpDraft = (settings.models || []).map(m => Object.assign({}, m));
    mpCurId = settings.currentModelId || (mpDraft[0] && mpDraft[0].id) || null;
    renderModelProfiles();
  }
  function initSettings() {
    applySettingsToUI();
    // 厂商快捷填入：一键填接口地址
    document.querySelectorAll('[data-api]').forEach(chip => {
      chip.addEventListener('click', () => {
        const p = chip.dataset.api;
        $('s-baseurl').value = (PROVIDERS[p] || {}).url || '';
        toast('已填入 ' + (PROVIDERS[p] || {}).name + ' 接口地址');
      });
    });
    $('btn-add-model').addEventListener('click', () => {
      mpDraft.push({ id: uid(), model: '', label: '', context: 128, maxOut: 4095 });
      mpCurId = mpCurId || (mpDraft[mpDraft.length - 1] && mpDraft[mpDraft.length - 1].id) || null;
      renderModelProfiles();
    });
    $('btn-save-model').addEventListener('click', async () => {
      const btn = $('btn-save-model');
      if (btn.classList.contains('is-loading') || btn.classList.contains('is-done')) return;
      settings.baseUrl = $('s-baseurl').value.trim();
      settings.apiKey = $('s-apikey').value.trim();
      if (!settings.baseUrl) { toast('请填写接口地址'); return; }
      // 收集模型档案草稿（过滤掉没填模型 ID 的行）
      mpDraft = mpDraft.filter(f => f.model && f.label);
      if (!mpDraft.length) { toast('至少配置一个模型'); return; }
      if (!mpDraft.find(f => f.id === mpCurId)) mpCurId = mpDraft[0].id;
      settings.models = mpDraft;
      settings.currentModelId = mpCurId;
      saveSettingsStore();
      await commitPlay(btn);
      toast('模型设置已保存 ✓');
    });
  }"""
assert old in s, '设置区未匹配'
s = s.replace(old, new)

# ── ④ applySettingsToUI 精简（去 provider/model，加档案渲染） ──
old = """  function applySettingsToUI() {
    $('s-baseurl').value = settings.baseUrl || (settings.provider === 'custom' ? '' : defaultProviderUrl(settings.provider || 'zhipu'));
    $('s-apikey').value = settings.apiKey || '';
    $('s-model').value = settings.model || 'glm-4-flash';
    refreshModelList();
  }"""
new = """  let mpCurId = null;   // 草稿中的当前模型 id
  function applySettingsToUI() {
    $('s-baseurl').value = settings.baseUrl || '';
    $('s-apikey').value = settings.apiKey || '';
    openModelEditor();
  }"""
assert old in s, 'applySettingsToUI 未匹配'
s = s.replace(old, new)

io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('app.js 模型档案设置完成')

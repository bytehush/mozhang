import io

p = 'js/app.js'
s = io.open(p, encoding='utf-8').read()

# ── ① 启动调用：seed → migrate ──
old = "    seedModelsIfNeeded();"
new = "    migrateModelSettings();"
assert old in s, '启动调用'
s = s.replace(old, new)
print('① 迁移调用替换')

# ── ② 设置页逻辑整体重写（applySettingsToUI + 模型档案管理器 + initSettings） ──
# 用边界切片替换：从 "  let mpCurId = null;" 到 initSettings 结束
start_marker = "  let mpCurId = null;"
end_anchor = "  // ---------- 数据管理 ----------"
i1 = s.index(start_marker)
i2 = s.index(end_anchor)
new_block = """  let editProvider = null;   // 设置页当前正在编辑的厂商

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

  """
s = s[:i1] + new_block + s[i2:]
print('② 设置逻辑重写应用')

io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('完成')

/* 图标加载器：把「美术资源/图标/」里的 SVG 内联注入页面，颜色跟随界面文字（currentColor）
   用法：<span data-icon="nav-table" data-fallback="📋"></span>
   加载失败时回退显示 data-fallback 字符。动态插入的内容可调用 JGIcons.mount(容器) */
(function () {
  'use strict';

  const DIR = '美术资源/图标/';
  const cache = new Map();

  function load(name) {
    if (!cache.has(name)) {
      cache.set(name, fetch(DIR + encodeURIComponent(name) + '.svg')
        .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); }));
    }
    return cache.get(name);
  }

  function mount(root) {
    (root || document).querySelectorAll('[data-icon]').forEach(el => {
      if (el.dataset.iconLoaded) return;
      el.dataset.iconLoaded = '1';
      const name = el.dataset.icon;
      load(name).then(svg => { el.innerHTML = svg; })
        .catch(() => { if (el.dataset.fallback) el.textContent = el.dataset.fallback; });
    });
  }

  document.addEventListener('DOMContentLoaded', () => mount(document));
  window.JGIcons = { mount };
})();

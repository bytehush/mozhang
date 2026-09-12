/* 悬浮窗系统：POP 打开（从触发按钮生长）/ 原路返回关闭 / Tab 焦点圈定 / ESC 关闭
   + COMMIT 按钮三态（宽→圆→结果条）。从 app.js 抽离（V0.9.8），全项目唯一一份 */
(function () {
  'use strict';

  const { $, wait, REDUCED, EASE_OUT, EASE_IN } = window.UTIL;

  let openedModal = null;
  let lastFocus = null;
  let activeTrigger = null;
  let closingLock = false;

  function focusablesIn(root) {
    return Array.from(root.querySelectorAll('button, input, select, textarea, a[href]'))
      .filter(el => !el.classList.contains('hidden') && el.offsetParent !== null);
  }
  function trapKey(e) {
    if (!openedModal) return;
    if (e.key === 'Escape') { e.preventDefault(); window.MODAL.close(); return; }
    if (e.key !== 'Tab') return;
    const items = focusablesIn(openedModal);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  function openModal(id, triggerEl) {
    const m = $(id);
    if (!m) return;
    window.MODAL.close(true);
    openedModal = m;
    lastFocus = document.activeElement;
    activeTrigger = triggerEl || null;
    closingLock = false;
    m.classList.remove('hidden', 'closing');
    document.body.classList.add('modal-open');
    document.addEventListener('keydown', trapKey);
    const modal = m.querySelector('.modal');
    if (!REDUCED && triggerEl && triggerEl.isConnected) {
      const t = triggerEl.getBoundingClientRect();
      requestAnimationFrame(() => {
        const r = modal.getBoundingClientRect();
        const tx = (t.left + t.width / 2) - (r.left + r.width / 2);
        const ty = (t.top + t.height / 2) - (r.top + r.height / 2);
        modal.animate([
          { transform: `translate(${tx}px, ${ty}px) scale(.06)`, opacity: .25 },
          { transform: 'none', opacity: 1 },
        ], { duration: 380, easing: EASE_OUT });
      });
    }
    requestAnimationFrame(() => {
      const items = focusablesIn(m);
      (items[0] || m.querySelector('.modal-close')).focus();
    });
  }
  function closeModal(silent) {
    if (!openedModal || closingLock) return;
    const m = openedModal;
    const modal = m.querySelector('.modal');
    const finish = () => {
      if (closingLock === 'done') return;
      closingLock = 'done';
      m.classList.add('hidden');
      m.classList.remove('closing');
      openedModal = null;
      document.removeEventListener('keydown', trapKey);
      if (!document.querySelector('.modal-mask:not(.hidden)')) document.body.classList.remove('modal-open');
      if (!silent && lastFocus && lastFocus.focus) lastFocus.focus();
    };
    const canPop = !REDUCED && activeTrigger && activeTrigger.isConnected;
    if (canPop) {
      closingLock = true;
      const t = activeTrigger.getBoundingClientRect();
      const r = modal.getBoundingClientRect();
      const tx = (t.left + t.width / 2) - (r.left + r.width / 2);
      const ty = (t.top + t.height / 2) - (r.top + r.height / 2);
      m.classList.add('closing');
      const anim = modal.animate([
        { transform: 'none', opacity: 1 },
        { transform: `translate(${tx}px, ${ty}px) scale(.06)`, opacity: .2 },
      ], { duration: 260, easing: EASE_IN });
      anim.finished.then(finish).catch(finish);
      setTimeout(finish, 500);
    } else {
      finish();
    }
  }
  function initModals() {
    document.querySelectorAll('[data-close]').forEach(btn => {
      btn.addEventListener('click', () => window.MODAL.close());
    });
    document.querySelectorAll('.modal-mask').forEach(mask => {
      mask.addEventListener('mousedown', (e) => { if (e.target === mask) window.MODAL.close(); });
    });
  }

  // ---------- COMMIT：一枚按钮三种状态 ----------
  function setCommitLabel(btn, text) { const el = btn.querySelector('.c-text'); if (el) el.textContent = text; }
  function setCommitDone(btn, text) { const el = btn.querySelector('.c-result em'); if (el) el.textContent = text; }
  async function commitPlay(btn) {
    if (btn.classList.contains('is-loading') || btn.classList.contains('is-done')) return;
    if (REDUCED) { btn.classList.add('is-done'); await wait(450); btn.classList.remove('is-done'); return; }
    btn.style.width = btn.offsetWidth + 'px';
    void btn.offsetWidth;
    btn.classList.add('is-loading');
    btn.style.width = '46px';
    await wait(700);
    btn.classList.remove('is-loading');
    btn.classList.add('is-done');
    btn.style.transition = 'none';
    btn.style.width = '';
    const natural = btn.offsetWidth;
    btn.style.width = '46px';
    void btn.offsetWidth;
    btn.style.transition = '';
    btn.style.width = natural + 'px';
    await wait(850);
    btn.classList.remove('is-done');
    btn.style.width = '';
  }

  window.MODAL = { open: openModal, close: closeModal, init: initModals, label: setCommitLabel, done: setCommitDone, play: commitPlay };
})();

/* One short accessible status explanation, clamped to the actual viewport. */
(() => {
  'use strict';
  const popover = document.createElement('div');
  popover.id = 'status-popover';
  popover.role = 'tooltip';
  popover.hidden = true;
  document.body.append(popover);
  let anchor = null;

  function hide() {
    if (anchor?.isConnected) anchor.removeAttribute('aria-describedby');
    anchor = null;
    popover.hidden = true;
  }

  function show(button) {
    if (!button?.isConnected || !button.dataset.statusLabel) return;
    hide();
    anchor = button;
    popover.textContent = button.dataset.statusLabel;
    popover.hidden = false;
    button.setAttribute('aria-describedby', popover.id);
    const r = button.getBoundingClientRect(),
      w = popover.offsetWidth,
      h = popover.offsetHeight;
    popover.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.right - w)) + 'px';
    popover.style.top = Math.max(8, Math.min(innerHeight - h - 8, r.top - h - 8 >= 8 ? r.top - h - 8 : r.bottom + 8)) + 'px';
  }
  for (const type of ['pointerover', 'focusin']) document.addEventListener(type, e => {
    const b = e.target.closest('[data-status-label]');
    if (b) show(b);
  });
  for (const type of ['pointerout', 'focusout']) document.addEventListener(type, e => {
    if (e.target.closest('[data-status-label]') === anchor && !e.relatedTarget?.closest?.('[data-status-label]')) hide();
  });
  // Touch opens the relevant dossier section as before and also leaves its short explanation visible.
  let touch = false;
  document.addEventListener('pointerdown', e => {
    touch = e.pointerType === 'touch';
    if (!e.target.closest('[data-status-label]')) hide();
  }, true);
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-status-label]');
    if (!b || !touch) return;
    const id = b.dataset.statusPerson,
      kind = b.dataset.status;
    requestAnimationFrame(() => {
      const target = [...document.querySelectorAll('.profile-header [data-status-label]')].find(n => n.dataset.statusPerson === id && n.dataset.status === kind);
      show(target);
    });
  }, true);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !popover.hidden) {
      e.preventDefault();
      e.stopImmediatePropagation();
      hide();
    }
  }, true);
  document.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);
  familyAtlas.hideStatusPopover = hide;
})();

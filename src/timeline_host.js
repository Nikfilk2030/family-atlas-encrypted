/* Timeline page host. Keep the existing inspector and resizer in their owner;
   overlay the map rather than reparenting a drawer out of a hidden workspace. */
(() => {
  'use strict';
  const workspace = document.getElementById('workspace');
  const drawer = document.getElementById('drawer');
  const nav = document.querySelector('.masthead nav');
  const priorInert = new Map();
  let active = false;
  const button = document.createElement('button');
  button.textContent = 'Таймлайн';
  button.dataset.action = 'timeline';
  nav.insertBefore(button, nav.querySelector('[data-action="materials"]'));
  const style = document.createElement('style');
  style.textContent = `
    body.timeline-active #timeline-page{position:fixed;top:56px;left:0;right:0;bottom:0;width:auto;height:auto;z-index:8}
    body.timeline-active .masthead nav button{color:var(--muted)}
    body.timeline-active .masthead nav [data-action=timeline]{color:var(--focus);background:#eef2f8}
    body.timeline-active #drawer,body.timeline-active #drawer-resizer{z-index:15}
  `;
  document.head.append(style);

  function sync() {
    if (!active || !familyTimeline.element) return;
    const el = familyTimeline.element,
      hasDrawer = !drawer.hidden;
    const small = workspace.clientWidth <= 760;
    el.style.right = hasDrawer && !small ? drawer.getBoundingClientRect().width + 'px' : '0px';
    el.style.bottom = hasDrawer && small ? drawer.getBoundingClientRect().height + 'px' : '0px';
    document.documentElement.style.setProperty('--timeline-header-height', document.querySelector('.masthead').getBoundingClientRect().height + 'px');
    el.style.top = document.querySelector('.masthead').getBoundingClientRect().bottom + 'px';
  }

  function restoreTree({
    close = true
  } = {}) {
    active = false;
    familyTimeline.hide({
      restoreFocus: false
    });
    document.body.classList.remove('timeline-active');
    for (const [el, value] of priorInert) el.inert = value;
    priorInert.clear();
    if (close) familyAtlas.closeDrawer();
    button.setAttribute('aria-pressed', 'false');
  }

  function openPerson(id) {
    familyAtlas.showPerson(id, false);
    sync();
  }

  function showTimeline() {
    familyAtlas.closeDrawer();
    const results = document.getElementById('results');
    if (results) results.hidden = true;
    active = true;
    document.body.classList.add('timeline-active');
    for (const el of workspace.children) {
      if (el === drawer || el.id === 'drawer-resizer') continue;
      if (!priorInert.has(el)) priorInert.set(el, el.inert);
      el.inert = true;
    }
    familyTimeline.show({
      model: familyAtlas.model,
      onOpenPerson: openPerson,
      onBack: () => restoreTree(),
      onShowInTree: id => {
        restoreTree();
        familyAtlas.showPerson(id, true);
      }
    });
    button.setAttribute('aria-pressed', 'true');
    nav.classList.remove('mobile-open');
    document.querySelector('[data-action="menu"]')?.setAttribute('aria-expanded', 'false');
    sync();
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.action === 'timeline') {
      e.preventDefault();
      e.stopImmediatePropagation();
      showTimeline();
      return;
    }
    if (!active) return;
    // Related-person navigation stays on this page and preserves the tree camera.
    if (b.closest('#drawer') && b.dataset.openPerson) {
      e.preventDefault();
      e.stopImmediatePropagation();
      openPerson(b.dataset.openPerson);
      return;
    }
    const explicitTree = b.dataset.action === 'locate' || b.dataset.focusFamily || b.dataset.openFamily || b.dataset.subtree || b.dataset.branch;
    const mainNav = b.closest('.masthead nav') || b.classList.contains('brand');
    if (explicitTree || mainNav && b.dataset.action !== 'menu') restoreTree({
      close: false
    });
  }, true);
  new MutationObserver(sync).observe(workspace, {
    attributes: true,
    attributeFilter: ['class', 'style']
  });
  new MutationObserver(sync).observe(drawer, {
    attributes: true,
    attributeFilter: ['hidden']
  });
  new ResizeObserver(sync).observe(drawer);
  window.addEventListener('resize', sync);
  familyAtlas.showTimeline = showTimeline;
  familyAtlas.returnToTree = restoreTree;
  window.atlasTimelineHost = {
    show: showTimeline,
    hide: restoreTree,
    get active() {
      return active;
    }
  };
})();

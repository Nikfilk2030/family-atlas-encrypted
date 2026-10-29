/*
 * FAMILY TIMELINE — integration / ownership contract
 *
 * Inline timeline.css AFTER the atlas CSS and timeline.js AFTER atlas.js in the
 * same offline document (do not add script-src/fetch, storage, history or routes).
 * Loading is inert. show() lazily appends ONE owned #timeline-page to body and
 * returns it; hide() hides only that page. The module NEVER mutates the model,
 * hides #workspace, changes the tree camera or moves the existing drawer.
 *
 * Public API:
 *   familyTimeline.show({model?, onOpenPerson?, onShowInTree?, onBack?}) -> HTMLElement
 *     onShowInTree(id) is called after hiding this page by each person's 'В дереве' button;
 *     restore the tree workspace and call familyAtlas.showPerson(id,true).
 *     model defaults to familyAtlas.model; filters persist in memory
 *   familyTimeline.hide({restoreFocus = true} = {})
 *   familyTimeline.parseBirth(rawString) -> {
 *     raw, kind: exact|year|approximate|range|decade|unknown,
 *     year, month, day, startYear, endYear, uncertain
 *   }
 *     Unknown fields are null. Approximate components are nominal, NOT exact.
 *     A range/decade has year:null. Decade endYear includes its last year solely
 *     for ordering; only the original string is displayed, never invented dates.
 *   familyTimeline.getState() -> {branch, query, includeRecords} (copy)
 *   familyTimeline.element -> HTMLElement|null; familyTimeline.visible -> boolean
 *
 * Host navigation (required because the current drawer lives IN #workspace):
 *   const workspace = document.getElementById('workspace');
 *   const drawer = document.getElementById('drawer');
 *   function restoreTree() {
 *     workspace.append(drawer); workspace.hidden = false;
 *   }
 *   function openTimeline() {
 *     familyAtlas.closeDrawer(); workspace.hidden = true;
 *     familyTimeline.show({
 *       onOpenPerson(id, options) {
 *         // Or use a shared overlay outside both pages; never leave the drawer
 *         // under a hidden workspace. CSS supports a direct child drawer.
 *         familyTimeline.element.append(drawer);
 *         familyAtlas.showPerson(id, options.locate); // ALWAYS false here
 *       },
 *       onBack() { restoreTree(); familyAtlas.closeDrawer(); }
 *     });
 *   }
 * Back hides the timeline BEFORE onBack; restore the SAME tree, do not call fit.
 * Without onOpenPerson the fallback is familyAtlas.showPerson(id, false).
 * The callback receives the exact ID and {locate:false, origin:'timeline'} once;
 * it never substitutes a namesake or possible-match ID.
 *
 * Before any existing locate/focus/tree action executes, the host must call
 * familyTimeline.hide({restoreFocus:false}) and restoreTree(). A capture handler
 * can do this ahead of the atlas's delegated click handler for data-action=locate.
 * Apply the same page switch to profile family/subtree links and masthead nav.
 * closeDrawer/Escape may leave the timeline behind; the page does not intercept
 * the atlas's existing drawer handlers. Restore the drawer on leaving the page.
 * Set --timeline-header-height if the masthead differs from the default 56px.
 *
 * Data: birth only, NEVER dates/death. source_ids describe the record, not a
 * separately proven birth citation; an explicit birth_source_id narrows the date
 * provenance. Branch filters use actual parents/children/peers/related membership
 * of model.families, NOT surnames or possible-identity matches. Records without
 * such membership appear in All only when the candidates checkbox is enabled.
 */
(() => {
  'use strict';

  function parseBirth(value) {
    const raw = typeof value === 'string' ? value : '';
    // Parse only the supplied birth field, never a life-date or death fallback.
    // Parenthetical source qualifications stay in raw; they may reduce certainty.
    let text = raw.trim().replace(/\s*\([^)]*\)\s*$/u, '').trim();
    const result = {
      raw,
      kind: 'unknown',
      year: null,
      month: null,
      day: null,
      startYear: null,
      endYear: null,
      uncertain: false
    };
    const approximate = /[?~≈]|около|примерн|приблиз|оценк|неточн|around|circa|\bca\./iu.test(raw);
    text = text.replace(/^(?:около|примерно|приблизительно|around|circa|ca\.?)\s*/iu, '')
      .replace(/^[~≈]\s*/u, '').replace(/\?\s*$/u, '').replace(/\s+г(?:од[ау]?)?\.?$/u, '').trim();
    let match = text.match(/^(\d{4})(?:\s*[-–—‑−]\s*(\d{4}))?\s*[-–—‑−]\s*[еe]$/u);
    if (match) {
      const startYear = Number(match[1]),
        endDecade = Number(match[2] || match[1]);
      if (startYear > 0 && startYear % 10 === 0 && endDecade % 10 === 0 && endDecade >= startYear) {
        // Bounds support ordering only. Render raw decades, never a fabricated day/year.
        return {
          ...result,
          kind: 'decade',
          startYear,
          endYear: endDecade + 9,
          uncertain: true
        };
      }
      return result;
    }
    match = text.match(/^(\d{4})\s*[-–—‑−]\s*(\d{4})$/u);
    if (match) {
      const [startYear, endYear] = match.slice(1).map(Number);
      return startYear > 0 && endYear >= startYear ? {
        ...result,
        kind: 'range',
        startYear,
        endYear,
        uncertain: true
      } : result;
    }
    match = text.match(/^(\d{2})\.(\d{2})\.(\d{4})$/u);
    if (match) {
      const [day, month, year] = match.slice(1).map(Number);
      const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
      const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
      if (year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]) {
        return {
          ...result,
          kind: approximate ? 'approximate' : 'exact',
          uncertain: approximate,
          year,
          month,
          day,
          startYear: year,
          endYear: year
        };
      }
    }
    match = text.match(/^(\d{4})$/u);
    if (match && Number(match[1]) > 0) {
      const year = Number(match[1]);
      return {
        ...result,
        kind: approximate ? 'approximate' : 'year',
        uncertain: approximate,
        year,
        startYear: year,
        endYear: year
      };
    }
    return result;
  }

  const escapeHTML = value => String(value ?? '').replace(/[&<>"']/gu,
    character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    } [character]));
  const kindLabels = {
    exact: 'Указана полная дата',
    year: 'Указан только год',
    approximate: 'Приблизительно',
    range: 'Интервал лет',
    decade: 'Период в десятилетиях',
    unknown: 'Дата не установлена'
  };
  const sourceLabels = {
    'family-testimony': 'По рассказам семьи',
    'family-forum': 'Публикация исследователя',
    index: 'Исторический указатель',
    'image-of-original': 'Цифровая копия документа',
    'original-document': 'Документ',
    'archive-catalog': 'Архивный каталог',
    'local-history-index': 'Краеведческий указатель',
    'local-history-article': 'Краеведческая статья',
    'regional-book': 'Книга памяти',
    'user-display-rule': 'Уточнение пользователя'
  };
  let root = null,
    currentModel = null,
    hooks = {},
    previousFocus = null;
  let entries = [],
    sourceMap = new Map();
  const state = {
    branch: 'all',
    query: '',
    includeRecords: false
  };

  function sourceMarkup(person) {
    const attributed = typeof person.birth_source_id === 'string' && person.birth_source_id.trim();
    const ids = attributed ? [person.birth_source_id] : person.source_ids || [];
    const own = [...new Set(ids)].map(id => sourceMap.get(id)).filter(Boolean);
    if (!own.length) return `<p class="tl-source-missing">${attributed ? `Источник даты ${escapeHTML(person.birth_source_id)} не найден в модели` : 'Источник записи не указан'}</p>`;
    const kinds = [...new Set(own.map(source => sourceLabels[source.kind] || 'Источник записи'))];
    return `<details class="tl-provenance" data-tl-source-scope="${attributed ? 'birth' : 'record'}"><summary>${attributed ? 'Источник даты · ' : ''}${escapeHTML(kinds.join(' · '))}<span>${own.length} ист.</span></summary>
      <div class="tl-source-content"><p>${attributed ? 'Источник даты рождения прямо указан в модели.' : 'Источники этой записи. Отдельная атрибуция даты рождения в модели не задана.'}</p>
      <ul>${own.map(source => `<li data-tl-source="${escapeHTML(source.id)}"><strong>${escapeHTML(source.title)}</strong>
        <small>${escapeHTML(sourceLabels[source.kind] || source.kind)} · ${escapeHTML(source.id)}</small></li>`).join('')}</ul></div></details>`;
  }

  function eventMarkup(entry) {
    const {
      person,
      birth
    } = entry;
    const known = birth.kind !== 'unknown';
    const birthHTML = known ? `<span class="tl-date-kind">${kindLabels[birth.kind]}</span><span class="tl-birth-raw">${escapeHTML(birth.raw)}</span>` :
      `<span class="tl-date-kind">Дата рождения не установлена</span>${birth.raw ? `<span class="tl-birth-raw">В записи: ${escapeHTML(birth.raw)}</span>` : ''}`;
    return `<article class="tl-event" data-tl-entry="${escapeHTML(person.id)}" data-tl-kind="${escapeHTML(person.kind)}"
      data-tl-certainty="${birth.kind}"${known ? ` data-tl-birth="${birth.startYear}"` : ''}>
      <div class="tl-event-main"><div class="tl-identity"><span class="tl-identity-kind">${person.kind === 'family' ? 'Человек семьи' : 'Отдельная запись-кандидат'} · ${escapeHTML(person.id)}</span>
      <button class="tl-person" data-tl-person="${escapeHTML(person.id)}">${escapeHTML(person.name)}</button>
      ${person.role ? `<p class="tl-role">${escapeHTML(person.role)}</p>` : ''}</div>
      <div class="tl-birth">${birthHTML}</div></div>
      ${person.place ? `<p class="tl-place"><span>Места из записи</span>${escapeHTML(person.place)}</p>` : ''}
      ${person.kind === 'record' ? '<p class="tl-candidate-note">Тождество родственнику не установлено. Сведения не переносятся на семью.</p>' : ''}
      <div class="tl-person-actions" aria-label="Действия с человеком"><button data-tl-profile="${escapeHTML(person.id)}">Досье</button><button data-tl-tree="${escapeHTML(person.id)}" title="${person.kind==='record'?'Показать запись или связанный семейный контекст, без подтверждения тождества':'Перейти к этому человеку в дереве'}">В дереве</button></div>
      ${sourceMarkup(person)}</article>`;
  }

  function scrollToSection(key) {
    const target = document.getElementById(key === 'unknown' ? 'tl-unknown' : 'tl-decade-' + key);
    if (!target || !root.contains(target)) return;
    if (key === 'unknown') root.querySelector('#tl-unknown-list').open = true;
    const scroller = getComputedStyle(root).overflowY === 'auto' ? root : root.querySelector('.tl-scroll');
    scroller.scrollTop += target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 18;
    target.focus({
      preventScroll: true
    });
  }

  function renderResults() {
    const normalized = value => String(value ?? '').toLocaleLowerCase('ru').replace(/ё/gu, 'е');
    const query = normalized(state.query.trim());
    const selected = entries.filter(entry => (entry.person.kind === 'family' || state.includeRecords) &&
      (state.branch === 'all' || entry.branches.has(state.branch)) &&
      (!query || normalized([entry.person.name, entry.person.role, entry.person.place,
        entry.person.id, entry.birth.raw
      ].join(' ')).includes(query)));
    for (const button of root.querySelectorAll('[data-tl-branch]')) {
      button.setAttribute('aria-pressed', String(button.dataset.tlBranch === state.branch));
    }
    const known = selected.filter(entry => entry.birth.kind !== 'unknown')
      .sort((a, b) => a.birth.startYear - b.birth.startYear ||
        (a.birth.month || 0) - (b.birth.month || 0) || (a.birth.day || 0) - (b.birth.day || 0) ||
        a.person.name.localeCompare(b.person.name, 'ru') || a.person.id.localeCompare(b.person.id));
    const unknown = selected.filter(entry => entry.birth.kind === 'unknown');
    root.classList.toggle('tl-only-unknown', known.length === 0 && unknown.length > 0);
    const recordCount = selected.filter(entry => entry.person.kind === 'record').length;
    root.querySelector('#tl-result-count').textContent = `${known.length} с датой рождения · ${unknown.length} без даты${state.includeRecords ? ` · записей-кандидатов: ${recordCount}` : ''}`;
    root.querySelector('#tl-records').checked = state.includeRecords;
    const decades = new Map();
    for (const entry of known) {
      const decade = Math.floor(entry.birth.startYear / 10) * 10;
      if (!decades.has(decade)) decades.set(decade, []);
      decades.get(decade).push(entry);
    }
    root.querySelector('#tl-index').innerHTML = `<p>К десятилетию</p>${[...decades].map(([decade, values]) =>
      `<button data-tl-jump="${decade}"><span>${decade}-е</span><small>${values.length}</small></button>`).join('')}
      <button class="tl-unknown-jump" data-tl-jump="unknown"><span>Без даты</span><small>${unknown.length}</small></button>`;
    root.querySelector('#tl-axis').innerHTML = (!selected.length ? '<div id="tl-empty"><h2>Ничего не найдено</h2><p>Попробуйте другое имя, место или ветвь семьи.</p><button data-tl-reset>Сбросить фильтры</button></div>' : '') + [...decades].map(([decade, values]) => {
      const years = new Map();
      for (const entry of values) {
        if (!years.has(entry.birth.startYear)) years.set(entry.birth.startYear, []);
        years.get(entry.birth.startYear).push(entry);
      }
      return `<section class="tl-decade" id="tl-decade-${decade}" tabindex="-1"><h2>${decade}-е<span>С датой рождения: ${values.length}</span></h2>
        ${[...years].map(([year, sameYear]) => {
          const period = sameYear.some(entry => ['range', 'decade'].includes(entry.birth.kind));
          const approximate = sameYear.every(entry => entry.birth.kind === 'approximate');
          return `<div class="tl-year-row"><h3>${period ? 'от ' : approximate ? '≈ ' : ''}${year}${period ? '<small>Начало периода, не точный год</small>' : ''}</h3>
            <div class="tl-stack" data-tl-stack="${year}">${sameYear.map(eventMarkup).join('')}</div></div>`;
        }).join('')}</section>`;
    }).join('') + `<section class="tl-unknown" id="tl-unknown" tabindex="-1"><h2>Без даты рождения <span>${unknown.length}</span></h2>
      <p>Рождение не датировано или формулировка не позволяет поставить его на ось. Даты смерти не используются вместо рождения.</p>
      <details id="tl-unknown-list"${query && unknown.length ? ' open' : ''}><summary>Показать записи без даты · ${unknown.length}</summary><div class="tl-unknown-stack">${unknown.map(eventMarkup).join('') || '<p>В выбранной группе нет записей без даты.</p>'}</div></details></section>`;
    root.querySelector('.tl-scroll').scrollTop = 0;
    root.scrollTop = 0;
  }

  function mount() {
    if (root) return;
    if (document.getElementById('timeline-page')) throw new Error('#timeline-page is reserved for familyTimeline');
    root = document.createElement('section');
    root.id = 'timeline-page';
    root.hidden = true;
    root.setAttribute('aria-labelledby', 'tl-title');
    root.innerHTML = `<header class="tl-header"><div class="tl-heading-row"><div><div class="tl-topline"><button data-tl-back>К дереву</button><p>Хронология · рождения</p></div>
      <h1 id="tl-title" tabindex="-1">Когда родились</h1><p class="tl-intro">Люди во времени. Только рождения, без подмены неизвестных дат.</p></div>
      <p id="tl-result-count" role="status" aria-live="polite"></p></div>
      <div class="tl-legend" aria-label="Точность даты"><span class="tl-key-exact">Полная дата / год</span><span class="tl-key-approximate">Приблизительно</span><span class="tl-key-range">Интервал / десятилетия</span></div></header>
      <div class="tl-filters"><div class="tl-branch-filter" role="group" aria-label="Ветвь семьи"><button data-tl-branch="all" aria-pressed="true">Все</button><button data-tl-branch="maternal" aria-pressed="false">Материнская</button><button data-tl-branch="paternal" aria-pressed="false">Отцовская</button></div>
      <label class="tl-search-label" for="tl-search"><span>Найти в хронологии</span><input id="tl-search" type="search" placeholder="Имя, место, дата или ID" autocomplete="off"></label></div>
      <div class="tl-records-row"><label class="tl-records-label" for="tl-records"><input id="tl-records" type="checkbox"><span>Отдельные записи-кандидаты</span></label><p>По умолчанию только люди семьи. Кандидаты не объединяются с родственниками; ветви берутся из состава семейных областей.</p></div>
      <div class="tl-body"><nav id="tl-index" class="tl-index" aria-label="Переход к десятилетию"></nav>
      <div class="tl-scroll" tabindex="0" aria-label="Хронология рождений, прокрутка"><p class="tl-axis-note">По возрастанию дат. Периоды стоят по нижней границе; расстояния между строками не равны промежуткам времени. Места сохраняют смысл исходной записи.</p><div id="tl-axis"></div></div></div>`;
    document.body.append(root);
    root.querySelector('#tl-records').addEventListener('change', event => {
      state.includeRecords = event.target.checked;
      renderResults();
    });
    root.querySelector('#tl-search').addEventListener('input', event => {
      state.query = event.target.value;
      renderResults();
    });
    root.addEventListener('click', event => {
      const button = event.target.closest('button');
      if (!button || !root.contains(button)) return;
      if (button.hasAttribute('data-tl-tree')) {
        event.stopPropagation();
        const id = button.dataset.tlTree;
        if (!entries.some(entry => entry.person.id === id)) return;
        hide({
          restoreFocus: false
        });
        if (typeof hooks.onShowInTree === 'function') hooks.onShowInTree(id);
        else {
          if (typeof hooks.onBack === 'function') hooks.onBack();
          window.familyAtlas?.showPerson?.(id, true);
        }
        return;
      }
      if (button.hasAttribute('data-tl-person') || button.hasAttribute('data-tl-profile')) {
        event.stopPropagation();
        const id = button.dataset.tlPerson || button.dataset.tlProfile;
        if (!entries.some(entry => entry.person.id === id)) return;
        const options = {
          locate: false,
          origin: 'timeline'
        };
        if (typeof hooks.onOpenPerson === 'function') hooks.onOpenPerson(id, options);
        else window.familyAtlas?.showPerson?.(id, false);
      }
      if (button.hasAttribute('data-tl-branch')) {
        event.stopPropagation();
        state.branch = button.dataset.tlBranch;
        renderResults();
      }
      if (button.hasAttribute('data-tl-reset')) {
        event.stopPropagation();
        state.branch = 'all';
        state.query = '';
        state.includeRecords = false;
        root.querySelector('#tl-search').value = '';
        renderResults();
        root.querySelector('#tl-search').focus({
          preventScroll: true
        });
      }
      if (button.hasAttribute('data-tl-jump')) {
        event.stopPropagation();
        scrollToSection(button.dataset.tlJump);
      }
      if (button.hasAttribute('data-tl-back')) {
        event.stopPropagation();
        hide({
          restoreFocus: false
        });
        if (typeof hooks.onBack === 'function') hooks.onBack();
        if (previousFocus?.isConnected) previousFocus.focus({
          preventScroll: true
        });
      }
    });
  }

  function show(options = {}) {
    currentModel = options.model || window.familyAtlas?.model;
    if (!currentModel?.people || !currentModel?.families || !currentModel?.sources) {
      throw new TypeError('familyTimeline.show requires {people, families, sources} via familyAtlas.model or options.model');
    }
    hooks = {
      onOpenPerson: options.onOpenPerson,
      onBack: options.onBack,
      onShowInTree: options.onShowInTree
    };
    if (!root || root.hidden) previousFocus = document.activeElement;
    mount();
    const membership = new Map();
    for (const family of currentModel.families) {
      // Literal model membership includes parents, children, peers and related records.
      // A name match or candidate comparison does not confer branch membership.
      for (const id of [...(family.parents || []), ...(family.children || []), ...(family.peers || []),
          ...(family.related || []).map(relation => relation.person_id)
        ]) {
        if (!membership.has(id)) membership.set(id, new Set());
        membership.get(id).add(family.branch);
      }
    }
    entries = currentModel.people.map(person => ({
      person,
      birth: parseBirth(person.birth),
      branches: membership.get(person.id) || new Set()
    }));
    root.querySelector('#tl-search').value = state.query;
    sourceMap = new Map(currentModel.sources.map(source => [source.id, source]));
    renderResults();
    root.hidden = false;
    root.querySelector('#tl-title').focus({
      preventScroll: true
    });
    return root;
  }

  function hide({
    restoreFocus = true
  } = {}) {
    if (!root) return;
    root.hidden = true;
    if (restoreFocus && previousFocus?.isConnected) previousFocus.focus({
      preventScroll: true
    });
  }

  window.familyTimeline = Object.freeze({
    show,
    hide,
    parseBirth,
    get element() {
      return root;
    },
    get visible() {
      return !!root && !root.hidden;
    },
    getState() {
      return {
        ...state
      };
    }
  });
})();

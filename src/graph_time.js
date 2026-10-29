/* Birth facts remain untouched. Unknown people use explicitly conditional layout hints
   requested by the user, never synthetic dates in the genealogy or birth timeline. */
(() => {
  'use strict';
  const a = familyAtlas,
    ordinary = {
      boxes: new Map(a.boxes),
      occurrences: new Map(a.occurrences)
    },
    cameras = new Map();
  const unit = 36,
    generationStep = 28,
    members = f => [...f.parents, ...f.children, ...f.peers, ...f.related.map(r => r.person_id)];
  const births = new Map(a.model.people.map(p => [p.id, familyTimeline.parseBirth(p.birth)]));
  const sourceYear = b => b.kind === 'unknown' ? null : b.year ?? (b.startYear + b.endYear) / 2;
  const visibleIDs = [...new Set(a.model.families.flatMap(members))];
  const knownYears = visibleIDs.flatMap(id => {
    const b = births.get(id);
    return b.kind === 'unknown' ? [] : [b.startYear, b.endYear];
  });
  const calendarAvailable = knownYears.length > 0,
    graph = new Map(visibleIDs.map(id => [id, []])),
    levels = new Map();

  function link(l, r, delta) {
    if (l === r || !graph.has(l) || !graph.has(r)) return;
    graph.get(l).push({
      id: r,
      delta
    });
    graph.get(r).push({
      id: l,
      delta: -delta
    });
  }
  for (const f of a.model.families) {
    const level = ordinary.boxes.get(f.id).rank,
      children = [...f.children, ...f.peers];
    for (const id of f.parents) levels.set(id, level);
    for (const id of children) levels.set(id, level + 1);
    for (const r of f.related)
      if (!levels.has(r.person_id)) levels.set(r.person_id, level);
    for (const p of f.parents)
      for (const c of children) link(p, c, 1);
    for (const ids of [f.parents, children])
      for (let i = 0; i < ids.length; i++)
        for (let j = i + 1; j < ids.length; j++) link(ids[i], ids[j], 0);
  }
  const placementHints = new Map();
  // A 28-year step is a schematic spacing assumption, NOT a biological-age claim.
  // Record-comparison and possible-identity links are deliberately absent from this graph.
  if (calendarAvailable)
    for (const id of visibleIDs.filter(id => births.get(id).kind === 'unknown')) {
      const queue = [{
          id,
          delta: 0,
          depth: 0
        }],
        seen = new Set([id]),
        found = [];
      let nearest = Infinity;
      for (let i = 0; i < queue.length; i++) {
        const item = queue[i];
        if (item.depth > nearest) break;
        const year = sourceYear(births.get(item.id));
        if (year !== null) {
          found.push({
            year: year - item.delta * generationStep,
            id: item.id
          });
          nearest = item.depth;
          continue;
        }
        for (const edge of graph.get(item.id) || [])
          if (!seen.has(edge.id)) {
            seen.add(edge.id);
            queue.push({
              id: edge.id,
              delta: item.delta + edge.delta,
              depth: item.depth + 1
            });
          }
      }
      if (found.length) placementHints.set(id, {
        year: Math.round(found.reduce((n, q) => n + q.year, 0) / found.length / 10) * 10,
        anchors: found.map(q => q.id),
        basis: 'relative-layout',
        depth: nearest
      });
    }
  // Context-only records stay near their own family, without borrowing a candidate's identity.
  if (calendarAvailable)
    for (const id of visibleIDs.filter(id => births.get(id).kind === 'unknown' && !placementHints.has(id))) {
      const f = a.model.families.find(f => members(f).includes(id)),
        anchors = (f?.parents || []).map(pid => ({
          id: pid,
          year: sourceYear(births.get(pid)) ?? placementHints.get(pid)?.year
        })).filter(q => Number.isFinite(q.year));
      if (!anchors.length && f)
        for (const pid of f.children) {
          const year = sourceYear(births.get(pid)) ?? placementHints.get(pid)?.year;
          if (Number.isFinite(year)) anchors.push({
            id: pid,
            year: year - generationStep
          });
        }
      if (!anchors.length) {
        const refs = a.model.people.filter(p => p.kind === 'family' && levels.has(p.id) && sourceYear(births.get(p.id)) !== null);
        for (const p of refs) anchors.push({
          id: p.id,
          year: sourceYear(births.get(p.id)) + ((levels.get(id) ?? 0) - levels.get(p.id)) * generationStep
        });
      }
      const year = anchors.length ? anchors.reduce((n, q) => n + q.year, 0) / anchors.length : knownYears.reduce((n, y) => n + y, 0) / knownYears.length;
      placementHints.set(id, {
        year: Math.round(year / 10) * 10,
        anchors: anchors.map(q => q.id),
        basis: 'family-context-layout'
      });
    }
  const extent = [...knownYears, ...[...placementHints.values()].map(q => q.year)];
  const first = calendarAvailable ? Math.floor(Math.min(...extent) / 10) * 10 : 0,
    last = calendarAvailable ? Math.ceil(Math.max(...extent) / 10) * 10 : 0;
  const yearY = year => (year - first) * unit + 320;
  let temporal = null;

  function project() {
    const boxes = new Map(),
      occurrences = new Map(),
      items = [];
    if (!calendarAvailable) {
      for (const [id, b] of ordinary.boxes) boxes.set(id, {
        ...b,
        h: b.h + 120,
        known: 0,
        unknown: members(a.model.families.find(f => f.id === id)).length,
        unknownWidth: 0,
        startYear: null,
        endYear: null,
        positionStartYear: null,
        positionEndYear: null,
        calendarUnavailable: true
      });
      for (const [key, o] of ordinary.occurrences) occurrences.set(key, {
        ...o,
        y: o.y + 120,
        temporal: {
          ...births.get(o.id),
          year: null,
          placementYear: null,
          conditionalPlacement: true
        }
      });
      return {
        boxes,
        occurrences
      };
    }
    for (const f of a.model.families) {
      const rows = members(f).map(id => ({
        id,
        birth: births.get(id),
        hint: placementHints.get(id)
      })).map(r => ({
        ...r,
        year: sourceYear(r.birth) ?? r.hint.year
      })).sort((l, r) => l.year - r.year || l.id.localeCompare(r.id));
      const columnEnds = [],
        local = [];
      for (const r of rows) {
        const y = yearY(r.year) - 105;
        let col = columnEnds.findIndex(end => end + 40 <= y);
        if (col < 0) col = columnEnds.length;
        columnEnds[col] = y + 210;
        local.push({
          id: r.id,
          col,
          y,
          unknown: r.birth.kind === 'unknown',
          temporal: {
            ...r.birth,
            year: r.birth.kind === 'unknown' ? null : r.year,
            placementYear: r.birth.kind === 'unknown' ? r.year : null,
            conditionalPlacement: r.birth.kind === 'unknown',
            placementBasis: r.hint?.basis || null
          }
        });
      }
      const known = rows.filter(r => r.birth.kind !== 'unknown'),
        unknown = rows.filter(r => r.birth.kind === 'unknown');
      const y = Math.min(...local.map(o => o.y), ...known.map(r => yearY(r.birth.startYear) - 105)) - 145,
        w = Math.max(1200, columnEnds.length * 264 + 56);
      const bottom = Math.max(y + 760, ...local.map(o => o.y + 210), ...known.map(r => yearY(r.birth.endYear) + 120));
      const b = {
        x: 0,
        y,
        w,
        innerW: w,
        h: bottom - y + 35,
        known: known.length,
        unknown: unknown.length,
        unknownWidth: 0,
        startYear: known.length ? Math.min(...known.map(r => r.birth.startYear)) : null,
        endYear: known.length ? Math.max(...known.map(r => r.birth.endYear)) : null,
        positionStartYear: Math.min(...rows.map(r => r.year)),
        positionEndYear: Math.max(...rows.map(r => r.year))
      };
      for (const o of local) {
        o.x = 24 + o.col * 264;
        o.w = 240;
        o.h = 210;
        o.family = f.id;
        o.row = f.parents.includes(o.id) ? 0 : 1;
        o.related = f.related.some(r => r.person_id === o.id);
      }
      items.push({
        f,
        b,
        local
      });
    }
    // Collision resolution changes columns, never known or conditional time anchors.
    items.sort((l, r) => l.b.y - r.b.y || r.b.h - l.b.h || l.f.id.localeCompare(r.f.id));
    for (const item of items) {
      let x = 0;
      for (;;) {
        const collision = items.filter(q => q !== item && boxes.has(q.f.id)).find(q => x < q.b.x + q.b.w + 150 && x + item.b.w + 150 > q.b.x && item.b.y < q.b.y + q.b.h + 130 && item.b.y + item.b.h + 130 > q.b.y);
        if (!collision) break;
        x = collision.b.x + collision.b.w + 150;
      }
      item.b.x = x;
      boxes.set(item.f.id, item.b);
      for (const o of item.local) {
        o.x += x;
        occurrences.set(item.f.id + ':' + o.id, o);
      }
    }
    return {
      boxes,
      occurrences
    };
  }

  function activate(mode) {
    if (!['generations', 'years'].includes(mode) || a.state.layoutMode === mode) return;
    cameras.set(a.state.layoutMode, {
      ...a.treeState
    });
    a.state.layoutMode = mode;
    temporal ??= project();
    const data = mode === 'years' ? temporal : ordinary;
    a.boxes.clear();
    for (const [id, b] of data.boxes) a.boxes.set(id, b);
    a.occurrences.clear();
    for (const [id, o] of data.occurrences) a.occurrences.set(id, o);
    document.getElementById('workspace').classList.toggle('graph-years', mode === 'years');
    document.querySelector('.map-note').firstChild.textContent = mode === 'years' ? 'Рождения участников ' : 'Семьи и поколения ';
    for (const b of document.querySelectorAll('[data-layout-mode]')) b.setAttribute('aria-pressed', String(b.dataset.layoutMode === mode));
    renderGraph();
    const old = cameras.get(mode);
    if (old) {
      Object.assign(a.treeState, old);
      a.commit(old.scale, old.cx, old.cy, old.intent);
    } else if (a.state.selected || a.state.family) {
      const o = [...a.occurrences.values()].find(o => o.id === a.state.selected);
      a.focusFamily(o?.family || a.state.family);
    } else a.fitTree();
    paint();
  }

  function territoryMarkup(f, b) {
    return `<div class="time-family-caption" style="left:24px">${b.calendarUnavailable?'Даты неизвестны · порядок по поколениям':b.unknown?'Неизвестные даты: положения условны':'Рождения участников, не дата семьи'}</div>`;
  }

  function birthMarkup(o) {
    const b = o.temporal;
    return `<span class="dates time-birth ${b.uncertain?'uncertain':''}" data-birth-kind="${b.kind}">${b.kind==='unknown'?'Дата рождения неизвестна':esc(b.raw)}</span>${b.kind==='unknown'?'<span class="time-precision conditional-placement">Положение условное, по семье</span>':b.kind==='range'||b.kind==='decade'?'<span class="time-precision">Период, не точный год</span>':b.uncertain?'<span class="time-precision">Приблизительно</span>':''}`;
  }

  function summary(f, b) {
    if (!b.known) {
      const range = b.positionStartYear === b.positionEndYear ? b.positionStartYear + '-е' : b.positionStartYear + '–' + b.positionEndYear;
      return `<span class="time-summary-range estimated-summary" aria-label="Только ориентир размещения, даты рождения неизвестны">${b.calendarUnavailable?'Положение по поколению':'Ориентир: '+range}<small>Даты неизвестны</small></span>`;
    }
    return `<span class="time-summary-range" aria-label="Известные рождения участников, не дата семьи">${b.startYear}${b.endYear!==b.startYear?'–'+b.endYear:''}${b.unknown?'<span class="unknown-date-compact" aria-label="Есть неизвестные даты"> + ?</span><small>Часть дат неизвестна</small>':''}</span>`;
  }

  function rangeMarkup(o, b) {
    const t = o.temporal;
    if (!['range', 'decade'].includes(t.kind)) return '';
    return `<div class="time-uncertainty-range" data-birth-range="${o.id}" data-range-start="${t.startYear}" data-range-end="${t.endYear}" style="left:${o.x-b.x+o.w+8}px;top:${yearY(t.startYear)-b.y}px;height:${yearY(t.endYear)-yearY(t.startYear)}px" aria-label="Период рождения: ${esc(t.raw)}"></div>`;
  }

  function parentPath(l, r) {
    return atlasRouter.personRoute(l, r, a.boxes, a.occurrences);
  }
  a.state.layoutMode = 'generations';
  const axis = document.createElement('aside');
  axis.id = 'graph-year-axis';
  axis.setAttribute('aria-label', 'Шкала годов рождения');
  const guides = document.createElement('div');
  guides.id = 'graph-year-guides';
  guides.setAttribute('aria-hidden', 'true');
  document.getElementById('workspace').append(axis);
  document.getElementById('map').prepend(guides);

  function paintAxis() {
    if (a.state.layoutMode !== 'years') return;
    if (!calendarAvailable) {
      axis.innerHTML = '<h2>Без дат</h2><p class="time-no-calendar">По поколениям</p>';
      guides.innerHTML = '';
      return;
    }
    const map = document.getElementById('map'),
      s = a.treeState.scale,
      screen = year => map.clientHeight / 2 + s * (yearY(year) - a.treeState.cy),
      step = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000].find(n => n * unit * s >= 48) || 1000;
    const ticks = [];
    for (let year = Math.ceil(first / step) * step; year <= last; year += step) {
      const y = screen(year);
      if (y > 58 && y < map.clientHeight - 12) ticks.push({
        year,
        y
      });
    }
    const birth = births.get(a.state.selected),
      selected = birth?.year ?? null,
      hint = birth?.kind === 'unknown' ? placementHints.get(a.state.selected) : null;
    if (selected !== null && screen(selected) > 58 && screen(selected) < map.clientHeight - 12) {
      for (let i = ticks.length - 1; i >= 0; i--)
        if (Math.abs(ticks[i].y - screen(selected)) < 25) ticks.splice(i, 1);
      ticks.push({
        year: selected,
        y: screen(selected),
        selected: true,
        uncertain: birth.uncertain
      });
    }
    const conditionalY = hint ? screen(hint.year) : null,
      conditionalVisible = conditionalY !== null && conditionalY > 58 && conditionalY < map.clientHeight - 12;
    if (conditionalVisible)
      for (let i = ticks.length - 1; i >= 0; i--)
        if (Math.abs(ticks[i].y - conditionalY) < 24) ticks.splice(i, 1);
    axis.innerHTML = '<h2>Год<br>рождения</h2>' + ticks.map(t => `<span class="year-tick ${t.selected?'selected':''}" data-axis-year="${t.year}" style="top:${t.y}px">${t.uncertain?'≈ ':''}${t.year}</span>`).join('') + (conditionalVisible ? `<span class="year-tick estimated-axis-position" style="top:${conditionalY}px">Условно</span>` : '');
    guides.innerHTML = ticks.map(t => `<i class="year-guide ${t.selected?'selected':''}" style="top:${t.y}px"></i>`).join('') + (conditionalVisible ? `<i class="year-guide conditional-guide" style="top:${conditionalY}px"></i>` : '');
    document.querySelector('.map-note').firstChild.textContent = 'Рождения участников ';
  }
  a.graphTime = {
    yearY,
    first,
    last,
    territoryMarkup,
    birthMarkup,
    summary,
    parentPath,
    rangeMarkup,
    paintAxis,
    placementHints,
    layoutRule: {
      id: 'USER-DISPLAY-UNKNOWN-TIME',
      generationStep,
      meaning: 'Only schematic placement; unknown births remain unknown'
    }
  };
  a.setLayoutMode = activate;
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-layout-mode]');
    if (b) activate(b.dataset.layoutMode);
  });
})();

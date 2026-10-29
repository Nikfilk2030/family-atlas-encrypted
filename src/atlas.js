'use strict';
const model = JSON.parse(document.getElementById('atlas-data').textContent);
const people = new Map(model.people.map(p => [p.id, p])),
  families = new Map(model.families.map(f => [f.id, f])),
  sources = new Map(model.sources.map(s => [s.id, s]));
const $ = s => document.querySelector(s),
  esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  } [c]));
const state = {
  visible: model.families.map(f => f.id),
  mode: 'all',
  selected: null,
  family: null,
  highlight: null
};
const treeState = {
  scale: 1,
  cx: 0,
  cy: 0,
  intent: 'pending-initial',
  initialized: false,
  width: 0,
  height: 0
};
const boxes = new Map(),
  occurrences = new Map();
const familyEdges = model.families.flatMap(f => f.ancestors.map(a => ({
  from: a.family_id,
  to: f.id,
  ...a
})));

function evidence(id) {
  const p = people.get(id),
    own = p.source_ids.map(s => sources.get(s)).filter(Boolean);
  return {
    testimony: own.filter(s => s.kind === 'family-testimony'),
    publication: own.filter(s => s.kind === 'family-forum'),
    historical: own.filter(s => ['index', 'image-of-original', 'original-document'].includes(s.kind)),
    possible: comparisonIDs(p),
    document: model.documents.some(d => d.person_id === id),
    scan: own.some(s => s.kind === 'image-of-original') || model.documents.some(d => d.person_id === id)
  };
}

function marks(id) {
  const e = evidence(id);
  return [e.historical.length ? 'Материалы этой записи' : '', e.possible.length ? 'Возможное совпадение' : '', e.testimony.length ? 'По рассказам семьи' : '', e.publication.length ? 'Публикация другого исследователя' : ''].filter(Boolean).join(' · ');
}

function explicitSex(p) {
  // Roles and attributed words only. Never names, surname endings or a candidate's attributes.
  const role = p.role.toLocaleLowerCase('ru'),
    note = p.note.toLocaleLowerCase('ru');
  const female = /^(мама|мать|бабушка|сестра|ваша сестра|жена)(\s|$)/u,
    male = /^(папа|отец|дедушка|брат|муж)(\s|$)/u;
  if (female.test(role) || female.test(note)) return {
    kind: 'female',
    symbol: '♀',
    basis: 'Явная женская семейная роль в этой записи'
  };
  if (male.test(role) || male.test(note)) return {
    kind: 'male',
    symbol: '♂',
    basis: 'Явная мужская семейная роль в этой записи'
  };
  for (const sid of p.source_ids) {
    const s = sources.get(sid);
    if (!s || model.people.filter(q => q.source_ids.includes(sid)).length !== 1) continue;
    const value = (s.summary || '').match(/(?:^|\n)Пол:\s*(мужчина|женщина)(?:\s|$)/u);
    if (value) return {
      kind: value[1] === 'мужчина' ? 'male' : 'female',
      symbol: value[1] === 'мужчина' ? '♂' : '♀',
      basis: `Пол прямо указан в источнике этой записи: ${sourceTitle(s)}`
    };
  }
  return null;
}

function kinshipUncertain(r) {
  if (r.relationship_type === 'possible-identity') return false;
  if (r.relationship_type === 'possible-kinship' || /гипотез|контекст|предполож|вывод|реконструк/i.test(r.rationale || '')) return true;
  return model.families.some(f => {
    if (f.status !== 'hypothesis' && !f.link_note) return false;
    const ids = [...f.parents, ...f.children, ...f.peers, ...f.related.map(q => q.person_id)];
    return ids.includes(r.person_a_id) && ids.includes(r.person_b_id);
  });
}

function statusStrip(id) {
  const p = people.get(id),
    e = evidence(id),
    items = [];
  const uncertain = model.relationships.some(r => (r.person_a_id === id || r.person_b_id === id) && kinshipUncertain(r));
  if (uncertain) items.push(['hypothesis', '?', 'Родство пока не подтверждено', 'family']);
  if (e.testimony.length) items.push(['testimony', '🗣', 'Со слов семьи', p.note ? 'life' : 'sources']);
  if (e.publication.length) items.push(['publication', '¶', 'Из семейной публикации', 'sources']);
  if (e.historical.length) items.push(['archive', '▤', 'Есть архивная запись', 'materials']);
  if (e.scan) items.push(['scan', '▧', 'Есть копия документа', 'materials']);
  if (e.possible.length) items.push(['possible', '🔎', 'Возможное совпадение', 'uncertainties']);
  const sex = explicitSex(p);
  if (sex) items.push([sex.kind, sex.symbol, sex.kind === 'female' ? 'Женщина' : 'Мужчина', 'overview']);
  return `<div class="status-strip" aria-label="Статус источников и записи">${items.map(([kind,symbol,label,target])=>`<button class="status-badge ${kind}" data-status="${kind}" data-status-person="${id}" data-status-target="${target}" data-status-label="${esc(label)}" aria-label="${esc(label)}"><span aria-hidden="true">${symbol}</span></button>`).join('')}</div>`;
}

function familyFindings(f) {
  const ids = [...new Set([...f.parents, ...f.children, ...f.peers, ...f.related.map(r => r.person_id)])];
  const own = ids.filter(id => {
    const e = evidence(id);
    return e.historical.length || e.document;
  }).length;
  const possible = ids.filter(id => evidence(id).possible.some(q => {
    const e = evidence(q);
    return e.historical.length || e.document;
  })).length;
  if (!own && !possible) return '';
  return `<span class="family-findings" data-family-findings title="${own} записей с собственными материалами · ${possible} с возможными найденными материалами"><span aria-hidden="true">${own?'▤ '+own:''}${own&&possible?' · ':''}${possible?'🔎 '+possible:''}</span><span class="sr-only">${own} записей с собственными материалами, ${possible} с возможными материалами</span></span>`;
}

function generationRanks() {
  const levels = new Map(),
    adjacent = new Map(model.families.map(f => [f.id, []]));
  for (const e of familyEdges) {
    adjacent.get(e.from).push([e.to, 1]);
    adjacent.get(e.to).push([e.from, -1]);
  }
  for (const seed of [model.default_family, ...model.families.map(f => f.id)]) {
    if (levels.has(seed)) continue;
    levels.set(seed, 0);
    const queue = [seed];
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i];
      for (const [next, delta] of adjacent.get(id)) {
        const expected = levels.get(id) + delta;
        if (levels.has(next)) {
          if (levels.get(next) !== expected) throw Error('Inconsistent family generation: ' + id + ' / ' + next);
          continue;
        }
        levels.set(next, expected);
        queue.push(next);
      }
    }
  }
  const first = Math.min(...levels.values());
  return new Map([...levels].map(([id, level]) => [id, level - first]));
}
const familyGenerations = generationRanks();

function rank(f) {
  return familyGenerations.get(f.id);
}

function layout() {
  const rows = new Map();
  for (const f of model.families) {
    const r = rank(f);
    if (!rows.has(r)) rows.set(r, []);
    rows.get(r).push(f);
    const adults = f.parents,
      children = [...f.children, ...f.peers],
      innerW = Math.max(1, adults.length, children.length, f.related.length) * 264 + 32;
    boxes.set(f.id, {
      rank: r,
      w: Math.max(1100, innerW),
      innerW,
      h: f.related.length ? 880 : 580,
      x: 0,
      y: 0
    });
  }
  let y = 0;
  for (const [r, fs] of [...rows].sort((a, b) => a[0] - b[0])) {
    fs.sort((a, b) => (a.branch === 'maternal' ? 0 : 1) - (b.branch === 'maternal' ? 0 : 1));
    let x = 0;
    for (const f of fs) {
      const b = boxes.get(f.id);
      b.x = x;
      b.y = y;
      x += b.w + 130;
    }
    for (const f of fs) boxes.get(f.id).x -= x / 2;
    y += Math.max(...fs.map(f => boxes.get(f.id).h)) + 150;
  }
  for (let pass = 0; pass < 6; pass++) {
    for (const [r, fs] of [...rows].reverse()) {
      const target = f => {
        const links = familyEdges.filter(e => e.from === f.id);
        return links.length ? links.reduce((s, e) => s + boxes.get(e.to).x + boxes.get(e.to).w / 2, 0) / links.length : boxes.get(f.id).x + boxes.get(f.id).w / 2;
      };
      fs.sort((a, b) => target(a) - target(b));
      let x = 0;
      const center = fs.reduce((s, f) => s + target(f), 0) / fs.length;
      const total = fs.reduce((s, f) => s + boxes.get(f.id).w + 130, 0) - 130;
      for (const f of fs) {
        const b = boxes.get(f.id);
        b.x = center - total / 2 + x;
        x += b.w + 130;
      }
    }
  }
  for (const f of model.families) {
    const b = boxes.get(f.id);
    const rows = [f.parents, [...f.children, ...f.peers], f.related.map(r => r.person_id)];
    rows.forEach((ids, row) => ids.forEach((id, i) => {
      const o = {
        id,
        family: f.id,
        x: b.x + b.w / 2 + (i - (ids.length - 1) / 2) * 264 - 120,
        y: b.y + ([65, 340, 640][row]),
        w: 240,
        h: 210,
        row,
        peer: f.peers.includes(id),
        related: f.related.some(r => r.person_id === id)
      };
      occurrences.set(f.id + ':' + id, o);
    }));
  }
}
layout();

function curve(x1, y1, x2, y2) {
  const mid = (y1 + y2) / 2;
  return `M${x1},${y1} C${x1},${mid} ${x2},${mid} ${x2},${y2}`;
}

function parentRole(r) {
  const role = people.get(r.person_a_id)?.role || '';
  if (/^(Мама$|Мать\b|Мать |Бабушка по (маме|папе)$)/u.test(role)) return 'Мама';
  if (/^(Папа$|Отец |Дедушка по (маме|папе)$)/u.test(role)) return 'Папа';
  return 'Родитель';
}

function lineage() {
  const result = new Map(),
    id = state.selected || 'P-0001',
    roots = model.relationships.filter(r => r.relationship_type === 'parent-of' && r.person_b_id === id);

  function walk(child, side, seen) {
    if (seen.has(child)) return;
    seen = new Set([...seen, child]);
    for (const r of model.relationships.filter(r => r.relationship_type === 'parent-of' && r.person_b_id === child)) {
      for (const f of model.families.filter(f => f.children.includes(child) && f.parents.includes(r.person_a_id))) {
        for (const e of f.ancestors.filter(e => e.through_person_id === r.person_a_id)) {
          const key = e.family_id + ':' + f.id;
          if (!result.has(key)) result.set(key, new Set());
          result.get(key).add(side);
        }
      }
      walk(r.person_a_id, side, seen);
    }
  }
  for (const r of roots) {
    const role = parentRole(r),
      side = role === 'Мама' ? 'maternal' : role === 'Папа' ? 'paternal' : null;
    if (!side) continue;
    for (const f of model.families.filter(f => f.children.includes(id) && f.parents.includes(r.person_a_id)))
      for (const e of f.ancestors.filter(e => e.through_person_id === r.person_a_id)) {
        const key = e.family_id + ':' + f.id;
        if (!result.has(key)) result.set(key, new Set());
        result.get(key).add(side);
      }
    walk(r.person_a_id, side, new Set([id]));
  }
  const p = people.get(id);
  $('#lineage-legend').innerHTML = `<span class="lineage-maternal">Материнская линия ${esc(p.name)}</span><span class="lineage-paternal">Отцовская линия ${esc(p.name)}</span><small>Пунктир: условная связь · серый: контекст${roots.some(r=>parentRole(r)==='Мама')?'':' · мать не установлена'}${roots.some(r=>parentRole(r)==='Папа')?'':' · отец не установлен'}</small>`;
  return result;
}

function relationSentence(r) {
  const a = people.get(r.person_a_id),
    b = people.get(r.person_b_id);
  return `${a.name} — ${parentRole(r).toLocaleLowerCase('ru')} ${b.name}${r.rationale&&/гипотез|контекст|предполож|вывод/i.test(r.rationale)?' · гипотеза / контекст':''}`;
}

function conditional(r, f) {
  return f.status === 'hypothesis' || !!f.link_note || /контекст|предполож|гипотез|вывод/i.test(r.rationale || '');
}

function renderGraph() {
  const visible = new Set(state.visible),
    ancestry = lineage();
  let html = '',
    paths = '';
  for (const f of model.families.filter(f => visible.has(f.id))) {
    const b = boxes.get(f.id),
      ids = [...f.parents, ...f.children, ...f.peers, ...f.related.map(r => r.person_id)];
    html += `<div class="territory ${f.status}" data-family="${esc(f.id)}" style="left:${b.x+(b.w-b.innerW)/2}px;top:${b.y}px;width:${b.innerW}px;height:${b.h}px"><button class="family-heading" data-open-family="${f.id}">${esc(f.title)}${f.status==='hypothesis'?' · гипотеза':''}</button>${state.layoutMode==='years'?familyAtlas.graphTime.territoryMarkup(f,b):''}`;
    for (const id of ids) {
      const p = people.get(id),
        o = occurrences.get(f.id + ':' + id),
        e = evidence(id),
        place = p.place.length > 73 ? p.place.slice(0, 70) + '…' : p.place;
      html += `<article class="person ${state.layoutMode==='years'&&o.temporal.kind==='unknown'?'time-unknown':''} ${e.testimony.length?'has-testimony':''} ${e.historical.length||e.document?'has-historical':''} ${e.possible.some(q=>{const found=evidence(q);return found.historical.length||found.document;})?'has-possible-materials':''} ${state.selected===id?'selected':''}" data-person-node="${id}" style="left:${o.x-b.x-(b.w-b.innerW)/2}px;top:${o.y-b.y}px;height:${o.h}px"><button class="person-select" data-select-person="${id}" aria-label="Открыть досье: ${esc(p.name)}"><strong>${esc(p.name)}</strong>${state.layoutMode==='years'?familyAtlas.graphTime.birthMarkup(o):(p.dates?`<span class="dates">${esc(p.dates)}</span>`:'')}${place?`<span class="place">${esc(place)}</span>`:''}</button>${statusStrip(id)}</article>${state.layoutMode==='years'?familyAtlas.graphTime.rangeMarkup(o,b):''}`;
      if (o.peer) html += `<div class="peer-note" style="left:${o.x-b.x-(b.w-b.innerW)/2}px;top:${o.y-b.y+216}px">Сестра · родительство не задано</div>`;
      if (o.related) html += `<div class="peer-note" style="left:${o.x-b.x-(b.w-b.innerW)/2}px;top:${o.y-b.y-24}px">${esc(f.related.find(r=>r.person_id===id).label)}</div>`;
    }
    for (const r of model.relationships.filter(r => r.relationship_type === 'parent-of' && ids.includes(r.person_a_id) && ids.includes(r.person_b_id))) {
      const a = occurrences.get(f.id + ':' + r.person_a_id),
        z = occurrences.get(f.id + ':' + r.person_b_id),
        role = parentRole(r),
        type = role === 'Мама' ? 'mother' : role === 'Папа' ? 'father' : 'parent',
        path = state.layoutMode === 'years' ? familyAtlas.graphTime.parentPath(a, z) : curve(a.x + 120, a.y + a.h, z.x + 120, z.y);
      paths += `<path class="person-path ${type} ${conditional(r,f)?'conditional':''} ${r.person_b_id===state.selected?'incoming':''} ${r.person_a_id===state.selected?'outgoing':''}" data-relation="${r.relationship_id}" data-from-person="${a.id}" data-to-person="${z.id}" d="${path}"><title>${esc(relationSentence(r))} · ${esc(r.rationale)}</title></path><path class="edge-hit" data-edge-hit="${r.relationship_id}" d="${path}" role="button" tabindex="0" aria-label="${esc(relationSentence(r))}"/>`;
    }
    html += '</div>';
  }
  const routes = atlasRouter.routes(boxes, occurrences, familyEdges);
  for (const e of familyEdges.filter(e => visible.has(e.from) && visible.has(e.to))) {
    const f = families.get(e.from),
      uncertain = e.status === 'hypothesis' || !!f.link_note,
      key = e.from + ':' + e.to,
      route = routes.get(key),
      colors = [...(ancestry.get(key) || [])].map(s => 'lineage-' + s).join(' '),
      label = `${uncertain?'Условный семейный контекст. ':''}Тот же идентификатор в двух семьях: ${people.get(e.through_person_id)?.name||e.through_person_id}. Это продолжение записи, не линия родительства. ${e.note}`;
    paths += `<path class="family-path route-overview ${colors} ${uncertain?'conditional':''}" data-through-person="${e.through_person_id}" data-family-edge="${key}" d="${route.overview}"><title>${esc(label)}</title></path><path class="family-path identity-continuation route-detail ${colors} ${uncertain?'conditional':''}" data-through-person="${e.through_person_id}" data-continuation-edge="${key}" d="${route.detail}" aria-label="${esc(label)}"><title>${esc(label)}</title></path><path class="continuation-hit route-overview" data-continuation-hit="${key}" data-hit-layer="overview" d="${route.overview}" role="button" tabindex="0" aria-label="Связь семей через ${esc(people.get(e.through_person_id)?.name||'родственника')}"/><path class="continuation-hit route-detail" data-continuation-hit="${key}" data-hit-layer="detail" d="${route.detail}" role="button" tabindex="0" aria-label="Один человек в двух семьях: ${esc(people.get(e.through_person_id)?.name||'родственник')}"/>`;
  }
  $('#territories').innerHTML = html;
  $('#connections').innerHTML = paths;
  $('#labels').innerHTML = state.visible.map(id => {
    const f = families.get(id),
      own = [...f.parents, ...f.children, ...f.peers, ...f.related.map(r => r.person_id)].map(evidence);
    return `<button class="overview-label ${f.status} ${f.branch==='home'?'home':''} ${own.some(e=>e.testimony.length)?'has-testimony':''} ${own.some(e=>e.historical.length||e.document)?'has-historical':''} ${own.some(e=>e.possible.some(id=>{const found=evidence(id);return found.historical.length||found.document;}))?'has-possible-materials':''}" data-open-family="${id}" aria-label="${esc(f.title+' · '+f.caption)}"><strong>${esc(f.title)}</strong>${familyFindings(f)}${state.layoutMode==='years'?familyAtlas.graphTime.summary(f,boxes.get(id)):''}<small>${f.status==='hypothesis'?'Возможная семья · ':''}${esc(f.caption)}</small><span class="family-counts">Родители: ${f.parents.length} · Дети: ${f.children.length+f.peers.length}${f.related.length?` · Для проверки: ${f.related.length}`:''}</span><span class="family-names">${[['Родители',f.parents],['Дети',[...f.children,...f.peers]],['Связанные записи',f.related.map(r=>r.person_id)]].filter(([,ids])=>ids.length).map(([label,ids])=>`<span class="member-row"><small>${label}</small><span class="member-grid">${ids.map(id=>`<span data-member="${id}">${esc(people.get(id).name)}${f.related.some(r=>r.person_id===id)?`<small>${esc(f.related.find(r=>r.person_id===id).label)}</small>`:''}</span>`).join('')}</span></span>`).join('')}</span></button>`;
  }).join('');
  $('#context-label').textContent = state.mode === 'all' ? `${state.visible.length} семейные области · 37 семейных записей · гипотезы не скрыты` : state.mode;
  for (const el of document.querySelectorAll('.branchbar button:not(.provenance)')) el.setAttribute('aria-pressed', String(el.dataset.branch === 'maternal' ? state.mode === 'Мамина ветвь' : el.dataset.branch === 'paternal' ? state.mode === 'Папина ветвь' : state.mode === 'all'));
}

function clearRelationHighlight() {
  state.edgeRelation = null;
  state.edgeContinuation = null;
  for (const n of document.querySelectorAll('.continuation-active,.continuation-endpoint')) n.classList.remove('continuation-active', 'continuation-endpoint');
  for (const n of document.querySelectorAll('.edge-endpoint')) n.classList.remove('edge-endpoint');
  for (const n of document.querySelectorAll('.edge-active')) n.classList.remove('edge-active');
  if (!state.locatedContext) {
    $('#relationship-status').hidden = true;
    $('#relationship-status').textContent = '';
  }
}

function highlightRelation(id) {
  const r = model.relationships.find(r => r.relationship_id === id);
  if (!r) return;
  state.edgeRelation = id;
  for (const n of document.querySelectorAll('.person')) n.classList.toggle('edge-endpoint', [r.person_a_id, r.person_b_id].includes(n.dataset.personNode));
  for (const p of document.querySelectorAll('.person-path')) p.classList.toggle('edge-active', p.dataset.relation === id);
  $('#relationship-status').textContent = relationSentence(r);
  $('#relationship-status').hidden = false;
}

function continuationRecord(key) {
  return familyEdges.find(e => e.from + ':' + e.to === key);
}

function highlightContinuation(key) {
  const e = continuationRecord(key);
  if (!e) return;
  clearRelationHighlight();
  state.edgeContinuation = key;
  for (const n of document.querySelectorAll('.family-path')) n.classList.toggle('continuation-active', (n.dataset.familyEdge || n.dataset.continuationEdge) === key);
  for (const n of document.querySelectorAll('.overview-label,[data-family]')) n.classList.toggle('continuation-endpoint', [e.from, e.to].includes(n.dataset.openFamily || n.dataset.family));
  for (const n of document.querySelectorAll('.person')) n.classList.toggle('edge-endpoint', n.dataset.personNode === e.through_person_id);
  $('#relationship-status').textContent = people.get(e.through_person_id).name + ' · связь двух семейных групп';
  $('#relationship-status').hidden = false;
}

function showContinuation(key) {
  const e = continuationRecord(key);
  if (!e) return;
  const p = people.get(e.through_person_id),
    from = families.get(e.from),
    to = families.get(e.to),
    uncertain = e.status === 'hypothesis' || !!from.link_note;
  const role = f => f.parents.includes(p.id) ? 'Среди родителей' : f.children.includes(p.id) ? 'Среди детей' : f.peers.includes(p.id) ? 'Родственник в группе' : 'Связанная запись';
  const ids = [...new Set([...p.source_ids, ...from.source_ids, ...to.source_ids])];
  openDrawer('Связь между семьями', `<article data-continuation-detail="${esc(key)}"><h1>${esc(p.name)}</h1><p>Один человек показан в двух семейных группах. Линия соединяет его появления, а не обозначает новое родство между двумя людьми.</p>${uncertain?'<p class="qualification">Семейный контекст предположительный. Эта линия не подтверждает гипотезу родства.</p>':''}<section class="continuation-families"><h2>Что соединено</h2>${[from,to].map(f=>`<article><strong>${esc(f.title)}</strong><p>${esc(f.caption)}</p><small>${esc(role(f))}: ${esc(p.name)}</small><button data-line-family="${f.id}">Показать эту семью</button></article>`).join('')}</section><button class="relation" data-open-person="${p.id}">Открыть досье: ${esc(p.name)}</button><section><h2>На чём основана связь</h2><p>${esc(e.note)}</p>${ids.map(id=>sources.get(id)).filter(Boolean).map(sourceCard).join('')}</section></article>`);
  highlightContinuation(key);
}
for (const type of ['pointerover', 'focusin']) document.addEventListener(type, e => {
  const n = e.target.closest('[data-continuation-hit]');
  if (n && !document.querySelector('#drawer:not([hidden]) [data-continuation-detail]')) highlightContinuation(n.dataset.continuationHit);
});
for (const type of ['pointerout', 'focusout']) document.addEventListener(type, e => {
  if (e.target.closest('[data-continuation-hit]') && !e.relatedTarget?.closest?.('[data-continuation-hit]') && !document.querySelector('#drawer:not([hidden]) [data-continuation-detail]')) clearRelationHighlight();
});
document.addEventListener('click', e => {
  const f = e.target.closest('[data-line-family]');
  if (f) {
    focusFamily(f.dataset.lineFamily);
    return;
  }
  const n = e.target.closest('[data-continuation-hit]');
  if (n && e.detail === 0) showContinuation(n.dataset.continuationHit);
});
$('#connections').addEventListener('keydown', e => {
  const n = e.target.closest('[data-continuation-hit]');
  if (n && ['Enter', ' '].includes(e.key)) {
    e.preventDefault();
    e.stopPropagation();
    showContinuation(n.dataset.continuationHit);
  }
});

function showRelation(id) {
  const r = model.relationships.find(r => r.relationship_id === id);
  if (!r) return;
  highlightRelation(id);
  openDrawer('Связь и основание', `<article data-relation-detail="${esc(id)}"><h1>${esc(relationSentence(r))}</h1><p>${esc(r.rationale)}</p><small>Линия не означает архивного доказательства · ${esc(id)}</small><section><h2>Люди</h2>${[r.person_a_id,r.person_b_id].map(id=>`<button class="relation" data-open-person="${id}">${esc(people.get(id).name)}</button>`).join('')}</section><section><h2>Основания</h2>${(r.supporting_artifact_ids||'').split(';').map(s=>sources.get(s)).filter(Boolean).map(sourceCard).join('')}</section></article>`);
}
for (const event of ['pointerover', 'focusin']) document.addEventListener(event, e => {
  const b = e.target.closest('[data-edge-hit]');
  if (b) highlightRelation(b.dataset.edgeHit);
});
for (const event of ['pointerout', 'focusout']) document.addEventListener(event, e => {
  const b = e.target.closest('[data-edge-hit]');
  if (b && !e.relatedTarget?.closest?.('[data-edge-hit]')) clearRelationHighlight();
});
document.addEventListener('click', e => {
  const b = e.target.closest('[data-edge-hit]');
  if (b) showRelation(b.dataset.edgeHit);
});
$('#connections').addEventListener('keydown', e => {
  const b = e.target.closest('[data-edge-hit]');
  if (b && ['Enter', ' '].includes(e.key)) {
    e.preventDefault();
    e.stopPropagation();
    showRelation(b.dataset.edgeHit);
  }
});

function showTree(branch = 'all') {
  state.mode = branch === 'all' ? 'all' : branch === 'maternal' ? 'Мамина ветвь' : 'Папина ветвь';
  state.visible = model.families.filter(f => branch === 'all' || f.branch === branch).map(f => f.id);
  renderGraph();
  if (window.familyAtlas?.fitTree) fitTree();
}

function showFamily(id, direction) {
  if (!families.has(id)) return;
  state.family = id;
  if (direction) {
    const found = new Set([id]),
      walk = k => {
        const fs = direction === 'ancestors' ? families.get(k).ancestors : families.get(k).descendants;
        for (const e of fs)
          if (!found.has(e.family_id)) {
            found.add(e.family_id);
            walk(e.family_id);
          }
      };
    walk(id);
    state.visible = [...found];
    state.mode = (direction === 'ancestors' ? 'Предки: ' : 'Потомки: ') + families.get(id).title;
    renderGraph();
    if (window.familyAtlas?.fitTree) fitTree();
  } else if (window.familyAtlas?.focusFamily) focusFamily(id);
}
window.familyAtlas = {
  model,
  state,
  treeState,
  showTree,
  showFamily,
  boxes,
  occurrences,
  evidence
};
renderGraph();

function bounds(ids = state.visible) {
  const bs = ids.map(id => boxes.get(id));
  return {
    x: Math.min(...bs.map(b => b.x)),
    y: Math.min(...bs.map(b => b.y)),
    right: Math.max(...bs.map(b => b.x + b.w)),
    bottom: Math.max(...bs.map(b => b.y + b.h))
  };
}

function usable() {
  return $('#map').clientWidth > 80 && $('#map').clientHeight > 100;
}

function commit(scale, cx, cy, intent) {
  if (!usable() || ![scale, cx, cy].every(Number.isFinite) || scale <= 0) return false;
  Object.assign(treeState, {
    scale: Math.max(.002, Math.min(3, scale)),
    cx,
    cy,
    intent,
    initialized: true,
    width: $('#map').clientWidth,
    height: $('#map').clientHeight
  });
  paint();
  return true;
}

function paint() {
  const v = $('#map'),
    s = treeState.scale,
    x = v.clientWidth / 2 - s * treeState.cx,
    y = v.clientHeight / 2 - s * treeState.cy;
  $('#world').style.setProperty('--unit', String(1 / s));
  $('#world').style.transform = `translate(${x}px,${y}px) scale(${s})`;
  v.classList.toggle('overview', s < .58);
  v.classList.toggle('detail', s >= .58);
  v.classList.toggle('family-level', s >= .32 && s < .58);
  v.classList.toggle('compact-overview', v.clientWidth <= 760 && s < .12);
  $('#zoom').textContent = Math.round(s * 100) + '%';
  if (s < .58) {
    const frames = new Map();
    for (const el of document.querySelectorAll('.overview-label')) {
      const b = boxes.get(el.dataset.openFamily),
        f = families.get(el.dataset.openFamily),
        maxW = Math.max(2, b.w * s - 4),
        maxH = Math.max(2, b.h * s - 4),
        mark = maxW < (state.layoutMode === 'years' ? 80 : 110) || maxH < (state.layoutMode === 'years' ? 50 : 54);
      const w = mark ? Math.min(18, maxW) : Math.min(360, maxW),
        columns = Math.max(f.parents.length, f.children.length + f.peers.length, f.related.length);
      el.classList.toggle('summary-estimated', state.layoutMode === 'years' && !b.known);
      el.classList.toggle('summary-tight', maxH < 110 || w < 160);
      el.classList.toggle('summary-mark', mark);
      el.classList.toggle('summary-caption', !mark && maxH >= 75 && w >= 150);
      el.classList.toggle('summary-names', !mark && w >= columns * 112 + 24 && maxH >= 210);
      el.style.left = (x + s * (b.x + b.w / 2)) + 'px';
      el.style.top = (y + s * (b.y + b.h / 2)) + 'px';
      el.style.width = w + 'px';
      el.style.height = 'auto';
      el.style.setProperty('--summary-font', Math.min(17, Math.max(12, w / 10)) + 'px');
      let h = mark ? Math.min(10, maxH) : el.getBoundingClientRect().height;
      if (!mark && h > maxH && el.classList.contains('summary-names')) {
        el.classList.remove('summary-names');
        h = el.getBoundingClientRect().height;
      }
      if (!mark && h > maxH && el.classList.contains('summary-caption')) {
        el.classList.remove('summary-caption');
        h = el.getBoundingClientRect().height;
      }
      h = Math.min(maxH, Math.max(2, Math.ceil(h)));
      el.style.height = h + 'px';
      frames.set(f.id, {
        x: b.x + b.w / 2 - w / (2 * s),
        y: b.y + b.h / 2 - h / (2 * s),
        w: w / s,
        h: h / s
      });
    }
    familyAtlas.summaryFrames = frames;
    const routed = atlasRouter.overviewRoutes(frames, familyEdges);
    for (const p of document.querySelectorAll('[data-family-edge]')) {
      const d = routed.get(p.dataset.familyEdge) || '';
      p.setAttribute('d', d);
      document.querySelector(`[data-continuation-hit="${p.dataset.familyEdge}"][data-hit-layer="overview"]`)?.setAttribute('d', d);
    }
  }
  miniMap();
  if (state.layoutMode === 'years') window.familyAtlas.graphTime.paintAxis?.();
}

function safeViewport() {
  const w = $('#map').clientWidth,
    h = $('#map').clientHeight;
  return {
    w: w - 32,
    h: Math.max(20, h - (h >= 300 ? 170 : h * .4) - (h >= 300 ? 100 : h * .25)),
    top: h >= 300 ? 170 : h * .4
  };
}

function fitTree() {
  treeState.intent = 'fit-all';
  if (!usable()) return false;
  const b = bounds(),
    v = safeViewport(),
    s = Math.min(1, v.w / (b.right - b.x), v.h / (b.bottom - b.y));
  return commit(s, (b.x + b.right) / 2, (b.y + b.bottom) / 2 + ($('#map').clientHeight / 2 - v.top - v.h / 2) / s, 'fit-all');
}

function focusFamily(id) {
  if (!boxes.has(id)) return false;
  treeState.intent = 'focus-family';
  treeState.focus = id;
  if (!usable()) return false;
  const b = boxes.get(id),
    v = safeViewport(),
    s = Math.min(1, v.w / b.innerW, v.h / b.h);
  return commit(s, b.x + b.w / 2, b.y + b.h / 2 + ($('#map').clientHeight / 2 - v.top - v.h / 2) / s, 'focus-family');
}

function zoomAt(factor, px = $('#map').clientWidth / 2, py = $('#map').clientHeight / 2) {
  if (!usable()) return;
  const s = treeState.scale,
    ns = Math.max(.002, Math.min(2.5, s * factor));
  commit(ns, treeState.cx + (px - $('#map').clientWidth / 2) * (1 / s - 1 / ns), treeState.cy + (py - $('#map').clientHeight / 2) * (1 / s - 1 / ns), 'manual');
}

function miniMap() {
  const b = bounds(model.families.map(f => f.id)),
    w = b.right - b.x,
    h = b.bottom - b.y,
    k = Math.min(188 / w, 98 / h),
    ox = (200 - w * k) / 2,
    oy = (110 - h * k) / 2,
    toX = x => ox + (x - b.x) * k,
    toY = y => oy + (y - b.y) * k;
  let out = familyEdges.map(e => {
    const a = boxes.get(e.from),
      z = boxes.get(e.to);
    return `<path d="M${toX(a.x+a.w/2)},${toY(a.y+285)} L${toX(z.x+z.w/2)},${toY(z.y+285)}" stroke="#c3ccd8" fill="none"/>`;
  }).join('');
  out += model.families.map(f => {
    const a = boxes.get(f.id);
    return `<rect x="${toX(a.x+a.w/2)-2}" y="${toY(a.y+285)-1.5}" width="4" height="3" fill="${f.status==='hypothesis'?'#80521f':'#586272'}"/>`;
  }).join('');
  out += `<rect x="${toX(treeState.cx-$('#map').clientWidth/2/treeState.scale)}" y="${toY(treeState.cy-$('#map').clientHeight/2/treeState.scale)}" width="${$('#map').clientWidth/treeState.scale*k}" height="${$('#map').clientHeight/treeState.scale*k}" fill="#2454b810" stroke="#2454b8"/>`;
  $('#minimap').innerHTML = out;
}
let queued = false;
new ResizeObserver(() => {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    if (!usable()) return;
    if (!treeState.initialized || treeState.intent === 'pending-initial') {
      if (innerWidth <= 760) focusFamily('F-home');
      else fitTree();
    } else if (treeState.intent === 'fit-all') fitTree();
    else if (treeState.intent === 'focus-family') focusFamily(treeState.focus || 'F-home');
    else commit(treeState.scale, treeState.cx, treeState.cy, 'manual');
  });
}).observe($('#map'));
const pointers = new Map();
let gesture = null;

function continuationsAt(x, y, fallback) {
  const candidates = [];
  for (const n of document.querySelectorAll('.family-path[data-family-edge],.family-path[data-continuation-edge]')) {
    if (getComputedStyle(n).visibility === 'hidden') continue;
    const r = n.getBoundingClientRect();
    if (x < r.left - 24 || x > r.right + 24 || y < r.top - 24 || y > r.bottom + 24) continue;
    const len = n.getTotalLength(),
      m = n.getScreenCTM(),
      step = 8 / Math.max(.001, Math.hypot(m.a, m.b));
    let a = n.getPointAtLength(0);
    a = new DOMPoint(a.x, a.y).matrixTransform(m);
    let closest = Infinity;
    for (let d = step; d < len + step; d += step) {
      let b = n.getPointAtLength(Math.min(d, len));
      b = new DOMPoint(b.x, b.y).matrixTransform(m);
      const vx = b.x - a.x,
        vy = b.y - a.y,
        t = Math.max(0, Math.min(1, ((x - a.x) * vx + (y - a.y) * vy) / (vx * vx + vy * vy || 1))),
        distance = (x - a.x - vx * t) ** 2 + (y - a.y - vy * t) ** 2;
      closest = Math.min(closest, distance);
      a = b;
    }
    candidates.push({
      key: n.dataset.familyEdge || n.dataset.continuationEdge,
      distance: Math.sqrt(closest)
    });
  }
  candidates.sort((a, b) => a.distance - b.distance || a.key.localeCompare(b.key));
  return candidates.length ? candidates.filter(c => c.distance <= candidates[0].distance + 1.5).map(c => c.key) : [fallback];
}

function showContinuationChoices(keys) {
  clearRelationHighlight();
  openDrawer('Связи в этой точке', `<article data-continuation-choices><h1>Здесь проходят ${keys.length} связи</h1><p>Линии наложились друг на друга. Выбери человека, чью связь хочешь посмотреть.</p>${keys.map(key=>{const e=continuationRecord(key),p=people.get(e.through_person_id);return `<button class="continuation-choice" data-choose-continuation="${esc(key)}"><strong>${esc(p.name)}</strong><small>${esc(families.get(e.from).title)} · ${esc(families.get(e.to).title)}</small></button>`;}).join('')}</article>`);
}
document.addEventListener('click', e => {
  const n = e.target.closest('[data-choose-continuation]');
  if (n) showContinuation(n.dataset.chooseContinuation);
});

function canvasInteractive(target) {
  return !!target?.closest?.('button,a,input,.person,[data-edge-hit],[data-continuation-hit],#drawer,#drawer-resizer');
}
$('#map').addEventListener('pointerdown', e => {
  if (canvasInteractive(e.target) && !e.target.closest('[data-continuation-hit]') || (e.pointerType === 'mouse' && e.button !== 0)) return;
  pointers.set(e.pointerId, {
    x: e.clientX,
    y: e.clientY
  });
  $('#map').setPointerCapture(e.pointerId);
  if (pointers.size === 1) gesture = {
    x: e.clientX,
    y: e.clientY,
    moved: false,
    pinching: false,
    lineKeys: e.target.closest('[data-continuation-hit]') ? continuationsAt(e.clientX, e.clientY, e.target.closest('[data-continuation-hit]').dataset.continuationHit) : []
  };
  else if (gesture) {
    gesture.pinching = true;
    gesture.moved = true;
  }
});
$('#map').addEventListener('pointermove', e => {
  if (!pointers.has(e.pointerId) || !gesture) return;
  const previous = pointers.get(e.pointerId),
    prev = [...pointers.values()];
  pointers.set(e.pointerId, {
    x: e.clientX,
    y: e.clientY
  });
  const pts = [...pointers.values()];
  if (pts.length === 2 && prev.length === 2) {
    gesture.pinching = true;
    gesture.moved = true;
    const distance = a => Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y),
      r = $('#map').getBoundingClientRect();
    zoomAt(distance(pts) / Math.max(1, distance(prev)), (pts[0].x + pts[1].x) / 2 - r.left, (pts[0].y + pts[1].y) / 2 - r.top);
  } else {
    const dx = e.clientX - (gesture.moved ? previous.x : gesture.x),
      dy = e.clientY - (gesture.moved ? previous.y : gesture.y);
    if (!gesture.moved && Math.hypot(dx, dy) <= 6) return;
    gesture.moved = true;
    commit(treeState.scale, treeState.cx - dx / treeState.scale, treeState.cy - dy / treeState.scale, 'manual');
  }
});
for (const type of ['pointerup', 'pointercancel']) $('#map').addEventListener(type, e => {
  if (!pointers.has(e.pointerId)) return;
  const tap = type === 'pointerup' && pointers.size === 1 && gesture && !gesture.moved && !gesture.pinching && Math.hypot(e.clientX - gesture.x, e.clientY - gesture.y) <= 6;
  const lineKeys = gesture?.lineKeys || [];
  pointers.delete(e.pointerId);
  if (!pointers.size) gesture = null;
  if (tap && lineKeys.length) {
    if (lineKeys.length === 1) showContinuation(lineKeys[0]);
    else showContinuationChoices(lineKeys);
    return;
  }
  const rect = $('#map').getBoundingClientRect();
  if (tap && e.clientX >= rect.left && e.clientX < rect.right && e.clientY >= rect.top && e.clientY < rect.bottom && !canvasInteractive(document.elementFromPoint(e.clientX, e.clientY))) deselect();
});
$('#map').addEventListener('wheel', e => {
  e.preventDefault();
  const r = $('#map').getBoundingClientRect();
  zoomAt(Math.exp(-e.deltaY * .0018), e.clientX - r.left, e.clientY - r.top);
}, {
  passive: false
});
$('#map').addEventListener('keydown', e => {
  if (e.target.tagName === 'BUTTON') return;
  const d = 100 / treeState.scale;
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
    e.preventDefault();
    commit(treeState.scale, treeState.cx + (e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0), treeState.cy + (e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0), 'manual');
  } else if (e.key === '+' || e.key === '=') zoomAt(1.25);
  else if (e.key === '-') zoomAt(.8);
  else if (e.key === '0') fitTree();
  else if (e.key === 'Home') focusFamily('F-home');
});
Object.assign(window.familyAtlas, {
  fitTree,
  focusFamily,
  zoomAt,
  commit,
  bounds
});

function safeURL(value) {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value)) return '';
  try {
    const u = new URL(value);
    return ['http:', 'https:'].includes(u.protocol) ? value : '';
  } catch {
    return '';
  }
}

function sourceLink(url, label) {
  const safe = safeURL(url);
  return safe ? `<a class="source-url" href="${esc(safe)}" target="_blank" rel="noopener noreferrer" title="Если браузер запрещает переход из изолированного атласа, скопируйте этот адрес">${esc(label||safe)}</a>` : '';
}

function sourceKind(s) {
  return ({
    'user-display-rule': 'Уточнение пользователя · правило показа',
    'family-testimony': 'По рассказам · семейное свидетельство',
    'family-forum': 'Публикация другого исследователя',
    'index': 'Сайт · индексная запись',
    'image-of-original': 'Документ · цифровая копия',
    'archive-catalog': 'Архивный каталог · не персональная запись',
    'local-history-index': 'Краеведческий указатель',
    'local-history-article': 'Краеведческая статья',
    'regional-book': 'Книга памяти'
  })[s.kind] || s.kind;
}

function sourceTitle(s) {
  const labels = {
    'HS-P-Q-family': 'Пономаревы и Паламарчук · семейная публикация',
    'HS-P-Q-marriage': 'Анна Цытко · сообщение о брачной записи',
    'HS-P-Q-extract': 'Анна Цытко · обсуждение архивной выписки',
    'HS-P-Q-kolbasov': 'Роман Колбасов · семейная публикация',
    'HS-P-Q-kolbasov-parents': 'Родители Романа Колбасова · семейная публикация',
    'HS-P-Q-roman-repression': 'Роман Григорьев · репрессивная карточка',
    'HS-P-Q-stepan-repression': 'Степан Пономарев · репрессивная карточка',
    'HS-P-Q-optants': 'Список дел об оптации · дело 159',
    'HS-P-Q-optants-query': 'Казимир Цитко · вопрос исследователя',
    'HS-P-Q-optants-reply': 'Ответ в обсуждении оптации'
  };
  return labels[s.id] || s.title;
}

function sourceCard(s) {
  const shared = ['family-testimony', 'family-forum'].includes(s.kind) || model.people.filter(p => p.source_ids.includes(s.id)).length > 1;
  const scope = shared ? 'Общий семейный источник · не личная биография' : 'Источник этой записи';
  return `<article class="source" data-source-id="${esc(s.id)}"><small class="source-kind">${esc(sourceKind(s))}</small><strong>${esc(sourceTitle(s))}</strong><small class="source-scope">${scope}</small>${sourceLink(s.url)}<details class="source-original"><summary>${shared?'Общий источник · полный текст и оговорки':'Содержание источника и оговорки'}</summary>${s.summary?`<p class="original-text">${esc(s.summary)}</p>`:''}${s.note?`<p>${esc(s.note)}</p>`:''}${s.text?`<pre>${esc(s.text)}</pre>`:''}<small>${esc(s.title)}</small></details><small class="reference-id">${esc(s.id)}</small></article>`;
}

function nationality(p) {
  const n = p.nationality;
  return n ? `<section data-nationality-owner="${p.id}"><h2>Национальность · только в этой записи</h2><p>${esc(n.value)}</p><p>«${esc(n.quote)}»</p><small>${esc(n.label)} · ${esc(n.basis)}</small><p>${esc(n.note)}</p>${sourceLink(n.url)}</section>` : '';
}

function comparisonIDs(p) {
  const ids = new Set([...p.record_matches, ...model.people.filter(q => q.record_matches.includes(p.id)).map(q => q.id)]);
  for (const r of model.relationships.filter(r => r.relationship_type === 'possible-identity' && (r.person_a_id === p.id || r.person_b_id === p.id))) ids.add(r.person_a_id === p.id ? r.person_b_id : r.person_a_id);
  for (const c of model.comparisons) {
    if (c.person_id === p.id)
      for (const id of c.record_ids) ids.add(id);
    else if (c.record_ids.includes(p.id)) ids.add(c.person_id);
  }
  return [...ids].filter(id => id !== p.id && people.has(id));
}

function compare(p) {
  const matches = comparisonIDs(p);
  const notes = model.comparisons.filter(c => c.person_id === p.id && !c.record_ids.length);
  if (!matches.length && !notes.length) return '';
  return `<div data-comparisons>${matches.length?`<h3>Возможное совпадение</h3><p class="qualification">Самостоятельные записи. Тождество не установлено; материалы и национальность не переносятся</p>`:''}${matches.map(id=>{
    const q=people.get(id);
    const reasons=model.relationships.filter(r=>r.relationship_type==='possible-identity'&&[p.id,id].includes(r.person_a_id)&&[p.id,id].includes(r.person_b_id)).map(r=>r.rationale).filter(Boolean);
    return `<article class="comparison"><div class="compare-columns"><div><small>${p.kind==='family'?'Рассказ семьи':'Выбранная запись'} <span class="reference-id">${p.id}</span></small><h3>${esc(p.name)}</h3>${p.dates?`<p>${esc(p.dates)}</p>`:''}${p.place?`<p>${esc(p.place)}</p>`:''}</div><div><small>Отдельная запись <span class="reference-id">${q.id}</span></small><h3>${esc(q.name)}</h3>${q.dates?`<p>${esc(q.dates)}</p>`:''}${q.death?`<p>${esc(q.death)}</p>`:''}${q.place?`<p>${esc(q.place)}</p>`:''}</div></div>${model.comparisons.filter(c=>c.person_id===p.id&&c.record_ids.includes(id)||c.person_id===id&&c.record_ids.includes(p.id)).map(c=>`<p>${esc(c.text)}</p>`).join('')}${q.note||reasons.length?`<details><summary>Сведения и основания сопоставления</summary>${reasons.map(t=>`<p>${esc(t)}</p>`).join('')}${q.note?`<p>${esc(q.note)}</p>`:''}</details>`:''}<button data-open-person="${id}" data-person-section="sources">Открыть запись и источники <span class="reference-id">${q.id}</span></button></article>`;
  }).join('')}${notes.map(c=>`<h3>${esc(c.title)}</h3><p>${esc(c.text)}</p>`).join('')}</div>`;
}

function relationLabel(r, id) {
  const outgoing = r.person_a_id === id;
  return r.relationship_type === 'parent-of' ? (outgoing ? 'Ребёнок' : parentRole(r)) : ({
    'spouse-of': 'Пара',
    'sibling-of': 'Брат / сестра',
    'grandparent-of': outgoing ? 'Внук / внучка' : 'Бабушка / дедушка',
    'reported-family-link': 'Семейная связь по рассказу',
    'possible-identity': 'Возможное тождество',
    'possible-kinship': 'Возможное родство'
  })[r.relationship_type] || r.relationship_type;
}

function familySection(p) {
  const rels = model.relationships.filter(r => (r.person_a_id === p.id || r.person_b_id === p.id) && r.relationship_type !== 'possible-identity');
  const groups = [
    ['Родители', rels.filter(r => r.relationship_type === 'parent-of' && r.person_b_id === p.id)],
    ['Пара', rels.filter(r => r.relationship_type === 'spouse-of')],
    ['Дети', rels.filter(r => r.relationship_type === 'parent-of' && r.person_a_id === p.id)],
    ['Другие связи', rels.filter(r => !['parent-of', 'spouse-of'].includes(r.relationship_type))]
  ];
  return groups.filter(([, rs]) => rs.length).map(([title, rs]) => `<div class="relation-group"><h3>${title}</h3>${rs.map(r=>{
    const q=people.get(r.person_a_id===p.id?r.person_b_id:r.person_a_id);if(!q)return '';
    const uncertain=kinshipUncertain(r);
    return `<div class="relation-row"><button class="relation" data-open-person="${q.id}"><small>${esc(relationLabel(r,p.id))}${uncertain?' · гипотеза':''}</small>${esc(q.name)}</button><details><summary>Основание связи</summary><p>${esc(r.rationale)}</p><button data-inspect-relation="${esc(r.relationship_id)}">Связь и её источники</button></details></div>`;
  }).join('')}</div>`).join('');
}
let lastFocus = null;
const drawerSize = {
  width: 450,
  height: null
};

function drawerLimits() {
  const w = $('#workspace').clientWidth,
    h = $('#workspace').clientHeight,
    mobile = w <= 760;
  const max = Math.max(1, Math.floor(mobile ? h - 110 : Math.min(780, w * .68, w - 300)));
  return {
    mobile,
    min: Math.min(mobile ? 260 : 340, max),
    max
  };
}

function syncDrawerSize() {
  const limits = drawerLimits(),
    sep = $('#drawer-resizer');
  const preferred = limits.mobile ? (drawerSize.height ?? Math.round($('#workspace').clientHeight * .55)) : drawerSize.width;
  const value = Math.round(Math.max(limits.min, Math.min(limits.max, preferred)));
  $('#workspace').style.setProperty(limits.mobile ? '--drawer-height' : '--drawer-width', value + 'px');
  sep.setAttribute('aria-orientation', limits.mobile ? 'horizontal' : 'vertical');
  sep.setAttribute('aria-label', limits.mobile ? 'Изменить высоту досье' : 'Изменить ширину досье');
  sep.setAttribute('aria-valuemin', String(limits.min));
  sep.setAttribute('aria-valuemax', String(limits.max));
  sep.setAttribute('aria-valuenow', String(value));
  sep.setAttribute('aria-valuetext', value + ' пикселей');
}

function resizeDrawer(value) {
  const limits = drawerLimits();
  drawerSize[limits.mobile ? 'height' : 'width'] = Math.max(limits.min, Math.min(limits.max, value));
  if (treeState.initialized) treeState.intent = 'manual';
  syncDrawerSize();
}
let resizing = null;
$('#drawer-resizer').addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  const sep = e.currentTarget;
  sep.focus({
    preventScroll: true
  });
  sep.setPointerCapture(e.pointerId);
  resizing = {
    id: e.pointerId,
    x: e.clientX,
    y: e.clientY,
    start: +sep.getAttribute('aria-valuenow'),
    mobile: drawerLimits().mobile
  };
  $('#workspace').classList.add('resizing-inspector');
});
$('#drawer-resizer').addEventListener('pointermove', e => {
  if (!resizing || resizing.id !== e.pointerId) return;
  e.preventDefault();
  resizeDrawer(resizing.start - (resizing.mobile ? e.clientY - resizing.y : e.clientX - resizing.x));
});
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) $('#drawer-resizer').addEventListener(type, e => {
  if (resizing?.id !== e.pointerId) return;
  resizing = null;
  $('#workspace').classList.remove('resizing-inspector');
});
$('#drawer-resizer').addEventListener('keydown', e => {
  const limits = drawerLimits(),
    step = e.shiftKey ? 64 : 24,
    current = +e.currentTarget.getAttribute('aria-valuenow');
  let value;
  if (e.key === 'Home') value = limits.min;
  else if (e.key === 'End') value = limits.max;
  else if (e.key === (limits.mobile ? 'ArrowUp' : 'ArrowLeft')) value = current + step;
  else if (e.key === (limits.mobile ? 'ArrowDown' : 'ArrowRight')) value = current - step;
  if (value !== undefined) {
    e.preventDefault();
    e.stopPropagation();
    resizeDrawer(value);
  }
});
window.addEventListener('resize', syncDrawerSize);

function openDrawer(kind, html) {
  lastFocus = document.activeElement;
  treeState.intent = treeState.initialized ? 'manual' : treeState.intent;
  $('#drawer-kind').textContent = kind;
  $('#dossier').innerHTML = html;
  syncDrawerSize();
  $('#drawer').hidden = false;
  $('#drawer-resizer').hidden = false;
  $('#workspace').classList.add('has-drawer');
  $('#drawer').scrollTop = 0;
}

function closeDrawer() {
  if (state.edgeContinuation) clearRelationHighlight();
  treeState.intent = treeState.initialized ? 'manual' : treeState.intent;
  $('#drawer').hidden = true;
  $('#drawer-resizer').hidden = true;
  $('#workspace').classList.remove('has-drawer');
  if (lastFocus?.isConnected) lastFocus.focus({
    preventScroll: true
  });
  else $('#map').focus({
    preventScroll: true
  });
}

function deselect() {
  state.selected = null;
  state.family = null;
  state.locatedContext = null;
  lastFocus = null;
  closeDrawer();
  clearRelationHighlight();
  renderGraph();
  paint();
}

function locatePerson(id = state.selected) {
  let os = [...occurrences.values()].filter(o => o.id === id);
  state.locatedContext = null;
  if (!os.length) {
    const p = people.get(id),
      counterpart = model.people.find(q => q.record_matches.includes(id) && [...occurrences.values()].some(o => o.id === q.id)) || model.people.find(q => p?.record_matches.includes(q.id) && [...occurrences.values()].some(o => o.id === q.id));
    if (!counterpart) {
      $('#relationship-status').textContent = 'Отдельная исследовательская запись вне семейной схемы; связи и источники находятся в досье';
      $('#relationship-status').hidden = false;
      return;
    }
    state.locatedContext = counterpart.id;
    os = [...occurrences.values()].filter(o => o.id === counterpart.id);
    $('#relationship-status').textContent = `Контекст записи ${id}: ${counterpart.name} · не тождество, не перенос сведений`;
    $('#relationship-status').hidden = false;
    for (const n of document.querySelectorAll('.person')) n.classList.toggle('record-context', n.dataset.personNode === counterpart.id);
  }
  let o = os.find(o => state.visible.includes(o.family) && o.family === state.family) || os.find(o => state.visible.includes(o.family)) || os[0];
  if (!state.visible.includes(o.family)) {
    showTree();
    o = os[0];
  }
  state.family = o.family;
  commit(innerWidth <= 760 ? .85 : 1, o.x + 120, o.y + 105, 'manual');
}
const sectionNames = {
  overview: 'Главное',
  family: 'Семья и связи',
  life: 'Жизнь и свидетельства',
  materials: 'Исторические материалы',
  uncertainties: 'Неясности и сопоставления',
  sources: 'Источники'
};

function profileSection(key, content, attributes = '') {
  return content ? `<section id="profile-${key}" data-profile-section="${key}" tabindex="-1" ${attributes}><h2>${sectionNames[key]}</h2>${content}</section>` : '';
}

function profileNavigation(sections) {
  return `<nav class="profile-nav" aria-label="Разделы досье">${sections.map(key=>`<button data-section-target="${key}"${key==='overview'?' aria-current="location"':''}>${{overview:'Главное',family:'Семья',life:'Жизнь',materials:'Материалы',uncertainties:'Неясности',sources:'Источники'}[key]}</button>`).join('')}</nav>`;
}

function scrollDossier(target) {
  const el = typeof target === 'string' ? document.getElementById('profile-' + target) : target;
  if (!el) return;
  const drawer = $('#drawer'),
    offset = $('.drawer-top').offsetHeight + ($('.profile-nav')?.offsetHeight || 0) + 14;
  drawer.scrollTop += el.getBoundingClientRect().top - drawer.getBoundingClientRect().top - offset;
  el.focus({
    preventScroll: true
  });
  for (const b of document.querySelectorAll('[data-section-target]')) b.setAttribute('aria-current', b.dataset.sectionTarget === el.dataset.profileSection ? 'location' : 'false');
}

function personProvenance(p) {
  const own = p.source_ids.map(id => sources.get(id)).filter(Boolean);
  return own.some(s => s.kind === 'family-testimony') ? 'По рассказам семьи' : own.some(s => s.kind === 'family-forum') ? 'Публикация другого исследователя' : 'Отдельная историческая запись';
}

function noteFacts(p) {
  const correction = model.presentation?.person_notes?.[p.id],
    note = correction?.text || p.note;
  if (!note.trim() || [p.birth, p.dates].includes(note.trim())) return '';
  const key = s => s.trim().replace(/[.!?]+$/u, '').toLocaleLowerCase('ru');
  const alreadyShown = [p.role, p.birth, p.dates].filter(Boolean).map(key);
  const facts = note.trim().split(/\n+|;\s*|(?<=[.!?])\s+(?=[А-ЯЁ«])/u).map(t => t.trim()).filter(t => t && !alreadyShown.includes(key(t)));
  if (!facts.length) return '';
  return `<div data-own-note="${p.id}"><ul class="life-facts">${facts.slice(0,4).map(t=>`<li>${esc(t)}</li>`).join('')}</ul>${facts.length>4||note.length>650?`<details class="full-person-note"><summary>Ещё · полная запись без сокращений</summary><p class="original-text">${esc(note)}</p></details>`:''}${correction?`<small>Последнее уточнение пользователя · <span class="reference-id">${esc(correction.basis)}</span></small><details><summary>Предыдущая запись до уточнения</summary><p class="original-text">${esc(p.note)}</p></details>`:''}</div>`;
}

function sourceReference(s) {
  return `<button class="material-link" data-source-jump="${esc(s.id)}"><span>${esc(sourceTitle(s))}</span><small>${esc(sourceKind(s))}</small></button>`;
}

function personMaterials(p) {
  const own = evidence(p.id),
    docs = model.documents.map((d, index) => ({
      ...d,
      index
    })).filter(d => d.person_id === p.id);
  const candidates = comparisonIDs(p).map(id => people.get(id)).filter(q => {
    const e = evidence(q.id);
    return e.historical.length || e.document;
  });
  if (!own.historical.length && !docs.length && !candidates.length) return '';
  let html = own.historical.length || docs.length ? `<div data-own-materials><h3>Материалы этой записи</h3>${p.kind==='record'?'<p class="qualification">Принадлежат этой найденной записи, не подтверждают её тождество родственнику</p>':''}${own.historical.map(sourceReference).join('')}${docs.length?`<p>Два представления одного донесения, не два независимых документа</p>${docs.map(d=>`<button class="material-link" data-document="${d.index}">${esc(d.title)}<small>${esc(d.status)} · ${esc(d.caption)}</small></button>`).join('')}`:''}</div>` : '';
  if (candidates.length) html += `<div data-candidate-materials><h3>Возможные материалы</h3><p class="qualification">Есть записи для сопоставления. Это не собственные документы выбранного человека; тождество не установлено</p>${candidates.map(q=>`<button class="material-link possible" data-open-person="${q.id}" data-person-section="materials">${esc(q.name)}${q.dates?` · ${esc(q.dates)}`:''}<small>Открыть отдельную запись и её материалы <span class="reference-id">${q.id}</span></small></button>`).join('')}</div>`;
  return html;
}

function showPerson(id, locate = true) {
  const p = people.get(id);
  if (!p) return;
  state.locatedContext = null;
  clearRelationHighlight();
  state.selected = id;
  const own = p.source_ids.map(sid => sources.get(sid)).filter(Boolean),
    sections = [];
  const facts = [
    ['Рождение', p.birth],
    ['Смерть / судьба', p.death],
    ['Места', p.place],
    ['Роль', p.role]
  ].filter(([, v]) => v);
  sections.push(['overview', `<dl class="key-facts">${facts.map(([k,v])=>`<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>${p.place?`<small>${p.kind==='family'?'Роль места, если не подписана, не уточнена: рождение и проживание не подменяются друг другом':'География сохраняет формулировку найденной записи'}</small>`:''}${nationality(p)}${explicitSex(p)?`<details class="sex-basis"><summary>Пол · основание в записи</summary><p>${esc(explicitSex(p).basis)}</p></details>`:''}`]);
  const groups = model.families.filter(f => [...f.parents, ...f.children, ...f.peers, ...f.related.map(r => r.person_id)].includes(id));
  const relationships = familySection(p).replace(/^<section data-relationships><h2>Семья и связи<\/h2>|<\/section>$/g, '');
  const graphGroups = groups.length ? `<details class="tree-placements"><summary>Семейные области в дереве · ${groups.length}</summary>${groups.map(f=>`<h3>${esc(f.title)}</h3><div class="toolbar"><button data-focus-family="${f.id}">Показать семью</button><button data-subtree="${f.id}" data-direction="ancestors">Предки семьи</button><button data-subtree="${f.id}" data-direction="descendants">Потомки семьи</button></div>`).join('')}</details>` : '';
  if (relationships || graphGroups) sections.push(['family', relationships + graphGroups, 'data-relationships']);
  const note = noteFacts(p);
  if (note) sections.push(['life', `<p class="section-provenance">${personProvenance(p)}</p>${note}`, 'data-testimony']);
  const materials = personMaterials(p);
  if (materials) sections.push(['materials', materials]);
  const uncertainty = compare(p) + (p.origin_story ? `<h3>Семейная версия происхождения</h3><p>${esc(p.origin_story.origin_story)}</p><small>${esc(p.origin_story.note||'')}</small>` : '');
  if (uncertainty) sections.push(['uncertainties', uncertainty]);
  sections.push(['sources', own.map(sourceCard).join('') || '<p>Источник в этой записи не указан</p>']);
  const html = `<article data-person-detail="${id}"><header class="profile-header">${statusStrip(id)}<p class="role">${personProvenance(p)}</p><h1>${esc(p.name)}</h1>${p.dates?`<p class="lifedates">${esc(p.dates)}</p>`:''}<small class="reference-id">${id}</small></header>${profileNavigation(sections.map(([key])=>key))}${sections.map(([key,body,attrs])=>profileSection(key,body,attrs)).join('')}</article>`;
  openDrawer(p.kind === 'family' ? 'Человек семьи' : 'Отдельная запись', html);
  renderGraph();
  paint();
  if (locate) requestAnimationFrame(() => {
    if (state.selected === id) locatePerson(id);
  });
}

function familyDossier(id) {
  const f = families.get(id);
  if (!f) return;
  state.family = id;
  state.selected = null;
  state.locatedContext = null;
  clearRelationHighlight();
  const groups = [
    ['parents', 'Родители', f.parents],
    ['children', 'Дети', f.children],
    ['other', 'Другие родственники и связанные записи', [...f.peers, ...f.related.map(r => r.person_id)]]
  ];
  const members = groups.filter(([, , ids]) => ids.length).map(([key, title, ids]) => `<div data-family-group="${key}"><h3>${title}</h3>${ids.map(pid=>{
    const p=people.get(pid),related=f.related.find(r=>r.person_id===pid);
    return `<button class="relation" data-open-person="${pid}">${esc(p.name)}<small>${[p.dates,related?.label].filter(Boolean).map(esc).join(' · ')}</small></button>`;
  }).join('')}</div>`).join('');
  const sections = [
    ['overview', `<p>${esc(f.caption)}</p>${f.note?`<p>${esc(f.note)}</p>`:''}<div class="toolbar"><button data-subtree="${id}" data-direction="ancestors">Предки</button><button data-subtree="${id}" data-direction="descendants">Потомки</button></div>`],
    ['family', members]
  ];
  if (f.link_note) sections.push(['uncertainties', `<p class="possible">${esc(f.link_note)}</p>`]);
  sections.push(['sources', f.source_ids.map(s => sources.get(s)).filter(Boolean).map(sourceCard).join('')]);
  openDrawer(f.status === 'hypothesis' ? 'Гипотеза семьи' : 'Семейная область', `<article data-family-detail="${id}"><h1>${esc(f.title)}</h1>${f.status==='hypothesis'?'<p class="qualification">Условная семейная группа, родство с пользователем не установлено</p>':''}${profileNavigation(sections.map(([key])=>key))}${sections.map(([key,content])=>profileSection(key,content)).join('')}</article>`);
  renderGraph();
  paint();
}

function openDocument(index) {
  const d = model.documents[index];
  if (!d) return;
  $('#doc-title').textContent = d.title;
  $('#doc-content').innerHTML = `<p>${esc(d.status)} · ${esc(d.person_id)} · принадлежность семье не установлена</p><img src="${esc(d.data_uri)}" alt="${esc(d.alt)}"><p>${esc(d.caption)}</p>${sourceLink(d.source_url)}`;
  $('#document').showModal();
}

function search(query, all = false) {
  const q = query.trim().toLocaleLowerCase('ru');
  const result = model.people.filter(p => all || q && [p.name, p.place, p.id, p.dates].join(' ').toLocaleLowerCase('ru').includes(q));
  $('#results').hidden = !q && !all;
  $('#results').innerHTML = result.length ? result.map(p => `<button data-search-person="${p.id}">${esc(p.name)}<small>${esc(p.dates)} · ${esc(p.role)} · ${p.id}${p.place?' · '+esc(p.place):''}</small><small>${p.kind==='record'?'Отдельная запись для проверки':'Семейный рассказ'} · Досье и положение в дереве</small></button>`).join('') : '<p>Совпадений нет</p>';
}
$('#search').addEventListener('input', e => search(e.target.value));
document.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.selectPerson) {
    showPerson(b.dataset.selectPerson, false);
    return;
  }
  if (b.dataset.statusPerson) {
    const id = b.dataset.statusPerson,
      key = b.dataset.statusTarget;
    if ($('#drawer').hidden || state.selected !== id || !document.querySelector(`[data-person-detail="${id}"]`)) showPerson(id, false);
    if (key === 'overview') {
      $('#drawer').scrollTop = 0;
    } else scrollDossier(document.getElementById("profile-" + key) ? key : "overview");
    return;
  }
  if (b.dataset.inspectRelation) {
    showRelation(b.dataset.inspectRelation);
    return;
  }
  if (b.dataset.sectionTarget) {
    scrollDossier(b.dataset.sectionTarget);
    return;
  }
  if (b.dataset.sourceJump) {
    scrollDossier([...document.querySelectorAll('[data-source-id]')].find(n => n.dataset.sourceId === b.dataset.sourceJump));
    return;
  }
  if (b.dataset.openPerson) {
    showPerson(b.dataset.openPerson, !b.dataset.personSection);
    if (b.dataset.personSection) scrollDossier(b.dataset.personSection);
    return;
  }
  if (b.dataset.searchPerson) {
    $('#results').hidden = true;
    showPerson(b.dataset.searchPerson);
    return;
  }
  if (b.dataset.openFamily) {
    showFamily(b.dataset.openFamily);
    familyDossier(b.dataset.openFamily);
    return;
  }
  if (b.dataset.focusFamily) {
    closeDrawer();
    focusFamily(b.dataset.focusFamily);
    return;
  }
  if (b.dataset.subtree) {
    closeDrawer();
    showFamily(b.dataset.subtree, b.dataset.direction);
    return;
  }
  if (b.dataset.branch) {
    closeDrawer();
    showTree(b.dataset.branch);
    return;
  }
  if (b.dataset.document !== undefined) {
    openDocument(+b.dataset.document);
    return;
  }
  const a = b.dataset.action;
  if (a === 'menu') {
    $('nav').classList.toggle('mobile-open');
    b.setAttribute('aria-expanded', String($('nav').classList.contains('mobile-open')));
    return;
  }
  if (b.closest('nav')) {
    $('nav').classList.remove('mobile-open');
    $('[data-action="menu"]').setAttribute('aria-expanded', 'false');
  }
  if (a === 'close') closeDrawer();
  else if (a === 'close-document') $('#document').close();
  else if (a === 'locate') locatePerson();
  else if (a === 'all') {
    closeDrawer();
    showTree();
  } else if (a === 'home') {
    if (state.mode !== 'all') showTree();
    focusFamily('F-home');
  } else if (a === 'fit') fitTree();
  else if (a === 'plus') zoomAt(1.3);
  else if (a === 'minus') zoomAt(1 / 1.3);
  else if (a === 'legend') $('#legend').hidden = !$('#legend').hidden;
  else if (a === 'people') {
    search('', true);
    $('#search').focus();
  } else if (a === 'materials') {
    state.selected = null;
    openDrawer('Все источники', `<h1>Материалы</h1><p>${model.sources.length} источника. Индексы, цифровые копии, каталоги и семейные свидетельства не равны независимым доказательствам родства</p>${model.sources.map(sourceCard).join('')}<section><h2>Локальные копии</h2>${model.documents.map((d,i)=>`<button data-document="${i}">${esc(d.title)} · ${d.person_id}</button>`).join('')}</section>`);
  } else if (a === 'testimony' || a === 'historical') {
    state.highlight = state.highlight === a ? null : a;
    $('#map').classList.toggle('testimony-highlight', state.highlight === 'testimony');
    $('#map').classList.toggle('historical-highlight', state.highlight === 'historical');
    for (const el of document.querySelectorAll('.provenance')) el.setAttribute('aria-pressed', String(el.dataset.action === state.highlight));
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    e.preventDefault();
    if ($('#document').open) $('#document').close();
    else if (!$('#results').hidden) $('#results').hidden = true;
    else if (!$('#legend').hidden) $('#legend').hidden = true;
    else if ($('nav').classList.contains('mobile-open')) {
      $('nav').classList.remove('mobile-open');
      $('[data-action="menu"]').setAttribute('aria-expanded', 'false');
    } else deselect();
  }
  if (e.key === '/' && e.target.tagName !== 'INPUT') {
    e.preventDefault();
    $('#search').focus();
  }
});
Object.assign(window.familyAtlas, {
  showPerson,
  locatePerson,
  closeDrawer,
  deselect,
  drawerSize,
  drawerLimits,
  syncDrawerSize,
  resizeDrawer,
  safeURL,
  openDocument,
  parentRole,
  showRelation,
  highlightRelation
});

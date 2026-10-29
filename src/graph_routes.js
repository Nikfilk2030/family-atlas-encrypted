/* Route each semantic layer against its actual painted cards. Identity is not parentage. */
(() => {
  'use strict';
  const cache = new Map(),
    overviewCache = new Map();
  const inside = (p, r) => p.x > r.x + .001 && p.x < r.x + r.w - .001 && p.y > r.y + .001 && p.y < r.y + r.h - .001;
  const padded = (r, n) => ({
    x: r.x - n,
    y: r.y - n,
    w: r.w + 2 * n,
    h: r.h + 2 * n
  });

  function clear(l, r, obstacles) {
    if (l.x === r.x) return !obstacles.some(o => l.x > o.x + .001 && l.x < o.x + o.w - .001 && Math.max(l.y, r.y) > o.y + .001 && Math.min(l.y, r.y) < o.y + o.h - .001);
    return !obstacles.some(o => l.y > o.y + .001 && l.y < o.y + o.h - .001 && Math.max(l.x, r.x) > o.x + .001 && Math.min(l.x, r.x) < o.x + o.w - .001);
  }

  function route(start, end, obstacles) {
    const xs = [...new Set([start.x, end.x, ...obstacles.flatMap(o => [o.x, o.x + o.w])])].sort((a, b) => a - b),
      ys = [...new Set([start.y, end.y, ...obstacles.flatMap(o => [o.y, o.y + o.h])])].sort((a, b) => a - b);
    const width = xs.length,
      idx = (x, y) => y * width + x,
      point = i => ({
        x: xs[i % width],
        y: ys[Math.floor(i / width)]
      });
    const first = idx(xs.indexOf(start.x), ys.indexOf(start.y)),
      last = idx(xs.indexOf(end.x), ys.indexOf(end.y));
    // Position + arrival direction is the state when turns have a cost.
    const initial = first * 3,
      dist = new Map([
        [initial, 0]
      ]),
      previous = new Map(),
      heap = [],
      valid = new Map(),
      links = new Map();
    const allowed = i => {
      if (!valid.has(i)) valid.set(i, !obstacles.some(o => inside(point(i), o)));
      return valid.get(i);
    };
    const push = (id, cost) => {
      const e = {
        id,
        cost
      };
      heap.push(e);
      let i = heap.length - 1;
      while (i) {
        const p = (i - 1) >> 1;
        if (heap[p].cost <= cost) break;
        heap[i] = heap[p];
        i = p;
      }
      heap[i] = e;
    };
    const pop = () => {
      const out = heap[0],
        e = heap.pop();
      if (heap.length) {
        let i = 0;
        while (i * 2 + 1 < heap.length) {
          let j = i * 2 + 1;
          if (j + 1 < heap.length && heap[j + 1].cost < heap[j].cost) j++;
          if (heap[j].cost >= e.cost) break;
          heap[i] = heap[j];
          i = j;
        }
        heap[i] = e;
      }
      return out;
    };
    const heuristic = p => Math.abs(p.x - end.x) + Math.abs(p.y - end.y);
    push(initial, heuristic(start));
    const visited = new Set();
    let final = null;
    while (heap.length) {
      const state = pop().id;
      if (visited.has(state)) continue;
      visited.add(state);
      const id = Math.floor(state / 3),
        direction = state % 3;
      if (id === last) {
        final = state;
        break;
      }
      const p = point(id),
        x = id % width,
        y = Math.floor(id / width);
      for (const n of [x ? id - 1 : -1, x + 1 < width ? id + 1 : -1, y ? id - width : -1, y + 1 < ys.length ? id + width : -1]) {
        if (n < 0 || !allowed(n)) continue;
        const q = point(n),
          nextDirection = p.x === q.x ? 2 : 1,
          next = n * 3 + nextDirection;
        if (visited.has(next)) continue;
        const key = Math.min(id, n) + ':' + Math.max(id, n);
        if (!links.has(key)) links.set(key, clear(p, q, obstacles));
        if (!links.get(key)) continue;
        const cost = dist.get(state) + Math.abs(p.x - q.x) + Math.abs(p.y - q.y) + (direction && direction !== nextDirection ? 28 : 0);
        if (cost < (dist.get(next) ?? Infinity)) {
          dist.set(next, cost);
          previous.set(next, state);
          push(next, cost + heuristic(q));
        }
      }
    }
    if (final === null) return null;
    const points = [];
    let state = final;
    for (;;) {
      points.push(point(Math.floor(state / 3)));
      if (state === initial) break;
      state = previous.get(state);
    }
    points.reverse();
    return points.filter((p, i) => i === 0 || i === points.length - 1 || !((points[i - 1].x === p.x && p.x === points[i + 1].x) || (points[i - 1].y === p.y && p.y === points[i + 1].y)));
  }

  function path(points) {
    if (!points?.length) return '';
    let d = `M${points[0].x},${points[0].y}`;
    for (let i = 1; i < points.length - 1; i++) {
      const a = points[i - 1],
        b = points[i],
        c = points[i + 1],
        la = Math.hypot(b.x - a.x, b.y - a.y),
        lb = Math.hypot(c.x - b.x, c.y - b.y),
        r = Math.min(14, la / 2, lb / 2);
      if (!la || !lb) continue;
      const p = {
          x: b.x - (b.x - a.x) / la * r,
          y: b.y - (b.y - a.y) / la * r
        },
        q = {
          x: b.x + (c.x - b.x) / lb * r,
          y: b.y + (c.y - b.y) / lb * r
        };
      d += ` L${p.x},${p.y} Q${b.x},${b.y} ${q.x},${q.y}`;
    }
    const z = points[points.length - 1];
    return d + ` L${z.x},${z.y}`;
  }
  const center = r => ({
    x: r.x + r.w / 2,
    y: r.y + r.h / 2
  });

  function sides(l, r) {
    if (r.y >= l.y + l.h - .01) return ['bottom', 'top'];
    if (l.y >= r.y + r.h - .01) return ['top', 'bottom'];
    return center(r).x >= center(l).x ? ['right', 'left'] : ['left', 'right'];
  }

  function portal(frame, side, fraction, offset) {
    const horizontal = side === 'top' || side === 'bottom',
      p = horizontal ? {
        x: frame.x + frame.w * fraction,
        y: frame.y + (side === 'bottom' ? frame.h : 0)
      } : {
        x: frame.x + (side === 'right' ? frame.w : 0),
        y: frame.y + frame.h * fraction
      };
    const n = {
      x: side === 'right' ? 1 : side === 'left' ? -1 : 0,
      y: side === 'bottom' ? 1 : side === 'top' ? -1 : 0
    };
    return {
      p,
      q: {
        x: p.x + n.x * offset,
        y: p.y + n.y * offset
      }
    };
  }

  function localCurve(start, end, out, into, frames, edge) {
    if (!((out === 'bottom' && into === 'top' && end.y > start.y) || (out === 'top' && into === 'bottom' && end.y < start.y))) return null;
    const c = {
        x: start.x,
        y: (start.y + end.y) / 2
      },
      d = {
        x: end.x,
        y: (start.y + end.y) / 2
      },
      obstacles = [...frames].filter(([id]) => id !== edge.from && id !== edge.to).map(([, r]) => padded(r, 22));
    for (let i = 1; i < 128; i++) {
      const t = i / 128,
        u = 1 - t,
        p = {
          x: u * u * u * start.x + 3 * u * u * t * c.x + 3 * u * t * t * d.x + t * t * t * end.x,
          y: u * u * u * start.y + 3 * u * u * t * c.y + 3 * u * t * t * d.y + t * t * t * end.y
        };
      if (obstacles.some(r => inside(p, r))) return null;
    }
    return `M${start.x},${start.y} C${c.x},${c.y} ${d.x},${d.y} ${end.x},${end.y}`;
  }

  function overviewRoutes(frames, edges) {
    const active = edges.filter(e => frames.has(e.from) && frames.has(e.to)),
      key = JSON.stringify([
        [...frames], active.map(e => [e.from, e.to])
      ]);
    if (overviewCache.has(key)) return overviewCache.get(key);
    const result = new Map(),
      plans = active.map(e => {
        const l = frames.get(e.from),
          r = frames.get(e.to),
          [out, into] = sides(l, r);
        return {
          e,
          l,
          r,
          out,
          into
        };
      });

    function fraction(plan, end) {
      const id = end === 'out' ? plan.e.from : plan.e.to,
        side = plan[end],
        group = plans.filter(p => (end === 'out' ? p.e.from : p.e.to) === id && p[end] === side).sort((a, b) => {
          const aa = center(end === 'out' ? a.r : a.l),
            bb = center(end === 'out' ? b.r : b.l);
          return (side === 'top' || side === 'bottom' ? aa.x - bb.x : aa.y - bb.y) || a.e.from.localeCompare(b.e.from) || a.e.to.localeCompare(b.e.to);
        });
      return (group.indexOf(plan) + 1) / (group.length + 1);
    }
    for (const plan of plans) {
      const {
        e,
        l,
        r,
        out,
        into
      } = plan, start = portal(l, out, fraction(plan, 'out'), 38), end = portal(r, into, fraction(plan, 'into'), 38);
      const smooth = localCurve(start.p, end.p, out, into, frames, e);
      if (smooth) {
        result.set(e.from + ':' + e.to, smooth);
        continue;
      }
      const middle = route(start.q, end.q, [...frames.values()].map(r => padded(r, 22)));
      result.set(e.from + ':' + e.to, middle ? path([start.p, ...middle, end.p]) : '');
    }
    overviewCache.clear();
    overviewCache.set(key, result);
    return result;
  }

  function routes(boxes, occurrences, edges) {
    const key = JSON.stringify([...boxes]);
    if (cache.has(key)) return cache.get(key);
    const frames = new Map([...boxes].map(([id, b]) => [id, {
      x: b.x + (b.w - b.innerW) / 2,
      y: b.y,
      w: b.innerW,
      h: b.h
    }]));
    const fallback = overviewRoutes(new Map([...boxes].map(([id, b]) => [id, {
        x: b.x,
        y: b.y,
        w: b.w,
        h: b.h
      }])), edges),
      result = new Map();
    edges.forEach((e, i) => {
      const l = frames.get(e.from),
        r = frames.get(e.to),
        id = e.through_person_id,
        other = [...frames].filter(([id]) => id !== e.from && id !== e.to).map(([, b]) => padded(b, 22 + (i % 3) * 6));
      const source = occurrences.get(e.from + ':' + id),
        target = occurrences.get(e.to + ':' + id);
      let detail = null;
      if (source && target) {
        const forward = r.x + r.w / 2 >= l.x + l.w / 2,
          start = {
            x: source.x + (forward ? source.w : 0),
            y: source.y + source.h / 2
          },
          end = {
            x: target.x + (forward ? 0 : target.w),
            y: target.y + target.h / 2
          };
        const ownCards = [...occurrences.values()].filter(o => o.family === e.from || o.family === e.to).map(o => o.id === id ? o : padded(o, 12)),
          headings = [l, r].map(b => ({
            x: b.x + 12,
            y: b.y + 4,
            w: b.w - 24,
            h: 48
          }));
        const contextLabels = [...occurrences.values()].filter(o => (o.related || o.peer) && (o.family === e.from || o.family === e.to)).map(o => padded({
          x: o.x,
          y: o.y + (o.related ? -26 : 216),
          w: o.w,
          h: 24
        }, 5));
        detail = route(start, end, [...other, ...ownCards, ...headings, ...contextLabels]);
      }
      result.set(e.from + ':' + e.to, {
        overview: fallback.get(e.from + ':' + e.to),
        detail: path(detail),
        source: id,
        target: id,
        unrouted: !fallback.get(e.from + ':' + e.to) || !detail
      });
    });
    if (cache.size > 3) cache.clear();
    cache.set(key, result);
    return result;
  }
  const personCache = new Map();

  function personRoute(l, r, boxes, occurrences) {
    const frame = boxes.get(l.family),
      own = [...occurrences.values()].filter(o => o.family === l.family),
      key = JSON.stringify([l.family, l.id, r.id, frame, own]);
    if (personCache.has(key)) return personCache.get(key);
    const down = r.y > l.y,
      vertical = l.x === r.x,
      start = vertical ? {
        x: l.x + l.w / 2,
        y: l.y + (down ? l.h : 0)
      } : {
        x: l.x + (r.x > l.x ? l.w : 0),
        y: l.y + l.h / 2
      },
      end = vertical ? {
        x: r.x + r.w / 2,
        y: r.y + (down ? 0 : r.h)
      } : {
        x: r.x + (r.x > l.x ? 0 : r.w),
        y: r.y + r.h / 2
      };
    const cards = own.map(o => [l.id, r.id].includes(o.id) ? o : padded(o, 10)),
      x = frame.x,
      y = frame.y,
      w = frame.w,
      h = frame.h,
      far = 20000;
    const walls = [{
        x: x - far,
        y: y - far,
        w: w + 2 * far,
        h: far
      }, {
        x: x - far,
        y: y + h,
        w: w + 2 * far,
        h: far
      }, {
        x: x - far,
        y,
        w: far,
        h
      }, {
        x: x + w,
        y,
        w: far,
        h
      }],
      labels = own.filter(o => o.related).map(o => padded({
        x: o.x,
        y: o.y - 26,
        w: o.w,
        h: 24
      }, 4));
    const points = route(start, end, [...cards, ...walls, ...labels, {
        x: x + 8,
        y: y + 2,
        w: w - 16,
        h: 106
      }]),
      d = path(points);
    personCache.set(key, d);
    return d;
  }
  window.atlasRouter = {
    routes,
    personRoute,
    overviewRoutes
  };
})();

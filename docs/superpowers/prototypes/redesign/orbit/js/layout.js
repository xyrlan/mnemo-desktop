/* Orbit · geometry. Pure functions: the window's ellipse, where each project's sector and
   each body's ray fall, and where every label goes so that none collides or clips. */
(function () {
  "use strict";
  const O = window.O;
  const TAU = Math.PI * 2;

  /** The scene's frame for a window size. `u` scales geometry, `fs` scales type (it shrinks
      less than geometry does, so a 1366-wide window still reads). */
  O.geom = function (W, H) {
    const u = O.clamp(Math.min(W / 2560, H / 1440), 0.5, 1.25);
    const fs = 0.55 + 0.45 * u;
    const top = Math.round(26 + 52 * u);
    const bottom = Math.round(14 + 22 * u);
    const cy = top + (H - top - bottom) / 2;
    let ry = (H - top - bottom) / 2 - (16 + 26 * u);
    let rx = W / 2 - (22 + 44 * u);
    rx = Math.min(rx, ry * 2.05);
    ry = Math.min(ry, rx);
    return { W, H, u, fs, top, bottom, cx: W / 2, cy, rx, ry, k: ry / rx };
  };

  O.labw = (g) => O.clamp(340 * g.fs, 180, 360);
  O.pt = (g, rho, th) => ({ x: g.cx + g.rx * rho * Math.cos(th), y: g.cy + g.ry * rho * Math.sin(th) });

  /** Give every project a sector and every body a ray.
      A label of w×h needs less angle where the orbit runs vertically (the sides) than where
      it runs flat (top and bottom), so angle is handed out by that capacity: the largest
      project takes the right side, the second the left, the rest alternate below and above.
      A body keeps its ray whatever its state; only its distance changes. */
  O.assignAngles = function (m, g, w, h) {
    const N = 720;
    const cap = [];
    let mean = 0;
    for (let i = 0; i < N; i++) {
      const th = ((i + 0.5) / N) * TAU;
      const f = Math.max((g.rx * Math.abs(Math.sin(th))) / w, (g.ry * Math.abs(Math.cos(th))) / h);
      cap.push(f);
      mean += f / N;
    }
    const cum = [0];
    for (let i = 0; i < N; i++) cum.push(cum[i] + 0.45 * mean + 0.55 * cap[i]);
    const total = cum[N];
    const angleAt = (frac) => {
      const target = (((frac % 1) + 1) % 1) * total;
      let lo = 0, hi = N;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (cum[mid] <= target) lo = mid; else hi = mid;
      }
      return ((lo + (target - cum[lo]) / (cum[lo + 1] - cum[lo])) / N) * TAU;
    };

    const ps = m.projects;
    const seq = [ps[0]];
    for (let i = 2; i < ps.length; i += 2) seq.push(ps[i]);
    if (ps[1]) seq.push(ps[1]);
    const tops = [];
    for (let i = 3; i < ps.length; i += 2) tops.push(ps[i]);
    seq.push(...tops.reverse());

    const n = m.bodies.length;
    let at = -seq[0].bodies.length / 2;      // the first project straddles the right side
    const sectors = [];
    for (const p of seq) {
      const from = at;
      p.bodies.forEach((b, i) => { b.theta = angleAt((from + i + 0.5) / n); });
      at += p.bodies.length;
      sectors.push({ name: p.name, n: p.bodies.length, a0: angleAt(from / n), a1: angleAt(at / n), mid: angleAt((from + at) / 2 / n), whole: seq.length === 1 });
    }
    return sectors;
  };

  /* ---------- labels ---------- */
  const area = (a, b) => {
    const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
    const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
    return w > 0 && h > 0 ? w * h : 0;
  };
  O.overlap = area;

  function candidates(it, gap) {
    const out = [];
    const { x, y, fx, fy, w, h } = it;
    const push = (x0, y0, align, side, shift) => out.push({ x0, y0, x1: x0 + w, y1: y0 + h, align, side, shift });
    for (const gp of gap) {
      for (const sh of [0, -0.5, 0.5, -1, 1, -1.6, 1.6, -2.3, 2.3]) {
        push(x + fx + gp, y - h / 2 + sh * h, "l", "E", Math.abs(sh));
        push(x - fx - gp - w, y - h / 2 + sh * h, "r", "W", Math.abs(sh));
      }
      for (const sh of [0, -0.3, 0.3, -0.5, 0.5]) {
        push(x - w / 2 + sh * w, y - fy - gp - h, sh < 0 ? "r" : sh > 0 ? "l" : "c", "N", Math.abs(sh) * 2);
        push(x - w / 2 + sh * w, y + fy + gp, sh < 0 ? "r" : sh > 0 ? "l" : "c", "S", Math.abs(sh) * 2);
      }
    }
    return out;
  }

  /** Place one label per item. `items`: {id, x, y, fx, fy (the body's footprint half-sizes),
      w, h, prio, pref}. `fixed`: rectangles to keep off (weight per rect). `B`: the bounds.
      Greedy by priority, then a few sweeps where each label may move given all the others. */
  O.solveLabels = function (items, fixed, B, fs) {
    const gap = [9, 22, 46, 80, 124].map((v) => v * fs);
    const foot = items.map((it) => ({ id: it.id, x: it.x, y: it.y, x0: it.x - it.fx, y0: it.y - it.fy, x1: it.x + it.fx, y1: it.y + it.fy }));
    const cands = {};
    for (const it of items) cands[it.id] = candidates(it, gap);
    const reach = (c, x, y) => Math.hypot(Math.max(c.x0 - x, 0, x - c.x1), Math.max(c.y0 - y, 0, y - c.y1));
    let placed;
    const cost = (it, c) => {
      let k = 0;
      const out = Math.max(0, B.x0 - c.x0) + Math.max(0, c.x1 - B.x1) + Math.max(0, B.y0 - c.y0) + Math.max(0, c.y1 - B.y1);
      if (out > 0) k += 1e5 + out * 100;
      for (const id in placed) {
        if (id === it.id) continue;
        const a = area(c, placed[id]);
        if (a > 0) k += 4000 + a * 3;
      }
      const own = reach(c, it.x, it.y);
      for (const f of foot) {
        if (f.id === it.id) continue;
        const a = area(c, f);
        if (a > 0) k += 3000 + a * 3;
        // a label nearer to another body than to its own would be read as that body's
        else if (reach(c, f.x, f.y) < own + 8) k += 1500;
      }
      for (const f of fixed) {
        const a = area(c, f);
        if (a > 0) k += (f.weight || 1) * (600 + a);
      }
      k += own * 1.4 + c.shift * 6;
      // beside the body reads as its label; above or below is the last resort
      k += c.side === it.pref ? 0 : c.side === "E" || c.side === "W" ? 26 : 70;
      return k;
    };
    const choose = (it) => {
      let best = null, bk = Infinity;
      for (const c of cands[it.id]) {
        const k = cost(it, c);
        if (k < bk) { bk = k; best = c; }
      }
      placed[it.id] = best;
      return bk;
    };
    // A greedy pass depends on who goes first, so several orders are tried and the cheapest
    // whole layout is kept: the bands' order, the window's edges inward, the four sweeps
    // across it, and a few fixed shuffles.
    const mx = (B.x0 + B.x1) / 2;
    const orders = [
      (a, b) => a.prio - b.prio || Math.abs(b.x - mx) - Math.abs(a.x - mx),
      (a, b) => Math.abs(b.x - mx) - Math.abs(a.x - mx),
      (a, b) => Math.abs(a.x - mx) - Math.abs(b.x - mx),
      (a, b) => a.y - b.y, (a, b) => b.y - a.y, (a, b) => a.x - b.x, (a, b) => b.x - a.x,
    ];
    for (let seed = 1; seed <= 5; seed++) {
      const key = {};
      items.forEach((it, i) => { key[it.id] = Math.sin((i + 1) * 12.9898 * seed) * 43758.5453 % 1; });
      orders.push((a, b) => key[a.id] - key[b.id]);
    }
    let best = null, bestCost = Infinity;
    for (const by of orders) {
      placed = {};
      const order = items.slice().sort(by);
      for (const it of order) choose(it);
      let total = 0;
      for (let sweep = 0; sweep < 5; sweep++) { total = 0; for (const it of order) total += choose(it); }
      if (total < bestCost) { bestCost = total; best = placed; }
    }
    return best;
  };

  /** What a reviewer would measure on a screenshot, counted: labels that overlap a label,
      sit on another body, or leave the window. */
  O.checkLabels = function (items, placed, B) {
    const bad = { overlap: 0, onBody: 0, clipped: 0 };
    const ids = Object.keys(placed);
    for (let i = 0; i < ids.length; i++) {
      const a = placed[ids[i]];
      if (a.x0 < B.x0 - 0.5 || a.y0 < B.y0 - 0.5 || a.x1 > B.x1 + 0.5 || a.y1 > B.y1 + 0.5) bad.clipped++;
      for (let j = i + 1; j < ids.length; j++) if (area(a, placed[ids[j]]) > 1) bad.overlap++;
      for (const it of items) {
        if (it.id === ids[i]) continue;
        if (area(a, { x0: it.x - it.core, y0: it.y - it.core, x1: it.x + it.core, y1: it.y + it.core }) > 1) bad.onBody++;
      }
    }
    return bad;
  };
})();

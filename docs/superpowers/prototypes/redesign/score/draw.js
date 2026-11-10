/* The canvases: the score itself, its ruler, the fleet strip above it and the inspector's
   context chart. Every function here draws once and returns; nothing schedules a frame.
   What moves (the playhead, the waiting bands, the pulses) is DOM over the canvas, so a
   replay or an animation never redraws it. */
(function () {
  "use strict";
  const S = window.score;
  const { MIN, HOUR, DAY, BUCKET, fmt } = S;
  const tokens = (n) => window.mnemo.tokens(Math.round(n));

  const ink = (a) => "rgba(255,255,255," + a + ")";
  const HUE = { need: "#ffb020", working: "#7dd3fc", ready: "#34d399", stalled: "#f87171", memory: "#c4b5fd" };
  const FONT = { text: '"Geist", system-ui, sans-serif', display: '"Jura", "Geist", system-ui, sans-serif', mono: '"JetBrains Mono", ui-monospace, monospace' };

  /** Size a canvas for the screen's pixel ratio and return a context in CSS pixels. */
  function fit(canvas, width, height) {
    const ratio = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(width * ratio)), h = Math.max(1, Math.round(height * ratio));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    return ctx;
  }

  /** Where things sit inside a row: the diamond lane, the context curve between `yT` (a full
      window) and `yB` (the line), and the tool lanes under the line. */
  function geom(row) {
    const y = row.y, h = row.h0 || row.h; // h0: the row's height before a pending card opened in it
    if (row.compact) return { yD: y + 6, yT: y + 9, yB: y + 21, lanes: [y + 25], bottom: y + 29, compact: true };
    const yB = y + Math.round(Math.min(h, 84) * 0.64);
    return { yD: y + 9, yT: y + 16, yB, lanes: [yB + 5, yB + 10, yB + 15, yB + 20], bottom: yB + 24, compact: false };
  }

  function diamond(ctx, x, y, r, fill) {
    ctx.beginPath();
    ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y);
    ctx.closePath();
    if (fill) ctx.fill(); else ctx.stroke();
  }
  function cross(ctx, x, y, r) {
    ctx.beginPath();
    ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r);
    ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r);
    ctx.stroke();
  }
  function ring(ctx, x, y, r, fill) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    if (fill) ctx.fill(); else ctx.stroke();
  }
  function triangle(ctx, x, y, r, fill) {
    ctx.beginPath();
    ctx.moveTo(x, y - r); ctx.lineTo(x + r, y + r * 0.8); ctx.lineTo(x - r, y + r * 0.8);
    ctx.closePath();
    if (fill) ctx.fill(); else ctx.stroke();
  }
  /** Text that stays readable over marks: a black edge under white letters. */
  function label(ctx, text, x, y, colour) {
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0,0,0,0.9)";
    ctx.lineJoin = "round";
    ctx.strokeText(text, x, y);
    ctx.fillStyle = colour;
    ctx.fillText(text, x, y);
  }
  const clip = (text, n) => (text.length > n ? text.slice(0, n - 1).trimEnd() + "…" : text);

  /* ---- ticks shared by the ruler and the score's grid ---- */

  function ticks(view, width) {
    const span = view.to - view.from;
    const major = S.step(span, width, 120);
    const minor = [MIN, 5 * MIN, 15 * MIN, 30 * MIN, HOUR, 3 * HOUR, 6 * HOUR, DAY].filter((m) => m < major && major % m === 0 && (m / span) * width >= 12).shift() || major;
    const offset = new Date(view.from).getTimezoneOffset() * MIN; // ticks fall on local clock times
    const list = [];
    for (let t = Math.ceil((view.from - offset) / minor) * minor + offset; t <= view.to; t += minor) {
      const local = t - offset;
      list.push({ t, major: local % major === 0, day: local % DAY === 0 });
    }
    return { list, major, minor };
  }

  function drawRuler(canvas, env) {
    const { W, x, view } = env;
    const H = canvas.clientHeight;
    const ctx = fit(canvas, W, H);
    ctx.font = "600 11px " + FONT.display;
    ctx.textBaseline = "middle";
    ctx.fillStyle = ink(0.12);
    ctx.fillRect(0, H - 1, W, 1);
    for (const tick of ticks(view, W).list) {
      const px = Math.round(x(tick.t)) + 0.5;
      ctx.strokeStyle = ink(tick.day ? 0.8 : tick.major ? 0.4 : 0.16);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px, H - (tick.major ? 9 : 4)); ctx.lineTo(px, H);
      ctx.stroke();
      if (!tick.major) continue;
      const text = tick.day ? fmt.day(tick.t).toUpperCase() : fmt.clock(tick.t);
      if (px + 6 + ctx.measureText(text).width > W - 4) continue;
      ctx.fillStyle = ink(tick.day ? 0.95 : 0.6);
      ctx.fillText(text, px + 6, H / 2 - 1);
    }
  }

  /* ---- the fleet strip ---- */

  function drawStrip(canvas, env) {
    const { W, x, view, data, now } = env;
    const H = canvas.clientHeight;
    const ctx = fit(canvas, W, H);
    const accounts = data.accounts || [];
    const laneH = accounts.length > 3 ? 12 : H < 100 ? 14 : 18;
    const top = 28, bottom = H - 7 - accounts.length * laneH;
    const stepMs = S.step(view.to - view.from, W, 7);
    const fleet = S.fleet(data, view.from, view.to, stepMs, env.pick);
    const barW = Math.max(1, stepMs * env.k - 2);
    let peak = 0;
    for (let i = 0; i < fleet.n; i++) peak = Math.max(peak, fleet.total[i]);

    ctx.fillStyle = ink(0.1);
    ctx.fillRect(0, bottom + 0.5, W, 1);
    if (peak > 0) {
      for (let i = 0; i < fleet.n; i++) {
        const v = fleet.total[i];
        if (!v) continue;
        const px = x((fleet.first + i) * stepMs) + 1;
        const h = Math.max(1.5, (v / peak) * (bottom - top));
        ctx.fillStyle = ink(env.pick ? 0.2 : 0.55);
        ctx.fillRect(px, bottom - h, barW, h);
        if (!env.pick) { ctx.fillStyle = ink(0.95); ctx.fillRect(px, bottom - h, barW, 1.5); }
        const p = fleet.picked[i];
        if (p) { ctx.fillStyle = ink(0.95); ctx.fillRect(px, bottom - Math.max(1.5, (p / peak) * (bottom - top)), barW, Math.max(1.5, (p / peak) * (bottom - top))); }
      }
    }

    // One lane per account: what its sessions spent, under a bracket for its 5-hour window.
    // (A weekly window is longer than this axis; its figure is beside the clock.)
    ctx.textBaseline = "middle";
    accounts.forEach((account, n) => {
      const y = bottom + 5 + n * laneH;
      const used = fleet.accounts[account.id];
      let max = 0;
      for (let i = 0; i < fleet.n; i++) max = Math.max(max, used[i]);
      for (let i = 0; i < fleet.n && max; i++) {
        if (!used[i]) continue;
        ctx.fillStyle = ink(0.14 + 0.5 * (used[i] / max));
        ctx.fillRect(x((fleet.first + i) * stepMs) + 1, y + laneH - 8, barW, 3);
      }
      // the account's name, then its 5-hour window as a bracket with its figure on the line
      const name = String(account.label || account.id || "").toUpperCase();
      const ly = Math.round(y + 3) + 0.5;
      ctx.font = "600 10px " + FONT.display;
      const nameEnd = 12 + ctx.measureText(name).width;
      for (const limit of account.limits || []) {
        const win = S.planWindow(limit);
        if (!win || limit.kind !== "session" || win.to < view.from || win.from > view.to) continue;
        const a = Math.max(-2, x(win.from)), b = Math.min(W + 2, x(Math.min(win.to, now)));
        ctx.strokeStyle = ink(0.5);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(a, ly + 4); ctx.lineTo(a, ly); ctx.lineTo(b, ly);
        if (win.to <= now) ctx.lineTo(b, ly + 4);
        ctx.stroke();
        const at = Math.max(a + 8, nameEnd + 14);
        ctx.font = "600 9px " + FONT.display;
        if (b - at > 170) label(ctx, "5H WINDOW" + (limit.percent == null ? "" : " · " + Math.round(limit.percent) + "% USED") + (win.to <= now ? " · OVER" : ""), at, ly + 0.5, ink(0.62));
        ctx.font = "600 10px " + FONT.display;
      }
      label(ctx, name, 12, ly + 0.5, ink(account.active ? 0.85 : 0.5));
    });
    return { fleet, peak, top, bottom, stepMs };
  }

  /* ---- the score ---- */

  function drawScore(canvas, env) {
    const { W, H, x, view } = env;
    const ctx = fit(canvas, W, H);
    ctx.lineWidth = 1;

    // the ruler's ticks carried down, faint
    for (const tick of ticks(view, W).list) {
      if (!tick.major) continue;
      ctx.fillStyle = ink(tick.day ? 0.14 : 0.045);
      ctx.fillRect(Math.round(x(tick.t)), 0, 1, H);
    }

    ctx.save();
    ctx.translate(0, -env.top);
    const seen = (row) => row.y + row.h >= env.top - 4 && row.y <= env.top + H + 4;

    // branches first, under the lines they join
    for (const row of env.rows) {
      if (row.type === "session" && row.depth > 0) {
        const parent = env.rowOf.get(row.s.parent);
        if (parent && (seen(row) || seen(parent))) branch(ctx, env, geom(parent).yB, geom(row).yB, row.s._.t0, env.sel === row.s.id || env.sel === row.s.parent ? 0.6 : 0.3);
      } else if (row.type === "ensemble") {
        const parent = env.rowOf.get(row.parent.id);
        if (parent && (seen(row) || seen(parent))) {
          row.sessions.forEach((k, i) => { if (k.parent === row.parent.id) branch(ctx, env, geom(parent).yB, row.y + 7 + (i % 3) * 6, k._.t0, 0.16); });
        }
      }
    }

    for (const row of env.rows) {
      if (!seen(row)) continue;
      if (row.type === "group") group(ctx, env, row);
      else if (row.type === "ensemble") ensemble(ctx, env, row);
      else session(ctx, env, row);
    }
    ctx.restore();
  }

  function branch(ctx, env, fromY, toY, t0, alpha) {
    if (t0 == null) return;
    const px = env.x(t0);
    if (px < -20 || px > env.W + 20) return;
    ctx.strokeStyle = ink(alpha);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px, fromY);
    ctx.bezierCurveTo(px, fromY + (toY - fromY) * 0.75, px, toY, px + 12, toY);
    ctx.stroke();
    ctx.fillStyle = ink(alpha + 0.3);
    ring(ctx, px, fromY, 2, true);
  }

  function group(ctx, env, row) {
    const y = Math.round(row.y + row.h / 2) + 0.5;
    ctx.font = "600 11px " + FONT.display;
    ctx.textBaseline = "middle";
    if ("letterSpacing" in ctx) ctx.letterSpacing = "2.4px";
    const name = String(row.project).toUpperCase();
    ctx.fillStyle = ink(0.8);
    ctx.fillText(name, 12, y + 0.5);
    const w = ctx.measureText(name).width;
    if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
    ctx.fillStyle = ink(0.1);
    ctx.fillRect(12 + w + 12, y, env.W - w - 24, 1);
  }

  function ensemble(ctx, env, row) {
    const { x, W, view } = env;
    row.sessions.forEach((k, i) => {
      const d = k._;
      if (d.t0 == null) return;
      const y = row.y + 7 + (i % 3) * 6;
      const a = x(d.t0) + 12, b = x(d.t1);
      if (b < 0 || a > W) return;
      ctx.fillStyle = ink(0.22);
      ctx.fillRect(Math.max(a, 0), y, Math.max(1, Math.min(b, W) - Math.max(a, 0)), 1);
      const bw = Math.max(1, BUCKET * env.k - 0.5);
      for (const bucket of d.buckets) {
        if (bucket.t + BUCKET < view.from || bucket.t > view.to || !bucket.total) continue;
        ctx.fillStyle = ink(0.25 + 0.55 * Math.min(1, bucket.total / 12));
        ctx.fillRect(x(bucket.t), y - 1, bw, 3);
      }
      const merged = env.mergedOf(k);
      ctx.fillStyle = merged ? HUE.ready : ink(0.55);
      ring(ctx, b, y + 0.5, merged ? 2.4 : 1.6, true);
    });
  }

  function session(ctx, env, row) {
    const { x, W, view, now } = env;
    const s = row.s, d = s._;
    const g = geom(row);
    const selected = env.sel === s.id;
    const state = env.stateOf(s);
    ctx.textBaseline = "middle";
    ctx.font = "400 11px " + FONT.text;

    if (d.t0 == null) {
      ctx.fillStyle = ink(0.22);
      ctx.fillText("nothing of it is in the capture", 14 + row.depth * 14, g.yB);
      return;
    }
    const endT = s.live || env.pendOf(s) ? now : d.t1;
    const x0 = x(d.t0) + (row.depth > 0 ? 12 : 0), x1 = x(d.t1), xEnd = x(endT);
    if (xEnd < 0) {
      ctx.fillStyle = ink(0.25);
      ctx.fillText("◂  last active " + fmt.span(now - d.t1) + " ago", 14 + row.depth * 14, g.yB);
      return;
    }
    if (x0 > W) return;
    const left = Math.max(x0, -2), right = Math.min(x1, W + 2);
    const curveH = g.yB - g.yT;
    const yOf = (n) => g.yB - Math.min(1.04, n / d.window) * curveH;

    // the ceiling: a full context window
    ctx.strokeStyle = ink(selected ? 0.3 : 0.09);
    ctx.setLineDash([1, 5]);
    ctx.beginPath();
    ctx.moveTo(left, g.yT + 0.5); ctx.lineTo(Math.min(xEnd, W), g.yT + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);

    // the context: each call's size, held until the next call; a compaction is a cliff
    const pts = d.series;
    if (pts.length) {
      let i = Math.max(0, S.lastAtOrBefore(pts, view.from, (p) => p[0]));
      const path = [];
      let px = Math.max(x(pts[i][0]), -4), py = yOf(pts[i][1]);
      path.push([px, py]);
      for (i += 1; i < pts.length && pts[i][0] <= view.to; i++) {
        const nx = x(pts[i][0]);
        if (nx - px < 0.4 && i + 1 < pts.length) { py = yOf(pts[i][1]); path[path.length - 1][1] = Math.min(path[path.length - 1][1], py); continue; }
        path.push([nx, py]);
        px = nx; py = yOf(pts[i][1]);
        path.push([px, py]);
      }
      const tail = Math.min(i < pts.length ? x(pts[i][0]) : x(endT), W + 2);
      path.push([tail, py]);
      const fill = ctx.createLinearGradient(0, g.yT, 0, g.yB);
      fill.addColorStop(0, ink(selected ? 0.4 : 0.26));
      fill.addColorStop(1, ink(selected ? 0.06 : 0.03));
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.moveTo(path[0][0], g.yB);
      for (const p of path) ctx.lineTo(p[0], p[1]);
      ctx.lineTo(tail, g.yB);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = ink(selected ? 0.95 : 0.7);
      ctx.lineWidth = selected ? 1.4 : 1;
      ctx.shadowColor = "rgba(255,255,255,0.6)"; // the soft glow of the identity, on the one shape that carries a line
      ctx.shadowBlur = (selected ? 14 : 8) * (window.devicePixelRatio || 1);
      ctx.beginPath();
      path.forEach((p, n) => (n ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.stroke();
      ctx.shadowBlur = 0;
      // nearly full is a signal: the top of the curve turns amber above 85%
      const hot = g.yB - 0.85 * curveH;
      ctx.strokeStyle = HUE.need;
      ctx.beginPath();
      for (let n = 1; n < path.length; n++) {
        if (path[n][1] <= hot && path[n - 1][1] <= hot) { ctx.moveTo(path[n - 1][0], path[n - 1][1]); ctx.lineTo(path[n][0], path[n][1]); }
      }
      ctx.stroke();
      ctx.lineWidth = 1;
    }

    // the line itself
    ctx.fillStyle = ink(selected ? 0.6 : 0.32);
    if (right > left) ctx.fillRect(left, g.yB, right - left, 1);
    if (row.depth === 0 && x0 >= 0) ctx.fillRect(Math.round(x0), g.yB - 4, 1, 9);

    // each prompt is a bar line
    const barTop = g.compact ? g.yT - 1 : g.yT - 3;
    let lastBar = -10;
    ctx.fillStyle = ink(selected ? 0.3 : 0.14);
    for (const t of d.prompts) {
      if (t < view.from || t > view.to) continue;
      const px = Math.round(x(t));
      if (px - lastBar < 3) continue;
      ctx.fillRect(px, barTop, 1, g.bottom - barTop);
      lastBar = px;
    }

    // tool calls: 5-minute buckets from far away, each call once there is room for it
    const bw = BUCKET * env.k;
    const each = bw >= 7 && d.acts.length > 0;
    const covered = each ? (s.activityTotal > d.acts.length ? d.acts[0].t : -Infinity) : Infinity;
    const LH = [4, 3, 2, 3], BASE = [0.42, 0.22, 0.13, 0.22], GAIN = [0.58, 0.45, 0.33, 0.5];
    for (const b of d.buckets) {
      if (b.t + BUCKET < view.from || b.t > view.to || b.t + BUCKET > covered) continue;
      const px = x(b.t), w = Math.max(1, bw - 0.6);
      if (g.compact) {
        ctx.fillStyle = ink(0.2 + 0.7 * Math.min(1, b.total / 10));
        ctx.fillRect(px, g.lanes[0], w, 3);
        continue;
      }
      for (let lane = 0; lane < 4; lane++) {
        if (!b.lanes[lane]) continue;
        ctx.fillStyle = ink(BASE[lane] + GAIN[lane] * Math.min(1, b.lanes[lane] / 5));
        ctx.fillRect(px, g.lanes[lane], w, LH[lane]);
      }
      if (b.mem && !d.asked.length) { ctx.strokeStyle = HUE.memory; diamond(ctx, px + w / 2, g.yD, 3, false); }
    }
    if (each) {
      const first = Math.max(0, S.lastAtOrBefore(d.acts, view.from - 10 * MIN, (a) => a.t));
      for (let n = first; n < d.acts.length && d.acts[n].t <= view.to; n++) act(ctx, env, g, d, d.acts[n], state);
    }
    // a failed call is a signal at any distance
    ctx.strokeStyle = HUE.stalled;
    ctx.lineWidth = 1.2;
    for (const a of d.acts) {
      if (a.ok !== false || a.t < view.from || a.t > view.to) continue;
      cross(ctx, x(a.t) + 1, (g.compact ? g.lanes[0] : g.lanes[Math.max(0, a.lane)]) + 1.5, 2.4);
    }
    ctx.lineWidth = 1;

    // memory, on the lane above the curve
    for (const m of d.marks) {
      if (m.t < view.from || m.t > view.to) continue;
      const px = x(m.t);
      if (m.type === "injected") {
        ctx.fillStyle = "rgba(196,181,253,0.3)";
        ctx.fillRect(Math.round(px), g.yD, 1, g.yB - g.yD);
        ctx.fillStyle = HUE.memory;
        diamond(ctx, px + 0.5, g.yD, g.compact ? 2.8 : selected ? 4.4 : 3.6, true);
      } else if (m.type === "asked") {
        ctx.strokeStyle = HUE.memory;
        diamond(ctx, px + 0.5, g.yD, g.compact ? 2.6 : 3.4, false);
      } else if (m.type === "held") {
        if (g.compact && !each) continue;
        ctx.fillStyle = "rgba(196,181,253,0.5)";
        ring(ctx, px + 0.5, g.yD, 1.1, true);
      } else if (!g.compact) {
        ctx.strokeStyle = ink(0.45);
        ctx.strokeRect(Math.round(px) - 1.5, g.yD - 2.5, 4, 4);
      }
    }

    // compactions: the cliff, marked
    for (const c of d.compactions) {
      if (c.t < view.from || c.t > view.to) continue;
      const px = Math.round(x(c.t));
      ctx.fillStyle = ink(0.85);
      ctx.fillRect(px, yOf(c.pre || 0), 1, Math.max(2, yOf(c.post || 0) - yOf(c.pre || 0)));
      ctx.beginPath();
      ctx.moveTo(px - 3, g.yT - 6); ctx.lineTo(px + 4, g.yT - 6); ctx.lineTo(px + 0.5, g.yT - 1.5);
      ctx.closePath();
      ctx.fill();
      if (!g.compact && bw >= 16) {
        ctx.font = "400 10px " + FONT.mono;
        label(ctx, tokens(c.pre) + " → " + tokens(c.post), px + 7, g.yT + 6, ink(0.6));
        ctx.font = "400 11px " + FONT.text;
      }
    }

    // what it saw and made
    if (!g.compact) {
      for (const m of d.sights) {
        if (m.t < view.from || m.t > view.to) continue;
        const px = x(m.t), y = g.lanes[3] + 1.5;
        ctx.fillStyle = ink(1);
        ctx.strokeStyle = ink(0.9);
        if (m.type === "shot") ctx.fillRect(px - 2.5, y - 2.5, 5, 5);
        else if (m.type === "artifact") triangle(ctx, px, y, 3.4, true);
        else if (!each) ring(ctx, px, y, 2.4, false);
      }
    }

    // from the last thing it did to now
    const hue = HUE[state] || ink(0.3);
    if (xEnd > x1 + 1 && x1 < W) {
      const from = Math.max(x1, 0);
      if (state === "working") { ctx.fillStyle = HUE.working; ctx.globalAlpha = 0.75; ctx.fillRect(from, g.yB, xEnd - from, 1); ctx.globalAlpha = 1; }
      else {
        ctx.strokeStyle = env.pendOf(s) ? hue : ink(0.3);
        ctx.setLineDash([2, 4]);
        ctx.beginPath(); ctx.moveTo(from, g.yB + 0.5); ctx.lineTo(xEnd, g.yB + 0.5); ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    if (!s.live && x1 >= 0 && x1 <= W) endMark(ctx, env, s, x1, g.yB, state);

    // its name, where the eye already is: in the empty time before it started
    const name = clip(String(s.title || s.name || s.short), 64);
    const width = ctx.measureText(name).width;
    const colour = ink(selected ? 0.95 : 0.46);
    const startX = x(d.t0);
    if (startX - 10 - width >= 4 + row.depth * 10) { ctx.textAlign = "right"; label(ctx, name, startX - 9, g.yB + 0.5, colour); ctx.textAlign = "left"; }
    else if (!g.compact) label(ctx, name, Math.max(10, x0 + 8), row.y + 9, colour);

    if (state === "ready" || (s.prs || []).length) {
      const pr = (s.prs || [])[0];
      if (pr && !s.live && x1 >= 0 && x1 < W - 60 && bw >= 3) {
        ctx.font = "400 10px " + FONT.mono;
        label(ctx, "#" + pr.number, x1 + 9, g.yB - 8, env.mergedOf(s) || state === "ready" ? HUE.ready : ink(0.5));
      }
    }
  }

  /** How a line ends: a merged pull request, a pull request waiting, a stall, or just an end. */
  function endMark(ctx, env, s, px, y, state) {
    const merged = env.mergedOf(s);
    if (state === "ready") { ctx.fillStyle = HUE.ready; triangle(ctx, px, y, 4.5, true); }
    else if (state === "stalled") { ctx.strokeStyle = HUE.stalled; ctx.lineWidth = 1.6; cross(ctx, px, y, 4); ctx.lineWidth = 1; }
    else if (state === "need") { ctx.fillStyle = HUE.need; diamond(ctx, px, y, 4.5, true); }
    else if (merged) { ctx.fillStyle = HUE.ready; ring(ctx, px, y + 0.5, 2.2, true); ctx.strokeStyle = HUE.ready; ring(ctx, px, y + 0.5, 4.6, false); }
    else { ctx.fillStyle = ink(0.6); ctx.fillRect(Math.round(px), y - 4, 1, 9); }
  }

  /** One tool call: its lane says what it did, its length how long it took. */
  function act(ctx, env, g, d, a, state) {
    const px = env.x(a.t);
    const w = Math.min(Math.max(0, (a.ms || 0) * env.k), 400);
    if (a.running && state === "working" && a === d.acts[d.acts.length - 1]) {
      ctx.fillStyle = HUE.working;
      ctx.fillRect(px, (g.compact ? g.lanes[0] : g.lanes[Math.max(0, a.lane)]), Math.max(3, env.x(env.now) - px), 3);
      return;
    }
    if (g.compact) {
      ctx.fillStyle = ink([0.9, 0.5, 0.3, 0.6][Math.max(0, a.lane)]);
      ctx.fillRect(px, g.lanes[0], Math.max(1.5, w), 3);
      return;
    }
    if (a.lane < 0) {
      if (!d.asked.length) { ctx.strokeStyle = HUE.memory; diamond(ctx, px, g.yD, 3, false); }
      return;
    }
    const y = g.lanes[a.lane];
    if (a.lane === 0) {
      ctx.fillStyle = ink(0.92);
      ctx.fillRect(px, y - 1, Math.max(2, w), 5);
      if (a.kind === "write") ctx.fillRect(px, y - 3, 2, 1);
    } else if (a.lane === 1) {
      ctx.fillStyle = ink(0.5);
      ctx.fillRect(px, y, Math.max(2, w), 3);
    } else if (a.lane === 2) {
      ctx.fillStyle = ink(a.kind === "search-code" ? 0.5 : 0.32);
      if (a.kind === "search-code") ring(ctx, px + 1, y + 1, 1.3, true); else ctx.fillRect(px, y, Math.max(1.5, w), 2);
    } else {
      const cy = y + 1.5;
      ctx.strokeStyle = ink(0.85);
      ctx.fillStyle = ink(0.85);
      if (a.kind === "ask") { ctx.fillStyle = HUE.need; diamond(ctx, px, cy, 3.4, true); }
      else if (a.kind === "browser") ctx.strokeRect(px - 2, cy - 2, 4, 4);
      else if (a.kind === "agent") triangle(ctx, px, cy, 3, false);
      else if (a.kind === "web-fetch") { ring(ctx, px, cy, 2.6, false); ring(ctx, px, cy, 0.8, true); }
      else if (a.kind === "web-search") ring(ctx, px, cy, 2.6, false);
      else { ctx.fillStyle = ink(0.5); ring(ctx, px, cy, 1.4, true); }
    }
  }

  /* ---- what is under the cursor ---- */

  /** The nearest thing within a few pixels of (px, py) on a session's row. */
  function hit(env, row, px, py) {
    const s = row.s, d = s._, g = geom(row);
    if (d.t0 == null) return null;
    const t = env.t(px);
    const near = (time) => Math.abs(env.x(time) - px);
    let best = null;
    const offer = (dist, what) => { if (dist <= 6 && (!best || dist < best.dist)) best = Object.assign({ dist }, what); };
    if (py <= g.yT + 2) for (const m of d.marks) offer(near(m.t), { kind: m.type, ref: m.ref, t: m.t });
    for (const c of d.compactions) offer(near(c.t) + 1, { kind: "compaction", ref: c, t: c.t });
    if (py >= g.yB + 2) {
      const lane = g.compact ? null : Math.max(0, Math.min(3, Math.round((py - g.lanes[0] - 1.5) / 5)));
      if (lane === 3) for (const m of d.sights) offer(near(m.t), { kind: m.type, ref: m.ref, t: m.t });
      const i = S.lastAtOrBefore(d.acts, t + 6 / env.k, (a) => a.t);
      for (let n = i; n >= 0 && n > i - 40; n--) {
        const a = d.acts[n];
        if (lane != null && Math.max(0, a.lane) !== lane) continue;
        const end = a.t + (a.ms || 0);
        offer(t >= a.t && t <= end ? 0 : Math.min(near(a.t), near(end)), { kind: "act", ref: a, t: a.t });
      }
    }
    if (!best && py > g.yT && py < g.yB) for (const p of d.prompts) offer(near(p) + 2, { kind: "prompt", t: p });
    return best;
  }

  /* ---- the inspector's chart: this session's context, and its account's plan windows ---- */

  function drawContext(canvas, s, env) {
    const W = canvas.clientWidth, H = canvas.clientHeight;
    const ctx = fit(canvas, W, H);
    const d = s._, now = env.now;
    const limits = ((env.account && env.account.limits) || []).map((l) => ({ l, win: S.planWindow(l) })).filter((p) => p.win);
    const lanes = limits.length;
    const pad = { l: 8, r: 8, t: 14, b: 24 + lanes * 22 };
    const from = d.t0 == null ? now - HOUR : d.t0;
    const sessionWin = limits.find((p) => p.l.kind === "session" && p.win.to > now);
    const to = Math.max(now + (now - from) * 0.06, sessionWin ? Math.min(sessionWin.win.to, now + 6 * HOUR) : now);
    const x = (t) => pad.l + ((t - from) / (to - from)) * (W - pad.l - pad.r);
    const yB = H - pad.b, yT = pad.t;
    const yOf = (n) => yB - Math.min(1.04, n / d.window) * (yB - yT);
    ctx.textBaseline = "middle";

    // time ahead of now is not yet written
    ctx.fillStyle = ink(0.035);
    ctx.fillRect(x(now), yT - 8, W - pad.r - x(now), H - yT + 8);

    ctx.strokeStyle = ink(0.3);
    ctx.setLineDash([1, 5]);
    ctx.beginPath(); ctx.moveTo(pad.l, yT + 0.5); ctx.lineTo(x(now), yT + 0.5); ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = "600 10px " + FONT.display;
    ctx.fillStyle = ink(0.5);
    ctx.fillText(tokens(d.window) + " WINDOW", pad.l, yT - 7);

    if (d.series.length) {
      const path = [];
      let py = yOf(d.series[0][1]);
      path.push([x(d.series[0][0]), py]);
      for (let i = 1; i < d.series.length; i++) {
        const nx = x(d.series[i][0]);
        path.push([nx, py]);
        py = yOf(d.series[i][1]);
        path.push([nx, py]);
      }
      const tail = x(s.live ? now : d.t1);
      path.push([tail, py]);
      const fill = ctx.createLinearGradient(0, yT, 0, yB);
      fill.addColorStop(0, ink(0.3)); fill.addColorStop(1, ink(0.03));
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.moveTo(path[0][0], yB);
      for (const p of path) ctx.lineTo(p[0], p[1]);
      ctx.lineTo(tail, yB);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = ink(0.9);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      path.forEach((p, n) => (n ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.stroke();
      ctx.lineWidth = 1;
    }
    ctx.font = "400 10px " + FONT.mono;
    let lastLabel = -100;
    for (const c of d.compactions) {
      const px = Math.round(x(c.t));
      ctx.fillStyle = ink(0.9);
      ctx.beginPath(); ctx.moveTo(px - 3, yT - 5); ctx.lineTo(px + 4, yT - 5); ctx.lineTo(px + 0.5, yT - 0.5); ctx.closePath(); ctx.fill();
      if (px - lastLabel > 96 && px + 90 < W) { label(ctx, tokens(c.pre) + " → " + tokens(c.post), px + 7, yT + 8, ink(0.65)); lastLabel = px; }
    }
    ctx.fillStyle = ink(0.3);
    ctx.fillRect(pad.l, yB, W - pad.l - pad.r, 1);

    // the plan's windows under the same axis, each ending at its reset
    ctx.font = "600 10px " + FONT.display;
    limits.forEach((p, n) => {
      const y = yB + 18 + n * 22 + 0.5;
      const a = Math.max(pad.l, x(p.win.from)), b = Math.min(W - pad.r, x(p.win.to));
      if (b <= a) return;
      const share = Math.max(0, Math.min(1, (p.l.percent || 0) / 100));
      ctx.fillStyle = ink(0.14);
      ctx.fillRect(a, y + 6, b - a, 3);
      ctx.fillStyle = ink(p.l.kind === "session" ? 0.95 : 0.6);
      ctx.fillRect(a, y + 6, Math.max(1, (b - a) * share), 3);
      const reset = x(p.win.to), inside = reset <= W - pad.r;
      if (inside) { ctx.fillStyle = ink(0.9); ctx.fillRect(Math.round(reset), y - 6, 1, 16); }
      ctx.fillStyle = ink(0.75);
      ctx.fillText(S.limitName(p.l).toUpperCase() + "  " + Math.round(p.l.percent || 0) + "% USED", a + 1, y - 1);
      const end = p.win.to > now ? "RESETS " + fmt.when(p.win.to, now).toUpperCase() + (inside ? "" : " \u2192") : "OVER";
      ctx.fillStyle = ink(0.5);
      ctx.fillText(end, (inside ? reset - 6 : W - pad.r) - ctx.measureText(end).width, y - 1);
    });

    // now, and the selected moment
    ctx.fillStyle = ink(0.5);
    ctx.fillRect(Math.round(x(now)), yT - 8, 1, H - yT + 4);
    ctx.font = "600 10px " + FONT.display;
    ctx.fillStyle = ink(0.7);
    ctx.fillText("NOW", Math.min(x(now) + 5, W - 30), yT - 7);
    if (env.T < now && env.T >= from) {
      const px = Math.round(x(env.T));
      ctx.fillStyle = ink(1);
      ctx.fillRect(px, yT - 2, 1, yB - yT + 4);
      const at = S.ctxAt(s, env.T, now);
      if (at != null) { ctx.fillStyle = "#fff"; ring(ctx, px + 0.5, yOf(at), 3, true); }
    }
    ctx.font = "400 10px " + FONT.mono;
    ctx.fillStyle = ink(0.45);
    ctx.fillText(fmt.when(from, now), pad.l, H - 6);
    return { x, from, to };
  }

  window.score.draw = { fit, geom, ticks, drawRuler, drawStrip, drawScore, drawContext, hit, HUE };
})();

/* Orbit · the scene: the centre piece, the bands, the sectors, the bodies and their moons,
   the labels, the pending card and the motes of memory.
   Everything that moves at rest is a CSS animation of transform or opacity on an HTML
   element (compositor work); the SVG is static line art. Script runs on a change only. */
(function () {
  "use strict";
  const O = window.O;
  const M = window.mnemo;
  const esc = O.esc;
  const $ = (id) => document.getElementById(id);
  const TAU = Math.PI * 2;

  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const S = (O.scene = { g: null, pos: {}, placed: {}, items: [], sectors: [] });

  /* ---------- glyphs: a state is a shape first ---------- */
  O.glyph = function (state, r) {
    const f = (n) => n.toFixed(2);
    switch (state) {
      case "need": return `<path class="g-core" d="M0 ${f(-r * 1.2)}L${f(r * 1.2)} 0L0 ${f(r * 1.2)}L${f(-r * 1.2)} 0Z"/>`;
      case "working": return `<circle class="g-core" r="${f(r)}"/>`;
      case "ready": return `<path class="g-core" d="M0 ${f(-r * 1.15)}L${f(r * 1.08)} ${f(r * 0.78)}L${f(-r * 1.08)} ${f(r * 0.78)}Z"/>`;
      case "stalled": return `<path class="g-x" d="M${f(-r * 0.8)} ${f(-r * 0.8)}L${f(r * 0.8)} ${f(r * 0.8)}M${f(r * 0.8)} ${f(-r * 0.8)}L${f(-r * 0.8)} ${f(r * 0.8)}" stroke-width="${f(Math.max(1.6, r * 0.28))}"/>`;
      case "idle": return `<circle class="g-hollow" r="${f(r)}"/>`;
      default: return `<circle class="g-ghost" r="${f(r)}"/><circle class="g-dot" r="${f(Math.max(1.2, r * 0.22))}"/>`;
    }
  };
  O.mark = (state) => `<span class="mark" data-state="${state}">${M.GLYPH[state]}</span>`;

  /* ---------- stars: drawn once per size ---------- */
  function stars(g) {
    const c = $("stars");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = g.W * dpr; c.height = g.H * dpr;
    const x = c.getContext("2d");
    x.scale(dpr, dpr);
    const r = rng(7);
    const n = Math.round((g.W * g.H) / 5200);
    for (let i = 0; i < n; i++) {
      const big = r() > 0.965;
      x.globalAlpha = big ? 0.55 + r() * 0.35 : 0.08 + r() * 0.34;
      x.fillStyle = "#fff";
      x.beginPath();
      x.arc(r() * g.W, r() * g.H, big ? 0.9 + r() * 0.5 : 0.35 + r() * 0.55, 0, TAU);
      x.fill();
    }
  }

  /* ---------- the centre piece: memory as a seed head, each filament a rule ---------- */
  function core(g) {
    const el = $("core");
    const R = g.ry * 0.2;
    const size = Math.ceil(R * 2 + 8);
    const r = rng(41);
    const n = Math.round(O.clamp(90 + 34 * Math.log10((O.data.vault.rules || 0) + 10), 120, 260));
    const layer = { back: "", front: "" };
    const gold = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < n; i++) {
      const z = 1 - (2 * (i + 0.5)) / n;                 // a Fibonacci sphere, seen from the front
      const pr = Math.sqrt(1 - z * z);
      const th = i * gold;
      const len = R * (0.26 + 0.74 * pr) * (0.9 + r() * 0.1);
      const x0 = Math.cos(th) * R * 0.07, y0 = Math.sin(th) * R * 0.07;
      const x1 = Math.cos(th) * len, y1 = Math.sin(th) * len;
      const front = z > 0;
      const o = front ? 0.34 + 0.5 * z : 0.1 + 0.16 * (1 + z);
      layer[front ? "front" : "back"] +=
        `<path d="M${x0.toFixed(1)} ${y0.toFixed(1)}L${x1.toFixed(1)} ${y1.toFixed(1)}" stroke-opacity="${o.toFixed(2)}"/>` +
        `<circle cx="${x1.toFixed(1)}" cy="${y1.toFixed(1)}" r="${(front ? 0.9 + z * 0.9 : 0.7).toFixed(2)}" fill-opacity="${Math.min(1, o + 0.25).toFixed(2)}"/>`;
    }
    const svg = (inner) => `<svg width="${size}" height="${size}" viewBox="${-size / 2} ${-size / 2} ${size} ${size}"><g fill="#fff" stroke="#fff" stroke-width="0.6" stroke-linecap="round">${inner}</g></svg>`;
    el.style.setProperty("--core", size + "px");
    el.style.transform = `translate(${g.cx}px,${g.cy}px)`;
    el.innerHTML =
      `<div class="core-in">` +
      `<div class="core-glow"></div>` +
      `<div class="core-spin back">${svg(layer.back)}</div>` +
      `<div class="core-spin front">${svg(layer.front)}</div>` +
      `<div class="core-heart"></div>` +
      `<div class="core-ring"></div>` +
      `</div>` +
      `<div class="core-cap label"><b class="num">${O.int(O.data.vault.rules)}</b> rules in memory</div>`;
    S.coreR = R;
  }

  /* ---------- the static chart: bands, sectors, rim ---------- */
  function chart(g, sectors) {
    const f = (n) => n.toFixed(1);
    const P = (rho, th) => { const p = O.pt(g, rho, th); return f(p.x) + " " + f(p.y); };
    const ell = (rho, cls) => `<ellipse class="${cls}" cx="${f(g.cx)}" cy="${f(g.cy)}" rx="${f(g.rx * rho)}" ry="${f(g.ry * rho)}"/>`;
    let defs = "", out = "";
    const settled = !O.m.open.length;

    // the band that asks for him carries a faint light while anything waits
    defs += `<radialGradient id="needglow"><stop offset="52%" stop-color="#ffb020" stop-opacity="0"/><stop offset="78%" stop-color="#ffb020" stop-opacity="0.075"/><stop offset="100%" stop-color="#ffb020" stop-opacity="0"/></radialGradient>`;
    if (!settled) out += `<ellipse data-asset="need-band-light" cx="${f(g.cx)}" cy="${f(g.cy)}" rx="${f(g.rx * O.band.need.hi)}" ry="${f(g.ry * O.band.need.hi)}" fill="url(#needglow)"/>`;

    for (const b of O.BANDS) out += ell(b.lo, "ring" + (b.id === "need" && !settled ? " ring-need" : ""));
    out += ell(1, "rim");

    // rim ticks, as on an instrument
    let ticks = "";
    for (let i = 0; i < 180; i++) {
      const th = (i / 180) * TAU;
      ticks += `M${P(1, th)}L${P(i % 5 ? 1.006 : 1.014, th)}`;
    }
    out += `<path class="ticks" d="${ticks}"/>`;

    // band names, on the top of each band
    const nameSize = Math.round(10.5 * g.fs * 10) / 10;
    S.bandRects = [];
    O.BANDS.forEach((b, i) => {
      const rho = b.hi - (6 + nameSize) / g.ry;
      const d = 0.5;
      defs += `<path id="bn${i}" d="M${P(rho, -Math.PI / 2 - d)}A${f(g.rx * rho)} ${f(g.ry * rho)} 0 0 1 ${P(rho, -Math.PI / 2 + d)}"/>`;
      const n = b.id === "need" ? O.m.bodies.filter((x) => x.band === "need").length : 0;
      const text = b.id === "need" && settled ? "nothing needs you" : b.name;
      out += `<text class="bandname${b.id === "need" && n ? " hot" : ""}" font-size="${nameSize}"><textPath href="#bn${i}" startOffset="50%" text-anchor="middle">${esc(text)}</textPath></text>`;
      const w = text.length * nameSize * 0.95;
      S.bandRects.push({ x0: g.cx - w / 2, x1: g.cx + w / 2, y0: g.cy - g.ry * rho - nameSize * 1.3, y1: g.cy - g.ry * rho + 4, weight: 0.6 });
    });

    // sectors: a divider where two projects meet, the project's name on the rim
    const size = Math.round(15 * g.fs * 10) / 10;
    sectors.forEach((s, i) => {
      if (!s.whole) out += `<path class="divider" d="M${P(O.BANDS[0].lo, s.a0)}L${P(1.014, s.a0)}"/>`;
      const flip = Math.sin(s.mid) > 0.5;
      // the same clearance in pixels all the way round, whatever the ellipse does to a radius
      const rho = 1 + (10 * g.fs + (flip ? size * 0.74 : 0)) / Math.hypot(g.rx * Math.cos(s.mid), g.ry * Math.sin(s.mid));
      const span = s.whole ? 1.2 : Math.max(0.12, Math.min(1.3, (((s.a1 - s.a0) % TAU) + TAU) % TAU / 2));
      const a = s.mid - span, b = s.mid + span;
      const arc = `A${f(g.rx * rho)} ${f(g.ry * rho)} 0 0 `;
      defs += flip ? `<path id="sn${i}" d="M${P(rho, b)}${arc}0 ${P(rho, a)}"/>` : `<path id="sn${i}" d="M${P(rho, a)}${arc}1 ${P(rho, b)}"/>`;
      // shrink a name that is longer than its arc
      const pa = O.pt(g, rho, a), pm = O.pt(g, rho, s.mid), pb = O.pt(g, rho, b);
      const len = Math.hypot(pm.x - pa.x, pm.y - pa.y) + Math.hypot(pb.x - pm.x, pb.y - pm.y);
      const fit = Math.min(size, (len * 0.92) / (s.name.length * 1.02));
      const fz = Math.max(8, fit);
      out += `<text class="sector" font-size="${f(fz)}"><textPath href="#sn${i}" startOffset="50%" text-anchor="middle">${esc(s.name)}</textPath></text>`;
      // the name is an obstacle for labels: a run of small boxes along its arc
      const half = (s.name.length * fz * 1.06) / 2;
      const per = Math.hypot(g.rx * Math.sin(s.mid), g.ry * Math.cos(s.mid));
      const mid = 1 + (10 * g.fs + fz * 0.5) / Math.hypot(g.rx * Math.cos(s.mid), g.ry * Math.sin(s.mid));
      for (let t = -1; t <= 1.001; t += 0.125) {
        const q = O.pt(g, mid, s.mid + (t * half) / per);
        S.bandRects.push({ x0: q.x - fz * 1.2, x1: q.x + fz * 1.2, y0: q.y - fz * 1.2, y1: q.y + fz * 1.2, weight: 14 });
      }
    });

    const svg = $("chart");
    svg.setAttribute("width", g.W); svg.setAttribute("height", g.H);
    svg.setAttribute("viewBox", `0 0 ${g.W} ${g.H}`);
    svg.innerHTML = `<defs>${defs}</defs>${out}`;
  }

  /* ---------- bodies ---------- */
  function moonsHTML(b, R, us, g) {
    if (!b.kids.length) return { html: "", reach: 0 };
    const live = b.kids.filter((f) => O.state(f.s) !== "ended");
    const gone = b.kids.filter((f) => O.state(f.s) === "ended");
    const rings = [];
    let r = R + 16 * us;
    for (const group of [live, gone]) {
      // at most 14 on a ring; the rest are counted in the label
      for (let i = 0; i < group.length; i += 14) { rings.push({ r, list: group.slice(i, i + 14) }); r += 13 * us; }
    }
    let html = "";
    rings.forEach((ring, ri) => {
      html += `<span class="m-ring" style="--mr:${ring.r.toFixed(1)}px"></span>`;
      ring.list.forEach((f, i) => {
        const st = O.state(f.s);
        const a = Math.round((360 * i) / ring.list.length + ri * 37 + (b.s.short.charCodeAt(0) % 9) * 11);
        const mr = st === "ended" ? 3 * us : 5.4 * us;
        const sz = Math.ceil(mr * 2 + 6);
        const spin = st === "working";
        html +=
          `<span class="m-orbit${spin ? " spin" : ""}" style="--a:${a}deg;--mr:${ring.r.toFixed(1)}px;--dur:${22 + ((i * 7 + ri * 5) % 16)}s">` +
          `<span class="m-arm"><span class="m-un"><span class="m-sq">` +
          `<span class="moon" data-id="${f.s.short}" data-state="${st}" title="${esc(f.s.title || f.s.name || f.s.short)} · ${M.WORD[st]}">` +
          (st === "need" || st === "stalled" || st === "ready" ? `<i class="m-ping"></i>` : "") +
          `<svg width="${sz}" height="${sz}" viewBox="${-sz / 2} ${-sz / 2} ${sz} ${sz}">${O.glyph(st, mr)}</svg>` +
          `</span></span></span></span></span>`;
      });
    });
    return { html: `<span class="moons">${html}</span>`, reach: rings[rings.length - 1].r + 5 * us };
  }

  function bodyHTML(b, g) {
    const us = 0.6 + 0.4 * g.u;
    const r = (6 + 19 * b.size) * us;
    const st = O.state(b.s);
    const R = r + 5.5 * us;
    const sz = Math.ceil(R * 2 + 6);
    const ctx = b.s.context && b.s.context.percent;
    const C = TAU * R;
    let ring = "";
    if (st !== "ended") {
      ring = `<circle class="g-track" r="${R.toFixed(2)}"/>`;
      if (ctx != null)
        ring += `<circle class="g-ctx${ctx >= 80 ? " full" : ""}" r="${R.toFixed(2)}" stroke-dasharray="${((C * Math.min(ctx, 100)) / 100).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90)"/>`;
    }
    const moons = moonsHTML(b, R, us, g);
    const reach = Math.max(R + 3, moons.reach);
    b.geo = { r, R, fx: reach, fy: moons.reach ? Math.max(R + 3, moons.reach * g.k + 4) : R + 3 };
    return (
      `<span class="b-in" style="--R:${R.toFixed(1)}px">` +
      (st === "need" ? `<i class="b-ping"></i><i class="b-ping two"></i>` : "") +
      (st === "ready" ? `<i class="b-halo"></i>` : "") +
      `<svg class="b-g" width="${sz}" height="${sz}" viewBox="${-sz / 2} ${-sz / 2} ${sz} ${sz}">${ring}${O.glyph(st, r)}</svg>` +
      (st === "working" ? `<span class="b-spark"><i></i></span>` : "") +
      moons.html +
      `<i class="b-ret" style="--F:${(reach + 7).toFixed(1)}px;--Fy:${(b.geo.fy + 7).toFixed(1)}px"></i>` +
      `</span>` +
      `<i class="b-hit" style="--F:${Math.max(reach, 16).toFixed(1)}px"></i>`
    );
  }

  function labelHTML(b, g) {
    const s = b.s, st = O.state(s);
    const title = s.title || s.name || s.short;
    const ctx = s.context && s.context.percent;
    const meta = [
      `<span class="st" data-state="${st}">${M.GLYPH[st]} ${M.WORD[st]}</span>`,
      `<span class="pj">${esc(b.project)}</span>`,
      `<span class="num">${O.tok(b.tree)}</span>`,
    ];
    if (ctx != null && st !== "ended") meta.push(`<span class="num">${O.pct(ctx)}</span> ctx`);
    meta.push(O.age(b.lastAt));
    let fam = "";
    if (b.kids.length) {
      const c = {};
      for (const f of b.kids) c[O.state(f.s)] = (c[O.state(f.s)] || 0) + 1;
      const parts = M.STATE_ORDER.filter((k) => c[k] && k !== "ended").map((k) => `<span class="st" data-state="${k}">${M.GLYPH[k]} ${c[k]} ${k === "need" ? (c[k] > 1 ? "need you" : "needs you") : k === "ready" ? "ready" : M.WORD[k]}</span>`);
      fam = `<div class="lab-fam"><span>${b.kids.length} ${b.kids.length > 1 ? "children" : "child"}${parts.length ? "" : c.ended ? " · all ended" : ""}</span>${parts.join("")}</div>`;
    }
    let want = "";
    if (b.pend.length) {
      const p = b.pend[0];
      want = `<div class="lab-want" data-kind="${p.kind}"><b>${O.KIND_GLYPH[p.kind]} ${O.KIND[p.kind]}</b> ${esc(p.text.replace(/\s+/g, " ").slice(0, 150))}${b.pend.length > 1 ? ` <em>+${b.pend.length - 1} more</em>` : ""}</div>`;
    }
    let doing = "";
    if (!want && st !== "ended" && g.W >= 1700) {
      const d = O.doing(s);
      if (d) doing = `<div class="lab-doing${st === "working" ? " mono" : ""}">${st === "working" ? "❯ " : ""}${esc(d.slice(0, 120))}</div>`;
    }
    return `<div class="lab-title">${esc(title)}</div><div class="lab-meta">${meta.join('<i class="sep">·</i>')}</div>${fam}${want}${doing}`;
  }

  function syncBodies(g) {
    const host = $("bodies"), labs = $("labels");
    const alive = new Set();
    for (const b of O.m.bodies) {
      alive.add(b.id);
      const st = O.state(b.s);
      let el = host.querySelector(`[data-id="${b.s.short}"].body`);
      if (!el) {
        el = document.createElement("div");
        el.className = "body";
        el.dataset.id = b.s.short;
        el.dataset.asset = "session-body";
        el.setAttribute("role", "button");
        host.appendChild(el);
      }
      const html = bodyHTML(b, g);
      const sig = st + "|" + b.band + "|" + html.length + "|" + g.W + "x" + g.H + "|" + b.kids.map((f) => O.state(f.s)).join("");
      if (el.dataset.sig !== sig) { el.innerHTML = html; el.dataset.sig = sig; }
      el.dataset.state = st;
      el.dataset.band = b.band;
      el.style.setProperty("--k", g.k.toFixed(3));
      el.setAttribute("aria-label", (b.s.title || b.s.short) + ", " + M.WORD[st] + ", " + b.project);
      const p = O.pt(g, b.rho, b.theta);
      S.pos[b.id] = p;
      el.style.transform = `translate(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px)`;

      let lab = labs.querySelector(`[data-id="${b.s.short}"]`);
      if (!lab) {
        lab = document.createElement("div");
        lab.className = "lab";
        lab.dataset.id = b.s.short;
        labs.appendChild(lab);
      }
      const lh = labelHTML(b, g);
      if (lab.dataset.sig !== lh) { lab.innerHTML = lh; lab.dataset.sig = lh; }
      lab.dataset.state = st;
      lab.dataset.band = b.band;
    }
    for (const el of [...host.children, ...labs.children]) {
      const s = O.session(el.dataset.id);
      if (!s || !alive.has(s.id)) el.remove();
    }
  }

  function placeLabels(g) {
    const labs = $("labels");
    const B = { x0: 10, y0: g.top + 2, x1: g.W - 10, y1: g.H - g.bottom - 2 };
    const cr = S.coreR + 6;
    const fixed = [
      { x0: g.cx - cr, x1: g.cx + cr, y0: g.cy - cr, y1: g.cy + cr + 22 * g.fs, weight: 6 },
      ...S.bandRects,
    ];
    let items, placed;
    const attempt = () => {
      items = [];
      for (const b of O.m.bodies) {
        const lab = labs.querySelector(`[data-id="${b.s.short}"]`);
        lab.style.width = "";
        const p = S.pos[b.id];
        items.push({
          id: b.id, x: p.x, y: p.y, fx: b.geo.fx, fy: b.geo.fy, core: b.geo.R,
          w: Math.ceil(lab.offsetWidth) + 2, h: Math.ceil(lab.offsetHeight),
          prio: O.band[b.band].i, lab,
        });
      }
      // outward when there is room for it, inward at the window's edge
      for (const it of items) {
        const out = it.x >= g.cx ? "E" : "W";
        const room = out === "E" ? it.x + it.fx + 8 + it.w <= B.x1 : it.x - it.fx - 8 - it.w >= B.x0;
        it.pref = room ? out : out === "E" ? "W" : "E";
      }
      placed = O.solveLabels(items, fixed, B, g.fs);
      const bad = O.checkLabels(items, placed, B);
      return !(bad.overlap || bad.onBody || bad.clipped);
    };
    // when the full labels cannot all be placed cleanly, they shed their second lines
    labs.classList.remove("dense");
    if (!attempt()) { labs.classList.add("dense"); attempt(); }
    let lines = "";
    for (const it of items) {
      const c = placed[it.id];
      it.lab.style.transform = `translate(${Math.round(c.x0)}px,${Math.round(c.y0)}px)`;
      it.lab.style.width = it.w + "px";
      it.lab.dataset.align = c.align;
      // a leader when the label had to stand off from its body
      const nx = O.clamp(it.x, c.x0, c.x1), ny = O.clamp(it.y, c.y0, c.y1);
      const d = Math.hypot(nx - it.x, ny - it.y);
      if (d > it.core + 15 * g.fs) {
        const ang = Math.atan2(ny - it.y, nx - it.x);
        const from = it.core + 4;
        lines += `<i style="width:${(d - from - 3).toFixed(1)}px;transform:translate(${(it.x + Math.cos(ang) * from).toFixed(1)}px,${(it.y + Math.sin(ang) * from).toFixed(1)}px) rotate(${ang.toFixed(4)}rad)"></i>`;
      }
    }
    $("leaders").innerHTML = lines;
    S.items = items; S.placed = placed; S.B = B;
  }

  /* ---------- the fleet line ---------- */
  function limitHTML(l) {
    const left = Math.max(0, 100 - (l.percent || 0));
    const name = l.kind === "session" ? "5h" : l.kind === "weekly_all" ? "week" : l.kind === "weekly_scoped" ? "week · " + (l.model || "") : l.kind;
    const reset = O.until(l.resetsAt);
    return `<span class="lim${l.active ? "" : " off"}" data-sev="${esc(l.severity || "normal")}" title="${esc(name)}: ${O.pct(l.percent)} used${reset ? ", resets in " + reset : ""}">` +
      `<span class="lim-name">${esc(name)}</span><span class="meter"><i style="transform:scaleX(${(left / 100).toFixed(3)})"></i></span>` +
      `<span class="num">${Math.round(left)}%</span><span class="lim-left">left${reset ? " · " + reset : ""}</span></span>`;
  }

  S.fleet = function () {
    const c = O.m.count, d = O.data;
    const need = c.need + c.stalled;
    const fig = (state, n, word) => `<span class="fig${n ? "" : " zero"}" data-state="${state}"><i class="gl">${M.GLYPH[state]}</i><b class="num">${n}</b> ${word}</span>`;
    const accounts = d.accounts.map((a) => {
      const lims = a.limits.filter((l) => l.kind === "session" || l.kind === "weekly_all");
      return `<span class="acct${a.active ? " on" : ""}"><span class="acct-name">${esc(a.label || a.id)}</span>${lims.length ? lims.map(limitHTML).join("") : `<span class="lim off">no plan reading</span>`}</span>`;
    }).join("");
    const reduced = document.documentElement.dataset.motion === "reduced";
    $("fleet").innerHTML =
      `<button class="brand" data-go="scene" data-asset="wordmark" title="Back to the scene">mnemo</button>` +
      `<div class="figs">` +
      (need ? fig("need", need, need > 1 ? "need you" : "needs you") : `<span class="fig calm"><i class="gl">◇</i>nothing needs you</span>`) +
      fig("working", c.working, "working") + fig("ready", c.ready, "ready to merge") + fig("idle", c.idle, "your turn") +
      `</div>` +
      `<div class="tick" id="tick"></div>` +
      `<div class="accts">${accounts}</div>` +
      `<button class="motion" data-act="motion" aria-pressed="${reduced}" title="Reduce motion">motion <b>${reduced ? "reduced" : "full"}</b></button>` +
      `<span class="cap">${d.synthetic ? "sample capture" : "captured " + O.clock(d.capturedAt)}</span>`;
  };

  S.keys = function () {
    const v = O.view;
    const k = (key, what) => `<span><kbd>${key}</kbd> ${what}</span>`;
    let out;
    if (v.q != null) out = k("↑ ↓", "choose") + k("Enter", "open") + k("Esc", "close");
    else if (v.vault) out = k("Esc", "back to the scene") + k("Tab", "next pending") + k("a–z", "find a session");
    else if (v.p) out = k("1–9", "answer") + k("Tab", "next pending") + k("Enter", v.s ? "keep reading" : "open the session") + k("Esc", "close");
    else if (v.s) out = k("← →", "previous / next session") + k("↑ ↓", "through the family") + k("1 2 3", "context · memory · sight") + k("Tab", "next pending") + k("a–z", "find") + k("Esc", "back to the scene");
    else out = k("← ↑ ↓ →", "move") + k("Enter", "open") + k("Tab", "next pending") + k("a–z", "find a session") + k("Home", "memory");
    $("keys").innerHTML = out;
  };

  /* ---------- the pending card: the question opens on the body ---------- */
  O.choicesHTML = function (p) {
    return `<ol class="choices">` + p.choices.map((c, i) =>
      `<li><button data-answer="${p.key}.${i}"><kbd>${i + 1}</kbd><span><b>${esc(c.label)}</b>${c.description ? `<small>${esc(c.description)}</small>` : ""}</span></button></li>`).join("") + `</ol>`;
  };

  S.card = function () {
    const el = $("card"), v = O.view, g = S.g;
    const s = O.session(v.p);
    const p = s && !v.s && !v.vault ? O.openFor(s) : null;
    if (!p) { el.hidden = true; el.innerHTML = ""; return; }
    const b = O.bodyOf(s);
    const child = b.s !== s;
    const pr = p.pr ? `<div class="card-pr mono">#${p.pr.number} · ${esc(p.pr.repo || "")} · checks ${esc(p.pr.ci || "none")}${p.pr.mergeable ? " · " + esc(String(p.pr.mergeable).toLowerCase()) : ""}</div>` : "";
    el.innerHTML =
      `<div class="card-head"><span class="st" data-state="${O.state(s)}">${O.KIND_GLYPH[p.kind]} ${O.KIND[p.kind]}</span><span class="card-age">waiting ${O.age(p.at)}${s.abandoned ? " · mnemo gave up asking" : ""}</span></div>` +
      `<div class="card-title">${esc(s.title || s.name || s.short)}</div>` +
      (child ? `<div class="card-of">a child of <b>${esc(b.s.title || b.s.short)}</b></div>` : "") +
      `<div class="card-text">${esc(p.text)}</div>` + pr + O.choicesHTML(p) +
      `<div class="card-foot"><span><kbd>Enter</kbd> open the session</span><span><kbd>Tab</kbd> next</span><span><kbd>Esc</kbd> close</span></div>`;
    el.hidden = false;
    el.dataset.state = O.state(s);
    // it opens where the body's label stands, so the body stays in sight beside it
    const c = S.placed[b.id];
    const w = el.offsetWidth, h = el.offsetHeight, pad = 16 * g.fs;
    const x = c.align === "r" ? c.x1 - w + pad : c.align === "c" ? (c.x0 + c.x1 - w) / 2 : c.x0 - pad;
    const y = O.clamp(c.y0 - pad, g.top + 8, g.H - g.bottom - h - 8);
    el.style.transform = `translate(${Math.round(O.clamp(x, 12, g.W - w - 12))}px,${Math.round(y)}px)`;
  };

  /* ---------- classes that follow the view ---------- */
  S.marks = function () {
    const v = O.view;
    const focus = v.s ? O.bodyOf(O.session(v.s)) : null;
    const cur = v.p && O.session(v.p) ? O.bodyOf(O.session(v.p)) : v.c && O.session(v.c) ? O.bodyOf(O.session(v.c)) : null;
    for (const el of document.querySelectorAll("#bodies .body, #labels .lab")) {
      const s = O.session(el.dataset.id);
      el.classList.toggle("is-cursor", !!cur && cur.s === s && !v.s);
      el.classList.toggle("is-focus", !!focus && focus.s === s);
      el.classList.toggle("is-asked", !!v.p && !v.s && !!cur && cur.s === s);
    }
    for (const el of document.querySelectorAll("#bodies .moon")) el.classList.toggle("is-asked", !!v.p && el.dataset.id === v.p);
    $("core").classList.toggle("is-cursor", v.c === "core" && !v.s && !v.vault);
  };

  /* ---------- whispers, and the motes of memory ---------- */
  S.whisper = function (b, text, cls) {
    const p = S.pos[b.id];
    if (!p) return;
    const el = document.createElement("div");
    el.className = "whisper " + (cls || "");
    el.textContent = text;
    el.style.transform = `translate(${p.x.toFixed(0)}px,${(p.y - b.geo.fy - 10).toFixed(0)}px)`;
    $("motes").appendChild(el);
    el.addEventListener("animationend", () => el.remove());
    setTimeout(() => el.remove(), 4000);
  };

  S.settle = function () {
    const el = document.createElement("div");
    el.className = "settle";
    el.dataset.asset = "settle-wave";
    el.style.transform = `translate(${S.g.cx}px,${S.g.cy}px)`;
    el.innerHTML = `<i style="--k:${S.g.k.toFixed(3)};--to:${(S.g.rx * 2).toFixed(0)}px"></i>`;
    $("motes").appendChild(el);
    setTimeout(() => el.remove(), 2600);
  };

  // The capture is a snapshot, so the motes replay it: the newest events, once, and then
  // the timer is gone. Nothing ticks at rest; a click on the line in the bar plays it again.
  const RUN = 14;
  let events = null, cursor = 0, timer = 0;
  let showing = null;
  function tickLine(e) {
    const tick = $("tick");
    showing = e;
    if (!tick || !events) return;
    const n = Math.min(RUN, events.length);
    tick.innerHTML = e
      ? `<span class="tick-in"><i>✦</i> memory replay <b>${O.clock(e.at)}</b> ${esc(e.slug)} <i>→</i> ${esc((e.s.title || e.s.short).slice(0, 44))}</span>`
      : n ? `<button class="tick-in" data-act="replay"><i>✦</i> memory was used ${events.length} times in this capture · replay the last ${n}</button>` : "";
  }
  function fly() {
    timer = 0;
    if (!events.length || document.hidden || O.reduced() || O.view.s || O.view.vault) return tickLine(null);
    if (cursor >= Math.min(RUN, events.length)) return tickLine(null);
    const e = events[Math.max(0, events.length - RUN) + cursor++];
    const b = O.bodyOf(e.s), to = S.pos[b.id], g = S.g;
    if (to && typeof document.body.animate === "function") {
      const el = document.createElement("div");
      el.className = "mote " + e.kind;
      el.dataset.asset = "memory-mote";
      el.innerHTML = "<i></i>";
      $("motes").appendChild(el);
      const dx = to.x - g.cx, dy = to.y - g.cy, d = Math.hypot(dx, dy) || 1;
      const bulge = Math.min(70, d * 0.16) * (cursor % 2 ? 1 : -1);
      const dur = 1100 + d * 0.9;
      const a = el.animate(
        [{ transform: `translate(${g.cx}px,${g.cy}px)`, opacity: 0 }, { opacity: 1, offset: 0.12 }, { opacity: 1, offset: 0.88 }, { transform: `translate(${to.x}px,${to.y}px)`, opacity: 0 }],
        { duration: dur, easing: "cubic-bezier(.45,.05,.3,1)" });
      el.firstChild.animate(
        [{ transform: "translate(0,0)", easing: "ease-out" }, { transform: `translate(${((-dy / d) * bulge).toFixed(1)}px,${((dx / d) * bulge).toFixed(1)}px)`, easing: "ease-in" }, { transform: "translate(0,0)" }],
        { duration: dur, easing: "cubic-bezier(.45,.05,.3,1)" });
      a.onfinish = () => {
        el.remove();
        S.whisper(b, (e.kind === "read" ? "asked · " : "") + e.slug, "rule");
      };
      tickLine(e);
    }
    timer = setTimeout(fly, 2600);
  }
  S.replay = function (soon, again) {
    if (!events) events = O.memoryEvents();
    if (again) cursor = 0;
    if (document.hidden || O.reduced() || O.view.s || O.view.vault || cursor >= Math.min(RUN, events.length)) {
      clearTimeout(timer);
      timer = 0;
      return tickLine(null);
    }
    tickLine(showing);                       // the bar may have been redrawn under the line
    if (!timer) timer = setTimeout(fly, soon ? 500 : 1800);
  };
  S.replayStop = function () { clearTimeout(timer); timer = 0; };

  /** `?mote=0.6`: one mote held still that far along its way, for a photograph (a headless
      shot re-sizes the window as it captures, which clears the motes in flight). */
  S.still = function (at) {
    if (!events) events = O.memoryEvents();
    const e = events[events.length - 1];
    if (!e || O.view.s || O.view.vault) return;
    const b = O.bodyOf(e.s), to = S.pos[b.id], g = S.g;
    const dx = to.x - g.cx, dy = to.y - g.cy, d = Math.hypot(dx, dy) || 1;
    const bulge = Math.min(70, d * 0.16) * Math.sin(Math.PI * at);
    const el = document.createElement("div");
    el.className = "mote " + e.kind;
    el.dataset.asset = "memory-mote";
    el.innerHTML = "<i></i>";
    el.style.transform = `translate(${(g.cx + dx * at - (dy / d) * bulge).toFixed(1)}px,${(g.cy + dy * at + (dx / d) * bulge).toFixed(1)}px)`;
    $("motes").appendChild(el);
    tickLine(e);
  };

  /* ---------- render ---------- */
  S.render = function (full) {
    const app = $("app");
    const g = O.geom(app.clientWidth, app.clientHeight);
    const resized = !S.g || S.g.W !== g.W || S.g.H !== g.H;
    S.g = g;
    app.style.setProperty("--u", g.u.toFixed(3));
    app.style.setProperty("--fs", g.fs.toFixed(3));
    app.style.setProperty("--top", g.top + "px");
    app.style.setProperty("--bottom", g.bottom + "px");
    app.style.setProperty("--k", g.k.toFixed(3));
    app.style.setProperty("--labw", Math.round(O.labw(g)) + "px");
    // a first draw or a new size is not a move: nothing travels to its place
    const still = resized || full;
    if (still) { app.classList.add("is-still"); stars(g); core(g); }
    S.sectors = O.assignAngles(O.m, g, O.labw(g), 64 * g.fs);
    chart(g, S.sectors);
    syncBodies(g);
    placeLabels(g);
    S.fleet();
    app.classList.toggle("is-settled", !O.m.open.length);
    if (still) { void app.offsetWidth; app.classList.remove("is-still"); }
  };

  /** The check `?check` prints: the numbers a reviewer would otherwise read off a picture. */
  S.check = function () {
    const bad = O.checkLabels(S.items, S.placed, S.B);
    const msg = `orbit-check ${S.g.W}x${S.g.H}: ${S.items.length} bodies, ${bad.overlap} label overlaps, ${bad.onBody} labels on a body, ${bad.clipped} clipped`;
    if (bad.overlap || bad.onBody || bad.clipped) console.error(msg); else console.log(msg);
    return bad;
  };
})();

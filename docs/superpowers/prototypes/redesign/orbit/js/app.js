/* Orbit · the page: the hash is the state, the keyboard and the pointer change it, and one
   render follows every change. Nothing here reaches a session: an answer is a line in the
   hash and nothing else. */
(function () {
  "use strict";
  const O = window.O;
  const S = O.scene, T = O.station, V = O.vault, F = O.finder;
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);

  function render(rebuilt) {
    const v = O.view, app = $("app"), g = S.g;
    if (v.s && !O.session(v.s)) v.s = null;
    if (v.p && !(O.session(v.p) && O.openFor(O.session(v.p)))) v.p = null;
    if (v.c && v.c !== "core" && !O.session(v.c)) v.c = null;
    app.dataset.view = v.vault ? "vault" : v.s ? "station" : "scene";
    // the station's map: the whole scene, scaled into the left column
    const left = Math.round(O.clamp(g.W * 0.2, 250, 520));
    const pad = Math.round(14 + 14 * g.u);
    app.style.setProperty("--leftw", left + "px");
    app.style.setProperty("--pad", pad + "px");
    app.style.setProperty("--map-s", (left / g.W).toFixed(4));
    app.style.setProperty("--map-x", pad + "px");
    app.style.setProperty("--map-y", Math.round(g.top + pad * 0.4 - (g.top * left) / g.W * 0.6) + "px");
    app.style.setProperty("--maph", Math.round((left * g.H) / g.W) + "px");
    S.marks();
    S.card();
    T.render();
    V.render();
    F.render();
    S.keys();
    S.replay(rebuilt === "first");
  }

  /** Change the view. `push` leaves a step for the back button; a cursor move does not. */
  function go(patch, push) {
    const before = Object.keys(O.view.a).length;
    const hadOpen = O.m.open.length;
    Object.assign(O.view, patch);
    const hash = "#" + O.hashOf(O.view);
    if (hash !== (location.hash || "#")) history[push ? "pushState" : "replaceState"](null, "", hash === "#" ? location.pathname + location.search : hash);
    if (Object.keys(O.view.a).length !== before || patch.a) {
      O.build(O.data);
      S.render();
      if (hadOpen && !O.m.open.length) S.settle();
    }
    render();
  }
  O.go = go;

  const open = (s, more) => go(Object.assign({ s: s.short, q: null, vault: false, p: null }, more), true);

  function answer(key, idx) {
    const p = O.m.pending.find((x) => x.key === key);
    const c = p && p.choices[idx];
    if (!c || p.answer) return;
    if (!c.to) return go({ p: null });
    const b = O.bodyOf(p.s);
    go({ a: Object.assign({}, O.view.a, { [key]: idx }), p: null, c: O.view.s ? O.view.c : b.s.short });
    if (!O.view.s) S.whisper(O.bodyOf(p.s), "you · " + c.label, "you");
  }

  function nextPending(step) {
    const list = O.m.open, v = O.view;
    if (!list.length) return go({ p: null });
    let i = list.findIndex((p) => p.s.short === v.p);
    // in a station, the first Tab arms the question of the session he is already reading
    const here = !v.p && v.s ? list.findIndex((p) => p.s.short === v.s) : -1;
    i = here >= 0 ? here : i < 0 ? (step > 0 ? 0 : list.length - 1) : (i + step + list.length) % list.length;
    const p = list[i];
    if (v.s) go({ s: p.s.short, p: p.s.short }, true);
    else go({ vault: false, p: p.s.short, c: O.bodyOf(p.s).s.short });
  }

  /* ---------- the cursor: arrow keys move between neighbours ---------- */
  function moveCursor(dx, dy) {
    const g = S.g, v = O.view;
    const nodes = O.m.bodies.map((b) => ({ id: b.s.short, x: S.pos[b.id].x, y: S.pos[b.id].y }));
    nodes.push({ id: "core", x: g.cx, y: g.cy });
    const cur = nodes.find((n) => n.id === v.c);
    if (!cur) {
      const first = O.m.bodies.slice().sort((a, b) => O.band[a.band].i - O.band[b.band].i || a.rho - b.rho)[0];
      return go({ c: first ? first.s.short : "core", p: null });
    }
    let best = null, bk = Infinity;
    for (const n of nodes) {
      if (n === cur) continue;
      const ax = (n.x - cur.x) * dx + (n.y - cur.y) * dy;            // along the arrow
      const px = Math.abs((n.x - cur.x) * dy) + Math.abs((n.y - cur.y) * dx);   // across it
      if (ax <= 4 || px > ax * 2.2) continue;
      const k = ax + px * 1.8;
      if (k < bk) { bk = k; best = n; }
    }
    if (best) go({ c: best.id, p: null });
  }

  function stepSession(step) {
    const ring = T.ring(), cur = O.bodyOf(O.session(O.view.s));
    const i = ring.indexOf(cur);
    open(ring[(i + step + ring.length) % ring.length].s, { r: O.view.r });
  }
  function stepFamily(step) {
    const s = O.session(O.view.s), fam = O.bodyOf(s).fam;
    const i = fam.findIndex((f) => f.s === s) + step;
    if (fam[i]) open(fam[i].s, { r: O.view.r });
  }

  /* ---------- keys ---------- */
  function onKey(e) {
    const v = O.view, key = e.key;
    const input = e.target && e.target.matches && e.target.matches("input, textarea");
    if (!$("lightbox").hidden) { if (key === "Escape") $("lightbox").hidden = true; return; }

    if (v.q != null) {
      if (key === "Escape") go({ q: null });
      else if (key === "ArrowDown" || key === "ArrowUp") { F.index = O.clamp(F.index + (key === "ArrowDown" ? 1 : -1), 0, Math.max(0, Math.min(8, F.hits.length - 1))); F.render(); }
      else if (key === "Enter") { const s = F.hits[F.index]; if (s) open(s, { r: v.r }); }
      else if (!input && key.length === 1 && !e.ctrlKey && !e.metaKey) go({ q: v.q + key });
      else if (!input && key === "Backspace") go({ q: v.q.slice(0, -1) });
      else return;
      e.preventDefault();
      return;
    }
    if (input) { if (key === "Escape") e.target.blur(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (key === "Tab") nextPending(e.shiftKey ? -1 : 1);
    else if (key === "Escape") {
      if (v.p) go({ p: null });
      else if (v.s) go({ s: null, c: O.bodyOf(O.session(v.s)).s.short }, true);
      else if (v.vault) go({ vault: false, c: "core" }, true);
      else if (v.c) go({ c: null });
      else return;
    } else if (/^[1-9]$/.test(key)) {
      const p = v.p && O.openFor(O.session(v.p));
      if (p) answer(p.key, Number(key) - 1);
      else if (v.s && O.READINGS[Number(key) - 1]) go({ r: O.READINGS[Number(key) - 1] });
      else return;
    } else if (key === "Enter") {
      if (v.vault) return;
      if (v.s) { const s = O.session(v.s); if (O.openFor(s)) go({ p: v.p ? null : s.short }); else return; }
      else if (v.p) go({ s: v.p, c: O.bodyOf(O.session(v.p)).s.short }, true);
      else if (v.c === "core") go({ vault: true }, true);
      else if (v.c) open(O.session(v.c));
      else return;
    } else if (arrows[key]) {
      if (v.vault) return;
      if (v.s) { if (arrows[key][0]) stepSession(arrows[key][0]); else stepFamily(arrows[key][1]); }
      else moveCursor(arrows[key][0], arrows[key][1]);
    } else if (key === "Home") go({ vault: !v.vault, s: null, p: null }, true);
    else if (key.length === 1 && /[\p{L}]/u.test(key)) { F.index = 0; go({ q: key }); }
    else return;
    e.preventDefault();
  }

  /* ---------- pointer ---------- */
  function onClick(e) {
    const t = e.target, v = O.view;
    const hit = (sel) => t.closest(sel);
    let el;
    if ((el = hit("[data-answer]"))) { const m = /^(.+)\.(\d+)$/.exec(el.dataset.answer); answer(m[1], Number(m[2])); }
    else if ((el = hit("[data-reading]"))) go({ r: el.dataset.reading });
    else if ((el = hit("[data-act='motion']"))) {
      window.mnemo.motion(document.documentElement.dataset.motion === "reduced" ? "full" : "reduced");
      S.fleet(); S.replay();
    } else if ((el = hit("[data-go='scene']"))) go({ s: null, vault: false, p: null, q: null }, true);
    else if (hit("[data-act='replay']")) S.replay(true, true);
    else if ((el = hit("figure[data-shot]"))) { $("lightbox").innerHTML = `<img src="../${O.esc(el.dataset.shot)}" alt="">`; $("lightbox").hidden = false; }
    else if (hit("#lightbox")) $("lightbox").hidden = true;
    else if ((el = hit("[data-open]"))) { const s = O.session(el.dataset.open); if (s) open(s, { r: v.r }); }
    else if ((el = hit(".moon"))) {
      const s = O.session(el.dataset.id);
      if (!v.s && O.openFor(s)) go({ p: s.short, c: O.bodyOf(s).s.short }); else open(s, { r: v.r });
    } else if ((el = hit(".lab-want"))) {
      const b = O.bodyOf(O.session(el.closest(".lab").dataset.id));
      go({ p: b.pend[0].s.short, c: b.s.short });
    } else if ((el = hit(".body, .lab"))) open(O.session(el.dataset.id), { r: v.r });
    else if (hit("#core")) go({ vault: !v.vault, s: null, p: null }, true);
    else if (hit("#card")) return;
    else if (v.p && !v.s) go({ p: null });
    else if (v.q != null && !hit("#finder .f-box")) go({ q: null });
  }

  function check() {
    const bad = S.check();
    if (bad.overlap || bad.onBody || bad.clipped) setTimeout(() => { throw new Error("orbit-check failed"); });
  }

  /* ---------- boot ---------- */
  const fonts = document.fonts
    ? Promise.all(['600 16px "Geist"', '400 14px "Geist"', '600 12px "Jura"', '400 12px "JetBrains Mono"'].map((f) => document.fonts.load(f).catch(() => null)))
    : Promise.resolve();

  Promise.all([window.MNEMO_READY, fonts]).then(([data]) => {
    O.data = data;
    O.readHash();
    O.build(data);
    S.render(true);
    render("first");
    $("app").classList.add("is-ready");

    window.addEventListener("hashchange", () => {
      const a = JSON.stringify(O.view.a);
      O.readHash();
      if (JSON.stringify(O.view.a) !== a) { O.build(data); S.render(); }
      render();
    });
    document.addEventListener("keydown", onKey);
    $("app").addEventListener("click", onClick);
    $("app").addEventListener("input", (e) => { if (e.target.closest("#finder")) { F.index = 0; go({ q: e.target.value }); } });
    $("app").addEventListener("submit", (e) => {
      e.preventDefault();
      const f = e.target.closest("[data-reply]");
      const text = f && f.elements.t.value.trim();
      if (!text) return;
      (O.typed[f.dataset.reply] = O.typed[f.dataset.reply] || []).push(text);
      T.render();
    });
    // re-compose inside the frame that changed the size, so no frame shows a stale layout
    new ResizeObserver(() => {
      const app = $("app");
      if (app.clientWidth === S.g.W && app.clientHeight === S.g.H) return;
      for (const el of document.querySelectorAll("#motes > *")) el.remove();   // their paths were for the old size
      S.render(true);
      render();
      if (params.has("check")) check();
      if (params.has("mote")) S.still(Number(params.get("mote")) || 0.5);
    }).observe($("app"));
    // nothing runs while nobody looks: the animations pause and the replay stops
    document.addEventListener("visibilitychange", () => {
      $("app").classList.toggle("is-hidden", document.hidden);
      if (document.hidden) S.replayStop(); else S.replay();
    });

    // `?check` counts label collisions; `?press=Tab,1` plays keys, so a headless shot can
    // photograph what the keyboard does
    if (params.has("check")) check();
    if (params.has("mote")) { S.replayStop(); S.still(Number(params.get("mote")) || 0.5); }
    (params.get("press") || "").split(",").filter(Boolean).forEach((k, i) =>
      setTimeout(() => {
        if (k[0] === "@") { const el = document.querySelector(k.slice(1)); if (el) el.click(); return; }   // `@.motion` clicks
        document.dispatchEvent(new KeyboardEvent("keydown", { key: k === "ShiftTab" ? "Tab" : k, bubbles: true, cancelable: true, shiftKey: k === "ShiftTab" }));
      }, 250 + i * 140));
  }).catch((err) => {
    $("app").innerHTML = `<p class="fatal">No capture could be loaded. Run <code>python capture.py</code> or open with <code>?data=sample</code>.</p>`;
    setTimeout(() => { throw err; });
  });
})();

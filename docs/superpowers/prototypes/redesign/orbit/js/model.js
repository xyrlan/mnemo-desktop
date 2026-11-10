/* Orbit · the model: what the capture means in this scene.
   Nothing here touches the DOM. `O.view` is the page's whole state and mirrors the hash;
   `O.build(data)` derives bodies, bands and what still waits from the capture plus the
   answers given on this page. */
(function () {
  "use strict";
  const O = (window.O = {});
  const M = window.mnemo;

  /* ---------- small helpers ---------- */
  const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  O.esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ESC[c]);
  O.clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  O.tok = M.tokens;
  O.sum = M.sum;
  O.pct = (n) => (n == null ? "–" : Math.round(n) + "%");
  O.base = (p) => String(p || "").replace(/\\/g, "/").replace(/\/+$/, "").split("/").pop();
  O.int = (n) => (n == null ? "–" : Math.round(n).toLocaleString("en-US"));
  O.age = (iso) => M.age(iso, O.data.now);
  O.clock = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  };
  /** "2h 20m" from the capture to a time ahead of it; "" when it is behind or unknown. */
  O.until = (iso) => {
    if (!iso) return "";
    const m = Math.round((Date.parse(iso) - O.data.now) / 60000);
    if (!(m > 0)) return "";
    if (m < 60) return m + "m";
    if (m < 2880) return Math.floor(m / 60) + "h " + String(m % 60).padStart(2, "0") + "m";
    return Math.round(m / 1440) + "d";
  };
  O.model = (id) => String(id || "–").replace(/^claude-/, "").replace(/-(\d+)-(\d+).*$/, " $1.$2");
  O.ms = (n) => (n == null ? "" : n < 1000 ? Math.round(n) + "ms" : n < 60000 ? (n / 1000).toFixed(1) + "s" : Math.round(n / 60000) + "m");
  O.bytes = (n) => (n == null ? "" : n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(1) + " kB" : (n / 1048576).toFixed(1) + " MB");
  O.reduced = () =>
    document.documentElement.dataset.motion === "reduced" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  O.BANDS = [
    { id: "need", name: "needs you", lo: 0.235, hi: 0.43 },
    { id: "working", name: "working", lo: 0.43, hi: 0.62 },
    { id: "idle", name: "your turn", lo: 0.62, hi: 0.845 },
    { id: "ended", name: "ended", lo: 0.845, hi: 0.985 },
  ];
  O.band = Object.fromEntries(O.BANDS.map((b, i) => [b.id, Object.assign(b, { i })]));

  O.KIND = { question: "question", permission: "permission", blocked: "blocked", merge: "merge waits", stalled: "stalled" };
  O.KIND_GLYPH = { question: "◆", permission: "◆", blocked: "◆", merge: "▲", stalled: "✕" };

  /* ---------- the view: one object, one hash ---------- */
  // s: focused session (station) · r: reading · p: pending card open on a session
  // c: the scene's cursor · q: finder text · vault: the centre is open
  // a: answers given on this page, {pendingKey: choiceIndex}
  O.view = { s: null, r: "context", p: null, c: null, q: null, vault: false, a: {} };
  O.READINGS = ["context", "memory", "sight"];

  O.readHash = function () {
    const v = { s: null, r: "context", p: null, c: null, q: null, vault: false, a: {} };
    for (const part of location.hash.replace(/^#/, "").split("&")) {
      if (!part) continue;
      const i = part.indexOf("=");
      const k = i < 0 ? part : part.slice(0, i);
      let val = "";
      try { val = i < 0 ? "" : decodeURIComponent(part.slice(i + 1)); } catch (e) { val = ""; }
      if (k === "vault") v.vault = true;
      else if (k === "a") {
        for (const one of val.split(",")) {
          const m = /^(.+)\.(\d+)$/.exec(one);
          if (m) v.a[m[1]] = Number(m[2]);
        }
      } else if (k === "r") { if (O.READINGS.includes(val)) v.r = val; }
      else if (k in v) v[k] = val || null;
    }
    O.view = v;
    return v;
  };

  O.hashOf = function (v) {
    const out = [];
    if (v.vault) out.push("vault");
    if (v.s) out.push("s=" + v.s);
    if (v.s && v.r !== "context") out.push("r=" + v.r);
    if (v.p) out.push("p=" + v.p);
    if (v.c && !v.s) out.push("c=" + v.c);
    if (v.q != null) out.push("q=" + encodeURIComponent(v.q));
    const a = Object.keys(v.a).map((k) => k + "." + v.a[k]);
    if (a.length) out.push("a=" + a.join(","));
    return out.join("&");
  };

  /* ---------- what waits, and what an answer does ---------- */
  // Every pending row offers numbered choices; `to` is the state the session takes when the
  // choice is made (null: the choice changes nothing and the row keeps waiting).
  function choicesFor(p) {
    const goOn = { label: "Tell it to continue", description: "It picks the work back up.", to: "working" };
    const stop = { label: "Stop it", description: "The session ends here.", to: "ended" };
    if (p.kind === "question" && p.options && p.options.length)
      return p.options.map((o) => ({ label: o.label, description: o.description || "", to: "working" }));
    if (p.kind === "permission")
      return [
        { label: "Allow", description: "It runs this once and carries on.", to: "working" },
        { label: "Deny", description: "It does not run; the turn comes back to you.", to: "idle" },
      ];
    if (p.kind === "merge") {
      const ci = p.pr && p.pr.ci;
      return [
        {
          label: "Approve and merge",
          description: ci === "green" ? "Checks are green." : ci === "running" ? "Checks are still running: it merges when they pass." : ci === "red" ? "Checks are red." : "No checks reported.",
          to: "ended", merged: true,
        },
        { label: "Not yet", description: "Leave the pull request open.", to: null },
      ];
    }
    const out = [];
    if (p.suggestedReply) out.push({ label: "Send the suggested reply", description: p.suggestedReply, to: "working" });
    out.push(goOn, stop);
    return out;
  }

  /* ---------- build ---------- */
  O.build = function (data) {
    O.data = data;
    const A = O.view.a;
    const byShort = {};
    for (const s of data.sessions) byShort[s.short] = s;

    // pending rows, keyed so a hash can name them
    const seen = {};
    const pending = data.pending.map((p) => {
      const s = data.byId[p.session];
      const n = (seen[s.short] = (seen[s.short] || 0) + 1);
      const key = s.short + (n > 1 ? "~" + n : "");
      const row = { key, s, kind: p.kind, text: p.text || "", at: p.at, pr: p.pr || null, suggestedReply: p.suggestedReply || null, options: p.options || [] };
      row.choices = choicesFor(row);
      const idx = A[key];
      row.answer = idx != null && row.choices[idx] && row.choices[idx].to ? row.choices[idx] : null;
      return row;
    });
    const open = pending.filter((p) => !p.answer);

    // a session's state after the answers given here
    const eff = {};
    for (const s of data.sessions) eff[s.id] = { state: s.state, answers: [], merged: false, open: [] };
    for (const p of pending) {
      const e = eff[p.s.id];
      if (p.answer) {
        e.answers.push({ kind: p.kind, label: p.answer.label, text: p.text });
        e.merged = e.merged || !!p.answer.merged;
      } else e.open.push(p);
    }
    for (const s of data.sessions) {
      const e = eff[s.id];
      const last = pending.filter((p) => p.s === s && p.answer).pop();
      if (last && !e.open.length) e.state = last.answer.to;
    }

    // families
    const rootOf = {};
    const roots = M.roots(data);
    const bodies = [];
    for (const root of roots) {
      const fam = [];
      (function walk(s, depth) {
        fam.push({ s, depth });
        rootOf[s.id] = root;
        for (const id of s.children) if (data.byId[id]) walk(data.byId[id], depth + 1);
      })(root, 0);
      const states = fam.map((f) => eff[f.s.id].state);
      // what waits in this family, the most pressing first: a question before a stall before a merge
      const URGENT = { question: 0, permission: 0, blocked: 1, stalled: 2, merge: 3 };
      const pend = open.filter((p) => fam.some((f) => f.s === p.s))
        .sort((a, b) => (a.s.abandoned ? 9 : URGENT[a.kind]) - (b.s.abandoned ? 9 : URGENT[b.kind]) || (b.at || "").localeCompare(a.at || ""));
      const has = (...st) => states.some((x) => st.includes(x));
      const band = pend.length || has("need", "stalled", "ready") ? "need"
        : has("working") ? "working"
        : fam.some((f) => f.s.live && eff[f.s.id].state !== "ended") ? "idle" : "ended";
      const lastAt = fam.map((f) => f.s.lastAt || "").sort().pop() || root.startedAt;
      const quiet = Math.max(0, data.now - Date.parse(lastAt || data.capturedAt));
      const logt = (ms, lo, hi) => O.clamp(Math.log(Math.max(ms, lo) / lo) / Math.log(hi / lo), 0, 1);
      let t;
      if (band === "need") {
        // a fresh request is closest; one mnemo gave up on waits at the band's outer edge
        const live = pend.filter((p) => !p.s.abandoned);
        const newest = live.map((p) => p.at || "").sort().pop();
        t = !live.length ? (pend.length ? 1 : 0.5) : logt(Math.max(0, data.now - Date.parse(newest || data.capturedAt)), 60e3, 7 * 864e5);
      } else if (band === "working") t = logt(quiet, 20e3, 36e5);
      else if (band === "idle") t = logt(quiet, 60e3, data.windowHours * 36e5);
      else t = logt(quiet, 6e5, data.windowHours * 36e5);
      const b = O.band[band];
      const tree = O.sum(root.totals && root.totals.tree);
      bodies.push({
        id: root.id, s: root, project: root.project || "–", fam, band, t,
        rho: b.lo + (0.14 + 0.72 * t) * (b.hi - b.lo),
        tree, size: O.clamp((Math.log10(Math.max(tree, 1)) - 5.3) / (9 - 5.3), 0, 1),
        pend, quiet, lastAt,
        kids: fam.slice(1),
        rules: fam.reduce((n, f) => n + f.s.memory.injected.length + f.s.memory.read.length, 0),
      });
    }

    // projects that have a body, in the capture's order
    const projects = [];
    for (const p of data.projects) {
      const mine = bodies.filter((b) => b.project === p.name).sort((a, b) => (a.s.startedAt || "").localeCompare(b.s.startedAt || ""));
      if (mine.length) projects.push({ name: p.name, xp: p.xp, bodies: mine });
    }
    const named = new Set(projects.map((p) => p.name));
    const stray = bodies.filter((b) => !named.has(b.project));
    if (stray.length) projects.push({ name: stray[0].project, xp: null, bodies: stray });

    const count = { need: 0, working: 0, ready: 0, idle: 0, ended: 0, stalled: 0 };
    for (const s of data.sessions) count[eff[s.id].state]++;

    const m = { data, byShort, pending, open, eff, rootOf, bodies, projects, count,
      body: Object.fromEntries(bodies.map((b) => [b.id, b])) };
    O.m = m;
    return m;
  };

  O.eff = (s) => O.m.eff[s.id];
  O.state = (s) => O.m.eff[s.id].state;
  O.bodyOf = (s) => O.m.body[O.m.rootOf[s.id].id];
  O.session = (short) => (short && O.m.byShort[short]) || null;
  /** The first row still waiting on this session, or null. */
  O.openFor = (s) => O.m.eff[s.id].open[0] || null;

  /** What a session is doing, in its own words: one line. */
  O.doing = function (s) {
    const st = O.state(s);
    const run = s.activity.filter((a) => a.running).pop();
    const last = s.activity[s.activity.length - 1];
    if (st === "working" && (run || last)) {
      const a = run || last;
      return (a.tool || a.kind) + (a.target ? " " + a.target : "");
    }
    if (s.detail && st !== "ended") return s.detail;
    const text = (s.said && s.said.text) || (s.recap && s.recap.text) || s.lastPrompt || s.intent || "";
    return text.replace(/\s+/g, " ").trim();
  };

  /** Every memory event of the capture, oldest first: what the motes replay. */
  O.memoryEvents = function () {
    const out = [];
    for (const s of O.data.sessions) {
      for (const r of s.memory.injected) out.push({ at: r.at, kind: "injected", slug: r.slug, s });
      for (const r of s.memory.read) out.push({ at: r.at, kind: "read", slug: r.slug || r.topic || r.query || r.tool, s });
    }
    return out.filter((e) => e.at && e.slug).sort((a, b) => a.at.localeCompare(b.at));
  };
})();

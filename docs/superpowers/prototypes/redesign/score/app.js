/* The page: its state lives in `location.hash`, the lines are drawn by draw.js, and the now
   column, the inspector and everything that moves are DOM.

       #sel=<short>          the selected line (the inspector opens beside the score)
       &at=<ISO time>        the playhead, held at a moment; absent means now
       &span=12h &end=<ISO>  the zoom, and the right edge when it is not now
       &tab=context|memory|sight   &term=1 (the terminal, full height)
       &fold=<short>,…       parents whose children are folded the other way than the default
       &done=<short>:<code>,…  what the maintainer answered here: 1-9 a choice, a approve,
                             d deny, r reply. It changes this page and nothing else.
       &keys=1               the key sheet */
(function () {
  "use strict";
  const S = window.score, D = S.draw, F = S.fmt, M = window.mnemo;
  const { MIN, HOUR, DAY } = S;
  const $ = (id) => document.getElementById(id);
  const tokens = (n) => M.tokens(n == null ? null : Math.round(n));

  /** A DOM node. Text always goes in as text: the capture holds whatever a session wrote. */
  function h(tag, props, ...kids) {
    const node = document.createElement(tag);
    for (const k in props || {}) {
      const v = props[k];
      if (v == null || v === false) continue;
      if (k === "class") node.className = v;
      else if (k === "data") { for (const d in v) if (v[d] != null) node.dataset[d] = v[d]; }
      else if (k === "style") node.style.cssText = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat(3)) if (kid != null && kid !== false && kid !== "") node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return node;
  }
  /** Markup written in this file, never data. */
  function art(cls, markup, props) {
    const node = h("span", Object.assign({ class: cls, "aria-hidden": "true" }, props));
    node.innerHTML = markup;
    return node;
  }
  const kbd = (key) => h("kbd", null, key);

  /* A state is a shape first: these are the six, and the outline of a line not yet begun. */
  const SHAPE = {
    need: '<svg viewBox="-8 -8 16 16"><path d="M0-6.6 6.6 0 0 6.6-6.6 0Z" fill="currentColor"/></svg>',
    working: '<svg viewBox="-8 -8 16 16"><circle r="4.4" fill="currentColor"/><circle class="echo" r="4.4" fill="none" stroke="currentColor"/></svg>',
    ready: '<svg viewBox="-8 -8 16 16"><path d="M0-6 6.6 5.2H-6.6Z" fill="currentColor"/></svg>',
    stalled: '<svg viewBox="-8 -8 16 16"><path d="M-5-5 5 5M5-5-5 5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" fill="none"/></svg>',
    idle: '<svg viewBox="-8 -8 16 16"><circle r="4.6" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
    ended: '<svg viewBox="-8 -8 16 16"><circle r="2" fill="currentColor"/></svg>',
    future: '<svg viewBox="-8 -8 16 16"><circle r="4.6" fill="none" stroke="currentColor" stroke-width="1" stroke-dasharray="1.6 2.6"/></svg>',
  };
  const WORD = Object.assign({ future: "not started" }, M.WORD);
  const SHORT_WORD = Object.assign({}, WORD, { ready: "to merge", need: "needs you", future: "not yet" });

  /** A session's figure: a small constellation worked out from its id, so two sessions never
      share one. A stand-in for a generated figure (NOTES.md). */
  function figure(id) {
    let seed = 7;
    for (const ch of String(id)) seed = (Math.imul(seed, 31) + ch.charCodeAt(0)) >>> 0;
    const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    const pts = [];
    for (let guard = 0; pts.length < 5 && guard < 60; guard++) {
      const p = [3 + rnd() * 22, 3 + rnd() * 22];
      if (pts.every((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) > 6.5)) pts.push(p);
    }
    const f = (n) => n.toFixed(1);
    const line = pts.map((p, i) => (i ? "L" : "M") + f(p[0]) + " " + f(p[1])).join("");
    const dots = pts.map((p, i) => '<circle cx="' + f(p[0]) + '" cy="' + f(p[1]) + '" r="' + (i === 0 ? 1.9 : 1.1) + '"/>').join("");
    return '<svg viewBox="0 0 28 28"><path d="' + line + '"/>' + dots + "</svg>";
  }

  const CORE =
    '<svg class="ring r3" viewBox="-50 -50 100 100"><circle r="46" pathLength="360" stroke-dasharray="96 24 58 20 130 32"/><circle class="dot" cx="46" cy="0" r="1.7"/></svg>' +
    '<svg class="ring r2" viewBox="-50 -50 100 100"><circle r="34" pathLength="360" stroke-dasharray="1 5"/></svg>' +
    '<svg class="ring r1" viewBox="-50 -50 100 100"><circle r="22"/><path d="M0-22v-6M0 22v6M-22 0h-6M22 0h6"/></svg>' +
    '<svg class="heart" viewBox="-50 -50 100 100"><path d="M0-12 12 0 0 12-12 0Z"/><path class="in" d="M0-4.6 4.6 0 0 4.6-4.6 0Z"/></svg>';
  /* ---- state ---- */

  const SPANS = [["48h", 48 * HOUR], ["24h", 24 * HOUR], ["12h", 12 * HOUR], ["6h", 6 * HOUR], ["2h", 2 * HOUR], ["30m", 30 * MIN]];
  const TABS = [["context", "Context & tokens", "C"], ["memory", "Memory", "M"], ["sight", "Sight", "S"]];
  const DEFAULT_SPAN = 12 * HOUR;
  const view = { sel: null, at: null, span: DEFAULT_SPAN, end: null, tab: "context", term: false, flip: new Set(), done: new Map(), keys: false };

  let data = null;
  let rows = [];
  let rowOf = new Map();
  let scrub = null;      // the playhead while it is being dragged
  let previous = null;   // the line selected before this one
  let strip = null;      // what the strip last drew, for its tooltip
  let frame = 0;
  let maxTree = 1;

  const app = $("app"), rowsEl = $("rows"), track = $("track"), cards = $("cards");
  const scoreC = $("score"), rulerC = $("ruler"), stripC = $("strip");
  const playhead = $("playhead"), dim = $("dim"), hair = $("hair"), tip = $("tip");

  const iso = (t) => new Date(Math.round(t / 1000) * 1000).toISOString().replace(".000Z", "Z");
  const parseSpan = (text) => {
    const m = /^(\d+(?:\.\d+)?)(m|h|d)$/.exec(text || "");
    return m ? Math.min(14 * DAY, Math.max(10 * MIN, m[1] * { m: MIN, h: HOUR, d: DAY }[m[2]])) : null;
  };
  const spanText = (span) => (span % HOUR === 0 ? span / HOUR + "h" : Math.round(span / MIN) + "m");

  function readHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    const want = p.get("sel");
    const s = want && data.sessions.find((x) => x.short === want || x.id === want);
    const at = S.ms(p.get("at")), end = S.ms(p.get("end"));
    view.sel = s ? s.id : null;
    view.at = at != null && at < data.now ? at : null;
    view.span = parseSpan(p.get("span")) || DEFAULT_SPAN;
    view.end = end != null && end < data.now ? end : null;
    view.tab = TABS.some((t) => t[0] === p.get("tab")) ? p.get("tab") : "context";
    view.term = p.get("term") === "1" && !!s;
    view.flip = new Set((p.get("fold") || "").split(",").filter(Boolean));
    view.done = new Map((p.get("done") || "").split(",").filter(Boolean).map((x) => x.split(":")).filter((x) => x.length === 2));
    view.keys = p.get("keys") === "1";
  }

  function writeHash() {
    const p = [];
    if (view.sel) p.push("sel=" + data.byId[view.sel].short);
    if (view.at != null) p.push("at=" + iso(view.at));
    if (view.span !== DEFAULT_SPAN) p.push("span=" + spanText(view.span));
    if (view.end != null) p.push("end=" + iso(view.end));
    if (view.sel && view.tab !== "context") p.push("tab=" + view.tab);
    if (view.term) p.push("term=1");
    if (view.flip.size) p.push("fold=" + [...view.flip].join(","));
    if (view.done.size) p.push("done=" + [...view.done].map((x) => x.join(":")).join(","));
    if (view.keys) p.push("keys=1");
    const next = p.length ? "#" + p.join("&") : "";
    if (next !== location.hash) history.replaceState(null, "", location.pathname + location.search + next);
  }

  /* What the maintainer did on this page stands in for what the session would do next. */
  const pendOf = (s) => (view.done.has(s.short) ? null : s._.pend);
  function stateOf(s) {
    const code = view.done.get(s.short), p = s._.pend;
    if (!code || !p) return s.state;
    if (p.kind === "merge") return code === "a" ? "ended" : s.state;
    if (p.kind === "permission") return code === "a" ? "working" : "idle";
    return "working";
  }
  const mergedOf = (s) => (s.prs || []).some((p) => p.state === "merged") || (s._.pend && s._.pend.kind === "merge" && view.done.get(s.short) === "a");
  function doneText(s) {
    const code = view.done.get(s.short), p = s._.pend;
    if (!code || !p) return null;
    if (p.kind === "question" && /^\d$/.test(code)) return "answered: " + ((p.options[code - 1] || {}).label || "choice " + code);
    if (p.kind === "merge") return "merge approved" + (p.pr ? " · #" + p.pr.number : "");
    if (p.kind === "permission") return code === "a" ? "allowed: " + p.text : "denied: " + p.text;
    if (p.kind === "stalled") return "nudged to continue";
    return "reply sent" + (p.suggestedReply ? ": " + p.suggestedReply : "");
  }

  const T = () => (scrub != null ? scrub : view.at != null ? view.at : data.now);
  const selected = () => (view.sel ? data.byId[view.sel] : null);
  const waiting = () => rows.filter((r) => r.type === "session" && pendOf(r.s));

  function env() {
    const W = track.clientWidth, to = view.end != null ? view.end : data.now, from = to - view.span, k = W / view.span;
    const sel = selected();
    return {
      W, H: rowsEl.clientHeight, top: rowsEl.scrollTop, k, view: { from, to },
      x: (t) => (t - from) * k, t: (px) => from + px / k,
      data, now: data.now, rows, rowOf, sel: view.sel, stateOf, pendOf, mergedOf, T: T(),
      pick: sel ? new Set([sel.id].concat(sel._.desc.map((d) => d.id))) : null,
    };
  }

  /* ---- the now column ---- */

  function buildRows() {
    rows = S.rows(data, stateOf, view.flip);
    rowOf = new Map();
    cards.replaceChildren();
    for (const row of rows) {
      row.compact = row.type === "session" && (row.depth > 0 || row.s.role === "child");
      row.el = row.type === "group" ? groupCard(row) : row.type === "ensemble" ? ensembleCard(row) : sessionCard(row);
      cards.append(row.el);
      if (row.type === "session") rowOf.set(row.s.id, row);
    }
    maxTree = Math.max(1, ...rows.filter((r) => r.type === "session" && r.depth === 0).map((r) => r.s._.tree));
    measure();
    updateCards();
  }

  function measure() {
    for (const row of rows) {
      row.y = row.el.offsetTop;
      row.h = row.el.offsetHeight;
      row.h0 = row.refs && row.refs.main ? row.refs.main.offsetHeight : row.h;
    }
  }

  function groupCard(row) {
    row.refs = { sub: h("span", { class: "sub" }) };
    return h("div", { class: "group" }, h("span", { class: "name" }, row.project), row.refs.sub);
  }

  function ensembleCard(row) {
    const merged = row.sessions.filter(mergedOf).length;
    row.refs = { sub: h("span", { class: "num" }) };
    return h("button", {
      class: "ensemble", type: "button", style: "--depth:" + row.depth, title: "Unfold these children into their own lines",
      onclick: () => { toggleFold(row.parent); },
    },
      art("fork", '<svg viewBox="0 0 16 16"><path d="M3 2v4c0 4 5 2 5 6v2M13 2v4c0 4-5 2-5 6"/></svg>'),
      h("span", { class: "what" }, row.sessions.length + " ended " + (row.sessions.length === 1 ? "child" : "children") + (merged ? " · " + merged + " merged" : "")),
      row.refs.sub, h("span", { class: "hint" }, kbd("F"), " unfold"));
  }

  function sessionCard(row) {
    const s = row.s, r = (row.refs = {});
    const isSel = s.id === view.sel;
    r.glyph = h("span", { class: "glyph", "aria-hidden": "true" });
    r.word = h("span", { class: "word" });
    r.age = h("span", { class: "age" });
    r.doing = h("div", { class: "doing" });
    r.ctxNum = h("b", { class: "num" });
    r.ctxBar = h("u");
    r.ctxOf = h("span", { class: "of" });
    r.spent = h("b", { class: "num" });
    r.spentBar = h("u");
    r.spentWhat = h("span", { class: "of" });
    const title = h("h3", { class: "title", title: s.title || "" }, s.title || s.name || s.short);
    const card = h("article", {
      class: "card" + (row.compact ? " compact" : "") + (isSel ? " sel" : ""), data: { id: s.id }, style: "--depth:" + row.depth,
      onclick: () => select(s.id, null),
    });
    if (row.compact) {
      r.main = h("div", { class: "main" }, r.glyph, r.word, title, h("span", { class: "meter" }, r.ctxNum), h("span", { class: "meter spent" }, r.spent));
    } else {
      const fold = S.canFold(s, stateOf) ? h("button", {
        class: "chip", type: "button", title: "Fold or unfold its ended children (F)",
        onclick: (ev) => { ev.stopPropagation(); toggleFold(s); },
      }, s._.kids.length + (s._.kids.length === 1 ? " child" : " children")) : s._.kids.length ? h("span", { class: "chip quiet" }, s._.kids.length + (s._.kids.length === 1 ? " child" : " children")) : null;
      r.main = h("div", { class: "main" },
        h("div", { class: "mark" }, r.glyph, art("figure", figure(s.id), { "data-asset": "session-figure" })),
        h("div", { class: "body" },
          h("div", { class: "meta" }, r.word, r.age, h("span", { class: "flex" }), fold, h("span", { class: "project" }, s.project || "")),
          title, r.doing),
        h("div", { class: "meters" },
          h("div", { class: "ctx", title: "How full its context is" }, r.ctxNum, h("i", { class: "bar" }, r.ctxBar), r.ctxOf),
          h("div", { class: "spent", title: "Tokens spent" }, r.spent, h("i", { class: "bar thin" }, r.spentBar), r.spentWhat)));
    }
    card.append(r.main);
    const p = pendOf(s);
    if (p && isSel && T() >= data.now) card.append(askBlock(s, p));
    return card;
  }

  /** What waits, answered where the line meets now: choices as keys. */
  function askBlock(s, p) {
    const act = (key, text, sub, code) => h("button", {
      class: "choice", type: "button",
      onclick: (ev) => { ev.stopPropagation(); if (code === "t") toggleTerm(true); else answer(s, code); },
    }, kbd(key), h("span", { class: "what" }, h("b", null, text), sub ? h("span", null, sub) : null));
    const box = h("div", { class: "ask", data: { kind: p.kind } });
    box.append(h("p", { class: "q" }, p.text || ""));
    if (p.kind === "question") {
      (p.options || []).slice(0, 9).forEach((o, i) => box.append(act(String(i + 1), o.label, o.description, String(i + 1))));
      if (!(p.options || []).length) {
        if (p.suggestedReply) box.append(act("R", "Send the suggested reply", p.suggestedReply, "r"));
        box.append(act("T", "Answer in its terminal", null, "t"));
      }
    } else if (p.kind === "merge") {
      const pr = p.pr || {};
      box.append(h("p", { class: "facts" }, "#" + (pr.number ?? "?"), pr.repo ? " · " + pr.repo : "", " · CI " + (pr.ci || "not run"), pr.mergeable ? " · " + pr.mergeable : ""));
      box.append(act("A", "Approve the merge", pr.ci === "green" ? null : "CI is " + (pr.ci || "not run"), "a"));
    } else if (p.kind === "permission") {
      box.append(act("A", "Allow", null, "a"), act("D", "Deny", null, "d"));
    } else {
      if (p.kind === "stalled") box.append(act("R", "Nudge it to continue", null, "r"));
      else if (p.suggestedReply) box.append(act("R", "Send the suggested reply", p.suggestedReply, "r"));
      box.append(act("T", "Open its terminal", null, "t"));
    }
    return box;
  }

  function doing(s, t) {
    const now = data.now;
    if (t >= now) {
      const said = doneText(s);
      if (said) return { text: "✓ " + said, cls: "done" };
      const p = s._.pend;
      if (p) return { text: p.text || p.kind, cls: "wait" };
      const last = s._.acts[s._.acts.length - 1];
      if (stateOf(s) === "working" && last) return { text: last.tool + "  " + (last.target || ""), cls: "tool" };
      const words = (s.said && s.said.text) || (s.recap && s.recap.text) || s.detail || s.intent || s.lastPrompt;
      return words ? { text: words, cls: "said" } : { text: "nothing said yet", cls: "none" };
    }
    if (s._.t0 == null || t < s._.t0) return { text: s._.t0 == null ? "" : "starts " + F.when(s._.t0, now), cls: "none" };
    const what = S.doingAt(s, t);
    if (what && what.act) return { text: what.act.tool + "  " + (what.act.target || ""), cls: "tool" };
    if (what && what.bucket) return { text: what.bucket.total + " tool calls in these five minutes", cls: "tool" };
    if (s._.pendAt != null && t >= s._.pendAt) return { text: s._.pend.text || "waiting", cls: "wait" };
    return { text: t > s._.t1 ? "nothing since " + F.when(s._.t1, now) : "silent", cls: "none" };
  }

  function updateCards() {
    const t = T(), now = data.now, live = t >= now;
    for (const row of rows) {
      if (row.type === "group") {
        const total = row.sessions.reduce((n, s) => n + S.ownAt(s, t, now), 0);
        row.refs.sub.textContent = row.sessions.length + (row.sessions.length === 1 ? " line · " : " lines · ") + (live ? "" : "≈ ") + tokens(total);
        continue;
      }
      if (row.type === "ensemble") {
        row.refs.sub.textContent = (live ? "" : "≈ ") + tokens(row.sessions.reduce((n, s) => n + S.ownAt(s, t, now), 0));
        continue;
      }
      const s = row.s, r = row.refs, d = s._;
      const state = S.stateAt(s, t, now, stateOf(s)) || "future";
      if (row.el.dataset.state !== state) { row.el.dataset.state = state; r.glyph.innerHTML = SHAPE[state]; }
      r.word.textContent = row.compact ? SHORT_WORD[state] : WORD[state];
      const p = live ? pendOf(s) : null;
      r.age.textContent = !live ? "" : p ? "waiting " + F.span(now - d.pendAt) : view.done.has(s.short) ? "answered here"
        : state === "idle" && d.t1 != null ? "silent " + F.span(now - d.t1) : state === "ended" && d.t1 != null ? F.span(now - d.t1) + " ago" : "";
      const words = doing(s, t);
      r.doing.textContent = words.text;
      r.doing.dataset.kind = words.cls;
      const ctx = S.ctxAt(s, t, now);
      const share = ctx == null ? null : (ctx / d.window) * 100;
      r.ctxNum.textContent = share == null ? "–" : Math.round(share) + "%";
      r.ctxNum.classList.toggle("hot", share != null && share >= 85);
      r.ctxBar.style.width = share == null ? "0" : Math.min(100, share).toFixed(1) + "%";
      r.ctxOf.textContent = ctx == null ? "context" : tokens(ctx) + " of " + tokens(d.window);
      const spent = d.kids.length ? S.treeAt(s, t, now) : S.ownAt(s, t, now);
      r.spent.textContent = (live ? "" : "≈ ") + tokens(spent);
      r.spentBar.style.width = Math.min(100, (spent / maxTree) * 100).toFixed(1) + "%";
      r.spentWhat.textContent = d.kids.length ? "its tree spent" : "spent";
    }
  }

  /* ---- above the now column: the clock, the fleet's total, the plans ---- */

  function renderNowHead() {
    const t = T(), now = data.now, live = t >= now;
    const total = data.sessions.reduce((n, s) => n + S.ownAt(s, t, now), 0);
    const lines = rows.filter((r) => r.type === "session").length;
    const wait = waiting().length;
    const SHORT = { session: "5h", weekly_all: "wk", credits: "cr" };
    const plans = (data.accounts || []).map((a) => {
      const cell = (kind) => {
        const l = (a.limits || []).find((x) => x.kind === kind);
        if (!l) return h("span", { class: "limit none " + kind }, "\u2013");
        const win = S.planWindow(l);
        return h("span", { class: "limit " + kind, title: S.limitName(l) + (win ? " window, resets " + F.day(win.to) + " " + F.clock(win.to) : ""), data: { severity: l.severity && l.severity !== "normal" ? l.severity : null } },
          h("em", null, kind === "weekly_scoped" ? l.model || "scoped" : SHORT[kind] || kind), kind === "session" ? h("i", { class: "bar" }, h("u", { style: "width:" + Math.min(100, l.percent || 0) + "%" })) : null,
          h("b", { class: "num" }, F.pct(l.percent)),
          kind === "session" && win ? h("span", { class: "reset" }, win.to > now ? F.span(win.to - now) + " left" : "over") : null);
      };
      return [h("span", { class: "acct" + (a.active ? " active" : ""), title: a.active ? "The account new sessions use" : null }, a.label || a.id), cell("session"), cell("weekly_all"), cell("weekly_scoped")];
    });
    $("nowhead").replaceChildren(
      art("core", CORE, { "data-asset": "memory-core" }),
      h("div", { class: "now" },
        h("div", { class: "clock" }, h("span", { class: "label" }, live ? "Now" : "As of"), h("b", { class: "num" }, F.clock(t)), h("span", { class: "date" }, F.day(t))),
        h("div", { class: "fleet" }, h("b", { class: "num" }, (live ? "" : "≈ ") + tokens(total)), h("span", { class: "label" }, "tokens", h("span", { class: "more" }, " · " + data.sessions.length + " sessions"))),
        h("div", { class: "plans" }, plans)),
      h("div", { class: "colhead" + (live ? "" : " replay") },
        live
          ? [h("span", { class: "label" }, lines + " lines"), wait ? h("span", { class: "label wait" }, wait + " waiting") : h("span", { class: "label" }, "nothing waits")]
          : [h("span", { class: "label" }, "replay · " + F.span(now - t) + " ago"),
             h("button", { class: "back", type: "button", onclick: () => { scrub = null; view.at = null; renderAll(); } }, "Now ", kbd("Esc"))]));
  }

  function renderBar(e) {
    const following = e.view.to >= data.now;
    app.dataset.follow = following ? "yes" : "no";
    const range = [h("b", null, F.day(e.view.from) + " " + F.clock(e.view.from)), " → ", h("b", null, following ? "now" : F.day(e.view.to) + " " + F.clock(e.view.to))];
    if (!following) range.push(h("button", { class: "tonow", type: "button", onclick: () => { view.end = null; renderAll(); } }, "to now ", kbd("Esc")));
    $("range").replaceChildren(...range);
    const zoom = $("zoom");
    if (!zoom.childElementCount) for (const [name, span] of SPANS) zoom.append(h("button", { type: "button", data: { span }, onclick: () => setSpan(span) }, name));
    for (const b of zoom.children) b.classList.toggle("on", Number(b.dataset.span) === view.span);
    const wait = waiting().length;
    const pending = $("pending");
    pending.dataset.count = wait;
    pending.replaceChildren(wait ? wait + " waiting " : "Nothing waits ", wait ? kbd("Space") : "");
    $("motion").textContent = "Motion: " + (document.documentElement.dataset.motion === "reduced" ? "reduced" : "full");
    $("stripnote").textContent = strip ? "per " + (strip.stepMs < HOUR ? strip.stepMs / MIN + " min" : strip.stepMs / HOUR + " h") + " · peak " + tokens(strip.peak) + (view.sel ? " · white is the selected line and its children" : "") + " · estimated from each call's context" : "";
  }

  /* ---- drawing ---- */

  function drawAll() {
    if (!data) return;
    const e = env();
    scoreC.style.width = e.W + "px";
    scoreC.style.height = e.H + "px";
    stripC.style.width = rulerC.style.width = e.W + "px";
    D.drawScore(scoreC, e);
    D.drawRuler(rulerC, e);
    strip = D.drawStrip(stripC, e);
    place(e);
    renderBar(e);
  }

  /** Everything that sits over the canvas: the seam, the playhead, the waiting bands. */
  function place(e) {
    app.style.setProperty("--seam", e.W + "px");
    const over = $("over"), under = $("under");
    over.replaceChildren();
    under.replaceChildren();
    for (const row of rows) {
      if (row.type !== "session") continue;
      const s = row.s, g = D.geom(row);
      if (s.id === view.sel) under.append(h("div", { class: "band sel", style: "top:" + row.y + "px;height:" + row.h + "px" }));
      const p = pendOf(s);
      if (p) {
        const left = Math.max(0, Math.min(e.W - 28, e.x(s._.pendAt)));
        if (e.view.to >= data.now) over.append(h("div", { class: "waiting", data: { state: s.state }, style: "top:" + (g.yB - 9) + "px;left:" + left + "px;width:" + (e.W - left) + "px" },
          h("i"), e.W - left > 120 ? h("span", null, "waiting " + F.span(data.now - s._.pendAt)) : null));
        if (row.h - row.h0 > 60) over.append(h("div", { class: "waitbig", data: { state: s.state }, style: "top:" + (row.y + row.h0 + 6) + "px" },
          h("b", { class: "num" }, F.span(data.now - s._.pendAt)), h("span", { class: "label" }, "it has waited since " + F.when(s._.pendAt, data.now))));
      } else if (stateOf(s) === "working" && e.view.to >= data.now) {
        over.append(h("div", { class: "pulse", style: "top:" + g.yB + "px;left:" + e.W + "px" }));
      }
    }
    placePlayhead(e);
  }

  function placePlayhead(e) {
    const t = T(), px = e.x(t);
    const on = t < data.now && px >= 0 && px <= e.W;
    playhead.hidden = dim.hidden = !on;
    if (!on && app.dataset.returning === "yes") { playhead.hidden = false; playhead.style.transform = "translateX(" + e.W + "px)"; $("flag").textContent = "now"; return; }
    if (!on) return;
    playhead.style.transform = "translateX(" + px.toFixed(1) + "px)";
    dim.style.left = px.toFixed(1) + "px";
    dim.style.width = (e.W - px).toFixed(1) + "px";
    $("flag").textContent = F.when(t, data.now) + "  ·  " + F.span(data.now - t) + " ago";
    $("flag").classList.toggle("flip", px > e.W - 190);
  }

  const schedule = (fn) => { cancelAnimationFrame(frame); frame = requestAnimationFrame(fn); };

  function renderAll() {
    if (view.sel && !data.byId[view.sel]) view.sel = null;
    app.dataset.inspector = view.sel ? "open" : "closed";
    app.dataset.term = view.term ? "full" : "split";
    app.dataset.replay = T() < data.now ? "on" : "off";
    buildRows();
    // a selected child that sits folded in its parent's ensemble gets its own line
    for (let guard = 0; guard < 4 && view.sel && !rowOf.has(view.sel); guard++) {
      const packed = rows.find((r) => r.type === "ensemble" && r.sessions.some((k) => k.id === view.sel));
      if (!packed) break;
      if (view.flip.has(packed.parent.short)) view.flip.delete(packed.parent.short); else view.flip.add(packed.parent.short);
      buildRows();
    }
    writeHash();
    renderNowHead();
    renderInspector();
    renderSheet();
    drawAll();
  }

  /* ---- the inspector ---- */

  function renderInspector() {
    const s = selected(), box = $("inspector");
    if (!s) { box.replaceChildren(); return; }
    const d = s._, now = data.now, t = T();
    const state = S.stateAt(s, t, now, stateOf(s)) || "future";
    const parent = s.parent && data.byId[s.parent];
    const account = (data.accounts || []).find((a) => a.id === s.account);
    const fact = (name, value) => (value == null || value === "" ? null : h("span", { class: "fact" }, h("em", null, name), value));
    const head = h("header", { class: "who", data: { state } },
      h("div", { class: "top" },
        art("glyph", SHAPE[state]), h("span", { class: "word" }, WORD[state]),
        t < now ? h("span", { class: "asof" }, "as of " + F.when(t, now)) : null,
        h("span", { class: "flex" }),
        h("button", { class: "ghost", type: "button", onclick: () => toggleTerm() }, view.term ? "Readings " : "Terminal ", kbd("T")),
        h("button", { class: "ghost", type: "button", title: "Close", onclick: () => select(null, view.at) }, "Close ", kbd("Esc"))),
      h("div", { class: "name" }, art("figure", figure(s.id), { "data-asset": "session-figure" }), h("h2", null, s.title || s.name || s.short)),
      h("div", { class: "facts" },
        fact("project", s.project), fact("branch", (s.worktree && s.worktree.branch) || s.branch),
        fact("model", F.model(s.model) + (s.effort ? " · " + s.effort : "")), fact("account", account ? account.label || account.id : s.account),
        fact("started", d.t0 == null ? null : F.when(d.t0, now)), fact("turns", s.turns || null),
        parent ? h("button", { class: "fact link", type: "button", onclick: () => select(parent.id, view.at) }, h("em", null, "child of"), parent.title || parent.short) : null,
        s.parentMissing ? fact("child of", "a session outside the capture") : null,
        d.kids.length ? fact("children", d.kids.length) : null));

    const tabs = h("nav", { class: "tabs" }, TABS.map(([id, name, key]) =>
      h("button", { type: "button", class: id === view.tab ? "on" : "", onclick: () => { view.tab = id; view.term = false; renderAll(); } }, name, " ", kbd(key))));
    const reading = h("div", { class: "reading", id: "reading" });
    box.replaceChildren(head, terminal(s, t), tabs, reading);
    renderReading();

    const term = box.querySelector(".term .lines"), mark = term.querySelector(".moment");
    term.scrollTop = mark ? mark.offsetTop - term.clientHeight / 2 : term.scrollHeight;
  }

  function renderReading() {
    const s = selected(), box = $("reading");
    if (!s || !box) return;
    const t = T();
    const later = [];
    box.replaceChildren(...(view.tab === "memory" ? readMemory(s, t) : view.tab === "sight" ? readSight(s, t) : readContext(s, t, later)));
    for (const fn of later) fn();
  }

  /** Where the terminal will sit. The capture has no terminal, so this is the session's own
      words and tool calls in order, scrolled to the selected moment. */
  function terminal(s, t) {
    const d = s._, now = data.now;
    const list = [];
    if (d.t0 != null) list.push({ t: d.t0, type: "rule", text: "session started · " + F.model(s.model) + (s.effort ? " · " + s.effort : "") });
    for (const a of d.acts) list.push({ t: a.t, type: "act", a });
    for (const m of d.injected) if (d.t0 != null && m.t >= d.t0 - MIN) list.push({ t: m.t, type: "memory", m });
    for (const c of d.compactions) list.push({ t: c.t, type: "rule", text: "context compacted · " + tokens(c.pre) + " → " + tokens(c.post) + (c.trigger ? " · " + c.trigger : "") });
    const saidAt = s.said ? S.ms(s.said.at) ?? d.t1 : null;
    if (s.lastPrompt) {
      const before = d.prompts.filter((p) => saidAt == null || p <= saidAt);
      list.push({ t: before.length ? before[before.length - 1] - 1 : (saidAt ?? d.t1 ?? now) - 2, type: "prompt", text: s.lastPrompt });
    }
    if (s.recap && s.recap.text && !(s.said && s.said.text === s.recap.text)) list.push({ t: S.ms(s.recap.at) ?? d.t1, type: "recap", text: s.recap.text });
    if (s.said && s.said.text) list.push({ t: saidAt, type: "said", text: s.said.text });
    if (d.pend) list.push({ t: d.pendAt, type: "pend", p: d.pend });
    const order = { rule: 0, prompt: 1, memory: 2, act: 3, recap: 4, said: 5, pend: 6 };
    list.sort((a, b) => a.t - b.t || order[a.type] - order[b.type]);

    const lines = h("div", { class: "lines" });
    if (s.activityTotal > d.acts.length) lines.append(h("div", { class: "tl", data: { type: "rule" } }, h("span", { class: "at" }), h("span", { class: "tx" }, (s.activityTotal - d.acts.length).toLocaleString("en") + " earlier tool calls are not in the capture")));
    let marked = t >= now;
    for (const item of list) {
      if (!marked && item.t > t) {
        lines.append(h("div", { class: "tl moment" }, h("span", { class: "at" }, F.clockS(t)), h("span", { class: "tx" }, "the selected moment")));
        marked = true;
      }
      const at = h("span", { class: "at" }, F.clockS(item.t));
      let tx;
      if (item.type === "act") {
        const a = item.a;
        tx = h("span", { class: "tx", data: { ok: a.ok === false ? "no" : null, running: a.running && s.live ? "yes" : null } },
          h("b", null, a.tool || a.kind), "(", h("span", { class: "target" }, a.target || ""), ")",
          h("span", { class: "took" }, a.ok === false ? "failed · " : "", a.running && s.live ? "running" : F.took(a.ms)));
      } else if (item.type === "memory") {
        tx = h("span", { class: "tx" }, "mnemo gave it a rule · ", h("b", null, item.m.slug), item.m.judge != null ? " · relevance " + Number(item.m.judge).toFixed(2) : "");
      } else if (item.type === "pend") {
        const p = item.p, said = doneText(s);
        tx = h("span", { class: "tx" }, h("b", null, { question: "It asks", permission: "It asks permission", merge: "A merge waits", stalled: "It stalled", blocked: "It is blocked" }[p.kind] || p.kind), " · " + (p.text || ""),
          (p.options || []).map((o, i) => h("span", { class: "opt" }, i + 1 + ". " + o.label)),
          said ? h("span", { class: "opt done" }, "✓ " + said + " (on this page only)") : null);
      } else {
        tx = h("span", { class: "tx" }, item.text);
      }
      lines.append(h("div", { class: "tl", data: { type: item.type } }, at, tx));
    }
    if (!marked) lines.append(h("div", { class: "tl moment" }, h("span", { class: "at" }, F.clockS(t)), h("span", { class: "tx" }, "the selected moment")));
    if (s.live) lines.append(h("div", { class: "tl", data: { type: "caret" } }, h("span", { class: "at" }), h("span", { class: "tx" }, "❯ ", h("i", { class: "caret" }))));
    return h("section", { class: "term", "data-asset": "terminal-pane" },
      h("div", { class: "termhead" }, h("span", { class: "label" }, "Terminal"), h("span", { class: "cwd" }, s.cwd || ""), h("span", { class: "flex" }),
        h("span", { class: "standin" }, "stand-in · the live pane sits here")),
      lines);
  }

  const section = (title, count, ...body) => h("section", { class: "sec" }, h("h4", null, h("span", { class: "label" }, title), count == null ? null : h("span", { class: "count num" }, count)), body);
  const none = (text) => h("p", { class: "none" }, text);
  /** A row of a reading; `at` dims it when it is later than the selected moment. */
  const item = (t, at, ...kids) => h("div", { class: "it" + (at != null && at > t ? " later" : "") }, h("span", { class: "at" }, at == null ? "" : F.when(at, data.now)), h("div", { class: "what" }, kids));
  const meter = (value, max, cls) => h("i", { class: "bar " + (cls || "") }, h("u", { style: "width:" + (max ? Math.min(100, (value / max) * 100).toFixed(1) : 0) + "%" }));
  const brow = (name, value, max, note, cls, onclick) => h(onclick ? "button" : "div", { class: "brow" + (onclick ? " link" : ""), type: onclick ? "button" : null, onclick },
    h("span", { class: "name" }, name), meter(value, max, cls), h("b", { class: "num" }, tokens(value)), h("span", { class: "note" }, note || ""));

  function readContext(s, t, later) {
    const d = s._, now = data.now, live = t >= now;
    const ctx = S.ctxAt(s, t, now), share = S.spentShare(s, t, now);
    const account = (data.accounts || []).find((a) => a.id === s.account);
    const big = (name, value, note) => h("div", { class: "big" }, h("span", { class: "label" }, name), h("b", { class: "num" }, value), h("span", { class: "note" }, note));
    const out = [];
    out.push(h("div", { class: "bigs" },
      big("Context" + (live ? "" : " then"), ctx == null ? "–" : tokens(ctx), ctx == null ? "no call yet" : Math.round((ctx / d.window) * 100) + "% of " + tokens(d.window)),
      big("Spent, itself", (live ? "" : "≈ ") + tokens(d.own * share), live ? "main chain, side chain, sub-agents" : Math.round(share * 100) + "% of " + tokens(d.own) + " by then"),
      big("Spent, its tree", (live ? "" : "≈ ") + tokens(S.treeAt(s, t, now)), d.desc.length ? "with " + d.desc.length + (d.desc.length === 1 ? " child" : " children") : "no children")));

    const chart = h("canvas", { class: "ctxchart", style: "height:" + (150 + ((account && account.limits) || []).length * 16) + "px" });
    const before = d.compactions.filter((c) => c.t <= t);
    const last = before[before.length - 1];
    out.push(section("Context over its life" + (account ? " · " + (account.label || account.id) + "'s plan windows" : ""), null, chart,
      h("p", { class: "say" }, last
        ? "Last compacted " + F.span(t - last.t) + (live ? " ago" : " before this moment") + ": " + tokens(last.pre) + " → " + tokens(last.post) + (last.trigger ? " (" + last.trigger + ")" : "") + ". " + d.compactions.length + " in all."
        : d.compactions.length ? "Not compacted yet at this moment; " + d.compactions.length + " later." : "Never compacted.")));
    later.push(() => D.drawContext(chart, s, { now, T: t, account }));

    const own = (s.totals && s.totals.own) || (s.tokens && s.tokens.main);
    if (own) {
      const kinds = [["Cache read", own.cacheRead], ["Cache written", own.cacheCreation], ["Input", own.input], ["Output", own.output]];
      const max = Math.max(1, ...kinds.map((k) => k[1] || 0));
      out.push(section("Spent by kind", tokens(d.own),
        kinds.map(([name, n]) => brow(name, n || 0, max, name === "Output" && own.thinking ? tokens(own.thinking) + " of it thinking" : "")),
        live ? null : h("p", { class: "say" }, "About " + Math.round(share * 100) + "% of this had been spent by " + F.when(t, now) + ".")));
    }

    const tk = s.tokens || {};
    const parts = [["Its own calls", S.sum(tk.main), ""]];
    if (S.sum(tk.sidechain)) parts.push(["Side chain", S.sum(tk.sidechain), ""]);
    for (const a of tk.subagents || []) parts.push([a.description || a.type || "sub-agent", S.sum(a.tokens), [a.type, F.model(a.model), a.calls != null ? a.calls + " calls" : ""].filter(Boolean).join(" · ")]);
    const maxPart = Math.max(1, ...parts.map((p) => p[1]), ...d.kids.map((k) => k._.tree));
    out.push(section("Where it went", (tk.subagents || []).length ? (tk.subagents || []).length + " sub-agents" : null, parts.map(([name, n, note]) => brow(name, n, maxPart, note))));
    if (d.kids.length) {
      out.push(section("Its tree", tokens(d.tree),
        brow("Itself", d.own, maxPart, ""),
        d.kids.map((k) => brow(k.title || k.short, k._.tree, maxPart, WORD[stateOf(k)] + (k._.kids.length ? " · with its own children" : ""), "", () => select(k.id, view.at)))));
    }
    const models = Object.entries(tk.byModel || {});
    if (models.length > 1) {
      const maxModel = Math.max(1, ...models.map((m) => S.sum(m[1])));
      out.push(section("By model", null, models.map(([name, row]) => brow(F.model(name), S.sum(row), maxModel, ""))));
    }
    if (s.cost) {
      const c = s.cost;
      out.push(section("What Claude Code recorded", null, h("p", { class: "say" },
        [c.usd != null ? "$" + Number(c.usd).toFixed(2) : null, c.apiMs != null ? F.span(c.apiMs) + " waiting on the API" : null, c.toolMs != null ? F.span(c.toolMs) + " in tools" : null,
         c.linesAdded != null ? "+" + c.linesAdded + " −" + (c.linesRemoved || 0) + " lines" : null].filter(Boolean).join(" · "))));
    }
    return out;
  }

  const REASON = {
    judge_none_relevant: "the judge found none relevant", notice_below_bar: "below the bar for a notice", deduped: "already given in this session",
    below_min_tokens: "the prompt was too short", session_cap_reached: "this session had its share", no_term_match: "no rule shares a word with it",
    absolute_floor_fail: "every candidate scored under the floor",
  };

  function readMemory(s, t) {
    const d = s._, m = s.memory || {}, out = [];
    const gave = d.injected.filter((x) => x.t <= t).length, held = d.considered.filter((x) => x.t <= t).length;
    out.push(h("p", { class: "say lead" }, "mnemo looked at " + (m.prompts || 0) + " of its prompts. By this moment it had given " + gave + (gave === 1 ? " rule" : " rules") + " and held back " + held + (held === 1 ? " time" : " times") + "; the session asked for rules " + d.asked.filter((x) => x.t <= t).length + " times."));

    out.push(section("Loaded when it started", (m.instructions || []).length + (m.briefings || []).length,
      (m.instructions || []).map((x) => item(t, null, h("span", { class: "tag" }, x.type), h("span", { class: "path", title: x.path }, F.tail(x.path, 3)), h("span", { class: "note" }, F.bytes(x.bytes)))),
      (m.briefings || []).map((x) => item(t, null, h("span", { class: "tag" }, "briefing"), h("span", { class: "path" }, (x.project || "") + " · " + (x.date || "")), h("span", { class: "note" }, (x.entries ?? "?") + " entries · " + (x.source || "")))),
      (m.instructions || []).length + (m.briefings || []).length ? null : none("Nothing recorded.")));

    out.push(section("Rules mnemo gave it", d.injected.length,
      d.injected.map((x) => item(t, x.t, art("dia", '<svg viewBox="-6 -6 12 12"><path d="M0-5 5 0 0 5-5 0Z"/></svg>'), h("b", { class: "slug" }, x.slug),
        h("span", { class: "note" }, "score " + Number(x.score || 0).toFixed(2)), x.judge == null ? null : [meter(x.judge, 1, "mem"), h("span", { class: "note" }, "relevance " + Number(x.judge).toFixed(2))])),
      d.injected.length ? null : none("None in this session.")));

    out.push(section("Rules it asked for", d.asked.length,
      d.asked.map((x) => item(t, x.t, art("dia hollow", '<svg viewBox="-6 -6 12 12"><path d="M0-5 5 0 0 5-5 0Z"/></svg>'), h("b", { class: "slug" }, x.slug || x.topic || x.query || x.tool),
        h("span", { class: "note" }, [x.tool, x.query && x.slug ? "“" + x.query + "”" : null, x.count != null ? x.count + (x.count === 1 ? " hit" : " hits") : null, x.ms != null ? Math.round(x.ms) + "ms" : null].filter(Boolean).join(" · ")))),
      d.asked.length ? null : none("It never asked.")));

    out.push(section("Considered and held back", d.considered.length,
      d.considered.map((x) => item(t, x.t, h("span", { class: "why" }, REASON[x.reason] || String(x.reason || "").replace(/_/g, " ")),
        h("div", { class: "cands" }, (x.candidates || []).map((c) => h("span", { class: "cand" }, c.slug, h("em", null, c.judge == null ? "" : Number(c.judge).toFixed(2))))))),
      d.considered.length ? null : none("mnemo never held a rule back here.")));

    out.push(section("Claude Code's own memory, touched later", d.claude.length,
      d.claude.map((x) => item(t, x.t, h("span", { class: "tag" }, x.op), h("span", { class: "path", title: x.path }, F.tail(x.path, 2)), h("span", { class: "note" }, x.file === "claude-md" ? "CLAUDE.md" : "memory file"))),
      d.claude.length ? null : none("Not touched after the start.")));

    if (d.skills.length) out.push(section("Skills", d.skills.length, d.skills.map((x) => item(t, x.t, h("b", { class: "slug" }, x.name)))));
    const frictions = (m.frictions || []).map((x) => Object.assign({ t: S.ms(x.at) }, x));
    if (frictions.length) out.push(section("Corrections mnemo wrote down", frictions.length,
      frictions.map((x) => item(t, x.t, h("span", { class: "quote" }, "“" + (x.quote || "") + "”"), h("span", { class: "note block" }, "→ " + (x.rule || ""))))));
    return out;
  }

  function readSight(s, t) {
    const d = s._, web = s.web || {}, out = [];
    const timed = (list) => (list || []).map((x) => Object.assign({ t: S.ms(x.at) }, x)).sort((a, b) => (a.t || 0) - (b.t || 0));
    const link = (url, text) => h("a", { href: url, target: "_blank", rel: "noreferrer noopener", title: url }, text || url);
    const shots = timed(web.shots);
    if (shots.length) {
      const seenBy = shots.filter((x) => x.t <= t);
      const current = seenBy[seenBy.length - 1];
      out.push(section("What it was looking at", shots.length, h("div", { class: "shots" }, shots.map((x) =>
        h("figure", { class: "shot" + (x === current ? " current" : "") + (x.t > t ? " later" : "") },
          h("img", { src: "../" + x.src, alt: x.title || x.url || "", loading: "lazy", onerror: (ev) => ev.target.replaceWith(h("div", { class: "noimg" }, "the picture is not on this machine")) }),
          h("figcaption", null, h("b", null, x.title || x.url || ""), h("span", null, F.when(x.t, data.now) + " · " + (x.url || ""))))))));
    }
    const pages = timed(web.pages);
    out.push(section("Pages", pages.length, pages.map((x) => item(t, x.t, h("b", null, x.title || x.url), link(x.url))), pages.length ? null : none("Its browser tools were on no page.")));
    const searches = timed(web.searches);
    out.push(section("Searches", searches.length, searches.map((x) => item(t, x.t, h("b", null, "“" + (x.query || "") + "”"),
      h("div", { class: "cands" }, (x.results || []).slice(0, 6).map((r) => h("span", { class: "cand" }, link(r.url, r.title || r.url)))))), searches.length ? null : none("It searched for nothing.")));
    const fetches = timed(web.fetches);
    out.push(section("Fetched", fetches.length, fetches.map((x) => item(t, x.t, link(x.url),
      h("span", { class: "note" }, [x.code, F.bytes(x.bytes), F.took(x.ms)].filter((v) => v != null && v !== "").join(" · ")), x.summary ? h("span", { class: "note block" }, x.summary) : null)),
      fetches.length ? null : none("It fetched no document.")));
    const artifacts = timed(web.artifacts);
    if (artifacts.length) out.push(section("Artifacts it published", artifacts.length, artifacts.map((x) => item(t, x.t, link(x.url, x.title || x.url)))));

    const prs = s.prs || [];
    out.push(section("Pull requests", prs.length, prs.map((p) => item(t, null, h("b", null, "#" + p.number + "  " + (p.title || "")),
      h("span", { class: "tag", data: { pr: mergedOf(s) && p.state === "open" ? "merged" : p.state } }, mergedOf(s) && p.state === "open" ? "approved here" : p.state + (p.draft ? " · draft" : "")),
      h("span", { class: "note" }, ["CI " + (p.ci || "not run"), p.mergeable, p.repo].filter(Boolean).join(" · ")))), prs.length ? null : none("It opened none.")));

    const edited = ((s.files || {}).edited || []).map((x) => Object.assign({ t: S.ms(x.lastAt) }, x));
    const maxEdits = Math.max(1, ...edited.map((x) => x.edits || 0));
    out.push(section("Files it changed", edited.length, edited.slice(0, 40).map((x) => item(t, x.t, h("span", { class: "path", title: x.path }, F.tail(x.path, 3)), meter(x.edits || 0, maxEdits), h("span", { class: "note" }, (x.edits || 0) + (x.edits === 1 ? " edit" : " edits")))),
      edited.length > 40 ? none("and " + (edited.length - 40) + " more") : null, edited.length ? null : none("It changed no file.")));
    const read = ((s.files || {}).read || []).slice().sort((a, b) => (b.count || 0) - (a.count || 0));
    if (read.length) out.push(section("Files it read most", read.length, read.slice(0, 12).map((x) => item(t, null, h("span", { class: "path", title: x.path }, F.tail(x.path, 3)), h("span", { class: "note" }, "×" + x.count)))));
    const counts = Object.entries(s.activityCounts || {}).sort((a, b) => b[1] - a[1]);
    if (counts.length) out.push(section("Every tool call, by kind", s.activityTotal, h("div", { class: "cands" }, counts.map(([kind, n]) => h("span", { class: "cand" }, kind, h("em", null, n))))));
    return out;
  }

  /* ---- the key sheet ---- */

  const KEYS = [
    ["J  K  ↓  ↑", "the next and the previous line"], ["Backspace", "the line you were on before"], ["Space", "the next thing that waits (Shift: the previous)"],
    ["1 – 9", "answer the question with that choice"], ["A  D", "approve a merge or a permission; deny a permission"], ["R", "send the suggested reply, or nudge a stalled session"],
    ["U", "take back the last answer"], ["←  →", "move the playhead (Shift: further); the now column replays"], ["Esc", "back to now, then close the session"],
    ["T  Enter", "the session's terminal, full height"], ["C  M  S", "context and tokens, memory, sight"], ["+  −  0", "zoom in, out, and back to 12 hours ending now"],
    ["F", "fold or unfold the selected line's ended children"], ["drag", "on the score: move through time. On the ruler: replay, and let go to return (Shift holds)"],
    ["wheel", "over the ruler or the strip: zoom. With Ctrl over the score: zoom; with Shift: move through time"],
  ];
  const LEGEND = [
    ["bar", "a prompt"], ["curve", "context filling; a cliff is a compaction"], ["l0", "changes a file"], ["l1", "runs something"], ["l2", "reads or searches"], ["l3", "reaches out: web, sub-agent"],
    ["dia", "a rule mnemo gave"], ["dia hollow", "a rule it asked for"], ["dot", "a rule held back"], ["fail", "a call that failed"], ["shot", "a screenshot it took"],
  ];
  const legendMark = (cls) => h("i", { class: "lg " + cls });

  function renderSheet() {
    const sheet = $("sheet");
    sheet.hidden = !view.keys;
    if (!view.keys) { sheet.replaceChildren(); return; }
    sheet.replaceChildren(h("div", { class: "panel", onclick: (ev) => ev.stopPropagation() },
      h("h2", null, "Keys"), h("dl", null, KEYS.map(([k, what]) => [h("dt", null, k), h("dd", null, what)])),
      h("h2", null, "Marks on a line"), h("dl", { class: "marks" }, LEGEND.map(([cls, what]) => [h("dt", null, legendMark(cls)), h("dd", null, what)])),
      h("p", { class: "say" }, "Answers and approvals change this page only. Nothing here reaches a session.")));
  }

  /* ---- acting ---- */

  function select(id, at, keepScroll) {
    if (id !== view.sel && view.sel) previous = view.sel;
    view.sel = id;
    view.at = at != null && at < data.now ? at : null;
    if (!id) view.term = false;
    renderAll();
    const row = id && rowOf.get(id);
    if (row && !keepScroll) { row.el.scrollIntoView({ block: "nearest" }); drawAll(); }
  }

  function step(delta) {
    const list = rows.filter((r) => r.type === "session");
    if (!list.length) return;
    const i = list.findIndex((r) => r.s.id === view.sel);
    select(list[i < 0 ? (delta > 0 ? 0 : list.length - 1) : (i + delta + list.length) % list.length].s.id, view.at);
  }

  function walk(delta) {
    const list = waiting();
    if (!list.length) { toast("Nothing waits for you."); return; }
    const i = list.findIndex((r) => r.s.id === view.sel);
    select(list[i < 0 ? (delta > 0 ? 0 : list.length - 1) : (i + delta + list.length) % list.length].s.id, null);
  }

  function answer(s, code) {
    view.done.set(s.short, code);
    view.at = null;
    renderAll();
    toast(doneText(s) + " — on this page only; nothing was sent.");
    const row = rowOf.get(s.id);
    if (row) { row.el.scrollIntoView({ block: "nearest" }); drawAll(); }
  }

  /** A key pressed on the selected line's pending item. True when it meant something. */
  function answerKey(key) {
    const s = selected(), p = s && pendOf(s);
    if (!p) return false;
    if (T() < data.now) { view.at = null; renderAll(); toast("Back to now: answer it there."); return true; }
    if (/^[1-9]$/.test(key)) { if (p.kind !== "question" || !p.options[key - 1]) return false; answer(s, key); return true; }
    if (key === "a") { if (p.kind !== "merge" && p.kind !== "permission") return false; answer(s, "a"); return true; }
    if (key === "d") { if (p.kind !== "permission") return false; answer(s, "d"); return true; }
    if (key === "r") { if (p.kind === "stalled" || p.suggestedReply) { answer(s, "r"); return true; } return false; }
    return false;
  }

  function toggleFold(s) {
    if (view.flip.has(s.short)) view.flip.delete(s.short); else view.flip.add(s.short);
    renderAll();
  }
  function toggleTerm(on) {
    if (!view.sel) return;
    view.term = on == null ? !view.term : on;
    renderAll();
  }

  let toastTimer = 0;
  function toast(text) {
    const box = $("toast");
    box.textContent = text;
    box.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { box.hidden = true; }, 4200);
  }

  /* ---- time: zoom, pan, the playhead ---- */

  const earliest = () => Math.min(data.now - 48 * HOUR, ...data.sessions.map((s) => s._.t0).filter((t) => t != null && t > data.now - 60 * DAY));

  function setView(span, end) {
    view.span = Math.min(14 * DAY, Math.max(10 * MIN, span));
    const floor = earliest() + view.span * 0.5;
    view.end = end == null || end >= data.now - 1000 ? null : Math.max(end, floor);
    writeHash();
    schedule(drawAll);
  }
  function setSpan(span) {
    const to = view.end != null ? view.end : data.now, t = T();
    // keep the playhead where it is on the screen when it is in view; else keep the right edge
    if (t < data.now && t > to - view.span) setView(span, t + (to - t) * (span / view.span));
    else setView(span, view.end);
  }
  function zoomAt(factor, anchor) {
    const to = view.end != null ? view.end : data.now;
    const span = Math.min(14 * DAY, Math.max(10 * MIN, view.span * factor));
    setView(span, anchor + (to - anchor) * (span / view.span));
  }
  function movePlayhead(delta) {
    const e = env();
    const stepMs = S.step(view.span, e.W, 24) * delta;
    const next = Math.max(earliest(), T() + stepMs);
    view.at = next >= data.now ? null : next;
    if (view.at != null && (view.at < e.view.from || view.at > e.view.to)) view.end = Math.min(data.now, view.at + view.span * 0.5) >= data.now ? null : view.at + view.span * 0.5;
    renderAll();
  }

  function showTip(nodes, clientX, clientY) {
    tip.replaceChildren(...nodes.flat(3).filter((n) => n != null && n !== false));
    tip.hidden = false;
    const box = tip.getBoundingClientRect();
    const x = clientX + 16 + box.width > window.innerWidth ? clientX - 16 - box.width : clientX + 16;
    const y = Math.min(window.innerHeight - box.height - 8, clientY + 18);
    tip.style.transform = "translate(" + Math.max(4, x) + "px," + Math.max(4, y) + "px)";
  }
  const hideTip = () => { tip.hidden = true; hair.hidden = true; $("under").querySelectorAll(".hover").forEach((n) => n.remove()); };

  function describe(hit) {
    const r = hit.ref || {};
    switch (hit.kind) {
      case "act": return [h("b", null, r.tool || r.kind), " ", h("span", { class: "mono" }, r.target || ""), h("em", null, r.ok === false ? "failed" : r.running ? "no result in the capture" : F.took(r.ms))];
      case "injected": return [h("b", { class: "mem" }, "mnemo gave a rule"), " ", r.slug, h("em", null, "score " + Number(r.score || 0).toFixed(2) + (r.judge == null ? "" : " · relevance " + Number(r.judge).toFixed(2)))];
      case "asked": return [h("b", { class: "mem" }, "it asked mnemo"), " ", r.slug || r.topic || r.query || r.tool, h("em", null, (r.count ?? 0) + " hits")];
      case "held": return [h("b", { class: "mem" }, "mnemo held back"), " ", REASON[r.reason] || r.reason, h("em", null, (r.candidates || []).length + " candidates")];
      case "claude": return [h("b", null, (r.op || "touch") + " Claude Code's memory"), " ", h("span", { class: "mono" }, F.tail(r.path, 2))];
      case "compaction": return [h("b", null, "context compacted"), " ", tokens(r.pre) + " → " + tokens(r.post), h("em", null, r.trigger || "")];
      case "shot": return [h("b", null, "screenshot"), " ", r.title || r.url];
      case "artifact": return [h("b", null, "artifact"), " ", r.title || r.url];
      case "search": return [h("b", null, "searched"), " “" + (r.query || "") + "”"];
      case "fetch": return [h("b", null, "fetched"), " ", r.url];
      case "prompt": return [h("b", null, "a prompt"), " ", h("em", null, "mnemo looked at it here")];
    }
    return [];
  }

  function overScore(ev) {
    const e = env(), box = scoreC.getBoundingClientRect();
    const px = ev.clientX - box.left, py = ev.clientY - box.top + e.top;
    const row = rows.find((r) => py >= r.y && py < r.y + r.h);
    hair.hidden = false;
    hair.style.transform = "translateX(" + px.toFixed(1) + "px)";
    hair.firstChild.textContent = F.clockS(e.t(px));
    const under = $("under");
    under.querySelectorAll(".hover").forEach((n) => n.remove());
    if (!row || row.type === "group") { tip.hidden = true; return null; }
    under.append(h("div", { class: "band hover", style: "top:" + row.y + "px;height:" + row.h + "px" }));
    if (row.type === "ensemble") {
      showTip([h("div", { class: "who" }, row.sessions.length + " ended children of " + (row.parent.title || row.parent.short)), h("div", { class: "what" }, h("em", null, "click to give each its own line"))], ev.clientX, ev.clientY);
      return { row };
    }
    const s = row.s, t = e.t(px);
    const hit = D.hit(e, row, px, py);
    const at = hit ? hit.t : t;
    const state = S.stateAt(s, at, data.now, stateOf(s));
    const ctx = S.ctxAt(s, at, data.now);
    showTip([
      h("div", { class: "who" }, s.title || s.short),
      hit ? h("div", { class: "what" }, describe(hit)) : null,
      h("div", { class: "then" }, F.when(at, data.now) + ":" + F.clockS(at).slice(-2) + " · " + (state ? WORD[state] : "not started") + (ctx == null ? "" : " · context " + tokens(ctx) + " (" + Math.round((ctx / s._.window) * 100) + "%)")),
    ], ev.clientX, ev.clientY);
    return { row, hit, t: at };
  }

  function wire() {
    let drag = null;
    scoreC.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0) return;
      drag = { x: ev.clientX, end: view.end != null ? view.end : data.now, moved: false };
      scoreC.setPointerCapture(ev.pointerId);
    });
    scoreC.addEventListener("pointermove", (ev) => {
      if (!drag) { schedule(() => overScore(ev)); return; }
      const dx = ev.clientX - drag.x;
      if (!drag.moved && Math.abs(dx) < 5) return;
      drag.moved = true;
      hideTip();
      app.dataset.panning = "yes";
      setView(view.span, drag.end - dx / env().k);
    });
    const release = (ev) => {
      if (!drag) return;
      const was = drag;
      drag = null;
      delete app.dataset.panning;
      if (was.moved || ev.type === "pointercancel") return;
      const over = overScore(ev);
      if (!over) return;
      if (over.row.type === "ensemble") toggleFold(over.row.parent);
      else select(over.row.s.id, over.t < data.now - 1000 ? Math.round(over.t) : null, true);
    };
    scoreC.addEventListener("pointerup", release);
    scoreC.addEventListener("pointercancel", release);
    scoreC.addEventListener("pointerleave", () => { if (!drag) schedule(hideTip); });

    // the ruler and the strip: drag to replay, let go to return to now
    const head = $("head");
    let scrubbing = false;
    const timeAt = (ev) => { const e = env(); return Math.min(data.now, Math.max(e.view.from, e.t(ev.clientX - head.getBoundingClientRect().left))); };
    head.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0) return;
      scrubbing = true;
      head.setPointerCapture(ev.pointerId);
      scrub = timeAt(ev);
      app.dataset.replay = "on";
      schedule(scrubbed);
    });
    head.addEventListener("pointermove", (ev) => {
      if (scrubbing) { scrub = timeAt(ev); schedule(scrubbed); return; }
      schedule(() => overStrip(ev));
    });
    const drop = (ev) => {
      if (!scrubbing) return;
      scrubbing = false;
      const held = ev.shiftKey && scrub != null && scrub < data.now - 1000 ? Math.round(scrub) : null;
      scrub = null;
      view.at = held;
      app.dataset.returning = held == null ? "yes" : "no";
      renderAll();
      setTimeout(() => { delete app.dataset.returning; placePlayhead(env()); }, 500);
    };
    head.addEventListener("pointerup", drop);
    head.addEventListener("pointercancel", drop);
    head.addEventListener("pointerleave", () => { if (!scrubbing) schedule(hideTip); });
    head.addEventListener("wheel", (ev) => {
      ev.preventDefault();
      zoomAt(Math.exp(ev.deltaY * 0.0015), env().t(ev.clientX - head.getBoundingClientRect().left));
    }, { passive: false });
    rowsEl.addEventListener("wheel", (ev) => {
      if (!ev.ctrlKey && !ev.shiftKey) return;
      if (ev.clientX - track.getBoundingClientRect().left > track.clientWidth) return;
      ev.preventDefault();
      const e = env();
      if (ev.ctrlKey) zoomAt(Math.exp(ev.deltaY * 0.0025), e.t(ev.clientX - track.getBoundingClientRect().left));
      else setView(view.span, (view.end != null ? view.end : data.now) + (ev.deltaY || ev.deltaX) / e.k);
    }, { passive: false });
    rowsEl.addEventListener("scroll", () => { hideTip(); schedule(drawAll); }, { passive: true });

    $("pending").addEventListener("click", () => walk(1));
    $("help").addEventListener("click", () => { view.keys = !view.keys; renderAll(); });
    $("sheet").addEventListener("click", () => { view.keys = false; renderAll(); });
    $("motion").addEventListener("click", () => { M.motion(document.documentElement.dataset.motion === "reduced" ? "full" : "reduced"); drawAll(); });
    window.addEventListener("resize", () => schedule(renderAll));
    window.addEventListener("hashchange", () => { readHash(); renderAll(); });
    document.addEventListener("keydown", onKey);
  }

  function scrubbed() {
    placePlayhead(env());
    updateCards();
    renderNowHead();
    if (view.sel && view.tab === "context" && !view.term) renderReading();
  }

  function overStrip(ev) {
    const e = env(), box = stripC.getBoundingClientRect();
    const px = ev.clientX - box.left;
    hair.hidden = false;
    hair.style.transform = "translateX(" + px.toFixed(1) + "px)";
    hair.firstChild.textContent = F.clockS(e.t(px));
    if (!strip || ev.clientY > box.bottom) { tip.hidden = true; return; }
    const from = Math.floor(e.t(px) / strip.stepMs) * strip.stepMs, to = from + strip.stepMs;
    const top = S.spenders(data, from, to);
    const total = top.reduce((n, x) => n + x.tokens, 0);
    showTip([
      h("div", { class: "who" }, F.when(from, data.now) + " – " + F.clock(to)),
      h("div", { class: "what" }, h("b", null, "≈ " + tokens(total)), " across ", top.length, top.length === 1 ? " session" : " sessions"),
      top.slice(0, 4).map((x) => h("div", { class: "then" }, tokens(x.tokens) + " · " + (x.s.title || x.s.short))),
    ], ev.clientX, ev.clientY);
  }

  function onKey(ev) {
    if (ev.ctrlKey || ev.metaKey || ev.altKey || !data) return;
    const key = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;
    let used = true;
    if (view.keys && key !== "?") { view.keys = false; renderAll(); }
    else if (key === "?") { view.keys = !view.keys; renderAll(); }
    else if (key === "j" || key === "ArrowDown") step(1);
    else if (key === "k" || key === "ArrowUp") step(-1);
    else if (key === " " || key === "n") walk(ev.shiftKey ? -1 : 1);
    else if (key === "Backspace") { if (previous && data.byId[previous]) select(previous, view.at); }
    else if (/^[1-9]$/.test(key) || key === "a" || key === "d" || key === "r") used = answerKey(key);
    else if (key === "u") { const last = [...view.done.keys()].pop(); if (last) { view.done.delete(last); renderAll(); toast("Taken back."); } }
    else if (key === "ArrowLeft") movePlayhead(ev.shiftKey ? -6 : -1);
    else if (key === "ArrowRight") movePlayhead(ev.shiftKey ? 6 : 1);
    else if (key === "Escape") {
      if (view.term) { view.term = false; renderAll(); }
      else if (view.at != null || view.end != null) { view.at = null; view.end = null; renderAll(); }
      else if (view.sel) select(null, null);
    }
    else if (key === "t" || key === "Enter") toggleTerm();
    else if (key === "c" || key === "m" || key === "s") { if (view.sel) { view.tab = TABS.find((x) => x[2].toLowerCase() === key)[0]; view.term = false; renderAll(); } }
    else if (key === "+" || key === "=") zoomAt(0.5, T() < data.now ? T() : view.end != null ? view.end : data.now);
    else if (key === "-" || key === "_") zoomAt(2, T() < data.now ? T() : view.end != null ? view.end : data.now);
    else if (key === "0") { view.span = DEFAULT_SPAN; view.end = null; renderAll(); }
    else if (key === "f") { const s = selected(); const p = s && (S.canFold(s, stateOf) ? s : s.parent && data.byId[s.parent]); if (p && S.canFold(p, stateOf)) toggleFold(p); }
    else used = false;
    if (used) { ev.preventDefault(); if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); }
  }

  /* ---- the ground: sparse stars, the rings behind the strip, the legend ---- */

  function ground() {
    let seed = 20261109;
    const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    const shadows = [];
    for (let i = 0; i < 150; i++) shadows.push((rnd() * 100).toFixed(2) + "vw " + (rnd() * 100).toFixed(2) + "vh 0 " + (rnd() < 0.12 ? "0.6px" : "0") + " rgba(255,255,255," + (0.12 + rnd() * 0.5).toFixed(2) + ")");
    const stars = $("stars");
    stars.append(h("i", { class: "field", style: "box-shadow:" + shadows.join(",") }));
    for (let i = 0; i < 7; i++) stars.append(h("i", { class: "twinkle", style: "left:" + (rnd() * 100).toFixed(1) + "vw;top:" + (rnd() * 100).toFixed(1) + "vh;animation-delay:-" + (rnd() * 9).toFixed(1) + "s" }));
    // the core's rings, carried out over the whole page: still, so they cost nothing
    let rings = "";
    for (let r = 118, i = 0; r < 3000; r *= 1.3, i++) {
      const dash = i % 3 === 1 ? ' stroke-dasharray="2 7"' : i % 3 === 2 ? ' pathLength="360" stroke-dasharray="' + (40 + i * 9) + " 6 " + (90 - i * 4) + ' 10 200"' : "";
      rings += '<circle r="' + r.toFixed(0) + '" stroke-opacity="' + Math.max(0.035, 0.15 - i * 0.011).toFixed(3) + '"' + dash + "/>";
    }
    $("halo").innerHTML = '<svg viewBox="-3000 -3000 6000 6000">' + rings + "</svg>";
    $("legend").append(...LEGEND.slice(0, 9).map(([cls, what]) => h("span", null, legendMark(cls), what.split(";")[0].split(":")[0])));
  }

  window.MNEMO_READY.then((loaded) => {
    data = S.prep(loaded);
    ground();
    wire();
    readHash();
    renderAll();
    const sel = view.sel && rowOf.get(view.sel);
    if (sel) { sel.el.scrollIntoView({ block: "center" }); drawAll(); }
    app.dataset.ready = "yes";
    // the canvases use the three typefaces; draw again once they have loaded
    Promise.all(['600 11px "Jura"', '400 11px "Geist"', '400 10px "JetBrains Mono"'].map((f) => document.fonts.load(f))).then(() => renderAll());
  });
})();

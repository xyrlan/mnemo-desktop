/* Console: one roster, one stage, three instruments, and a command line.
   The capture is read once; every change afterwards is the page's own state. Nothing here
   reaches a session. The view lives in location.hash (see `read` and `write`). */
(function () {
  "use strict";

  const M = window.mnemo;
  const $ = (id) => document.getElementById(id);
  const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ESC[c]);

  let D;                          // the capture
  let CODES = {};                 // project name -> its three-letter mark
  let HANDLES = {};               // session id -> the word the command line calls it
  const INSTS = ["context", "memory", "sight"];

  /* The view: all of it is in the hash. */
  const view = {
    s: null,                      // the session on stage (its short id)
    inst: "context",              // the instrument that stays open when there is room for one
    group: "attention",           // or "project"
    ans: {},                      // pending index -> the action chosen (a number, or "r" for words)
    cmd: null,                    // the command line's text while it is open
    term: false,                  // typing into the stage's terminal
    zoom: false,                  // the stage takes the instruments' room
    help: false,
    shot: null,                   // a screenshot of the staged session, enlarged
  };

  /* What the page did since it loaded and the hash does not carry: words typed, sessions
     made or stopped from the command line. */
  const local = { log: {}, state: {}, word: {}, words: {}, order: [], prev: null, last: null, sel: 0 };

  /* ───────────────────────────── small things ───────────────────────────── */

  const num = (n) => (n == null ? "–" : Math.round(n).toLocaleString("en-US"));
  const tok = (n) => M.tokens(n);
  const age = (iso) => M.age(iso, D.now);
  const clean = (t) => String(t || "").replace(/\s+/g, " ").trim();
  const cut = (t, n) => (t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t);

  function hm(iso) {
    const d = new Date(iso);
    return isNaN(d) ? "" : String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }
  function dur(ms) {
    if (ms == null) return "";
    if (ms < 1000) return Math.round(ms) + "ms";
    if (ms < 60000) return (ms / 1000).toFixed(ms < 10000 ? 1 : 0) + "s";
    if (ms < 3600000) return Math.floor(ms / 60000) + "m " + String(Math.round((ms % 60000) / 1000)).padStart(2, "0") + "s";
    return Math.floor(ms / 3600000) + "h " + String(Math.round((ms % 3600000) / 60000)).padStart(2, "0") + "m";
  }
  function until(iso) {
    const ms = Date.parse(iso) - D.now;
    if (isNaN(ms)) return "";
    if (ms <= 0) return "reset due";
    const m = Math.round(ms / 60000);
    if (m < 60) return "resets in " + m + "m";
    if (m < 2880) return "resets in " + Math.floor(m / 60) + "h " + String(m % 60).padStart(2, "0") + "m";
    return "resets in " + Math.floor(m / 1440) + "d " + Math.floor((m % 1440) / 60) + "h";
  }
  function bytes(n) {
    if (n == null) return "";
    return n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(n < 10240 ? 1 : 0) + " kB" : (n / 1048576).toFixed(1) + " MB";
  }
  function model(m) {
    return String(m || "").replace(/^claude-/, "").replace(/\[1m\]$/, "").replace(/-\d{8}$/, "")
      .replace(/-(\d+)-(\d+)$/, " $1.$2").replace(/-(\d+)$/, " $1");
  }
  function host(url) {
    try { return new URL(url).host || url; } catch (e) { return url; }
  }
  function path(p) {
    const parts = String(p || "").replace(/\\/g, "/").split("/");
    const base = parts.pop();
    const dir = parts.slice(-2).join("/");
    return `<span class="p-dir">${esc(dir ? (parts.length > 2 ? "…/" : "") + dir + "/" : "")}</span><b class="p-base">${esc(base)}</b>`;
  }
  const gl = (state) => `<i class="gl" data-state="${state}"></i>`;

  function hash32(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  /* A session's figure: a constellation only it has, drawn from its id. A stand-in for the
     generated session figures (NOTES.md). */
  function sigil(id) {
    let h = hash32(id) || 1;
    const rnd = () => { h ^= h << 13; h >>>= 0; h ^= h >>> 17; h ^= h << 5; h >>>= 0; return h / 4294967296; };
    const slots = Array.from({ length: 12 }, (_, i) => i);
    for (let i = slots.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [slots[i], slots[j]] = [slots[j], slots[i]]; }
    const n = 4 + Math.floor(rnd() * 3);
    const pts = slots.slice(0, n).map((slot) => {
      const r = rnd() < 0.45 ? 4.6 : 9;
      const a = (slot / 12) * Math.PI * 2 - Math.PI / 2;
      return [+(Math.cos(a) * r).toFixed(2), +(Math.sin(a) * r).toFixed(2)];
    });
    const star = pts[Math.floor(rnd() * n)];
    return `<svg class="sigil" viewBox="-12 -12 24 24" aria-hidden="true"><circle r="11.2" class="sg-ring"/>` +
      `<polygon points="${pts.map((p) => p.join(",")).join(" ")}" class="sg-line"/>` +
      pts.map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r=".75" class="sg-dot"/>`).join("") +
      `<circle cx="${star[0]}" cy="${star[1]}" r="1.7" class="sg-star"/></svg>`;
  }

  /* mnemo's own piece, small: rings of memory around a core. A stand-in (NOTES.md). */
  function core() {
    return `<svg viewBox="-16 -16 32 32" aria-hidden="true"><circle r="14.5" class="co-a"/><circle r="9.5" class="co-b"/>` +
      `<circle r="4.5" class="co-c"/><circle r="1.4" class="co-d"/><circle cx="9.5" cy="0" r="1.2" class="co-d"/>` +
      `<circle cx="-10.25" cy="-10.25" r="1" class="co-d"/><path d="M0 -14.5V-9.5M0 9.5V14.5" class="co-b"/></svg>`;
  }

  /* ───────────────────────────── the fleet ───────────────────────────── */

  const kids = (s) => s.children.map((id) => D.byId[id]).filter(Boolean);
  function rootOf(s) {
    let r = s;
    for (let i = 0; i < 8 && r.parent && D.byId[r.parent]; i++) r = D.byId[r.parent];
    return r;
  }
  function family(r) {
    const out = [r];
    const walk = (s, depth) => childOrder(s).forEach((c) => { if (out.indexOf(c) < 0 && depth < 8) { out.push(c); walk(c, depth + 1); } });
    walk(r, 0);
    return out;
  }
  function childOrder(s) {
    return kids(s).sort((a, b) => M.STATE_ORDER.indexOf(eff(a)) - M.STATE_ORDER.indexOf(eff(b)) || (b.lastAt || "").localeCompare(a.lastAt || ""));
  }
  const bySession = (id) => D.pending.filter((p) => p.session === id);
  const isOpen = (p) => !(p.i in view.ans);
  const openPending = () => D.pending.filter(isOpen);
  const armed = (s) => bySession(s.id).find(isOpen) || null;

  /* What a pending item can be answered with. Every kind is a short list of keyed actions,
     so one habit (a digit) answers a question, grants a permission and approves a merge. */
  function actions(p) {
    const out = [];
    if (p.kind === "question") {
      (p.options || []).forEach((o) => out.push({ label: o.label, desc: o.description, to: "working", past: "answered" }));
      if (p.suggestedReply) out.push({ label: "Send the suggested reply", desc: p.suggestedReply, say: p.suggestedReply, to: "working", past: "answered" });
      if (!out.length) out.push({ label: "Tell it to go on", say: "go on", to: "working", past: "answered" });
    } else if (p.kind === "permission") {
      out.push({ label: "Allow once", say: "Yes", to: "working", past: "allowed" });
      out.push({ label: "Always allow", desc: "For the rest of this session.", say: "Yes, and don't ask again", to: "working", past: "allowed" });
      out.push({ label: "Deny", say: "No", to: "idle", past: "denied" });
    } else if (p.kind === "merge") {
      const ci = p.pr && p.pr.ci;
      out.push({ label: ci === "green" ? "Merge" : ci === "running" ? "Merge when green" : "Merge anyway", desc: p.pr ? "#" + p.pr.number + " into its base." : "", say: "merge it", to: "ended", past: ci === "running" ? "merges when green" : "merged", word: ci === "running" ? "merging" : "merged" });
      out.push({ label: "Send it back", desc: "Ask the session for changes.", say: "not yet, changes wanted", to: "working", past: "sent back" });
    } else {
      if (p.suggestedReply) out.push({ label: "Send the suggested reply", desc: p.suggestedReply, say: p.suggestedReply, to: "working", past: "answered" });
      out.push({ label: p.kind === "stalled" ? "Resume" : "Try again", desc: "Sends “continue”.", say: "continue", to: "working", past: "resumed" });
      out.push({ label: "Stop it", desc: "End the session where it stands.", say: "stop", to: "ended", past: "stopped", word: "stopped" });
    }
    return out;
  }
  function chosen(p) {
    const a = view.ans[p.i];
    if (a === "r") return { label: (local.words[p.i] || "your words"), say: local.words[p.i] || "", to: "working", past: "answered" };
    return actions(p)[a] || null;
  }

  /* A session's state after what was answered in this page. */
  function eff(s) {
    if (local.state[s.id]) return local.state[s.id];
    const mine = bySession(s.id);
    if (!mine.length || mine.some(isOpen)) return s.state;
    const a = chosen(mine[mine.length - 1]);
    return a ? a.to : s.state;
  }
  function word(s) {
    if (local.word[s.id]) return local.word[s.id];
    const mine = bySession(s.id);
    if (mine.length && !mine.some(isOpen)) {
      const a = chosen(mine[mine.length - 1]);
      if (a && a.word) return a.word;
    }
    const e = eff(s);
    if (e === "need" && s.abandoned) return "gave up waiting";
    if (e === "ended" && !s.live && s.prs && s.prs.some((p) => p.state === "merged")) return "merged";
    return M.WORD[e];
  }

  const RANK = { need: 0, stalled: 0, ready: 0, working: 1, idle: 2, ended: 3 };
  const BANDS = ["Waiting for you", "Working", "Your turn", "Ended"];
  function rank(r) {
    let k = RANK[eff(r)];
    if (eff(r) === "need" && r.abandoned && !armed(r)) k = 2;
    family(r).forEach((m) => {
      if (m === r) return;
      const v = armed(m) ? 0 : RANK[eff(m)];
      if (v < 2 && !(eff(m) === "need" && m.abandoned && !armed(m))) k = Math.min(k, v);
    });
    return k;
  }
  function waitingSince(r) {
    const at = family(r).filter((m) => armed(m)).map((m) => (m.abandoned ? "8" : "") + (armed(m).at || "")).sort()[0];
    return at || "";
  }
  /** The roster's order: the roots, most in need of him first. */
  function order() {
    const roots = D.sessions.filter((s) => !s.parent || !D.byId[s.parent]);
    const keyed = roots.map((r) => ({ r, k: rank(r), w: waitingSince(r) }));
    keyed.sort((a, b) => a.k - b.k || (a.k === 0 ? (a.w || "9").localeCompare(b.w || "9") : 0) || (b.r.lastAt || "").localeCompare(a.r.lastAt || ""));
    if (view.group === "project") {
      const pos = {};
      D.projects.forEach((p, i) => { pos[p.name] = i; });
      const at = (r) => (r.project in pos ? pos[r.project] : 999);
      keyed.sort((a, b) => at(a.r) - at(b.r) || String(a.r.project).localeCompare(String(b.r.project)));
    }
    return keyed;
  }
  const byShort = (short) => D.sessions.find((s) => s.short === short) || null;
  const cur = () => byShort(view.s);

  function nowOf(s) {
    const log = local.log[s.id];
    if (log && log.length) return { kind: "you", text: log[log.length - 1].text };
    for (let i = s.activity.length - 1; i >= 0; i--) if (s.activity[i].running) return { kind: "running", tool: s.activity[i].tool, target: s.activity[i].target, at: s.activity[i].at };
    if (s.recap && s.recap.text) return { kind: "recap", text: s.recap.text, at: s.recap.at };
    if (s.role === "child" && (s.needs || s.detail)) return { kind: "status", text: s.needs || s.detail, at: s.lastAt };
    if (s.said && s.said.text) return { kind: "said", text: s.said.text, at: s.said.at };
    if (s.intent) return { kind: "asked to", text: s.intent, at: s.startedAt };
    const last = s.activity[s.activity.length - 1];
    if (last) return { kind: "last", tool: last.tool, target: last.target, at: last.at };
    if (s.lastPrompt) return { kind: "prompt", text: s.lastPrompt, at: s.lastAt };
    return null;
  }
  function nowHtml(s, max) {
    const n = nowOf(s);
    if (!n) return `<span class="now-none">nothing recorded yet</span>`;
    const k = `<span class="now-k">${esc(n.kind)}</span>`;
    if (n.tool) return k + `<b class="mono">${esc(n.tool)}</b> <span class="mono now-t">${esc(cut(clean(n.target), max))}</span>`;
    return k + esc(cut(clean(n.text), max));
  }

  function ctxBar(s) {
    const c = s.context;
    if (!c || c.percent == null) return `<span class="ctx" data-none><i></i></span><b class="num">–</b>`;
    const p = Math.max(0, Math.min(100, c.percent));
    return `<span class="ctx"${p >= 80 ? " data-hot" : ""}><i style="transform:scaleX(${(p / 100).toFixed(3)})"></i></span><b class="num"${p >= 80 ? " data-hot" : ""}>${Math.round(p)}%</b>`;
  }

  /* ───────────────────────────── the hash ───────────────────────────── */

  function read() {
    const q = new URLSearchParams(location.hash.slice(1));
    view.s = q.get("s");
    view.inst = INSTS.indexOf(q.get("i")) >= 0 ? q.get("i") : "context";
    view.group = q.get("g") === "project" ? "project" : "attention";
    view.cmd = q.has("cmd") ? q.get("cmd") : null;
    view.term = q.get("t") === "1";
    view.zoom = q.get("z") === "1";
    view.help = q.get("help") === "1";
    view.shot = q.has("shot") ? +q.get("shot") || 0 : null;
    view.ans = {};
    (q.get("a") || "").split("-").forEach((pair) => {
      const m = /^(\d+)\.(\d+|r)$/.exec(pair);
      if (m && D.pending[+m[1]]) view.ans[+m[1]] = m[2] === "r" ? "r" : +m[2];
    });
    if (!byShort(view.s)) { const first = order()[0]; view.s = first ? first.r.short : null; }
  }
  function write() {
    const q = [];
    if (view.s) q.push("s=" + view.s);
    if (view.inst !== "context") q.push("i=" + view.inst);
    if (view.group !== "attention") q.push("g=project");
    const a = Object.keys(view.ans).map((i) => i + "." + view.ans[i]).join("-");
    if (a) q.push("a=" + a);
    if (view.cmd != null) q.push("cmd=" + encodeURIComponent(view.cmd));
    if (view.term) q.push("t=1");
    if (view.zoom) q.push("z=1");
    if (view.help) q.push("help=1");
    if (view.shot != null) q.push("shot=" + view.shot);
    const next = "#" + q.join("&");
    if (next !== location.hash) history.replaceState(null, "", location.pathname + location.search + next);
  }

  /* ───────────────────────────── the top line ───────────────────────────── */

  const LIMIT = { session: "5h", weekly_all: "week", weekly_scoped: "week", credits: "credits" };
  const LIMIT_LONG = { session: "5-hour window", weekly_all: "Week, all models", weekly_scoped: "Week", credits: "Credits" };

  function renderTop() {
    const counts = {};
    D.sessions.forEach((s) => { const e = eff(s); counts[e] = (counts[e] || 0) + 1; });
    const left = openPending().length;
    const s = cur();
    const accounts = D.accounts.map((a) => {
      const on = s && s.account === a.id;
      const lim = a.limits.filter((l) => l.kind === "session" || l.kind === "weekly_all").map((l) =>
        `<span class="lim"${l.active ? "" : " data-off"} title="${esc(LIMIT_LONG[l.kind])} · ${esc(until(l.resetsAt))}"><span class="lim-k">${LIMIT[l.kind]}</span>` +
        (on ? `<span class="bar"><i style="transform:scaleX(${Math.min(1, (l.percent || 0) / 100).toFixed(3)})"></i></span>` : "") + `<b class="num">${Math.round(l.percent || 0)}%</b></span>`).join("");
      return `<span class="acct"${on ? " data-on" : ""}><span class="acct-n">${esc(a.label)}</span><span class="acct-p">${esc(a.plan || "")}</span>${lim || `<span class="lim" data-off>no window read</span>`}</span>`;
    }).join("");
    $("top").innerHTML =
      `<div class="brand"><span class="core" data-asset="mnemo-core">${core()}</span><b class="wordmark">mnemo</b><span class="label">console</span></div>` +
      `<button class="waiting" data-act="next"${left ? "" : " data-clear"} title="N walks what waits for you">` +
        (left ? `<b class="num">${left}</b><span>${left === 1 ? "waits" : "wait"} for you</span><kbd>N</kbd>`
              : `<span class="clear-mark" data-asset="all-clear"></span><span>nothing waits for you</span>`) + `</button>` +
      `<div class="fleet">` + M.STATE_ORDER.map((st) =>
        `<span class="fl" data-state="${st}"${counts[st] ? "" : " data-zero"}>${gl(st)}<b class="num">${counts[st] || 0}</b><span class="fl-w">${M.WORD[st]}</span></span>`).join("") + `</div>` +
      `<div class="plans">${accounts}</div>` +
      `<button class="switch" data-act="motion" title="Motion: full or reduced"><span class="label">motion</span><b>${M.motion() === "reduced" ? "reduced" : "full"}</b></button>` +
      `<div class="cap"><span class="label">${D.synthetic ? "sample capture" : "this machine"}</span><span class="num">${hm(D.capturedAt)}</span></div>`;
  }

  /* ───────────────────────────── the roster ───────────────────────────── */

  const KIND = { question: "question", permission: "permission", merge: "merge", stalled: "stalled", blocked: "blocked" };

  function ask(p, isArmed) {
    const s = D.byId[p.session];
    if (!isOpen(p)) {
      const a = chosen(p);
      const what = !a ? "" : p.kind === "question" || view.ans[p.i] === "r" ? a.label : p.pr ? "#" + p.pr.number + " " + (p.pr.title || "") : p.kind === "permission" ? p.text : "";
      return `<div class="ask ask-done" data-p="${p.i}"><span class="ask-kind">${a ? esc(a.past) : "answered"}</span><span class="ask-what">${esc(cut(clean(what), 90))}</span>` +
        (local.last === p.i ? `<kbd title="Undo">U</kbd>` : "") + `</div>`;
    }
    const pr = p.pr;
    const acts = actions(p);
    if (!isArmed) {
      return `<button class="ask ask-line" data-kind="${p.kind}" data-p="${p.i}" data-go="${s.short}"><span class="ask-kind">${KIND[p.kind] || esc(p.kind)}</span>` +
        (pr ? `<span class="ask-pr mono">#${pr.number}</span><span class="ci" data-ci="${esc(pr.ci || "none")}">${esc(pr.ci || "no checks")}</span>` : "") +
        `<span class="ask-text">${esc(cut(clean(p.text), 160))}</span><span class="ask-n">${acts.length} ${acts.length === 1 ? "choice" : "choices"}</span><span class="ask-age">${age(p.at) || "now"}</span></button>`;
    }
    return `<div class="ask" data-kind="${p.kind}" data-p="${p.i}" data-armed>` +
      `<div class="ask-head"><span class="ask-kind">${KIND[p.kind] || esc(p.kind)}</span>` +
      (pr ? `<span class="ask-pr mono">#${pr.number}</span><span class="ci" data-ci="${esc(pr.ci || "none")}">${pr.ci ? "checks " + esc(pr.ci) : "no checks"}</span>` : "") +
      `<span class="ask-age">waiting ${age(p.at) || "now"}</span></div>` +
      `<div class="ask-text">${esc(p.text)}</div>` +
      `<div class="ask-acts">` + acts.map((a, i) =>
        `<button class="act" data-ans="${p.i}.${i}"><kbd>${i + 1}</kbd><span class="act-l">${esc(a.label)}</span>` +
        (a.desc ? `<small>${esc(cut(clean(a.desc), 200))}</small>` : "") + `</button>`).join("") +
      `<button class="act act-words" data-act="reply"><kbd>R</kbd><span class="act-l">in your words</span></button>` +
      `</div></div>`;
  }
  const asks = (s, staged) => bySession(s.id).map((p) => ask(p, staged && armed(s) === p)).join("");

  function entry(r, here, density, roomy) {
    const fam = family(r);
    const on = fam.indexOf(here) >= 0;
    const st = eff(r);
    const p = CODES[r.project] || "";
    if (st === "ended" && rank(r) === 3 && !on) {
      return `<article class="ent ent-fold" data-state="ended"><button class="ent-main" data-go="${r.short}">${gl("ended")}` +
        `<span class="ent-title">${esc(r.title)}</span><span class="proj">${esc(p)}</span><span class="ent-age num">${age(r.lastAt)}</span></button></article>`;
    }
    const tree = M.sum(r.totals && r.totals.tree);
    const shown = fam.slice(1).filter((c) => (on && density < 3) || c === here || eff(c) !== "ended" || bySession(c.id).length);
    const hidden = fam.length - 1 - shown.length;
    const band = rank(r);
    const tight = !on && !(roomy && roomy[r.short]) && (density >= 2 || (density >= 1 && band === 2));      // two rows instead of three
    return `<article class="ent" data-id="${r.short}" data-state="${st}"${on ? " data-on" : ""}${tight ? " data-c" : ""} data-band="${band}">` +
      `<button class="ent-main" data-go="${r.short}"${here === r ? " data-sel" : ""}>` +
        `<span class="fig" data-asset="session-figure">${sigil(r.id)}</span>` +
        `<span class="ent-title">${esc(r.title || r.name || r.short)}</span>` +
        `<span class="st">${gl(st)}<span>${esc(word(r))}</span></span>` +
        `<span class="ent-now">${nowHtml(r, band < 2 || on ? 260 : 150)}</span>` +
        `<span class="ent-meta"><span class="proj">${esc(p)}</span><span class="ent-proj">${esc(r.project || "")}</span>` +
          (r.role === "child" ? `<span class="tagx" title="A dispatched child whose parent is outside this capture">child</span>` : "") +
          `<span class="gauge">ctx ${ctxBar(r)}</span>` +
          `<span class="gauge">${fam.length > 1 ? "tree" : "spent"} <b class="num">${tok(tree)}</b></span>` +
          (tight && hidden ? `<span class="gauge" title="${hidden} ended ${hidden === 1 ? "child" : "children"}">+<b class="num">${hidden}</b> ended</span>` : "") +
          `<span class="ent-age num">${age(r.lastAt)}</span></span>` +
      `</button>` + asks(r, here === r) +
      (shown.length || (hidden && !tight) ? `<div class="kids">` + shown.map((c) => {
        const cs = eff(c);
        const depth = c.parent === r.id ? 0 : 1;
        return `<button class="kid" data-go="${c.short}" data-state="${cs}"${here === c ? " data-sel" : ""}${depth ? " data-deep" : ""}>` +
          `${gl(cs)}<span class="kid-title">${esc(c.title || c.name || c.short)}</span>` +
          `<span class="kid-st">${esc(word(c))}</span>` +
          `<span class="kid-ctx">${ctxBar(c)}</span>` +
          `<span class="kid-now">${nowHtml(c, 140)}</span></button>` + asks(c, here === c);
      }).join("") + (hidden && !tight ? `<button class="kid kid-more" data-go="${r.short}">${gl("ended")}<span>${hidden} ended ${hidden === 1 ? "child" : "children"}</span></button>` : "") + `</div>` : "") +
      `</article>`;
  }

  function renderRoster() {
    const here = cur();
    const list = order();
    local.order = list.map((x) => x.r);
    const left = openPending().length;
    $("rosterHead").innerHTML =
      `<span class="label">sessions</span><b class="num">${list.length}</b>` +
      `<span class="rh-sp"></span>` +
      `<button class="chip" data-act="group" title="G"><span>${view.group === "project" ? "by project" : "by attention"}</span><kbd>G</kbd></button>`;
    /* Every parent stays on screen: when the list is taller than the roster it is drawn again,
       tighter, up to three times. 1 folds the quiet entries to two rows, 2 folds every entry
       that is not on stage, 3 gathers the ended ones into one line. Room left over at the
       level that fits goes back to the entries highest in the list, which get their third
       row again. */
    const scroll = $("rosterScroll"), box = $("rosterList");
    const top = scroll.scrollTop;
    const heights = [];
    const fits = () => scroll.scrollHeight <= scroll.clientHeight + 1;
    let density = 0;
    scroll.removeAttribute("data-over");
    for (; density <= 3; density++) {
      scroll.dataset.density = density;
      box.innerHTML = rosterHtml(list, here, density, left);
      heights[density] = {};
      box.querySelectorAll(".ent[data-id]").forEach((el) => { heights[density][el.dataset.id] = el.offsetHeight; });
      if (fits()) break;
    }
    if (density > 0 && density <= 3) {
      let free = scroll.clientHeight - box.offsetHeight;
      const roomy = {};
      list.forEach((x) => {
        const more = heights[0][x.r.short] - heights[density][x.r.short];
        if (more > 0 && more <= free) { roomy[x.r.short] = 1; free -= more; }
      });
      if (Object.keys(roomy).length) {
        box.innerHTML = rosterHtml(list, here, density, left, roomy);
        if (!fits()) box.innerHTML = rosterHtml(list, here, density, left);
      }
    }
    scroll.toggleAttribute("data-over", !fits());
    scroll.scrollTop = top;
  }

  function rosterHtml(list, here, density, left, roomy) {
    let html = "", last = null;
    const hereRoot = here ? rootOf(here) : null;
    const heap = density >= 3 && view.group !== "project" ? list.filter((x) => x.k === 3 && x.r !== hereRoot) : [];
    list.forEach((x) => {
      const key = view.group === "project" ? x.r.project : x.k;
      if (key !== last) {
        last = key;
        if (view.group === "project") {
          const n = list.filter((y) => y.r.project === key).length;
          html += `<h2 class="band"><span class="proj">${esc(CODES[key] || "")}</span><span>${esc(key || "no project")}</span><b class="num">${n}</b></h2>`;
        } else {
          const n = list.filter((y) => y.k === key).length;
          html += `<h2 class="band" data-band="${key}"><span>${BANDS[key]}</span><b class="num">${key === 0 && left ? left : n}</b>` +
            (key === 0 && left ? `<small>${left === 1 ? "answer" : "answers"} wanted · <kbd>N</kbd> next</small>` : "") + `</h2>`;
        }
      }
      if (heap.indexOf(x) > 0) return;
      if (heap[0] === x && heap.length > 1) {
        html += `<article class="ent ent-fold" data-state="ended"><button class="ent-main" data-go="${x.r.short}">${gl("ended")}` +
          `<span class="ent-title">${heap.map((y) => esc(y.r.title || y.r.short)).join(" · ")}</span></button></article>`;
        return;
      }
      html += entry(x.r, here, density, roomy);
    });
    return html;
  }

  /* The beam: one mark that slides to the row on stage, so the eye is told where it is. */
  function placeBeam() {
    const scroll = $("rosterScroll");
    const sel = scroll.querySelector("[data-sel]");
    const beam = $("beam");
    if (!sel) { beam.style.opacity = "0"; return; }
    const pad = 12;
    const topOf = (el) => el.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop;
    const top = topOf(sel);
    const own = sel.nextElementSibling && sel.nextElementSibling.matches(".ask[data-armed]") ? sel.nextElementSibling : sel;   // keep its question in sight
    const bottom = topOf(own) + own.offsetHeight;
    if (bottom + pad > scroll.scrollTop + scroll.clientHeight) scroll.scrollTop = bottom + pad - scroll.clientHeight;
    if (top - pad < scroll.scrollTop) scroll.scrollTop = Math.max(0, top - pad);
    beam.style.opacity = "1";
    beam.style.transform = `translateY(${top}px)`;
    beam.style.height = sel.offsetHeight + "px";
  }

  /* ───────────────────────────── the stage ───────────────────────────── */

  /* The session's figure, large, inside a ring that fills as its context does. */
  function figure(s) {
    const c = s.context;
    const p = c && c.percent != null ? Math.max(0, Math.min(100, c.percent)) : 0;
    const R = 46, len = 2 * Math.PI * R;
    const ticks = Array.from({ length: 40 }, (_, i) => {
      const a = (i / 40) * Math.PI * 2 - Math.PI / 2, r0 = i % 10 === 0 ? 50 : 52, r1 = 54;
      return `<line x1="${(Math.cos(a) * r0).toFixed(2)}" y1="${(Math.sin(a) * r0).toFixed(2)}" x2="${(Math.cos(a) * r1).toFixed(2)}" y2="${(Math.sin(a) * r1).toFixed(2)}"/>`;
    }).join("");
    return `<div class="sh-fig" data-asset="session-figure" title="context ${Math.round(p)}%">` +
      `<svg viewBox="-56 -56 112 112" aria-hidden="true"><g class="fg-ticks">${ticks}</g><circle r="${R}" class="fg-track"/>` +
      `<circle r="${R}" class="fg-fill"${p >= 80 ? " data-hot" : ""} transform="rotate(-90)" stroke-dasharray="${(len * p / 100).toFixed(2)} ${len.toFixed(2)}"/></svg>${sigil(s.id)}</div>`;
  }

  function pulse(s) {
    const tl = s.timeline || [];
    if (!tl.length) return "";
    const t0 = Date.parse(tl[0].t), t1 = Math.max(Date.parse(tl[tl.length - 1].t) + 300000, t0 + 3600000);
    const sums = tl.map((b) => Object.keys(b.kinds).reduce((n, k) => n + b.kinds[k], 0));
    const max = Math.max.apply(null, sums.concat(1));
    const w = Math.max(0.12, 300000 / (t1 - t0) * 100 * 0.7);
    const bars = tl.map((b, i) => `<i style="left:${((Date.parse(b.t) - t0) / (t1 - t0) * 100).toFixed(2)}%;width:${w.toFixed(2)}%;height:${Math.max(6, sums[i] / max * 100).toFixed(0)}%"></i>`).join("");
    const kinds = Object.keys(s.activityCounts || {}).sort((a, b) => s.activityCounts[b] - s.activityCounts[a]).slice(0, 7)
      .map((k) => `<span><b class="num">${num(s.activityCounts[k])}</b> ${esc(k)}</span>`).join("");
    return `<section class="pulse"><div class="pulse-head"><span class="label">pulse</span><b class="num">${num(s.activityTotal)}</b><span class="pulse-w">tool calls</span>` +
      `<span class="pulse-kinds">${kinds}</span></div><div class="pulse-bars">${bars}</div>` +
      `<div class="pulse-axis"><span>${age(tl[0].t)} ago</span><span>${age(new Date(t1).toISOString()) === "0s" ? "now" : age(tl[tl.length - 1].t) + " ago"}</span></div></section>`;
  }

  const TAIL = 90;
  function terminal(s) {
    const all = s.activity || [];
    const running = all.filter((a) => a.running);
    const done = all.filter((a) => !a.running).slice(-TAIL);
    let burst = 0;                                  // where the newest burst of work begins
    for (let i = done.length - 1; i > 0; i--) if (Date.parse(done[i].at) - Date.parse(done[i - 1].at) > 300000) { burst = i; break; }
    let lastT = "";
    const line = (a) => {
      const t = hm(a.at), show = t !== lastT;
      lastT = t;
      return `<div class="tl"${a.ok === false ? " data-fail" : ""}><span class="tt">${show ? t : ""}</span><i class="tb"></i><span class="tx"><b>${esc(a.tool)}</b>` +
        `<span class="tg">${esc(cut(clean(a.target), 300))}</span></span><span class="tm">${a.ok === false ? "failed " : ""}${dur(a.ms)}</span></div>`;
    };
    const you = (text, note) => `<div class="ty"><span class="tt">${note || ""}</span><span class="ty-s">&gt;</span><span class="ty-x">${esc(text)}</span></div>`;
    const says = (label, text, at) => `<div class="ts"><span class="tt">${at ? hm(at) : ""}</span><i class="tb tb-say"></i><span class="ts-x">${label ? `<span class="ts-k">${label}</span>` : ""}${esc(cut(String(text).trim(), 2400))}</span></div>`;

    let html = `<div class="tn">Drawn from this session's own prompt, tool calls and last words. The live terminal mounts in this frame.</div>`;
    const earlier = (s.activityTotal || all.length) - done.length - running.length;
    if (s.role === "child" && s.intent) html += you(s.intent, "sent");
    if (earlier > 0) html += `<div class="tn">· · · ${num(earlier)} earlier tool calls</div>`;
    done.forEach((a, i) => {
      if (i === burst && s.lastPrompt) html += you(s.lastPrompt, "");
      html += line(a);
    });
    if (!done.length && s.lastPrompt) html += you(s.lastPrompt, "");
    const words = [];
    if (s.recap && s.recap.text && !(s.said && clean(s.said.text) === clean(s.recap.text))) words.push(["recap", s.recap]);
    if (s.said && s.said.text) words.push(["", s.said]);
    words.sort((a, b) => String(a[1].at || "").localeCompare(String(b[1].at || "")));
    words.forEach((w) => { html += says(w[0], w[1].text, w[1].at); });
    if (!s.hasTranscript && !all.length && s._made !== true) html += `<div class="tn">No transcript on disk for this session.</div>`;
    const p = armed(s);
    bySession(s.id).forEach((q) => {
      if (isOpen(q)) return;
      const a = chosen(q);
      html += `<div class="tq tq-done"><span class="tq-k">${KIND[q.kind] || esc(q.kind)}</span>${esc(cut(clean(q.text), 200))}</div>` + you(a ? (a.say || a.label) : "", "you");
    });
    (local.log[s.id] || []).forEach((l) => { html += you(l.text, "you"); });
    if (p) {
      const twice = s.said && clean(s.said.text).slice(0, 80) === clean(p.text).slice(0, 80);
      html += `<div class="tq" data-kind="${p.kind}"><span class="tq-k">${KIND[p.kind] || esc(p.kind)}</span>${twice ? "it stopped on the words above and waits for you" : esc(p.text)}` +
        `<div class="tq-acts">` + actions(p).map((a, i) => `<button class="tq-a" data-ans="${p.i}.${i}"><kbd>${i + 1}</kbd><span>${esc(a.label)}` +
          (a.desc ? `<small>${esc(cut(clean(a.desc), 240))}</small>` : "") + `</span></button>`).join("") + `</div></div>`;
    }
    running.forEach((a) => {
      html += `<div class="tw"><span class="tt">${hm(a.at)}</span><i class="tb tb-run"></i><span class="tx"><b>${esc(a.tool)}</b><span class="tg">${esc(cut(clean(a.target), 300))}</span></span><span class="tm">running ${age(a.at)}</span></div>`;
    });
    if (!running.length && eff(s) === "working") html += `<div class="tw"><span class="tt"></span><i class="tb tb-run"></i><span class="tx"><b>working</b></span><span class="tm"></span></div>`;
    const status = [s.permissionMode, model(s.model), s.effort, s.context && s.context.percent != null ? Math.round(s.context.percent) + "% context" : null].filter(Boolean).join("  ·  ");
    return `<section class="term"${view.term ? " data-typing" : ""}><div class="term-bar"><span class="label">terminal</span><span class="term-cwd mono">${esc(s.cwd || "")}</span>` +
      `<span class="term-hint"><kbd>Enter</kbd> type here <kbd>Z</kbd> ${view.zoom ? "give the room back" : "take the room"}</span></div>` +
      `<div class="term-scroll" id="termScroll"><div class="term-log mono">${html}</div></div>` +
      `<label class="term-in mono"><span class="ty-s">&gt;</span><input id="termIn" type="text" autocomplete="off" spellcheck="false" placeholder="${p ? "answer in your own words" : "say something to this session"}"></label>` +
      `<div class="term-status mono">${esc(status)}</div></section>`;
  }

  function renderStage(entered) {
    const s = cur();
    if (!s) { $("stage").innerHTML = `<div class="stage-none">No session in this capture.</div>`; return; }
    const r = rootOf(s), fam = family(r), st = eff(s);
    const pills = [
      s.branch ? `<span class="pill mono" title="branch">${esc(s.branch)}</span>` : "",
      s.worktree && s.worktree.name ? `<span class="pill" title="worktree">worktree ${esc(s.worktree.name)}</span>` : "",
      s.model ? `<span class="pill">${esc(model(s.model))}${s.effort ? " · " + esc(s.effort) : ""}</span>` : "",
      s.advisor ? `<span class="pill">advisor ${esc(model(s.advisor))}</span>` : "",
      s.account ? `<span class="pill" title="account">${esc((D.accounts.find((a) => a.id === s.account) || {}).label || s.account)}</span>` : "",
      s.startedAt ? `<span class="pill-q">started ${age(s.startedAt)} ago</span>` : "",
      s.turns ? `<span class="pill-q"><b class="num">${num(s.turns)}</b> ${s.turns === 1 ? "prompt" : "prompts"}${s.turnMs ? " · " + dur(s.turnMs) + " in turns" : ""}</span>` : "",
      `<span class="pill-q">${s._made ? "made in this page" : s.live ? "process live" : "no process"}</span>`,
    ].join("");
    const famHtml = fam.length > 1
      ? fam.map((m, i) => `<button class="fc" data-go="${m.short}" data-state="${eff(m)}"${m === s ? " data-sel" : ""}>` +
          `${i === 0 ? `<span class="fc-role">parent</span>` : ""}${gl(eff(m))}<span class="fc-t">${esc(m.title || m.name || m.short)}</span>` +
          (armed(m) ? `<span class="fc-w">waits</span>` : "") + `</button>`).join("")
      : `<span class="fam-none">No children. <kbd>:</kbd> dispatch sends one.</span>`;
    const n = nowOf(s);
    $("stage").innerHTML =
      `<div class="stage-in" data-state="${st}"${entered ? " data-enter" : ""}>` +
      `<header class="sh"><span class="sh-field" data-asset="stage-field" aria-hidden="true"></span>${figure(s)}<div class="sh-id">` +
        `<div class="sh-kick"><span class="proj">${esc(CODES[s.project] || "")}</span><span class="sh-proj">${esc(s.project || "")}</span>` +
          (s !== r ? `<span class="sh-of">child of <button class="lnk" data-go="${r.short}">${esc(r.title || r.short)}</button></span>` : s.role === "child" ? `<span class="sh-of">dispatched child, its parent is outside this capture</span>` : "") +
          `<span class="sh-short mono">${esc(s.short)}</span></div>` +
        `<h1 class="sh-title">${esc(s.title || s.name || s.short)}</h1>` +
        `<div class="sh-meta"><span class="st st-big">${gl(st)}<span>${esc(word(s))}</span></span>${pills}</div>` +
      `</div></header>` +
      `<nav class="fam"><span class="fam-k"><kbd>←</kbd><kbd>→</kbd></span>${famHtml}</nav>` +
      `<section class="now"${n && n.kind === "running" ? " data-running" : ""}><span class="label">now</span><div class="now-x">${nowHtml(s, 520)}</div><span class="now-age num">${n && n.at ? age(n.at) + " ago" : ""}</span></section>` +
      pulse(s) + terminal(s) + `</div>`;
    const scroll = $("termScroll");
    if (scroll) scroll.scrollTop = scroll.scrollHeight;
    const chip = $("stage").querySelector(".fc[data-sel]");
    if (chip) chip.parentElement.scrollTop = chip.offsetTop - chip.parentElement.offsetTop - 4;
  }

  /* ───────────────────────────── the instruments ───────────────────────────── */

  const sec = (title, count, body, note) =>
    `<section class="sec"><h3><span>${title}</span>${count == null ? "" : `<b class="num">${count}</b>`}${note ? `<small>${note}</small>` : ""}</h3>${body}</section>`;
  const none = (text) => `<p class="none">${text}</p>`;

  function chart(s) {
    const c = s.context;
    const series = (c && c.series) || [];
    if (series.length < 2) return `<div class="chart chart-none">${none("Too few calls to draw a curve.")}</div>`;
    const pts = series.map((p) => [Date.parse(p[0]), p[1]]);
    const t0 = pts[0][0], t1 = Math.max(pts[pts.length - 1][0], t0 + 1);
    const top = Math.max(c.window || 0, Math.max.apply(null, pts.map((p) => p[1])), 1);
    const W = 1000, H = 300;
    const x = (t) => ((t - t0) / (t1 - t0)) * W, y = (v) => H - (v / top) * H;
    const d = pts.map((p, i) => (i ? "L" : "M") + x(p[0]).toFixed(1) + " " + y(p[1]).toFixed(1)).join("");
    const cliffs = (c.compactions || []).map((k) => ({ x: x(Date.parse(k.at)), k })).filter((k) => k.x >= 0 && k.x <= W);
    return `<div class="chart"><div class="ch-plot"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">` +
      [0.25, 0.5, 0.75].map((g) => `<line class="ch-grid" x1="0" x2="${W}" y1="${H * g}" y2="${H * g}"/>`).join("") +
      `<path class="ch-area" d="${d}L${W} ${H}L0 ${H}Z"/><path class="ch-line" d="${d}"/>` +
      cliffs.map((k) => `<line class="ch-cliff" x1="${k.x.toFixed(1)}" x2="${k.x.toFixed(1)}" y1="0" y2="${H}"/>`).join("") +
      `</svg>` + cliffs.map((k) => `<i class="ch-mark" style="left:${(k.x / W * 100).toFixed(2)}%" title="compacted ${tok(k.k.pre)} → ${tok(k.k.post)}"></i>`).join("") +
      `<span class="ch-top num">${tok(top)}</span><span class="ch-now" style="top:${(y(pts[pts.length - 1][1]) / H * 100).toFixed(1)}%"></span></div>` +
      `<div class="ch-axis"><span>${age(series[0][0])} ago</span><span>${age(series[series.length - 1][0])} ago</span></div></div>`;
  }

  function tokRows(t) {
    if (!t) return "";
    const max = Math.max(t.input, t.output, t.cacheRead, t.cacheCreation, 1);
    const row = (label, n, extra) => `<div class="tr"><span class="tr-l">${label}</span><span class="bar"><i style="transform:scaleX(${Math.max(n ? 0.004 : 0, n / max).toFixed(4)})"></i></span><b class="num">${tok(n)}</b>${extra || ""}</div>`;
    return row("input", t.input) + row("output", t.output, t.thinking ? `<small>${tok(t.thinking)} of it thinking</small>` : "") +
      row("cache read", t.cacheRead) + row("cache written", t.cacheCreation);
  }

  function instContext(s) {
    const c = s.context || {};
    const own = s.totals && s.totals.own, r = rootOf(s), fam = family(r);
    const p = c.percent;
    const head = `<div class="big"><b class="num big-n"${p >= 80 ? " data-hot" : ""}>${p == null ? "–" : Math.round(p)}<small>%</small></b>` +
      `<div class="big-x"><span><b class="num">${tok(c.tokens)}</b> of a <b class="num">${tok(c.window)}</b> window</span>` +
      `<span class="big-q">${p == null ? "no call measured yet" : p >= 80 ? "close to full, a compaction is near" : tok(Math.max(0, (c.window || 0) - (c.tokens || 0))) + " free"}</span></div></div>`;
    const comps = c.compactions || [];
    const compNote = comps.length
      ? `<p class="note"><b class="num">${comps.length}</b> ${comps.length === 1 ? "compaction" : "compactions"}. The last, ${age(comps[comps.length - 1].at)} ago, took ` +
        `<b class="num">${tok(comps[comps.length - 1].pre)}</b> down to <b class="num">${tok(comps[comps.length - 1].post)}</b>` +
        (comps[comps.length - 1].trigger ? ` (${esc(comps[comps.length - 1].trigger)})` : "") + `.</p>`
      : `<p class="note">Never compacted.</p>`;
    const subs = ((s.tokens && s.tokens.subagents) || []).slice().sort((a, b) => M.sum(b.tokens) - M.sum(a.tokens));
    const subSum = subs.reduce((n, a) => n + M.sum(a.tokens), 0);
    const main = s.tokens ? M.sum(s.tokens.main) : 0, side = s.tokens ? M.sum(s.tokens.sidechain) : 0;
    const spent = `<div class="split"><span><b class="num">${tok(main)}</b> its own calls</span>` +
      (side ? `<span><b class="num">${tok(side)}</b> side chain</span>` : "") +
      `<span><b class="num">${tok(subSum)}</b> ${subs.length} sub-agent${subs.length === 1 ? "" : "s"}</span></div>` + tokRows(own);
    const models = Object.keys((s.tokens && s.tokens.byModel) || {});
    const byModel = models.length > 1 ? `<div class="rows">` + models.map((m) => `<div class="row"><span class="row-m">${esc(model(m))}</span><b class="num">${tok(M.sum(s.tokens.byModel[m]))}</b></div>`).join("") + `</div>` : "";
    const cost = s.cost ? `<p class="note">Claude Code recorded <b class="num">$${(s.cost.usd || 0).toFixed(2)}</b>` +
      (s.cost.apiMs ? `, ${dur(s.cost.apiMs)} in the API` : "") + (s.cost.toolMs ? `, ${dur(s.cost.toolMs)} in tools` : "") +
      (s.cost.linesAdded != null ? `, <b class="num">+${num(s.cost.linesAdded)}</b> <b class="num">−${num(s.cost.linesRemoved)}</b> lines` : "") + `.</p>` : "";
    const subList = subs.length ? `<div class="rows">` + subs.slice(0, 6).map((a) =>
      `<div class="row"><span class="row-m">${esc(cut(clean(a.description || a.type || a.id), 60))}</span><span class="row-q">${esc(a.type || "")} · ${num(a.calls)} calls</span><b class="num">${tok(M.sum(a.tokens))}</b></div>`).join("") +
      (subs.length > 6 ? `<div class="row row-more">and ${subs.length - 6} more</div>` : "") + `</div>` : none("It sent no sub-agent.");
    const treeSum = M.sum(r.totals && r.totals.tree);
    const tree = `<div class="rows">` + fam.map((m, i) => {
      const n = M.sum(m.totals && m.totals.own);
      return `<button class="row row-go" data-go="${m.short}"${m === s ? " data-sel" : ""}>${gl(eff(m))}<span class="row-m">${esc(m.title || m.short)}</span>` +
        `<span class="bar"><i style="transform:scaleX(${(treeSum ? n / treeSum : 0).toFixed(4)})"></i></span><b class="num">${tok(n)}</b></button>`;
    }).join("") + `</div>`;
    const acct = D.accounts.slice().sort((a, b) => (b.id === s.account) - (a.id === s.account)).map((a) =>
      `<div class="plan"${a.id === s.account ? " data-on" : ""}><div class="plan-h"><b>${esc(a.label)}</b><span>${esc(a.plan || "")}</span>` +
      `<small>${a.id === s.account ? "this session's account" : ""}${a.usageReadAt ? " · read " + age(a.usageReadAt) + " ago" : ""}</small></div>` +
      (a.limits.length ? a.limits.map((l) =>
        `<div class="tr"${l.active ? "" : " data-off"}><span class="tr-l">${LIMIT_LONG[l.kind] || esc(l.kind)}${l.kind === "weekly_scoped" && l.model ? ", " + esc(l.model) : ""}</span>` +
        `<span class="bar"><i style="transform:scaleX(${Math.min(1, (l.percent || 0) / 100).toFixed(3)})"></i></span><b class="num">${Math.round(l.percent || 0)}%</b>` +
        `<small>${esc(until(l.resetsAt))}${l.severity && l.severity !== "normal" ? " · " + esc(l.severity) : ""}</small></div>`).join("") : none("No window read for this account.")) + `</div>`).join("");
    return {
      sum: `<b class="num">${p == null ? "–" : Math.round(p) + "%"}</b> full · <b class="num">${tok(M.sum(own))}</b> spent`,
      body: head + chart(s) + compNote +
        sec("Spent by this session", tok(M.sum(own)), spent + byModel + cost) +
        sec("Its sub-agents", subs.length, subList) +
        sec(fam.length > 1 ? "Its tree" : "Its tree is itself", tok(treeSum), fam.length > 1 ? tree : none("No children: the tree is this session.")) +
        sec("Plan windows", null, acct),
    };
  }

  const REASON = {
    judge_none_relevant: "the judge found none relevant",
    notice_below_bar: "below the bar to speak",
    deduped: "already given, deduplicated",
    below_min_tokens: "prompt under the minimum length",
    session_cap_reached: "session cap reached",
    no_term_match: "no term matched",
    absolute_floor_fail: "under the absolute floor",
  };
  const reason = (r) => REASON[r] || String(r || "no reason recorded").replace(/_/g, " ");
  const judgeBar = (j) => (j == null ? `<span class="jb" data-none title="not judged"></span>` : `<span class="jb" title="judge ${j}"><i style="transform:scaleX(${Math.max(0, Math.min(1, j)).toFixed(2)})"></i></span><b class="num jn">${(+j).toFixed(2).replace(/^0/, "")}</b>`);

  /* The memory dial: the session's life as one turn of a clock, start at twelve. Inner ring,
     rules mnemo gave it; middle, rules it asked for; outer, the prompts where mnemo found
     candidates and held them back. */
  function dial(s) {
    const m = s.memory;
    const times = [].concat(m.injected, m.read, m.considered).map((e) => Date.parse(e.at)).filter((t) => !isNaN(t));
    const start = Date.parse(s.startedAt), end = Date.parse(s.lastAt);
    const t0 = Math.min.apply(null, times.concat(isNaN(start) ? [] : [start], [D.now]));
    const t1 = Math.max.apply(null, times.concat(isNaN(end) ? [] : [end], [t0 + 1]));
    const SWEEP = 330;
    const at = (iso, r) => {
      const a = ((Date.parse(iso) - t0) / (t1 - t0) * SWEEP - 90) * Math.PI / 180;
      return [(Math.cos(a) * r).toFixed(2), (Math.sin(a) * r).toFixed(2)];
    };
    const arc = (r) => {
      const a1 = (SWEEP - 90) * Math.PI / 180;
      return `<path class="dl-ring" d="M0 ${-r}A${r} ${r} 0 1 1 ${(Math.cos(a1) * r).toFixed(2)} ${(Math.sin(a1) * r).toFixed(2)}"/>`;
    };
    const ticks = Array.from({ length: 34 }, (_, i) => {
      const a = (i * 10 - 90) * Math.PI / 180, r0 = i % 3 === 0 ? 91 : 94;
      return `<line x1="${(Math.cos(a) * r0).toFixed(2)}" y1="${(Math.sin(a) * r0).toFixed(2)}" x2="${(Math.cos(a) * 97).toFixed(2)}" y2="${(Math.sin(a) * 97).toFixed(2)}"/>`;
    }).join("");
    const held = m.considered.map((e) => { const p = at(e.at, 80); return `<circle class="dl-held" cx="${p[0]}" cy="${p[1]}" r="2.6"/>`; }).join("");
    const asked = m.read.map((e) => { const p = at(e.at, 58); return `<rect class="dl-asked" x="${p[0] - 2.2}" y="${p[1] - 2.2}" width="4.4" height="4.4" transform="rotate(45 ${p[0]} ${p[1]})"/>`; }).join("");
    const given = m.injected.map((e) => {
      const p = at(e.at, 36), q = at(e.at, 15);
      return `<line class="dl-spoke" x1="${q[0]}" y1="${q[1]}" x2="${p[0]}" y2="${p[1]}"/><circle class="dl-given" cx="${p[0]}" cy="${p[1]}" r="${(2.2 + (e.judge == null ? 0.5 : e.judge) * 2.4).toFixed(2)}"/>`;
    }).join("");
    return `<div class="dial"><svg viewBox="-100 -100 200 200" aria-hidden="true"><g class="dl-ticks">${ticks}</g>${arc(80)}${arc(58)}${arc(36)}` +
      `<g class="dl-core" data-asset="memory-core"><circle r="15" class="dl-c1"/><circle r="9.5" class="dl-c2"/><circle r="3" class="dl-c3"/></g>` +
      `${held}${asked}${given}<path class="dl-start" d="M0 -99V-30"/></svg>` +
      `<span class="dl-12 label">start</span></div>`;
  }

  function instMemory(s) {
    const m = s.memory;
    const heldN = m.considered.length;
    const legend = `<div class="legend">` +
      `<div class="lg" data-k="given"><i></i><b class="num">${m.injected.length}</b><span>given by mnemo</span></div>` +
      `<div class="lg" data-k="asked"><i></i><b class="num">${m.read.length}</b><span>asked for</span></div>` +
      `<div class="lg" data-k="held"><i></i><b class="num">${heldN}</b><span>held back</span></div>` +
      `<div class="lg lg-q"><b class="num">${num(m.prompts)}</b><span>${m.prompts === 1 ? "prompt" : "prompts"} mnemo read</span></div></div>`;

    const reasons = {};
    m.considered.forEach((c) => { reasons[c.reason] = (reasons[c.reason] || 0) + 1; });
    const reasonLine = Object.keys(reasons).sort((a, b) => reasons[b] - reasons[a]).map((r) => `<span><b class="num">${reasons[r]}</b> ${esc(reason(r))}</span>`).join("");
    const held = heldN ? `<div class="reasons">${reasonLine}</div>` + m.considered.slice().reverse().map((c) =>
      `<div class="held"><div class="held-h"><span class="held-r">${esc(reason(c.reason))}</span><span class="when num">${age(c.at)} ago</span></div>` +
      c.candidates.map((k) => `<div class="cand"><span class="slug mono">${esc(k.slug)}</span><span class="num sc" title="retrieval score">${k.score == null ? "–" : (+k.score).toFixed(2)}</span>${judgeBar(k.judge)}</div>`).join("") + `</div>`).join("")
      : none("Nothing held back: mnemo found no candidate it kept to itself.");

    const given = m.injected.length ? m.injected.slice().reverse().map((k) =>
      `<div class="cand cand-given"><i class="mk mk-given"></i><span class="slug mono">${esc(k.slug)}</span><span class="num sc" title="retrieval score">${k.score == null ? "–" : (+k.score).toFixed(2)}</span>${judgeBar(k.judge)}<span class="when num">${age(k.at)}</span></div>`).join("")
      : none("mnemo put no rule into this session's prompts.");

    const asked = m.read.length ? m.read.slice().reverse().map((k) => {
      const what = k.slug || [k.topic, k.query].filter(Boolean).join(" · ") || (k.hits || []).slice(0, 2).join(", ");
      return `<div class="cand cand-asked"><i class="mk mk-asked"></i><span class="slug mono">${esc(cut(clean(what), 80))}</span>` +
        `<span class="sc-q">${esc(String(k.tool || "").replace(/_/g, " "))}${k.count != null ? " · " + k.count + (k.count === 1 ? " hit" : " hits") : ""}</span><span class="when num">${age(k.at)}</span></div>`;
    }).join("") : none("It asked mnemo for nothing over MCP.");

    const loaded = (m.instructions.length || m.briefings.length) ? m.instructions.map((f) =>
      `<div class="file"><span class="file-k">${esc(f.type)}</span><span class="file-p mono">${path(f.path)}</span><span class="when num">${bytes(f.bytes)}</span></div>`).join("") +
      m.briefings.map((b) => `<div class="file"><span class="file-k">briefing</span><span class="file-p">${esc(b.project || "")} <span class="q">${esc(b.date || "")}</span></span>` +
        `<span class="when num">${b.entries != null ? b.entries + (b.entries === 1 ? " entry" : " entries") : esc(b.source || "")}</span></div>`).join("")
      : none("No instruction file or briefing recorded at its start.");

    const touched = (m.claude.length || m.skills.length) ? m.claude.slice().reverse().slice(0, 14).map((f) =>
      `<div class="file"><span class="file-k" data-op="${esc(f.op)}">${esc(f.op)}</span><span class="file-p mono">${path(f.path)}</span><span class="when num">${age(f.at)}</span></div>`).join("") +
      (m.claude.length > 14 ? `<div class="file file-more">and ${m.claude.length - 14} earlier</div>` : "") +
      m.skills.map((k) => `<div class="file"><span class="file-k">skill</span><span class="file-p mono">${esc(k.name)}</span><span class="when num">${age(k.at)}</span></div>`).join("")
      : none("It has not touched Claude Code's memory since it started.");

    const fr = m.frictions.length ? sec("Corrections mnemo wrote down", m.frictions.length, m.frictions.map((f) =>
      `<div class="fr"><q>${esc(cut(clean(f.quote), 220))}</q><span class="fr-r">${esc(cut(clean(f.rule), 220))}</span></div>`).join("")) : "";

    const v = D.vault || {};
    const out = (v.reflex && v.reflex.outcomes) || {};
    const silent = Object.keys(out).filter((k) => k !== "emitted").reduce((n, k) => n + out[k], 0);
    const vault = `<p class="note vault">The vault holds <b class="num">${num(v.rules)}</b> rules. Across every session mnemo read <b class="num">${num(v.reflex && v.reflex.prompts)}</b> prompts, spoke on <b class="num">${num(out.emitted || 0)}</b> and stayed silent on <b class="num">${num(silent)}</b>.</p>`;

    const parts = [
      [m.injected.length, sec("Given", m.injected.length, given, "retrieval score · judge"), "no rule given"],
      [m.read.length, sec("Asked for", m.read.length, asked), "none asked for"],
      [m.instructions.length + m.briefings.length, sec("Loaded at the start", m.instructions.length + m.briefings.length, loaded), "no instruction file or briefing recorded at its start"],
      [m.claude.length + m.skills.length, sec("Claude Code's memory since", m.claude.length + m.skills.length, touched), "Claude Code's own memory untouched"],
    ];
    const lacks = parts.filter((x) => !x[0]).map((x) => x[2]);
    return {
      sum: `<b class="num">${m.injected.length}</b> given · <b class="num">${heldN}</b> held back`,
      body: `<div class="mem-top">${dial(s)}${legend}</div>` +
        sec("Held back", heldN, held, "candidates mnemo found and kept to itself, and why") +
        parts.filter((x) => x[0]).map((x) => x[1]).join("") + fr +
        (lacks.length ? `<p class="note lacks">Also: ${lacks.join(", ")}.</p>` : "") + vault,
    };
  }

  function instSight(s) {
    const w = s.web, f = s.files;
    const shots = w.shots.length ? `<div class="shots">` + w.shots.map((x, i) =>
      `<button class="shot" data-shot="${i}"><span class="shot-f"><img src="../${esc(x.src)}" alt="" loading="lazy"></span>` +
      `<span class="shot-t">${esc(cut(clean(x.title || host(x.url)), 60))}</span><span class="shot-u mono">${esc(cut(String(x.url || "").replace(/^https?:\/\//, ""), 48))}</span><span class="when num">${age(x.at)}</span></button>`).join("") + `</div>` : "";
    const seen = {};
    w.shots.forEach((x) => { seen[x.url] = 1; });
    const pages = w.pages.filter((p) => !seen[p.url]).slice(-8).reverse().map((p) =>
      `<div class="file"><span class="file-k">page</span><span class="file-p">${esc(cut(clean(p.title || ""), 50))} <span class="q mono">${esc(cut(String(p.url || "").replace(/^https?:\/\//, ""), 50))}</span></span><span class="when num">${age(p.at)}</span></div>`).join("");
    const searches = w.searches.slice().reverse().map((q) =>
      `<div class="search"><div class="search-q"><span class="file-k">search</span><span>${esc(q.query)}</span><span class="when num">${age(q.at)}</span></div>` +
      (q.results || []).slice(0, 4).map((r) => `<div class="src"><span>${esc(cut(clean(r.title), 70))}</span><span class="q mono">${esc(host(r.url))}</span></div>`).join("") +
      ((q.results || []).length > 4 ? `<div class="src src-more">and ${(q.results || []).length - 4} more sources</div>` : "") + `</div>`).join("");
    const fetches = w.fetches.slice().reverse().map((x) =>
      `<div class="fetch"><div class="file"><span class="file-k"${x.code && x.code >= 400 ? ' data-op="fail"' : ""}>${esc(x.code || "fetch")}</span><span class="file-p mono">${esc(cut(String(x.url || "").replace(/^https?:\/\//, ""), 70))}</span>` +
      `<span class="when num">${[bytes(x.bytes), dur(x.ms)].filter(Boolean).join(" · ")}</span></div>${x.summary ? `<p class="fetch-s">${esc(cut(clean(x.summary), 320))}</p>` : ""}</div>`).join("");
    const arts = w.artifacts.slice().reverse().map((a) =>
      `<div class="file"><span class="file-k">artifact</span><span class="file-p">${esc(a.title || a.url)}</span><span class="when num">${age(a.at)}</span></div>`).join("");
    const webN = w.shots.length + w.pages.length + w.searches.length + w.fetches.length + w.artifacts.length;
    const webBody = webN ? shots + pages + searches + fetches + arts : none("No page, search, fetch or artifact in this session.");

    const edited = f.edited.length ? f.edited.slice(0, 12).map((x) =>
      `<div class="file"><span class="file-k" data-op="edit">${x.edits}×</span><span class="file-p mono">${path(x.path)}</span><span class="when num">${age(x.lastAt)}</span></div>`).join("") +
      (f.edited.length > 12 ? `<div class="file file-more">and ${f.edited.length - 12} more</div>` : "") : none("It has edited no file.");
    const readList = f.read.length ? f.read.slice(0, 10).map((x) =>
      `<div class="file"><span class="file-k">${x.count}×</span><span class="file-p mono">${path(x.path)}</span></div>`).join("") +
      (f.read.length > 10 ? `<div class="file file-more">and ${f.read.length - 10} more</div>` : "") : none("It has read no file.");
    const prs = s.prs.length ? s.prs.map((p) =>
      `<a class="pr" href="${esc(p.url)}" target="_blank" rel="noopener"><span class="pr-n mono">#${p.number}</span><span class="pr-t">${esc(p.title || "")}</span>` +
      `<span class="pr-s">${esc(p.state || "")}${p.draft ? " · draft" : ""}</span><span class="ci" data-ci="${esc(p.ci || "none")}">${p.ci ? "checks " + esc(p.ci) : "no checks"}</span></a>`).join("")
      : none("It has opened no pull request.");
    const parts = [
      [webN, sec("On the web", webN, webBody, w.shots.length ? "the screenshots are the ones it took" : ""), "no page, search, fetch or artifact"],
      [s.prs.length, sec("Pull requests", s.prs.length, prs), "no pull request"],
      [f.edited.length, sec("Files edited", f.edited.length, edited), "no file edited"],
      [f.read.length, sec("Files read", f.read.length, readList), "no file read"],
    ];
    const lacks = parts.filter((x) => !x[0]).map((x) => x[2]);
    return {
      sum: `<b class="num">${webN}</b> on the web · <b class="num">${f.edited.length}</b> edited · <b class="num">${s.prs.length}</b> PR`,
      body: parts.filter((x) => x[0]).map((x) => x[1]).join("") +
        (lacks.length ? `<p class="note lacks">${lacks.length === parts.length ? "This session has looked at nothing yet: " : "Also: "}${lacks.join(", ")}.</p>` : ""),
    };
  }

  function renderInsts(entered) {
    const s = cur();
    if (!s) { $("insts").innerHTML = ""; return; }
    const keep = {};
    INSTS.forEach((k) => { const el = document.querySelector(`.inst[data-inst="${k}"] .inst-body`); if (el && !entered) keep[k] = el.scrollTop; });
    const made = { context: instContext(s), memory: instMemory(s), sight: instSight(s) };
    const title = { context: "Context and tokens", memory: "Memory", sight: "Sight" };
    $("insts").innerHTML = INSTS.map((k) =>
      `<section class="inst" data-inst="${k}"${view.inst === k ? " data-open" : ""}${entered ? " data-enter" : ""}>` +
      `<button class="inst-h" data-inst-go="${k}"><kbd>${k[0].toUpperCase()}</kbd><span class="inst-t">${title[k]}</span><span class="inst-sum">${made[k].sum}</span></button>` +
      `<div class="inst-body">${made[k].body}</div></section>`).join("");
    INSTS.forEach((k) => { const el = document.querySelector(`.inst[data-inst="${k}"] .inst-body`); if (el && keep[k]) el.scrollTop = keep[k]; });
  }

  /* ───────────────────────────── overlays ───────────────────────────── */

  const KEYS = [
    ["↑ ↓", "J K", "previous and next session"],
    ["← →", "H L", "through the session's family: parent, then each child"],
    ["N", "Shift N", "next and previous thing waiting for you"],
    ["1 … 9", "", "answer what the session on stage waits for"],
    ["R", "", "answer in your own words"],
    ["U", "", "take back the last answer"],
    ["Tab", "", "the session you were on before"],
    ["Home End", "", "top and bottom of the roster"],
    ["C M S", "", "context, memory, sight"],
    ["PgUp PgDn", "", "scroll the open instrument"],
    ["Enter", "", "type into the terminal"],
    ["Z", "", "give the terminal the instruments' room, and back"],
    ["G", "", "roster by attention or by project"],
    [":", "Ctrl K", "the command line"],
    ["Esc", "", "leave whatever is open"],
  ];
  function renderOverlay() {
    const s = cur();
    let html = "";
    if (view.help) {
      html = `<div class="veil" data-act="close"><div class="sheet"><h2 class="label">keys</h2><div class="sheet-k">` +
        KEYS.map((k) => `<div><span>${k[0].split(" ").map((x) => `<kbd>${x}</kbd>`).join("")}${k[1] ? `<i>or</i>` + k[1].split(" ").map((x) => `<kbd>${x}</kbd>`).join("") : ""}</span><span>${k[2]}</span></div>`).join("") +
        `</div><p class="note">Nothing here reaches a session: answers, merges and commands change this page only.</p></div></div>`;
    } else if (view.shot != null && s && s.web.shots[view.shot]) {
      const x = s.web.shots[view.shot];
      html = `<div class="veil" data-act="close"><figure class="light"><img src="../${esc(x.src)}" alt=""><figcaption><b>${esc(x.title || "")}</b><span class="mono">${esc(x.url || "")}</span>` +
        `<span class="num">${view.shot + 1} of ${s.web.shots.length} · ${age(x.at)} ago · ← → · Esc</span></figcaption></figure></div>`;
    }
    $("overlay").innerHTML = html;
  }

  /* ───────────────────────────── the command line ───────────────────────────── */

  const VERBS = [
    { v: "new", form: "new <project> <first prompt>", say: "start a session in a project", arg: "project", rest: true },
    { v: "dispatch", form: "dispatch <parent> <task>", say: "send a child from a parent session", arg: "parent", rest: true },
    { v: "message", form: "message <session> <words>", say: "say something to a session", arg: "session", rest: true },
    { v: "merge", form: "merge green", say: "merge every pull request whose checks are green", arg: "merge" },
    { v: "stop", form: "stop <session>", say: "stop a session", arg: "session" },
    { v: "go", form: "go <session>", say: "put a session on the stage", arg: "session" },
  ];

  function handles() {
    const seen = {};
    HANDLES = {};
    D.sessions.forEach((s) => {
      let h = String(s.name || "").replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "");
      if (!h || seen[h]) h = s.short;
      seen[h] = 1;
      HANDLES[s.id] = h;
    });
  }
  const findSession = (word) => D.sessions.find((s) => HANDLES[s.id] === word || s.short === word) || null;
  function matchSessions(q, onlyParents) {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const pool = [];
    local.order.forEach((r) => family(r).forEach((m) => pool.push(m)));
    return pool.filter((s) => (!onlyParents || s.role === "parent") && words.every((w) =>
      (HANDLES[s.id] + " " + (s.title || "") + " " + (s.project || "") + " " + s.short).toLowerCase().indexOf(w) >= 0));
  }
  const sessionRow = (s, fill, run) => ({
    mark: gl(eff(s)), main: s.title || s.short, sub: (CODES[s.project] || "") + " " + (s.project || "") + " · " + word(s) + " · " + HANDLES[s.id], fill, run,
  });

  /** What the command line offers for the text typed so far. */
  function suggest(text) {
    const m = /^(\S*)(\s+)?(\S*)(\s+)?([\s\S]*)$/.exec(text.replace(/^\s+/, ""));
    const verb = m[1].toLowerCase(), typingVerb = !m[2], arg = m[3], typingArg = !m[4], rest = m[5].trim();
    const cmd = VERBS.find((c) => c.v === verb);
    const out = [];
    if (typingVerb || !cmd) {
      if (typingVerb) VERBS.filter((c) => c.v.indexOf(verb) === 0).forEach((c) => out.push({ mark: `<span class="sg-v">${c.v}</span>`, main: c.form, sub: c.say, fill: c.v + " " }));
      if (text.trim()) matchSessions(text).slice(0, 7).forEach((s) => out.push(sessionRow(s, null, () => { stage(s); return "on stage: " + (s.title || s.short); })));
      return out;
    }
    if (cmd.arg === "merge") {
      const green = openPending().filter((p) => p.kind === "merge" && p.pr && p.pr.ci === "green");
      const all = openPending().filter((p) => p.kind === "merge");
      out.push({ mark: gl("ready"), main: "merge green", sub: green.length ? green.map((p) => "#" + p.pr.number).join(" ") + " · " + green.length + " of " + all.length + " waiting pull requests" : "no waiting pull request has green checks",
        run: () => { green.forEach((p) => { view.ans[p.i] = 0; local.last = p.i; }); return green.length ? "merged " + green.map((p) => "#" + p.pr.number).join(", ") : "nothing merged: no waiting pull request has green checks"; } });
      all.filter((p) => !arg || arg === "green" || matchSessions(arg).indexOf(D.byId[p.session]) >= 0).forEach((p) => {
        const s = D.byId[p.session];
        out.push({ mark: gl(eff(s)), main: "merge #" + p.pr.number + " " + (p.pr.title || ""), sub: "checks " + (p.pr.ci || "none") + " · " + (s.title || s.short),
          run: () => { view.ans[p.i] = 0; local.last = p.i; return "merged #" + p.pr.number; } });
      });
      return out;
    }
    if (cmd.arg === "project") {
      const proj = D.projects.find((p) => p.name === arg);
      if (proj && !typingArg) {
        out.push({ mark: `<span class="sg-v">new</span>`, main: "start in " + proj.name + (rest ? ": " + rest : ""), sub: rest ? "Enter starts it" : "type its first prompt",
          run: rest ? () => { const s = make({ project: proj.name, title: cut(rest, 60), lastPrompt: rest }); stage(s); return "started in " + proj.name; } : null });
      } else {
        D.projects.filter((p) => p.name.toLowerCase().indexOf(arg.toLowerCase()) >= 0).slice(0, 8).forEach((p) =>
          out.push({ mark: `<span class="proj">${esc(CODES[p.name] || "")}</span>`, main: p.name, sub: p.sessions.length + " sessions in the capture", fill: "new " + p.name + " " }));
      }
      return out;
    }
    const target = findSession(arg);
    if (target && !typingArg && cmd.rest) {
      out.push({ mark: gl(eff(target)), main: cmd.v + " → " + (target.title || target.short) + (rest ? ": " + rest : ""), sub: rest ? "Enter sends it" : "type the words",
        run: rest ? () => {
          if (cmd.v === "dispatch") { const c = make({ project: target.project, title: cut(rest, 60), intent: rest, role: "child", parent: target.id, agentKind: "background" }); stage(c); return "dispatched from " + (target.title || target.short); }
          say(target, rest); stage(target); return "sent to " + (target.title || target.short);
        } : null });
      return out;
    }
    matchSessions(arg, cmd.arg === "parent").slice(0, 8).forEach((s) => {
      const fill = cmd.v + " " + HANDLES[s.id] + " ";
      if (cmd.rest) out.push(sessionRow(s, fill, null));
      else if (cmd.v === "stop") out.push(sessionRow(s, null, () => { local.state[s.id] = "ended"; local.word[s.id] = "stopped"; return "stopped " + (s.title || s.short); }));
      else out.push(sessionRow(s, null, () => { stage(s); return "on stage: " + (s.title || s.short); }));
    });
    return out;
  }

  let made = 0;
  /** A session that exists in this page only. */
  function make(over) {
    const zero = () => ({ input: 0, output: 0, cacheRead: 0, cacheCreation: 0, thinking: 0 });
    const id = "page" + String(++made).padStart(4, "0") + "-0000-4000-8000-000000000000";
    const active = D.accounts.find((a) => a.active) || D.accounts[0] || {};
    const s = Object.assign({
      id, short: id.slice(0, 8), role: "parent", agentKind: "interactive", live: true, abandoned: false, state: "working",
      project: null, cwd: null, branch: null, worktree: null, title: "New session", name: null, account: active.id || null,
      model: null, effort: null, advisor: null, permissionMode: null, startedAt: D.capturedAt, lastAt: D.capturedAt, parent: null,
      children: [], intent: null, detail: null, needs: null, suggestedReply: null, may: null, recap: null, lastPrompt: null, said: null,
      turns: 0, turnMs: 0, tokens: { main: zero(), sidechain: zero(), byModel: {}, subagents: [] }, cost: null,
      context: { tokens: null, window: 200000, percent: null, series: [], compactions: [] }, activity: [], activityTotal: 0,
      activityCounts: {}, timeline: [], web: { searches: [], fetches: [], pages: [], shots: [], artifacts: [] },
      files: { edited: [], read: [] }, prs: [], pendingAsk: null,
      memory: { instructions: [], claude: [], skills: [], briefings: [], injected: [], considered: [], prompts: 0, read: [], frictions: [] },
      hasTranscript: false, totals: { own: zero(), tree: zero() }, _made: true,
    }, over);
    D.sessions.push(s);
    D.byId[s.id] = s;
    if (s.parent && D.byId[s.parent]) D.byId[s.parent].children.push(s.id);
    handles();
    return s;
  }
  function say(s, text) {
    (local.log[s.id] = local.log[s.id] || []).push({ text });
    if (eff(s) === "idle") local.state[s.id] = "working";
  }

  let offers = [];
  function renderCmd() {
    const open = view.cmd != null;
    $("cmd").toggleAttribute("data-open", open);
    const pop = $("cmdPop");
    if (!open) { pop.hidden = true; return; }
    offers = suggest(view.cmd);
    local.sel = Math.max(0, Math.min(local.sel, offers.length - 1));
    pop.hidden = false;
    pop.innerHTML = offers.length ? offers.map((o, i) =>
      `<button class="sg" data-offer="${i}"${i === local.sel ? " data-sel" : ""}><span class="sg-m">${o.mark || ""}</span><span class="sg-x">${esc(o.main)}</span><span class="sg-s">${esc(o.sub || "")}</span>` +
      `<span class="sg-k">${i === local.sel ? (o.run ? "<kbd>Enter</kbd>" : o.fill ? "<kbd>Tab</kbd>" : "") : ""}</span></button>`).join("")
      : `<div class="sg sg-none">Nothing matches. Try a session's name, or new, dispatch, message, merge, stop.</div>`;
  }
  function take(i) {
    const o = offers[i];
    if (!o) return;
    const input = $("cmdIn");
    if (o.run) {
      const said = o.run();
      view.cmd = null;
      input.value = "";
      input.blur();
      $("cmdSaid").textContent = said || "";
      $("cmdSaid").removeAttribute("data-shown");
      void $("cmdSaid").offsetWidth;
      $("cmdSaid").setAttribute("data-shown", "");
      render();
    } else if (o.fill) {
      view.cmd = input.value = o.fill;
      local.sel = 0;
      renderCmd();
      write();
    }
  }
  function openCmd(text) {
    view.cmd = text || "";
    view.term = false;
    local.sel = 0;
    const input = $("cmdIn");
    input.value = view.cmd;
    input.focus();
    renderCmd();
    write();
  }
  function closeCmd() {
    view.cmd = null;
    $("cmdIn").value = "";
    $("cmdIn").blur();
    renderCmd();
    write();
  }

  /* ───────────────────────────── render ───────────────────────────── */

  let shown = null;
  function render() {
    if (!byShort(view.s)) { const first = order()[0]; view.s = first ? first.r.short : null; }
    const entered = shown !== null && shown !== view.s;      // nothing "enters" on the first draw
    shown = view.s;
    $("app").toggleAttribute("data-zoom", view.zoom);
    renderTop();
    renderRoster();
    renderStage(entered);
    renderInsts(entered);
    renderCmd();
    renderOverlay();
    $("keys").innerHTML = `<span><kbd>↑</kbd><kbd>↓</kbd> sessions</span><span><kbd>←</kbd><kbd>→</kbd> family</span><span><kbd>N</kbd> next waiting</span>` +
      `<span><kbd>1</kbd>–<kbd>9</kbd> answer</span><span><kbd>Tab</kbd> last</span><span><kbd>:</kbd> command</span><span><kbd>?</kbd> keys</span>`;
    write();
    placeBeam();
    const input = $("termIn");
    if (view.term && input && document.activeElement !== input) input.focus();
  }

  function stage(s) {
    if (!s) return;
    if (s.short !== view.s) local.prev = view.s;
    view.s = s.short;
    view.shot = null;
  }
  function go(s) { stage(s); render(); }

  function step(d) {
    const here = cur(), list = local.order;
    const i = list.indexOf(rootOf(here));
    const next = list[Math.max(0, Math.min(list.length - 1, i < 0 ? 0 : i + d))];
    if (next && next !== here) go(next);
  }
  function side(d) {
    const here = cur(), fam = family(rootOf(here));
    if (fam.length < 2) return;
    go(fam[(fam.indexOf(here) + d + fam.length) % fam.length]);
  }
  /** What waits, in the order the roster lists it: one key walks parents and children alike. */
  function walk() {
    const out = [];
    order().forEach((x) => family(x.r).forEach((m) => bySession(m.id).forEach((p) => { if (isOpen(p)) out.push(p); })));
    return out;
  }
  function nextPending(d) {
    const open = walk();
    if (!open.length) return;
    const here = cur();
    let i = open.findIndex((p) => p.session === here.id);
    if (i < 0) i = d > 0 ? -1 : 0;
    go(D.byId[open[(i + d + open.length) % open.length].session]);
  }
  function answer(pi, ai, words) {
    const p = D.pending[pi];
    if (!p || !isOpen(p)) return;
    if (ai === "r") local.words[pi] = words;
    else if (!actions(p)[ai]) return;
    view.ans[pi] = ai;
    local.last = pi;
    stage(D.byId[p.session]);
    render();
    const el = document.querySelector(`.ask-done[data-p="${pi}"]`);
    if (el) el.setAttribute("data-fresh", "");
  }
  function undo() {
    if (local.last == null || !(local.last in view.ans)) return;
    const p = D.pending[local.last];
    delete view.ans[local.last];
    local.last = null;
    go(D.byId[p.session]);
  }

  /* ───────────────────────────── hands ───────────────────────────── */

  function onClick(e) {
    const t = e.target.closest("[data-ans],[data-go],[data-act],[data-inst-go],[data-shot],[data-offer]");
    if (!t) return;
    if (t.dataset.ans) { const [p, a] = t.dataset.ans.split("."); answer(+p, +a); return; }
    if (t.dataset.go) { go(byShort(t.dataset.go)); return; }
    if (t.dataset.instGo) { view.inst = t.dataset.instGo; render(); return; }
    if (t.dataset.shot) { view.shot = +t.dataset.shot; render(); return; }
    if (t.dataset.offer) { take(+t.dataset.offer); return; }
    const act = t.dataset.act;
    if (act === "next") nextPending(1);
    else if (act === "group") { view.group = view.group === "project" ? "attention" : "project"; render(); }
    else if (act === "motion") { M.motion(M.motion() === "reduced" ? "full" : "reduced"); render(); }
    else if (act === "reply") { view.term = true; render(); }
    else if (act === "close" && (e.target === t || e.target.tagName === "IMG")) { view.help = false; view.shot = null; render(); }
  }

  function onKey(e) {
    const el = e.target;
    if (el.id === "cmdIn") {
      if (e.key === "Escape") { closeCmd(); e.preventDefault(); }
      else if (e.key === "ArrowDown" || e.key === "ArrowUp") { local.sel = (local.sel + (e.key === "ArrowDown" ? 1 : -1) + offers.length) % Math.max(1, offers.length); renderCmd(); e.preventDefault(); }
      else if (e.key === "Tab") { const o = offers[local.sel]; if (o && o.fill) take(local.sel); e.preventDefault(); }
      else if (e.key === "Enter") { take(local.sel); e.preventDefault(); }
      return;
    }
    if (el.id === "termIn") {
      if (e.key === "Escape") { view.term = false; el.blur(); render(); e.preventDefault(); }
      else if (e.key === "Enter" && el.value.trim()) {
        const s = cur(), p = armed(s), text = el.value.trim();
        view.term = false;
        if (p) answer(p.i, "r", text); else { say(s, text); render(); }
        e.preventDefault();
      }
      return;
    }
    if (e.ctrlKey && e.key.toLowerCase() === "k") { openCmd(""); e.preventDefault(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    const s = cur();
    if (view.help || view.shot != null) {
      if (view.shot != null && s && (k === "ArrowRight" || k === "ArrowLeft")) { const n = s.web.shots.length; view.shot = (view.shot + (k === "ArrowRight" ? 1 : n - 1)) % n; }
      else { view.help = false; view.shot = null; }
      render(); e.preventDefault(); return;
    }
    let hit = true;
    if (k === "ArrowDown" || k === "j") step(1);
    else if (k === "ArrowUp" || k === "k") step(-1);
    else if (k === "ArrowRight" || k === "l") side(1);
    else if (k === "ArrowLeft" || k === "h") side(-1);
    else if (k === "Home") { if (local.order[0]) go(local.order[0]); }
    else if (k === "End") { if (local.order.length) go(local.order[local.order.length - 1]); }
    else if (k === "n") nextPending(1);
    else if (k === "N" || k === "p") nextPending(-1);
    else if (k >= "1" && k <= "9") { const p = s && armed(s); if (p) answer(p.i, +k - 1); }
    else if (k === "r") { if (s && armed(s)) { view.term = true; render(); } }
    else if (k === "u") undo();
    else if (k === "Tab") { const b = byShort(local.prev); if (b) go(b); }
    else if (k === "c" || k === "m" || k === "s") { view.inst = { c: "context", m: "memory", s: "sight" }[k]; view.zoom = false; render(); flash(view.inst); }
    else if (k === "PageDown" || k === "PageUp") { const b = document.querySelector(`.inst[data-inst="${view.inst}"] .inst-body`); if (b) b.scrollTop += (k === "PageDown" ? 1 : -1) * b.clientHeight * 0.8; }
    else if (k === "Enter" || k === "i") { view.term = true; render(); }
    else if (k === "z") { view.zoom = !view.zoom; render(); }
    else if (k === "g") { view.group = view.group === "project" ? "attention" : "project"; render(); }
    else if (k === ":" || k === "/") openCmd("");
    else if (k === "?") { view.help = true; render(); }
    else if (k === "Escape") { if (view.zoom) { view.zoom = false; render(); } }
    else hit = false;
    if (hit) e.preventDefault();
  }
  function flash(inst) {
    const el = document.querySelector(`.inst[data-inst="${inst}"]`);
    if (!el) return;
    el.removeAttribute("data-flash");
    void el.offsetWidth;
    el.setAttribute("data-flash", "");
  }

  /* ───────────────────────────── start ───────────────────────────── */

  function codes() {
    const used = {};
    const names = D.projects.map((p) => p.name);
    D.sessions.forEach((s) => { if (s.project && names.indexOf(s.project) < 0) names.push(s.project); });
    names.forEach((name) => {
      const parts = String(name).toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
      const flat = parts.join("");
      const tries = [flat.slice(0, 3)];
      if (parts.length > 1) tries.push((parts[0].slice(0, 2) + parts[1][0]), (parts[0][0] + parts[1].slice(0, 2)));
      for (let i = 3; i < flat.length; i++) tries.push(flat.slice(0, 2) + flat[i]);
      for (let i = 2; i < 99; i++) tries.push(flat.slice(0, 2) + i);
      CODES[name] = tries.find((t) => t && !used[t]) || flat.slice(0, 3);
      used[CODES[name]] = 1;
    });
  }

  window.MNEMO_READY.then((data) => {
    D = data;
    D.pending.forEach((p, i) => { p.i = i; });
    codes();
    handles();
    read();
    $("boot").remove();
    $("app").hidden = false;
    if (view.cmd != null) { $("cmdIn").value = view.cmd; $("cmdIn").focus(); }
    render();
    /* One line for shots.py: a page that never drew, or drew without its stylesheet, logs no
       error, so the check needs to be told that it did. */
    console.info("mnemo console drew " + D.sessions.length + " sessions, " + openPending().length + " waiting, " +
      (getComputedStyle($("app")).display === "grid" && $("stage").querySelector(".term") ? "styled" : "UNSTYLED"));
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    $("cmdIn").addEventListener("input", (e) => { view.cmd = e.target.value; local.sel = 0; renderCmd(); write(); });
    $("cmdIn").addEventListener("focus", () => { if (view.cmd == null) openCmd(""); });
    $("cmdIn").addEventListener("blur", () => { if (view.cmd === "") closeCmd(); });
    document.addEventListener("focusin", (e) => { if (e.target.id === "termIn" && !view.term) { view.term = true; $("stage").querySelector(".term").setAttribute("data-typing", ""); write(); } });
    document.addEventListener("focusout", (e) => { if (e.target.id === "termIn" && view.term && document.hasFocus()) { view.term = false; const t = $("stage").querySelector(".term"); if (t) t.removeAttribute("data-typing"); write(); } });
    window.addEventListener("hashchange", () => { read(); if (view.cmd != null) $("cmdIn").value = view.cmd; render(); });
    window.addEventListener("resize", placeBeam);
    document.fonts && document.fonts.ready.then(placeBeam);
  }).catch((err) => {
    $("boot").textContent = "No capture could be read: run python sample.py beside this folder.";
    throw err;
  });
})();

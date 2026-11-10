/* Orbit · the station: a session brought forward. Its terminal (drawn from the capture, as
   DATA.md says: the real one will sit there), its family, and three readings. */
(function () {
  "use strict";
  const O = window.O;
  const M = window.mnemo;
  const esc = O.esc;
  const $ = (id) => document.getElementById(id);

  const T = (O.station = {});
  O.typed = {};      // replies typed into a terminal on this page: {short: [text]}

  const title = (s) => s.title || s.name || s.short;
  const none = (what) => `<p class="none">${what}</p>`;
  const sec = (name, n, body, note) =>
    `<section class="sec"><h3 class="label">${name}${n != null ? ` <b class="num">${n}</b>` : ""}${note ? `<span class="sec-note">${note}</span>` : ""}</h3>${body}</section>`;
  const more = (list, cap) => (list.length > cap ? `<p class="none">+ ${list.length - cap} earlier</p>` : "");
  const newest = (list, cap) => list.slice().sort((a, b) => (b.at || "").localeCompare(a.at || "")).slice(0, cap);
  const bar = (v, max, cls) => `<span class="bar ${cls || ""}"><i style="transform:scaleX(${max > 0 ? O.clamp(v / max, 0, 1).toFixed(4) : 0})"></i></span>`;
  const short = (p) => {
    const parts = String(p || "").replace(/\\/g, "/").split("/");
    return parts.length > 3 ? "…/" + parts.slice(-3).join("/") : parts.join("/");
  };

  /* ---------- family ---------- */
  function familyHTML(s) {
    const b = O.bodyOf(s);
    const rows = b.fam.map((f) => {
      const st = O.state(f.s), e = O.eff(f.s);
      const p = e.open[0];
      const pr = f.s.prs[0];
      const ctx = f.s.context && f.s.context.percent;
      return (
        `<div class="fam-row${f.s === s ? " on" : ""}" data-open="${f.s.short}" data-state="${st}" style="--d:${f.depth}">` +
        `<span class="fam-mark">${O.mark(st)}</span>` +
        `<span class="fam-main"><span class="fam-title">${esc(title(f.s))}</span>` +
        `<span class="fam-meta"><span class="st" data-state="${st}">${M.WORD[st]}</span> · <span class="num">${O.tok(O.sum(f.s.totals && f.s.totals.own))}</span>${ctx != null ? ` · <span class="num">${O.pct(ctx)}</span> ctx` : ""}` +
        (pr ? ` · <span class="mono">#${pr.number}</span> ${esc(e.merged ? "merged" : pr.state || "")}${pr.ci && !e.merged ? " · checks " + esc(pr.ci) : ""}` : "") +
        (e.answers.length ? ` · you: ${esc(e.answers[e.answers.length - 1].label)}` : "") + `</span>` +
        (p ? `<span class="fam-ask"><b>${O.KIND_GLYPH[p.kind]} ${O.KIND[p.kind]}</b> ${esc(p.text.replace(/\s+/g, " ").slice(0, 90))}</span><span class="fam-acts">${p.choices.slice(0, 2).map((c, i) => `<button data-answer="${p.key}.${i}">${esc(c.label)}</button>`).join("")}</span>` : "") +
        `</span></div>`
      );
    }).join("");
    const kids = b.kids.length;
    return `<h3 class="label">family <b class="num">${kids ? kids + 1 : 1}</b><span class="sec-note">${kids ? "the parent and what it dispatched" : "no children dispatched"}</span></h3><div class="fam-list">${rows}</div>`;
  }

  /* ---------- terminal ---------- */
  function stripHTML(s) {
    const tl = s.timeline;
    if (!tl.length) return `<div class="strip-empty">no tool calls inside the capture window · ${O.int(s.activityTotal)} in the whole session</div>`;
    const t0 = Date.parse(tl[0].t), t1 = Math.max(Date.parse(tl[tl.length - 1].t) + 3e5, t0 + 36e5);
    const n = Math.max(12, Math.round((t1 - t0) / 3e5));
    let max = 1;
    const rows = tl.map((b) => {
      const all = Object.values(b.kinds).reduce((a, c) => a + c, 0);
      max = Math.max(max, all);
      return { i: Math.round((Date.parse(b.t) - t0) / 3e5), all, mem: b.kinds.memory || 0 };
    });
    const w = 100 / n;
    const rects = rows.map((r) => {
      const h = (r.all / max) * 100, hm = (r.mem / max) * 100;
      return `<rect x="${(r.i * w + w * 0.12).toFixed(3)}" y="${(100 - h).toFixed(2)}" width="${(w * 0.76).toFixed(3)}" height="${h.toFixed(2)}"/>` +
        (hm ? `<rect class="mem" x="${(r.i * w + w * 0.12).toFixed(3)}" y="${(100 - h).toFixed(2)}" width="${(w * 0.76).toFixed(3)}" height="${hm.toFixed(2)}"/>` : "");
    }).join("");
    const top = Object.entries(s.activityCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${esc(k)} <b class="num">${v}</b>`).join(" · ");
    return `<div class="strip-top"><span><b class="num">${O.int(s.activityTotal)}</b> tool calls · ${top}</span><span class="num">${O.clock(tl[0].t)} → ${O.clock(new Date(t1).toISOString())}</span></div>` +
      `<svg class="strip" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${rects}</svg>`;
  }

  function termHTML(s) {
    const st = O.state(s), e = O.eff(s);
    let out = "";
    if (s.intent) out += `<div class="t-you t-dim"><span class="t-p">dispatched with</span>${esc(s.intent)}</div>`;
    if (s.lastPrompt) out += `<div class="t-you"><span class="t-p">❯</span>${esc(s.lastPrompt)}</div>`;
    const acts = s.activity.slice(-24);
    if (s.activity.length > acts.length) out += `<div class="t-fold">… ${O.int(s.activityTotal - acts.length)} earlier tool calls</div>`;
    out += acts.map((a) =>
      `<div class="t-act${a.running ? " run" : ""}${a.ok === false ? " bad" : ""}">` +
      `<span class="t-dot">${a.running ? "◌" : a.ok === false ? "✕" : "●"}</span><span class="t-tool" title="${esc(a.tool || "")}">${esc(String(a.tool || a.kind).replace(/^mcp__(.+?)__/, "$1 · "))}</span>` +
      `<span class="t-target">${esc(a.target || "")}</span><span class="t-ms">${a.running ? "running" : O.ms(a.ms)}</span></div>`).join("");
    if (s.said && s.said.text) out += `<div class="t-said">${esc(s.said.text)}</div>`;
    if (s.recap && s.recap.text && (!s.said || s.recap.text !== s.said.text)) out += `<div class="t-recap"><span class="t-p">※ recap</span>${esc(s.recap.text)}</div>`;
    if (s.detail) out += `<div class="t-recap"><span class="t-p">status</span>${esc(s.detail)}</div>`;
    for (const a of e.answers) out += `<div class="t-you t-new"><span class="t-p">❯</span>${esc(a.label)}<em>answered here · ${esc(O.KIND[a.kind])}</em></div>`;
    for (const t of O.typed[s.short] || []) out += `<div class="t-you t-new"><span class="t-p">❯</span>${esc(t)}<em>typed here · not sent anywhere</em></div>`;
    const p = e.open[0];
    if (p) {
      const armed = O.view.p === s.short;
      out += `<div class="t-ask${armed ? " armed" : ""}" data-state="${st}"><div class="t-ask-head"><span class="st" data-state="${st}">${O.KIND_GLYPH[p.kind]} ${O.KIND[p.kind]}</span><span>waiting ${O.age(p.at)}${s.abandoned ? " · mnemo gave up asking" : ""}</span>` +
        `<span class="t-ask-key">${armed ? "press a number" : "<kbd>Tab</kbd> to answer by key"}</span></div>` +
        `<div class="t-ask-text">${esc(p.text)}</div>` +
        (p.pr ? `<div class="card-pr mono">#${p.pr.number} · ${esc(p.pr.repo || "")} · checks ${esc(p.pr.ci || "none")}</div>` : "") + O.choicesHTML(p) + `</div>`;
    } else if (st === "working") out += `<div class="t-work"><i class="t-caret"></i>working</div>`;
    return out;
  }

  /* ---------- reading 1: context and tokens ---------- */
  function tokenRows(t) {
    const rows = [
      ["cache read", t.cacheRead, ""], ["cache write", t.cacheCreation, ""], ["input", t.input, ""],
      ["output", t.output, t.thinking ? `of which thinking ${O.tok(t.thinking)}` : ""],
    ];
    const max = Math.max(1, ...rows.map((r) => r[1])), all = O.sum(t) || 1;
    return `<div class="rows">` + rows.map((r) =>
      `<div class="row"><span class="row-name">${r[0]}${r[2] ? `<small>${r[2]}</small>` : ""}</span>${bar(r[1], max)}<span class="num row-v">${O.tok(r[1])}</span><span class="num row-s">${((r[1] / all) * 100).toFixed(r[1] / all < 0.1 ? 1 : 0)}%</span></div>`).join("") + `</div>`;
  }

  function contextHTML(s) {
    const c = s.context, tk = s.tokens, tot = s.totals;
    let out = "";
    if (c && c.tokens != null) {
      out += `<div class="hero"><div class="hero-n num">${O.pct(c.percent)}</div><div class="hero-t"><b>context full</b><span><span class="num">${O.tok(c.tokens)}</span> of <span class="num">${O.tok(c.window)}</span> tokens</span>` +
        `<span>${c.compactions.length ? c.compactions.length + (c.compactions.length > 1 ? " compactions" : " compaction") : "never compacted"}</span></div>` +
        `<div class="hero-n num alt">${O.tok(O.sum(tot.tree))}</div><div class="hero-t"><b>spent by its tree</b><span><span class="num">${O.tok(O.sum(tot.own))}</span> its own</span><span>${s.children.length ? s.children.length + (s.children.length > 1 ? " children" : " child") : "no children"}</span></div></div>`;
      out += sec("the context, call by call", null, c.series.length > 1 ? `<div class="curve" id="curve"></div>` : none("Too few calls to draw a curve."), c.compactions.length ? "the cliffs are compactions" : "");
      if (c.compactions.length)
        out += `<div class="rows tight">` + c.compactions.map((k) => `<div class="row plain"><span class="num">${O.clock(k.at)}</span><span>compacted <b class="num">${O.tok(k.pre)}</b> → <b class="num">${O.tok(k.post)}</b></span><span class="row-s">${esc(k.trigger || "")}</span></div>`).join("") + `</div>`;
    } else out += `<div class="hero"><div class="hero-n num">–</div><div class="hero-t"><b>no context reading</b><span>this session has no transcript in the capture</span></div></div>`;

    out += sec("spent by kind", O.tok(O.sum(tot.own)), tokenRows(tot.own), "this session and its sub-agents");

    // where it went: main, side chain, sub-agents, children
    const subs = tk.subagents, subSum = subs.reduce((n, a) => n + O.sum(a.tokens), 0);
    const kids = s.children.map((id) => O.data.byId[id]).filter(Boolean);
    const kidSum = O.sum(tot.tree) - O.sum(tot.own);
    const parts = [["its own calls", O.sum(tk.main)], ["side chain", O.sum(tk.sidechain)], [`sub-agents · ${subs.length}`, subSum], [`children · ${kids.length}`, kidSum]];
    const max = Math.max(1, ...parts.map((p) => p[1]));
    out += sec("where it went", O.tok(O.sum(tot.tree)),
      `<div class="rows">` + parts.map((p) => `<div class="row"><span class="row-name">${p[0]}</span>${bar(p[1], max)}<span class="num row-v">${O.tok(p[1])}</span><span class="num row-s">${((p[1] / (O.sum(tot.tree) || 1)) * 100).toFixed(0)}%</span></div>`).join("") + `</div>`, "the whole tree");

    if (subs.length)
      out += sec("sub-agents", subs.length, `<div class="rows">` + subs.slice().sort((a, b) => O.sum(b.tokens) - O.sum(a.tokens)).map((a) =>
        `<div class="row"><span class="row-name">${esc(a.description || a.id)}<small>${esc(a.type || "")} · ${esc(O.model(a.model))} · ${a.calls} calls</small></span>${bar(O.sum(a.tokens), Math.max(...subs.map((x) => O.sum(x.tokens))))}<span class="num row-v">${O.tok(O.sum(a.tokens))}</span></div>`).join("") + `</div>`);
    if (kids.length)
      out += sec("children", kids.length, `<div class="rows">` + kids.map((k) =>
        `<div class="row link" data-open="${k.short}"><span class="row-name">${O.mark(O.state(k))} ${esc(title(k))}<small>${M.WORD[O.state(k)]} · ${esc(O.model(k.model))}</small></span>${bar(O.sum(k.totals.tree), Math.max(...kids.map((x) => O.sum(x.totals.tree))))}<span class="num row-v">${O.tok(O.sum(k.totals.tree))}</span></div>`).join("") + `</div>`);

    const models = Object.entries(tk.byModel);
    if (models.length)
      out += sec("by model", null, `<div class="rows">` + models.map(([m, t]) => `<div class="row"><span class="row-name">${esc(O.model(m))}</span>${bar(O.sum(t), Math.max(...models.map((x) => O.sum(x[1]))))}<span class="num row-v">${O.tok(O.sum(t))}</span></div>`).join("") + `</div>`);

    if (s.cost)
      out += sec("what claude code recorded", null, `<div class="facts"><span><b class="num">$${(s.cost.usd || 0).toFixed(2)}</b> at API prices</span><span><b class="num">${O.ms(s.cost.apiMs)}</b> in the API</span><span><b class="num">${O.ms(s.cost.toolMs)}</b> in tools</span><span><b class="num">+${O.int(s.cost.linesAdded)} −${O.int(s.cost.linesRemoved)}</b> lines</span></div>`);

    const acct = O.data.accounts.find((a) => a.id === s.account);
    out += sec("plan windows", null, acct ? (acct.limits.length ? `<div class="rows">` + acct.limits.map((l) => {
      const name = l.kind === "session" ? "5-hour window" : l.kind === "weekly_all" ? "week, all models" : l.kind === "weekly_scoped" ? "week, " + (l.model || "one model") : l.kind;
      const reset = O.until(l.resetsAt);
      return `<div class="row${l.active ? "" : " off"}"><span class="row-name">${esc(name)}<small>${reset ? "resets in " + reset : l.active ? "" : "not running"}</small></span>${bar(100 - (l.percent || 0), 100, "left")}<span class="num row-v">${Math.round(100 - (l.percent || 0))}%</span><span class="row-s">left</span></div>`;
    }).join("") + `</div>` : none("No plan reading for this account.")) : none("No account on this session."), acct ? "account " + esc(acct.label || acct.id) + (acct.plan ? " · " + esc(acct.plan) : "") : "");
    return out;
  }

  function drawCurve(s) {
    const host = $("curve");
    if (!host) return;
    const c = s.context, W = host.clientWidth, H = Math.round(O.clamp(W * 0.36, 130, 250));
    const pad = { l: 44, r: 14, t: 16, b: 22 };
    const pts = c.series.map((p) => [Date.parse(p[0]), p[1]]);
    const t0 = pts[0][0], t1 = Math.max(pts[pts.length - 1][0], t0 + 1);
    const X = (t) => pad.l + ((t - t0) / (t1 - t0)) * (W - pad.l - pad.r);
    const Y = (v) => pad.t + (1 - Math.min(v, c.window) / c.window) * (H - pad.t - pad.b);
    let grid = "";
    for (const f of [0.25, 0.5, 0.75, 1]) grid += `<path class="grid" d="M${pad.l} ${Y(c.window * f).toFixed(1)}H${W - pad.r}"/><text class="ax" x="${pad.l - 8}" y="${(Y(c.window * f) + 3.5).toFixed(1)}" text-anchor="end">${O.tok(c.window * f)}</text>`;
    const d = pts.map((p, i) => (i ? "L" : "M") + X(p[0]).toFixed(1) + " " + Y(p[1]).toFixed(1)).join("");
    const cliffs = c.compactions.map((k) => `<path class="cliff" d="M${X(Date.parse(k.at)).toFixed(1)} ${pad.t - 6}V${H - pad.b}"/>`).join("");
    const last = pts[pts.length - 1];
    host.innerHTML =
      `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs><linearGradient id="cf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".16"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>` +
      grid + `<path class="base" d="M${pad.l} ${H - pad.b}H${W - pad.r}"/>` + cliffs +
      `<path d="${d}L${X(last[0]).toFixed(1)} ${H - pad.b}L${pad.l} ${H - pad.b}Z" fill="url(#cf)"/><path class="line" d="${d}"/>` +
      `<circle class="end" cx="${X(last[0]).toFixed(1)}" cy="${Y(last[1]).toFixed(1)}" r="4"/>` +
      `<text class="ax" x="${pad.l}" y="${H - 6}">${O.clock(c.series[0][0])}</text><text class="ax" x="${W - pad.r}" y="${H - 6}" text-anchor="end">${O.clock(c.series[c.series.length - 1][0])}</text>` +
      `<g class="hover" visibility="hidden"><path class="cross" d=""/><circle class="end" r="4"/></g></svg><div class="tip" hidden></div>`;
    const svg = host.firstChild, hover = svg.querySelector(".hover"), tip = host.lastChild;
    svg.addEventListener("mousemove", (ev) => {
      const x = ev.clientX - svg.getBoundingClientRect().left;
      let best = pts[0];
      for (const p of pts) if (Math.abs(X(p[0]) - x) < Math.abs(X(best[0]) - x)) best = p;
      hover.setAttribute("visibility", "visible");
      hover.firstChild.setAttribute("d", `M${X(best[0]).toFixed(1)} ${pad.t}V${H - pad.b}`);
      hover.lastChild.setAttribute("cx", X(best[0])); hover.lastChild.setAttribute("cy", Y(best[1]));
      tip.hidden = false;
      tip.innerHTML = `<b class="num">${O.tok(best[1])}</b> · ${((best[1] / c.window) * 100).toFixed(0)}% · ${O.clock(new Date(best[0]).toISOString())}`;
      tip.style.transform = `translate(${Math.round(O.clamp(X(best[0]) + 10, 0, W - 150))}px,${Math.round(Math.max(0, Y(best[1]) - 30))}px)`;
    });
    svg.addEventListener("mouseleave", () => { hover.setAttribute("visibility", "hidden"); tip.hidden = true; });
  }

  /* ---------- reading 2: memory ---------- */
  const REASON = {
    emitted: "spoke: a rule was handed over",
    judge_none_relevant: "the judge found none relevant",
    notice_below_bar: "relevance under the bar",
    below_min_tokens: "the prompt was too short",
    session_cap_reached: "this session had its share",
    no_term_match: "no term matched",
    deduped: "already given in this session",
    absolute_floor_fail: "score under the floor",
  };
  O.reason = (r) => REASON[r] || String(r || "").replace(/_/g, " ");

  function memoryHTML(s) {
    const m = s.memory;
    const spoke = new Set(m.injected.map((r) => r.at)).size;
    let out = `<div class="hero"><div class="hero-n num mem">${m.injected.length}</div><div class="hero-t"><b>rules mnemo handed it</b><span>over <span class="num">${m.prompts || 0}</span> prompts it looked at</span><span>it spoke <span class="num">${spoke}</span> times, held back <span class="num">${m.considered.length}</span></span></div>` +
      `<div class="hero-n num alt">${m.read.length}</div><div class="hero-t"><b>times it asked mnemo</b><span><span class="num">${m.instructions.length}</span> files loaded at the start</span><span><span class="num">${m.claude.length}</span> touches of Claude Code's memory</span></div></div>`;

    out += sec("loaded at the start", m.instructions.length + m.briefings.length,
      m.instructions.length || m.briefings.length ? `<div class="rows tight">` +
        m.instructions.map((i) => `<div class="row plain"><span class="tag">${esc(i.type === "AutoMem" ? "MEMORY.md" : i.type === "Project" ? "CLAUDE.md" : i.type)}</span><span class="mono path" title="${esc(i.path)}">${esc(short(i.path))}</span><span class="num row-s">${O.bytes(i.bytes)}</span></div>`).join("") +
        m.briefings.slice(0, 6).map((b) => `<div class="row plain"><span class="tag mem">briefing</span><span>${esc(b.project || "")} · ${esc(b.date || "")}</span><span class="row-s">${b.entries != null ? b.entries + " entries" : ""} · ${esc(b.source || "")}</span></div>`).join("") +
        `</div>` + more(m.briefings, 6) : none("Nothing recorded at the start of this session."), "Claude Code's own files, and mnemo's briefings");

    out += sec("rules mnemo injected", m.injected.length, m.injected.length ? `<div class="rows tight">` + newest(m.injected, 30).map((r) =>
      `<div class="row plain"><span class="num">${O.clock(r.at)}</span><span class="mono slug">${esc(r.slug)}</span><span class="judge" title="the judge's relevance, 0 to 1">${bar(r.judge || 0, 1, "mem")}<span class="num">${r.judge != null ? r.judge.toFixed(2) : "–"}</span></span><span class="num row-s" title="retrieval score">${r.score != null ? r.score.toFixed(1) : ""}</span></div>`).join("") + `</div>` + more(m.injected, 30) : none("mnemo put no rule into this session's prompts."), "time · rule · judge · score");

    out += sec("rules it asked for", m.read.length, m.read.length ? `<div class="rows tight">` + newest(m.read, 30).map((r) =>
      `<div class="row plain"><span class="num">${O.clock(r.at)}</span><span class="mono slug">${esc(r.slug || r.topic || r.query || "")}</span><span class="row-s">${esc(String(r.tool || "").replace(/_/g, " "))} · ${r.count != null ? r.count + (r.count === 1 ? " hit" : " hits") : ""} · ${O.ms(r.ms)}</span></div>`).join("") + `</div>` + more(m.read, 30) : none("It never called mnemo itself."), "over MCP");

    // considered and held back, grouped by the reason
    const groups = {};
    for (const c of m.considered) (groups[c.reason] = groups[c.reason] || []).push(c);
    out += sec("considered and held back", m.considered.length, m.considered.length ? Object.entries(groups).sort((a, b) => b[1].length - a[1].length).map(([reason, list]) =>
      `<div class="held"><div class="held-why"><b class="num">${list.length}×</b> ${esc(O.reason(reason))}</div>` +
      newest(list, 3).map((c) => `<div class="held-row"><span class="num">${O.clock(c.at)}</span><span class="held-c">${c.candidates.slice(0, 3).map((k) => `<span class="mono">${esc(k.slug)}</span> <i class="num">${k.judge != null ? k.judge.toFixed(2) : "–"}</i>`).join("<br>")}</span></div>`).join("") + `</div>`).join("") : none("mnemo held nothing back here."), "why mnemo stayed silent");

    out += sec("claude code's own memory", m.claude.length, m.claude.length ? `<div class="rows tight">` + newest(m.claude, 24).map((c) =>
      `<div class="row plain"><span class="num">${O.clock(c.at)}</span><span class="tag${c.op === "read" ? "" : " hot"}">${esc(c.op)}</span><span class="mono path" title="${esc(c.path)}">${esc(short(c.path))}</span><span class="row-s">${esc(c.file === "claude-md" ? "CLAUDE.md" : "memory")}</span></div>`).join("") + `</div>` + more(m.claude, 24) : none("It did not touch MEMORY.md, a memory file or a CLAUDE.md after the start."));

    if (m.skills.length) out += sec("skills", m.skills.length, `<div class="chips">` + m.skills.map((k) => `<span class="chip mono">${esc(k.name)}</span>`).join("") + `</div>`);
    if (m.frictions.length)
      out += sec("corrections mnemo wrote down", m.frictions.length, m.frictions.map((f) => `<div class="friction"><q>${esc(f.quote)}</q><span>→ ${esc(f.rule)}</span></div>`).join(""), "candidate rules");
    return out;
  }

  /* ---------- reading 3: sight ---------- */
  function sightHTML(s) {
    const w = s.web, f = s.files;
    const nothing = !w.shots.length && !w.pages.length && !w.searches.length && !w.fetches.length && !w.artifacts.length;
    let out = `<div class="hero"><div class="hero-n num">${w.shots.length + w.pages.length}</div><div class="hero-t"><b>pages it looked at</b><span><span class="num">${w.searches.length}</span> searches · <span class="num">${w.fetches.length}</span> fetched</span><span><span class="num">${w.artifacts.length}</span> artifacts published</span></div>` +
      `<div class="hero-n num alt">${f.edited.length}</div><div class="hero-t"><b>files it changed</b><span><span class="num">${f.read.length}</span> read</span><span><span class="num">${s.prs.length}</span> pull ${s.prs.length === 1 ? "request" : "requests"}</span></div></div>`;

    if (w.shots.length)
      out += sec("what it saw", w.shots.length, `<div class="shots">` + w.shots.map((x) =>
        `<figure data-shot="${esc(x.src)}"><img src="../${esc(x.src)}" alt="" loading="lazy"><figcaption><b>${esc(x.title || "")}</b><span class="mono">${esc(x.url || "")}</span><span class="num">${O.clock(x.at)}</span></figcaption></figure>`).join("") + `</div>`, "the screenshots it took itself");
    if (w.pages.length)
      out += sec("pages", w.pages.length, `<div class="rows tight">` + newest(w.pages, 12).map((p) => `<div class="row plain"><span class="num">${O.clock(p.at)}</span><span>${esc(p.title || "")}</span><span class="mono path row-s">${esc(p.url)}</span></div>`).join("") + `</div>`);
    if (w.searches.length)
      out += sec("searches", w.searches.length, newest(w.searches, 10).map((q) =>
        `<div class="search"><div><span class="num">${O.clock(q.at)}</span> <b>${esc(q.query)}</b></div>` + q.results.slice(0, 4).map((r) => `<div class="src"><span>${esc(r.title || "")}</span><span class="mono">${esc(r.url || "")}</span></div>`).join("") + `</div>`).join(""), "and their sources");
    if (w.fetches.length)
      out += sec("fetched documents", w.fetches.length, newest(w.fetches, 10).map((x) =>
        `<div class="search"><div><span class="num">${O.clock(x.at)}</span> <span class="mono">${esc(x.url)}</span></div><div class="src"><span>${esc(x.summary || "")}</span><span class="num">${x.code || ""} · ${O.bytes(x.bytes)} · ${O.ms(x.ms)}</span></div></div>`).join(""));
    if (w.artifacts.length)
      out += sec("artifacts", w.artifacts.length, `<div class="rows tight">` + w.artifacts.map((a) => `<div class="row plain"><span class="num">${O.clock(a.at)}</span><span>${esc(a.title || "")}</span><span class="mono path row-s">${esc(a.url || "")}</span></div>`).join("") + `</div>`);
    if (nothing) out += sec("on the web", null, none("This session opened no page, searched nothing and published no artifact."));

    out += sec("pull requests", s.prs.length, s.prs.length ? `<div class="rows tight">` + s.prs.map((p) => {
      const merged = O.eff(s).merged && p.state === "open";
      return `<div class="row plain"><span class="mono">#${p.number}</span><span>${esc(p.title || "")}</span><span class="row-s">${esc(merged ? "merged here" : (p.draft ? "draft · " : "") + (p.state || ""))}${p.ci ? " · checks " + esc(p.ci) : ""}</span></div>`;
    }).join("") + `</div>` : none("It opened no pull request."));

    const maxE = Math.max(1, ...f.edited.map((x) => x.edits));
    out += sec("files changed", f.edited.length, f.edited.length ? `<div class="rows">` + f.edited.slice().sort((a, b) => b.edits - a.edits).slice(0, 14).map((x) =>
      `<div class="row"><span class="row-name mono path" title="${esc(x.path)}">${esc(short(x.path))}</span>${bar(x.edits, maxE)}<span class="num row-v">${x.edits}</span><span class="row-s">${O.age(x.lastAt)}</span></div>`).join("") + `</div>` + more(f.edited, 14) : none("It changed no file."), "edits · last touched");
    if (f.read.length)
      out += sec("files read", f.read.length, `<div class="rows tight">` + f.read.slice().sort((a, b) => b.count - a.count).slice(0, 10).map((x) => `<div class="row plain"><span class="mono path" title="${esc(x.path)}">${esc(short(x.path))}</span><span class="num row-s">${x.count}×</span></div>`).join("") + `</div>` + more(f.read, 10));
    return out;
  }

  /* ---------- render ---------- */
  T.render = function () {
    const el = $("station"), v = O.view;
    const s = O.session(v.s);
    if (!s) { el.hidden = true; el.innerHTML = ""; return; }
    const st = O.state(s);
    const acct = O.data.accounts.find((a) => a.id === s.account);
    const parent = s.parent && O.data.byId[s.parent];
    const chips = [
      `<span class="chip pj">${esc(s.project || "–")}</span>`,
      s.worktree ? `<span class="chip mono">worktree ${esc(s.worktree.name)}</span>` : s.branch ? `<span class="chip mono">${esc(s.branch)}</span>` : "",
      `<span class="chip">${esc(O.model(s.model))}${s.effort ? " · " + esc(s.effort) : ""}</span>`,
      acct ? `<span class="chip">account ${esc(acct.label || acct.id)}</span>` : "",
      s.permissionMode ? `<span class="chip">${esc(s.permissionMode)}</span>` : "",
      `<span class="chip">started ${O.age(s.startedAt)} ago</span>`,
      s.turns ? `<span class="chip"><span class="num">${s.turns}</span> turns · ${O.ms(s.turnMs)}</span>` : "",
      `<span class="chip mono dim">${s.short}</span>`,
    ].join("");
    const scroll = el.querySelector("#reading") && el.dataset.for === s.short + v.r ? el.querySelector("#reading").scrollTop : 0;
    el.dataset.for = s.short + v.r;
    el.dataset.state = st;
    const names = { context: "Context and tokens", memory: "Memory", sight: "Sight" };
    el.innerHTML =
      `<aside class="st-left"><div class="st-map"><span class="label">where it stands</span></div><div class="st-family">${familyHTML(s)}</div></aside>` +
      `<div class="st-main"><header class="st-head">` +
      `<div class="st-state"><span class="st" data-state="${st}">${M.GLYPH[st]} ${M.WORD[st]}</span>${parent ? `<span class="st-of">a child of <button data-open="${parent.short}">${esc(title(parent))}</button></span>` : s.role === "child" ? `<span class="st-of">dispatched by a session outside this capture</span>` : ""}<span class="st-age">last moved ${O.age(s.lastAt)} ago</span></div>` +
      `<h1 class="st-title">${esc(title(s))}</h1><div class="chips">${chips}</div></header>` +
      `<div class="st-cols"><section class="term" aria-label="Terminal"><div class="term-bar"><span class="label">terminal</span><span class="term-note">drawn from the capture · the live terminal sits here</span></div>` +
      `<div class="term-strip">${stripHTML(s)}</div><div class="term-body mono" id="term-body">${termHTML(s)}</div>` +
      `<form class="term-in mono" data-reply="${s.short}"><span>❯</span><input type="text" name="t" autocomplete="off" spellcheck="false" placeholder="Reply to this session: it stays on this page"></form></section>` +
      `<section class="readings"><nav class="tabs">` + O.READINGS.map((r, i) => `<button data-reading="${r}" class="${v.r === r ? "on" : ""}"><kbd>${i + 1}</kbd>${names[r]}</button>`).join("") + `</nav>` +
      `<div class="reading" id="reading" data-r="${v.r}">${v.r === "memory" ? memoryHTML(s) : v.r === "sight" ? sightHTML(s) : contextHTML(s)}</div></section></div></div>`;
    el.hidden = false;
    const body = $("term-body");
    body.scrollTop = body.scrollHeight;
    $("reading").scrollTop = scroll;
    if (v.r === "context") drawCurve(s);
  };

  /** Sessions in the order ← → walks them: round the ring, a project at a time. */
  T.ring = function () {
    return O.m.bodies.slice().sort((a, b) => a.theta - b.theta);
  };
})();

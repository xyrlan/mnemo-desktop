/* Orbit · the centre opened (what memory holds and what mnemo did lately), and the finder. */
(function () {
  "use strict";
  const O = window.O;
  const M = window.mnemo;
  const esc = O.esc;
  const $ = (id) => document.getElementById(id);

  const V = (O.vault = {});

  V.render = function () {
    const el = $("vault");
    if (!O.view.vault) { el.hidden = true; el.innerHTML = ""; return; }
    const v = O.data.vault, rf = v.reflex || { prompts: 0, outcomes: {} };
    const spoke = rf.outcomes.emitted || 0;
    const silent = Object.entries(rf.outcomes).filter(([k]) => k !== "emitted").sort((a, b) => b[1] - a[1]);
    const silentN = silent.reduce((n, x) => n + x[1], 0);
    const max = Math.max(1, spoke, ...silent.map((x) => x[1]));
    const bar = (n, cls) => `<span class="bar ${cls || ""}"><i style="transform:scaleX(${(n / max).toFixed(4)})"></i></span>`;

    const xp = Object.entries(v.projectXp || {}).sort((a, b) => b[1] - a[1]);
    const xmax = Math.max(1, ...xp.map((x) => x[1]));

    // what mnemo handed out lately, across every session of the capture
    const events = O.memoryEvents().filter((e) => e.kind === "injected").reverse();
    const used = {};
    for (const e of events) (used[e.slug] = used[e.slug] || { n: 0, last: e }).n++;
    const top = Object.entries(used).sort((a, b) => b[1].n - a[1].n || b[1].last.at.localeCompare(a[1].last.at)).slice(0, 8);
    const frictions = O.data.sessions.reduce((n, s) => n + s.memory.frictions.length, 0);

    el.innerHTML =
      `<div class="v-col v-left">` +
      `<h2 class="v-title">what memory holds</h2>` +
      `<div class="hero"><div class="hero-n num mem">${O.int(v.rules)}</div><div class="hero-t"><b>rules in the vault</b><span><span class="num">${O.int(v.xp)}</span> xp earned by using them</span><span><span class="num">${xp.length}</span> projects have learned something</span></div></div>` +
      `<section class="sec"><h3 class="label">where it has been used<span class="sec-note">xp by project</span></h3><div class="rows">` +
      (xp.length ? xp.slice(0, 9).map(([name, n]) => `<div class="row"><span class="row-name">${esc(name)}</span><span class="bar"><i style="transform:scaleX(${(n / xmax).toFixed(4)})"></i></span><span class="num row-v">${O.int(n)}</span></div>`).join("") : `<p class="none">No project has earned xp yet.</p>`) + `</div></section>` +
      `<section class="sec"><h3 class="label">learned lately <b class="num">${v.learned.length}</b><span class="sec-note">new rules, newest first</span></h3>` +
      (v.learned.length ? `<div class="rows tight">` + v.learned.slice(0, 12).map((l) => `<div class="row plain"><span class="num">${O.age(l.at)}</span><span><b>${esc(l.name || l.slug)}</b><small class="mono">${esc(l.slug)}</small></span><span class="row-s">${esc((l.projects || []).join(", "))}</span></div>`).join("") + `</div>` : `<p class="none">Nothing learned inside this capture.</p>`) + `</section>` +
      `</div>` +
      `<div class="v-mid"><button class="v-close" data-go="scene"><kbd>Esc</kbd> back to the scene</button></div>` +
      `<div class="v-col v-right">` +
      `<h2 class="v-title">what mnemo did</h2>` +
      `<div class="hero"><div class="hero-n num mem">${O.int(spoke)}</div><div class="hero-t"><b>times it spoke</b><span>of <span class="num">${O.int(rf.prompts)}</span> prompts it looked at</span><span>${rf.prompts ? ((spoke / rf.prompts) * 100).toFixed(0) : 0}% of the time</span></div>` +
      `<div class="hero-n num alt">${O.int(silentN)}</div><div class="hero-t"><b>times it stayed silent</b><span>a rule that does not fit is noise</span><span><span class="num">${frictions}</span> corrections written down as candidates</span></div></div>` +
      `<section class="sec"><h3 class="label">what it did with each prompt<span class="sec-note">one outcome per prompt</span></h3><div class="rows">` +
      `<div class="row"><span class="row-name">${esc(O.reason("emitted"))}</span>${bar(spoke, "mem")}<span class="num row-v">${O.int(spoke)}</span></div>` +
      silent.map(([k, n]) => `<div class="row"><span class="row-name">${esc(O.reason(k))}</span>${bar(n)}<span class="num row-v">${O.int(n)}</span></div>`).join("") + `</div></section>` +
      `<section class="sec"><h3 class="label">rules it reached for most <b class="num">${events.length}</b><span class="sec-note">in the sessions of this capture</span></h3>` +
      (top.length ? `<div class="rows tight">` + top.map(([slug, u]) => `<div class="row plain link" data-open="${u.last.s.short}"><span class="num">${u.n}×</span><span class="mono slug">${esc(slug)}</span><span class="row-s">last to ${esc((u.last.s.title || u.last.s.short).slice(0, 34))} · ${O.age(u.last.at)}</span></div>`).join("") + `</div>` : `<p class="none">No rule was injected in this capture.</p>`) + `</section>` +
      `</div>`;
    el.hidden = false;
  };

  /* ---------- the finder: type part of a name ---------- */
  const F = (O.finder = { index: 0, hits: [] });

  F.match = function (q) {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const rank = (s) => M.STATE_ORDER.indexOf(O.state(s));
    return O.data.sessions
      .map((s) => {
        const hay = [s.title, s.name, s.project, s.short, s.branch].filter(Boolean).join(" ").toLowerCase();
        if (!words.every((w) => hay.includes(w))) return null;
        const t = String(s.title || s.name || "").toLowerCase();
        return { s, score: (t.startsWith(words[0] || "") ? 0 : t.includes(words[0] || "") ? 1 : 2) * 10 + rank(s) };
      })
      .filter(Boolean)
      .sort((a, b) => a.score - b.score || (b.s.lastAt || "").localeCompare(a.s.lastAt || ""))
      .map((x) => x.s);
  };

  F.render = function () {
    const el = $("finder"), q = O.view.q;
    const app = $("app");
    if (q == null) {
      el.hidden = true; el.innerHTML = ""; app.removeAttribute("data-find");
      for (const b of document.querySelectorAll(".is-match")) b.classList.remove("is-match");
      return;
    }
    F.hits = F.match(q);
    F.index = O.clamp(F.index, 0, Math.max(0, F.hits.length - 1));
    const input = el.querySelector("input");
    const list = F.hits.slice(0, 9).map((s, i) => {
      const st = O.state(s), root = O.bodyOf(s).s;
      return `<li class="${i === F.index ? "on" : ""}" data-open="${s.short}">${O.mark(st)}<span class="f-title">${esc(s.title || s.name || s.short)}</span>` +
        `<span class="f-meta">${esc(s.project || "")}${root !== s ? " · child of " + esc((root.title || root.short).slice(0, 30)) : ""} · ${M.WORD[st]}</span></li>`;
    }).join("");
    const body = `<ul>${list || `<li class="f-none">No session has that in its name.</li>`}</ul>` +
      (F.hits.length > 9 ? `<div class="f-more">+ ${F.hits.length - 9} more: keep typing</div>` : "");
    if (!input) {
      el.innerHTML = `<div class="f-box"><span class="label">find a session</span><input type="text" autocomplete="off" spellcheck="false" aria-label="Find a session"><div class="f-list">${body}</div></div>`;
      el.hidden = false;
      const inp = el.querySelector("input");
      inp.value = q;
      inp.focus();
      inp.setSelectionRange(q.length, q.length);
    } else {
      if (input.value !== q) input.value = q;
      el.querySelector(".f-list").innerHTML = body;
    }
    // in the scene the bodies that match stay lit
    app.setAttribute("data-find", "");
    const lit = new Set(F.hits.map((s) => O.bodyOf(s).s.short));
    for (const b of document.querySelectorAll("#bodies .body, #labels .lab")) b.classList.toggle("is-match", lit.has(b.dataset.id));
  };
})();

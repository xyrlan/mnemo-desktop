/* What the score derives from the capture: each session's span on the time axis, its marks,
   and what it looked like at any earlier moment. No DOM in this file.

   The capture is a snapshot, so three readings here are estimates, and the page says so
   wherever it shows one (NOTES.md lists them):
   - spent by a moment: the session's total, shared out along its context curve (a call costs
     about the context it carries);
   - state at a moment: working where tool calls are, idle where they are not;
   - a prompt: a moment mnemo looked at one (`memory.injected` and `memory.considered`). */
(function () {
  "use strict";

  const MIN = 60e3;
  const HOUR = 3600e3;
  const DAY = 24 * HOUR;
  const BUCKET = 5 * MIN; // `timeline` is tool calls per 5 minutes

  const ms = (iso) => {
    const t = iso ? Date.parse(iso) : NaN;
    return Number.isFinite(t) ? t : null;
  };
  const byT = (a, b) => a.t - b.t;
  const sum = (row) => (row ? (row.input || 0) + (row.output || 0) + (row.cacheRead || 0) + (row.cacheCreation || 0) : 0);

  /* A tool call sits on one of four lanes under the line, by what it does to the world:
     0 changes files, 1 runs something, 2 looks, 3 reaches out (web, sub-agents, the maintainer).
     A mnemo call (kind `memory`) goes to the diamond lane above the line instead. */
  const LANE = {
    edit: 0, write: 0,
    shell: 1, mcp: 1,
    read: 2, "search-code": 2, meta: 2, other: 2,
    "web-search": 3, "web-fetch": 3, browser: 3, artifact: 3, agent: 3, message: 3, skill: 3, ask: 3,
  };
  const LANE_NAMES = ["changes files", "runs", "looks", "reaches out"];
  const laneOf = (kind) => (kind === "memory" ? -1 : LANE[kind] ?? 2);

  /** Index of the last item whose time is at or before `t`, or -1. `get` reads an item's time. */
  function lastAtOrBefore(list, t, get) {
    let lo = 0, hi = list.length - 1, found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (get(list[mid]) <= t) { found = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return found;
  }

  function prep(data) {
    const now = data.now;
    const pendingOf = {};
    for (const p of data.pending || []) (pendingOf[p.session] = pendingOf[p.session] || []).push(p);

    for (const s of data.sessions) {
      const c = s.context || {};
      const series = (c.series || [])
        .map((p) => [ms(p[0]), p[1]])
        .filter((p) => p[0] != null && p[1] != null)
        .sort((a, b) => a[0] - b[0]);
      const acts = (s.activity || [])
        .map((a) => Object.assign({}, a, { t: ms(a.at), lane: laneOf(a.kind) }))
        .filter((a) => a.t != null)
        .sort(byT);
      const buckets = (s.timeline || [])
        .map((b) => {
          const lanes = [0, 0, 0, 0];
          let mem = 0, total = 0;
          for (const kind in b.kinds || {}) {
            const n = b.kinds[kind] || 0;
            const lane = laneOf(kind);
            if (lane < 0) mem += n; else lanes[lane] += n;
            total += n;
          }
          return { t: ms(b.t), lanes, mem, total, kinds: b.kinds || {} };
        })
        .filter((b) => b.t != null)
        .sort(byT);
      const busy = new Set(buckets.filter((b) => b.total > 0).map((b) => Math.floor(b.t / BUCKET)));

      // A resumed session's transcript starts long before the process did: the line starts
      // at the earliest thing known about it.
      const starts = [ms(s.startedAt), series.length ? series[0][0] : null, acts.length ? acts[0].t : null, buckets.length ? buckets[0].t : null].filter((v) => v != null);
      const ends = [ms(s.lastAt), series.length ? series[series.length - 1][0] : null, acts.length ? acts[acts.length - 1].t : null].filter((v) => v != null);
      const t0 = starts.length ? Math.min(...starts) : null;
      const t1 = ends.length ? Math.min(now, Math.max(...ends)) : t0;

      const within = (t) => t0 != null && t >= t0 - MIN && t <= (s.live ? now : t1 + MIN);
      const m = s.memory || {};
      const timed = (list) => (list || []).map((x) => Object.assign({}, x, { t: ms(x.at) })).filter((x) => x.t != null).sort(byT);
      const injected = timed(m.injected);
      const considered = timed(m.considered);
      const asked = timed(m.read);
      const claude = timed(m.claude);
      const skills = timed(m.skills);
      const marks = [].concat(
        injected.map((x) => ({ t: x.t, type: "injected", ref: x })),
        asked.map((x) => ({ t: x.t, type: "asked", ref: x })),
        considered.map((x) => ({ t: x.t, type: "held", ref: x })),
        claude.map((x) => ({ t: x.t, type: "claude", ref: x })),
      ).filter((x) => within(x.t)).sort(byT);

      const prompts = [];
      for (const t of injected.concat(considered).map((x) => x.t).filter(within).sort((a, b) => a - b)) {
        if (!prompts.length || t - prompts[prompts.length - 1] > 2000) prompts.push(t);
      }

      const web = s.web || {};
      const sights = [].concat(
        timed(web.shots).map((x) => ({ t: x.t, type: "shot", ref: x })),
        timed(web.artifacts).map((x) => ({ t: x.t, type: "artifact", ref: x })),
        timed(web.searches).map((x) => ({ t: x.t, type: "search", ref: x })),
        timed(web.fetches).map((x) => ({ t: x.t, type: "fetch", ref: x })),
      ).filter((x) => within(x.t)).sort(byT);

      const own = sum(s.totals && s.totals.own) || sum(s.tokens && s.tokens.main);
      const tree = Math.max(own, sum(s.totals && s.totals.tree));
      const cum = new Float64Array(series.length);
      let weight = 0;
      for (let i = 0; i < series.length; i++) { weight += Math.max(0, series[i][1]); cum[i] = weight; }

      const pend = (pendingOf[s.id] || [])[0] || null;
      s._ = {
        t0, t1, series, acts, buckets, busy, marks, prompts, sights,
        injected, considered, asked, claude, skills,
        compactions: timed(c.compactions),
        own, tree, cum, weight,
        pend, pendAt: pend ? ms(pend.at) ?? t1 : null,
        kids: [], desc: [], depth: 0,
        window: c.window || 200000,
      };
    }

    for (const s of data.sessions) {
      const parent = s.parent && data.byId[s.parent];
      if (parent) parent._.kids.push(s);
    }
    const walk = (s, depth, seen) => {
      if (seen.has(s.id)) return [];
      seen.add(s.id);
      s._.depth = depth;
      s._.desc = [];
      for (const k of s._.kids) s._.desc.push(k, ...walk(k, depth + 1, seen));
      return s._.desc;
    };
    const seen = new Set();
    for (const s of data.sessions) if (!s.parent || !data.byId[s.parent]) walk(s, 0, seen);
    return data;
  }

  /* ---- a session at a moment ---- */

  /** Context tokens at `t`: the last call's size, held until the next one. */
  function ctxAt(s, t, now) {
    const d = s._;
    if (t >= now) return s.context ? s.context.tokens : null;
    if (d.t0 == null || t < d.t0) return null;
    const i = lastAtOrBefore(d.series, t, (p) => p[0]);
    return i < 0 ? null : d.series[i][1];
  }

  /** The share of the session's spending that had happened by `t`, 0..1. */
  function spentShare(s, t, now) {
    const d = s._;
    if (t >= now || d.t0 == null) return 1;
    if (t <= d.t0) return 0;
    if (!d.weight) return d.t1 > d.t0 ? Math.min(1, (t - d.t0) / (d.t1 - d.t0)) : 1;
    const i = lastAtOrBefore(d.series, t, (p) => p[0]);
    return i < 0 ? 0 : d.cum[i] / d.weight;
  }
  const ownAt = (s, t, now) => s._.own * spentShare(s, t, now);
  const treeAt = (s, t, now) => (t >= now ? s._.tree : ownAt(s, t, now) + s._.desc.reduce((n, k) => n + ownAt(k, t, now), 0));

  function busyAt(s, t) {
    const d = s._;
    if (d.busy.has(Math.floor(t / BUCKET))) return true;
    const i = lastAtOrBefore(d.acts, t, (a) => a.t);
    if (i >= 0 && t - d.acts[i].t < 2 * MIN) return true;
    return i + 1 < d.acts.length && d.acts[i + 1].t - t < MIN;
  }

  /** The state at `t`. `state` is the one to report at the capture time (the page's own,
      once the maintainer answered something). `null` is "not started yet". */
  function stateAt(s, t, now, state) {
    const d = s._;
    if (t >= now) return state;
    if (d.t0 == null || t < d.t0) return null;
    if (d.pendAt != null && t >= d.pendAt) return s.state;
    if (t > d.t1) return s.live ? "idle" : d.pendAt != null ? "idle" : s.state;
    return busyAt(s, t) ? "working" : "idle";
  }

  /** What it was doing at `t`: the tool call under way or just finished. */
  function doingAt(s, t) {
    const d = s._;
    const i = lastAtOrBefore(d.acts, t, (a) => a.t);
    if (i >= 0 && t - d.acts[i].t < 10 * MIN) return { act: d.acts[i] };
    const b = d.buckets[lastAtOrBefore(d.buckets, t, (x) => x.t)];
    if (b && t - b.t < BUCKET && b.total) return { bucket: b };
    return null;
  }

  /* ---- the order of the lines ---- */

  /** Rows top to bottom: a project header, then its sessions by attention, each followed by
      its children. `stateOf(s)` is the state now; `flipped` holds the parents whose fold is
      the opposite of the default. */
  function rows(data, stateOf, flipped) {
    const ORDER = window.mnemo.STATE_ORDER;
    const rank = (s) => { const i = ORDER.indexOf(stateOf(s)); return i < 0 ? ORDER.length : i; };
    const attention = (s) => Math.min(rank(s), ...s._.desc.map(rank));
    const last = (s) => Math.max(s._.t1 || 0, ...s._.desc.map((k) => k._.t1 || 0));
    const urgent = (a, b) => attention(a) - attention(b) || last(b) - last(a);

    const roots = data.sessions.filter((s) => !s.parent || !data.byId[s.parent]);
    const projects = new Map();
    for (const s of roots) {
      const name = s.project || "no project";
      if (!projects.has(name)) projects.set(name, []);
      projects.get(name).push(s);
    }
    const groups = [...projects.entries()].map(([project, list]) => ({ project, list: list.sort(urgent) }));
    groups.sort((a, b) => urgent(a.list[0], b.list[0]));

    // An ended child with nothing waiting under it can fold into its parent's ensemble lane.
    const foldable = (k) => stateOf(k) === "ended" && k._.desc.every((x) => stateOf(x) === "ended");
    const folded = (p) => (p._.kids.filter(foldable).length >= 3) !== flipped.has(p.short);

    const out = [];
    const add = (s, depth) => {
      out.push({ type: "session", s, depth });
      const kids = s._.kids.slice().sort(urgent);
      const fold = folded(s);
      const packed = fold ? kids.filter(foldable) : [];
      for (const k of kids) if (!packed.includes(k)) add(k, depth + 1);
      if (packed.length) {
        const all = [];
        for (const k of packed) all.push(k, ...k._.desc);
        out.push({ type: "ensemble", parent: s, sessions: all, depth: depth + 1 });
      }
    };
    for (const g of groups) {
      const all = [];
      for (const s of g.list) all.push(s, ...s._.desc);
      out.push({ type: "group", project: g.project, sessions: all });
      for (const s of g.list) add(s, 0);
    }
    return out;
  }

  const canFold = (s, stateOf) => s._.kids.some((k) => stateOf(k) === "ended" && k._.desc.every((x) => stateOf(x) === "ended"));

  /* ---- the fleet over the same axis ---- */

  const STEPS = [MIN, 2 * MIN, 5 * MIN, 10 * MIN, 15 * MIN, 30 * MIN, HOUR, 2 * HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, DAY, 2 * DAY, 7 * DAY];
  /** The smallest round interval that is at least `minPx` wide. */
  function step(span, width, minPx) {
    const want = (span / Math.max(1, width)) * minPx;
    return STEPS.find((s) => s >= want) || STEPS[STEPS.length - 1];
  }

  /** Tokens per interval between `from` and `to`: every session, each account, and the
      sessions in `pick` (the selected line and its tree). */
  function fleet(data, from, to, stepMs, pick) {
    const first = Math.floor(from / stepMs);
    const n = Math.max(1, Math.ceil(to / stepMs) - first);
    const total = new Float64Array(n);
    const picked = new Float64Array(n);
    const accounts = {};
    for (const a of data.accounts || []) accounts[a.id] = new Float64Array(n);
    for (const s of data.sessions) {
      const d = s._;
      if (!d.own || d.t0 == null || d.t1 < from || d.t0 > to) continue;
      const acct = accounts[s.account];
      const isPicked = pick && pick.has(s.id);
      const put = (t, tokens) => {
        const i = Math.floor(t / stepMs) - first;
        if (i < 0 || i >= n) return;
        total[i] += tokens;
        if (acct) acct[i] += tokens;
        if (isPicked) picked[i] += tokens;
      };
      if (d.weight) for (const p of d.series) put(p[0], (d.own * Math.max(0, p[1])) / d.weight);
      else put(d.t1, d.own);
    }
    return { first, n, step: stepMs, total, picked, accounts };
  }

  /** The sessions that spent the most inside one interval, for the strip's tooltip. */
  function spenders(data, from, to) {
    const list = [];
    for (const s of data.sessions) {
      const d = s._;
      if (!d.own || !d.weight || d.t1 < from || d.t0 > to) continue;
      let tokens = 0;
      for (const p of d.series) if (p[0] >= from && p[0] < to) tokens += (d.own * Math.max(0, p[1])) / d.weight;
      if (tokens > 0) list.push({ s, tokens });
    }
    return list.sort((a, b) => b.tokens - a.tokens);
  }

  /** A plan window on the axis. Only its reset is recorded, so its start is the reset minus
      the window's length (5 hours, or 7 days). */
  function planWindow(limit) {
    const reset = ms(limit.resetsAt);
    if (reset == null) return null;
    const length = limit.kind === "session" ? 5 * HOUR : 7 * DAY;
    return { from: reset - length, to: reset, length };
  }
  const LIMIT_NAME = { session: "5h", weekly_all: "week", weekly_scoped: "week", credits: "credits" };
  const limitName = (l) => (l.kind === "weekly_scoped" && l.model ? "week · " + l.model : LIMIT_NAME[l.kind] || l.kind);

  /* ---- words ---- */

  const two = (n) => String(n).padStart(2, "0");
  const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const fmt = {
    clock(t) { const d = new Date(t); return two(d.getHours()) + ":" + two(d.getMinutes()); },
    clockS(t) { const d = new Date(t); return two(d.getHours()) + ":" + two(d.getMinutes()) + ":" + two(d.getSeconds()); },
    day(t) { const d = new Date(t); return WEEKDAY[d.getDay()] + " " + d.getDate() + " " + MONTH[d.getMonth()]; },
    /** "18:55" today, "Sun 21:40" on another day. */
    when(t, now) {
      const same = new Date(t).toDateString() === new Date(now).toDateString();
      return same ? fmt.clock(t) : WEEKDAY[new Date(t).getDay()] + " " + fmt.clock(t);
    },
    /** A length of time: "40s", "14m", "2h 20m", "3d 4h". */
    span(msLen) {
      const s = Math.max(0, Math.round(msLen / 1000));
      if (s < 90) return s + "s";
      const m = Math.round(s / 60);
      if (m < 90) return m + "m";
      const h = Math.floor(m / 60);
      if (h < 48) return h + "h" + (m % 60 && h < 10 ? " " + (m % 60) + "m" : "");
      const d = Math.floor(h / 24);
      return d + "d" + (h % 24 && d < 10 ? " " + (h % 24) + "h" : "");
    },
    pct(n) { return n == null ? "–" : Math.round(n) + "%"; },
    bytes(n) { return n == null ? "" : n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(1) + " kB" : (n / 1048576).toFixed(1) + " MB"; },
    took(n) { return n == null ? "" : n < 1000 ? Math.round(n) + "ms" : n < 60000 ? (n / 1000).toFixed(1) + "s" : fmt.span(n); },
    model(id) { return (id || "").replace(/^claude-/, "").replace(/-(\d+)-(\d+)$/, " $1.$2"); },
    /** The last two parts of a path: enough to tell files apart in a narrow column. */
    tail(path, parts) {
      const bits = String(path || "").split(/[\\/]/).filter(Boolean);
      return bits.length <= (parts || 2) ? String(path || "") : "…/" + bits.slice(-(parts || 2)).join("/");
    },
  };

  window.score = {
    MIN, HOUR, DAY, BUCKET, LANE_NAMES,
    ms, sum, lastAtOrBefore, prep,
    ctxAt, spentShare, ownAt, treeAt, stateAt, doingAt, busyAt,
    rows, canFold, step, fleet, spenders, planWindow, limitName, fmt,
  };
})();

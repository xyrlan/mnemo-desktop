/* Loads the capture a concept draws: the real one when `capture.py` has written it, the
   synthetic one otherwise. Include with a plain <script src="../base/load.js"></script>,
   then wait for it:

       MNEMO_READY.then((data) => { … })     // data is `window.MNEMO`, shaped as DATA.md says

   `?data=sample` forces the synthetic capture (every screenshot that leaves this machine is
   taken that way). The same file also exposes the helpers below, so three concepts format a
   token count or an age the same way. */
(function () {
  const here = document.currentScript.src.replace(/base\/load\.js.*$/, "");
  const forced = new URLSearchParams(location.search).get("data");

  function script(src) {
    return new Promise((resolve, reject) => {
      const el = document.createElement("script");
      el.src = here + src;
      el.onload = resolve;
      el.onerror = reject;
      document.head.appendChild(el);
    });
  }

  const order = forced === "sample" ? ["data.sample.js"] : ["data.js", "data.sample.js"];
  window.MNEMO_READY = order
    .reduce((p, src) => p.catch(() => script(src).then(() => window.MNEMO || Promise.reject())), Promise.reject())
    .then(() => {
      const data = window.MNEMO;
      data.byId = Object.fromEntries(data.sessions.map((s) => [s.id, s]));
      data.now = Date.parse(data.capturedAt);
      document.documentElement.dataset.capture = data.synthetic ? "sample" : "real";
      return data;
    });

  const STATE_ORDER = ["need", "stalled", "ready", "working", "idle", "ended"];
  const GLYPH = { need: "◆", working: "●", ready: "▲", stalled: "✕", idle: "○", ended: "·" };
  const WORD = { need: "needs you", working: "working", ready: "ready to merge", stalled: "stalled", idle: "your turn", ended: "ended" };

  window.mnemo = {
    STATE_ORDER, GLYPH, WORD,

    /** 1234 → "1.2k", 3400000 → "3.4M". */
    tokens(n) {
      if (n == null) return "–";
      if (n < 1000) return String(n);
      if (n < 1e6) return (n / 1e3).toFixed(n < 1e4 ? 1 : 0) + "k";
      if (n < 1e9) return (n / 1e6).toFixed(n < 1e7 ? 1 : 0) + "M";
      return (n / 1e9).toFixed(1) + "B";
    },

    /** Everything a token row counted: input + output + both caches. */
    sum(t) {
      return t ? t.input + t.output + t.cacheRead + t.cacheCreation : 0;
    },

    /** "4m", "2h", "3d" between an ISO time and the capture. */
    age(isoTime, now) {
      if (!isoTime) return "";
      const s = Math.max(0, ((now ?? Date.parse(window.MNEMO.capturedAt)) - Date.parse(isoTime)) / 1000);
      if (s < 90) return Math.round(s) + "s";
      if (s < 5400) return Math.round(s / 60) + "m";
      if (s < 129600) return Math.round(s / 3600) + "h";
      return Math.round(s / 86400) + "d";
    },

    /** The sessions that have no parent in this capture, most urgent first. */
    roots(data) {
      return data.sessions
        .filter((s) => !s.parent || !data.byId[s.parent])
        .sort((a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state) || (b.lastAt || "").localeCompare(a.lastAt || ""));
    },

    /** The motion switch: persisted, and reflected on <html data-motion>. */
    motion(set) {
      if (set) localStorage.setItem("mnemo-motion", set);
      const value = localStorage.getItem("mnemo-motion") || "full";
      document.documentElement.dataset.motion = value;
      return value;
    },
  };
  window.mnemo.motion();
})();

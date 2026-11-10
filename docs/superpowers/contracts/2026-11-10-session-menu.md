---
feature: session-menu
created: 2026-11-10
verdict: parallel
---

<!--
  A right-click (and keyed) menu on every session of the new front, asked for by the
  maintainer on his first day with it: docs/superpowers/specs/2026-11-10-session-menu.md.

  One piece. The menu itself is one new folder, but opening it is a handler in each place a
  session is drawn (roster, orbit, score, stage, frame keys), so the work reaches into those
  folders; two children there would be two children in the same files.

  The pull request targets main.
-->

## menu

- **files:** src/menu/, src/roster/, src/orbit/, src/score/, src/stage/, src/frame/, src/command/, tools/preview/scenarios/next-menu.mjs, docs/superpowers/shots/menu/, README.md
- **exposes:** `a menu on every session and on every project name of the new front, by right-click and by key, holding what docs/superpowers/specs/2026-11-10-session-menu.md lists and keeping its rules (read docs/superpowers/specs/2026-11-10-recreation-design.md and "What every piece holds to" in docs/superpowers/specs/2026-11-10-recreation-front.md first; screenshots go under docs/superpowers/shots/menu/, not under src/); the pull request targets main`
- **consumes:** nothing
- **model:** fable
- **effort:** high
- **may:** pr

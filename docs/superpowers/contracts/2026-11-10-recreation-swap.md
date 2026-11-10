---
feature: recreation-swap
created: 2026-11-10
verdict: parallel
---

<!--
  The swap (docs/superpowers/specs/2026-11-10-recreation-swap.md). One piece on purpose: what
  it closes is the seams between the pieces of the earlier waves (the frame with the panels,
  the stage with the runtime, the roster with Score), so it reaches into most of their
  folders, and two children there would be two children in the same files.

  It runs beside the overlays piece (contracts/2026-11-10-recreation-overlays.md), which
  owns James's panel and orb, the notification stack and the dictation indicator, and
  delivers `JamesPresence` for the top bar.

  Pull requests target redesign/app, not main.
-->

## swap

- **files:** src/frame/, src/command/, src/stage/, src/roster/, src/score/, src/orbit/, src/panels/, src/tasks/model.ts, src/nexus/menus/, src/nexus/view.tsx, tools/preview/, tools/perf/, docs/superpowers/shots/, README.md, src-tauri/tauri.conf.json
- **exposes:** `the new front as the app a build shows, with the ship one switch away, everything "What this wave closes" lists closed and everything "What this wave checks, and reports" checked and reported, as docs/superpowers/specs/2026-11-10-recreation-swap.md says (read docs/superpowers/specs/2026-11-10-recreation-design.md and "What every piece holds to" in 2026-11-10-recreation-front.md first); JamesPresence(): JSX.Element comes from the overlays piece, exported from src/jarvis/panel/, and may not be on the branch yet: write against the signature; the pull request targets the branch redesign/app`
- **consumes:** nothing
- **model:** fable
- **effort:** high
- **may:** pr

---
feature: round9
created: 2026-09-15
verdict: parallel
---

Ninth round: the follow-ups seen on screen right after round 8 landed. Two small
pieces, no new surfaces. Wiring rules from `docs/contracts/panes.md` hold;
`src/graph/`, `src/pulse/`, `src/github/` are read-only. Run `tauri dev` in the
background with a private target (`CARGO_TARGET_DIR=$HOME/.cache/mnemo-desktop-<piece>
pnpm tauri dev --port 17xx`), kill any leftover `vite` first, and look at the real app.

## cockpit

- **files:** src/cockpit/, src/mission/rows.tsx, src/mission/mission.css
- **exposes:** nothing
- **consumes:** nothing

Issue #67 (all three points). Needs-you and ready-to-merge rows come only from
PRs whose `state` is `OPEN`; the mission map gets the width its layout needs
(inbox narrows to titles while the map is open, or the map pans with a
fit-to-content on open that never shrinks nodes); the header names the focused
repo and branch when scope is `este repo`. Add a fixture with a merged PR that
has a red rollup and assert it produces no row.

## vault

- **files:** src/vault/, src-tauri/src/vault.rs, src-tauri/fixtures/vault/
- **exposes:** `vault_ego(path: String, limit: u32) -> VaultGraph`
- **consumes:** nothing

Issue #68. Only the `// -- vault` anchor blocks of `lib.rs` if anything there
changes (nothing should).

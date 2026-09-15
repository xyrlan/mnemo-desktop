---
feature: round13
created: 2026-09-15
verdict: parallel
---

Thirteenth round, one piece: a BLOCKED child waiting on a permission prompt
gets Approve / Deny instead of a reply box (user, on screen, 2026-09-15).
Wiring rules from `docs/contracts/panes.md` hold; `src/graph/`, `src/pulse/`,
`src/github/`, `src/vault/`, `src/layout/`, `src/terminal/` are read-only —
consume the layout store via `store.getState()` (`openCommandTab`, `goToPane`)
and the terminal buffer registry via `src/terminal/buffer.ts`. Run `tauri dev`
in the background with a private target (`CARGO_TARGET_DIR=$HOME/.cache/mnemo-desktop-approve
pnpm tauri dev --port 2001`), kill leftover `vite` first, and verify the keys
against a REAL background child parked on a permission prompt (start one
yourself with `claude --bg` on a harmless command) before shipping.

## approve

- **files:** src/cockpit/, src/mission/rows.tsx, src/mission/Sidebar.tsx, src/mission/Sidebar.test.tsx, src/mission/mission.css, src/mission/types.ts, src/mission/types.test.ts, src-tauri/src/mission.rs, src-tauri/fixtures/agents.json, src-tauri/fixtures/sessions.json
- **exposes:** `ChildSession { waiting_for: Option<String> }` in the `mission_snapshot` JSON, `needKind(c) -> 'permission' | 'question'` from `src/mission/types.ts`
- **consumes:** nothing

Issue #81. Only the `// -- mission` anchor blocks of `lib.rs` if anything
there changes (nothing should). Keep `childWord`, `delta`, `allChildren`
and the other exports of `src/mission/types.ts` unchanged.

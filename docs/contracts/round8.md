---
feature: round8
created: 2026-09-15
verdict: parallel
---

Eighth dispatch round, from seeing rounds 5–7 on screen: the cockpit becomes an
inbox with the React Flow map demoted to a per-mission view; the vault becomes a
health table with a small ego graph; images reach Claude Code from a pane; the
Home loses three kinds of noise. Decisions and their reasons are in
`docs/superpowers/specs/2026-09-15-round8-design.md`; each piece has an issue
with the acceptance list.

Wiring rules from `docs/contracts/panes.md` hold: a view registers itself from
`src/<view>/view.tsx`, palette actions register inside the view file, Rust
modules and commands go only in your own anchored block of `src-tauri/src/lib.rs`.
`src/graph/` (React Flow + `layoutDagre`) is shared: consume, never edit.
`src/pulse/` and `src/github/` landed in round 7 and are read-only for everyone
here; consume their stores through `app-store.ts`.

Build note: private target and Vite port when you run the app
(`CARGO_TARGET_DIR=$HOME/.cache/mnemo-desktop-<piece> pnpm tauri dev --port 16xx`),
and run `tauri dev` in the background (`nohup … &`) — a child that runs it in
the foreground never finishes. Look at the real app; do not build browser mocks.

## cockpit

- **files:** src/cockpit/, src/mission/Sidebar.tsx, src/mission/Sidebar.test.tsx, src/mission/rows.tsx, src/mission/view.tsx, src/mission/mission.css, src/actions/keys.ts, src/actions/keys.test.ts
- **exposes:** `openView('cockpit', {}, place)` (unchanged id), palette `cockpit.open` (unchanged)
- **consumes:** nothing

Issue #54. Reads `Snapshot` + helpers from `src/mission/types.ts`, `scope.ts`,
`tokens.ts`, `store.ts` (read-only), the GitHub store from `src/github/app-store.ts`
(issue nodes on the mission map stay), and `Graph`/`layoutDagre` from `src/graph`.
The keyboard bindings go in `src/actions/keys.ts` under the existing map. No Rust.

## vault

- **files:** src/vault/, src-tauri/src/vault.rs, src-tauri/fixtures/vault/
- **exposes:** `vault_rules(scope: String, filter: String) -> Vec<RuleRow>`, `vault_ego(path: String, limit: u32) -> VaultGraph`, `vault_health()` (unchanged)
- **consumes:** nothing

Issue #56. Only the `// -- vault` anchor blocks of `lib.rs`. `vault_graph(scope)`
is removed with its force layout; `src/pulse/` currently makes a graph node glow
through `src/vault/GraphView.tsx` — keep that behaviour on the ego view (same
event, new surface) and keep `src/pulse/` untouched.

## image

- **files:** src/terminal/, src/pty/, src/layout/SplitView.tsx, src-tauri/src/commands.rs, src-tauri/capabilities/default.json
- **exposes:** `dropText(paths: string[]) -> string` from `src/terminal/drop.ts`
- **consumes:** nothing

Issue #53. Tauri's drag-drop event (`getCurrentWebview().onDragDropEvent`) needs
its capability; add it to `default.json` only. ⌘V decision lives in
`src/terminal/keymap.ts` next to the other chords, with the clipboard injected
so it is testable.

## home

- **files:** src/home/, src-tauri/src/home.rs, src-tauri/src/home_commands.rs, src-tauri/fixtures/history.jsonl
- **exposes:** `HomeRepo { children: Vec<HomeSession> }` (dispatch children split out of `sessions`), `HomeSnapshot { protected: u32 }`
- **consumes:** nothing

Issue #61. Only the `// -- home` anchor blocks of `lib.rs`. `src/home/Home.tsx`
renders `<Account />` from `src/github` in its header (round 7) — keep that line.

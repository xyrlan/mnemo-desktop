---
feature: round5
created: 2026-09-15
verdict: parallel
---

Fifth dispatch round, from the user's second day of real use: panes need a
visible chrome (repo · branch · tokens) with handles to move and resize; the
cockpit becomes a node graph (React Flow) instead of a list of processes,
with the sidebar reduced to "what needs you"; the vault gets an Obsidian-style
graph with fire counts and a health panel. Decisions and their reasons are in
`docs/superpowers/specs/2026-09-15-round5-design.md`.

Wiring rules from `docs/contracts/panes.md` hold: a view registers itself
from `src/<view>/view.tsx`, palette actions register from inside the view
file, Rust modules and commands go only in your own anchored block of
`src-tauri/src/lib.rs` (`// -- chrome` and `// -- vault` exist; the graph
engine has no Rust). `src/graph/` (React Flow + `layoutDagre`) is shared
and already on main — consume it, do not edit it; if it lacks something, add
a new file under your own folder.

Build note: private target and Vite port when you run the app
(`CARGO_TARGET_DIR=$HOME/.cache/mnemo-desktop-<piece> pnpm tauri dev --port 14xx`).
On this Mac `/usr/bin/git` and `cc` are blocked by the Xcode licence: use
`export DEVELOPER_DIR=/Library/Developer/CommandLineTools PATH=/Library/Developer/CommandLineTools/usr/bin:$PATH`.

## chrome

- **files:** src/layout/SplitView.tsx, src/layout/store.ts, src/layout/store.test.ts, src/layout/tree.ts, src/layout/tree.test.ts, src/terminal/view.tsx, src/chrome/, src-tauri/src/chrome.rs, src/theme.css
- **exposes:** `swapPanes(a: PaneId, b: PaneId)` on the layout store, `chrome_branch(cwd: String) -> Option<String>`, CSS class `.pane-bar`
- **consumes:** `ParentSession { tokens, children_tokens, cwd }` from the mission snapshot (read-only, `?? 0`)

Issue #35. Only the `// -- chrome` anchor blocks of `lib.rs`. Do not touch
`src/mission/` or `src/cockpit/`.

## cockpit-graph

- **files:** src/cockpit/, src/mission/Sidebar.tsx, src/mission/Sidebar.test.tsx, src/mission/rows.tsx, src/mission/view.tsx, src/mission/mission.css
- **exposes:** `openView('cockpit', {}, place)` (unchanged id), palette `cockpit.open` (unchanged)
- **consumes:** `Graph`, `layoutDagre`, `CardData` from `src/graph`; `Snapshot` and helpers from `src/mission/types.ts` (read-only)

Issue #36. No Rust. `src/mission/types.ts`, `scope.ts`, `tokens.ts`,
`store.ts` are shared with the chrome piece's reads — do not change their
exports.

## vault-graph

- **files:** src/vault/, src-tauri/src/vault.rs, src-tauri/fixtures/vault/
- **exposes:** `vault_graph(scope: String) -> VaultGraph { nodes, edges }`, `vault_health() -> Health`
- **consumes:** `Graph`, `layoutDagre`, `CardData` from `src/graph`

Issue #37. Only the `// -- vault` anchor blocks of `lib.rs` (already
present; add the two commands there).

---
feature: round3
created: 2026-09-15
verdict: parallel
---

Third dispatch round, from the first day of real use: scope the cockpit to
the current repo with a full-size global view, show what a parent session
and its children have spent, and bring the mnemo vault into the app.

Wiring rules from `docs/contracts/panes.md` hold: a view registers itself
from `src/<view>/view.tsx`, palette actions register from inside the view
file, Rust modules and commands go only in your own anchored block of
`src-tauri/src/lib.rs` (`// -- vault` exists for the vault piece; the tokens
piece adds no module).

Build note: build with a private target and Vite port when you run the app
(`CARGO_TARGET_DIR=$HOME/.cache/mnemo-desktop-<piece> pnpm tauri dev --port 14xx`).

## tokens

- **files:** src-tauri/src/mission.rs, src-tauri/fixtures/transcript.jsonl, src-tauri/fixtures/agents.json
- **exposes:** `ParentSession { tokens: u64, cache_read: u64, children_tokens: u64 }`, `ChildSession { parent_session: Option<String> }` (both serialized as-is into the `mission_snapshot` JSON)
- **consumes:** nothing

Issue #22. Rust only. The cockpit piece renders these fields; until this
piece lands they are absent from the JSON and the front-end treats them as 0.

## cockpit

- **files:** src/mission/, src/cockpit/, src/settings/store.ts, src/settings/store.test.ts
- **exposes:** `openView('cockpit', {}, place)`, palette `cockpit.open`, settings key `sidebarScope: 'repo' | 'all'`
- **consumes:** `ParentSession { tokens, cache_read, children_tokens }` from tokens, `ChildSession { parent_session }` from tokens

Issue #21. Sidebar scope toggle (this repo / all), the full-size `cockpit`
pane, and rendering of the token fields. Read the token fields defensively
(`?? 0`) so the piece works before and after tokens lands.

## vault

- **files:** src/vault/, src-tauri/src/vault.rs, src-tauri/fixtures/vault/, src-tauri/src/lib.rs
- **exposes:** `openView('vault', {}, place)`, `vault_tree() -> Vec<Agent>`, `vault_page(path: String) -> Page`, `vault_run(action: String, args: Vec<String>, cwd: String) -> RunResult`
- **consumes:** nothing

Issue #23. Only the `// -- vault` anchor blocks of `lib.rs`. Reuse
`mission::login_path()` for the CLI PATH; do not duplicate it.

---
feature: round7
created: 2026-09-15
verdict: parallel
---

Seventh dispatch round: the app shows mnemo working (pulse) and gets GitHub
into the loop through `gh` (login, issues as graph roots, Project board).
Decisions are in `docs/superpowers/specs/2026-09-15-round5-design.md`
(addenda "pulse" and "GitHub via gh"); each piece has an issue with the
acceptance list.

Wiring rules from `docs/contracts/panes.md` hold: a view registers itself
from `src/<view>/view.tsx`, palette actions register from inside the view
file, Rust modules and commands go only in your own anchored block of
`src-tauri/src/lib.rs` (`// -- pulse` and `// -- github` exist, both empty).
`src/graph/` is shared: consume, never edit. Reuse `mission::login_path()`
for every CLI call; `vault::vault_root()` for the vault path; do not
duplicate either.

Build note: private target and Vite port when you run the app
(`CARGO_TARGET_DIR=$HOME/.cache/mnemo-desktop-<piece> pnpm tauri dev --port 16xx`).
Background `gh pr checks --watch` dies with the session: wait in the
foreground. The other piece runs at the same time; its files are not yours.

## pulse

- **files:** src-tauri/src/pulse.rs, src-tauri/fixtures/pulse/, src/pulse/, src/chrome/PaneBar.tsx, src/chrome/info.ts, src/chrome/info.test.ts, src/chrome/*.test.tsx, src/vault/GraphView.tsx, src/vault/graph.ts, src/vault/graph.test.ts, src/vault/graph-view.test.tsx, src/vault/vault.css, src/theme.css
- **exposes:** Tauri event `mnemo://pulse` with `PulseEvent { at, kind: 'reflex' | 'tool' | 'enrich' | 'enforce', project, agent, slugs: string[], tool?: string, hits?: number, session_id?: string }`, `usePulse()` / `pulseStore` from `src/pulse/app-store.ts` with `recentFor(project)` and per-project counters
- **consumes:** nothing

Issue #44. Rust: poll the three `.mnemo/*.jsonl` logs every 1 s from a
per-file byte bookmark (start at end of file on launch — never replay
history), emit one event per new line that is an event (reflex rows with
empty `emitted` are not). Front: the pane bar pulses and shows `↯ <slug>`
for ~3 s when the event's project/agent equals the pane's repo (basename of
its root, which `barInfo` already knows), a counter accumulates, click opens
the rule in the vault pane; the vault graph node glows for ~2 s. Toast only
for `enforce`. Only the `// -- pulse` anchor blocks of `lib.rs`.

## github

- **files:** src-tauri/src/github.rs, src-tauri/fixtures/github/, src/github/, src/board/, src/home/Home.tsx, src/home/home.css, src/home/Home.test.tsx, src/cockpit/, src/settings/store.ts, src/settings/store.test.ts
- **exposes:** `gh_auth() -> Auth`, `gh_issues(root, labels) -> Vec<Issue>`, `gh_project(root) -> Option<Board>`, `openView('board', {}, place)`, palette `board.open`, settings key `issueLabels: Record<string, string[]>`
- **consumes:** nothing

Issue #45. Every call through `gh` with a 60 s cache per repo; `needs_scope`
when the `project` scope is missing. Home: only the header's right side
(login button / `@login`) — the `<Wordmark />` and the repo rows stay. Cockpit:
issue nodes as roots via `buildGraph` (keep its tests green, extend them);
shown = open issues that have a child/PR + the 10 most recent filtered by
label (picker in the needs-you strip, persisted per repo); node action
"dispatch" types `mnemo dispatch <n>` into a terminal tab
(`openCommandTab`). Board pane = kanban of the Project's Status field, or a
plain issues list without a Project. Only the `// -- github` anchor blocks
of `lib.rs`.

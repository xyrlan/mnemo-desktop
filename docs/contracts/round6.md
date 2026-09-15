---
feature: round6
created: 2026-09-15
verdict: parallel
---

Sixth dispatch round, three usability gaps from real use: new shells must
start in the current repo, the app must not trigger macOS folder-access
dialogs at launch, and the app needs a mark. Findings and decisions are in
`docs/superpowers/specs/2026-09-15-round6-design.md`; each piece has an
issue with the acceptance list.

Wiring rules from `docs/contracts/panes.md` hold: Rust modules and commands
go only in your own anchored block of `src-tauri/src/lib.rs`. Seams
pre-built on main so no two pieces share a file: `src/brand/Wordmark.tsx`
is rendered by Home (the brand piece replaces the stub, never Home);
`split(dir, cwd?)` on the layout store already accepts a cwd (the cwd piece
passes one from `src/actions/registry.ts`, never edits `store.ts`).
Round 5 (`docs/contracts/round5.md`) may run at the same time: its chrome
piece owns `src/layout/store.ts`, `src/terminal/view.tsx`, `src/theme.css`
— none of those are yours.

Build note: private target and Vite port when you run the app
(`CARGO_TARGET_DIR=$HOME/.cache/mnemo-desktop-<piece> pnpm tauri dev --port 15xx`).
On this Mac `/usr/bin/git` and `cc` are blocked by the Xcode licence: use
`export DEVELOPER_DIR=/Library/Developer/CommandLineTools PATH=/Library/Developer/CommandLineTools/usr/bin:$PATH`.

## launch

- **files:** src-tauri/src/home.rs, src-tauri/src/home_commands.rs, src-tauri/src/mission.rs, src-tauri/Info.plist, src-tauri/fixtures/history.jsonl, src/home/app-store.ts, src/home/types.ts, src/home/Home.tsx, src/home/home.css, src/home/*.test.ts, src/home/*.test.tsx
- **exposes:** `HomeRepo { unresolved: bool }` in the `home_snapshot` JSON, `home_resolve_repo(root: String) -> HomeRepo`
- **consumes:** nothing

Issue #39. Only the `// -- home` anchor blocks of `lib.rs`. Home.tsx: the
repo-row rendering only — the header's `<Wordmark />` stays as is. The
protected-folder guard lives in one function and is used by every caller of
`repo_root`, including the sidebar poll in `mission.rs`.

## cwd

- **files:** src-tauri/src/pty.rs, src-tauri/src/commands.rs, src-tauri/shell/, src/layout/cwd.ts, src/layout/cwd.test.ts, src/actions/registry.ts, src/actions/registry.test.ts, README.md
- **exposes:** `cwdForNewShell() -> string | undefined` from `src/layout/cwd.ts`, env `TERM_PROGRAM=mnemo` in every spawned shell
- **consumes:** nothing

Issue #40. Reads `focusedCwd()` from `src/mission/scope.ts` and `selected`
from the Home store (read-only). Bootstrap rc files are `include_str!`-ed
from `src-tauri/shell/` and written under `~/.mnemo-desktop/shell/`. README:
one "Shell integration" section (what is set, how to opt out with
`MNEMO_NO_SHELL_INTEGRATION=1`).

## brand

- **files:** app-icon.png, src-tauri/icons/, src-tauri/tauri.conf.json, src/brand/, index.html, package.json, README.md
- **exposes:** `Wordmark()` React component from `src/brand/Wordmark.tsx` (already imported by Home), `mark.svg`
- **consumes:** nothing
- **model:** sonnet

Issue #41. `src/brand/mark.svg` is the mark; adjust it only if the icon
pipeline needs it (safe area, stroke weight at 32 px), keep the palette. Do
not edit `src/home/`. README: both pieces touch it — yours is only the mark
at the top of the file, the cwd piece adds a section at the bottom.

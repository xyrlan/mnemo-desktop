---
feature: orca-redesign-d
created: 2026-09-24
verdict: parallel
---

Wave D of the Orca redesign — the last one before the 0.3.0 release. Read first:

1. `docs/superpowers/specs/2026-09-24-orca-redesign-design.md`, *Feature waves*: wave 2's right
   sidebar (explorer, search, source control) is what is left.
2. `vendor/orca/README.md` and `vendor/orca/MANIFEST.md` — its *Wave D additions* table lists the
   Orca code added for this wave. Adapt from there (keep JSX, classes, animations; replace Orca's
   store, `window.api` and i18n with ours; `// adapted from stablyai/orca <path>` on each file).
   Do not fetch Orca from the network.
3. What is on `main`: the shell, its slots and `src/rightbar/` (the right sidebar, with the Memory
   panel as its only tab today), the fleet, the per-worktree layout, `src/commit/` (the commit
   composer, `openCommit(worktree)`), `src/diff/` (the diff tab), the editor pane
   (`openView('editor', { path, root }, place)`), `fs_list` / `fs_read` in `src-tauri/src/fs.rs`.
   A screen mounts from `src/<dir>/view.tsx`.

The two bugs here were found by looking at the running app: stale-worktree cleanup finds nothing
in a repo that squash-merges, and Design Mode could type into a shell.

**See your work** as `CLAUDE.md` and the memory `see-the-app-through-an-isolated-dev-instance`
describe, or with the preview harness; add a scenario `tools/preview/scenarios/<piece>.mjs` for
what you draw and say what you saw in the PR. Store selectors return stored values or use
`useShallow` (#212). Popper content is not opened in jsdom tests.

`src-tauri/src/lib.rs`: `search` adds a block after `// -- editor (src/fs.rs) --` and
`// -- editor commands --`; `source-control` after `// -- job (src/job.rs) --` and
`// -- job commands --`; `design-mode-guard` only the existing chrome blocks. No piece edits `Cargo.toml`, `tauri.conf.json` or the root
`package.json`.

## rightbar-panels

The right sidebar's activity bar takes a fixed list (`ITEMS` in `src/rightbar/view.tsx`, Memory
only). Other folders must be able to add a tab and its panel from their own `view.tsx`, in a
stable order (Memory first), without editing `src/rightbar/`.

- **files:** src/rightbar/
- **exposes:** `registerRightbarPanel(item: { id: string; title: string; icon: React.ComponentType<{ className?: string }>; order: number; panel: React.ComponentType }): () => void` from `src/rightbar/panels.ts`
- **model:** sonnet
- **effort:** medium

## explorer

Orca's file explorer (MANIFEST, *Wave D additions*) as a right-sidebar tab: the active worktree's
files as a tree, folders expanding lazily, a name filter, keyboard navigation; a file opens in the
editor pane. It follows the worktree on screen. Hidden and ignored files as Orca shows them.

- **files:** src/explorer/, tools/preview/scenarios/explorer.mjs
- **consumes:** `registerRightbarPanel(item: { id: string; title: string; icon: React.ComponentType<{ className?: string }>; order: number; panel: React.ComponentType }): () => void` from rightbar-panels
- **effort:** high

## search

Orca's search panel (MANIFEST, *Wave D additions*) as a right-sidebar tab: search the active
worktree's files — case, whole word, regex, include/exclude globs — results grouped by file with
their matched lines highlighted; a result opens the file in the editor pane at that line. The
search runs in Rust, respects `.gitignore`, and is bounded (results and time) so a huge repo
cannot hang the app.

- **files:** src/search/, src-tauri/src/search.rs, src-tauri/src/lib.rs, tools/preview/scenarios/search.mjs
- **consumes:** `registerRightbarPanel(item: { id: string; title: string; icon: React.ComponentType<{ className?: string }>; order: number; panel: React.ComponentType }): () => void` from rightbar-panels
- **exposes:** `search_worktree(root: String, query: String, opts: SearchOpts) -> Result<SearchResult, String>`
- **effort:** high

## source-control

Orca's source control panel (MANIFEST, *Wave D additions*) as a right-sidebar tab for the active
worktree: staged and unstaged changes by file, stage/unstage per file and all, discard (asking
first — it cannot be undone), a file click opens the diff tab on it, and the commit composer at
the panel's foot (`openCommit`, from `src/commit/`, read not edited). It refreshes when files
change or a commit lands.

- **files:** src/source-control/, src-tauri/src/source_control.rs, src-tauri/src/lib.rs, tools/preview/scenarios/source-control.mjs
- **consumes:** `registerRightbarPanel(item: { id: string; title: string; icon: React.ComponentType<{ className?: string }>; order: number; panel: React.ComponentType }): () => void` from rightbar-panels
- **effort:** high

## cleanup-squash

Bug, seen in the running app: the stale-worktree cleanup (`worktree_cleanup_facts`) listed "48 not
merged" and nothing to clean in mnemo-desktop, where nearly every branch landed by squash merge.
A squash-merged branch is never an ancestor of the default branch, and the fleet only knows open
PRs, so neither signal fires. A branch whose changes are already all in the default branch counts
as merged, whatever way it landed, and a branch whose PR was merged or closed counts too. Never
remove anything here — this only decides what the cleanup view offers.

- **files:** src-tauri/src/worktree.rs
- **effort:** medium

## design-mode-guard

Design Mode (`src/browser/grab-agent.ts`) sends to a pane where the fleet last saw Claude, as a
bracketed paste and then Enter. If Claude has exited since the fleet's last look, the Enter runs
the pasted page HTML in a shell. Right before sending, confirm the pane is still running Claude;
if it is not, send nothing and say so on the card.

- **files:** src/browser/grab-agent.ts, src/browser/grab-agent.test.ts, src/browser/design-live.ts, src/browser/DesignCard.tsx, src/browser/DesignCard.test.tsx, src-tauri/src/chrome.rs, src-tauri/src/lib.rs
- **model:** sonnet
- **effort:** medium

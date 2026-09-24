---
feature: orca-redesign-c
created: 2026-09-24
verdict: parallel
---

Wave C of the Orca redesign. Read first:

1. `docs/superpowers/specs/2026-09-24-orca-redesign-design.md`.
2. `vendor/orca/README.md` and `vendor/orca/MANIFEST.md` — Orca's look, vendored (MIT, authorized
   by the maintainer); its *Wave C additions* table lists the areas added for this wave. Adapt
   from there: keep JSX, classes, animations; replace Orca's store, `window.api` and i18n with
   ours. A file adapted from it opens with `// adapted from stablyai/orca <path>`. Do not fetch
   Orca from the network.
3. What is on `main`: waves A and B. The shell's slots (`mountInSlot` in `src/shell/slots.ts`),
   the fleet (`src/fleet/`), the per-worktree layout (`src/layout/`), `src/worktrees/`,
   `src/agents/`, `@/ui`, and the action registry (`register`, `run` in
   `src/actions/registry.ts`). A screen mounts itself from `src/<dir>/view.tsx`, which `App.tsx`
   imports by glob — **a mount in any other file never runs** (`src/shell/mounts.test.ts`).

This wave came out of looking at the running app (spec, *Eyes first*). Bugs and cleanup matter
most — they make the app usable every day — then the remaining features.

**See your work.** `CLAUDE.md` and the project memory `see-the-app-through-an-isolated-dev-instance`
say how to run a throwaway dev instance and drive it with `mnemo-desktop-mcp call`; the preview
harness (`node tools/preview/shot.mjs`) is the lighter option. A piece that draws adds its own
scenario `tools/preview/scenarios/<piece>.mjs` and describes what it saw in the PR. Selectors
must return what the store holds or use `useShallow`: one that builds a new object each read
re-renders forever (#212), and only a test against a live zustand store catches it. Popper
content (popover, dropdown, tooltip, select) is not opened in jsdom tests.

`src-tauri/src/lib.rs`: each piece touches only its own blocks — `diff-comments` a new block
after `// -- pr-review (src/review.rs) --` and `// -- pr-review commands --`; `ai-commit-pr`
after `// -- github (src/github.rs) --` and `// -- github commands --`; `design-mode` the
existing browser blocks; `worktree-archive` the existing worktrees blocks; `keymap-c` only the
macOS menu block in `.setup(…)`. Only `bundle-helpers` edits `src-tauri/Cargo.toml`,
`Cargo.lock` or `tauri.conf.json`; no piece edits the root `package.json`.

## projects-persist

Bug: a project added with "Add project" or "Open a folder" lives only in Home's in-memory
`extraRoots`, so a repo with no Claude sessions yet disappears on restart, and a pinned repo
with no sessions never shows. In Orca the project list is the user's and persists. Projects
added go into settings and every Home read includes them; the user can forget one.

Settings also gain the per-repo quick commands `quick-commands` reads.

- **files:** src/home/store.ts, src/home/store.test.ts, src/home/app-store.ts, src/settings/store.ts, src/settings/store.test.ts
- **exposes:** `Settings['projects']: string[]`, `Settings['quickCommands']: Record<string, Array<{ label: string; command: string }>>`, `forgetProject(root: string): Promise<void>` in Home's store state
- **effort:** medium

## dashboard-fit

Bug: at a 1280px window the dashboard's IDLE column is cut at the right edge, its count pill
gone. All four columns must be usable at the app's minimum window width and up — fit, or scroll
visibly the way Orca's board scroller does. Also: `src/dashboard/shell.ts` still finds the shell
by glob from before it landed; import it directly.

- **files:** src/dashboard/, tools/preview/scenarios/dashboard.mjs
- **model:** sonnet
- **effort:** medium

## terminal-scrollbar

Bug: a terminal pane shows a thin dark bar along its bottom edge with a short white segment at
the right, like a horizontal scrollbar, seen in the real app with one terminal open at 1280×800.
Find what draws it and remove it without losing the vertical scrollbar or the fit.

- **files:** src/terminal/, src/chrome/chrome.css
- **model:** sonnet
- **effort:** medium

## retire-surfaces

Spec, *Where everything lives*: remove what the new layout replaced and no screen mounts any
more — the cockpit (`src/cockpit/`), the board (`src/board/`), Home's screen (`Home.tsx` and its
CSS; Home's store, client, types, PR pane and review code stay, because Tasks and the fleet use
them), the mission sidebar (`src/mission/Sidebar.tsx` and what only it uses; the mission pane
view stays), and the vault square (`src/vaultlevel/`'s UI; its client and level math stay, the
status bar reads them; `src/avatar/` stays, the pet draws with it). Their tests go with them. The marketplace, mission map and ego graph are
frozen, not removed (spec). Nothing on screen may change.

- **files:** src/cockpit/, src/board/, src/home/Home.tsx, src/home/Home.test.tsx, src/home/home.css, src/mission/, src/vaultlevel/, src/theme.css
- **effort:** high

## shim-cleanup

Wave-B pieces found the shell (and new-workspace) through `import.meta.glob` shims while those
did not exist yet. They all exist now: import them directly and delete the fallbacks, their
standalone roots, and the tests that only covered the fallback. Also: in dev, a hot reload runs a
`view.tsx` again and its `mountInSlot` adds a second copy of the screen (seen as three status
bars); a hot-reloaded mount must replace its earlier one.

- **files:** src/onboarding/, src/tabs/, src/new-workspace/, src/rightbar/, src/jump/, src/tasks/, src/notify/, src/pet/, src/statusbar/, src/shell/slots.ts, src/shell/slots.test.tsx
- **effort:** medium

## keymap-c

Chords for this wave's actions and none for what is gone: Mod+E `dictation.toggle`, Mod+Alt+A
`floating-terminal.toggle`, Mod+Shift+G `diff.open`; drop `cockpit.open`, `home.show` and
`mission.toggle-sidebar` from the chords, the builtins and the macOS menu. One menu tuple per
line (a test reads them).

- **files:** src/actions/, src-tauri/src/lib.rs
- **consumes:** `run('dictation.toggle')` from dictation, `run('floating-terminal.toggle')` from floating-terminal, `run('diff.open')` from diff-comments
- **model:** sonnet
- **effort:** low

## worktree-archive

The sidebar lists every worktree the repo has — the maintainer's showed 35, most of them finished
dispatch children. Adapt Orca's workspace cleanup (MANIFEST, *Wave C additions*): each card's
context menu can remove its worktree (confirming when it has changes); a cleanup view finds the
stale ones — branch merged or PR merged or closed, no changes — and removes them in one go. The
repo header's menu can forget the project. Also: `src/sidebar/shell.ts` is a glob shim; import
the shell directly.

- **files:** src/sidebar/, src-tauri/src/worktree.rs, src/worktrees/, src-tauri/src/lib.rs, tools/preview/scenarios/worktree-archive.mjs
- **consumes:** `forgetProject(root: string): Promise<void>` from projects-persist
- **effort:** high

## diff-comments

A diff tab for the active worktree's uncommitted changes, file by file, with Orca's per-line
comments (MANIFEST, *Wave C additions*): comments gathered on lines go to that worktree's agent in
one message — typed into its Claude pane, or through the mission reply for a dispatched child.
The tab has a "Commit…" action that runs `commit.open`.

- **files:** src/diff/, src-tauri/src/worktree_diff.rs, src-tauri/src/lib.rs, tools/preview/scenarios/diff-comments.mjs
- **consumes:** `run('commit.open')` from ai-commit-pr
- **exposes:** `registerPaneView('diff', Diff)`, `register({ id: 'diff.open' })`
- **effort:** high

## ai-commit-pr

Orca's commit composer with AI text (MANIFEST, *Wave C additions*) for the active worktree:
the changes to commit, a message generated from the diff (`claude -p` with a small model, as
`mission_translate` already does) and editable, Commit, Push, and Create PR with a generated
title and body (`gh pr create`). Every step's failure is shown, never swallowed.

- **files:** src/commit/, src-tauri/src/commit.rs, src-tauri/src/lib.rs, tools/preview/scenarios/ai-commit-pr.mjs
- **exposes:** `register({ id: 'commit.open' })`, `openCommit(worktree: string): void` from `src/commit/open.ts`
- **effort:** high

## design-mode

Orca's Design Mode for browser panes (MANIFEST, *Wave C additions*): a toggle in the browser
pane's bar; hovering the page outlines elements; a click picks one, and its HTML, computed CSS
and a screenshot of it go to the active worktree's agent with a short note the user can edit.
Browser panes are native child webviews; the page script runs inside them.

- **files:** src/browser/, src-tauri/src/browser.rs, src-tauri/src/lib.rs, tools/preview/scenarios/design-mode.mjs
- **exposes:** `register({ id: 'browser.design-mode' })`
- **effort:** high

## floating-terminal

Orca's floating terminal (MANIFEST, *Wave C additions*): a terminal floating over the app,
toggled by `floating-terminal.toggle`, draggable and resizable, remembering where it was, in the
active worktree's folder. It uses the existing terminal pane (`src/terminal/`, read not edited).

- **files:** src/floating/, tools/preview/scenarios/floating-terminal.mjs
- **exposes:** `register({ id: 'floating-terminal.toggle' })`
- **effort:** medium

## quick-commands

Orca's quick commands (MANIFEST, *Wave C additions*): a titlebar button (`titlebar-right` slot)
with the active repo's saved commands; picking one runs it in the focused terminal; commands can
be added, edited and removed, stored per repo root.

- **files:** src/quick-commands/, tools/preview/scenarios/quick-commands.mjs
- **consumes:** `Settings['quickCommands']: Record<string, Array<{ label: string; command: string }>>` from projects-persist
- **effort:** medium

## dictation

Spec, *Where everything lives*: dictation on Mod+E with Orca's indicator (MANIFEST, *Wave C
additions*), using the whisper voice already in `src/voice/`: the first press starts listening,
the second stops and puts the text where the cursor is — the focused terminal or input. The
⌥Space push-to-talk stays.

- **files:** src/voice/, tools/preview/scenarios/dictation.mjs
- **exposes:** `register({ id: 'dictation.toggle' })`
- **effort:** medium

## bundle-helpers

Before any release: the app needs its three helper binaries — `mnemo-desktop-mcp` (MCP bridge),
`mnemo-desktop-ptyd` (terminals that outlive the app) and `mnemo-desktop-hook` (agent status) —
next to the app in the release bundle, where each is looked for today. Check what `pnpm tauri
build` ships, make all three ship on macOS and Linux (Windows has no daemon), and make
`scripts/install-app.mjs` install a bundle that has them. Prove it by building the bundle.

- **files:** src-tauri/tauri.conf.json, src-tauri/Cargo.toml, src-tauri/Cargo.lock, src-tauri/build.rs, scripts/install-app.mjs, .github/workflows/ci.yml
- **effort:** high

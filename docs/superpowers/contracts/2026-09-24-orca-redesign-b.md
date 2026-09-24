---
feature: orca-redesign-b
created: 2026-09-24
verdict: parallel
---

Wave B of the Orca redesign: the screens. Read, in this order:

1. `docs/superpowers/specs/2026-09-24-orca-redesign-design.md` — every decision, and *Where
   everything lives* above all.
2. `vendor/orca/README.md` and `vendor/orca/MANIFEST.md` — Orca's look, vendored in the repo
   (MIT, authorized by the maintainer). **Adapt from there**: keep the JSX structure, Tailwind
   classes, animations and interactions; replace Orca's store, `window.api` and i18n with ours.
   A file adapted from it opens with `// adapted from stablyai/orca <path>`. Do not fetch Orca
   from the network; everything you may copy is in `vendor/orca/`.
3. What wave A landed, which these pieces build on:
   - `@/ui`: the primitives (Button, Dialog, Sheet, DropdownMenu, Tooltip, Command, toast, …),
     `@/ui/cn`, the tokens in `src/theme.css`. Accent is `bg-brand` / `text-brand`; state colours
     are `text-state-{working,needs-you,done,idle}`; z-index scale `z-drawer` < `z-toast` <
     `z-modal` < `z-popover` < `z-menu` < `z-tooltip`.
   - `src/fleet/` (`useFleet`, `fleetStore`): every repo, its worktrees, their agents and state,
     PR, unread.
   - `src/layout/` store: `activeWorktree`, `switchWorktree`, `closeWorktree`, `openWorktrees`,
     `worktreeTabs`; `panes` holds every open pane of every worktree.
   - `src/worktrees/` (`listWorktrees`, `createWorktree`, `removeWorktree`), `src/agents/`
     (`subscribeAgentEvents`, `notifyAgent`), `src/memory/` (`getMemoryFeed`).
   - `@dnd-kit/core`, `@dnd-kit/sortable` and `@tanstack/react-virtual` are already in
     `package.json`. **No piece edits `package.json` or `pnpm-lock.yaml`.**

**Shared wiring.** Every screen mounts itself: a piece that draws into the shell calls
`mountInSlot(...)` (exposed by `shell`) from its own `src/<dir>/view.tsx`, which `App.tsx`
already imports by glob. Pieces talk to each other through **action ids** —
`run('worktree.jump')` from `src/actions/registry.ts` — and the few signatures below, never by
importing each other's components. Register actions with `register()` from your own files.

**The current views keep their look** until they are replaced: foundation scopes the old CSS to
`.app`, `.palette-overlay`, `.pulse-host` and `.voice-host`. New chrome never uses those four
class names; old pane views (terminal, editor, browser, mission, vault, …) keep rendering inside
a `.app` scope that `shell` provides.

**Evidence.** Each piece that draws adds its own preview scenario
`tools/preview/scenarios/<piece>.mjs` (its own file; `fixtures/app.mjs` is read-only here) and
shoots it with `node tools/preview/shot.mjs`. Read the PNG and describe what you saw in the PR.
Popper-positioned content (popover, dropdown, tooltip, select) is not opened in jsdom tests: with
no layout, floating-ui re-positions forever and the worker never goes idle.

`src-tauri/src/lib.rs`: `persistent-terminals` touches only the pty command lines at the top of
`invoke_handler` and the `on_window_event` hunk; `keymap` touches only the macOS menu block in
`.setup(…)`. Only `persistent-terminals` edits `src-tauri/Cargo.toml` / `Cargo.lock`. A fresh
worktree needs `pnpm install` (pnpm, never npm); `CLAUDE.md` says how to run the suite.

Left for wave C: diff comments and AI commit/PR text, Design Mode, floating terminal, quick
commands, dictation on Mod+E (the ⌥Space push-to-talk stays), and deleting what this wave
retires (the cockpit, `src/mission/Sidebar.tsx`, Home, the vault square) — deleting now would
land in files other pieces still read.

## shell

Orca's app shell (MANIFEST area 1): titlebar, left sidebar frame, workbench, right sidebar frame,
status bar frame, each sidebar resizable and collapsible. It replaces today's layout in
`App.tsx`, whose sidebar sits on the right; `src/mission/Sidebar.tsx` stops being mounted.

The workbench renders **every** open worktree's tabs (`openWorktrees()` × `worktreeTabs()`) and
shows only the active worktree's active tab, so switching worktrees never unmounts a terminal. A
worktree with no tab shows an Orca-style empty state (new terminal, launch agent). Before any
worktree is chosen, the main checkout of the first repo is shown.

- **files:** src/App.tsx, src/shell/
- **exposes:** `mountInSlot(slot: ShellSlot, component: React.ComponentType): () => void` from `src/shell/slots.ts`, `type ShellSlot = 'left-sidebar' | 'right-sidebar' | 'status-bar' | 'titlebar-tabs' | 'titlebar-right' | 'overlay'`, `shellStore: StoreApi<ShellState>` and `useShell<T>(sel: (s: ShellState) => T): T` from `src/shell/store.ts`, `type ShellState = { leftOpen: boolean; rightOpen: boolean; leftWidth: number; rightWidth: number; toggleLeft(): void; toggleRight(): void; setLeftWidth(px: number): void; setRightWidth(px: number): void }`, `register({ id: 'sidebar.toggle-left' })`, `register({ id: 'sidebar.toggle-right' })`
- **effort:** xhigh

## left-sidebar

Orca's left sidebar (MANIFEST area 2): nav (Search → `worktree.jump`, Tasks → `tasks.open`,
Agent Dashboard entry with per-state counts → `dashboard.toggle`), repo groups with colour and
icon, and a **worktree card** per worktree from the fleet: status lane, unread, name, branch, PR
badge, dispatched mark, compact inline agents. Clicking a card switches to it and marks it read.
"Add project" registers a folder through the existing Home client; "New workspace" runs
`workspace.new`. Registers `worktree.go.1` … `worktree.go.9` in sidebar order.

- **files:** src/sidebar/, tools/preview/scenarios/left-sidebar.mjs
- **consumes:** `mountInSlot(slot: ShellSlot, component: React.ComponentType): () => void` from shell, `useShell<T>(sel: (s: ShellState) => T): T` from shell
- **exposes:** `register({ id: 'worktree.go.N' })` for N in 1…9
- **effort:** xhigh

## workbench-tabs

Orca's tab strip and pane frames (MANIFEST area 3). The strip shows the active worktree's tabs
in the titlebar (`titlebar-tabs` slot): active bar, unread wash, agent state dot, close on hover,
drag to reorder, "+" for a new terminal. Inside a tab, today's split panes stay (our model: a tab
holds a split tree of panes), restyled with Orca's frame: focus dimming, its resize handle, its
drop overlay when a pane is dragged to an edge.

- **files:** src/tabs/, src/layout/SplitView.tsx, src/chrome/PaneBar.tsx, src/chrome/PaneBar.test.tsx, src/chrome/SplitView.test.tsx, src/chrome/DropZoneOverlay.tsx, src/chrome/chrome.css, tools/preview/scenarios/workbench-tabs.mjs
- **consumes:** `mountInSlot(slot: ShellSlot, component: React.ComponentType): () => void` from shell
- **effort:** high

## status-bar

Orca's status bar (MANIFEST area 4), h-6 at the bottom: the active pane's tokens (what the pane
bar shows today), the pulse count, the vault level, and a summary of agents by state from the
fleet.

- **files:** src/statusbar/, tools/preview/scenarios/status-bar.mjs
- **consumes:** `mountInSlot(slot: ShellSlot, component: React.ComponentType): () => void` from shell
- **model:** sonnet
- **effort:** medium

## right-sidebar

Orca's right sidebar frame (MANIFEST area 11) with its activity bar, and the first panel:
**Memory** (spec, *Where everything lives*). For the active worktree and the focused pane's
session, from `getMemoryFeed`: the last session's briefing, rules that fired in this session,
what mnemo learned in this project, and the project's inbox with keep/drop inline (through the
existing `src/learned/` client). It never opens a pane.

- **files:** src/rightbar/, tools/preview/scenarios/right-sidebar.mjs
- **consumes:** `mountInSlot(slot: ShellSlot, component: React.ComponentType): () => void` from shell, `useShell<T>(sel: (s: ShellState) => T): T` from shell
- **effort:** high

## dashboard

Orca's agent dashboard (MANIFEST area 5): a non-modal drawer at the left sidebar's edge, four
columns — Needs you / Working / Done / Idle — of every agent in the fleet, interactive and
dispatched together, with view transitions when a card changes column. A card click switches to
its worktree and focuses its pane. Replaces the cockpit (which stays in the code until wave C).

- **files:** src/dashboard/, tools/preview/scenarios/dashboard.mjs
- **consumes:** `mountInSlot(slot: ShellSlot, component: React.ComponentType): () => void` from shell
- **exposes:** `register({ id: 'dashboard.toggle' })`
- **effort:** high

## jump-palette

Orca's worktree jump palette (MANIFEST area 9), Mod+J: every worktree in the fleet, fuzzy
search with highlighted matches, status dot, age, branch, repo pill; Enter switches to it.

- **files:** src/jump/, tools/preview/scenarios/jump-palette.mjs
- **consumes:** `mountInSlot(slot: ShellSlot, component: React.ComponentType): () => void` from shell
- **exposes:** `register({ id: 'worktree.jump' })`
- **effort:** medium

## new-workspace

Orca's new-workspace composer (MANIFEST area 10), Mod+N (spec, *How a parallel agent is born*):
project, name, base; **Create** makes the worktree, switches to it and opens a terminal running
`claude` — with `--dangerously-skip-permissions` unless the Settings toggle is off; opened from an
issue, **Dispatch** is offered too and runs the existing `dispatchIssue`. The repo's setup
command, if set, is passed to `createWorktree` and its progress shown.

Settings gain `skipPermissions` (default `true`) and `repoSetup` (setup command per repo root),
with a way to change both.

- **files:** src/new-workspace/, src/settings/store.ts, src/settings/store.test.ts, tools/preview/scenarios/new-workspace.mjs
- **consumes:** `mountInSlot(slot: ShellSlot, component: React.ComponentType): () => void` from shell
- **exposes:** `openNewWorkspace(opts?: { repo?: string; issue?: { number: number; title: string } }): void` from `src/new-workspace/open.ts`, `register({ id: 'workspace.new' })`, `Settings['skipPermissions']: boolean`, `Settings['repoSetup']: Record<string, string>`
- **effort:** high

## tasks

The Tasks view (spec, *Where everything lives*): a pane view listing each repo's open issues
and PRs from the Home data. An issue offers "New workspace" (`openNewWorkspace` with the issue)
and "Dispatch" (`dispatchIssue`); a multi-selection dispatches a batch (`dispatchIssues`); a PR
opens as today's PR pane. Replaces Home's issue/PR lists and the board.

- **files:** src/tasks/, tools/preview/scenarios/tasks.mjs
- **consumes:** `openNewWorkspace(opts?: { repo?: string; issue?: { number: number; title: string } }): void` from new-workspace
- **exposes:** `registerPaneView('tasks', Tasks)`, `register({ id: 'tasks.open' })`
- **effort:** medium

## notifications

When an agent stops or starts waiting on you (`subscribeAgentEvents`: `stop`, `notification`)
in a worktree that is not on screen, or while the window is unfocused: a native notification
(`notifyAgent`), an in-app card in Orca's notification stack (MANIFEST area 7) that switches to
the worktree when clicked, and a short sound. Nothing fires for the worktree you are looking at.

- **files:** src/notify/, tools/preview/scenarios/notifications.mjs
- **consumes:** `mountInSlot(slot: ShellSlot, component: React.ComponentType): () => void` from shell
- **effort:** medium

## pet

The octopus becomes Orca's pet (MANIFEST area 8): a small draggable overlay that reacts to the
fleet — working, needs-you, done, idle — and to the vault level, using the existing avatar
scenes in `src/avatar/` (read, not edited). Its position is remembered; reduced motion is
respected.

- **files:** src/pet/, tools/preview/scenarios/pet.mjs
- **consumes:** `mountInSlot(slot: ShellSlot, component: React.ComponentType): () => void` from shell
- **model:** sonnet
- **effort:** medium

## persistent-terminals

Spec, *Feature waves*, wave 2, pulled forward: terminals outlive the app. Quitting or reloading
the app leaves every shell — and the `claude` in it — running; the next launch reattaches each
saved pane to its shell with its screen and scrollback. Orca does it with a detached daemon
(`src/main/daemon/` in Orca, not vendored; the spec's reference table says where). A shell whose
process is gone restores as today, a fresh shell in the same folder.

Also, in `src/terminal/view.tsx`: dev builds create the WebGL addon so that WebKit's snapshot
can see terminal text (`new WebglAddon(import.meta.env.DEV)` was measured to work).

`pty_spawn`, `pty_write`, `pty_resize` and `pty_kill` keep their signatures.

- **files:** src-tauri/src/pty.rs, src-tauri/src/commands.rs, src-tauri/src/bin/mnemo-desktop-ptyd.rs, src-tauri/Cargo.toml, src-tauri/Cargo.lock, src-tauri/src/lib.rs, src/layout/store.ts, src/layout/store.test.ts, src/layout/persist.ts, src/terminal/
- **exposes:** `pty_list() -> Result<Vec<PtyInfo>, String>`, `type PtyInfo = { id: number; cwd: string; pid: number; alive: boolean }`
- **effort:** xhigh

## keymap

Orca's keymap (spec, *Other defaults*): Mod+J `worktree.jump`, Mod+N `workspace.new`, Mod+B
`sidebar.toggle-left`, Mod+L `sidebar.toggle-right`, Mod+1…9 `worktree.go.N`, Mod+T `tab.new`,
Mod+D split, ⌘K palette and ⌘⇧C conversation face kept. Tabs move to Ctrl+1…9 and keep ⌘⇧[ / ⌘⇧].
`mission.toggle-sidebar` and `home.show` lose their chords. The macOS menu table in `lib.rs`
follows, one tuple per line (a test reads it).

- **files:** src/actions/, src-tauri/src/lib.rs
- **consumes:** `run('worktree.jump')` from jump-palette, `run('workspace.new')` from new-workspace, `run('sidebar.toggle-left')` from shell, `run('worktree.go.1')` from left-sidebar
- **model:** sonnet
- **effort:** medium

## cross-worktree

Two lookups that stop at the worktree on screen (found by `workspace-model`, #185): Home's
`paneForSession` (`src/home/types.ts`, and its twin in `src/layout/tabs.ts`) searches only `tabs`,
so a session running in a hidden worktree gets a second copy started; `openMissionPane`
(`src/mission/rows.tsx`) sets `activeTab` directly and cannot reach a pane in a hidden worktree.
Both must find panes in every open worktree and switch to the right one (`goToPane` already
does).

- **files:** src/home/types.ts, src/home/types.test.ts, src/layout/tabs.ts, src/layout/tabs.test.ts, src/mission/rows.tsx
- **model:** sonnet
- **effort:** low

## onboarding

First run (spec, *Where everything lives*): Orca-style onboarding in a dialog — the setup check
(`src/setup/`: git, claude, mnemo, gh) and then the "what mnemo learned" consent (`src/learned/`)
— instead of two panes. After it, the learned review keeps working as today from ⌘K.

- **files:** src/onboarding/, src/setup/, src/learned/view.tsx, tools/preview/scenarios/onboarding.mjs
- **consumes:** `mountInSlot(slot: ShellSlot, component: React.ComponentType): () => void` from shell
- **exposes:** `register({ id: 'onboarding.open' })`
- **effort:** medium

# The Orca redesign — design

Decided 2026-09-24 in a grilling session with the maintainer. Every decision
below was put to them and answered; the few defaults they did not answer are
marked **default** and were shown to them before this was written.

## Why

The maintainer used [Orca](https://github.com/stablyai/orca) — an open-source
desktop app for running coding agents in parallel git worktrees — and wants
mnemo-desktop to work and feel like it, with mnemo's own ideas in place of
Orca's: its memory, and `mnemo dispatch` as the way parallel agents are born.

Three things were named, all of them wanted:

- **the workflow** — how the screen is distributed: a worktree per task, many
  agents at once, and one glance to see who is waiting on you;
- **the visual** — Orca's component mechanics and its animations, small ones
  included;
- **the features** — the ones listed under *Feature waves*.

What is wrong today, in the maintainer's words: the cockpit has no pull, and
the vault, when opened, competes with a window that was already open, so
nobody wants to read it. Their saved workspace at the time held eight
terminals and one "what mnemo learned" pane, and nothing else.

## Constraints

- **The app is the maintainer's daily driver, and no one else uses it.**
  Anything in the app layer may break: `~/.mnemo-desktop/workspace.json` and
  every other file in the app dir may change format without a migration.
  What lives outside the app — the vault, the `mnemo` CLI's data, `~/.claude`
  — is not the app's to break.
- **Not a launch.** Onboarding polish, a website, i18n and telemetry wait.
- **No release until parity** with the maintainer's daily use: terminals and
  agents in the new shell. 0.2.0 stays installed as the daily driver until
  then. Each milestone lands on `main` as PRs; releases are cut separately.

## Reference: Orca

MIT, "Copyright (c) 2026 Lovecast Inc.". Mapped at commit
`122b8c25d7c16f76e395bf9a65887d7c4bc5003b`:

    git clone https://github.com/stablyai/orca && git -C orca checkout 122b8c25

Paths below are relative to that clone.

| Area | Where |
|---|---|
| Shell: titlebar, left sidebar, workbench, right sidebar, status bar | `src/renderer/src/app-shell/AppWorkspaceShell.tsx`, `AppRootSurfaces.tsx` |
| Left sidebar, worktree cards | `src/renderer/src/components/sidebar/` |
| Workbench: split tab groups | `src/renderer/src/components/tab-group/` (`TabGroupSplitLayout.tsx`), `tab-bar/` |
| Right sidebar | `src/renderer/src/components/right-sidebar/`, `source-control/` |
| Status bar | `src/renderer/src/components/status-bar/` |
| Agent dashboard (kanban) | `src/renderer/src/components/dashboard/`, `AgentStateDot.tsx`, `AgentWorkingSpinner.tsx` |
| New workspace | `src/renderer/src/components/new-workspace/`, `NewWorkspaceComposerCard.tsx`, `worktree-creation/` |
| Jump palette (Mod+J) | `src/renderer/src/components/WorktreeJumpPalette.tsx`, `cmd-j/` |
| Notifications | `src/renderer/src/components/notifications/`, `NotificationCardStack.tsx` |
| Pet overlay | `src/renderer/src/components/pet/` |
| Dictation | `src/renderer/src/components/dictation/` |
| Diff comments to an agent | `src/renderer/src/components/diff-comments/` |
| Floating terminal, quick commands | `components/floating-terminal/`, `components/terminal-quick-commands/` |
| UI primitives (shadcn new-york-v4) | `src/renderer/src/components/ui/`, `components.json` |
| Design tokens, style guide | `src/renderer/src/assets/main.css`, `docs/STYLEGUIDE.md` |
| Keybindings | `src/shared/keybindings/definitions-core-*.ts` |
| Agent status via hooks | `src/main/agent-hooks/server/`, `src/main/claude/hook-settings.ts`, `src/shared/agent-hook-types.ts` |
| Worktree create / remove | `src/main/git/worktree-add.ts`, `worktree-removal.ts`, `src/main/hooks.ts` |
| Terminals that outlive the app | `src/main/daemon/` (`headless-emulator.ts`, `pty-subprocess.ts`) |

Orca is Electron. Its renderer is React 19 + zustand + xterm + cmdk + Monaco,
as ours is, so components port nearly directly; its `window.api` IPC does
not, and every ported component is rewired to Tauri `invoke`.

## Decisions

### 1. Base: keep Tauri and the Rust core, port Orca's renderer layer

Not a fork of Orca: that would trade 50k lines we own for about 3.5M we
don't, and rewrite the Rust core (pty, mission, vault, conversation, MCP) in
Node. Not a rewrite from zero either: Orca's components are the point.

The UI stack becomes Orca's: Tailwind 4, shadcn (new-york-v4) on Radix,
`lucide-react` icons, `tw-animate-css`, `sonner` toasts, the Geist font.

**Out of scope:** Orca's mobile app, cloud relay, SSH hosts, web client, the
38-agent catalogue (Claude only), telemetry, plugins, i18n, account hot-swap.

### 2. Object model: Repo → Worktree → its own layout

Orca's hierarchy. A worktree (called a **workspace** in the UI, as in Orca)
owns its tabs and splits; switching worktrees swaps the whole workbench. The
main checkout is a worktree like any other. The sidebar moves to the **left**.

### 3. How a parallel agent is born: two ways, one card

- **New workspace** — a fresh worktree with an interactive `claude` in a
  terminal, Orca's way.
- **Dispatch** — a `mnemo dispatch` child: headless, contract-driven, with
  mnemo's memory, and take-over into a terminal.

Both appear as the same kind of worktree card with the same status. Agents
launch with `--dangerously-skip-permissions` **by default**, both kinds — the
maintainer's call, for the workflow — with a toggle in Settings.

**Worktree convention** (**default**): a new workspace is a sibling directory
`<repo>-wt-<name>`, the convention `mnemo dispatch` already uses, so one place
holds both kinds. A tree is *dispatched* when it contains
`.mnemo-child-profile/dispatch.json`.

### 4. Where everything lives

The principle: **Orca's layout wins, and mnemo never opens a pane that
competes with your work. Memory appears beside what you are doing.**

| Region | What lives there | Replaces |
|---|---|---|
| **Left sidebar** | Repos → worktree cards: status, branch, PR, inline agents, unread. Dispatched children are cards with a "dispatched" mark. Top: Search, Tasks, Dashboard | Home's repo/session list, `ws-tabs`, cockpit |
| **Workbench** (per worktree) | Tabs and splits: terminal (with the conversation face), agent session (the mission view, redesigned), editor, diff, browser | the current layout |
| **Right sidebar** (contextual) | Explorer, source control, checks, and **Memory**: rules that fired in this session, what mnemo learned in this project, the project's inbox with keep/drop inline, the last session's briefing | Vault and Learned as panes |
| **Dashboard** | Kanban — Needs you / Working / Done / Idle — interactive and dispatched agents together | the cockpit, which dies |
| **Tasks** | Issues and PRs; "new workspace from issue" and "dispatch"; multi-select dispatches a batch | Home's issues/PRs, the board |
| **Status bar** | tokens, pulse, vault level | the sidebar HUD |
| **Pet** | the octopus, reacting to agent state and vault level | avatar + HUD |
| **Dictation (Mod+E)** | the whisper voice we already have | the voice pill |
| **Onboarding** | setup, then the "what mnemo learned" consent | setup and learned panes |

The full vault (health, pages) opens only from ⌘K, as a tab, occasionally.
**Frozen** (off the UI, code kept for now): marketplace, mission map, the
vault's ego graph.

### 5. Visual system

Orca's grammar: neutral monochrome base, colour **only for state** (Orca uses
orange for an agent asking something), sans UI, lucide icons, its radius,
shadows and animations. mnemo's identity lives in three things: **one**
accent colour of its own, JetBrains Mono in terminals and code, and the
octopus. Dark first; the tokens make a light theme nearly free, but it is not
polished now. The accent is picked by the maintainer from three candidates
rendered side by side (**default**).

### 6. Agent status: the app's own hooks

Today the app polls `claude agents --json` every 5 s. Orca gets status
instantly from Claude Code hooks it writes into `~/.claude/settings.json`.

mnemo's CLI already installs hooks there — `SessionStart`, `UserPromptSubmit`,
`PreToolUse` (Bash|Read|Edit|Write|MultiEdit only), `SessionEnd`, each a
`python3 -m mnemo.hooks.*` process — but not `Stop` or `Notification`, the two
events that say "finished" and "waiting on you". Forwarding through them
would mean adding two hooks to mnemo that only the app needs, run for every
mnemo user, each starting Python.

So the app installs its **own** hooks: a small Rust binary shipped with the
app forwards each event to the app over a local socket. Conditions:

- the hook never slows Claude down — short timeout, always exits 0, silent
  when the app is closed;
- the app's entries are marked as its own, installed idempotently, and never
  touch an entry the app did not write;
- polling stays, as the fallback and to reconcile state at launch.

### 7. Feature waves (from Orca)

| Feature | Wave |
|---|---|
| Worktree cards, workbench per worktree, Mod+N / Mod+J / Mod+1–9 | 1 |
| New-worktree setup: copy `.worktreeinclude` files, run a per-repo setup command | 1 |
| Dashboard kanban | 1 |
| Notifications: agent finished, unread, sound | 1 |
| Diff with per-line comments sent to the agent; commit/push/PR with AI text | 2 |
| Right sidebar: explorer, search, source control | 2 |
| Terminals that survive the app quitting, scrollback restored | 2 |
| Browser Design Mode: click an element, send its HTML/CSS/screenshot to the agent | 3 |
| Floating terminal, quick commands | 3 |
| Ghostty/Warp theme import; markdown/mermaid/pdf viewers | out |

### 8. Eyes first

UI work here has shipped unseen (project memory `no-visual-check-of-the-app`:
`screencapture` is refused, the Chrome extension fails on the vite dev
server). A redesign cannot. Before any new screen:

1. **The real app, from a session.** Dev-only MCP tools that screenshot the
   app's main webview — the same `WKWebView takeSnapshot` the browser-pane
   snapshot already uses (`src-tauri/src/mcp.rs`) — and drive it (click, type,
   keys, eval), against a `pnpm tauri dev` instance that has its own app dir
   (`~/.mnemo-desktop-dev`) and socket, never the maintainer's running app.
2. **A preview harness.** Headless Chromium through Playwright renders `src/`
   with Tauri IPC mocked from fixtures, for fast per-screen iteration and
   visual regression shots.

Once they land, every UI PR carries screenshots.

### 9. License

mnemo-desktop has no LICENSE file today. It gets an MIT `LICENSE`, a
`THIRD_PARTY_NOTICES.md` carrying Orca's notice, and every file ported from
Orca opens with `// adapted from stablyai/orca <path>`.

### 10. Other defaults

- Orca's keymap whole (Mod+J/N/T/D/P/1–9, Mod+B / Mod+L for the sidebars),
  keeping ⌘K for the palette and ⌘⇧C for the conversation face.
- The UI stays in English.
- `registerPaneView` stays: each tab type registers itself from its own
  `view.tsx`. A surface that dies takes its tests with it.

## Delivery

Built with mnemo's own loop: contracts under `docs/superpowers/contracts/`,
one `mnemo dispatch` child per piece, as many in parallel as the boundaries
allow.

- **Wave A** (`2026-09-24-orca-redesign-a.md`): everything that does not need
  the new UI to exist — eyes, the preview harness, the visual foundation, agent
  hooks, worktree create/remove, the workspace-per-worktree layout model, the
  memory feed, and the fleet model that the sidebar and dashboard will read.
- **Wave B**, written against what wave A lands: the shell (titlebar, both
  sidebars, workbench tab bar, status bar), worktree cards, dashboard, Tasks,
  the Memory panel, new workspace / dispatch flows with the permissions
  toggle, notifications UI, the pet, dictation, onboarding, persistent
  terminals.
- **Wave C**: diff comments and AI commit/PR text, Design Mode, floating
  terminal, quick commands.

### Rules carried over

- `src-tauri/src/lib.rs`: each piece touches only its own anchored blocks.
  A command written but never registered compiles and fails only at runtime,
  so every new command gets a test that it is in the handler.
- A pane view registers itself from `src/<view>/view.tsx`; no piece edits
  `App.tsx` for that, nor `src/actions/registry.ts`.
- Claude transcript format is parsed only in `src/conversation/parse.ts`.
- Drawers are not modals. Browser panes are native child webviews drawn above
  the HTML, so an overlay that covers one must hide it (the palette already
  does).
- Radix portals need a z-index scale that stacks popovers above drawers.
- `react-virtuoso` is mocked in jsdom tests.

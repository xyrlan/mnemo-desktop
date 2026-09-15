# mnemo-desktop — sub-project 1: shell + free terminal

**Date:** 2026-09-14
**Status:** shipped (PR #1, 2026-09-14)
**Scope:** the first of six sub-projects that together form the mnemo ADE (agentic development environment). This spec covers only the desktop shell and a free terminal. Later sub-projects (mission cockpit, editor, browser pane, multi-CLI, marketplace + voice) get their own specs.

## 1. Why

The user runs `mnemo dispatch` and then has to ask the parent Claude Code session "what is happening?" — and even then misses what happened while not looking (a child blocked, unblocked itself, decided something). `claude agents` shows per-child status but nothing at the mission level, and it lives in another terminal that must be opened on purpose.

The decision (2026-09-14) is to build a desktop app that replaces the daily terminal (Warp today) so a mission cockpit can be **always on screen** without typing anything. Replacing the terminal is the pre-condition for "always on screen"; the cockpit itself is sub-project 2.

Sub-project 1 therefore has one goal: **on day one the user closes Warp and runs their parent Claude Code session inside mnemo-desktop**, with tabs, splits and a command palette. Nothing mnemo-specific yet.

## 2. Roadmap context (all six, for orientation only)

| # | Sub-project | Depends on |
|---|---|---|
| 1 | Shell + free terminal (this spec) | — |
| 2 | Mission cockpit: contract → piece → child → PR → land, per-child timeline with "since you last looked" delta, cost, peek/reply, attach into a pane of #1 | 1 |
| 3 | Editor (Monaco, worktree file tree, child diff) | 1 |
| 4 | Browser pane (Tauri webview: open PR, open child preview) | 1 |
| 5 | Multi-CLI children (Codex, Gemini) | 2 |
| 6 | Marketplace (over `mnemo share-rules publish/import`) + voice | 1, 2 |

## 3. Decisions already made

- **New repo** `xyrlan/mnemo-desktop`. mnemo (Python CLI) is a runtime dependency consumed through its `--json` outputs; nothing in mnemo changes for this sub-project.
- **Stack:** Tauri 2 (Rust core, system webview) + React + TypeScript + Vite front-end, xterm.js for terminal rendering, `portable-pty` for the PTY. Chosen over Electron for binary size (~10 MB vs ~150 MB), memory (an app that stays open all day), and because `portable-pty` gives macOS/Linux/Windows ConPTY behind one API.
- **Warp features kept:** tabs + split, command palette. **Dropped:** blocks, AI prompt, autocomplete beyond what the user's own zsh/fzf provides, SSH management, themes/preferences.
- **Visual:** one fixed "mnemo look". No theme toggle, no user preferences in v1.
- **No session restore** in v1: reopening the app gives fresh terminals.

## 4. Architecture

Two processes, standard Tauri:

### 4.1 Core (Rust, `src-tauri/`)

Owns every PTY. State: `Mutex<HashMap<PaneId, PtyHandle>>` where `PaneId` is a `u32` issued by the core.

Commands exposed to the front-end (`#[tauri::command]`):

| Command | Input | Output |
|---|---|---|
| `pty_spawn` | `cwd: Option<String>`, `cols: u16`, `rows: u16` | `PaneId` or error string |
| `pty_write` | `id`, `data: Vec<u8>` | `()` or error |
| `pty_resize` | `id`, `cols`, `rows` | `()` or error |
| `pty_kill` | `id` | `()` (idempotent) |

Events emitted to the front-end:

| Event | Payload |
|---|---|
| `pty://output/<id>` | raw bytes from the PTY (Tauri 2 `Channel<Vec<u8>>` passed at spawn time; no base64) |
| `pty://exit/<id>` | `{ code: Option<i32> }` |

One blocking reader thread per PTY. No polling. When the reader hits EOF it emits `pty://exit` and the handle is dropped.

Shell spawned: `$SHELL` (fallback `/bin/zsh` on macOS, `/bin/bash` on Linux, `powershell.exe` on Windows) with `-l` on POSIX so the user's login profile (starship, fzf, aliases) loads. Environment: inherit the app's, plus `TERM=xterm-256color`, `COLORTERM=truecolor`, `MNEMO_DESKTOP=1` (so scripts and later sub-projects can detect they run inside the app).

`cwd` for a new pane: the user's home for a new tab; the originating pane's cwd for a split. The core does not track cwd; the front-end passes it. In v1 the front-end passes home for tabs and, for splits, the home as well unless OSC 7 (`\e]7;file://host/path\a`) has been received on the originating pane — xterm.js exposes OSC handlers, and zsh/starship emit OSC 7 by default on macOS Terminal-compatible setups. If no OSC 7 was seen, split falls back to home. This is deliberate: reading `/proc` or `lsof` for cwd is platform-specific and not worth it in v1.

Closing a pane calls `pty_kill`, which sends SIGHUP (POSIX) / terminates the ConPTY (Windows) and drops the handle. Closing the window kills all.

### 4.2 Front-end (React + TypeScript, `src/`)

- Each terminal pane mounts one xterm.js `Terminal` with addons `fit` and `webgl` (fallback to canvas when WebGL is unavailable).
- xterm `onData` → `pty_write`. `ResizeObserver` on the pane container → `fit()` → `pty_resize`.
- Output channel → `terminal.write(bytes)`.
- Layout state lives only in the front-end store (`zustand`), never in Rust.

## 5. Tabs and splits

State model:

```ts
type PaneId = number
type Node =
  | { kind: 'leaf'; pane: PaneId }
  | { kind: 'split'; dir: 'row' | 'col'; ratio: number; children: [Node, Node] }
type Tab = { id: string; title: string; root: Node; focused: PaneId }
type Store = { tabs: Tab[]; activeTab: string }
```

Operations:

- **Split** the focused leaf: replace it with `split { children: [old leaf, new leaf] }`, ratio 0.5, spawn a PTY for the new leaf.
- **Close** a leaf: kill its PTY; its sibling replaces the parent split. Closing the last leaf of a tab closes the tab. Closing the last tab opens a fresh one (the app never shows an empty window).
- **Divider drag** updates `ratio`, clamped to [0.1, 0.9].
- **Focus** moves with click or with the directional shortcut, which picks the nearest leaf in that direction by pane rectangle.
- **Tab title** = last OSC 0/2 title received on the focused pane, else the shell name.

Shortcuts (macOS; `Ctrl` replaces `⌘` on Linux/Windows):

| Keys | Action |
|---|---|
| `⌘T` | new tab |
| `⌘W` | close focused pane |
| `⌘D` | split vertical (side by side) |
| `⌘⇧D` | split horizontal (stacked) |
| `⌘⌥←/→/↑/↓` | move focus |
| `⌘1..9` | go to tab N |
| `⌘⇧[ / ]` | previous / next tab |
| `⌘K` | command palette |

Focused pane has a 1px accent border; others a muted one.

## 6. Command palette

`⌘K` opens a `cmdk` palette. Actions are a typed registry:

```ts
type Action = { id: string; title: string; shortcut?: string; run: (ctx: Ctx) => void }
```

v1 actions: new tab, split vertical, split horizontal, close pane, go to tab 1–9, "new pane in same directory". The registry is the extension point sub-project 2 uses to add "attach child X" and "open mission" without touching palette code.

## 7. Visual

- Single dark theme; all colours are CSS custom properties in `src/theme.css`, including the 16 ANSI colours handed to xterm.js.
- Bundled monospace font (JetBrains Mono, ligatures off). No font setting.
- Chrome: tab bar on top, panes fill the rest, no sidebar in v1 (sub-project 2 adds one).
- The window title is `mnemo`.

## 8. Errors

- `pty_spawn` failure → the pane renders the error string in place of the terminal, with a "retry" action.
- Shell exits → `pty://exit` → the pane shows `[process exited with code N] press any key to close`, standard terminal behaviour.
- Rust panics in a reader thread must not take the app down: each thread catches, emits `pty://exit` with `code: None`, and logs.

## 9. Testing

- **Rust:** unit tests for the PTY manager: spawn `/bin/sh -c 'printf hi'`, assert the output channel receives `hi` and the exit event fires; resize on a live PTY does not error; kill is idempotent; kill of an unknown id is a no-op. Windows variants run only in CI.
- **Front-end:** the layout reducer is pure and fully unit-tested (split, close, sibling promotion, last-tab rule, focus movement). xterm.js is not tested in jsdom.
- **Integration:** one CI smoke that builds the app and, on macOS and Linux, launches it with a `MNEMO_DESKTOP_SMOKE=1` env that spawns a shell, writes `exit\n`, and asserts the exit event within 5 s. Windows build must succeed; the smoke there is a follow-up once a Windows machine is available (same rule mnemo follows).

## 10. Repo layout and CI

```
mnemo-desktop/
  package.json  pnpm-lock.yaml  vite.config.ts  tsconfig.json
  src/            React front-end
  src-tauri/      Rust core, tauri.conf.json, Cargo.toml
  docs/superpowers/specs/   this file and later specs
  .github/workflows/ci.yml   cargo test + pnpm test + tauri build on macos/ubuntu/windows
  .github/workflows/release.yml   on tag v*: build and attach binaries
```

mnemo is installed globally (hooks + MCP in `$HOME`), so the vault, dispatch and land already work in this repo; no per-repo `mnemo init` is needed.

## 11. Out of scope for sub-project 1

Session restore, themes, preferences, SSH, blocks, AI prompt, any mnemo-specific UI, tray icon, auto-update. Each is either dropped for good or belongs to a later sub-project.

## 12. Definition of done

The user runs their daily parent Claude Code session inside mnemo-desktop for a full working day without opening Warp: tabs, splits, palette and shell behave; no crash; resize is correct; closing the window leaves no orphan shells.

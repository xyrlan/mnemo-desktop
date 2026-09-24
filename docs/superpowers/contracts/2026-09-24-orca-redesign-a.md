---
feature: orca-redesign-a
created: 2026-09-24
verdict: parallel
---

Wave A of the Orca redesign. The design, and every decision behind it, is
`docs/superpowers/specs/2026-09-24-orca-redesign-design.md` — read it first.
Orca itself is MIT and mapped at commit `122b8c25`; the spec says how to
clone it and where each piece of it lives.

Wave A is everything the new UI will stand on and that does not need the new
UI to exist yet. The cut follows boundaries that already exist: the MCP
socket bridge (`mcp.rs` and its binary), the root package manifest, the
layout store, and new modules in their own directories. No two pieces share
a file except `src-tauri/src/lib.rs`, and there each touches only its own
anchored blocks:

- `eyes`: the existing `// -- mcp (src/mcp.rs) --` and `// -- mcp commands --` blocks
- `agent-hooks`: a new block directly after `// -- pulse (src/pulse.rs) --` and
  after `// -- pulse commands --`, and the only piece that may add a block to
  `.setup(…)`, directly after the smoke check
- `worktrees`: a new block directly after `// -- workspace (src/workspace.rs) --`
  and after `// -- workspace commands --`
- `memory-feed`: a new block directly after `// -- vault (src/vault.rs) --` and
  after `// -- vault commands --`

Only `foundation` edits the root `package.json` / `pnpm-lock.yaml` (and no
piece may create a root `pnpm-workspace.yaml`). Only `agent-hooks` edits
`src-tauri/Cargo.toml` / `Cargo.lock`. A fresh worktree has no
`node_modules`: run `pnpm install` (pnpm, never npm) before the suite.

Left for wave B, because each would land in files a wave-A piece is
rewriting: the shell and every new screen (they need `foundation` and the
eyes to be built well), terminals that outlive the app (reattaching on
restore lives in `src/layout/store.ts`, which `workspace-model` owns), and
the Settings toggle for skip-permissions (it belongs with the new-workspace
flow that reads it).

## eyes

Milestone 0 (spec, *Eyes first*). A session must be able to see and drive a
running dev instance of the app. The screenshot reuses what the browser-pane
snapshot already does, on the app's main webview instead of a child one.

`desktop_app_drive` exists only in debug builds: a release build must never
let a Claude session type into the app, since the app is full of terminals.
The CLI mode is how a session uses both without registering the dev
instance as an MCP server: it makes one call against the socket named by
`MNEMO_DESKTOP_MCP_SOCKET` (or the build's default app dir), prints the
result as JSON, and writes an image result to `--out`.

Retiring the project memory `no-visual-check-of-the-app` is not this piece's
job; the parent does that once it has used the tools itself.

- **files:** src-tauri/src/mcp.rs, src-tauri/src/bin/mnemo-desktop-mcp.rs, src/mcp/, src-tauri/src/lib.rs
- **exposes:** `desktop_app_snapshot() -> { mime: string; data: string }`, `desktop_app_drive(args: { action: 'click' | 'type' | 'key' | 'eval'; selector?: string; text?: string; keys?: string; js?: string }) -> { ok: boolean; result?: unknown; error?: string }`, `mnemo-desktop-mcp call <tool> [<json-args>] [--out <file>]`
- **effort:** high

## preview-harness

The second half of milestone 0: the real `src/` app rendered in headless
Chromium through Playwright, with Tauri's IPC mocked from fixtures, so a
screen can be shot without a Tauri build. It does not go through the Chrome
extension, which fails on the vite dev server.

Everything lives under `tools/preview/`, including its own `package.json`
and lockfile, installed on its own; the root manifest belongs to
`foundation`. The first scenarios render the app as it stands today: an empty
workspace, and a workspace with one terminal pane showing fixture output.
Wave B adds a scenario per new screen.

- **files:** tools/preview/
- **exposes:** `node tools/preview/shot.mjs --scenario <name> --out <file.png> [--size <w>x<h>]`, `scenario(name: string, setup: { ipc: (cmd: string, args: Record<string, unknown>) => unknown; events?: Array<{ event: string; payload: unknown; afterMs?: number }> }) -> void`
- **effort:** medium

## foundation

Milestone 1 (spec, *Visual system* and *License*). Orca's UI stack goes in —
Tailwind 4, shadcn new-york-v4 on Radix, `lucide-react`, `tw-animate-css`,
`sonner`, Geist — with its primitives ported from
`src/renderer/src/components/ui/` and its tokens from
`src/renderer/src/assets/main.css`, plus the state colours and a z-index
scale that stacks popovers above drawers.

The current views keep rendering: every CSS custom property they use today
(`--bg`, `--fg`, `--accent`, …, in `src/theme.css`) must still resolve,
because wave B replaces those views one at a time. Where an Orca token name
collides with one of ours, ours is the one that moves.

Three accent candidates are switchable with `data-accent` on `<html>`, so the
maintainer can pick one from screenshots. JetBrains Mono stays the terminal
and code font.

`LICENSE` is MIT for mnemo-desktop (copyright xyrlan);
`THIRD_PARTY_NOTICES.md` carries Orca's notice; each ported file opens with
`// adapted from stablyai/orca <path>`.

- **files:** package.json, pnpm-lock.yaml, vite.config.ts, tsconfig.json, index.html, src/main.tsx, src/theme.css, src/ui/, components.json, LICENSE, THIRD_PARTY_NOTICES.md
- **exposes:** `cn(...inputs: ClassValue[]) -> string` from `@/ui/cn`, `Button, Input, Textarea, Kbd, Badge, Separator, Tooltip, Popover, HoverCard, DropdownMenu, ContextMenu, Dialog, Sheet, Tabs, ScrollArea, Collapsible, Switch, Select, Command, Toaster, toast` from `@/ui`, Tailwind utilities for Orca's shadcn tokens (`bg-background`, `text-foreground`, `text-muted-foreground`, `bg-accent`, `bg-sidebar`, `border-border`, `ring-ring`, …) and for state (`text-state-working`, `text-state-needs-you`, `text-state-done`, `text-state-idle`), `<html data-accent="a" | "b" | "c">`, `@/` resolving to `src/` in vite, vitest and tsc
- **effort:** high

## agent-hooks

Spec, *Agent status: the app's own hooks*. Claude Code tells the app, the
moment it happens, that a session started, got a prompt, stopped, is waiting
(`Notification`), or ended. A small binary of the app's own is the hook
command; it forwards the event over a local socket of this piece's own —
`mcp.rs` and its socket belong to `eyes`.

Hard requirements, all from the spec: the hook never slows Claude down
(short timeout, always exits 0, silent when the app is closed); the app's
entries in `~/.claude/settings.json` are marked as its own, installed
idempotently, and no entry the app did not write is ever touched — mnemo's
own hooks live in the same file. A debug build (`tauri dev`) does not write
to the user's `~/.claude/settings.json` unless `MNEMO_DESKTOP_DEV_HOOKS=1`.

`notifyAgent` is the native OS notification primitive only; when to call it
is wave B's.

- **files:** src-tauri/src/agent_hooks.rs, src-tauri/src/bin/mnemo-desktop-hook.rs, src-tauri/Cargo.toml, src-tauri/Cargo.lock, src-tauri/capabilities/, src-tauri/src/lib.rs, src/agents/
- **exposes:** `agent_hooks_install() -> Result<(), String>`, `agent_hooks_uninstall() -> Result<(), String>`, `type AgentEvent = { sessionId: string; cwd: string; kind: 'start' | 'prompt' | 'stop' | 'notification' | 'end'; message?: string; at: number }` from `src/agents/events.ts`, `subscribeAgentEvents(cb: (e: AgentEvent) => void) -> () => void` from `src/agents/events.ts`, `notifyAgent(title: string, body: string) -> Promise<void>` from `src/agents/notify.ts`
- **effort:** high

## worktrees

Spec, *How a parallel agent is born* and the wave-1 setup feature. List a
repo's worktrees, create one for a new workspace, remove one.

A new tree is the sibling `<repo>-wt-<name>` — the convention `mnemo
dispatch` uses — and a tree is `dispatched` when it holds
`.mnemo-child-profile/dispatch.json`. After the tree exists, files listed in
the repo's `.worktreeinclude` (gitignored files such as `.env`) are copied in.
`setup` is the per-repo setup command (wave B stores it in Settings); when
given, it runs in the new tree as a job on the existing `job-line` /
`job-exit` events, and `worktree_create` returns as soon as the tree exists,
not when setup finishes.

Refuse names and paths that would escape the repo's parent directory.

- **files:** src-tauri/src/worktree.rs, src-tauri/src/lib.rs, src/worktrees/
- **exposes:** `worktree_list(repo: String) -> Result<Vec<WorktreeInfo>, String>`, `worktree_create(repo: String, name: String, base: Option<String>, setup: Option<String>) -> Result<WorktreeInfo, String>`, `worktree_remove(path: String, force: bool) -> Result<(), String>`, `type WorktreeInfo = { path: string; branch: string | null; head: string; isMain: boolean; dispatched: boolean; dirty: boolean; setupJob: string | null }` from `src/worktrees/client.ts`, `listWorktrees(repo: string) -> Promise<WorktreeInfo[]>`, `createWorktree(repo: string, name: string, opts?: { base?: string; setup?: string }) -> Promise<WorktreeInfo>`, `removeWorktree(path: string, force?: boolean) -> Promise<void>`
- **effort:** medium

## workspace-model

Spec, *Object model*. Each worktree owns its own tabs and splits, and
switching worktrees swaps the whole workbench. Panes of a worktree that is
not shown keep running; switching back finds them as they were.

`tabs`, `activeTab` and `panes` keep meaning "what is shown now", so every
current consumer of the store — the sidebar, the palette, the pane chrome —
keeps working untouched. A new terminal opens in the active worktree. The
saved workspace is per worktree; the old saved format may be dropped
(spec, *Constraints*).

- **files:** src/layout/store.ts, src/layout/saved.ts, src/layout/persist.ts, src/layout/app-store.ts, src/layout/store.test.ts, src/layout/workspace.test.ts
- **exposes:** `activeWorktree: string | null` in `State`, `switchWorktree(path: string): Promise<void>` in `Actions`, `closeWorktree(path: string): Promise<void>` in `Actions`, `openWorktrees(): string[]` in `Actions`, `worktreeTabs(path: string): Tab[]` in `Actions`
- **effort:** high

## memory-feed

Spec, *Where everything lives* — the right sidebar's Memory panel, which wave
B draws from this and nothing else: for the worktree and session in front of
you, the rules that fired in this session, what mnemo learned in this
project, the project's inbox, and the last session's briefing.

Read-only over what mnemo already writes (the vault's logs, briefings and
inbox). Existing readers in `vault.rs` and `install_review.rs` may be called
but not edited; the project name follows the canonical rule already in
`install_review.rs`.

- **files:** src-tauri/src/memory_feed.rs, src-tauri/src/lib.rs, src/memory/
- **exposes:** `memory_feed(cwd: String, session_id: Option<String>) -> Result<MemoryFeed, String>`, `type MemoryFeed = { project: string; briefing: { sessionId: string; date: string; tldr: string; path: string } | null; fired: Array<{ slug: string; name: string; at: number; source: 'reflex' | 'mcp' | 'denial' }>; learned: Array<{ slug: string; name: string; at: number }>; inbox: Array<{ key: string; type: string; title: string; excerpt: string }> }` from `src/memory/types.ts`, `getMemoryFeed(cwd: string, sessionId?: string) -> Promise<MemoryFeed>` from `src/memory/client.ts`
- **effort:** medium

## fleet-model

The one data source for the left sidebar's worktree cards and the dashboard
kanban, both wave B: every repo the app knows, its worktrees, and the agents
in each, with their state.

It merges what exists on `main` — the repos Home knows, the mission snapshot
(dispatched children), PR and checks data, the `claude agents --json` polling
and the pane-to-session match — with the two new sources below: worktrees
from `worktrees`, and instant state changes from `agent-hooks`, the polling
then serving as fallback and reconciliation. A worktree is `unread` when one
of its agents went to `done` or `needs-you` since it was last shown.

- **files:** src/fleet/
- **consumes:** `listWorktrees(repo: string) -> Promise<WorktreeInfo[]>` from worktrees, `subscribeAgentEvents(cb: (e: AgentEvent) => void) -> () => void` from agent-hooks
- **exposes:** `fleetStore: StoreApi<Fleet>` from `src/fleet/store.ts`, `useFleet<T>(sel: (f: Fleet) => T) -> T` from `src/fleet/store.ts`, `type Fleet = { repos: RepoNode[]; markRead(path: string): void; refresh(): Promise<void> }`, `type RepoNode = { root: string; name: string; worktrees: WorktreeNode[] }`, `type WorktreeNode = { path: string; name: string; branch: string | null; kind: 'main' | 'workspace' | 'dispatched'; agents: AgentNode[]; pr: { number: number; state: 'open' | 'draft' | 'merged' | 'closed'; checks: 'pending' | 'passing' | 'failing' | null } | null; unread: boolean }`, `type AgentNode = { sessionId: string; paneId: number | null; state: 'working' | 'needs-you' | 'done' | 'idle'; waitingFor: 'permission' | 'question' | null; title: string; since: number }`
- **effort:** high

---
feature: nexus-app-wave2
created: 2026-10-15
verdict: parallel
---

Wave 2a of "the Nexus is the app": five pieces that move what still depends on the workbench into
the Nexus, so wave 2b can delete the workbench's interface in one pass and nothing breaks.
**Nothing is deleted in this wave** beyond what a piece replaces. The workbench still renders under
the ship, made inert, until 2b.

**Read first:**
- `docs/superpowers/specs/2026-10-15-nexus-app-design.md`, all of it, with "Wave 2: deleting the
  workbench" (Q10–Q18).
- Wave 1's contract, `docs/superpowers/contracts/2026-10-15-nexus-app.md`, for the seams
  (`src/nexus/ui/`, `src/nexus/drawer/open.ts`, `src/nexus/outside.ts`).

Where this contract and the spec disagree, ask the parent session.

**The test every piece passes:** imagine 2b has deleted every workbench view. That covers
`src/shell/Workbench.tsx`, the tab strip, the sidebars, `src/statusbar/`, `src/palette/`,
`src/popout/`, `chrome/PaneBar.tsx` and every `view.tsx` the Nexus does not need. What your piece
moves must still work. Name in your PR body each workbench file your piece still imports, and why
2b must keep it.

**What no piece edits:**
- `src/nexus/ui/`, `src/nexus/drawer/open.ts`, `src/App.tsx`, `src/main.tsx`, `package.json`.
- `src/layout/`, the session registry: import it, never edit it.
- `src/nexus/NexusView.tsx`, except the `routes` piece.

No piece adds a dependency. **English only.** The repo is **public**: fixtures are synthetic, and
no repo or project name appears that is not this one or `mnemo`.

**Suite:** `pnpm test && pnpm build && pnpm --dir tools/preview test`, with the
`DEVELOPER_DIR`/`PATH` prefix `CLAUDE.md` gives.
- The `mcp` piece also runs
  `SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk CARGO_TARGET_DIR=$HOME/.cache/mnemo-desktop-wave2-mcp cargo test --manifest-path src-tauri/Cargo.toml`.
  That target is pruned at landing.
- CI runs on Windows too: compare paths as paths.
- Removing a file: `git rm`, never `rm -rf`.

## boot

- **files:** src/nexus/boot/, src/shell/Shell.tsx, src/mission/view.tsx, src/setup/, src/learned/, src/onboarding/, src/terminal/, src/chrome/chrome.css, src/ui/sonner.tsx
- **exposes:** `startNexusApp(): () => void`
- **consumes:** nothing
- **model:** opus
- **effort:** high

What the app needs at launch, owned by the Nexus instead of the workbench's views.
- **Settings load at launch** in the Nexus's own start, not in `mission/view.tsx`, so
  `skipPermissions`, `quickCommands` and the rest hold from the first frame.
- **Toasts:** one toaster, mounted by the Nexus (its own overlay slot, not `NexusView.tsx`) in the
  ship's look; `Shell.tsx` stops mounting its own. Every existing `toast(...)` call keeps working.
- **First run:** the setup and learned launch checks open `openWindow('setup')` and
  `openWindow('learned')` in order, where they opened the onboarding overlay or a workbench pane.
  Onboarding's steps are those windows, and the overlay goes.
- **The drawer's terminal** gets the layout and message CSS it needs (`.pane-body`,
  `.terminal-body`, `.pane-message`, `.pane-notice`) from a stylesheet the terminal or the Nexus
  loads, not from `chrome/chrome.css`.
- `startNexusApp` starts all of it; `src/nexus/view.tsx` keeps calling what it calls today until 2b
  wires this.

## routes

- **files:** src/nexus/drawer/, src/nexus/NexusView.tsx, src/nexus/outside.ts, src/nexus/outside-app.ts, src/mission/rows.tsx, src/session/, src/notify/
- **exposes:** `openFigure(id: string): boolean`
- **consumes:** nothing
- **model:** opus
- **effort:** high

Every path that goes to a session lands in the Nexus.
- **`openFigure(id)`:** opens a robot's or a captain's drawer tab from anywhere in the app, as a
  click on it does. False when the ship does not know the id.
- **The drawer's dependencies** that show a workbench pane or repo (`goToPane`, `goToRepo`) and
  **attaching a child** (today a `terminal-cmd` view only the workbench draws) open in the drawer.
- **System notifications** (Q14): a click opens the figure through `openFigure`, never
  `switchWorktree`, `goToPane` or the sidebar's dispatch routes. The notification stack takes the
  ship's look.
- After 2b nothing closes the Nexus, so a route that answers "the Nexus is closed" is dead code.
  Leave it; 2b removes it.

## mcp

- **files:** src/mcp/, src-tauri/src/mcp.rs, src-tauri/src/bin/mnemo-desktop-mcp.rs
- **exposes:** `listSessions(): McpSession[]`
- **consumes:** nothing
- **model:** opus
- **effort:** high

The `desktop_*` MCP tools after the workbench (Q16).
- **`desktop_list_panes`** lists the Nexus's sessions: the drawer's tabs and the panes the app runs
  with no view on screen.
- **`desktop_terminal_read`** reads any of them, shown or not.
- **`desktop_browser_read` and `desktop_pane_snapshot`** go, in TypeScript, in Rust and in the MCP
  binary's tool list.
- **`desktop_app_snapshot`** stays as it is.
- Tool descriptions say what they read now.

## voice

- **files:** src/voice/
- **exposes:** `dictationTarget(): DictationTarget | null`
- **consumes:** nothing
- **model:** opus
- **effort:** high

Dictation (⌘E, Q12) types into the drawer's active terminal, or into the bridge's prompt when it has
focus, where it looked for a focused workbench pane. With neither, it says so and records nothing.

## status

- **files:** src/nexus/ship-types.ts, src/nexus/ship.ts, src/nexus/ship.test.ts, src/nexus/ShipScene.tsx, src/nexus/ship-scene/, src/nexus/windows/memory/
- **exposes:** `snapshotExceptions(errors: SnapshotError[]): Exception[]`
- **consumes:** nothing
- **model:** opus
- **effort:** high

What only the status bar shows today finds a place in the ship (Q11).
- **Snapshot errors** (`mission/errors`, `explainErrors`) become a bridge exception, with what failed
  and what to do.
- **The vault's level** shows in the Memory window.
- **Anything else the bar shows** either has a place on the ship or is listed in the PR body as
  dropped, with why.
- The status bar itself stays until 2b deletes it.

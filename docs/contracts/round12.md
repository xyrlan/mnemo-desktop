---
feature: round12
created: 2026-09-15
verdict: parallel
---

Twelfth round: the app starts *serving* the Claude Code sessions it hosts (a
desktop MCP with structured reads of panes), and the browser pane keeps logins
and can hand a URL to Chrome. Wiring rules from `docs/contracts/panes.md` hold.
Rounds 10 and 11 are in flight: `src/vault/`, `src/layout/`, `src/App.tsx`,
`src/mission/`, `src/cockpit/`, `src/settings/`, `src/chrome/`, `src/pty/`,
`src-tauri/src/{chrome,pty,commands,workspace,vaultmap}.rs` are NOT yours —
consume the layout store through `store.getState()` only. Anchors `// -- mcp`
and `// -- browser` exist in `lib.rs`. Run `tauri dev` in the background with a
private target (`CARGO_TARGET_DIR=$HOME/.cache/mnemo-desktop-<piece> pnpm tauri dev
--port 19xx`), kill leftover `vite` first, and test against a real Claude Code
started inside a pane.

## mcp

- **files:** src-tauri/src/mcp.rs, src-tauri/src/bin/, src-tauri/Cargo.toml, src-tauri/tauri.conf.json, src/mcp/, src/terminal/view.tsx, src/terminal/buffer.ts, src/terminal/buffer.test.ts, src/browser/view.tsx, src/browser/read.ts, src/browser/read.test.ts, README.md
- **exposes:** MCP tools `desktop_list_panes`, `desktop_terminal_read(pane, lines)`, `desktop_browser_read(pane)`, `desktop_pane_snapshot(pane)` (browser panes only); Tauri commands `mcp_socket_path() -> String`; frontend registry `registerBuffer(paneId, () => string[])` in `src/terminal/buffer.ts`
- **consumes:** nothing

Issue #74. The stdio MCP process is a second binary of the same crate
(`src-tauri/src/bin/mnemo-desktop-mcp.rs`) speaking newline JSON-RPC to the app
over a Unix socket the app listens on (`~/.mnemo-desktop/mcp.sock`); the app
answers pane questions by asking the webview (event → invoke round-trip). Each
spawned shell gets it registered for Claude Code via `~/.mnemo-desktop/mcp.json`
and `CLAUDE_CODE_…` env is NOT touched — document in the README how a session
adds it (`claude mcp add desktop -- <path-to-binary>`), and add it automatically
to the project-less user scope only if Claude Code offers a non-interactive way;
otherwise the README line is the delivery. Only the `// -- mcp` anchor blocks of
`lib.rs`. In `src/browser/view.tsx` only add the read/snapshot bridge calls; the
browser piece owns the rest of that file's UI — coordinate by keeping your edit
to one clearly marked block at the bottom of the file.

## browser

- **files:** src/browser/address.tsx, src/browser/address.ts, src/browser/address.test.ts, src/browser/browser.css, src/browser/client.ts, src/browser/open.ts, src/browser/open.test.ts, src-tauri/src/browser.rs
- **exposes:** `browser_open_external(url: String) -> Result<(), String>`, `browser_data_store() -> String` (`persistent` | `ephemeral`)
- **consumes:** nothing

Issue #75, items 1 and 2 only. Only the `// -- browser` anchor blocks of
`lib.rs`. Do not edit `src/browser/view.tsx` (the mcp piece adds a block there);
mount your "Abrir no Chrome" button from the address bar component.

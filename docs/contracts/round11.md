---
feature: round11
created: 2026-09-15
verdict: parallel
---

Eleventh round: the sidebar becomes the workspace column (vertical tabs, no top
bar, no scope toggle) and the layout survives a restart; a Claude Code started
by hand in a pane gets its sessionId learnt so the restore can resume it.
Wiring rules from `docs/contracts/panes.md` hold; `src/graph/`, `src/pulse/`,
`src/github/`, `src/vault/` (round 10 is in there) are read-only. Anchors
`// -- workspace` and `// -- chrome` already exist in `lib.rs`. Seam: the layout
store already has `setSessionId(id, sessionId)` and `Pane.sessionId` — the
resume piece writes it, the workspace piece reads it; neither edits the other's
files. Run `tauri dev` in the background with a private target
(`CARGO_TARGET_DIR=$HOME/.cache/mnemo-desktop-<piece> pnpm tauri dev --port 18xx`),
kill leftover `vite` first, look at the real app.

## workspace

- **files:** src/App.tsx, src/theme.css, src/layout/, src/mission/Sidebar.tsx, src/mission/Sidebar.test.tsx, src/mission/mission.css, src/mission/scope.ts, src/mission/scope.test.ts, src/cockpit/Cockpit.tsx, src/cockpit/Cockpit.test.tsx, src/cockpit/cockpit.css, src/settings/store.ts, src/settings/store.test.ts, src/actions/registry.ts, src/actions/registry.test.ts, src/actions/keys.test.ts, src-tauri/src/workspace.rs, src-tauri/src/lib.rs
- **exposes:** `workspace_read() -> serde_json::Value`, `workspace_write(value: serde_json::Value) -> Result<(), String>`, layout store `restore(saved)` and `snapshotForSave()`
- **consumes:** nothing

Issue #72. Only the `// -- workspace` anchor blocks of `lib.rs`. The native
menu table in `lib.rs` (`keys.test.ts` reads it) keeps every existing action id.
Reads `Pane.sessionId` (set by the resume piece at runtime) for the state dot
and for `claude --resume` on restore.

## resume

- **files:** src/chrome/, src/pty/, src-tauri/src/chrome.rs, src-tauri/src/pty.rs, src-tauri/src/commands.rs, src-tauri/fixtures/agents.json, src-tauri/fixtures/pgrep.txt
- **exposes:** `chrome_session(pane_pid: u32) -> Option<String>`, `pty_pid(id: PaneId) -> Option<u32>`
- **consumes:** nothing

Issue #73. Only the `// -- chrome` anchor blocks of `lib.rs` if a new command
must be registered there (`chrome_session`); `pty_pid` goes next to the other
`pty_*` commands in `commands.rs`. Calls `store.getState().setSessionId` from
`src/chrome/`; never edits `src/layout/`.

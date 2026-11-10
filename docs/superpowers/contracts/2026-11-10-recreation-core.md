---
feature: recreation-core
created: 2026-11-10
verdict: parallel
---

<!--
  The core wave of the recreation (docs/superpowers/specs/2026-11-10-recreation-core.md):
  what the new front will read, built while the interface is still being chosen. The seam
  is the branch this sits on (redesign/app): it declares the three modules in lib.rs and
  registers the four commands, with the types that are their contract
  (src-tauri/src/insight.rs, src-tauri/src/memory_trail.rs, mirrored in
  src/insight/types.ts), so no piece touches lib.rs or another piece's file.

  The pieces pass the test: each is one module (or one transport and its two users) behind
  commands the front does not call yet, written and tested without reading another's
  interior. A dispatch prompt carries a piece's files and signatures and not this text, so
  each signature names the spec section to read.

  Pull requests target redesign/app, not main.
-->

## insight

- **files:** src-tauri/src/insight.rs, src-tauri/src/insight/, tools/insight/
- **exposes:** `session_insight(asks: Vec<InsightAsk>) -> HashMap<String, Insight> and insight_shot(ask: InsightAsk, id: String) -> Result<String, String>, with the types already in src-tauri/src/insight.rs unchanged, as "Session insight" and "Building" in docs/superpowers/specs/2026-11-10-recreation-core.md require; the pull request targets the branch redesign/app`
- **consumes:** nothing
- **model:** fable
- **effort:** high
- **may:** pr

Everything one transcript says about its session, read incrementally, with the thing that
checks its counters against real transcripts.

## memory-trail

- **files:** src-tauri/src/memory_trail.rs, src-tauri/src/memory_trail/
- **exposes:** `memory_trail(session_ids: Vec<String>) -> HashMap<String, Trail> and vault_pulse(since: Option<u64>) -> VaultPulse, with the types already in src-tauri/src/memory_trail.rs unchanged, as "Memory trail" and "Building" in docs/superpowers/specs/2026-11-10-recreation-core.md require; the pull request targets the branch redesign/app`
- **consumes:** nothing
- **model:** fable
- **effort:** high
- **may:** pr

What mnemo gave each session and what it held back, per session, from the vault's logs.

## win-ipc

- **files:** src-tauri/src/ipc.rs, src-tauri/src/mcp.rs, src-tauri/src/bin/mnemo-desktop-mcp.rs, src-tauri/src/agent_hooks.rs, src-tauri/src/bin/mnemo-desktop-hook.rs, src-tauri/src/pty.rs, src-tauri/Cargo.toml, src-tauri/Cargo.lock, src-tauri/tauri.windows.conf.json, scripts/bundle-helpers.mjs, .github/workflows/ci.yml, src/mcp/, README.md
- **exposes:** `the desktop MCP server and the agent hook events work on Windows as on macOS and Linux, over a transport in src-tauri/src/ipc.rs that the terminal daemon can use next, as "A transport Windows has" and "Building" in docs/superpowers/specs/2026-11-10-recreation-core.md require; the pull request targets the branch redesign/app`
- **consumes:** nothing
- **model:** fable
- **effort:** high
- **may:** pr

One transport and its two users. It is one piece because the MCP server and the hooks would
otherwise each invent the transport.

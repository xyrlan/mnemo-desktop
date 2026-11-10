//! One local transport for the app's helper binaries, on every system
//! (`docs/superpowers/specs/2026-11-10-recreation-core.md`, "A transport Windows has").
//!
//! The desktop MCP server and the agent hooks each reach the running app over a Unix socket,
//! which is why neither works on Windows. This module is where the transport both use will
//! live. It is empty until that piece lands.

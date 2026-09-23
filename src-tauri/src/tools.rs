//! TEMPORARY STAND-IN for the `tool-path` piece of round19, which owns this file and its real
//! `extra_dirs()` (managed tool dirs under `~/.mnemo-desktop/tools/` plus `~/.local/bin`). That
//! piece runs in a parallel worktree and had not landed when `system-path` was written.
//!
//! `system-path` only *consumes* `crate::tools::extra_dirs()`; it does not implement it. This
//! stub exists so this worktree compiles and its own tests run in isolation. Merging this
//! branch with `tool-path`'s will conflict here (both add `src-tauri/src/tools.rs` and a
//! `pub mod tools;` line in `lib.rs`) — keep `tool-path`'s real module and drop this file and
//! its `lib.rs` line.

use std::path::PathBuf;

/// Stub only: returns `~/.local/bin` (`%USERPROFILE%\.local\bin` on Windows), the one directory
/// the real `extra_dirs()` is guaranteed to include per the round19 contract.
pub fn extra_dirs() -> Vec<PathBuf> {
    let home = if cfg!(windows) { std::env::var("USERPROFILE") } else { std::env::var("HOME") }.unwrap_or_default();
    vec![PathBuf::from(home).join(".local").join("bin")]
}

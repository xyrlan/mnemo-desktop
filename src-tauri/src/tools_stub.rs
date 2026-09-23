//! Stand-in for `crate::tools`, which the round 19 piece `tool-path` delivers in `src/tools.rs`.
//! `tools_install.rs` is written against that module; this file only lets it build before the
//! two meet. It is registered as `tools` in `lib.rs`, so once `tool-path` is merged the crate has
//! two modules named `tools` and stops building until this file and its `lib.rs` line go.
//! Nothing here is meant to survive that merge.

use std::path::PathBuf;

/// `~/.mnemo-desktop/tools/<tool>`, as the contract describes `managed_dir`.
pub fn managed_dir(tool: &str) -> PathBuf {
    let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" });
    home.map(PathBuf::from).unwrap_or_default().join(".mnemo-desktop").join("tools").join(tool)
}

/// The real one makes the next `login_path()` read PATH again; the stand-in has nothing cached.
pub fn refresh() {}

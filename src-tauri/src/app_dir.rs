//! Where the app keeps its own state: `~/.mnemo-desktop`, or `~/.mnemo-desktop-dev` for a debug
//! build (issue #168). A `pnpm tauri dev` run beside the installed app, with the same `HOME`,
//! must not restore the installed app's workspace (and with it `claude --resume` every live
//! session), write over it, or take its MCP socket. Everything the app writes as its own —
//! workspace, settings, usage, looked, vault level, marketplace, MCP socket and registration,
//! shell integration — goes through `app_dir`.
//!
//! Downloads the user would not want twice stay under the release dir for both builds (see
//! `shared_dir`): managed tools, whose dir the user's shell rc puts on `PATH`, and voice
//! models. Both land by a rename into place, so two instances never see a half-written one.

use std::path::{Path, PathBuf};

/// The release build's dir name, also the home of the shared downloads.
pub const RELEASE: &str = ".mnemo-desktop";
/// A debug build's own dir name.
pub const DEBUG: &str = ".mnemo-desktop-dev";

/// The dir name for this build.
pub const NAME: &str = if cfg!(debug_assertions) { DEBUG } else { RELEASE };

pub fn home() -> PathBuf {
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from).unwrap_or_default()
}

/// `~/.mnemo-desktop`, or `~/.mnemo-desktop-dev` in a debug build.
pub fn app_dir() -> PathBuf {
    app_dir_in(&home())
}

pub fn app_dir_in(home: &Path) -> PathBuf {
    home.join(NAME)
}

/// `~/.mnemo-desktop` for every build: downloads both builds may share.
pub fn shared_dir_in(home: &Path) -> PathBuf {
    home.join(RELEASE)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_debug_build_keeps_its_own_dir_and_shares_downloads() {
        // `cargo test` builds with debug assertions, like `tauri dev`.
        assert!(cfg!(debug_assertions));
        let home = Path::new("/home/u");
        assert_eq!(app_dir_in(home), Path::new("/home/u/.mnemo-desktop-dev"));
        assert_eq!(shared_dir_in(home), Path::new("/home/u/.mnemo-desktop"));
        assert_ne!(DEBUG, RELEASE);
    }

    #[test]
    fn the_mcp_binary_knows_both_names() {
        // It links nothing of the app, so it spells them out itself.
        let bin = include_str!("bin/mnemo-desktop-mcp.rs");
        assert!(bin.contains(&format!("\"{DEBUG}\"")) && bin.contains(&format!("\"{RELEASE}\"")));
    }
}

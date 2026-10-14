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

use std::ffi::OsString;
use std::path::{Path, PathBuf};

/// The release build's dir name, also the home of the shared downloads.
pub const RELEASE: &str = ".mnemo-desktop";
/// A debug build's own dir name.
pub const DEBUG: &str = ".mnemo-desktop-dev";

/// The dir name for this build.
pub const NAME: &str = if cfg!(debug_assertions) { DEBUG } else { RELEASE };

/// The person's home directory, empty when the system names none. Every `~` the app resolves
/// comes from here (issue #332): `the_home_directory_is_read_in_one_place` fails on a read of
/// `HOME` alone anywhere else.
pub fn home() -> PathBuf {
    home_from(&|name| std::env::var_os(name))
}

/// `home` over an environment the caller hands in. Windows names the home in `USERPROFILE` and
/// sets no `HOME` unless the app was started from a POSIX shell such as Git Bash.
pub fn home_from(env: &dyn Fn(&str) -> Option<OsString>) -> PathBuf {
    env(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).filter(|v| !v.is_empty()).map(PathBuf::from).unwrap_or_default()
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

    /// The environment of an app started from the Start menu: Windows sets `USERPROFILE` and
    /// no `HOME`.
    #[test]
    fn home_is_the_profile_dir_where_no_home_variable_is_set() {
        let profile = crate::testutil::temp_dir("profile");
        let start_menu = |name: &str| (name == "USERPROFILE").then(|| profile.clone().into_os_string());
        let posix = |name: &str| (name == "HOME").then(|| profile.clone().into_os_string());
        if cfg!(windows) {
            assert_eq!(home_from(&start_menu), profile);
            // Git Bash's `HOME` is not what Claude Code itself reads on Windows.
            assert_eq!(home_from(&posix), PathBuf::new());
            // This process, too: whatever `HOME` holds here, the answer is the profile dir.
            assert_eq!(Some(home().into_os_string()), std::env::var_os("USERPROFILE"));
            assert!(home().is_absolute(), "{}", home().display());
        } else {
            assert_eq!(home_from(&posix), profile);
            assert_eq!(home_from(&start_menu), PathBuf::new());
        }
        assert_eq!(home_from(&|_| None), PathBuf::new());
        assert_eq!(home_from(&|_| Some(OsString::new())), PathBuf::new(), "a variable set to nothing names no home");
        let _ = std::fs::remove_dir_all(&profile);
    }

    /// A read of `HOME` that names no `USERPROFILE` beside it finds nothing on Windows. Each
    /// file below holds the reads counted for it and no more; a new one belongs in `home()`.
    #[test]
    fn the_home_directory_is_read_in_one_place() {
        // Tests that put a `HOME` of their own in place and restore it, and Unix-only code.
        let known: &[(&str, usize)] = &[
            ("conversation.rs", 1), // a test that dumps the real ~/.claude/projects
            ("mission.rs", 1),      // `looked_marker_round_trips` saves and restores it
            ("pty.rs", 1),          // tests of the Unix shell integration
            ("tools_path.rs", 1),   // `add_to_path_unix`: the shell rc files, Unix only
        ];
        // Spelled in halves so this file does not count itself.
        let needles = [concat!("var(", "\"HOME\")"), concat!("var_os(", "\"HOME\")")];
        let mut files = Vec::new();
        let mut dirs = vec![Path::new(env!("CARGO_MANIFEST_DIR")).join("src")];
        while let Some(dir) = dirs.pop() {
            for entry in std::fs::read_dir(&dir).unwrap().flatten() {
                let path = entry.path();
                if path.is_dir() {
                    dirs.push(path);
                } else if path.extension().is_some_and(|e| e == "rs") {
                    files.push(path);
                }
            }
        }
        assert!(files.len() > 20, "the walk found the sources: {}", files.len());
        let mut seen = 0;
        for path in files {
            let text = std::fs::read_to_string(&path).unwrap();
            let lines: Vec<&str> = text.lines().collect();
            // The Windows name on the same line or the next is a read of both.
            let alone: Vec<usize> = (0..lines.len())
                .filter(|&i| needles.iter().any(|n| lines[i].replace("remove_var(", "").contains(n)))
                .filter(|&i| !lines[i..(i + 2).min(lines.len())].iter().any(|l| l.contains("USERPROFILE")))
                .map(|i| i + 1)
                .collect();
            let name = path.file_name().unwrap().to_string_lossy().to_string();
            let allowed = known.iter().find(|(f, _)| *f == name).map(|(_, n)| *n).unwrap_or(0);
            assert_eq!(alone.len(), allowed, "{}: lines {alone:?} read HOME alone; use app_dir::home()", path.display());
            seen += alone.len();
        }
        assert_eq!(seen, known.iter().map(|(_, n)| n).sum::<usize>());
    }

    #[test]
    fn the_mcp_binary_knows_both_names() {
        // It links nothing of the app, so it spells them out itself.
        let bin = include_str!("bin/mnemo-desktop-mcp.rs");
        assert!(bin.contains(&format!("\"{DEBUG}\"")) && bin.contains(&format!("\"{RELEASE}\"")));
    }
}

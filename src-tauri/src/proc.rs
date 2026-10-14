//! The one way this app starts a process.
//!
//! On Windows a GUI app that starts a console program (`git`, `gh`, `mnemo`, `claude`, `cmd`)
//! gets a new console window for it: it flashes on screen and takes focus from the app. The
//! app polls those programs, so on Windows the flashing never stopped. `CREATE_NO_WINDOW`
//! runs the child with a console that is never shown, and whatever the child starts in turn
//! inherits that hidden console instead of opening its own. It changes nothing for a GUI
//! program (a browser), and nothing at all off Windows.
//!
//! Every `Command` in `src/` comes from here; the test below fails on a `Command::new`
//! anywhere else, so a new call site cannot bring the flashing back.
//!
//! It is also where `git` is told to take no optional lock (#340). The app polls `git status`
//! in every worktree, and a plain `git status` that meets stale stat data rewrites
//! `.git/index` under `index.lock`: a `git add` or `git commit` by the person or an agent in
//! that window fails with "Unable to create '…/index.lock': File exists". With
//! `GIT_OPTIONAL_LOCKS=0` git skips that refresh and nothing else: a command that has to write
//! (`add`, `commit`, `worktree add`) takes its lock as before. Set here and not per caller, so
//! the same test keeps a new `git` call from polling without it. A terminal's shell is not
//! started here, and the person's own `git` there is untouched.
//!
//! And it is where a tool is found on Windows (#356). Rust's std looks up a bare name as
//! `<name>.exe` only, so `claude.cmd` and `mnemo.cmd` — what `npm i -g` installs — were never
//! started, though Setup, which resolves through `PATHEXT`, reported them found. `tool` starts
//! a program on a given PATH and resolves its name there the way Setup does, `.cmd` and `.bat`
//! included; std runs a batch file through `cmd.exe` with its arguments escaped for it.

use std::ffi::OsStr;
use std::path::Path;
use std::process::Command;

/// `CREATE_NO_WINDOW`, from `winbase.h`.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// `Command::new(program)`, with no console window on Windows.
pub fn command(program: impl AsRef<OsStr>) -> Command {
    let is_git = is_git(program.as_ref());
    let mut cmd = Command::new(program);
    if is_git {
        cmd.env("GIT_OPTIONAL_LOCKS", "0");
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// `program` started with `PATH` set to `path`, and looked up there as Setup looks it up
/// (`tools::Lookup`): on Windows a bare name is `<name>.exe`, `.cmd` or `.bat`, in `PATHEXT`
/// order. A name found nowhere on `path` is left to std, so it fails as "not found" as before.
/// Elsewhere it is `command(program).env("PATH", path)`.
pub fn tool(program: impl AsRef<OsStr>, path: &str) -> Command {
    let mut cmd = command(resolve(program.as_ref(), path, &crate::tools::Lookup::native()));
    cmd.env("PATH", path);
    cmd
}

/// The file `lookup` finds for a bare `program` on `path`; anything else unchanged. Only a
/// Windows lookup resolves: on Unix std's own search is the same one.
fn resolve(program: &OsStr, path: &str, lookup: &crate::tools::Lookup) -> std::ffi::OsString {
    let bare = Path::new(program).components().count() == 1 && !program.to_string_lossy().contains(['/', '\\', ':']);
    match program.to_str() {
        Some(name) if bare && lookup.is_windows() => lookup.find(name, path).map_or_else(|| program.to_owned(), |f| f.into_os_string()),
        _ => program.to_owned(),
    }
}

/// `git`, `git.exe` or a path to either.
fn is_git(program: &OsStr) -> bool {
    Path::new(program).file_stem().map_or(false, |s| s.eq_ignore_ascii_case("git"))
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    fn rust_files(dir: &Path, out: &mut Vec<PathBuf>) {
        for entry in std::fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                rust_files(&path, out);
            } else if path.extension().map_or(false, |e| e == "rs") {
                out.push(path);
            }
        }
    }

    #[test]
    fn every_process_is_started_through_command() {
        let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut files = Vec::new();
        rust_files(&src, &mut files);
        let offenders: Vec<String> = files
            .iter()
            .filter(|f| f.file_name().map_or(true, |n| n != "proc.rs"))
            .flat_map(|f| {
                let text = std::fs::read_to_string(f).unwrap();
                let rel = f.strip_prefix(&src).unwrap().display().to_string();
                text.lines()
                    .enumerate()
                    .filter(|(_, l)| l.contains("Command::new("))
                    .map(|(i, _)| format!("{rel}:{}", i + 1))
                    .collect::<Vec<_>>()
            })
            .collect();
        assert!(
            offenders.is_empty(),
            "start processes with crate::proc::command, or Windows opens a console window for each: {offenders:?}"
        );
    }

    #[test]
    fn a_tool_is_started_on_the_path_it_is_given() {
        // `.env("PATH", …)` beside `command` would start a bare name std's way: `.exe` only.
        let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut files = Vec::new();
        rust_files(&src, &mut files);
        let offenders: Vec<String> = files
            .iter()
            // A pane's shell is a pty `CommandBuilder`, not a `Command`.
            .filter(|f| f.file_name().map_or(true, |n| n != "proc.rs" && n != "pty.rs"))
            .flat_map(|f| {
                let text = std::fs::read_to_string(f).unwrap();
                let rel = f.strip_prefix(&src).unwrap().display().to_string();
                text.lines()
                    .enumerate()
                    .filter(|(_, l)| l.contains(".env(\"PATH\""))
                    .map(|(i, _)| format!("{rel}:{}", i + 1))
                    .collect::<Vec<_>>()
            })
            .collect();
        assert!(offenders.is_empty(), "start a program on a PATH with crate::proc::tool, or Windows misses its .cmd: {offenders:?}");
    }

    #[test]
    fn a_bare_name_resolves_through_pathext_on_windows_only() {
        use crate::tools::Lookup;
        use std::ffi::OsStr;
        let dir = crate::testutil::temp_dir("proc-resolve");
        // What `npm i -g` leaves: a POSIX script beside the batch file cmd.exe runs.
        std::fs::write(dir.join("standin"), "#!/bin/sh\n").unwrap();
        std::fs::write(dir.join("standin.cmd"), "@echo off\n").unwrap();
        let path = dir.to_string_lossy().to_string();
        let win = Lookup::windows(Some(".COM;.EXE;.BAT;.CMD"));
        let resolve = |p: &str, l: &Lookup| super::resolve(OsStr::new(p), &path, l);
        assert_eq!(resolve("standin", &win), dir.join("standin.cmd").into_os_string());
        assert_eq!(resolve("absent", &win), "absent", "not found is left to std, which says so");
        for named in [r"C:\tools\standin", "./standin", "C:standin"] {
            assert_eq!(resolve(named, &win), named, "a path is started as written");
        }
        assert_eq!(resolve("standin", &Lookup::unix()), "standin", "std's own search on Unix");
    }

    /// The defect on the machine it lives on (#356): a tool that is only a `.cmd` shim, as an
    /// npm install leaves `claude` and `mnemo`, started through the app's own call path.
    #[cfg(windows)]
    #[test]
    fn a_cmd_shim_on_path_is_started_by_its_bare_name() {
        let dir = crate::testutil::temp_dir("proc-cmd-shim");
        std::fs::write(dir.join("standin.cmd"), "@echo off\r\necho standin ran %*\r\n").unwrap();
        let path = format!("{};{}", dir.display(), std::env::var("PATH").unwrap_or_default());

        let std_alone = super::command("standin").env("PATH", &path).output();
        assert_eq!(std_alone.map(|_| ()).unwrap_err().kind(), std::io::ErrorKind::NotFound, "std looks for standin.exe only");

        let out = super::tool("standin", &path).args(["one", "two words"]).output().unwrap();
        assert!(out.status.success(), "{out:?}");
        assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), "standin ran one \"two words\"");

        let cwd = dir.to_string_lossy().to_string();
        let ran = crate::install_review::exec("standin", &path, &["--version".to_string()], &cwd, None);
        assert_eq!((ran.code, ran.stdout.trim()), (Some(0), "standin ran --version"), "{}", ran.stderr);

        let missing = crate::install_review::exec("absent-standin", &path, &[], &cwd, None);
        assert_eq!(missing.code, None);
        assert!(missing.stderr.starts_with("absent-standin: "), "{}", missing.stderr);
        let err = super::tool("absent-standin", &path).output().map(|_| ()).unwrap_err();
        assert_eq!(err.kind(), std::io::ErrorKind::NotFound);
    }

    #[test]
    fn the_command_runs_the_program_it_names() {
        let out = super::command("git").arg("--version").output().unwrap();
        assert!(out.status.success());
        assert!(String::from_utf8_lossy(&out.stdout).starts_with("git version"));
    }

    #[test]
    fn git_is_started_with_no_optional_locks_and_nothing_else_is() {
        let locks = |program: &str| {
            let cmd = super::command(program);
            let set = cmd.get_envs().find(|(k, _)| *k == "GIT_OPTIONAL_LOCKS").map(|(_, v)| v.map(|v| v.to_string_lossy().to_string()));
            set.flatten()
        };
        for git in ["git", "git.exe", "GIT.EXE", "/usr/bin/git", r"C:\Program Files\Git\cmd\git.exe"] {
            if cfg!(not(windows)) && git.contains('\\') {
                continue;
            }
            assert_eq!(locks(git).as_deref(), Some("0"), "{git}");
        }
        for other in ["gh", "mnemo", "claude", "sh", "git-lfs", "/opt/git/bin/gh"] {
            assert_eq!(locks(other), None, "{other}");
        }
    }
}

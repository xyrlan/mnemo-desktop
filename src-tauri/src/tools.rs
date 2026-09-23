//! Where the app finds `git`, `gh`, `claude` and `mnemo`.
//!
//! Every call to one of them resolves through `mission::login_path()`, and every terminal pane
//! gets `pane_path`. Both carry `extra_dirs()`: the directories the app installs tools into
//! (`managed_dir`) and `~/.local/bin`, where Claude Code's native installer puts `claude` on
//! every OS. So a tool the app or that installer put in place is found with nothing on the
//! system `PATH`, and without a restart. `system-path` writes the same list to the user's own
//! `PATH`, so the two cannot drift.
//!
//! Most of this is Windows behaviour CI only half sees, so it is kept in pure functions over
//! strings and paths with the separator passed in: the Windows cases run on every OS.

use serde::Serialize;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

/// The tools the setup screen reports, in its order.
pub const TOOLS: [&str; 4] = ["git", "gh", "claude", "mnemo"];

/// Tools the app installs itself, each into its own `managed_dir`.
const MANAGED: [&str; 1] = ["mnemo"];

/// How long `--version` may take before a tool counts as found but not answering.
const VERSION_TIMEOUT: Duration = Duration::from_secs(10);

fn home() -> PathBuf {
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from).unwrap_or_default()
}

/// The directory the app owns for `tool`, under `~/.mnemo-desktop/tools/`. An installed tool's
/// executable sits directly inside it.
pub fn managed_dir(tool: &str) -> PathBuf {
    managed_dir_in(&home(), tool)
}

fn managed_dir_in(home: &Path, tool: &str) -> PathBuf {
    // Shared by a debug build: the user's shell rc puts this dir on PATH.
    crate::app_dir::shared_dir_in(home).join("tools").join(tool)
}

/// Every directory the app puts on `PATH` beyond what the system gives it: the managed dirs,
/// then `~/.local/bin`. Whether they exist yet or not: a pane opened before an install must
/// find the tool once the install is done.
pub fn extra_dirs() -> Vec<PathBuf> {
    extra_dirs_in(&home())
}

fn extra_dirs_in(home: &Path) -> Vec<PathBuf> {
    // No home: a relative entry would resolve against whatever cwd a child starts in.
    if !home.is_absolute() {
        return Vec::new();
    }
    MANAGED.iter().map(|t| managed_dir_in(home, t)).chain([home.join(".local").join("bin")]).collect()
}

/// Forget the cached `login_path()`, so the next call reads PATH again: after an install, or
/// when the user asks to check again.
pub fn refresh() {
    crate::mission::forget_login_path();
}

/// This platform's `PATH` separator.
pub fn separator() -> char {
    if cfg!(windows) {
        ';'
    } else {
        ':'
    }
}

/// `parts` joined with `sep`, empties and repeats dropped, first occurrence kept. Windows paths
/// compare without case, as the file system does.
pub fn join_unique(sep: char, parts: impl IntoIterator<Item = String>) -> String {
    let mut out: Vec<String> = Vec::new();
    for p in parts {
        let same = |q: &String| if sep == ';' { q.eq_ignore_ascii_case(&p) } else { *q == p };
        if !p.is_empty() && !out.iter().any(same) {
            out.push(p);
        }
    }
    out.join(&sep.to_string())
}

/// `path` with `extra_dirs()` on it.
pub fn with_extra_dirs(path: &str, sep: char) -> String {
    add_dirs(path, sep, &extra_dirs())
}

/// The managed dirs go before everything, so the copy the app installed is the one that runs
/// after the user clicked install; the rest go after, where they only fill a gap.
fn add_dirs(path: &str, sep: char, extra: &[PathBuf]) -> String {
    let (first, last) = extra.split_at(MANAGED.len().min(extra.len()));
    let s = |p: &PathBuf| p.to_string_lossy().into_owned();
    join_unique(sep, first.iter().map(s).chain(path.split(sep).map(String::from)).chain(last.iter().map(s)))
}

/// The `PATH` a terminal pane starts with. On Windows that is what a newly opened terminal
/// would get, read now; elsewhere the pane runs a login shell that builds its own, so it only
/// needs the app's dirs added to what the app inherited.
pub fn pane_path() -> String {
    if cfg!(windows) {
        crate::mission::read_login_path()
    } else {
        with_extra_dirs(&std::env::var("PATH").unwrap_or_default(), separator())
    }
}

// ------------------------------------------------------------- windows PATH --

/// `%NAME%` references replaced by `lookup(NAME)`, as Windows expands a `REG_EXPAND_SZ` value.
/// An unknown name, or a lone `%`, is left as written.
pub fn expand_vars(s: &str, lookup: impl Fn(&str) -> Option<String>) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(start) = rest.find('%') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        match after.find('%') {
            Some(end) if end > 0 => match lookup(&after[..end]) {
                Some(v) => {
                    out.push_str(&v);
                    rest = &after[end + 1..];
                }
                None => {
                    // Keep `%NAME` and look again from the closing `%`, as Windows does.
                    out.push('%');
                    out.push_str(&after[..end]);
                    rest = &after[end..];
                }
            },
            _ => {
                out.push('%');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

/// The `PATH` a newly opened Windows terminal gets: the machine `Path`, then the user's, each
/// expanded. Either may be missing.
pub fn windows_path(machine: Option<&str>, user: Option<&str>, lookup: impl Fn(&str) -> Option<String>) -> String {
    [machine, user].into_iter().flatten().map(|v| expand_vars(v, &lookup)).filter(|v| !v.is_empty()).collect::<Vec<_>>().join(";")
}

/// The machine and user `Path` as stored in the registry now, not as the app inherited them at
/// launch: a tool installed since then is on it. `None` off Windows.
pub fn system_path() -> Option<String> {
    #[cfg(windows)]
    {
        let machine = registry::path(registry::HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment");
        let user = registry::path(registry::HKEY_CURRENT_USER, "Environment");
        if machine.is_none() && user.is_none() {
            return None;
        }
        Some(windows_path(machine.as_deref(), user.as_deref(), |n| std::env::var(n).ok()))
    }
    #[cfg(not(windows))]
    None
}

#[cfg(windows)]
mod registry {
    //! `RegGetValueW` from advapi32, which every Windows links: the app adds no crate for one call.

    use std::ffi::c_void;

    pub const HKEY_CURRENT_USER: isize = 0x8000_0001u32 as i32 as isize;
    pub const HKEY_LOCAL_MACHINE: isize = 0x8000_0002u32 as i32 as isize;
    const RRF_RT_REG_SZ: u32 = 0x0000_0002;
    const RRF_RT_REG_EXPAND_SZ: u32 = 0x0000_0004;
    /// Hand back `%VAR%` as stored; `expand_vars` expands it.
    const RRF_NOEXPAND: u32 = 0x1000_0000;
    const ERROR_SUCCESS: i32 = 0;
    const ERROR_MORE_DATA: i32 = 234;

    #[link(name = "advapi32")]
    extern "system" {
        fn RegGetValueW(
            hkey: isize,
            sub_key: *const u16,
            value: *const u16,
            flags: u32,
            kind: *mut u32,
            data: *mut c_void,
            len: *mut u32,
        ) -> i32;
    }

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain([0]).collect()
    }

    /// The `Path` value under `root\sub_key`, or `None` when it is missing or unreadable.
    pub fn path(root: isize, sub_key: &str) -> Option<String> {
        let (key, name) = (wide(sub_key), wide("Path"));
        let flags = RRF_RT_REG_SZ | RRF_RT_REG_EXPAND_SZ | RRF_NOEXPAND;
        // The value can grow between the size query and the read; ask again when it did.
        for _ in 0..4 {
            let mut len: u32 = 0;
            let rc = unsafe {
                RegGetValueW(root, key.as_ptr(), name.as_ptr(), flags, std::ptr::null_mut(), std::ptr::null_mut(), &mut len)
            };
            if rc != ERROR_SUCCESS {
                return None;
            }
            let mut buf = vec![0u16; (len as usize).div_ceil(2) + 1];
            let mut len = (buf.len() * 2) as u32;
            let rc = unsafe {
                RegGetValueW(root, key.as_ptr(), name.as_ptr(), flags, std::ptr::null_mut(), buf.as_mut_ptr().cast(), &mut len)
            };
            match rc {
                ERROR_SUCCESS => {
                    buf.truncate(len as usize / 2);
                    while buf.last() == Some(&0) {
                        buf.pop();
                    }
                    return Some(String::from_utf16_lossy(&buf));
                }
                ERROR_MORE_DATA => continue,
                _ => return None,
            }
        }
        None
    }
}

// ------------------------------------------------------------------ lookup --

/// How a platform turns a bare program name into a file.
#[derive(Debug, Clone)]
pub struct Lookup {
    sep: char,
    /// Windows' `PATHEXT`, lowercased: `claude` is `claude.exe` or `claude.cmd`, never the
    /// extensionless shell script npm puts next to them. Empty elsewhere.
    exts: Vec<String>,
}

impl Lookup {
    pub fn unix() -> Self {
        Self { sep: ':', exts: Vec::new() }
    }

    pub fn windows(pathext: Option<&str>) -> Self {
        let exts = pathext
            .filter(|p| !p.trim().is_empty())
            .unwrap_or(".COM;.EXE;.BAT;.CMD")
            .split(';')
            .map(|e| e.trim().to_ascii_lowercase())
            .filter(|e| e.starts_with('.'))
            .collect();
        Self { sep: ';', exts }
    }

    pub fn native() -> Self {
        if cfg!(windows) {
            Self::windows(std::env::var("PATHEXT").ok().as_deref())
        } else {
            Self::unix()
        }
    }

    /// The first executable called `name` in `path`, as an absolute path.
    pub fn find(&self, name: &str, path: &str) -> Option<PathBuf> {
        let names: Vec<String> =
            if self.exts.is_empty() { vec![name.to_string()] } else { self.exts.iter().map(|e| format!("{name}{e}")).collect() };
        path.split(self.sep)
            .map(|d| d.trim().trim_matches('"'))
            .filter(|d| !d.is_empty() && Path::new(d).is_absolute())
            .flat_map(|d| names.iter().map(move |n| Path::new(d).join(n)))
            .find(|p| self.runnable(p))
    }

    fn runnable(&self, p: &Path) -> bool {
        if !p.is_file() {
            return false;
        }
        #[cfg(unix)]
        if self.exts.is_empty() {
            use std::os::unix::fs::PermissionsExt;
            return p.metadata().is_ok_and(|m| m.permissions().mode() & 0o111 != 0);
        }
        true
    }
}

// ------------------------------------------------------------------ status --

/// One row of the setup screen.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ToolStatus {
    pub name: &'static str,
    /// The executable `login_path()` resolves the name to.
    pub path: Option<String>,
    /// The first line of `--version`; `None` when it failed or did not answer.
    pub version: Option<String>,
    /// The executable is in the app's `managed_dir` for this tool.
    pub managed: bool,
}

/// The first non-empty line of `out`, trimmed.
pub fn first_line(out: &str) -> Option<String> {
    out.lines().map(str::trim).find(|l| !l.is_empty()).map(String::from)
}

/// `path` is `dir` or inside it, comparing real paths when both exist.
fn is_under(path: &Path, dir: &Path) -> bool {
    let real = |p: &Path| p.canonicalize().unwrap_or_else(|_| p.to_path_buf());
    path.starts_with(dir) || real(path).starts_with(real(dir))
}

/// `exe --version` with `PATH` set to `path_env`, its first line when it exits 0 within
/// `timeout`. A tool that hangs is killed rather than holding up the setup screen.
fn version_of(exe: &Path, path_env: &str, timeout: Duration) -> Option<String> {
    let mut child = crate::proc::command(exe)
        .arg("--version")
        .env("PATH", path_env)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .ok()?;
    let mut stdout = child.stdout.take()?;
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut s = String::new();
        let _ = stdout.read_to_string(&mut s);
        let _ = tx.send(s);
    });
    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(s)) => break s,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(20)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    };
    // A process it left behind can hold stdout open; do not wait on it past the deadline.
    let out = rx.recv_timeout(deadline.saturating_duration_since(Instant::now()).max(Duration::from_millis(200))).ok()?;
    status.success().then(|| first_line(&out)).flatten()
}

fn status_of(name: &'static str, path_env: &str, lookup: &Lookup, managed: &Path, timeout: Duration) -> ToolStatus {
    let found = lookup.find(name, path_env);
    ToolStatus {
        name,
        version: found.as_deref().and_then(|p| version_of(p, path_env, timeout)),
        managed: found.as_deref().is_some_and(|p| is_under(p, managed)),
        path: found.map(|p| p.to_string_lossy().into_owned()),
    }
}

/// One row per tool in `TOOLS`, read from a fresh `login_path()`. The four `--version` calls
/// run side by side.
pub fn read_status() -> Vec<ToolStatus> {
    refresh();
    let path = crate::mission::login_path();
    let lookup = Lookup::native();
    std::thread::scope(|s| {
        let rows: Vec<_> = TOOLS
            .iter()
            .map(|&t| (t, s.spawn(|| status_of(t, &path, &lookup, &managed_dir(t), VERSION_TIMEOUT))))
            .collect();
        rows.into_iter()
            .map(|(name, h)| h.join().unwrap_or(ToolStatus { name, path: None, version: None, managed: false }))
            .collect()
    })
}

/// Which of `git`, `gh`, `claude` and `mnemo` the app finds, where, and at what version. Reads
/// PATH again on every call, so "check again" after an install in a pane shows the new tool.
#[tauri::command]
pub async fn tools_status() -> Vec<ToolStatus> {
    tauri::async_runtime::spawn_blocking(read_status).await.unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::temp_dir;

    /// Held by the tests that refresh, so one's refresh cannot pass for another's.
    static REFRESHING: std::sync::Mutex<()> = std::sync::Mutex::new(());

    fn refreshing() -> std::sync::MutexGuard<'static, ()> {
        REFRESHING.lock().unwrap_or_else(|e| e.into_inner())
    }

    #[test]
    fn managed_dirs_live_under_the_apps_tools_dir() {
        let home = Path::new("/home/u");
        assert_eq!(managed_dir_in(home, "mnemo"), Path::new("/home/u/.mnemo-desktop/tools/mnemo"));
        assert!(managed_dir("mnemo").ends_with(Path::new(".mnemo-desktop").join("tools").join("mnemo")));
    }

    #[test]
    fn extra_dirs_are_the_managed_dirs_then_the_claude_installers_bin() {
        // Absolute on this OS: `/home/u` has no drive letter, so Windows would call it relative.
        let home = std::env::temp_dir().join("u");
        assert_eq!(
            extra_dirs_in(&home),
            vec![home.join(".mnemo-desktop").join("tools").join("mnemo"), home.join(".local").join("bin")]
        );
        assert!(extra_dirs_in(Path::new("")).is_empty(), "no home, no relative PATH entries");
        assert_eq!(extra_dirs().first(), Some(&managed_dir("mnemo")));
    }

    #[test]
    fn extra_dirs_go_on_the_path_managed_first_and_the_rest_last() {
        let extra = [PathBuf::from("/h/.mnemo-desktop/tools/mnemo"), PathBuf::from("/h/.local/bin")];
        assert_eq!(add_dirs("/usr/bin:/bin", ':', &extra), "/h/.mnemo-desktop/tools/mnemo:/usr/bin:/bin:/h/.local/bin");
        // Already there: kept where the user put it, not repeated.
        assert_eq!(add_dirs("/h/.local/bin:/usr/bin", ':', &extra), "/h/.mnemo-desktop/tools/mnemo:/h/.local/bin:/usr/bin");
        assert_eq!(add_dirs("", ':', &extra), "/h/.mnemo-desktop/tools/mnemo:/h/.local/bin");
    }

    #[test]
    fn windows_paths_join_on_semicolons_and_keep_drive_letters_whole() {
        let extra = [PathBuf::from(r"C:\Users\u\.mnemo-desktop\tools\mnemo"), PathBuf::from(r"C:\Users\u\.local\bin")];
        assert_eq!(
            add_dirs(r"C:\Windows\system32;C:\Program Files\Git\cmd", ';', &extra),
            r"C:\Users\u\.mnemo-desktop\tools\mnemo;C:\Windows\system32;C:\Program Files\Git\cmd;C:\Users\u\.local\bin"
        );
        // Windows compares paths without case.
        assert_eq!(add_dirs(r"c:\users\U\.LOCAL\bin", ';', &extra), r"C:\Users\u\.mnemo-desktop\tools\mnemo;c:\users\U\.LOCAL\bin");
        assert_eq!(join_unique(':', ["/A".into(), "/a".into()]), "/A:/a", "POSIX paths keep their case");
    }

    #[test]
    fn with_extra_dirs_uses_the_real_extra_dirs() {
        let p = with_extra_dirs("/usr/bin", separator());
        for d in extra_dirs() {
            assert!(p.split(separator()).any(|x| Path::new(x) == d), "{} missing from {p}", d.display());
        }
    }

    #[test]
    fn a_pane_gets_every_extra_dir() {
        let p = pane_path();
        for d in extra_dirs() {
            assert!(p.split(separator()).any(|x| Path::new(x) == d), "{} missing from {p}", d.display());
        }
    }

    #[test]
    fn registry_values_expand_like_windows_does() {
        let env = |n: &str| match n.to_ascii_uppercase().as_str() {
            "USERPROFILE" => Some(r"C:\Users\u".to_string()),
            "SYSTEMROOT" => Some(r"C:\Windows".to_string()),
            _ => None,
        };
        assert_eq!(expand_vars(r"%USERPROFILE%\.local\bin", env), r"C:\Users\u\.local\bin");
        assert_eq!(expand_vars(r"%SystemRoot%\system32;%SYSTEMROOT%", env), r"C:\Windows\system32;C:\Windows");
        assert_eq!(expand_vars(r"%NOPE%\bin", env), r"%NOPE%\bin", "unknown names stay as written");
        assert_eq!(expand_vars(r"50%;%USERPROFILE%", env), r"50%;C:\Users\u", "an unknown %…% leaves its closing % to start the next");
        assert_eq!(expand_vars("100%", env), "100%");
        assert_eq!(expand_vars("%%", env), "%%");
        assert_eq!(expand_vars("C:\\Program Files\\Ünï", env), "C:\\Program Files\\Ünï");
    }

    #[test]
    fn a_new_windows_terminal_gets_the_machine_path_then_the_users() {
        let env = |n: &str| (n == "USERPROFILE").then(|| r"C:\Users\u".to_string());
        let long = format!(r"C:\{}", "x".repeat(2000));
        let user = format!(r"%USERPROFILE%\.local\bin;{long}");
        assert_eq!(
            windows_path(Some(r"C:\Windows\system32"), Some(&user), env),
            format!(r"C:\Windows\system32;C:\Users\u\.local\bin;{long}")
        );
        assert_eq!(windows_path(Some(r"C:\Windows"), None, env), r"C:\Windows");
        assert_eq!(windows_path(None, Some(""), env), "");
    }

    #[cfg(not(windows))]
    #[test]
    fn only_windows_reads_the_registry() {
        assert_eq!(system_path(), None);
    }

    #[test]
    fn windows_lookup_resolves_exe_and_cmd_and_skips_the_bare_script() {
        let dir = temp_dir("tools-win");
        let (a, b) = (dir.join("a"), dir.join("b"));
        std::fs::create_dir_all(&a).unwrap();
        std::fs::create_dir_all(&b).unwrap();
        // npm's global dir: a POSIX script beside the batch file cmd.exe runs.
        std::fs::write(a.join("claude"), "#!/bin/sh\n").unwrap();
        std::fs::write(a.join("claude.cmd"), "@echo off\n").unwrap();
        std::fs::write(b.join("mnemo.exe"), "MZ").unwrap();
        std::fs::write(b.join("git.cmd"), "").unwrap();
        std::fs::write(b.join("git.exe"), "MZ").unwrap();
        let path = format!("{};\"{}\"", a.display(), b.display());
        let win = Lookup::windows(Some(".COM;.EXE;.BAT;.CMD;.VBS"));
        assert_eq!(win.find("claude", &path), Some(a.join("claude.cmd")));
        assert_eq!(win.find("mnemo", &path), Some(b.join("mnemo.exe")), "a quoted entry is still searched");
        assert_eq!(win.find("git", &path), Some(b.join("git.exe")), ".exe before .cmd, in PATHEXT order");
        assert_eq!(win.find("gh", &path), None);
        assert_eq!(Lookup::windows(None).exts, [".com", ".exe", ".bat", ".cmd"]);
        // A relative entry would resolve against the cwd a child happens to start in; cargo
        // runs tests in the crate root, where `src/lib.rs` is.
        let rs = Lookup::windows(Some(".rs"));
        assert_eq!(rs.find("lib", "src"), None);
        let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        assert_eq!(rs.find("lib", &src.to_string_lossy()), Some(src.join("lib.rs")));
        assert_eq!(Lookup::windows(Some("")).exts, [".com", ".exe", ".bat", ".cmd"]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn unix_lookup_takes_the_first_executable_and_ignores_relative_entries() {
        use std::os::unix::fs::PermissionsExt;
        let dir = temp_dir("tools-unix");
        let (a, b) = (dir.join("a"), dir.join("b"));
        std::fs::create_dir_all(&a).unwrap();
        std::fs::create_dir_all(&b).unwrap();
        std::fs::write(a.join("gh"), "not executable").unwrap();
        std::fs::write(b.join("gh"), "#!/bin/sh\n").unwrap();
        std::fs::set_permissions(b.join("gh"), std::fs::Permissions::from_mode(0o755)).unwrap();
        std::fs::create_dir_all(b.join("git")).unwrap();
        let path = format!("{}:{}:relative/bin", a.display(), b.display());
        assert_eq!(Lookup::unix().find("gh", &path), Some(b.join("gh")));
        assert_eq!(Lookup::unix().find("git", &path), None, "a directory is not a program");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn version_is_the_first_non_empty_line() {
        assert_eq!(first_line("\n  claude 2.1.0 (Claude Code)\nmore\n").as_deref(), Some("claude 2.1.0 (Claude Code)"));
        assert_eq!(first_line("\r\n\r\n"), None);
    }

    #[cfg(unix)]
    #[test]
    fn a_managed_tool_is_found_versioned_and_marked_managed() {
        let home = temp_dir("tools-status");
        let managed = managed_dir_in(&home, "mnemo");
        std::fs::create_dir_all(&managed).unwrap();
        crate::testutil::write_script(&managed.join("mnemo"), "#!/bin/sh\necho\necho 'mnemo 1.6.0'\necho second\n");
        let path = add_dirs("/usr/bin:/bin", ':', &extra_dirs_in(&home));
        let row = status_of("mnemo", &path, &Lookup::unix(), &managed, VERSION_TIMEOUT);
        assert_eq!(
            row,
            ToolStatus {
                name: "mnemo",
                path: Some(managed.join("mnemo").to_string_lossy().into_owned()),
                version: Some("mnemo 1.6.0".into()),
                managed: true,
            }
        );
        let git = status_of("git", &path, &Lookup::unix(), &managed_dir_in(&home, "git"), VERSION_TIMEOUT);
        assert!(git.path.is_some() && !git.managed, "{git:?}");
        assert!(git.version.as_deref().is_some_and(|v| v.starts_with("git version")), "{git:?}");
        let _ = std::fs::remove_dir_all(&home);
    }

    #[cfg(unix)]
    #[test]
    fn a_tool_that_fails_or_hangs_is_found_without_a_version() {
        let dir = temp_dir("tools-broken");
        crate::testutil::write_script(&dir.join("mnemo"), "#!/bin/sh\necho 'mnemo 1.6.0'\nexit 3\n");
        crate::testutil::write_script(&dir.join("claude"), "#!/bin/sh\nexec /bin/sleep 30\n");
        let path = dir.to_string_lossy().into_owned();
        let broken = status_of("mnemo", &path, &Lookup::unix(), &dir, VERSION_TIMEOUT);
        assert!(broken.path.is_some() && broken.version.is_none(), "{broken:?}");
        let started = Instant::now();
        let hung = status_of("claude", &path, &Lookup::unix(), &dir, Duration::from_millis(300));
        assert!(hung.path.is_some() && hung.version.is_none(), "{hung:?}");
        assert!(started.elapsed() < Duration::from_secs(5), "waited {:?}", started.elapsed());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn status_has_one_row_per_tool_in_order() {
        let _serial = refreshing();
        let rows = read_status();
        assert_eq!(rows.iter().map(|r| r.name).collect::<Vec<_>>(), TOOLS);
        let git = &rows[0];
        assert!(git.path.as_deref().is_some_and(|p| Path::new(p).is_absolute()), "{git:?}");
        assert!(git.version.as_deref().is_some_and(|v| v.starts_with("git version")), "{git:?}");
    }

    #[test]
    fn a_row_serialises_as_the_setup_screen_reads_it() {
        let row = ToolStatus { name: "claude", path: None, version: None, managed: false };
        assert_eq!(
            serde_json::to_value(&row).unwrap(),
            serde_json::json!({ "name": "claude", "path": null, "version": null, "managed": false })
        );
    }

    #[test]
    fn refresh_keeps_the_same_path_on_an_unchanged_machine() {
        let _serial = refreshing();
        let before = crate::mission::login_path();
        refresh();
        assert_eq!(crate::mission::login_path(), before);
    }

    #[test]
    fn refresh_and_every_status_read_path_again() {
        use crate::mission::{login_path, LOGIN_PATH_READS};
        use std::sync::atomic::Ordering::SeqCst;
        let _serial = refreshing();
        login_path();
        let n = LOGIN_PATH_READS.load(SeqCst);
        refresh();
        login_path();
        assert!(LOGIN_PATH_READS.load(SeqCst) > n, "refresh left the cached PATH in place");
        login_path();
        let n = LOGIN_PATH_READS.load(SeqCst);
        read_status();
        assert!(LOGIN_PATH_READS.load(SeqCst) > n, "tools_status answered from a stale PATH");
    }

    #[test]
    fn tools_status_is_registered() {
        let lib = std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("src/lib.rs")).unwrap();
        assert!(lib.contains("tools::tools_status,"), "tools_status is missing from generate_handler!");
    }
}

//! PTY ownership. No Tauri types here so `cargo test` covers it directly.

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

pub type PaneId = u32;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Event {
    Output(Vec<u8>),
    Exit(Option<i32>),
}

pub type Sink = Box<dyn Fn(Event) + Send + Sync + 'static>;

pub struct SpawnOptions {
    /// `None` = the user's default shell.
    pub program: Option<String>,
    pub args: Vec<String>,
    /// `None`, or a path that is not a directory, starts in the home directory.
    pub cwd: Option<String>,
    pub cols: u16,
    pub rows: u16,
    /// Add `-l` on POSIX so the login profile loads.
    pub login: bool,
}

struct Handle {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

#[derive(Default)]
pub struct PtyManager {
    next: AtomicU32,
    handles: Arc<Mutex<HashMap<PaneId, Handle>>>,
    /// Where the shell integration rc files are written; `None` turns integration off.
    shell_dir: Option<PathBuf>,
}

/// Bootstrap rc files that make zsh and bash report their cwd with OSC 7 at each prompt, so a
/// new pane can open where the focused one is. macOS zsh only does that for Apple Terminal.
/// fish reports it on its own. Written under `shell_dir` as `zsh/<name>` and `bash/mnemo.bashrc`.
const ZSH_RC: [(&str, &str); 4] = [
    (".zshenv", include_str!("../shell/zsh/.zshenv")),
    (".zprofile", include_str!("../shell/zsh/.zprofile")),
    (".zshrc", include_str!("../shell/zsh/.zshrc")),
    (".zlogin", include_str!("../shell/zsh/.zlogin")),
];
const BASH_RC: &str = include_str!("../shell/bash/mnemo.bashrc");

/// What a Claude Code session exports to the processes it runs. An app started from one (a
/// `tauri dev` an agent launched) would hand them to every pane, and a `claude` typed there
/// would take itself for that session's child: no transcript, no `claude agents` row, nothing
/// to resume.
const CLAUDE_SESSION_ENV: &[&str] = &[
    "CLAUDECODE",
    "CLAUDE_CODE_CHILD_SESSION",
    "CLAUDE_CODE_SESSION_ID",
    "CLAUDE_CODE_SESSION_ATTENDED",
    "CLAUDE_CODE_ENTRYPOINT",
    "CLAUDE_CODE_MESSAGING_SOCKET",
    "CLAUDE_CODE_MESSAGING_TOKEN",
    "CLAUDE_PID",
    "CLAUDE_JOB_DIR",
];

fn home_dir() -> Option<PathBuf> {
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from)
}

/// `~/.mnemo-desktop/shell`, unless `MNEMO_NO_SHELL_INTEGRATION=1`.
fn default_shell_dir() -> Option<PathBuf> {
    if cfg!(windows) || std::env::var("MNEMO_NO_SHELL_INTEGRATION").is_ok_and(|v| v == "1") {
        return None;
    }
    home_dir().map(|h| crate::app_dir::app_dir_in(&h).join("shell"))
}

fn write_if_changed(path: &Path, contents: &str) -> std::io::Result<()> {
    if std::fs::read(path).is_ok_and(|old| old == contents.as_bytes()) {
        return Ok(());
    }
    std::fs::create_dir_all(path.parent().expect("rc files live in a directory"))?;
    std::fs::write(path, contents)
}

/// How the default shell is started so it reports its cwd.
enum Integration {
    /// `ZDOTDIR` for zsh.
    Zsh(PathBuf),
    /// `--rcfile` for bash.
    Bash(PathBuf),
}

/// Writes the rc files for `shell` (a program path), or returns `None` for a shell without
/// integration. Runs on every spawn: zsh pointed at a missing ZDOTDIR would silently skip the
/// user's own config.
fn install_integration(dir: &Path, shell: &str) -> std::io::Result<Option<Integration>> {
    let name = Path::new(shell).file_name().and_then(|n| n.to_str()).unwrap_or("");
    match name.trim_start_matches('-') {
        "zsh" => {
            let zsh = dir.join("zsh");
            for (file, contents) in ZSH_RC {
                write_if_changed(&zsh.join(file), contents)?;
            }
            Ok(Some(Integration::Zsh(zsh)))
        }
        "bash" => {
            let rc = dir.join("bash").join("mnemo.bashrc");
            write_if_changed(&rc, BASH_RC)?;
            Ok(Some(Integration::Bash(rc)))
        }
        _ => Ok(None),
    }
}

pub fn default_shell() -> String {
    if cfg!(windows) {
        std::env::var("COMSPEC").unwrap_or_else(|_| "powershell.exe".into())
    } else {
        std::env::var("SHELL").unwrap_or_else(|_| {
            if cfg!(target_os = "macos") {
                "/bin/zsh".into()
            } else {
                "/bin/bash".into()
            }
        })
    }
}

impl PtyManager {
    pub fn new() -> Self {
        Self::with_shell_dir(default_shell_dir())
    }

    pub fn with_shell_dir(shell_dir: Option<PathBuf>) -> Self {
        Self { next: AtomicU32::new(1), handles: Default::default(), shell_dir }
    }

    pub fn spawn(&self, opts: SpawnOptions, sink: Sink) -> Result<PaneId, String> {
        let (rows, cols) = (opts.rows, opts.cols);
        self.launch(self.command(opts, default_shell()), rows, cols, sink)
    }

    /// The command for `opts`, with `shell` standing for the default shell. Only the default
    /// shell gets the integration: an explicit program is run as asked.
    fn command(&self, opts: SpawnOptions, shell: String) -> CommandBuilder {
        let integration = match (&self.shell_dir, &opts.program) {
            (Some(dir), None) => install_integration(dir, &shell).unwrap_or_else(|e| {
                log::warn!("shell integration off, cannot write {}: {e}", dir.display());
                None
            }),
            _ => None,
        };
        let mut cmd = CommandBuilder::new(opts.program.unwrap_or(shell));
        match &integration {
            Some(Integration::Bash(rc)) => {
                // bash ignores `--rcfile` in a login shell, so the rc file loads the login files.
                cmd.arg("--rcfile");
                cmd.arg(rc);
                if opts.login {
                    cmd.env("MNEMO_BASH_LOGIN", "1");
                }
            }
            _ if opts.login && !cfg!(windows) => cmd.arg("-l"),
            _ => {}
        }
        if let Some(Integration::Zsh(zdotdir)) = &integration {
            match std::env::var_os("ZDOTDIR") {
                Some(user) if Path::new(&user) != zdotdir => cmd.env("MNEMO_USER_ZDOTDIR", user),
                // Ours, inherited from a mnemo zsh that never restored it (startup cut short):
                // its MNEMO_USER_ZDOTDIR came along with it.
                Some(_) => {}
                None => cmd.env_remove("MNEMO_USER_ZDOTDIR"),
            }
            cmd.env("ZDOTDIR", zdotdir);
        }
        for a in &opts.args {
            cmd.arg(a);
        }
        if let Some(cwd) = opts.cwd.map(PathBuf::from).filter(|p| p.is_dir()).or_else(home_dir) {
            cmd.cwd(cwd);
        }
        for var in CLAUDE_SESSION_ENV {
            cmd.env_remove(var);
        }
        // `mnemo` and `claude` in the app's own dirs work typed into a pane too.
        cmd.env("PATH", crate::tools::pane_path());
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd.env("TERM_PROGRAM", "mnemo");
        cmd.env("TERM_PROGRAM_VERSION", env!("CARGO_PKG_VERSION"));
        cmd.env("MNEMO_DESKTOP", "1");
        // A session in this pane reaches this app's MCP socket, whichever build registered the
        // binary, and never an instance whose pane started this app (#168).
        let (var, socket) = crate::mcp::pane_env();
        cmd.env(var, socket);
        cmd
    }

    fn launch(&self, cmd: CommandBuilder, rows: u16, cols: u16, sink: Sink) -> Result<PaneId, String> {
        let system = native_pty_system();
        let pair = system
            .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| format!("openpty: {e}"))?;
        let program = cmd.get_argv()[0].to_string_lossy().into_owned();
        let child = pair.slave.spawn_command(cmd).map_err(|e| format!("spawn {program}: {e}"))?;
        drop(pair.slave);

        let mut reader = pair.master.try_clone_reader().map_err(|e| format!("reader: {e}"))?;
        let writer = pair.master.take_writer().map_err(|e| format!("writer: {e}"))?;

        let id = self.next.fetch_add(1, Ordering::SeqCst);
        let handles = Arc::clone(&self.handles);
        let sink: Arc<Sink> = Arc::new(sink);

        handles.lock().unwrap().insert(id, Handle { master: pair.master, writer, child });

        thread::Builder::new()
            .name(format!("pty-reader-{id}"))
            .spawn(move || {
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    let mut buf = [0u8; 8192];
                    loop {
                        match reader.read(&mut buf) {
                            Ok(0) => break,
                            Ok(n) => sink(Event::Output(buf[..n].to_vec())),
                            Err(_) => break,
                        }
                    }
                }));
                if result.is_err() {
                    log::error!("pty reader {id} panicked");
                }
                let code = {
                    let mut map = handles.lock().unwrap();
                    map.remove(&id)
                        .and_then(|mut h| h.child.wait().ok())
                        .map(|s| s.exit_code() as i32)
                };
                sink(Event::Exit(code));
            })
            .map_err(|e| format!("thread: {e}"))?;

        Ok(id)
    }

    pub fn write(&self, id: PaneId, data: &[u8]) -> Result<(), String> {
        let mut map = self.handles.lock().unwrap();
        let h = map.get_mut(&id).ok_or_else(|| format!("pane {id} not found"))?;
        h.writer.write_all(data).map_err(|e| format!("write: {e}"))
    }

    pub fn resize(&self, id: PaneId, cols: u16, rows: u16) -> Result<(), String> {
        let map = self.handles.lock().unwrap();
        let h = map.get(&id).ok_or_else(|| format!("pane {id} not found"))?;
        h.master
            .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| format!("resize: {e}"))
    }

    /// The pid of the program a pane runs (the shell for a terminal pane); None once it has
    /// exited or for an unknown id.
    pub fn pid(&self, id: PaneId) -> Option<u32> {
        self.handles.lock().unwrap().get(&id)?.child.process_id()
    }

    /// Idempotent. Unknown ids are a no-op. The reader thread emits `Exit` when the PTY closes.
    pub fn kill(&self, id: PaneId) {
        let mut map = self.handles.lock().unwrap();
        if let Some(h) = map.get_mut(&id) {
            let _ = h.child.kill();
        }
    }

    pub fn kill_all(&self) {
        let ids: Vec<PaneId> = self.handles.lock().unwrap().keys().copied().collect();
        for id in ids {
            self.kill(id);
        }
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;

    fn sh(manager: &PtyManager, script: &str) -> (PaneId, mpsc::Receiver<Event>) {
        let (tx, rx) = mpsc::channel();
        let id = manager
            .spawn(
                SpawnOptions {
                    program: Some("/bin/sh".into()),
                    args: vec!["-c".into(), script.into()],
                    cwd: None,
                    cols: 80,
                    rows: 24,
                    login: false,
                },
                Box::new(move |e| {
                    let _ = tx.send(e);
                }),
            )
            .expect("spawn");
        (id, rx)
    }

    fn collect(rx: &mpsc::Receiver<Event>) -> (Vec<u8>, Option<Option<i32>>) {
        let mut out = Vec::new();
        let mut exit = None;
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while std::time::Instant::now() < deadline {
            match rx.recv_timeout(Duration::from_millis(100)) {
                Ok(Event::Output(b)) => out.extend(b),
                Ok(Event::Exit(code)) => {
                    exit = Some(code);
                    break;
                }
                Err(mpsc::RecvTimeoutError::Timeout) => continue,
                Err(_) => break,
            }
        }
        (out, exit)
    }

    #[test]
    fn spawn_streams_output_then_exit() {
        let m = PtyManager::new();
        let (_id, rx) = sh(&m, "printf hi");
        let (out, exit) = collect(&rx);
        assert!(String::from_utf8_lossy(&out).contains("hi"), "got {:?}", out);
        assert_eq!(exit, Some(Some(0)));
    }

    #[test]
    fn exit_code_is_reported() {
        let m = PtyManager::new();
        let (_id, rx) = sh(&m, "exit 3");
        let (_out, exit) = collect(&rx);
        assert_eq!(exit, Some(Some(3)));
    }

    #[test]
    fn ids_are_unique_and_increasing() {
        let m = PtyManager::new();
        let (a, _ra) = sh(&m, "true");
        let (b, _rb) = sh(&m, "true");
        assert!(b > a);
    }

    #[test]
    fn env_is_set_for_the_child() {
        let m = PtyManager::new();
        let (_id, rx) = sh(&m, "printf \"%s|%s\" \"$MNEMO_DESKTOP\" \"$TERM\"");
        let (out, _) = collect(&rx);
        assert!(String::from_utf8_lossy(&out).contains("1|xterm-256color"), "got {:?}", out);
    }

    #[test]
    fn resize_live_pty_ok() {
        let m = PtyManager::new();
        let (id, rx) = sh(&m, "sleep 2");
        m.resize(id, 120, 40).expect("resize");
        m.kill(id);
        let (_, exit) = collect(&rx);
        assert!(exit.is_some(), "kill must end the reader with an Exit event");
    }

    #[test]
    fn kill_is_idempotent_and_unknown_is_noop() {
        let m = PtyManager::new();
        let (id, rx) = sh(&m, "true");
        let _ = collect(&rx);
        m.kill(id);
        m.kill(id);
        m.kill(999_999);
    }

    #[test]
    fn write_reaches_the_child() {
        let m = PtyManager::new();
        let (id, rx) = sh(&m, "read x; printf \"got:%s\" \"$x\"");
        m.write(id, b"abc\n").expect("write");
        let (out, exit) = collect(&rx);
        assert!(String::from_utf8_lossy(&out).contains("got:abc"), "got {:?}", out);
        assert_eq!(exit, Some(Some(0)));
    }

    #[test]
    fn pid_is_the_spawned_child_until_it_exits() {
        let m = PtyManager::new();
        let (id, rx) = sh(&m, "read x");
        let pid = m.pid(id).expect("a live pane has a pid");
        let ppid = crate::proc::command("ps").args(["-o", "ppid=", "-p", &pid.to_string()]).output().unwrap();
        assert_eq!(String::from_utf8_lossy(&ppid.stdout).trim(), std::process::id().to_string());
        m.write(id, b"\n").unwrap();
        let _ = collect(&rx);
        assert_eq!(m.pid(id), None);
        assert_eq!(m.pid(999_999), None);
    }

    #[test]
    fn write_after_exit_is_error() {
        let m = PtyManager::new();
        let (id, rx) = sh(&m, "true");
        let _ = collect(&rx);
        assert!(m.write(id, b"x").is_err());
    }

    fn tmp(tag: &str) -> PathBuf {
        let d = crate::testutil::temp_dir(&format!("pty-{tag}"));
        d
    }

    fn default_shell_opts(cwd: &Path) -> SpawnOptions {
        SpawnOptions {
            program: None,
            args: vec![],
            cwd: Some(cwd.to_string_lossy().into_owned()),
            cols: 80,
            rows: 24,
            login: true,
        }
    }

    /// Runs the default shell (`shell`) through the integration with `home` as $HOME, types
    /// `input`, and returns everything it printed.
    fn run_default_shell(shell: &str, home: &Path, cwd: &Path, input: &[u8]) -> String {
        let m = PtyManager::with_shell_dir(Some(home.join(".mnemo-desktop/shell")));
        let mut cmd = m.command(default_shell_opts(cwd), shell.into());
        cmd.env("HOME", home);
        cmd.env_remove("MNEMO_NO_SHELL_INTEGRATION");
        let (tx, rx) = mpsc::channel();
        let id = m
            .launch(
                cmd,
                24,
                80,
                Box::new(move |e| {
                    let _ = tx.send(e);
                }),
            )
            .expect("spawn");
        m.write(id, input).expect("write");
        let (out, exit) = collect(&rx);
        assert!(exit.is_some(), "the shell did not exit");
        String::from_utf8_lossy(&out).into_owned()
    }

    #[test]
    fn bootstrap_dir_holds_the_zsh_files_and_the_bash_rc() {
        let dir = tmp("install");
        let Some(Integration::Zsh(zdotdir)) = install_integration(&dir, "/bin/zsh").unwrap() else {
            panic!("zsh gets ZDOTDIR")
        };
        assert_eq!(zdotdir, dir.join("zsh"));
        for f in [".zshenv", ".zprofile", ".zshrc", ".zlogin"] {
            assert!(zdotdir.join(f).is_file(), "missing {f}");
        }
        let Some(Integration::Bash(rc)) = install_integration(&dir, "/usr/local/bin/bash").unwrap() else {
            panic!("bash gets --rcfile")
        };
        assert_eq!(std::fs::read_to_string(&rc).unwrap(), BASH_RC);
        assert!(install_integration(&dir, "/usr/bin/fish").unwrap().is_none());

        // Write-if-changed: a stale file is rewritten, a current one is left alone.
        std::fs::write(zdotdir.join(".zshrc"), "stale").unwrap();
        let before = std::fs::metadata(zdotdir.join(".zshenv")).unwrap().modified().unwrap();
        install_integration(&dir, "zsh").unwrap();
        assert_eq!(std::fs::read_to_string(zdotdir.join(".zshrc")).unwrap(), ZSH_RC[2].1);
        assert_eq!(std::fs::metadata(zdotdir.join(".zshenv")).unwrap().modified().unwrap(), before);
    }

    #[test]
    fn spawn_env_carries_zdotdir_and_term_program() {
        let dir = tmp("env");
        let m = PtyManager::with_shell_dir(Some(dir.clone()));
        let zsh = m.command(default_shell_opts(&dir), "/bin/zsh".into());
        assert_eq!(zsh.get_env("ZDOTDIR"), Some(dir.join("zsh").as_os_str()));
        assert_eq!(zsh.get_env("TERM_PROGRAM"), Some("mnemo".as_ref()));
        let path = zsh.get_env("PATH").expect("a pane gets a PATH").to_string_lossy().into_owned();
        for d in crate::tools::extra_dirs() {
            assert!(path.split(crate::tools::separator()).any(|x| Path::new(x) == d), "{} missing from {path}", d.display());
        }
        assert_eq!(zsh.get_env("TERM_PROGRAM_VERSION"), Some(env!("CARGO_PKG_VERSION").as_ref()));
        assert_eq!(zsh.get_argv()[1..], ["-l"]);

        let bash = m.command(default_shell_opts(&dir), "/bin/bash".into());
        let rc = dir.join("bash/mnemo.bashrc");
        assert_eq!(bash.get_argv()[1..], ["--rcfile".as_ref(), rc.as_os_str()]);
        assert_eq!(bash.get_env("MNEMO_BASH_LOGIN"), Some("1".as_ref()));
        assert_eq!(bash.get_env("ZDOTDIR"), std::env::var_os("ZDOTDIR").as_deref());

        // An explicit program is run as asked; TERM_PROGRAM is still set.
        let mut opts = default_shell_opts(&dir);
        opts.program = Some("/bin/zsh".into());
        let explicit = m.command(opts, "/bin/zsh".into());
        assert_eq!(explicit.get_env("ZDOTDIR"), std::env::var_os("ZDOTDIR").as_deref());
        assert_eq!(explicit.get_env("TERM_PROGRAM"), Some("mnemo".as_ref()));

        let off = PtyManager::with_shell_dir(None).command(default_shell_opts(&dir), "/bin/zsh".into());
        assert_eq!(off.get_argv()[1..], ["-l"]);
        assert_eq!(off.get_env("TERM_PROGRAM"), Some("mnemo".as_ref()));

        // A Claude Code session that launched the app does not leak into its panes, and each
        // pane points the MCP binary at this app's socket, over any inherited one.
        let socket = crate::mcp::socket_path();
        assert!(socket.starts_with(crate::app_dir::app_dir()));
        for (i, cmd) in [&zsh, &bash, &explicit, &off].into_iter().enumerate() {
            for var in CLAUDE_SESSION_ENV {
                assert_eq!(cmd.get_env(var), None, "{var} in command {i}");
            }
            assert_eq!(cmd.get_env(crate::mcp::SOCKET_ENV), Some(socket.as_os_str()), "socket in command {i}");
        }
    }

    #[test]
    fn zsh_loads_the_user_config_and_reports_its_cwd() {
        if !Path::new("/bin/zsh").exists() {
            return;
        }
        let home = tmp("zsh");
        std::fs::write(home.join(".zshrc"), "typeset -g USER_RC=loaded\n").unwrap();
        let cwd = home.join("a dir");
        std::fs::create_dir_all(&cwd).unwrap();
        let out = run_default_shell("/bin/zsh", &home, &cwd, b"echo \"rc=$USER_RC zdotdir=[$ZDOTDIR] histfile=[$HISTFILE]\"; exit\n");
        assert!(out.contains("rc=loaded zdotdir=[]"), "got {out:?}");
        // macOS /etc/zshrc derives HISTFILE from ZDOTDIR while it still names the bootstrap dir.
        let histfile = format!("histfile=[{}/.zsh_history]", home.display());
        if out.contains("histfile=[/") {
            assert!(out.contains(&histfile), "history would leave $HOME: {out:?}");
        }
        assert!(out.contains("\x1b]7;file://"), "no OSC 7 in {out:?}");
        assert!(out.contains("/a%20dir\x07"), "cwd not percent-encoded in {out:?}");
    }

    #[test]
    fn bash_loads_the_login_files_and_reports_its_cwd() {
        if !Path::new("/bin/bash").exists() {
            return;
        }
        let home = tmp("bash");
        std::fs::write(home.join(".bash_profile"), "USER_RC=loaded\n").unwrap();
        let cwd = home.join("a dir");
        std::fs::create_dir_all(&cwd).unwrap();
        let out = run_default_shell("/bin/bash", &home, &cwd, b"echo \"rc=$USER_RC login=[$MNEMO_BASH_LOGIN]\"; exit\n");
        assert!(out.contains("rc=loaded login=[]"), "got {out:?}");
        assert!(out.contains("\x1b]7;file://"), "no OSC 7 in {out:?}");
        assert!(out.contains("/a%20dir\x07"), "cwd not percent-encoded in {out:?}");
    }

    #[test]
    fn no_cwd_starts_in_home_not_the_process_cwd() {
        let home = std::env::var("HOME").expect("HOME");
        for cwd in [None, Some("/definitely/not/a/dir".to_string())] {
            let m = PtyManager::new();
            let (tx, rx) = mpsc::channel();
            m.spawn(
                SpawnOptions { program: Some("/bin/sh".into()), args: vec!["-c".into(), "pwd -P".into()], cwd, cols: 80, rows: 24, login: false },
                Box::new(move |e| {
                    let _ = tx.send(e);
                }),
            )
            .unwrap();
            let (out, _) = collect(&rx);
            let real = std::fs::canonicalize(&home).unwrap();
            assert!(String::from_utf8_lossy(&out).contains(&*real.to_string_lossy()), "got {out:?}");
        }
    }

    #[test]
    fn cwd_is_honoured() {
        let m = PtyManager::new();
        let (tx, rx) = mpsc::channel();
        m.spawn(
            SpawnOptions {
                program: Some("/bin/sh".into()),
                args: vec!["-c".into(), "pwd".into()],
                cwd: Some("/tmp".into()),
                cols: 80,
                rows: 24,
                login: false,
            },
            Box::new(move |e| {
                let _ = tx.send(e);
            }),
        )
        .unwrap();
        let (out, _) = collect(&rx);
        let s = String::from_utf8_lossy(&out);
        assert!(s.contains("/tmp"), "got {s:?}");
    }
}

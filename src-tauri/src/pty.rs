//! PTY ownership. No Tauri types here so `cargo test` covers it directly.
//!
//! Terminals outlive the app: `mnemo-desktop-ptyd` (`src/bin/`) holds every PTY, with the
//! screen and scrollback of each (`pty/screen.rs`), and keeps them running while the app is
//! closed or reloading. The app builds each shell's command as it always has, and hands the
//! daemon the whole of it — program, arguments, environment, folder — over `ptyd.sock` in its
//! app dir (`pty/wire.rs`). When the daemon cannot be had (no binary beside the app, as in
//! `cargo test`; Windows; `MNEMO_NO_PTYD=1`) the same host runs in-process: a reload still finds
//! its shells, a quit takes them along.

mod host;
mod screen;
// Most of it is the daemon protocol, which only unix speaks.
#[cfg_attr(not(unix), allow(dead_code))]
mod wire;

#[cfg(unix)]
mod client;
#[cfg(all(test, unix))]
mod server;

use host::{Host, Subscriber};
use portable_pty::CommandBuilder;
use std::path::{Path, PathBuf};
#[cfg(unix)]
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(unix)]
use std::sync::{Arc, OnceLock};
#[cfg(unix)]
use wire::{Op, Spec};

pub use wire::{Event, PaneId, PtyInfo};

pub type Sink = Box<dyn Fn(Event) + Send + Sync + 'static>;

/// The daemon binary, a sibling of the app's own executable.
pub const DAEMON_BIN: &str = "mnemo-desktop-ptyd";
/// Its socket, in the app dir: a debug build and the installed app each keep their own.
pub const SOCKET: &str = "ptyd.sock";

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

pub struct PtyManager {
    /// Where the shell integration rc files are written; `None` turns integration off.
    shell_dir: Option<PathBuf>,
    hosting: Hosting,
}

enum Hosting {
    Here(Host),
    /// The daemon, and the host that stands in for it when it could not be had at the first
    /// try. Once the daemon answered, the app never mixes in terminals of its own: ids could meet.
    #[cfg(unix)]
    Daemon { remote: client::Remote, reached: AtomicBool, fallback: OnceLock<Host> },
}

/// Who serves a call.
enum Via<'a> {
    Here(&'a Host),
    #[cfg(unix)]
    Daemon(Arc<client::Conn>),
}

impl Default for PtyManager {
    fn default() -> Self {
        Self::new()
    }
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
    /// The daemon beside the app's binary, else terminals held in-process.
    pub fn new() -> Self {
        let shell_dir = default_shell_dir();
        #[cfg(unix)]
        if let Some(bin) = daemon_binary() {
            return Self::with_daemon(crate::app_dir::app_dir().join(SOCKET), bin, shell_dir);
        }
        Self::with_shell_dir(shell_dir)
    }

    /// Terminals held in-process.
    pub fn with_shell_dir(shell_dir: Option<PathBuf>) -> Self {
        Self { shell_dir, hosting: Hosting::Here(Host::default()) }
    }

    /// Terminals held by the daemon at `socket`, started from `bin` when none answers there.
    /// Nothing is reached until the first call.
    #[cfg(unix)]
    pub fn with_daemon(socket: PathBuf, bin: PathBuf, shell_dir: Option<PathBuf>) -> Self {
        let hosting = Hosting::Daemon { remote: client::Remote::new(socket, bin), reached: AtomicBool::new(false), fallback: OnceLock::new() };
        Self { shell_dir, hosting }
    }

    fn via(&self) -> Result<Via<'_>, String> {
        match &self.hosting {
            Hosting::Here(h) => Ok(Via::Here(h)),
            #[cfg(unix)]
            Hosting::Daemon { remote, reached, fallback } => {
                if let Some(h) = fallback.get() {
                    return Ok(Via::Here(h));
                }
                match remote.conn() {
                    Ok(c) => {
                        reached.store(true, Ordering::SeqCst);
                        Ok(Via::Daemon(c))
                    }
                    Err(e) if !reached.load(Ordering::SeqCst) => {
                        log::warn!("terminals will not outlive the app: {e}");
                        Ok(Via::Here(fallback.get_or_init(Host::default)))
                    }
                    Err(e) => Err(e),
                }
            }
        }
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
        match self.via()? {
            Via::Here(h) => h.spawn(cmd, rows, cols, local(sink), |_| {}),
            #[cfg(unix)]
            Via::Daemon(c) => {
                let spec = Spec {
                    argv: cmd.get_argv().iter().map(|a| a.to_string_lossy().into_owned()).collect(),
                    env: cmd.iter_full_env_as_str().map(|(k, v)| (k.to_string(), v.to_string())).collect(),
                    cwd: cmd.get_cwd().map(|c| c.to_string_lossy().into_owned()),
                    rows,
                    cols,
                };
                let (answer, _) = c.call(Op::Spawn { spec }, &[], Some((None, Arc::new(sink))))?;
                answer.get("id").and_then(serde_json::Value::as_u64).map(|id| id as PaneId).ok_or_else(|| "the terminal daemon gave no id".into())
            }
        }
    }

    /// Sends what terminal `id` prints to `sink` from now on, in place of wherever it went (a
    /// page that reloaded, an app that quit), and returns the bytes that draw it as it is now
    /// (`Screen::snapshot`), for before any of that output. Fails for a terminal whose program
    /// has ended.
    pub fn attach(&self, id: PaneId, sink: Sink) -> Result<Vec<u8>, String> {
        match self.via()? {
            Via::Here(h) => {
                let mut snapshot = Vec::new();
                h.attach(id, local(sink), |s| snapshot = s.to_vec())?;
                Ok(snapshot)
            }
            #[cfg(unix)]
            Via::Daemon(c) => c.call(Op::Attach { id }, &[], Some((Some(id), Arc::new(sink)))).map(|(_, snapshot)| snapshot),
        }
    }

    /// Every terminal held, by id: those whose program ended too, until they are killed.
    pub fn list(&self) -> Result<Vec<PtyInfo>, String> {
        match self.via()? {
            Via::Here(h) => Ok(h.list()),
            #[cfg(unix)]
            Via::Daemon(c) => serde_json::from_value(c.call(Op::List, &[], None)?.0).map_err(|e| e.to_string()),
        }
    }

    pub fn write(&self, id: PaneId, data: &[u8]) -> Result<(), String> {
        match self.via()? {
            Via::Here(h) => h.write(id, data),
            #[cfg(unix)]
            Via::Daemon(c) => c.tell(Op::Write { id }, data),
        }
    }

    pub fn resize(&self, id: PaneId, cols: u16, rows: u16) -> Result<(), String> {
        match self.via()? {
            Via::Here(h) => h.resize(id, cols, rows),
            #[cfg(unix)]
            Via::Daemon(c) => c.call(Op::Resize { id, cols, rows }, &[], None).map(|_| ()),
        }
    }

    /// The pid of the program a pane runs (the shell for a terminal pane); None once it has
    /// exited or for an unknown id.
    pub fn pid(&self, id: PaneId) -> Option<u32> {
        match self.via().ok()? {
            Via::Here(h) => h.pid(id),
            #[cfg(unix)]
            Via::Daemon(_) => self.list().ok()?.into_iter().find(|i| i.id == id && i.alive).map(|i| i.pid),
        }
    }

    /// Idempotent. Unknown ids are a no-op. The sink gets `Exit` when the PTY closes.
    pub fn kill(&self, id: PaneId) {
        match self.via() {
            Ok(Via::Here(h)) => h.kill(id),
            #[cfg(unix)]
            Ok(Via::Daemon(c)) => {
                let _ = c.call(Op::Kill { id }, &[], None);
            }
            Err(_) => {}
        }
    }

    /// The app is going away: terminals held in-process go with it (they would anyway); the
    /// daemon's keep running for the next launch. Starts nothing.
    pub fn release(&self) {
        match &self.hosting {
            Hosting::Here(h) => h.kill_all(),
            #[cfg(unix)]
            Hosting::Daemon { fallback, .. } => {
                if let Some(h) = fallback.get() {
                    h.kill_all();
                }
            }
        }
    }
}

/// A sink as the host's subscriber, for terminals held in-process.
fn local(sink: Sink) -> Subscriber {
    Subscriber {
        owner: 0,
        send: Box::new(move |_, e| {
            sink(e);
            true
        }),
    }
}

/// The daemon beside the app's own binary; `None` without one, or with `MNEMO_NO_PTYD=1`.
#[cfg(unix)]
fn daemon_binary() -> Option<PathBuf> {
    if std::env::var("MNEMO_NO_PTYD").is_ok_and(|v| v == "1") {
        return None;
    }
    let bin = std::env::current_exe().ok()?.with_file_name(DAEMON_BIN);
    bin.is_file().then_some(bin)
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

    // -- terminals held by a daemon (server.rs, in-process here; tests/ptyd.rs runs the binary) --

    use std::os::unix::net::UnixListener;
    use std::time::Instant;

    /// A daemon serving on a fresh socket, in this process. `Shutdown` only records itself.
    fn daemon(tag: &str) -> (PathBuf, Arc<server::Server>, mpsc::Receiver<()>) {
        let socket = tmp(tag).join(SOCKET);
        let listener = UnixListener::bind(&socket).unwrap();
        let (tx, rx) = mpsc::channel();
        let tx = std::sync::Mutex::new(tx);
        let srv = server::Server::new(Arc::new(Host::new(7_000)), move || {
            let _ = tx.lock().unwrap().send(());
        });
        let accepting = Arc::clone(&srv);
        std::thread::spawn(move || accepting.accept(listener));
        (socket, srv, rx)
    }

    /// An app: talks to the daemon at `socket`, and has no binary to start one with.
    fn app(socket: &Path) -> PtyManager {
        PtyManager::with_daemon(socket.to_path_buf(), PathBuf::from("/nonexistent/mnemo-desktop-ptyd"), None)
    }

    /// Output until `want` shows up, within 5 s.
    fn until(rx: &mpsc::Receiver<Event>, want: &str) -> String {
        let mut out = Vec::new();
        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline && !String::from_utf8_lossy(&out).contains(want) {
            if let Ok(Event::Output(b)) = rx.recv_timeout(Duration::from_millis(50)) {
                out.extend(b);
            }
        }
        String::from_utf8_lossy(&out).into_owned()
    }

    fn eventually(what: &str, mut f: impl FnMut() -> bool) {
        let deadline = Instant::now() + Duration::from_secs(5);
        while !f() {
            assert!(Instant::now() < deadline, "timed out waiting for {what}");
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    fn recorder() -> (Sink, mpsc::Receiver<Event>) {
        let (tx, rx) = mpsc::channel();
        (
            Box::new(move |e| {
                let _ = tx.send(e);
            }),
            rx,
        )
    }

    #[test]
    fn a_shell_outlives_the_app_and_the_next_one_attaches_with_its_screen() {
        let (socket, srv, _) = daemon("keep");
        let first = app(&socket);
        let (id, rx) = sh(&first, "printf 'ready\\n'; while read x; do printf 'got:%s\\n' \"$x\"; done");
        assert!(id >= 7_000, "the daemon's ids, not the app's: {id}");
        assert!(until(&rx, "ready").contains("ready"));
        first.write(id, b"one\n").unwrap();
        assert!(until(&rx, "got:one").contains("got:one"));
        eventually("the app to connect", || srv.clients() == 1);

        drop(first);
        eventually("the app to leave", || srv.clients() == 0);
        // Unsubscribed at once, not at the shell's next output: a quiet shell holds no dead connection.
        assert!(!srv.host.subscribed(id));
        assert!(srv.quiet_for() < Duration::from_secs(5), "leaving restarts the daemon's idle clock");
        // Quitting ended nothing, and told the old page nothing either.
        assert!(rx.try_iter().all(|e| !matches!(e, Event::Exit(_))));

        let second = app(&socket);
        let listed = second.list().unwrap();
        assert_eq!(listed.len(), 1);
        let home = std::env::var("HOME").unwrap();
        assert_eq!((listed[0].id, listed[0].alive, listed[0].cwd.as_str()), (id, true, home.as_str()));
        assert_eq!(second.pid(id), Some(listed[0].pid));

        let (sink, rx2) = recorder();
        let snapshot = String::from_utf8(second.attach(id, sink).unwrap()).unwrap();
        assert!(snapshot.starts_with("\x1b[8;24;80t"), "{snapshot:?}");
        assert!(snapshot.contains("ready") && snapshot.contains("got:one"), "{snapshot:?}");
        second.write(id, b"two\n").unwrap();
        assert!(until(&rx2, "got:two").contains("got:two"));
        second.resize(id, 100, 30).unwrap();

        second.kill(id);
        eventually("the kill", || second.list().unwrap().is_empty());
        assert_eq!(second.pid(id), None);
    }

    #[test]
    fn a_shell_that_ended_while_the_app_was_away_is_listed_dead_until_killed() {
        let (socket, _srv, _) = daemon("dead");
        let first = app(&socket);
        let (id, rx) = sh(&first, "read x; exit 4");
        drop(first);
        drop(rx);
        let second = app(&socket);
        second.list().unwrap();
        // Typed by nobody: end it from the daemon's side.
        let third = app(&socket);
        third.write(id, b"\n").unwrap();
        eventually("the exit", || second.list().unwrap().first().is_some_and(|i| !i.alive));
        let (sink, _) = recorder();
        assert!(second.attach(id, sink).unwrap_err().contains("exited"));
        second.kill(id);
        assert!(second.list().unwrap().is_empty());
    }

    #[test]
    fn the_attached_app_hears_output_and_exit_and_the_one_it_replaced_does_not() {
        let (socket, _srv, _) = daemon("move");
        let a = app(&socket);
        let (id, rx_a) = sh(&a, "read x; printf 'late:%s' \"$x\"; exit 5");
        let b = app(&socket);
        let (sink, rx_b) = recorder();
        b.attach(id, sink).unwrap();
        a.write(id, b"z\n").unwrap();
        let out = until(&rx_b, "late:z");
        assert!(out.contains("late:z"), "{out:?}");
        eventually("the exit", || rx_b.try_iter().any(|e| e == Event::Exit(Some(5))));
        assert!(rx_a.try_iter().all(|e| matches!(e, Event::Output(ref b) if !String::from_utf8_lossy(b).contains("late"))));
    }

    #[test]
    fn no_daemon_and_no_binary_means_terminals_held_in_process() {
        let socket = tmp("none").join(SOCKET);
        let m = app(&socket);
        let (id, rx) = sh(&m, "printf here");
        assert!(id < 7_000);
        assert!(until(&rx, "here").contains("here"));
        // The same host keeps answering: no second attempt at a daemon.
        let (id2, _) = sh(&m, "true");
        assert_eq!(id2, id + 1);
        m.release();
    }

    #[test]
    fn a_daemon_of_another_version_is_asked_to_leave() {
        use wire::{frame, read_frame, Message, Request};
        let socket = tmp("old").join(SOCKET);
        let listener = UnixListener::bind(&socket).unwrap();
        let (tx, asked) = mpsc::channel();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let mut stream = stream.unwrap();
                let mut input = stream.try_clone().unwrap();
                while let Ok(Some((head, _))) = read_frame(&mut input) {
                    let req: Request = serde_json::from_slice(&head).unwrap();
                    match req.op {
                        Op::Hello { .. } => {
                            let f = frame(&Message::reply(req.req, Ok(serde_json::json!({ "version": 0 }))), &[]).unwrap();
                            std::io::Write::write_all(&mut stream, &f).unwrap();
                        }
                        op => {
                            let _ = tx.send(op);
                            return;
                        }
                    }
                }
            }
        });
        let m = app(&socket);
        // It cannot start one of its own (no binary): terminals stay in-process.
        let (_, rx) = sh(&m, "printf fine");
        assert!(until(&rx, "fine").contains("fine"));
        assert_eq!(asked.recv_timeout(Duration::from_secs(5)), Ok(Op::Shutdown));
    }

    #[test]
    fn when_the_daemon_dies_its_terminals_end_and_calls_fail_instead_of_hanging() {
        use wire::{frame, read_frame, Message, Request};
        let socket = tmp("dies").join(SOCKET);
        let listener = UnixListener::bind(&socket).unwrap();
        std::thread::spawn(move || {
            let mut stream = listener.incoming().next().unwrap().unwrap();
            let mut input = stream.try_clone().unwrap();
            while let Ok(Some((head, _))) = read_frame(&mut input) {
                let req: Request = serde_json::from_slice(&head).unwrap();
                let answer = match req.op {
                    Op::Hello { .. } => serde_json::json!({ "version": wire::VERSION }),
                    Op::Spawn { .. } => serde_json::json!({ "id": 42 }),
                    _ => serde_json::Value::Null,
                };
                let f = frame(&Message::reply(req.req, Ok(answer)), &[]).unwrap();
                std::io::Write::write_all(&mut stream, &f).unwrap();
                let f = frame(&Message::Output { id: 42 }, b"hi").unwrap();
                std::io::Write::write_all(&mut stream, &f).unwrap();
                if matches!(req.op, Op::Spawn { .. }) {
                    // Dies right after, taking its listener with it.
                    return;
                }
            }
        });
        let m = app(&socket);
        let (id, rx) = sh(&m, "true");
        assert_eq!(id, 42);
        assert_eq!(rx.recv_timeout(Duration::from_secs(5)), Ok(Event::Output(b"hi".to_vec())));
        assert_eq!(rx.recv_timeout(Duration::from_secs(5)), Ok(Event::Exit(None)));
        // Reached once, it is not swapped for in-process terminals: a call fails (fast), no id mixes.
        let t = Instant::now();
        assert!(m.list().is_err());
        assert!(t.elapsed() < Duration::from_secs(8), "took {:?}", t.elapsed());
    }
}

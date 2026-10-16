//! PTY ownership. No Tauri types here so `cargo test` covers it directly.
//!
//! Terminals outlive the app: `mnemo-desktop-ptyd` (`src/bin/`) holds every PTY, with the
//! screen and scrollback of each (`pty/screen.rs`), and keeps them running while the app is
//! closed or reloading. The app builds each shell's command as it always has, and hands the
//! daemon the whole of it — program, arguments, environment, folder — over `ptyd.sock` in its
//! app dir (`pty/wire.rs`). When the daemon cannot be had (no binary beside the app, as in
//! `cargo test`; Windows; `MNEMO_NO_PTYD=1`) the same host runs in-process: a reload still finds
//! its shells, a quit takes them along.

pub mod closing;
mod host;
mod screen;
pub mod shells;
// Most of it is the daemon protocol, which only unix speaks.
#[cfg_attr(not(unix), allow(dead_code))]
mod wire;

#[cfg(unix)]
mod client;
#[cfg(all(test, unix))]
mod server;

use crate::accounts::{PaneAccount, PaneAccounts};
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
    /// The account each pane is spawned on (`src/accounts.rs`); `None` leaves `CLAUDE_CONFIG_DIR`,
    /// `GROK_HOME` and `MNEMO_AGENT` as the app has them.
    accounts: Option<PaneAccounts>,
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
/// On Windows, Git Bash gets the bash file; PowerShell and cmd report with OSC 9;9 through
/// `POWERSHELL_HOOK` and `CMD_PROMPT_HOOK`, which need no file.
const ZSH_RC: [(&str, &str); 4] = [
    (".zshenv", include_str!("../shell/zsh/.zshenv")),
    (".zprofile", include_str!("../shell/zsh/.zprofile")),
    (".zshrc", include_str!("../shell/zsh/.zshrc")),
    (".zlogin", include_str!("../shell/zsh/.zlogin")),
];
const BASH_RC: &str = include_str!("../shell/bash/mnemo.bashrc");
/// Wraps PowerShell's `prompt`; passed as `-EncodedCommand`.
const POWERSHELL_HOOK: &str = include_str!("../shell/powershell/mnemo.ps1");
/// cmd's prompt reports the folder when it starts with this: OSC 9;9 with `$P`, the drive and
/// path, as Windows Terminal documents it. cmd reads its prompt from `PROMPT`.
const CMD_PROMPT_HOOK: &str = "$e]9;9;$P$e\\";
/// cmd's own prompt when `PROMPT` is not set.
const CMD_PROMPT_DEFAULT: &str = "$P$G";

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
    if std::env::var("MNEMO_NO_SHELL_INTEGRATION").is_ok_and(|v| v == "1") {
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
    /// `-NoExit -EncodedCommand` for Windows PowerShell and pwsh.
    PowerShell,
    /// `PROMPT` for cmd.
    Cmd,
}

/// Writes the rc files for `shell` (a program path), or returns `None` for a shell without
/// integration. Runs on every spawn: zsh pointed at a missing ZDOTDIR would silently skip the
/// user's own config.
fn install_integration(dir: &Path, shell: &str) -> std::io::Result<Option<Integration>> {
    match shells::stem(shell).as_str() {
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
        "powershell" | "pwsh" => Ok(Some(Integration::PowerShell)),
        "cmd" => Ok(Some(Integration::Cmd)),
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

/// `script` as `-EncodedCommand` takes it: base64 of its UTF-16LE.
fn powershell_encoded(script: &str) -> String {
    use base64::Engine;
    let bytes: Vec<u8> = script.encode_utf16().flat_map(u16::to_le_bytes).collect();
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

/// cmd's `PROMPT` with the folder report in front of the person's own (`user`), once: a pane
/// whose app was started from a mnemo cmd inherits the hook already.
fn cmd_prompt(user: Option<&str>) -> String {
    let own = user.map(|p| p.strip_prefix(CMD_PROMPT_HOOK).unwrap_or(p)).filter(|p| !p.is_empty()).unwrap_or(CMD_PROMPT_DEFAULT);
    format!("{CMD_PROMPT_HOOK}{own}")
}

impl PtyManager {
    /// The daemon beside the app's binary, else terminals held in-process.
    /// Each pane runs on the active Claude Code account.
    pub fn new() -> Self {
        let shell_dir = default_shell_dir();
        // `cargo test` spawns panes through here too: they must not land in the app's own record.
        let record = (!cfg!(test)).then(|| crate::app_dir::app_dir().join(crate::accounts::PANES_FILE));
        let accounts = PaneAccounts::new(crate::accounts::Place::real(), record);
        #[cfg(unix)]
        if let Some(bin) = daemon_binary() {
            return Self::with_daemon(crate::app_dir::app_dir().join(SOCKET), bin, shell_dir).with_accounts(accounts);
        }
        Self::with_shell_dir(shell_dir).with_accounts(accounts)
    }

    /// Terminals held in-process.
    pub fn with_shell_dir(shell_dir: Option<PathBuf>) -> Self {
        Self { shell_dir, hosting: Hosting::Here(Host::default()), accounts: None }
    }

    /// Spawns each pane on `accounts`' active account, and keeps which one it got.
    pub fn with_accounts(mut self, accounts: PaneAccounts) -> Self {
        self.accounts = Some(accounts);
        self
    }

    /// Terminals held by the daemon at `socket`, started from `bin` when none answers there.
    /// Nothing is reached until the first call.
    #[cfg(unix)]
    pub fn with_daemon(socket: PathBuf, bin: PathBuf, shell_dir: Option<PathBuf>) -> Self {
        let hosting = Hosting::Daemon { remote: client::Remote::new(socket, bin), reached: AtomicBool::new(false), fallback: OnceLock::new() };
        Self { shell_dir, hosting, accounts: None }
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
        let mut cmd = self.command(opts, shells::for_new_pane());
        let account = self.accounts.as_ref().map(PaneAccounts::current);
        if let Some(a) = &account {
            on_account(&mut cmd, a);
        }
        let id = self.launch(cmd, rows, cols, sink)?;
        if let (Some(accounts), Some(a)) = (&self.accounts, account) {
            accounts.spawned(id, a.id);
        }
        Ok(id)
    }

    /// The account each pane still held was spawned on, by id (`accounts_panes`).
    pub fn pane_accounts(&self) -> Result<std::collections::HashMap<PaneId, String>, String> {
        let Some(accounts) = &self.accounts else {
            return Ok(Default::default());
        };
        let live: Vec<PaneId> = self.list()?.into_iter().map(|i| i.id).collect();
        Ok(accounts.of(&live))
    }

    /// Records that pane `id`, still open, now runs on `account` (`accounts_move_pane`).
    pub fn move_pane(&self, id: PaneId, account: &str) -> Result<(), String> {
        let Some(accounts) = &self.accounts else {
            return Err("panes are not kept by account here".into());
        };
        if !self.list()?.iter().any(|i| i.id == id) {
            return Err(format!("no pane {id}"));
        }
        accounts.moved(id, account)
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
        let program = opts.program.unwrap_or(shell);
        // Git Bash is the one Windows shell that reads `-l`.
        let reads_login = !cfg!(windows) || shells::stem(&program) == "bash";
        let mut cmd = CommandBuilder::new(program);
        match &integration {
            Some(Integration::Bash(rc)) => {
                // bash ignores `--rcfile` in a login shell, so the rc file loads the login files.
                cmd.arg("--rcfile");
                cmd.arg(rc);
                if opts.login {
                    cmd.env("MNEMO_BASH_LOGIN", "1");
                }
            }
            Some(Integration::PowerShell) => {
                cmd.arg("-NoExit");
                cmd.arg("-EncodedCommand");
                cmd.arg(powershell_encoded(POWERSHELL_HOOK));
            }
            Some(Integration::Cmd) => cmd.env("PROMPT", cmd_prompt(std::env::var("PROMPT").ok().as_deref())),
            _ if opts.login && reads_login => cmd.arg("-l"),
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
        // binary, and never an instance whose pane started this app (#168). Where no socket is
        // served (Windows) a pane gets none, not even one inherited.
        match crate::mcp::pane_env() {
            Some((var, socket)) => cmd.env(var, socket),
            None => cmd.env_remove(crate::mcp::SOCKET_ENV),
        }
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
            Via::Daemon(c) => c.write(id, data),
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

    /// The terminals the app holds itself whose shell is running something: what closing the
    /// window would end (`closing.rs`). The daemon's are never among them: they run on. Starts
    /// nothing.
    pub fn busy(&self) -> Vec<closing::Busy> {
        let here = match &self.hosting {
            Hosting::Here(h) => Some(h),
            #[cfg(unix)]
            Hosting::Daemon { fallback, .. } => fallback.get(),
        };
        let Some(host) = here else { return Vec::new() };
        // A table that cannot be read says nothing of what runs: nothing is asked, as before.
        crate::procs::table().map(|table| closing::busy(&host.list(), |pid| table.children(&[pid]), closing::name_of)).unwrap_or_default()
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

/// Runs `cmd` on `account`, in the variable of its kind: the default account with
/// `CLAUDE_CONFIG_DIR` unset, exactly as before there were accounts, even when the app itself was
/// started with it set; another Claude one with it set to that account's dir; a Grok one with
/// `GROK_HOME` unset (`~/.grok`) or set to its home. The other kind's variable is removed, so a
/// Grok pane never carries a Claude account's dir, nor the reverse, and `MNEMO_AGENT` says the
/// kind to mnemo (spec `2026-10-16-grok-accounts-design.md`, decision 3).
fn on_account(cmd: &mut CommandBuilder, account: &PaneAccount) {
    use crate::agent_kind::{AgentKind, AGENT_ENV};
    let var = account.kind.home_var();
    match &account.config_dir {
        Some(dir) => cmd.env(var, dir),
        None => cmd.env_remove(var),
    }
    for other in [AgentKind::Claude, AgentKind::Grok].into_iter().filter(|k| *k != account.kind) {
        cmd.env_remove(other.home_var());
    }
    cmd.env(AGENT_ENV, account.kind.as_str());
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

/// The question on close (#338), on every platform: these start a real shell, Windows' too.
#[cfg(test)]
mod closing_tests {
    use super::*;
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

    /// A terminal held by `manager`, its shell running `script` (`/bin/sh -c`, `cmd /d /c`), and
    /// what it has printed.
    fn shell(manager: &PtyManager, script: &str) -> (PaneId, Arc<Mutex<Vec<u8>>>) {
        let (program, args): (&str, Vec<String>) = if cfg!(windows) {
            // Word by word: `cmd` does not read the quotes portable-pty puts around a spaced argument.
            ("cmd.exe", ["/d", "/c"].into_iter().chain(script.split(' ')).map(String::from).collect())
        } else {
            ("/bin/sh", vec!["-c".into(), script.into()])
        };
        let program = std::env::var("COMSPEC").ok().filter(|_| cfg!(windows)).unwrap_or_else(|| program.into());
        let opts = SpawnOptions { program: Some(program), args, cwd: None, cols: 80, rows: 24, login: false };
        let printed = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&printed);
        let record = move |e| {
            if let Event::Output(b) = e {
                sink.lock().unwrap().extend(b);
            }
        };
        let id = manager.spawn(opts, Box::new(record)).expect("spawn");
        if cfg!(windows) {
            // A pseudoconsole asks where the cursor is before it starts; no terminal is drawn here.
            manager.write(id, b"\x1b[1;1R").unwrap();
        }
        (id, printed)
    }

    /// `manager.busy()` once it names `program`, within 30 s. `printed` is what its shell said.
    fn busy_with(manager: &PtyManager, program: &str, printed: &Mutex<Vec<u8>>) -> Vec<closing::Busy> {
        let deadline = Instant::now() + Duration::from_secs(30);
        loop {
            let busy = manager.busy();
            if busy.iter().any(|b| b.programs.iter().any(|p| p.eq_ignore_ascii_case(program))) {
                return busy;
            }
            if Instant::now() >= deadline {
                let (held, said) = (manager.list(), String::from_utf8_lossy(&printed.lock().unwrap()).into_owned());
                let table = crate::procs::table().unwrap_or_default();
                let below: Vec<_> = held.iter().flatten().map(|t| (t.pid, table.children(&[t.pid]))).collect();
                panic!("{program} never showed under a shell: busy {busy:?}, held {held:?}, processes {below:?}, printed {said:?}");
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    }

    #[test]
    fn closing_asks_when_a_terminal_held_here_is_running_something_and_not_over_idle_shells() {
        let m = PtyManager::with_shell_dir(None);
        assert_eq!(closing::question(&m.busy()), None, "no terminal, no question");
        // A shell waiting for a line, as at its prompt.
        let (idle, _) = shell(&m, if cfg!(windows) { "set /p x=" } else { "read x" });
        assert_eq!(closing::question(&m.busy()), None, "an idle shell loses nothing");

        // `; :` keeps sh from becoming the one command it was given.
        // On Windows a second `cmd`, by its full path, which needs nothing of the pane's `PATH`.
        let nested = format!("{} /d /c set /p y=", std::env::var("COMSPEC").unwrap_or_default());
        let (working, printed) = shell(&m, if cfg!(windows) { &nested } else { "sleep 60; :" });
        let program = if cfg!(windows) { "cmd" } else { "sleep" };
        let busy = busy_with(&m, program, &printed);
        assert_eq!(busy.len(), 1, "the idle shell is not among them: {busy:?}");
        let question = closing::question(&busy).expect("asked");
        assert!(question.to_lowercase().contains(program), "{question}");

        m.kill(working);
        let deadline = Instant::now() + Duration::from_secs(30);
        while !m.busy().is_empty() {
            assert!(Instant::now() < deadline, "still busy after its terminal was closed");
            std::thread::sleep(Duration::from_millis(50));
        }
        m.kill(idle);
    }

    /// An interactive shell at its prompt, as a pane runs it: what the question on close counts.
    struct Interactive {
        /// The shell, by full path.
        program: String,
        args: &'static [&'static str],
        /// A line that prints `PRODUCT`, which its own echo does not.
        product: &'static str,
        /// A line that runs `running` until it is ended.
        run: &'static str,
        running: &'static str,
    }

    /// 7919 × 7907: in no prompt, path or title a shell prints on its own.
    const PRODUCT: &str = "62615533";

    fn interactive_shells() -> Vec<Interactive> {
        if cfg!(windows) {
            let root = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into());
            vec![
                Interactive {
                    program: std::env::var("COMSPEC").unwrap_or_else(|_| format!(r"{root}\System32\cmd.exe")),
                    args: &[],
                    product: "set /a 7919*7907",
                    // By full path: see `closing_asks_…` above.
                    run: r#""%SystemRoot%\System32\PING.EXE" -n 120 127.0.0.1"#,
                    running: "ping",
                },
                Interactive {
                    program: format!(r"{root}\System32\WindowsPowerShell\v1.0\powershell.exe"),
                    args: &["-NoLogo", "-NoProfile"],
                    product: "7919*7907",
                    run: r#"& "$env:SystemRoot\System32\PING.EXE" -n 120 127.0.0.1"#,
                    running: "ping",
                },
            ]
        } else {
            ["/bin/bash", "/bin/zsh"]
                .into_iter()
                .filter(|p| Path::new(p).exists())
                .map(|p| Interactive { program: p.into(), args: &[], product: "echo $((7919*7907))", run: "sleep 120", running: "sleep" })
                .collect()
        }
    }

    /// #338 counts a program under a pane's shell as "running something". On a real pty (a
    /// pseudoconsole on Windows, where the console host could have been one) a shell waiting at
    /// its prompt has nothing under it, and a program typed there is under it.
    #[test]
    fn an_idle_shell_at_its_prompt_has_no_child_and_a_program_it_runs_is_one() {
        let shells = interactive_shells();
        assert!(!shells.is_empty(), "no shell to try");
        for shell in shells {
            let home = crate::testutil::temp_dir("pty-interactive");
            let m = PtyManager::with_shell_dir(None);
            let opts = SpawnOptions {
                program: Some(shell.program.clone()),
                args: shell.args.iter().map(|a| a.to_string()).collect(),
                cwd: Some(home.to_string_lossy().into_owned()),
                cols: 200,
                rows: 24,
                login: false,
            };
            let mut cmd = m.command(opts, default_shell());
            // No rc file of the person running the tests starts anything. An empty one: with none
            // at all zsh greets a new user with a menu instead of its prompt.
            std::fs::write(home.join(".zshrc"), "").unwrap();
            cmd.env("HOME", &home);
            cmd.env_remove("ZDOTDIR");
            let printed = Arc::new(Mutex::new(Vec::new()));
            let sink = Arc::clone(&printed);
            let record = move |e| {
                if let Event::Output(b) = e {
                    sink.lock().unwrap().extend(b);
                }
            };
            let id = m.launch(cmd, 24, 200, Box::new(record)).expect("spawn");
            if cfg!(windows) {
                m.write(id, b"\x1b[1;1R").unwrap();
            }
            let said = || String::from_utf8_lossy(&printed.lock().unwrap()).into_owned();
            let name = &shell.program;

            // At its prompt once it has answered a line it was typed.
            m.write(id, format!("{}\r", shell.product).as_bytes()).unwrap();
            let deadline = Instant::now() + Duration::from_secs(60);
            while !said().contains(PRODUCT) {
                assert!(Instant::now() < deadline, "{name} never answered: printed {:?}", said());
                std::thread::sleep(Duration::from_millis(50));
            }
            let pid = m.pid(id).expect("a live shell");
            for _ in 0..20 {
                std::thread::sleep(Duration::from_millis(100));
                let table = crate::procs::table().expect("the process table");
                let below: Vec<_> = table.children(&[pid]).into_iter().map(|p| (p, closing::name_of(p))).collect();
                assert!(below.is_empty(), "{name} at its prompt has {below:?} under it");
                assert_eq!(m.busy(), vec![], "{name} at its prompt");
            }

            m.write(id, format!("{}\r", shell.run).as_bytes()).unwrap();
            let busy = busy_with(&m, shell.running, &printed);
            assert_eq!(busy.len(), 1, "{name}: {busy:?}");
            assert!(closing::question(&busy).expect("asked").to_lowercase().contains(shell.running), "{name}: {busy:?}");
            m.kill(id);
            let _ = std::fs::remove_dir_all(&home);
        }
    }
}

/// The MCP socket a pane is pointed at, on every platform (#362).
#[cfg(test)]
mod mcp_env_tests {
    use super::*;

    #[test]
    fn a_pane_gets_the_mcp_socket_only_where_one_is_served() {
        // An app started from another app's pane inherits that app's socket.
        // SAFETY: nothing else in this binary reads this variable.
        unsafe { std::env::set_var(crate::mcp::SOCKET_ENV, "inherited.sock") };
        let program = if cfg!(windows) { "cmd.exe" } else { "/bin/sh" };
        let opts = SpawnOptions { program: Some(program.into()), args: vec![], cwd: None, cols: 80, rows: 24, login: false };
        let cmd = PtyManager::with_shell_dir(None).command(opts, program.into());
        let socket = crate::mcp::socket_path();
        let want = if cfg!(windows) { None } else { Some(socket.as_os_str()) };
        assert_eq!(cmd.get_env(crate::mcp::SOCKET_ENV), want);
    }
}

/// A pane's `PATH` on Windows (#371): what a terminal opened from the Start menu finds, a pane
/// finds. Only Windows: elsewhere a pane's login shell builds its own.
#[cfg(all(test, windows))]
mod windows_path_tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::{Duration, Instant};

    #[test]
    fn a_pane_finds_the_systems_own_tools_by_name() {
        let m = PtyManager::with_shell_dir(None);
        // `cmd` by name, whichever shell is the default: every pane gets the same `PATH`.
        let line = "where powershell && where ping && echo ALL-FOUND";
        let program = std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".into());
        let opts = SpawnOptions { program: Some(program), args: ["/d", "/c"].into_iter().chain(line.split(' ')).map(String::from).collect(), cwd: None, cols: 200, rows: 24, login: false };
        let (tx, rx) = mpsc::channel();
        let id = m.spawn(opts, Box::new(move |e| drop(tx.send(e)))).expect("spawn");
        // A pseudoconsole asks where the cursor is before it starts; no terminal is drawn here.
        m.write(id, b"\x1b[1;1R").unwrap();
        let (mut printed, mut exit) = (Vec::new(), None);
        let deadline = Instant::now() + Duration::from_secs(30);
        while exit.is_none() && Instant::now() < deadline {
            match rx.recv_timeout(Duration::from_millis(200)) {
                Ok(Event::Output(b)) => printed.extend(b),
                Ok(Event::Exit(code)) => exit = Some(code),
                Err(_) => {}
            }
        }
        m.kill(id);
        let said = String::from_utf8_lossy(&printed).into_owned();
        let path = crate::tools::pane_path();
        let found = |name: &str| crate::tools::Lookup::native().find(name, &path);
        let plain = crate::proc::command(std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".into()))
            .args(["/d", "/c", "where", "powershell"])
            .env("PATH", &path)
            .output()
            .map(|o| (o.status.code(), String::from_utf8_lossy(&o.stdout).into_owned(), String::from_utf8_lossy(&o.stderr).into_owned()));
        let inherited = std::env::var("PATH").unwrap_or_default();
        assert!(
            said.contains("ALL-FOUND"),
            "exit {exit:?}, printed {said:?}; the pane's PATH is {} chars, {} entries, powershell {:?}, ping {:?} in it; \
             the same PATH outside a pty: {plain:?}; registry {:?} chars; inherited {} chars: {inherited}; pane: {path}",
            path.len(),
            path.split(';').count(),
            found("powershell"),
            found("ping"),
            crate::tools::system_path().map(|s| s.len()),
            inherited.len(),
        );
        let said = said.to_ascii_lowercase();
        assert!(said.contains("powershell.exe") && said.contains("ping.exe"), "{said}");
    }
}

/// Terminals on a real pty: on Windows a pseudoconsole running `cmd`, where each test that has
/// one gives its script as `cmd` reads it. The daemon and the zsh/bash integration are unix only.
#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;

    /// The command line of a terminal running `script`: `/bin/sh -c`, or on Windows
    /// `cmd /d /v:on /c` (`!x!` reads `x` as it is when the line runs, not when it was read).
    fn script_args(script: &str) -> (String, Vec<String>) {
        if cfg!(windows) {
            // Word by word: `cmd` does not read the quotes portable-pty puts around a spaced argument.
            let comspec = std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".into());
            (comspec, ["/d", "/v:on", "/c"].into_iter().chain(script.split(' ')).map(String::from).collect())
        } else {
            ("/bin/sh".into(), vec!["-c".into(), script.into()])
        }
    }

    /// One of two scripts: `unix`'s for `/bin/sh`, `windows`' for `cmd`.
    fn either<'a>(unix: &'a str, windows: &'a str) -> &'a str {
        if cfg!(windows) {
            windows
        } else {
            unix
        }
    }

    fn sh(manager: &PtyManager, script: &str) -> (PaneId, mpsc::Receiver<Event>) {
        sh_in(manager, script, None)
    }

    /// On Windows, wide enough that no path a test prints is wrapped by the pseudoconsole.
    const COLS: u16 = if cfg!(windows) { 250 } else { 80 };

    fn sh_in(manager: &PtyManager, script: &str, cwd: Option<String>) -> (PaneId, mpsc::Receiver<Event>) {
        let (tx, rx) = mpsc::channel();
        let (program, args) = script_args(script);
        let id = manager
            .spawn(
                SpawnOptions { program: Some(program), args, cwd, cols: COLS, rows: 24, login: false },
                Box::new(move |e| {
                    let _ = tx.send(e);
                }),
            )
            .expect("spawn");
        if cfg!(windows) {
            // A pseudoconsole asks where the cursor is before it starts; no terminal is drawn here.
            let _ = manager.write(id, b"\x1b[1;1R");
        }
        (id, rx)
    }

    fn collect(rx: &mpsc::Receiver<Event>) -> (Vec<u8>, Option<Option<i32>>) {
        let mut out = Vec::new();
        let mut exit = None;
        let deadline = std::time::Instant::now() + Duration::from_secs(20);
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
        let (_id, rx) = sh(&m, either("printf hi", "echo hi"));
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
        let (a, _ra) = sh(&m, "exit 0");
        let (b, _rb) = sh(&m, "exit 0");
        assert!(b > a);
    }

    #[test]
    fn each_pane_runs_on_the_account_active_when_it_was_spawned() {
        let root = crate::accounts::short_temp_dir("pty");
        let place = crate::accounts::Place::new(root.join("home"), root.join("app"));
        let m = PtyManager::with_shell_dir(None).with_accounts(PaneAccounts::new(place.clone(), None));
        let probe = either(
            "printf '[%s|%s|%s]' \"${CLAUDE_CONFIG_DIR-unset}\" \"${GROK_HOME-unset}\" \"${MNEMO_AGENT-unset}\"",
            "(if defined CLAUDE_CONFIG_DIR (echo [!CLAUDE_CONFIG_DIR!]) else (echo [unset])) & (if defined GROK_HOME (echo [!GROK_HOME!]) else (echo [unset])) & (if defined MNEMO_AGENT (echo [!MNEMO_AGENT!]) else (echo [unset]))",
        );
        // That the pane's shell printed `CLAUDE_CONFIG_DIR`, `GROK_HOME` and `MNEMO_AGENT` as
        // `want`: on one line, or on Windows one line each, in order.
        let saw = |rx: &mpsc::Receiver<Event>, want: [&str; 3], why: &str| {
            let out = String::from_utf8_lossy(&collect(rx).0).to_string();
            let marks: Vec<String> = if cfg!(windows) { want.iter().map(|w| format!("[{w}]")).collect() } else { vec![format!("[{}]", want.join("|"))] };
            let mut at = 0;
            for mark in &marks {
                match out[at..].find(mark.as_str()) {
                    Some(i) => at += i + mark.len(),
                    None => panic!("{why}: {mark} not in {out:?}"),
                }
            }
        };
        let home = root.join("home");
        let (work_dir, side_dir) = (home.join(".claude-work").display().to_string(), home.join(".grok-side").display().to_string());

        let (default, rx) = sh(&m, probe);
        saw(&rx, ["unset", "unset", "claude"], "the default account leaves it unset");

        place.add("Work", crate::agent_kind::AgentKind::Claude).expect("add");
        let (work, rx) = sh(&m, probe);
        saw(&rx, [&work_dir, "unset", "claude"], "another Claude account");

        assert_eq!(m.pane_accounts().unwrap(), std::collections::HashMap::from([(default, "default".to_string()), (work, "work".to_string())]));
        m.kill(default);
        assert_eq!(m.pane_accounts().unwrap(), std::collections::HashMap::from([(work, "work".to_string())]));

        m.move_pane(work, "default").unwrap();
        assert_eq!(m.pane_accounts().unwrap(), std::collections::HashMap::from([(work, "default".to_string())]));
        assert_eq!(m.move_pane(default, "work"), Err(format!("no pane {default}")), "an ended pane is not recorded");

        // A Grok account: its own home in GROK_HOME, never the Claude account's dir.
        place.add("Grok", crate::agent_kind::AgentKind::Grok).expect("add grok");
        let (grok, rx) = sh(&m, probe);
        saw(&rx, ["unset", "unset", "grok"], "the Grok account at ~/.grok runs with GROK_HOME unset");
        place.add("Side", crate::agent_kind::AgentKind::Grok).expect("add side");
        let (side, rx) = sh(&m, probe);
        saw(&rx, ["unset", &side_dir, "grok"], "another Grok account");
        place.switch("work").unwrap();
        let (back, rx) = sh(&m, probe);
        saw(&rx, [&work_dir, "unset", "claude"], "and a Claude pane never carries a Grok home");
        let ids = m.pane_accounts().unwrap();
        assert_eq!((ids[&grok].as_str(), ids[&side].as_str(), ids[&back].as_str()), ("grok", "side", "work"));
    }

    #[test]
    fn env_is_set_for_the_child() {
        let m = PtyManager::new();
        let (_id, rx) = sh(&m, either("printf \"%s,%s\" \"$MNEMO_DESKTOP\" \"$TERM\"", "echo %MNEMO_DESKTOP%,%TERM%"));
        let (out, _) = collect(&rx);
        assert!(String::from_utf8_lossy(&out).contains("1,xterm-256color"), "got {:?}", out);
    }

    #[test]
    fn resize_live_pty_ok() {
        let m = PtyManager::new();
        let (id, rx) = sh(&m, either("sleep 2", "set /p x="));
        m.resize(id, 120, 40).expect("resize");
        m.kill(id);
        let (_, exit) = collect(&rx);
        assert!(exit.is_some(), "kill must end the reader with an Exit event");
    }

    #[test]
    fn kill_is_idempotent_and_unknown_is_noop() {
        let m = PtyManager::new();
        let (id, rx) = sh(&m, "exit 0");
        let _ = collect(&rx);
        m.kill(id);
        m.kill(id);
        m.kill(999_999);
    }

    #[test]
    fn write_reaches_the_child() {
        let m = PtyManager::new();
        let (id, rx) = sh(&m, either("read x; printf \"got:%s\" \"$x\"", "set /p x= & echo got:!x!"));
        m.write(id, if cfg!(windows) { b"abc\r" } else { b"abc\n" }).expect("write");
        let (out, exit) = collect(&rx);
        assert!(String::from_utf8_lossy(&out).contains("got:abc"), "got {:?}", out);
        assert_eq!(exit, Some(Some(0)));
    }

    #[test]
    fn pid_is_the_spawned_child_until_it_exits() {
        let m = PtyManager::new();
        let (id, rx) = sh(&m, either("read x", "set /p x="));
        let pid = m.pid(id).expect("a live pane has a pid");
        assert_eq!(crate::procs::table().unwrap().parent(pid), Some(std::process::id()));
        m.write(id, if cfg!(windows) { b"\r" } else { b"\n" }).unwrap();
        let _ = collect(&rx);
        assert_eq!(m.pid(id), None);
        assert_eq!(m.pid(999_999), None);
    }

    #[test]
    fn write_after_exit_is_error() {
        let m = PtyManager::new();
        let (id, rx) = sh(&m, "exit 0");
        let _ = collect(&rx);
        assert!(m.write(id, b"x").is_err());
    }

    #[cfg(unix)]
    fn tmp(tag: &str) -> PathBuf {
        let d = crate::testutil::temp_dir(&format!("pty-{tag}"));
        d
    }

    #[cfg(unix)]
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
    #[cfg(unix)]
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

    #[cfg(unix)]
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

    #[cfg(unix)]
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

    #[cfg(unix)]
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

    #[cfg(unix)]
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
        let home = home_dir().expect("a home");
        // macOS reaches a home under /var through a link; Windows names it as USERPROFILE does.
        let home = if cfg!(windows) { home } else { std::fs::canonicalize(&home).unwrap() };
        for cwd in [None, Some(if cfg!(windows) { r"C:\definitely\not\a\dir" } else { "/definitely/not/a/dir" }.to_string())] {
            let m = PtyManager::new();
            let (_, rx) = sh_in(&m, either("pwd -P", "cd"), cwd);
            let (out, _) = collect(&rx);
            assert!(String::from_utf8_lossy(&out).contains(&*home.to_string_lossy()), "got {:?}", String::from_utf8_lossy(&out));
        }
    }

    #[test]
    fn cwd_is_honoured() {
        let dir = crate::testutil::temp_dir("pty-cwd");
        let m = PtyManager::new();
        let (_, rx) = sh_in(&m, either("pwd", "cd"), Some(dir.to_string_lossy().into_owned()));
        let (out, _) = collect(&rx);
        let s = String::from_utf8_lossy(&out);
        // By its own name: the folder above it may be spelled another way (a link, a short name).
        assert!(s.contains(&*dir.file_name().unwrap().to_string_lossy()), "got {s:?}");
    }

    // -- terminals held by a daemon (server.rs, in-process here; tests/ptyd.rs runs the binary) --

    #[cfg(unix)]
    use std::os::unix::net::UnixListener;
    use std::time::Instant;

    #[cfg(unix)]
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

    #[cfg(unix)]
    /// An app: talks to the daemon at `socket`, and has no binary to start one with.
    fn app(socket: &Path) -> PtyManager {
        PtyManager::with_daemon(socket.to_path_buf(), PathBuf::from("/nonexistent/mnemo-desktop-ptyd"), None)
    }

    /// The other half of the question on close (#338): what the daemon holds runs on.
    #[cfg(unix)]
    #[test]
    fn closing_asks_nothing_over_terminals_the_daemon_holds() {
        let (socket, srv, _rx) = daemon("closing");
        let m = app(&socket);
        let (id, _out) = sh(&m, "sleep 60; :");
        let pid = m.pid(id).expect("a running shell");
        eventually("the shell to start its program", || crate::procs::table().is_ok_and(|t| !t.children(&[pid]).is_empty()));
        assert!(m.busy().is_empty(), "the daemon keeps it: nothing to ask");
        assert_eq!(closing::question(&m.busy()), None);
        m.kill(id);
        drop(srv);
    }

    #[cfg(unix)]
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

    #[cfg(unix)]
    fn eventually(what: &str, mut f: impl FnMut() -> bool) {
        let deadline = Instant::now() + Duration::from_secs(5);
        while !f() {
            assert!(Instant::now() < deadline, "timed out waiting for {what}");
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    #[cfg(unix)]
    fn recorder() -> (Sink, mpsc::Receiver<Event>) {
        let (tx, rx) = mpsc::channel();
        (
            Box::new(move |e| {
                let _ = tx.send(e);
            }),
            rx,
        )
    }

    #[cfg(unix)]
    #[test]
    fn a_shell_outlives_the_app_and_the_next_one_attaches_with_its_screen() {
        let (socket, srv, _) = daemon("keep");
        let first = app(&socket);
        let (id, rx) = sh(&first, "printf 'ready\\n'; while read x; do printf 'got:%s\\n' \"$x\"; done");
        assert!((7_000..8_000).contains(&id), "the daemon's ids, not the app's: {id}");
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

    #[cfg(unix)]
    #[test]
    fn a_shell_that_ended_while_the_app_was_away_is_listed_dead_until_killed() {
        let (socket, _srv, _) = daemon("dead");
        let first = app(&socket);
        let (id, rx) = sh(&first, "read x; exit 4");
        drop(first);
        drop(rx);
        let second = app(&socket);
        second.list().unwrap();
        // Typed by nobody: end it from the daemon's side. An app types only into what it hears.
        let third = app(&socket);
        let (sink, _) = recorder();
        third.attach(id, sink).unwrap();
        third.write(id, b"\n").unwrap();
        eventually("the exit", || second.list().unwrap().first().is_some_and(|i| !i.alive));
        let (sink, _) = recorder();
        assert!(second.attach(id, sink).unwrap_err().contains("exited"));
        second.kill(id);
        assert!(second.list().unwrap().is_empty());
    }

    /// #405: what is typed, pasted or dictated into a pane whose shell ended, or into no pane,
    /// fails through the daemon as it does in process (`write_after_exit_is_error`).
    #[cfg(unix)]
    #[test]
    fn a_write_through_the_daemon_to_a_shell_that_exited_or_to_no_pane_fails() {
        let (socket, _srv, _) = daemon("wexit");
        let m = app(&socket);
        let (id, rx) = sh(&m, "exit 3");
        assert_eq!(collect(&rx).1, Some(Some(3)));
        let err = m.write(id, b"x").unwrap_err();
        assert_eq!(err, format!("pane {id} has exited"));
        assert_eq!(m.write(999_999, b"x").unwrap_err(), "pane 999999 not found");
    }

    #[cfg(unix)]
    #[test]
    fn a_write_through_the_daemon_reaches_a_live_shell() {
        let (socket, _srv, _) = daemon("wlive");
        let m = app(&socket);
        let (id, rx) = sh(&m, "read x; printf 'got:%s' \"$x\"; exit 0");
        m.write(id, b"abc\n").unwrap();
        let (out, exit) = collect(&rx);
        assert!(String::from_utf8_lossy(&out).contains("got:abc"), "{out:?}");
        assert_eq!(exit, Some(Some(0)));
        // A shell the app attached to after it started takes what is typed too.
        let (id, _) = sh(&m, "read x; printf 'then:%s' \"$x\"; read y");
        let second = app(&socket);
        let (sink, rx2) = recorder();
        second.attach(id, sink).unwrap();
        second.write(id, b"def\n").unwrap();
        assert!(until(&rx2, "then:def").contains("then:def"));
        second.kill(id);
    }

    #[cfg(unix)]
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

    #[cfg(unix)]
    #[test]
    fn no_daemon_and_no_binary_means_terminals_held_in_process() {
        let socket = tmp("none").join(SOCKET);
        let m = app(&socket);
        let (id, rx) = sh(&m, "printf here");
        // The first id of an in-process launch's block (`Host::default`), not a daemon's.
        assert_eq!(id % 1_000, 1, "{id}");
        assert!(until(&rx, "here").contains("here"));
        // The same host keeps answering: no second attempt at a daemon.
        let (id2, _) = sh(&m, "true");
        assert_eq!(id2, id + 1);
        m.release();
    }

    #[cfg(unix)]
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

    #[cfg(unix)]
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

/// The shell integration on Windows (#360): what each shell is started with, on every platform,
/// and on Windows a real pane of each installed shell whose `cd` the app follows.
#[cfg(test)]
mod windows_integration_tests {
    use super::*;

    fn opts(cwd: &Path) -> SpawnOptions {
        SpawnOptions { program: None, args: vec![], cwd: Some(cwd.to_string_lossy().into_owned()), cols: 80, rows: 24, login: true }
    }

    fn decoded(b64: &std::ffi::OsStr) -> String {
        use base64::Engine;
        let bytes = base64::engine::general_purpose::STANDARD.decode(b64.to_str().unwrap()).unwrap();
        let wide: Vec<u16> = bytes.chunks(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
        String::from_utf16(&wide).unwrap()
    }

    #[test]
    fn powershell_starts_with_its_prompt_hook_and_cmd_with_its_prompt() {
        let dir = crate::testutil::temp_dir("pty-win-integration");
        let m = PtyManager::with_shell_dir(Some(dir.clone()));
        for ps in [r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe", r"C:\Program Files\PowerShell\7\pwsh.exe"] {
            let cmd = m.command(opts(&dir), ps.into());
            let argv = cmd.get_argv();
            assert_eq!(argv[1..3], ["-NoExit", "-EncodedCommand"], "{ps}");
            assert_eq!(argv.len(), 4, "no -l for PowerShell: {argv:?}");
            assert_eq!(decoded(&argv[3]), POWERSHELL_HOOK);
            assert_eq!(cmd.get_env("PROMPT"), std::env::var_os("PROMPT").as_deref(), "{ps}");
        }
        let cmd = m.command(opts(&dir), r"C:\Windows\system32\cmd.exe".into());
        assert_eq!(cmd.get_argv().len(), 1, "cmd takes no argument: {:?}", cmd.get_argv());
        assert_eq!(cmd.get_env("PROMPT").unwrap().to_str().unwrap(), cmd_prompt(std::env::var("PROMPT").ok().as_deref()));

        // Git Bash is bash: the same rc file, and the login files through it.
        let bash = m.command(opts(&dir), r"C:\Program Files\Git\bin\bash.exe".into());
        assert_eq!(bash.get_argv()[1..], ["--rcfile".as_ref(), dir.join("bash").join("mnemo.bashrc").as_os_str()]);
        assert_eq!(bash.get_env("MNEMO_BASH_LOGIN"), Some("1".as_ref()));

        // Integration off, or a program asked for by name: run as given.
        let off = PtyManager::with_shell_dir(None).command(opts(&dir), r"C:\Windows\system32\cmd.exe".into());
        assert_eq!(off.get_env("PROMPT"), std::env::var_os("PROMPT").as_deref());
        // `-l` is read by no Windows shell but bash; elsewhere every login shell gets it, as before.
        assert_eq!(off.get_argv().len(), if cfg!(windows) { 1 } else { 2 });
        let mut asked = opts(&dir);
        asked.program = Some("powershell.exe".into());
        asked.login = false;
        assert_eq!(m.command(asked, "cmd.exe".into()).get_argv().len(), 1);
    }

    #[test]
    fn cmd_prompt_reports_the_folder_before_the_persons_own_once() {
        assert_eq!(cmd_prompt(None), "$e]9;9;$P$e\\$P$G");
        assert_eq!(cmd_prompt(Some("")), "$e]9;9;$P$e\\$P$G");
        assert_eq!(cmd_prompt(Some("$N$G")), "$e]9;9;$P$e\\$N$G");
        assert_eq!(cmd_prompt(Some(&cmd_prompt(Some("$N$G")))), "$e]9;9;$P$e\\$N$G");
    }

    #[test]
    fn the_powershell_hook_wraps_the_prompt_there_was() {
        // The prompt the profile left runs first, so `PS C:\…>` still starts the line the app
        // reads a shell from (`src/pty/typed.ts`, `shellOf`).
        let wrapped = POWERSHELL_HOOK.find("& $global:__mnemo_prompt").expect("calls the old prompt");
        assert!(POWERSHELL_HOOK.find("$global:__mnemo_prompt = $function:prompt").unwrap() < wrapped);
        assert!(POWERSHELL_HOOK.contains("]9;9;$($loc.ProviderPath)$([char]27)\\\" + $out"));
    }

    /// A real pane of `shell`, started in one folder, told to `cd` (`typed(folder)`) into another:
    /// what the app holds as its folder follows it. Only Windows has these shells.
    #[cfg(windows)]
    fn follows(shell: &str, typed: impl Fn(&Path) -> String) {
        use std::time::{Duration, Instant};
        let root = crate::testutil::temp_dir("pty-follow");
        let (from, to) = (root.join("start here"), root.join("gone there"));
        std::fs::create_dir_all(&from).unwrap();
        std::fs::create_dir_all(&to).unwrap();
        let m = PtyManager::with_shell_dir(Some(root.join("shell")));
        let mut cmd = m.command(opts(&from), shell.into());
        cmd.env_remove("MNEMO_NO_SHELL_INTEGRATION");
        let printed = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let sink = std::sync::Arc::clone(&printed);
        let id = m
            .launch(
                cmd,
                24,
                120,
                Box::new(move |e| {
                    if let Event::Output(b) = e {
                        sink.lock().unwrap().extend(b);
                    }
                }),
            )
            .expect("spawn");
        // A pseudoconsole asks where the cursor is before it starts; no terminal is drawn here.
        m.write(id, b"\x1b[1;1R").unwrap();
        let same = |reported: &str, want: &Path| std::fs::canonicalize(reported).ok() == std::fs::canonicalize(want).ok();
        let wait = |want: &Path| {
            let deadline = Instant::now() + Duration::from_secs(60);
            loop {
                let cwd = m.list().unwrap().into_iter().find(|i| i.id == id).map(|i| i.cwd).unwrap_or_default();
                if same(&cwd, want) {
                    return cwd;
                }
                let said = String::from_utf8_lossy(&printed.lock().unwrap()).into_owned();
                assert!(Instant::now() < deadline, "{shell}: the folder held is {cwd:?}, not {}; it printed {said:?}", want.display());
                std::thread::sleep(Duration::from_millis(100));
            }
        };
        // Its first prompt reports where it started; then it follows the `cd`.
        let first = wait(&from);
        m.write(id, format!("{}\r", typed(&to)).as_bytes()).unwrap();
        let then = wait(&to);
        eprintln!("{shell}: followed {first:?} -> {then:?}");
        m.kill(id);
    }

    #[cfg(windows)]
    fn installed(id: &str) -> Option<String> {
        let found = shells::installed(&|v| std::env::var(v).ok(), &|p| p.is_file());
        let path = found.into_iter().find(|f| f.id == id).map(|f| f.path);
        if path.is_none() {
            eprintln!("{id} is not installed here: not tried");
        }
        path
    }

    #[cfg(windows)]
    #[test]
    fn a_windows_powershell_pane_is_followed_into_the_folder_it_cds_to() {
        follows(&installed("powershell").expect("Windows PowerShell ships with Windows"), |to| format!("cd '{}'", to.display()));
    }

    #[cfg(windows)]
    #[test]
    fn a_pwsh_pane_is_followed_into_the_folder_it_cds_to() {
        if let Some(pwsh) = installed("pwsh") {
            follows(&pwsh, |to| format!("cd '{}'", to.display()));
        }
    }

    #[cfg(windows)]
    #[test]
    fn a_cmd_pane_is_followed_into_the_folder_it_cds_to() {
        follows(&installed("cmd").expect("cmd ships with Windows"), |to| format!("cd /d \"{}\"", to.display()));
    }

    #[cfg(windows)]
    #[test]
    fn a_git_bash_pane_is_followed_into_the_folder_it_cds_to() {
        if let Some(bash) = installed("git-bash") {
            follows(&bash, |to| format!("cd '{}'", to.display().to_string().replace('\\', "/")));
        }
    }
}

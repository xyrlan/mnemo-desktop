//! Which Claude Code session a terminal pane runs when `claude` was typed by hand: the pids of
//! every account's `claude agents` matched against the process tree under the pane's shell. That
//! answer is the app's one per account, shared with the mission poll and Home
//! (`mission::agents_of`).
//!
//! Grok Build's TUI is no process its roster names: the leader runs the session, the TUI is one of
//! its clients. A pane runs Grok when a `grok` process that is its TUI (`grok_tui`) is under the
//! shell, and its session is the id that process was started with (`-s`/`--session-id` for a new
//! one, `-r`/`--resume` for one resumed: `grok --help`, 1.0.60). Command lines are read only when
//! there is a Grok account, so a machine with only Claude accounts starts nothing new.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub use crate::procs::parent_of;

/// A value per key that is recomputed once it is older than `ttl`. Misses (`None`) are cached
/// too. Not single-flight: `mission/spawn_tests.rs` replays the old pane poll with it.
pub struct Cache<T> {
    ttl: Duration,
    entries: Mutex<HashMap<String, (Instant, T)>>,
}

impl<T: Clone> Cache<T> {
    pub fn new(ttl: Duration) -> Self {
        Self { ttl, entries: Mutex::new(HashMap::new()) }
    }

    pub fn get_or(&self, key: &str, now: Instant, compute: impl FnOnce() -> T) -> T {
        if let Some((at, v)) = self.entries.lock().unwrap().get(key) {
            if now.saturating_duration_since(*at) < self.ttl {
                return v.clone();
            }
        }
        // Computed outside the lock: a slow `git` in one pane must not stall the others.
        let v = compute();
        let mut entries = self.entries.lock().unwrap();
        entries.retain(|_, (at, _)| now.saturating_duration_since(*at) < self.ttl);
        entries.insert(key.to_string(), (now, v.clone()));
        v
    }
}

/// How deep under a pane's shell a Claude session is looked for: a wrapper script and `npx`
/// put it at depth 3.
const MAX_DEPTH: usize = 6;

/// A live Claude Code process: `pid` → (`sessionId`, `startedAt`), from `claude agents --json`.
/// Rows without a pid (finished background jobs) are dropped.
pub fn parse_agent_pids(json: &str) -> HashMap<u32, (String, u64)> {
    let rows: Vec<serde_json::Value> = serde_json::from_str(json).unwrap_or_default();
    rows.iter()
        .filter_map(|r| {
            let pid = u32::try_from(r.get("pid")?.as_u64()?).ok()?;
            let session = r.get("sessionId")?.as_str()?.to_string();
            Some((pid, (session, r.get("startedAt").and_then(|t| t.as_u64()).unwrap_or(0))))
        })
        .collect()
}

/// Every account's `claude agents` answer asked at or after `not_before`, shared with every other
/// caller (`mission::agents_since`). Each account keeps its own `sessions/`, so a `claude` started
/// in a pane on another account is listed by that account's answer only. A failed answer names
/// its account.
pub fn ask_agents(not_before: Instant) -> Vec<Result<String, String>> {
    ask_agents_on(&crate::mission::account_dirs::accounts(), not_before)
}

fn ask_agents_on(accounts: &crate::mission::account_dirs::Accounts, not_before: Instant) -> Vec<Result<String, String>> {
    crate::mission::agents_since(accounts, not_before)
        .into_iter()
        .map(|(a, got)| got.map_err(|e| crate::mission::on_account_error(a, e)))
        .collect()
}

/// The accounts' answers as one table: pids are the system's, so rows from two accounts never
/// collide. None only when no account could say.
pub fn merge_agents(answers: impl IntoIterator<Item = Result<String, String>>) -> Option<HashMap<u32, (String, u64)>> {
    answers.into_iter().filter_map(Result::ok).map(|j| parse_agent_pids(&j)).reduce(|mut all, more| {
        all.extend(more);
        all
    })
}

/// The live Claude processes on every account, from a `claude agents` answer at most
/// `AGENTS_FRESH` old.
fn live_agents() -> Option<HashMap<u32, (String, u64)>> {
    let now = Instant::now();
    merge_agents(ask_agents(now.checked_sub(crate::mission::AGENTS_FRESH).unwrap_or(now)))
}

/// The session of the Claude process nearest below `root` (or `root` itself), walking the tree
/// a level at a time: `children` answers every pid parented by any of the given ones
/// (`procs::Table::children`). A session's own descendants are not searched, so a `claude` run by
/// that session's tools does not take its place; two at one depth pick the newest.
pub fn session_below(root: u32, agents: &HashMap<u32, (String, u64)>, mut children: impl FnMut(&[u32]) -> Vec<u32>) -> Option<String> {
    let newest = |pids: &[u32]| pids.iter().filter_map(|p| agents.get(p)).max_by_key(|(_, at)| *at).map(|(s, _)| s.clone());
    if let Some(s) = newest(&[root]) {
        return Some(s);
    }
    let mut seen = std::collections::HashSet::from([root]);
    let mut level = vec![root];
    for _ in 0..MAX_DEPTH {
        level = children(&level).into_iter().filter(|p| seen.insert(*p)).collect();
        if level.is_empty() {
            return None;
        }
        if let Some(s) = newest(&level) {
            return Some(s);
        }
    }
    None
}

/// The walk down from a pane's shell, over one reading of the process table. An error is "cannot
/// tell": the table could not be read, which is not "nothing runs under the pane".
fn children_of() -> Result<impl FnMut(&[u32]) -> Vec<u32>, String> {
    let table = crate::procs::table()?;
    Ok(move |pids: &[u32]| table.children(pids))
}

/// What `claude agents` failing on every account means for a pane: the app cannot tell what runs in
/// it, which is never "no Claude runs there" (#460). A pane keeps the session it had, and nothing
/// is ended, adopted as a bare shell or resumed a second time on this answer.
pub const AGENTS_CANNOT_SAY: &str = "claude agents could not say which Claude sessions run";

/// The Claude Code session running under a pane's shell, None when there is none. An error when the
/// process tree could not be walked, or when `claude agents` could not answer on any account
/// (`AGENTS_CANNOT_SAY`; `claude` not installed reads the same).
///
/// A Grok TUI under it gives the session it was started on, whatever `claude agents` says or fails
/// to; one started bare (no id on its command line) gives none.
pub fn session_of(pane_pid: u32) -> Result<Option<String>, String> {
    let agents = live_agents();
    if let Some(agents) = agents.as_ref().filter(|a| !a.is_empty()) {
        if let Some(s) = session_below(pane_pid, agents, children_of()?) {
            return Ok(Some(s));
        }
    }
    if grok_accounts() {
        if let Some(found) = grok_below(pane_pid, children_of()?, process_args) {
            return Ok(found);
        }
    }
    match agents {
        None => Err(AGENTS_CANNOT_SAY.to_string()),
        Some(_) => Ok(None),
    }
}

// ---------------------------------------------------------------- grok --

/// What `grok` names that is not its TUI: the leader and its bridge (`agent`), and the commands that
/// print and exit (`grok --help`, 1.0.60).
const GROK_NOT_TUI: &[&str] = &[
    "agent", "leader", "login", "logout", "models", "inspect", "export", "memory", "mcp", "update", "completions", "cursor-worker", "help", "plugin", "plugins", "worktree",
];

/// Flags that make `grok` a headless run or a printout rather than the TUI.
const GROK_HEADLESS: &[&str] = &["-p", "--single", "--prompt-file", "--prompt-json", "-v", "--version", "-h", "--help"];

/// Whether `s` is a UUID as Grok reads one: `grok -r` takes anything else as a title.
fn uuid_shaped(s: &str) -> bool {
    s.len() == 36 && s.char_indices().all(|(i, c)| if matches!(i, 8 | 13 | 18 | 23) { c == '-' } else { c.is_ascii_hexdigit() })
}

/// What a process with command line `args` is: None when it is not Grok's TUI; Some of the session
/// it was started on when it is, the id after `-s`/`--session-id` (a new session, also the fork's
/// with `--fork-session`) else after `-r`/`--resume`, None when it names neither.
pub fn grok_tui(args: &str) -> Option<Option<String>> {
    let mut words = args.split_whitespace();
    let program = words.next()?;
    let name = program.rsplit(['/', '\\']).next().unwrap_or(program);
    if !name.eq_ignore_ascii_case("grok") && !name.eq_ignore_ascii_case("grok.exe") {
        return None;
    }
    let words: Vec<&str> = words.collect();
    if words.iter().any(|w| GROK_HEADLESS.contains(w)) {
        return None;
    }
    if words.iter().find(|w| !w.starts_with('-')).is_some_and(|w| GROK_NOT_TUI.contains(w)) {
        return None;
    }
    let after = |flags: &[&str]| {
        words.iter().enumerate().find_map(|(i, w)| {
            let value = flags.iter().find_map(|f| w.strip_prefix(&format!("{f}="))).or_else(|| flags.contains(w).then(|| words.get(i + 1).copied()).flatten())?;
            uuid_shaped(value).then(|| value.to_ascii_lowercase())
        })
    };
    Some(after(&["-s", "--session-id"]).or_else(|| after(&["-r", "--resume"])))
}

/// The Grok TUI nearest below `root` (`grok_tui`), walking the tree as `session_below` does over
/// one reading of every command line in it (`args_of`). None when there is none, and when nothing
/// runs under `root` at all, which asks no command line.
pub fn grok_below(root: u32, mut children: impl FnMut(&[u32]) -> Vec<u32>, args_of: impl FnOnce(&[u32]) -> HashMap<u32, String>) -> Option<Option<String>> {
    let mut seen = std::collections::HashSet::from([root]);
    let mut levels = vec![vec![root]];
    for _ in 0..MAX_DEPTH {
        let next: Vec<u32> = children(levels.last()?).into_iter().filter(|p| seen.insert(*p)).collect();
        if next.is_empty() {
            break;
        }
        levels.push(next);
    }
    if levels.len() == 1 {
        return None;
    }
    let args = args_of(&levels.concat());
    levels.iter().find_map(|level| level.iter().find_map(|p| args.get(p).and_then(|a| grok_tui(a))))
}

/// The command line of each of `pids` that is running, from `ps`; empty where there is none to ask
/// (Windows) or it fails.
pub fn process_args(pids: &[u32]) -> HashMap<u32, String> {
    if cfg!(windows) || pids.is_empty() {
        return HashMap::new();
    }
    let list = pids.iter().map(u32::to_string).collect::<Vec<_>>().join(",");
    let Ok(out) = crate::proc::command("ps").args(["-o", "pid=,args=", "-p", &list]).stdin(std::process::Stdio::null()).output() else { return HashMap::new() };
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .filter_map(|l| {
            let (pid, args) = l.trim_start().split_once(char::is_whitespace)?;
            Some((pid.parse().ok()?, args.trim().to_string()))
        })
        .collect()
}

/// Whether the app has a Grok account: only then is a pane's command line read for one.
fn grok_accounts() -> bool {
    crate::mission::grok::accounts_of(&crate::mission::account_dirs::accounts()).next().is_some()
}

/// The pids of the live Claude Code sessions on every account, from `claude agents --json` at most
/// a few seconds old; empty when `claude` cannot say.
pub fn claude_pids() -> Vec<u32> {
    live_agents().map(|a| a.into_keys().collect()).unwrap_or_default()
}

/// Whether `pid` is alive and is `root` or sits below it, at most `MAX_DEPTH` levels down, walking
/// up through `parent` (None: the process is gone). A pid that is not alive is under nothing.
pub fn under(root: u32, pid: u32, parent: impl Fn(u32) -> Option<u32>) -> bool {
    let mut at = pid;
    for _ in 0..=MAX_DEPTH {
        let Some(up) = parent(at) else { return false };
        if at == root {
            return true;
        }
        if up <= 1 || up == at {
            return false;
        }
        at = up;
    }
    false
}

/// How old a `claude agents` answer may be and still vouch for a pid: the panes' 5 s poll keeps
/// it younger than this, and pids are not reused within it.
const VOUCH: Duration = Duration::from_secs(30);

/// Whether a Claude Code process runs under the pane's shell `pane_pid`. First the last few
/// seconds' `claude agents` answer, checked live: one of its pids still alive under the pane is
/// enough, and costs no process spawn. A Claude that exited is gone from the process table, so
/// it is refused at once. Only when no cached pid vouches (none cached, or a Claude started since)
/// is `claude agents` asked again, and its answer kept for the next check. The tree under the pane
/// is then read by `walk`, after that answer and not before it: its error is "cannot tell", and is
/// never turned into "Claude is not running". Nor is a `claude agents` that no account answered
/// (`AGENTS_CANNOT_SAY`).
pub fn claude_running<W: FnMut(&[u32]) -> Vec<u32>>(
    pane_pid: u32,
    cached: Option<(Instant, Option<HashMap<u32, (String, u64)>>)>,
    now: Instant,
    parent: impl Fn(u32) -> Option<u32>,
    fresh: impl FnOnce() -> Option<HashMap<u32, (String, u64)>>,
    walk: impl FnOnce() -> Result<W, String>,
) -> Result<bool, String> {
    if let Some((at, Some(agents))) = &cached {
        if now.saturating_duration_since(*at) < VOUCH && agents.keys().any(|&pid| under(pane_pid, pid, &parent)) {
            return Ok(true);
        }
    }
    match fresh() {
        Some(agents) if agents.is_empty() => Ok(false),
        Some(agents) => Ok(session_below(pane_pid, &agents, walk()?).is_some()),
        None => Err(AGENTS_CANNOT_SAY.to_string()),
    }
}

/// The Claude Code session a terminal pane runs, given its shell's pid (`pty_pid`). An error when
/// the app cannot tell: the pane keeps the session it had.
#[tauri::command]
pub async fn chrome_session(pane_pid: u32) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || session_of(pane_pid)).await.map_err(|e| e.to_string())?
}

/// `claude_running` over the app's accounts and the live process table.
fn claude_running_now(pane_pid: u32) -> Result<bool, String> {
    let now = Instant::now();
    let accounts = crate::mission::account_dirs::accounts();
    let cached = crate::mission::agents_last(&accounts).map(|(at, answers)| (at, merge_agents(answers)));
    // Asked after this call began; a caller asking at the same moment shares it.
    let fresh = || merge_agents(ask_agents_on(&accounts, Instant::now()));
    claude_running(pane_pid, cached, now, crate::procs::parents(), fresh, children_of)
}

/// Whether a terminal pane runs Claude Code this moment: the gate before keys are typed into it.
/// A shell at its prompt has no Claude in its terminal, which needs no `claude agents` (it may be
/// failing, or `claude` missing: #460). Else a pid from the cached `claude agents` answer is
/// checked live, so this is cheap and still refuses the moment Claude exits (`claude_running`). An
/// error when the app cannot tell, which the person is told as that and not as "Claude is no
/// longer running".
#[tauri::command]
pub async fn chrome_claude_running(pane_pid: u32) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let shell = crate::procs::table().map(|t| shell_of(pane_pid, |p| t.children(p), crate::procs::image_of, crate::procs::groups));
        claude_gate(shell, || claude_running_now(pane_pid))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// What a pane's shell is doing, from the process table (#460).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Shell {
    /// It runs nothing.
    Bare,
    /// It is at its prompt, and what it started runs in the background: in groups of its own, not
    /// the terminal's (powerlevel10k's `gitstatusd`, a job started with `&`).
    Background,
    /// Something it started is in the terminal's foreground group; or it runs something, and the
    /// system has no groups to say whose turn the terminal is (Windows).
    Busy,
}

/// The process a pane's shell is, given its pid: that one, unless it is Git for Windows'
/// `bin\bash.exe`. That is a redirector (`git-wrapper.c`): it starts `usr\bin\bash.exe` beside
/// it and waits, so its one child is the shell, and what that runs is what the pane runs.
pub fn real_shell(pane_pid: u32, children: &[u32], image: impl Fn(u32) -> Option<String>) -> u32 {
    let [only] = children else { return pane_pid };
    let (Some(outer), Some(inner)) = (image(pane_pid), image(*only)) else { return pane_pid };
    let path = |p: String| p.to_ascii_lowercase().replace('/', "\\");
    let (outer, inner) = (path(outer), path(inner));
    match outer.strip_suffix("\\bin\\bash.exe") {
        Some(git) if inner == format!("{git}\\usr\\bin\\bash.exe") => *only,
        _ => pane_pid,
    }
}

/// The state of shell `shell` with `children`. It is at its prompt when the terminal's foreground
/// group is its own and none of its children is in it: a shell without job control (pwsh on macOS
/// or Linux, zsh with `no_monitor`) keeps the program in front in its own group, as it keeps a
/// job started with `&`, and both read busy. One whose groups cannot be read reads busy too.
pub fn shell_state(shell: u32, children: &[u32], groups: impl Fn(u32) -> Option<crate::procs::Groups>) -> Shell {
    if children.is_empty() {
        return Shell::Bare;
    }
    let Some(own) = groups(shell) else { return Shell::Busy };
    let behind = |pid: &u32| groups(*pid).is_some_and(|g| g.pgid != own.foreground);
    if own.pgid == own.foreground && children.iter().all(behind) {
        Shell::Background
    } else {
        Shell::Busy
    }
}

/// Whether `image` is Windows' console host (`System32\conhost.exe`). A console program started
/// with no console to share (`CREATE_NO_WINDOW`, a parent with none) gets a console of its own,
/// and its host runs as that program's child: no program it was asked to run. A pane's shell
/// shares the app's pseudoconsole, whose host is the app's child, not the shell's.
fn console_host(image: Option<String>) -> bool {
    image.is_some_and(|p| p.to_ascii_lowercase().replace('/', "\\").ends_with("\\system32\\conhost.exe"))
}

/// What pane `pane_pid`'s shell is doing (`Shell`), through Git Bash's redirector (`real_shell`),
/// its own console host aside (`console_host`).
pub fn shell_of(
    pane_pid: u32,
    children: impl Fn(&[u32]) -> Vec<u32>,
    image: impl Fn(u32) -> Option<String>,
    groups: impl Fn(u32) -> Option<crate::procs::Groups>,
) -> Shell {
    let runs = |pid: u32| children(&[pid]).into_iter().filter(|c| !console_host(image(*c))).collect::<Vec<u32>>();
    let shell = real_shell(pane_pid, &runs(pane_pid), &image);
    shell_state(shell, &runs(shell), groups)
}

/// `running`, unless the shell is at its prompt: no Claude has the terminal then, and `claude
/// agents` is not asked. A table that could not be read leaves it to `running`.
fn claude_gate(shell: Result<Shell, String>, running: impl FnOnce() -> Result<bool, String>) -> Result<bool, String> {
    match shell {
        Ok(Shell::Bare | Shell::Background) => Ok(false),
        _ => running(),
    }
}

/// What runs under a pane's shell, for what the drawer decides about the pane (#460): whether to
/// end it, show it as a session's, or resume that session elsewhere. `Claude` is an agent CLI's
/// session, Grok Build's TUI included (`grok_tui`): the drawer treats both alike, and the wire
/// word stays `claude`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PaneRuns {
    /// The shell is at its prompt, so no Claude runs there, whatever `claude agents` says or fails
    /// to; what it left in the background is no Claude `claude agents` lists.
    Idle,
    /// A Claude Code session `claude agents` lists runs under it.
    Claude,
    /// A program has the terminal that `claude agents` does not list as a Claude: another program,
    /// or a Claude still starting (a typed `claude --resume` has the terminal at once, and is
    /// listed once it has started).
    Other,
    /// A program has the terminal, and `claude agents` could not say what.
    Unknown,
}

/// What runs under a pane's `shell`: a Claude or not as `claude` answers. A shell at its prompt
/// runs none unless `claude` lists one under it (stopped, or in the background); a bare one asks
/// nothing.
pub fn pane_runs(shell: Shell, claude: impl FnOnce() -> Result<bool, String>) -> PaneRuns {
    if shell == Shell::Bare {
        return PaneRuns::Idle;
    }
    match (shell, claude()) {
        (_, Ok(true)) => PaneRuns::Claude,
        (Shell::Background, _) => PaneRuns::Idle,
        (_, Ok(false)) => PaneRuns::Other,
        (_, Err(_)) => PaneRuns::Unknown,
    }
}

/// What runs in a terminal pane now (`PaneRuns`), given its shell's pid. An error only when the
/// process table could not be read.
#[tauri::command]
pub async fn chrome_pane_runs(pane_pid: u32) -> Result<PaneRuns, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let table = crate::procs::table()?;
        // A `claude agents` answer a few seconds old is enough here, and costs no process spawn
        // for every pane that runs something else (`live_agents`).
        // A Grok TUI is looked for only when no Claude is, and only with a Grok account.
        let claude = || {
            let said = match live_agents() {
                None => Err(AGENTS_CANNOT_SAY.to_string()),
                Some(agents) => Ok(!agents.is_empty() && session_below(pane_pid, &agents, |pids| table.children(pids)).is_some()),
            };
            if said == Ok(true) || !grok_accounts() {
                return said;
            }
            if grok_below(pane_pid, |pids| table.children(pids), process_args).is_some() {
                Ok(true)
            } else {
                said
            }
        };
        Ok(pane_runs(shell_of(pane_pid, |p| table.children(p), crate::procs::image_of, crate::procs::groups), claude))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mission::run;
    use std::cell::Cell;

    #[test]
    fn cache_reuses_within_the_ttl_and_recomputes_after() {
        let c = Cache::new(Duration::from_secs(5));
        let calls = Cell::new(0);
        let t0 = Instant::now();
        let f = || {
            calls.set(calls.get() + 1);
            calls.get()
        };
        assert_eq!(c.get_or("/a", t0, f), 1);
        assert_eq!(c.get_or("/a", t0 + Duration::from_secs(4), f), 1);
        assert_eq!(c.get_or("/b", t0 + Duration::from_secs(4), f), 2);
        assert_eq!(c.get_or("/a", t0 + Duration::from_secs(6), f), 3);
    }

    #[test]
    fn cache_keeps_misses() {
        let c: Cache<Option<String>> = Cache::new(Duration::from_secs(5));
        let t0 = Instant::now();
        assert_eq!(c.get_or("/x", t0, || None), None);
        assert_eq!(c.get_or("/x", t0, || Some("computed".into())), None);
    }

    const AGENTS: &str = include_str!("../fixtures/agents.json");
    const PGREP: &str = include_str!("../fixtures/pgrep.txt");

    /// The fixture table's children, counting the calls.
    fn pgrep<'a>(calls: &'a Cell<usize>) -> impl FnMut(&[u32]) -> Vec<u32> + 'a {
        let table: Vec<(u32, u32)> = PGREP
            .lines()
            .filter(|l| !l.starts_with('#') && !l.trim().is_empty())
            .map(|l| {
                let mut f = l.split_whitespace().map(|x| x.parse().unwrap());
                (f.next().unwrap(), f.next().unwrap())
            })
            .collect();
        move |parents| {
            calls.set(calls.get() + 1);
            table.iter().filter(|(_, ppid)| parents.contains(ppid)).map(|(pid, _)| *pid).collect()
        }
    }

    #[test]
    fn agent_pids_keep_live_rows_only() {
        let agents = parse_agent_pids(AGENTS);
        assert_eq!(agents.len(), 7, "{agents:?}");
        assert_eq!(agents[&9102], ("7c3e9d41-2b6a-4f0e-8d15-a9c4e2f7b603".to_string(), 1789431000000));
        assert!(agents.contains_key(&20147), "a background session with a pid is live");
        assert!(parse_agent_pids("not json").is_empty());
    }

    /// A `claude` typed in a pane on another account, as only that account's `claude agents` lists it.
    const OTHER: &str = r#"[{"sessionId": "1b870196-d631-4ba3-bd8b-93f08e1d4a8a", "pid": 32791, "startedAt": 1789432000000, "kind": "interactive"}]"#;

    #[test]
    fn every_accounts_agents_are_one_table() {
        let both = merge_agents([Ok(AGENTS.to_string()), Ok(OTHER.to_string())]).unwrap();
        assert_eq!(both.len(), 8, "{both:?}");
        assert_eq!(both[&9102].0, "7c3e9d41-2b6a-4f0e-8d15-a9c4e2f7b603");
        assert_eq!(both[&32791].0, "1b870196-d631-4ba3-bd8b-93f08e1d4a8a");
        // The pane on the other account learns its session.
        let pane = |parents: &[u32]| if parents.contains(&32790) { vec![32791] } else { vec![] };
        assert_eq!(session_below(32790, &both, pane).as_deref(), Some("1b870196-d631-4ba3-bd8b-93f08e1d4a8a"));

        // An account that cannot say does not hide the others'.
        let one = merge_agents([Err("account work: claude agents --json: boom".into()), Ok(OTHER.to_string())]).unwrap();
        assert_eq!(one.keys().collect::<Vec<_>>(), [&32791]);
        // None only when no account could say: `claude` missing, or no account asked.
        assert_eq!(merge_agents([Err("claude: not found".into()), Err("account work: claude: not found".into())]), None);
        assert_eq!(merge_agents([]), None);
        assert_eq!(merge_agents([Ok("[]".to_string())]), Some(HashMap::new()));
    }

    #[test]
    fn session_below_finds_the_claude_a_pane_runs() {
        let agents = parse_agent_pids(AGENTS);
        let calls = Cell::new(0);
        // Typed by hand: the shell's child. The claude its Bash tool started is not searched.
        assert_eq!(session_below(5001, &agents, pgrep(&calls)).as_deref(), Some("7c3e9d41-2b6a-4f0e-8d15-a9c4e2f7b603"));
        assert_eq!(calls.get(), 1);
        // Through a wrapper script and npx.
        assert_eq!(session_below(5002, &agents, pgrep(&calls)).as_deref(), Some("2f8a61c0-4d3b-4e7a-b1c9-5d0e7f3a2b14"));
        // An idle pane walks to the bottom and stops.
        calls.set(0);
        assert_eq!(session_below(5003, &agents, pgrep(&calls)), None);
        assert_eq!(calls.get(), 2);
        // A pane whose program is claude itself; a pid with no process.
        assert_eq!(session_below(9103, &agents, pgrep(&calls)).as_deref(), Some("c41e0b7d-8a25-4f63-9e0d-3b7a6c5f1e28"));
        assert_eq!(session_below(4242, &agents, pgrep(&calls)), None);
        // The whole app: two sessions at one depth, the newest wins.
        assert_eq!(session_below(5000, &agents, pgrep(&calls)).as_deref(), Some("89de6d87-3494-4bb0-9daf-127e9a1299b0"));
    }

    #[test]
    fn session_below_is_bounded_on_a_cyclic_table() {
        let agents = parse_agent_pids(AGENTS);
        let calls = Cell::new(0);
        let cyclic = |p: &[u32]| {
            calls.set(calls.get() + 1);
            p.iter().map(|x| if *x == 1 { 2 } else { 1 }).collect()
        };
        assert_eq!(session_below(1, &agents, cyclic), None);
        assert!(calls.get() <= 2);
        let mut deep = |p: &[u32]| vec![p[0] + 1];
        assert_eq!(session_below(100, &HashMap::from([(100 + MAX_DEPTH as u32 + 1, ("x".into(), 0))]), &mut deep), None);
        assert_eq!(session_below(100, &HashMap::from([(100 + MAX_DEPTH as u32, ("x".into(), 0))]), &mut deep).as_deref(), Some("x"));
    }

    /// The fixture table's parents, as `parent_of` answers them; `gone` have exited.
    fn parents<'a>(gone: &'a [u32]) -> impl Fn(u32) -> Option<u32> + 'a {
        let table: HashMap<u32, u32> = PGREP
            .lines()
            .filter(|l| !l.starts_with('#') && !l.trim().is_empty())
            .map(|l| {
                let mut f = l.split_whitespace().map(|x| x.parse().unwrap());
                (f.next().unwrap(), f.next().unwrap())
            })
            .collect();
        move |pid| if gone.contains(&pid) { None } else { table.get(&pid).copied() }
    }

    #[test]
    fn under_walks_up_from_a_live_pid_to_the_pane() {
        let p = parents(&[]);
        assert!(under(5001, 9102, &p), "typed by hand");
        assert!(under(5002, 9101, &p), "through a wrapper and npx");
        assert!(under(5001, 9103, &p), "a claude that session's Bash started");
        assert!(under(9103, 9103, &p), "a pane whose program is claude itself");
        assert!(!under(5003, 9102, &p), "another pane's claude");
        assert!(!under(5001, 20147, &p), "a background session under no pane");
        assert!(!under(5001, 4242, &p), "no such process");
        assert!(!under(5001, 9102, parents(&[9102])), "an exited claude is under nothing");
        assert!(!under(5001, 9102, parents(&[5001])), "nor is anything once the pane's shell is gone");
        // Deeper than a session is looked for.
        let chain = |pid: u32| (100..=100 + MAX_DEPTH as u32 + 1).contains(&pid).then(|| pid - 1);
        assert!(under(100, 100 + MAX_DEPTH as u32, chain));
        assert!(!under(100, 100 + MAX_DEPTH as u32 + 1, chain));
        // A process that is its own parent does not spin.
        assert!(!under(1, 50, |p| Some(p)));
    }

    #[test]
    fn claude_running_trusts_a_cached_pid_only_while_it_lives_under_the_pane() {
        let agents = parse_agent_pids(AGENTS);
        let t0 = Instant::now();
        let asked = Cell::new(0);
        let fresh = |a: Option<HashMap<u32, (String, u64)>>| {
            let asked = &asked;
            move || {
                asked.set(asked.get() + 1);
                a
            }
        };
        let calls = Cell::new(0);
        let cached = Some((t0, Some(agents.clone())));

        // A cached pid alive under the pane: no `claude agents`, no walk.
        assert_eq!(claude_running(5001, cached.clone(), t0 + Duration::from_secs(10), parents(&[]), fresh(None), || Ok(pgrep(&calls))), Ok(true));
        assert_eq!((asked.get(), calls.get()), (0, 0));

        // It exited: asked again, and the fresh answer, without it, refuses.
        let mut after = agents.clone();
        after.remove(&9102);
        after.remove(&9103);
        assert_eq!(claude_running(5001, cached.clone(), t0, parents(&[9102, 9103]), fresh(Some(after)), || Ok(pgrep(&calls))), Ok(false));
        assert_eq!(asked.get(), 1);

        // A claude started after the cached answer: found by asking again.
        asked.set(0);
        let mut before = agents.clone();
        before.remove(&17759);
        assert_eq!(claude_running(5004, Some((t0, Some(before))), t0, parents(&[]), fresh(Some(agents.clone())), || Ok(pgrep(&calls))), Ok(true));
        assert_eq!(asked.get(), 1);

        // Too old to vouch, or nothing cached, or `claude agents` answering on no account (`claude`
        // missing reads the same): that is "cannot tell", never "not running" (#460).
        asked.set(0);
        assert_eq!(claude_running(5001, cached.clone(), t0 + VOUCH, parents(&[]), fresh(Some(agents.clone())), || Ok(pgrep(&calls))), Ok(true));
        assert_eq!(claude_running(5001, None, t0, parents(&[]), fresh(Some(agents.clone())), || Ok(pgrep(&calls))), Ok(true));
        assert_eq!(claude_running(5001, Some((t0, None)), t0, parents(&[]), fresh(None), || Ok(pgrep(&calls))), Err(AGENTS_CANNOT_SAY.to_string()));
        assert_eq!(asked.get(), 3);

        // An idle pane is refused either way.
        assert_eq!(claude_running(5003, cached.clone(), t0, parents(&[]), fresh(Some(agents.clone())), || Ok(pgrep(&calls))), Ok(false));
    }

    #[test]
    fn grok_s_tui_is_told_from_its_other_commands_and_names_its_session() {
        const ID: &str = "01a1451f-bfc0-7481-afec-c2286636bc5d";
        // What the app types (`attachCmd` in src/mission/account.ts) and what a new pane starts.
        assert_eq!(grok_tui(&format!("grok --leader -r {ID}")), Some(Some(ID.to_string())));
        assert_eq!(grok_tui(&format!("/Users/you/.grok/bin/grok --leader -s {ID}")), Some(Some(ID.to_string())));
        assert_eq!(grok_tui(&format!("grok --resume={}", ID.to_uppercase())), Some(Some(ID.to_string())));
        assert_eq!(grok_tui(&format!("grok -r 01a1451f-0000-7000-8000-000000000000 --fork-session -s {ID}")), Some(Some(ID.to_string())), "the fork's own id");
        assert_eq!(grok_tui("grok"), Some(None), "a bare TUI: Grok, on no session the app can name");
        assert_eq!(grok_tui("grok -r fix-login-bug"), Some(None), "a title is no id");
        assert_eq!(grok_tui("grok fix the bug"), Some(None), "an initial prompt");
        for not in [
            "/Users/you/.grok/bin/grok agent leader --no-exit-on-disconnect --relay-on-demand",
            "grok agent --leader stdio",
            "grok login --device-auth",
            "grok -p hello --output-format plain",
            "grok --version",
            "groker --leader",
            "claude --resume x",
            "",
        ] {
            assert_eq!(grok_tui(not), None, "{not}");
        }
        assert_eq!(grok_tui(r"C:\Users\you\.grok\bin\grok.exe --leader"), Some(None));
    }

    #[test]
    fn a_pane_runs_the_grok_tui_nearest_below_its_shell() {
        const ID: &str = "01a1451f-bfc0-7481-afec-c2286636bc5d";
        // shell 100 → grok TUI 200 (resumed) → the leader it auto-started, 300.
        let tree = |parents: &[u32]| -> Vec<u32> {
            [(200, 100), (300, 200), (400, 300)].iter().filter(|(_, pp)| parents.contains(pp)).map(|(p, _)| *p).collect()
        };
        let args = |pids: &[u32]| -> HashMap<u32, String> {
            assert!(pids.contains(&100) && pids.contains(&300), "one reading for the whole tree: {pids:?}");
            HashMap::from([
                (100, "-zsh".to_string()),
                (200, format!("grok --leader -r {ID}")),
                (300, "/Users/you/.grok/bin/grok agent leader --no-exit-on-disconnect".to_string()),
            ])
        };
        assert_eq!(grok_below(100, tree, args), Some(Some(ID.to_string())));
        let bare = |_: &[u32]| -> HashMap<u32, String> { panic!("a shell with nothing under it asks no command line") };
        assert_eq!(grok_below(100, |_: &[u32]| vec![], bare), None);
        let vim = |_: &[u32]| HashMap::from([(200, "vim notes.txt".to_string())]);
        assert_eq!(grok_below(100, |p: &[u32]| if p == [100] { vec![200] } else { vec![] }, vim), None);
    }

    #[cfg(unix)]
    #[test]
    fn process_args_reads_the_command_line_of_a_running_process() {
        let me = std::process::id();
        let mut done = crate::proc::command("true").spawn().unwrap();
        let gone = done.id();
        done.wait().unwrap();
        let got = process_args(&[me, gone]);
        assert!(got.get(&me).is_some_and(|a| !a.is_empty()), "{got:?}");
        assert!(!got.contains_key(&gone), "an ended process has no command line");
        assert!(process_args(&[]).is_empty());
    }

    #[test]
    fn a_shell_at_its_prompt_is_idle_whatever_claude_agents_says() {
        let unasked = || -> Result<bool, String> { panic!("claude agents asked for a bare shell") };
        let failing = || Err(AGENTS_CANNOT_SAY.to_string());
        assert_eq!(pane_runs(Shell::Bare, unasked), PaneRuns::Idle);
        // A helper in the background (`gitstatusd`), with `claude agents` failing or not.
        assert_eq!(pane_runs(Shell::Background, failing), PaneRuns::Idle);
        assert_eq!(pane_runs(Shell::Background, || Ok(false)), PaneRuns::Idle);
        // A Claude stopped with Ctrl+Z is still listed: still that session's pane.
        assert_eq!(pane_runs(Shell::Background, || Ok(true)), PaneRuns::Claude);
        assert_eq!(pane_runs(Shell::Busy, || Ok(true)), PaneRuns::Claude);
        // A `claude --resume` the shell just started, not listed yet; or another program.
        assert_eq!(pane_runs(Shell::Busy, || Ok(false)), PaneRuns::Other);
        assert_eq!(pane_runs(Shell::Busy, failing), PaneRuns::Unknown);
        // As the front reads it.
        assert_eq!(serde_json::to_string(&PaneRuns::Unknown).unwrap(), "\"unknown\"");
    }

    /// Shell 10's groups, and its children's: (pgid, the terminal's foreground group).
    fn groups_of(rows: &'static [(u32, u32, u32)]) -> impl Fn(u32) -> Option<crate::procs::Groups> {
        move |pid| rows.iter().find(|r| r.0 == pid).map(|r| crate::procs::Groups { pgid: r.1, foreground: r.2 })
    }

    /// The rule of #460's fourth review: a shell is at its prompt only when the terminal's
    /// foreground group is its own and nothing it started is in that group.
    #[test]
    fn a_shell_is_at_its_prompt_only_when_nothing_it_started_has_the_terminal() {
        // Job control, at the prompt: a job behind it is in a group of its own.
        assert_eq!(shell_state(10, &[11], groups_of(&[(10, 10, 10), (11, 11, 10)])), Shell::Background);
        // Job control, a program in front: the terminal is that program's group's.
        assert_eq!(shell_state(10, &[11], groups_of(&[(10, 10, 11), (11, 11, 11)])), Shell::Busy);
        // No job control (pwsh on macOS or Linux, zsh with `no_monitor`): the program in front
        // stays in the shell's group, and the terminal with it.
        assert_eq!(shell_state(10, &[11], groups_of(&[(10, 10, 10), (11, 10, 10)])), Shell::Busy);
        // There, a helper started in a group of its own (gitstatus sets `monitor` to start
        // `gitstatusd`) is behind; a job started with `&` is not, and reads busy.
        assert_eq!(shell_state(10, &[12], groups_of(&[(10, 10, 10), (12, 12, 10)])), Shell::Background);
        assert_eq!(shell_state(10, &[11, 12], groups_of(&[(10, 10, 10), (11, 10, 10), (12, 12, 10)])), Shell::Busy);
        // A child whose groups could not be read (gone since the table was read): busy until
        // asked again. Windows has no groups: any child is busy.
        assert_eq!(shell_state(10, &[11], groups_of(&[(10, 10, 10)])), Shell::Busy);
        assert_eq!(shell_state(10, &[11], |_| None), Shell::Busy);
        assert_eq!(shell_state(10, &[], |_| -> Option<crate::procs::Groups> { panic!("groups asked for a bare shell") }), Shell::Bare);
    }

    /// Git for Windows' `bin\bash.exe` starts `usr\bin\bash.exe` and waits: the pane is judged by
    /// that bash. A synthetic table, as Windows gives it (#460).
    #[test]
    fn a_git_bash_pane_is_judged_by_the_bash_its_redirector_starts() {
        let image = |rows: &'static [(u32, &'static str)]| move |pid: u32| rows.iter().find(|r| r.0 == pid).map(|r| r.1.to_string());
        let table = |rows: &'static [(u32, u32)]| move |parents: &[u32]| rows.iter().filter(|r| parents.contains(&r.1)).map(|r| r.0).collect::<Vec<u32>>();
        let git = image(&[(10, r"C:\Program Files\Git\bin\bash.exe"), (11, r"C:\Program Files\Git\usr\bin\bash.exe"), (12, r"C:\Users\me\.local\bin\claude.exe")]);
        let failing = || Err(AGENTS_CANNOT_SAY.to_string());

        // At its prompt: idle, with `claude agents` failing too (F2, F5), and the gate is closed.
        let at_prompt = table(&[(11, 10)]);
        assert_eq!(real_shell(10, &[11], &git), 11);
        assert_eq!(shell_of(10, &at_prompt, &git, |_| None), Shell::Bare);
        assert_eq!(pane_runs(shell_of(10, &at_prompt, &git, |_| None), failing), PaneRuns::Idle);
        assert_eq!(claude_gate(Ok(shell_of(10, &at_prompt, &git, |_| None)), failing), Ok(false));
        // Running Claude: busy.
        let running = table(&[(11, 10), (12, 11)]);
        assert_eq!(shell_of(10, &running, &git, |_| None), Shell::Busy);
        assert_eq!(pane_runs(shell_of(10, &running, &git, |_| None), || Ok(true)), PaneRuns::Claude);

        // As a per-user install, in the case and slashes it may come in.
        let per_user = image(&[(10, "c:/users/me/appdata/local/programs/git/bin/bash.exe"), (11, r"C:\Users\Me\AppData\Local\Programs\Git\usr\bin\bash.exe")]);
        assert_eq!(real_shell(10, &[11], per_user), 11);
        // Not a redirector: Cygwin's own `bin\bash.exe` running a program; cmd running bash; a
        // bash beside another Git's; a redirector with two children, or none readable.
        let cygwin = image(&[(10, r"C:\cygwin64\bin\bash.exe"), (11, r"C:\cygwin64\bin\sleep.exe")]);
        assert_eq!(real_shell(10, &[11], cygwin), 10);
        let cmd = image(&[(10, r"C:\Windows\System32\cmd.exe"), (11, r"C:\Program Files\Git\usr\bin\bash.exe")]);
        assert_eq!(real_shell(10, &[11], cmd), 10);
        let elsewhere = image(&[(10, r"C:\Program Files\Git\bin\bash.exe"), (11, r"D:\PortableGit\usr\bin\bash.exe")]);
        assert_eq!(real_shell(10, &[11], elsewhere), 10);
        assert_eq!(real_shell(10, &[11, 12], &git), 10);
        assert_eq!(real_shell(10, &[11], |_| None), 10);
        // Elsewhere no image is read, and the pane is its shell.
        assert_eq!(real_shell(10, &[11], crate::procs::image_of), if cfg!(windows) { real_shell(10, &[11], crate::procs::image_of) } else { 10 });
    }

    /// A process's own console host is no program it runs: a console program started with no
    /// console to share has its `conhost.exe` as its child (#460). A synthetic Windows table.
    #[test]
    fn a_process_s_own_console_host_is_no_program_it_runs() {
        let image = |rows: &'static [(u32, &'static str)]| move |pid: u32| rows.iter().find(|r| r.0 == pid).map(|r| r.1.to_string());
        let table = |rows: &'static [(u32, u32)]| move |parents: &[u32]| rows.iter().filter(|r| parents.contains(&r.1)).map(|r| r.0).collect::<Vec<u32>>();
        let unasked = || -> Result<bool, String> { panic!("claude agents asked for a bare shell") };
        let images = image(&[
            (10, r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"),
            (11, r"C:\WINDOWS\system32\conhost.exe"),
            (12, r"C:\Windows\System32\PING.EXE"),
            (20, r"C:\Program Files\Git\bin\bash.exe"),
            (21, r"C:\Program Files\Git\usr\bin\bash.exe"),
            (22, r"C:\Windows\System32\conhost.exe"),
            (30, r"C:\Tools\conhost.exe"),
        ]);
        // Its console host only: bare.
        assert_eq!(pane_runs(shell_of(10, table(&[(11, 10)]), &images, |_| None), unasked), PaneRuns::Idle);
        // A program beside it: busy.
        assert_eq!(shell_of(10, table(&[(11, 10), (12, 10)]), &images, |_| None), Shell::Busy);
        // Git Bash's redirector with a console host of its own still leads to its bash.
        assert_eq!(shell_of(20, table(&[(21, 20), (22, 20)]), &images, |_| None), Shell::Bare);
        // A program named so outside System32 is a program.
        assert_eq!(shell_of(10, table(&[(30, 10)]), &images, |_| None), Shell::Busy);
        // Elsewhere no image is read: a child is a child.
        assert_eq!(shell_of(10, table(&[(11, 10)]), |_| None, |_| None), Shell::Busy);
    }

    /// Waits until `ok`, for at most a minute; past that it fails with `what` and what `show`
    /// says of the moment.
    fn wait(what: &str, ok: impl Fn() -> bool, show: impl Fn() -> String) {
        let deadline = Instant::now() + Duration::from_secs(60);
        while !ok() {
            assert!(Instant::now() < deadline, "{what}: {}", show());
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    /// The children of `pid`, each by its image where the system says it.
    fn named_children(pid: u32) -> Vec<String> {
        let table = crate::procs::table().expect("the process table");
        table.children(&[pid]).into_iter().map(|c| crate::procs::image_of(c).unwrap_or_else(|| format!("process {c}"))).collect()
    }

    /// What the drawer is told of a process, from the live table.
    fn runs_live(pane: u32, claude: impl FnOnce() -> Result<bool, String>) -> PaneRuns {
        let table = crate::procs::table().expect("the process table");
        pane_runs(shell_of(pane, |p| table.children(p), crate::procs::image_of, crate::procs::groups), claude)
    }

    /// The real table, with no terminal: a process that started nothing is idle with no `claude
    /// agents` asked; a shell that has started a program is not.
    #[test]
    fn a_real_shell_at_its_prompt_is_idle_and_one_running_a_program_is_not() {
        use crate::procs::testing::{end, eventually, shell, sleeper};
        let idle = sleeper();
        assert_eq!(runs_live(idle.id(), || panic!("claude agents asked for a bare shell")), PaneRuns::Idle);
        end(idle);
        let sh = shell();
        let pane = sh.id();
        eventually("the shell starts its program", || runs_live(pane, || Ok(false)) == PaneRuns::Other);
        end(sh);
    }

    /// Windows: a console program started with no console to share (`proc::command`'s
    /// `CREATE_NO_WINDOW`, as the sleeper above is) gets a console of its own, whose host,
    /// `conhost.exe`, runs as its child from a moment after it starts. It still reads idle: that
    /// host is no program it runs (#460).
    #[cfg(windows)]
    #[test]
    fn a_console_program_s_own_console_host_runs_as_its_child_and_is_not_counted() {
        use crate::procs::testing::{end, sleeper};
        let idle = sleeper();
        let pid = idle.id();
        let hosts = || named_children(pid).iter().filter(|c| console_host(Some(c.to_string()))).count();
        wait("its console host starts, as its child", || hosts() == 1, || format!("its children are {:?}", named_children(pid)));
        assert_eq!(runs_live(pid, || panic!("claude agents asked for a bare process")), PaneRuns::Idle);
        end(idle);
    }

    /// A real interactive shell on a terminal, its output kept, and the cursor position it asks
    /// for (PSReadLine waits for it; so does Windows' pseudoconsole) answered.
    struct Term {
        pid: u32,
        keys: std::sync::Arc<Mutex<Box<dyn std::io::Write + Send>>>,
        out: std::sync::Arc<Mutex<String>>,
        child: Box<dyn portable_pty::Child + Send + Sync>,
        _master: Box<dyn portable_pty::MasterPty + Send>,
    }

    impl Term {
        /// `program`, found on `PATH`, on a new terminal; None when it is not installed.
        #[cfg(unix)]
        fn open(program: &str, args: &[&str]) -> Option<Term> {
            let path = std::env::var_os("PATH")?;
            let found = std::env::split_paths(&path).map(|d| d.join(program)).find(|p| p.is_file())?;
            Some(Term::open_path(found, args, &[("ENV", "/dev/null"), ("PS1", "$ "), ("TERM", "xterm-256color")]))
        }

        /// The program at `path` on a new terminal (a pseudoconsole on Windows), with `env` set.
        fn open_path(path: std::path::PathBuf, args: &[&str], env: &[(&str, &str)]) -> Term {
            use portable_pty::{native_pty_system, CommandBuilder, PtySize};
            use std::io::{Read, Write};
            let pair = native_pty_system().openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 }).expect("a terminal");
            let mut cmd = CommandBuilder::new(path);
            cmd.args(args);
            for (key, value) in env {
                cmd.env(key, value);
            }
            let child = pair.slave.spawn_command(cmd).expect("a shell");
            drop(pair.slave);
            let pid = child.process_id().expect("its pid");
            let keys = std::sync::Arc::new(Mutex::new(pair.master.take_writer().expect("its input")));
            let out = std::sync::Arc::new(Mutex::new(String::new()));
            let mut reader = pair.master.try_clone_reader().expect("its output");
            let (answer, kept) = (keys.clone(), out.clone());
            std::thread::spawn(move || {
                let mut buf = [0u8; 4096];
                loop {
                    let n = match reader.read(&mut buf) {
                        Ok(n) if n > 0 => n,
                        _ => break,
                    };
                    let text = String::from_utf8_lossy(&buf[..n]).into_owned();
                    for _ in text.matches("\x1b[6n") {
                        let _ = answer.lock().unwrap().write_all(b"\x1b[1;1R");
                    }
                    kept.lock().unwrap().push_str(&text);
                }
            });
            Term { pid, keys, out, child, _master: pair.master }
        }

        /// Types `line` and Enter.
        fn type_line(&self, line: &str) {
            let mut keys = self.keys.lock().unwrap();
            keys.write_all(line.as_bytes()).unwrap();
            keys.write_all(b"\r").unwrap();
        }

        /// Waits until the shell has printed `word`, typed as two halves so that its echo is not
        /// it. pwsh may take a while to start on a loaded machine.
        fn said(&self, what: &str, word: &str) {
            wait(what, || self.out.lock().unwrap().contains(word), || format!("it printed {:?}", self.out.lock().unwrap()));
        }

        /// Waits until the shell has printed `then` after `first`.
        #[cfg(unix)]
        fn said_after(&self, what: &str, first: &str, then: &str) {
            let seen = || {
                let out = self.out.lock().unwrap();
                out.find(first).is_some_and(|i| out[i..].contains(then))
            };
            wait(what, seen, || format!("it printed {:?}", self.out.lock().unwrap()));
        }

        fn children(&self) -> Vec<u32> {
            crate::procs::table().expect("the process table").children(&[self.pid])
        }

        fn kill_children(&self) {
            kill_below(self.pid);
        }

        fn end(mut self) {
            self.kill_children();
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
    }

    /// Ends what `pid` runs: each of its children, and what they started.
    fn kill_below(pid: u32) {
        for p in crate::procs::table().expect("the process table").children(&[pid]) {
            #[cfg(unix)]
            // SAFETY: signals a process this test started.
            unsafe {
                libc::kill(p as libc::pid_t, libc::SIGKILL)
            };
            #[cfg(windows)]
            let _ = crate::proc::command("taskkill").args(["/F", "/T", "/PID", &p.to_string()]).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).status();
        }
    }

    /// Real panes on Windows: a shell on a pseudoconsole, as the app runs one. Its console host
    /// is the pseudoconsole's, the test's child and not the shell's, so at its prompt the shell
    /// has no child at all and reads idle; while a program runs it reads busy, and idle again
    /// after. Git Bash is read through its redirector. `claude agents` fails throughout (#460).
    #[cfg(windows)]
    #[test]
    fn a_real_windows_shell_on_a_pseudoconsole_is_idle_at_its_prompt_and_busy_while_a_program_runs() {
        let failing = || Err(AGENTS_CANNOT_SAY.to_string());
        let root = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into());
        // A short PATH: under cargo the inherited one is too long for cmd to search.
        let path = format!(r"{root}\System32;{root}");

        let cmd = Term::open_path(format!(r"{root}\System32\cmd.exe").into(), &[], &[("PATH", path.as_str())]);
        cmd.type_line("echo RE^ADY");
        cmd.said("cmd reads the line", "READY");
        wait("cmd at its prompt has no child: its console host is the pseudoconsole's", || cmd.children().is_empty(), || format!("{:?}", named_children(cmd.pid)));
        assert_eq!(runs_live(cmd.pid, failing), PaneRuns::Idle, "cmd at its prompt");
        cmd.type_line(&format!(r"{root}\System32\PING.EXE -n 30 127.0.0.1"));
        wait("cmd runs ping", || runs_live(cmd.pid, failing) == PaneRuns::Unknown, || format!("{:?}", named_children(cmd.pid)));
        kill_below(cmd.pid);
        wait("cmd is back at its prompt", || runs_live(cmd.pid, failing) == PaneRuns::Idle, || format!("{:?}", named_children(cmd.pid)));
        cmd.end();

        // Git Bash, where Git for Windows is installed, as on CI's runners.
        let program_files = std::env::var("ProgramFiles").unwrap_or_else(|_| r"C:\Program Files".into());
        let git_bash = std::path::PathBuf::from(format!(r"{program_files}\Git\bin\bash.exe"));
        if git_bash.is_file() {
            let bash = Term::open_path(git_bash, &["--norc", "-i"], &[("PATH", path.as_str())]);
            bash.type_line("echo RE''ADY");
            bash.said("bash reads the line", "READY");
            let shell = || {
                let table = crate::procs::table().expect("the process table");
                real_shell(bash.pid, &table.children(&[bash.pid]), crate::procs::image_of)
            };
            wait("the redirector's bash is the shell", || shell() != bash.pid, || format!("{:?}", named_children(bash.pid)));
            let inner = shell();
            wait("Git Bash at its prompt reads idle", || runs_live(bash.pid, failing) == PaneRuns::Idle, || format!("{:?} below {:?}", named_children(inner), named_children(bash.pid)));
            bash.type_line("/usr/bin/sleep 30");
            wait("Git Bash runs sleep", || runs_live(bash.pid, failing) == PaneRuns::Unknown, || format!("{:?}", named_children(inner)));
            kill_below(inner);
            wait("Git Bash is back at its prompt", || runs_live(bash.pid, failing) == PaneRuns::Idle, || format!("{:?}", named_children(inner)));
            bash.end();
        }
    }

    /// `t` reads idle at its prompt, busy while `/bin/sleep` has the terminal, and idle again once
    /// it has ended. `claude agents` fails throughout.
    #[cfg(unix)]
    fn idle_then_busy(t: &Term, shell: &str) {
        let failing = || Err(AGENTS_CANNOT_SAY.to_string());
        let gate = || claude_gate(crate::procs::table().map(|tb| shell_of(t.pid, |p| tb.children(p), crate::procs::image_of, crate::procs::groups)), failing);
        assert_eq!(runs_live(t.pid, failing), PaneRuns::Idle, "{shell} at its prompt");
        t.type_line("/bin/sleep 31");
        wait(&format!("{shell}: the program has the terminal"), || runs_live(t.pid, failing) == PaneRuns::Unknown, || format!("{:?}", named_children(t.pid)));
        assert_eq!(runs_live(t.pid, || Ok(false)), PaneRuns::Other, "{shell}");
        assert_eq!(gate(), Err(AGENTS_CANNOT_SAY.to_string()), "{shell}: the gate asks claude agents");
        t.kill_children();
        wait(&format!("{shell}: back at its prompt"), || runs_live(t.pid, failing) == PaneRuns::Idle, || format!("{:?}", named_children(t.pid)));
        assert_eq!(gate(), Ok(false), "{shell}");
    }

    /// Real interactive shells on terminals: at the prompt each is idle, also with a job left in
    /// the background, as powerlevel10k leaves `gitstatusd`; while a program has the terminal each
    /// is not. That holds for shells without job control too (zsh with `no_monitor`, pwsh), where
    /// the program in front keeps the shell's own group. `claude agents` fails throughout (#460).
    #[cfg(unix)]
    #[test]
    fn a_real_shell_on_a_terminal_is_idle_at_its_prompt_with_a_job_in_the_background() {
        use crate::procs::testing::eventually;
        let failing = || Err(AGENTS_CANNOT_SAY.to_string());

        // sh, with job control.
        let sh = Term::open("sh", &["-i"]).expect("sh");
        idle_then_busy(&sh, "sh");
        sh.type_line("/bin/sleep 30 &");
        eventually("the job runs", || !sh.children().is_empty());
        assert_eq!(runs_live(sh.pid, failing), PaneRuns::Idle);
        sh.end();

        // zsh with `no_monitor`, where it is installed.
        if let Some(zsh) = Term::open("zsh", &["-f", "-i"]) {
            zsh.type_line("setopt no_monitor; print RE''ADY");
            zsh.said("zsh reads the line", "READY");
            idle_then_busy(&zsh, "zsh no_monitor");
            // gitstatus sets `monitor` to start `gitstatusd`: a group of its own, behind.
            zsh.type_line("() { setopt local_options monitor; /bin/sleep 301 &! }; print DA''EMON");
            zsh.said("the helper starts", "DAEMON");
            eventually("the helper runs", || !zsh.children().is_empty());
            assert_eq!(runs_live(zsh.pid, failing), PaneRuns::Idle, "zsh no_monitor with a helper behind");
            // A job started with `&` there stays in the shell's group: busy, so nothing is ended.
            zsh.type_line("/bin/sleep 302 &");
            eventually("the job runs", || zsh.children().len() == 2);
            assert_eq!(runs_live(zsh.pid, failing), PaneRuns::Unknown, "zsh no_monitor with a job in its group");
            zsh.end();
        }

        // pwsh, which has no job control on macOS or Linux, where it is installed.
        if let Some(pwsh) = Term::open("pwsh", &["-NoProfile", "-NoLogo"]) {
            // PSReadLine asks where the cursor is once it reads the keys itself. Typed before
            // that, Enter reaches it through the terminal as a new line, which it does not run.
            pwsh.said_after("pwsh reads the keys itself", "PS ", "\x1b[6n");
            pwsh.type_line("Write-Output ('RE'+'ADY')");
            pwsh.said("pwsh reads the line", "READY");
            idle_then_busy(&pwsh, "pwsh");
            pwsh.end();
        }
    }

    /// An account switch exits Claude and waits until it is gone before resuming it on the new
    /// account (`accounts/follow.ts`). With `claude agents` failing, a shell back at its prompt is
    /// still seen to run no Claude; one running something is still a question nobody can answer.
    #[test]
    fn the_claude_gate_sees_a_shell_at_its_prompt_run_no_claude_with_claude_agents_failing() {
        use crate::procs::testing::{end, eventually, shell, sleeper};
        let failing = || Err(AGENTS_CANNOT_SAY.to_string());
        let gate = |pane: u32| claude_gate(crate::procs::table().map(|t| shell_of(pane, |p| t.children(p), crate::procs::image_of, crate::procs::groups)), failing);
        let idle = sleeper();
        assert_eq!(gate(idle.id()), Ok(false));
        end(idle);
        let sh = shell();
        let pane = sh.id();
        eventually("the shell starts its program", || gate(pane).is_err());
        end(sh);
        // No table: what `claude_running` says.
        assert_eq!(claude_gate(Err("no table".into()), failing), Err(AGENTS_CANNOT_SAY.to_string()));
        assert_eq!(claude_gate(Ok(Shell::Bare), || -> Result<bool, String> { panic!("claude agents asked for a shell at its prompt") }), Ok(false));
        assert_eq!(claude_gate(Ok(Shell::Background), failing), Ok(false));
        assert_eq!(claude_gate(Ok(Shell::Busy), || Ok(true)), Ok(true));
    }

    #[test]
    fn claude_running_cannot_tell_when_the_tree_cannot_be_walked() {
        let agents = parse_agent_pids(AGENTS);
        let t0 = Instant::now();
        let no_walk = || Err::<fn(&[u32]) -> Vec<u32>, _>("the process table could not be read: boom".to_string());
        // Claude runs under the pane and nothing vouches from the cache: not "no longer running".
        let said = claude_running(5001, None, t0, parents(&[]), || Some(agents.clone()), no_walk);
        assert_eq!(said, Err("the process table could not be read: boom".to_string()));
        // Nor when no process's parent can be read either, as on a system with no table at all.
        let said = claude_running(5001, Some((t0, Some(agents.clone()))), t0, |_| None, || Some(agents.clone()), no_walk);
        assert!(said.is_err(), "{said:?}");
        // A cached pid seen live needs no walk, and no Claude anywhere needs none.
        assert_eq!(claude_running(5001, Some((t0, Some(agents.clone()))), t0, parents(&[]), || panic!("asked again"), no_walk), Ok(true));
        assert_eq!(claude_running(5001, None, t0, parents(&[]), || Some(HashMap::new()), no_walk), Ok(false));
    }

    /// The real table, on every system CI builds for: a program a real shell started is the
    /// session found under it, and is refused once it has exited. Nothing here is `cfg(unix)`.
    #[test]
    fn a_program_a_real_shell_runs_is_found_under_it_and_refused_once_it_exits() {
        use crate::procs::testing::{end, eventually, shell, started_by};
        let sh = shell();
        let pane = sh.id();
        let agents: HashMap<u32, (String, u64)> = started_by(pane).into_iter().map(|pid| (pid, ("live".to_string(), 0))).collect();
        let pids: Vec<u32> = agents.keys().copied().collect();
        assert_eq!(session_below(pane, &agents, children_of().unwrap()).as_deref(), Some("live"));
        assert_eq!(session_below(std::process::id(), &agents, children_of().unwrap()).as_deref(), Some("live"), "two levels down");
        // The send guard, both ways in: a cached answer checked live, and a fresh one walked.
        let now = Instant::now();
        let parent = crate::procs::parents();
        assert!(pids.iter().all(|&pid| under(pane, pid, &parent)));
        assert_eq!(claude_running(pane, Some((now, Some(agents.clone()))), now, &parent, || panic!("asked again"), children_of), Ok(true));
        assert_eq!(claude_running(pane, None, now, |_| None, || Some(agents.clone()), children_of), Ok(true));

        end(sh);
        // The shell leaves the table first. What it started can outlive it by a moment, and on
        // Windows it then still names the dead shell as its parent: nothing below waits for it.
        eventually("the ended shell is still in the table", || crate::procs::table().unwrap().parent(pane).is_none());
        eventually("an exited program is still under its shell", || {
            let parent = crate::procs::parents();
            !pids.iter().any(|&pid| under(pane, pid, &parent))
        });
        let now = Instant::now();
        assert_eq!(claude_running(pane, Some((now, Some(agents.clone()))), now, crate::procs::parents(), || Some(agents.clone()), children_of), Ok(false));
        assert_eq!(session_below(pane, &agents, children_of().unwrap()), None);
    }

    /// Types `claude` into a real shell pane and waits for its session to be learnt.
    /// `cargo test session_live -- --ignored` with Claude Code installed and logged in.
    #[test]
    #[ignore]
    fn session_live() {
        let m = crate::pty::PtyManager::new();
        let cwd = env!("CARGO_MANIFEST_DIR").to_string();
        let id = m
            .spawn(crate::pty::SpawnOptions { program: None, args: vec![], cwd: Some(cwd), cols: 120, rows: 40, login: true }, Box::new(|_| {}))
            .unwrap();
        let shell = m.pid(id).unwrap();
        assert_eq!(session_of(shell), Ok(None), "a fresh shell runs no session");
        std::thread::sleep(Duration::from_secs(2));
        m.write(id, b"claude\n").unwrap();
        let deadline = Instant::now() + Duration::from_secs(30);
        let mut found = None;
        while found.is_none() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(500));
            found = session_of(shell).unwrap();
        }
        let agents = run("claude", &["agents", "--json"], None).unwrap_or_default();
        m.kill(id);
        let found = found.expect("the claude typed in the pane was not found");
        assert!(agents.contains(&found), "{found} is not a live session");
    }

    /// A Claude running on an account other than the default is found under its parent, as a pane's
    /// would be. The accounts are the installed app's: a debug build keeps its own `accounts.json`.
    /// `cargo test session_on_another_account_live -- --ignored --nocapture` with one running.
    #[test]
    #[ignore]
    fn session_on_another_account_live() {
        let home = crate::app_dir::home();
        let file = crate::app_dir::shared_dir_in(&home).join("accounts.json");
        let accounts = crate::mission::account_dirs::Accounts::parse(&std::fs::read_to_string(&file).unwrap(), &home);
        let all = merge_agents(ask_agents_on(&accounts, Instant::now())).expect("claude agents");
        let mut seen = 0;
        for (a, got) in crate::mission::claude_on_every(&accounts, &["agents", "--json"]) {
            if a.is_default {
                continue;
            }
            for (pid, (session, _)) in parse_agent_pids(&got.unwrap()) {
                let Some(pane) = parent_of(pid) else { continue };
                let found = session_below(pane, &all, children_of().unwrap());
                eprintln!("account {}: pid {pid} under {pane}, session {session}, found {found:?}", a.id);
                assert!(found.is_some(), "account {}: nothing found under {pane}", a.id);
                seen += 1;
            }
        }
        assert!(seen > 0, "no Claude runs on another account");
    }

    /// What the send guard costs against a live Claude: any running session that is not this
    /// test's own ancestor, under its parent as the pane.
    /// `cargo test claude_running_live -- --ignored --nocapture` with Claude Code running.
    #[test]
    #[ignore]
    fn claude_running_live() {
        let fresh = || run("claude", &["agents", "--json"], None).ok().map(|j| parse_agent_pids(&j));
        let t = Instant::now();
        let agents = fresh().expect("claude agents");
        let asked = t.elapsed();
        let pid = *agents.keys().find(|&&p| !under(p, std::process::id(), parent_of) && parent_of(p).is_some()).expect("a live session");
        let pane = parent_of(pid).unwrap();
        let t = Instant::now();
        assert!(session_below(pane, &agents, children_of().unwrap()).is_some());
        let walked = t.elapsed();
        let t = Instant::now();
        let no_walk = || Err::<fn(&[u32]) -> Vec<u32>, _>("walked".to_string());
        assert_eq!(claude_running(pane, Some((Instant::now(), Some(agents))), Instant::now(), parent_of, || panic!("asked again"), no_walk), Ok(true));
        let cached = t.elapsed();
        eprintln!("claude agents --json {asked:?}, table walk {walked:?}, cached pid checked live {cached:?}");
        assert!(cached < Duration::from_millis(5), "{cached:?}");
    }
}

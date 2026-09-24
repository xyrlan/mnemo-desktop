//! Pane chrome: what the header bar above a pane shows about its cwd (repo, branch).
//! Every bar polls, so answers are cached per cwd for a few seconds and a directory
//! outside any repo costs one `git` spawn per TTL, not one per render.
//!
//! It also learns which Claude Code session a terminal pane runs when `claude` was typed by
//! hand: the pids of `claude agents --json` matched against the process tree under the
//! pane's shell.

use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use crate::mission::{repo_root, run};

const TTL: Duration = Duration::from_secs(5);

/// A value per key that is recomputed once it is older than `ttl`. Misses (`None`)
/// are cached too: that is the common case for a shell sitting in `~`.
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

/// The branch checked out in `cwd` (a worktree reports its own), the short commit when
/// HEAD is detached, None outside a repo.
pub fn branch_of(cwd: &str) -> Option<String> {
    let dir = Some(Path::new(cwd));
    if !Path::new(cwd).is_dir() {
        return None;
    }
    let name = match run("git", &["rev-parse", "--abbrev-ref", "HEAD"], dir) {
        Ok(out) => out.trim().to_string(),
        // An unborn branch (no commit yet) has no HEAD to parse but still has a name.
        Err(_) => run("git", &["symbolic-ref", "--quiet", "--short", "HEAD"], dir).ok()?.trim().to_string(),
    };
    match name.as_str() {
        "" => None,
        "HEAD" => run("git", &["rev-parse", "--short", "HEAD"], dir).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()),
        _ => Some(name),
    }
}

/// The name of the repository `cwd` belongs to: the main checkout's folder, so a worktree
/// beside it shows the repo rather than the worktree folder.
pub fn repo_of(cwd: &str) -> Option<String> {
    if !Path::new(cwd).is_dir() {
        return None;
    }
    let root = repo_root(cwd)?;
    Path::new(&root).file_name().map(|n| n.to_string_lossy().trim_end_matches(".git").to_string()).filter(|n| !n.is_empty())
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

/// The session of the Claude process nearest below `root` (or `root` itself), walking the tree
/// a level at a time: `children` answers every pid parented by any of the given ones, as
/// `pgrep -P a,b,c` does. A session's own descendants are not searched, so a `claude` run by
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

/// Every pid whose parent is one of `pids`. `pgrep` exits 1 when there are none.
fn children_of(pids: &[u32]) -> Vec<u32> {
    let list = pids.iter().map(u32::to_string).collect::<Vec<_>>().join(",");
    run("pgrep", &["-P", &list], None).map(|s| s.lines().filter_map(|l| l.trim().parse().ok()).collect()).unwrap_or_default()
}

/// The Claude Code session running under a pane's shell, None when there is none (or `claude`
/// is not installed).
pub fn session_of(pane_pid: u32) -> Option<String> {
    let agents = agents().get_or("", Instant::now(), || run("claude", &["agents", "--json"], None).ok().map(|j| parse_agent_pids(&j)))?;
    if agents.is_empty() {
        return None;
    }
    session_below(pane_pid, &agents, children_of)
}

/// Like `session_of`, but asks `claude agents` now instead of reusing the last few seconds'
/// answer: for a check that gates keystrokes into the pane.
pub fn session_of_fresh(pane_pid: u32) -> Option<String> {
    let agents = run("claude", &["agents", "--json"], None).ok().map(|j| parse_agent_pids(&j))?;
    if agents.is_empty() {
        return None;
    }
    session_below(pane_pid, &agents, children_of)
}

/// Every pane asks on its own poll; one `claude agents` answers them all.
fn agents() -> &'static Cache<Option<HashMap<u32, (String, u64)>>> {
    static C: std::sync::OnceLock<Cache<Option<HashMap<u32, (String, u64)>>>> = std::sync::OnceLock::new();
    C.get_or_init(|| Cache::new(Duration::from_secs(3)))
}

fn branches() -> &'static Cache<Option<String>> {
    static C: std::sync::OnceLock<Cache<Option<String>>> = std::sync::OnceLock::new();
    C.get_or_init(|| Cache::new(TTL))
}

fn repos() -> &'static Cache<Option<String>> {
    static C: std::sync::OnceLock<Cache<Option<String>>> = std::sync::OnceLock::new();
    C.get_or_init(|| Cache::new(TTL))
}

#[tauri::command]
pub async fn chrome_branch(cwd: String) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || branches().get_or(&cwd, Instant::now(), || branch_of(&cwd))).await.ok().flatten()
}

#[tauri::command]
pub async fn chrome_repo(cwd: String) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || repos().get_or(&cwd, Instant::now(), || repo_of(&cwd))).await.ok().flatten()
}

/// The Claude Code session a terminal pane runs, given its shell's pid (`pty_pid`).
#[tauri::command]
pub async fn chrome_session(pane_pid: u32) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || session_of(pane_pid)).await.ok().flatten()
}

/// Whether a terminal pane runs Claude Code this moment (never cached).
#[tauri::command]
pub async fn chrome_claude_running(pane_pid: u32) -> bool {
    tauri::async_runtime::spawn_blocking(move || session_of_fresh(pane_pid).is_some()).await.unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
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

    /// `pgrep -P` over the fixture table, counting the calls.
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

    #[cfg(unix)]
    #[test]
    fn children_of_asks_pgrep_for_several_parents() {
        let spawn = || crate::proc::command("sh").args(["-c", "sleep 30; true"]).spawn().unwrap();
        let (mut a, mut b) = (spawn(), spawn());
        // The shells fork their sleep a moment after they start.
        let sleep_of = |sh: u32| {
            let deadline = Instant::now() + Duration::from_secs(5);
            loop {
                match children_of(&[sh])[..] {
                    [pid] => return pid,
                    _ if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(20)),
                    ref other => panic!("children of {sh}: {other:?}"),
                }
            }
        };
        let (sa, sb) = (sleep_of(a.id()), sleep_of(b.id()));
        let mut both = children_of(&[a.id(), b.id()]);
        both.sort();
        let mut want = vec![sa, sb];
        want.sort();
        assert_eq!(both, want);
        assert!(children_of(&[sa]).is_empty());
        assert_eq!(session_below(b.id(), &HashMap::from([(sb, ("live".to_string(), 0))]), children_of).as_deref(), Some("live"));
        for pid in [sa, sb] {
            let _ = crate::proc::command("kill").arg(pid.to_string()).status();
        }
        let _ = (a.wait(), b.wait());
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
        assert_eq!(session_of(shell), None, "a fresh shell runs no session");
        std::thread::sleep(Duration::from_secs(2));
        m.write(id, b"claude\n").unwrap();
        let deadline = Instant::now() + Duration::from_secs(30);
        let mut found = None;
        while found.is_none() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(500));
            found = session_of(shell);
        }
        let agents = run("claude", &["agents", "--json"], None).unwrap_or_default();
        m.kill(id);
        let found = found.expect("the claude typed in the pane was not found");
        assert!(agents.contains(&found), "{found} is not a live session");
    }

    #[test]
    fn branch_and_repo_of_checkouts_worktrees_and_plain_dirs() {
        let tmp = crate::testutil::temp_dir("chrome");
        let main = tmp.join("proj");
        let plain = tmp.join("plain");
        std::fs::create_dir_all(&main).unwrap();
        std::fs::create_dir_all(&plain).unwrap();
        let git = |args: &[&str], cwd: &Path| {
            let out = crate::proc::command("git").args(args).current_dir(cwd).output().unwrap();
            assert!(out.status.success(), "git {:?}: {}", args, String::from_utf8_lossy(&out.stderr));
            String::from_utf8_lossy(&out.stdout).trim().to_string()
        };
        let s = |p: &Path| p.to_str().unwrap().to_string();
        git(&["init", "-q", "-b", "main"], &main);
        // Unborn: no commit yet, the branch still has a name.
        assert_eq!(branch_of(&s(&main)).as_deref(), Some("main"));

        git(&["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"], &main);
        std::fs::create_dir_all(main.join("src/deep")).unwrap();
        assert_eq!(branch_of(&s(&main.join("src/deep"))).as_deref(), Some("main"));
        assert_eq!(repo_of(&s(&main.join("src/deep"))).as_deref(), Some("proj"));

        let wt = tmp.join("proj-wt-chrome");
        git(&["worktree", "add", "-q", "-b", "feat/round5/chrome", &s(&wt)], &main);
        assert_eq!(branch_of(&s(&wt)).as_deref(), Some("feat/round5/chrome"));
        assert_eq!(repo_of(&s(&wt)).as_deref(), Some("proj"));

        let sha = git(&["rev-parse", "--short", "HEAD"], &main);
        git(&["checkout", "-q", "--detach"], &main);
        assert_eq!(branch_of(&s(&main)), Some(sha));

        assert_eq!(branch_of(&s(&plain)), None);
        assert_eq!(repo_of(&s(&plain)), None);
        assert_eq!(branch_of(&s(&tmp.join("missing"))), None);
        let _ = std::fs::remove_dir_all(&tmp);
    }
}

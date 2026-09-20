//! Home screen data: repositories and past Claude Code sessions, from
//! `~/.claude/history.jsonl` joined with `claude agents --json --all`, plus each repo's
//! open issues and PRs as the last `refresh_github` left them (`lens`).

pub mod lens;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

use crate::github::Issue;
pub use lens::Pr;

#[derive(Debug, Clone, PartialEq)]
pub struct HistoryRow {
    pub project: String,
    pub session_id: String,
    pub display: String,
    pub ts: u64,
}

/// One session as history knows it, before live/transcript joins.
#[derive(Debug, Clone, PartialEq)]
pub struct KnownSession {
    pub id: String,
    pub cwd: String,
    pub title: String,
    pub first_at: u64,
    pub last_at: u64,
}

pub const TITLE_MAX: usize = 80;

/// Every well-formed line of `history.jsonl`, in file order. Bad lines are skipped.
pub fn parse_history(text: &str) -> Vec<HistoryRow> {
    text.lines()
        .filter_map(|l| serde_json::from_str::<serde_json::Value>(l).ok())
        .filter_map(|v| {
            Some(HistoryRow {
                project: v.get("project")?.as_str()?.to_string(),
                session_id: v.get("sessionId")?.as_str()?.to_string(),
                display: v.get("display").and_then(|d| d.as_str()).unwrap_or("").to_string(),
                ts: v.get("timestamp").and_then(|t| t.as_u64()).unwrap_or(0),
            })
        })
        .collect()
}

fn cut(s: &str, max: usize) -> String {
    s.chars().take(max).collect()
}

/// A prompt worth a title: not a slash command and at least 4 characters (`a`, `ok`).
fn is_real_prompt(line: &str) -> bool {
    !line.starts_with('/') && line.chars().count() >= 4
}

/// Sessions keyed by id. Title = first real prompt (`is_real_prompt`), else the first
/// prompt, cut to `TITLE_MAX` chars; `cwd` = the project of the first row.
pub fn sessions_from_history(rows: &[HistoryRow]) -> HashMap<String, KnownSession> {
    let mut out: HashMap<String, KnownSession> = HashMap::new();
    for r in rows {
        let line = r.display.trim().lines().next().unwrap_or("").trim().to_string();
        let e = out.entry(r.session_id.clone()).or_insert_with(|| KnownSession {
            id: r.session_id.clone(),
            cwd: r.project.clone(),
            title: String::new(),
            first_at: r.ts,
            last_at: r.ts,
        });
        e.last_at = e.last_at.max(r.ts);
        e.first_at = e.first_at.min(r.ts);
        if !line.is_empty() && (e.title.is_empty() || (!is_real_prompt(&e.title) && is_real_prompt(&line))) {
            e.title = cut(&line, TITLE_MAX);
        }
    }
    out
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Live {
    Here,
    Bg,
    Elsewhere,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HomeSession {
    pub id: String,
    pub title: String,
    pub cwd: String,
    pub last_at: u64,
    pub transcript: bool,
    pub live: Option<Live>,
    /// "interactive" | "background", from `claude agents`; "interactive" when unknown.
    pub kind: String,
    /// The `claude agents` name of a live session, only when it differs from `title`.
    pub agent: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct HomeRepo {
    pub root: String,
    pub name: String,
    pub last_at: u64,
    pub pinned: bool,
    pub hidden: bool,
    /// A cwd in a folder macOS guards (`mission::is_protected`), grouped by its history path
    /// without running git: `root` may be a subdirectory or a worktree until the user selects
    /// it and `home_resolve_repo` runs.
    pub unresolved: bool,
    /// The user's own sessions.
    pub sessions: Vec<HomeSession>,
    /// Sessions run in a dispatch worktree beside the repo (`<name>-wt-<n>`, see
    /// `is_dispatch_child`): background children of a dispatch, not the user's conversations.
    pub children: Vec<HomeSession>,
    /// Open issues and PRs from the last `refresh_github`; empty until one ran, and for a
    /// repo `gh` cannot read (the reason is in `HomeSnapshot.errors`).
    pub issues: Vec<Issue>,
    pub prs: Vec<Pr>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
pub struct HomeSnapshot {
    pub repos: Vec<HomeRepo>,
    pub clone_base: String,
    pub errors: Vec<String>,
    /// Unresolved repos neither hidden nor pinned: the view keeps them behind one
    /// "N pastas protegidas" line.
    pub protected: u32,
}

pub const SESSIONS_PER_REPO: usize = 50;

/// A row of `claude agents --json --all` that matters to Home.
#[derive(Debug, Clone, PartialEq)]
pub struct LiveRow {
    pub kind: String,
    pub name: Option<String>,
    pub cwd: String,
}

pub fn parse_live(json: &str) -> Result<HashMap<String, LiveRow>, String> {
    let rows: Vec<serde_json::Value> = serde_json::from_str(json).map_err(|e| format!("agents json: {e}"))?;
    Ok(rows
        .iter()
        .filter_map(|r| {
            let id = r.get("sessionId")?.as_str()?.to_string();
            // Finished background jobs are history, not live.
            let state = r.get("state").and_then(|s| s.as_str()).unwrap_or("");
            if matches!(state, "done" | "stopped" | "failed") {
                return None;
            }
            Some((
                id,
                LiveRow {
                    kind: r.get("kind").and_then(|k| k.as_str()).unwrap_or("interactive").to_string(),
                    name: r.get("name").and_then(|n| n.as_str()).map(str::to_string),
                    cwd: r.get("cwd").and_then(|c| c.as_str()).unwrap_or("").to_string(),
                },
            ))
        })
        .collect())
}

pub fn classify_live(live: &HashMap<String, LiveRow>, id: &str, here: &[String]) -> Option<Live> {
    let row = live.get(id)?;
    if here.iter().any(|h| h == id) {
        return Some(Live::Here);
    }
    if row.kind == "background" {
        return Some(Live::Bg);
    }
    Some(Live::Elsewhere)
}

/// `/x/mnemo-wt-211` → `/x/mnemo`: a dispatch worktree that has since been removed still
/// belongs to the repo beside it. None when the last segment has no `-wt-` suffix.
pub fn worktree_sibling(cwd: &str) -> Option<String> {
    // String-based on purpose: `Path::with_file_name` would rewrite the separator on
    // Windows and the result must stay comparable with the paths history recorded.
    let cut = cwd.trim_end_matches(['/', '\\']);
    let start = cut.rfind(['/', '\\']).map(|i| i + 1).unwrap_or(0);
    let name = &cut[start..];
    let idx = name.rfind("-wt-")?;
    Some(format!("{}{}", &cut[..start], &name[..idx]))
}

/// A session whose cwd is a dispatch worktree (`mnemo-wt-288`) rather than the checkout the
/// user works in.
pub fn is_dispatch_child(cwd: &str) -> bool {
    worktree_sibling(cwd).is_some()
}

/// Unresolved repos the view folds away: not hidden (already behind "escondidos") and not
/// pinned (the user asked for those).
pub fn protected_count(repos: &[HomeRepo]) -> u32 {
    repos.iter().filter(|r| r.unresolved && !r.hidden && !r.pinned).count() as u32
}

/// Roots Home never lists: Claude Code's own scratch clones under `~/.claude/`.
pub fn is_internal_root(root: &str, home: &str) -> bool {
    !home.is_empty() && Path::new(root).starts_with(Path::new(home).join(".claude"))
}

fn basename(p: &str) -> String {
    Path::new(p).file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| p.to_string())
}

fn sort_repos(repos: &mut [HomeRepo]) {
    repos.sort_by(|a, b| b.pinned.cmp(&a.pinned).then(b.last_at.cmp(&a.last_at)).then(a.name.cmp(&b.name)));
}

/// Group sessions by repo root (`root_of(cwd)`), dropping sessions whose cwd is not a git
/// checkout. A cwd `may_probe` refuses is never handed to `root_of`: it is its own repo,
/// `unresolved`. Sessions newest first (max `SESSIONS_PER_REPO`); repos pinned first, then
/// by last activity. Hidden repos stay in the list with `hidden: true` so the view can
/// offer "mostrar".
pub fn group_repos(
    sessions: Vec<KnownSession>,
    root_of: &dyn Fn(&str) -> Option<String>,
    may_probe: &dyn Fn(&str) -> bool,
    pinned: &[String],
    hidden: &[String],
) -> Vec<HomeRepo> {
    // root → (sessions, every member unresolved)
    let mut by_root: HashMap<String, (Vec<KnownSession>, bool)> = HashMap::new();
    let mut cache: HashMap<String, Option<(String, bool)>> = HashMap::new();
    let probe = |p: &str| if may_probe(p) { root_of(p) } else { None };
    let resolve = |cwd: &str| {
        if !may_probe(cwd) {
            return Some((cwd.to_string(), true));
        }
        root_of(cwd).or_else(|| worktree_sibling(cwd).and_then(|sib| probe(&sib))).map(|r| (r, false))
    };
    for s in sessions {
        let root = cache.entry(s.cwd.clone()).or_insert_with(|| resolve(&s.cwd)).clone();
        if let Some((root, unresolved)) = root {
            let e = by_root.entry(root).or_insert_with(|| (vec![], true));
            e.0.push(s);
            e.1 &= unresolved;
        }
    }
    let mut repos: Vec<HomeRepo> = by_root
        .into_iter()
        .map(|(root, (ss, unresolved))| {
            let last_at = ss.iter().map(|s| s.last_at).max().unwrap_or(0);
            let (children, own): (Vec<_>, Vec<_>) = ss.into_iter().partition(|s| s.cwd != root && is_dispatch_child(&s.cwd));
            HomeRepo {
                name: basename(&root),
                last_at,
                pinned: pinned.contains(&root),
                hidden: hidden.contains(&root),
                unresolved,
                sessions: home_sessions(own),
                children: home_sessions(children),
                issues: vec![],
                prs: vec![],
                root,
            }
        })
        .collect();
    sort_repos(&mut repos);
    repos
}

/// Newest first, at most `SESSIONS_PER_REPO`, not yet joined with live agents.
fn home_sessions(mut ss: Vec<KnownSession>) -> Vec<HomeSession> {
    ss.sort_by(|a, b| b.last_at.cmp(&a.last_at).then(a.id.cmp(&b.id)));
    ss.truncate(SESSIONS_PER_REPO);
    ss.into_iter()
        .map(|s| HomeSession {
            id: s.id,
            title: s.title,
            cwd: s.cwd,
            last_at: s.last_at,
            transcript: false,
            live: None,
            kind: "interactive".into(),
            agent: None,
        })
        .collect()
}

/// Where clones go by default: the parent directory most repos share, else `<home>/github`.
pub fn clone_base(roots: &[String], home: &str) -> String {
    let mut counts: HashMap<String, usize> = HashMap::new();
    for r in roots {
        if let Some(p) = Path::new(r).parent() {
            *counts.entry(p.to_string_lossy().to_string()).or_default() += 1;
        }
    }
    counts
        .into_iter()
        .max_by(|a, b| a.1.cmp(&b.1).then(b.0.cmp(&a.0)))
        .map(|(p, _)| p)
        .unwrap_or_else(|| format!("{home}/github"))
}

/// Fill `live`, `kind`, `transcript`. The title stays the history prompt; the agent's `name`
/// (an id-ish label like `mnemo-f2`) becomes the title only when history has none, else
/// `agent` when it says something else.
pub fn join_live(
    repos: &mut [HomeRepo],
    live: &HashMap<String, LiveRow>,
    here: &[String],
    has_transcript: &dyn Fn(&str, &str) -> bool,
) {
    for r in repos.iter_mut() {
        for s in r.sessions.iter_mut().chain(r.children.iter_mut()) {
            s.transcript = has_transcript(&s.cwd, &s.id);
            s.live = classify_live(live, &s.id, here);
            if let Some(row) = live.get(&s.id) {
                s.kind = row.kind.clone();
                if let Some(n) = row.name.as_ref().map(|n| cut(n.trim(), TITLE_MAX)).filter(|n| !n.is_empty()) {
                    if s.title.is_empty() {
                        s.title = n;
                    } else if n != s.title {
                        s.agent = Some(n);
                    }
                }
            }
        }
    }
}

fn home_dir() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default()
}

fn history_path() -> PathBuf {
    home_dir().join(".claude").join("history.jsonl")
}

/// The whole Home snapshot. `here` = session ids the desktop itself is running;
/// `extra_roots` = repos the user opened/cloned that may have no history yet.
pub fn collect_home(here: &[String], pinned: &[String], hidden: &[String], extra_roots: &[String]) -> HomeSnapshot {
    let mut errors = Vec::new();
    let text = std::fs::read_to_string(history_path()).unwrap_or_default();
    let sessions = sessions_from_history(&parse_history(&text));
    let home = home_dir().to_string_lossy().to_string();
    let mut repos = group_repos(
        sessions.into_values().collect(),
        &crate::mission::repo_root,
        &crate::mission::may_probe,
        pinned,
        hidden,
    );
    repos.retain(|r| !is_internal_root(&r.root, &home));
    for root in extra_roots {
        if !repos.iter().any(|r| &r.root == root) {
            repos.push(HomeRepo {
                root: root.clone(),
                name: basename(root),
                last_at: 0,
                pinned: pinned.contains(root),
                hidden: hidden.contains(root),
                unresolved: !crate::mission::may_probe(root),
                sessions: vec![],
                children: vec![],
                issues: vec![],
                prs: vec![],
            });
        }
    }
    sort_repos(&mut repos);
    let live = match crate::mission::run("claude", &["agents", "--json", "--all"], None).and_then(|j| parse_live(&j)) {
        Ok(l) => l,
        Err(e) => {
            errors.push(e);
            HashMap::new()
        }
    };
    join_live(&mut repos, &live, here, &|cwd, id| crate::mission::transcript_path(cwd, id).is_some());
    *lens::last_roots().lock().unwrap_or_else(|p| p.into_inner()) = Some(github_roots(&repos));
    errors.extend(join_github(&mut repos, &lens::cache().lock().unwrap_or_else(|p| p.into_inner())));
    let roots: Vec<String> = repos.iter().map(|r| r.root.clone()).collect();
    let protected = protected_count(&repos);
    HomeSnapshot { repos, clone_base: clone_base(&roots, &home), errors, protected }
}

/// Repos a GitHub refresh may run `gh` in: never an unresolved one (macOS may ask) nor a
/// hidden one (the user put it away).
pub fn github_roots(repos: &[HomeRepo]) -> Vec<String> {
    repos.iter().filter(|r| !r.unresolved && !r.hidden).map(|r| r.root.clone()).collect()
}

/// Copy each repo's cached issues and PRs in; returns the `errors` lines for repos the last
/// refresh could not read.
pub fn join_github(repos: &mut [HomeRepo], cache: &HashMap<String, lens::RepoGithub>) -> Vec<String> {
    for r in repos.iter_mut() {
        if let Some(g) = cache.get(&r.root) {
            r.issues = g.issues.clone();
            r.prs = g.prs.clone();
        }
    }
    let names: Vec<(String, String)> = repos.iter().map(|r| (r.root.clone(), r.name.clone())).collect();
    lens::error_lines(cache, &names)
}

/// Fetch open issues and PRs for the repos the last snapshot listed (see `github_roots`);
/// the next snapshot carries them. Runs a snapshot first when none ran yet.
pub fn refresh_github() {
    let known = lens::last_roots().lock().unwrap_or_else(|p| p.into_inner()).clone();
    let roots = match known {
        Some(r) => r,
        None => github_roots(&collect_home(&[], &[], &[], &[]).repos),
    };
    lens::refresh(&roots);
}

/// A folder the user picked: its main-checkout root, or an error when it is not a git repo.
pub fn register_repo(path: &str) -> Result<String, String> {
    resolve_repo(path)
}

pub const NOT_A_REPO: &str = "not a git repository";

/// The user selected an unresolved repo (or picked a folder): unlock it and run git there,
/// which is when macOS may ask, once. Returns the main-checkout root. On "not a repo" the
/// path stays unlocked, so the next snapshot drops it like any other non-git cwd; on a
/// denial it is locked again and stays listed, unresolved.
pub fn resolve_repo(root: &str) -> Result<String, String> {
    resolve_with(root, &crate::mission::git_root)
}

pub fn resolve_with(root: &str, git_root: &dyn Fn(&str) -> Result<String, String>) -> Result<String, String> {
    crate::mission::unlock(root);
    match git_root(root) {
        Ok(r) => {
            crate::mission::unlock(&r);
            Ok(r)
        }
        Err(e) if e.contains("Operation not permitted") => {
            crate::mission::relock(root);
            Err(format!(
                "no permission to read {root}: allow mnemo in System Settings › Privacy & Security › Files and Folders"
            ))
        }
        Err(_) => Err(NOT_A_REPO.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const HISTORY: &str = include_str!("../fixtures/history.jsonl");

    #[test]
    fn parse_history_skips_bad_lines() {
        let rows = parse_history(HISTORY);
        assert_eq!(rows.len(), 14);
        assert_eq!(rows[0].session_id, "aaaa-1");
        assert_eq!(rows[0].project, "/Users/me/github/mnemo");
    }

    #[test]
    fn title_is_first_non_slash_prompt_cut_to_80() {
        let s = sessions_from_history(&parse_history(HISTORY));
        assert_eq!(s["aaaa-1"].title, "fix the flaky test in pty.rs please");
        assert_eq!(s["aaaa-1"].last_at, 1789300002000);
        assert_eq!(s["aaaa-1"].cwd, "/Users/me/github/mnemo");
        assert_eq!(s["cccc-3"].title.len(), 80);
        // Only slash prompts: fall back to the slash command itself.
        assert_eq!(s["dddd-4"].title, "/help");
        // `a` is too short and `/resume` a command: the next real prompt wins.
        assert_eq!(s["hhhh-8"].title, "port the sidebar tests");
        assert!(!is_real_prompt("abc") && is_real_prompt("usage") && !is_real_prompt("/resume"));
    }

    fn fake_root(p: &str) -> Option<String> {
        match p {
            "/Users/me/github/mnemo" | "/Users/me/github/mnemo-wt-233" => Some("/Users/me/github/mnemo".into()),
            "/Users/me/github/other" => Some("/Users/me/github/other".into()),
            _ => None,
        }
    }

    /// Nothing is protected: every cwd may be probed.
    fn quiet(_: &str) -> bool {
        true
    }

    #[test]
    fn group_repos_collapses_worktrees_and_drops_non_git() {
        let sessions = sessions_from_history(&parse_history(HISTORY));
        let repos = group_repos(sessions.into_values().collect(), &fake_root, &quiet, &["/Users/me/github/other".to_string()], &[]);
        let names: Vec<&str> = repos.iter().map(|r| r.name.as_str()).collect();
        assert_eq!(names, vec!["other", "mnemo"]);
        let mnemo = &repos[1];
        assert_eq!(mnemo.sessions.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(), vec!["hhhh-8", "aaaa-1"]);
        // The worktree's session folds into mnemo, as a dispatch child.
        assert_eq!(mnemo.children.iter().find(|s| s.id == "cccc-3").unwrap().cwd, "/Users/me/github/mnemo-wt-233");
        assert!(repos[0].pinned && !repos[1].pinned);
    }

    #[test]
    fn dispatch_children_are_split_out_of_sessions() {
        let sessions = sessions_from_history(&parse_history(HISTORY));
        // `mnemo-wt-288` is gone from disk: it still lands as a child of mnemo.
        let repos = group_repos(sessions.into_values().collect(), &fake_root, &quiet, &[], &[]);
        let mnemo = repos.iter().find(|r| r.name == "mnemo").unwrap();
        assert_eq!(mnemo.children.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(), vec!["iiii-9", "cccc-3"]);
        assert!(mnemo.sessions.iter().all(|s| !is_dispatch_child(&s.cwd)));
        assert_eq!(mnemo.last_at, 1789360000000);
        // A repo whose own folder carries the suffix keeps its sessions.
        let s = KnownSession { id: "o".into(), cwd: "/gh/tool-wt-1".into(), title: "t".into(), first_at: 1, last_at: 1 };
        let repos = group_repos(vec![s], &|p| Some(p.to_string()), &quiet, &[], &[]);
        assert_eq!((repos[0].sessions.len(), repos[0].children.len()), (1, 0));
    }

    #[test]
    fn protected_counts_unresolved_repos_not_hidden_or_pinned() {
        let sessions = sessions_from_history(&parse_history(HISTORY));
        let may_probe = |p: &str| !crate::mission::is_protected(p, "/Users/me");
        let repos = group_repos(sessions.clone().into_values().collect(), &fake_root, &may_probe, &[], &[]);
        assert_eq!(protected_count(&repos), 2);
        let repos = group_repos(
            sessions.into_values().collect(),
            &fake_root,
            &may_probe,
            &["/Users/me/Downloads/x".to_string()],
            &["/Users/me/Downloads/x-wt-2".to_string()],
        );
        assert_eq!(protected_count(&repos), 0);
    }

    #[test]
    fn removed_dispatch_worktree_falls_back_to_the_sibling_repo() {
        // `/Users/me/github/mnemo-wt-999` no longer exists (fake_root → None) but `mnemo` does.
        let s = KnownSession { id: "w".into(), cwd: "/Users/me/github/mnemo-wt-999".into(), title: "t".into(), first_at: 5, last_at: 5 };
        let repos = group_repos(vec![s], &fake_root, &quiet, &[], &[]);
        assert_eq!(repos.len(), 1);
        assert_eq!(repos[0].root, "/Users/me/github/mnemo");
        assert_eq!(repos[0].children[0].cwd, "/Users/me/github/mnemo-wt-999");
        assert_eq!(worktree_sibling("/Users/me/github/plain"), None);
        assert_eq!(worktree_sibling("C:\\src\\mnemo-wt-3").as_deref(), Some("C:\\src\\mnemo"));
    }

    #[test]
    fn protected_cwds_group_by_path_without_running_git() {
        let sessions = sessions_from_history(&parse_history(HISTORY));
        let probed = std::cell::RefCell::new(Vec::<String>::new());
        let root_of = |p: &str| {
            probed.borrow_mut().push(p.to_string());
            fake_root(p)
        };
        let may_probe = |p: &str| !crate::mission::is_protected(p, "/Users/me");
        let repos = group_repos(sessions.into_values().collect(), &root_of, &may_probe, &[], &[]);
        assert!(probed.borrow().iter().all(|p| !p.contains("/Downloads")), "git ran in {:?}", probed.borrow());
        let x = repos.iter().find(|r| r.root == "/Users/me/Downloads/x").unwrap();
        assert!(x.unresolved);
        assert_eq!(x.name, "x");
        assert_eq!(x.sessions.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(), vec!["ffff-6"]);
        // Its worktree is not folded into it until resolved (no sibling probe either).
        let wt = repos.iter().find(|r| r.root == "/Users/me/Downloads/x-wt-2").unwrap();
        assert!(wt.unresolved);
        let mnemo = repos.iter().find(|r| r.name == "mnemo").unwrap();
        assert!(!mnemo.unresolved);
    }

    #[test]
    fn resolving_unlocks_the_path_and_keeps_denials_listed() {
        use crate::mission::unlock_covers;
        let ok = resolve_with("/Users/me/Downloads/r1/sub", &|_| Ok("/Users/me/Downloads/r1".into()));
        assert_eq!(ok.as_deref(), Ok("/Users/me/Downloads/r1"));
        assert!(unlock_covers("/Users/me/Downloads/r1/other"));
        let not_git = resolve_with("/Users/me/Downloads/r2", &|_| Err("git rev-parse: fatal: not a git repository".into()));
        assert_eq!(not_git, Err(NOT_A_REPO.to_string()));
        assert!(unlock_covers("/Users/me/Downloads/r2"), "stays unlocked so the next snapshot drops it");
        let denied = resolve_with("/Users/me/Downloads/r3", &|_| Err("git: Operation not permitted (os error 1)".into()));
        assert!(denied.unwrap_err().contains("no permission"));
        assert!(!unlock_covers("/Users/me/Downloads/r3"), "locked again so it stays listed, unresolved");
    }

    #[test]
    fn internal_roots_are_claude_scratch_dirs() {
        assert!(is_internal_root("/Users/me/.claude/jobs/e3/tmp/probe-repo", "/Users/me"));
        assert!(!is_internal_root("/Users/me/github/mnemo", "/Users/me"));
        assert!(!is_internal_root("/Users/me/github/mnemo", ""));
    }

    #[test]
    fn hidden_repos_are_flagged_not_dropped() {
        let sessions = sessions_from_history(&parse_history(HISTORY));
        let repos = group_repos(sessions.into_values().collect(), &fake_root, &quiet, &[], &["/Users/me/github/mnemo".to_string()]);
        assert!(repos.iter().find(|r| r.name == "mnemo").unwrap().hidden);
    }

    #[test]
    fn live_classification() {
        let agents = r#"[
          {"id":"a","cwd":"/x","kind":"interactive","pid":10,"sessionId":"aaaa-1","name":"pty flake"},
          {"id":"c","cwd":"/x","kind":"background","sessionId":"cccc-3","name":"bg one","state":"working"},
          {"id":"z","cwd":"/x","kind":"background","sessionId":"zzzz-9","state":"done"},
          {"id":"e","cwd":"/x","kind":"interactive","pid":11,"sessionId":"eeee-5"}
        ]"#;
        let live = parse_live(agents).unwrap();
        let here = vec!["eeee-5".to_string()];
        assert_eq!(classify_live(&live, "aaaa-1", &here), Some(Live::Elsewhere));
        assert_eq!(classify_live(&live, "cccc-3", &here), Some(Live::Bg));
        assert_eq!(classify_live(&live, "eeee-5", &here), Some(Live::Here));
        assert_eq!(classify_live(&live, "zzzz-9", &here), None);
        assert_eq!(live["aaaa-1"].name.as_deref(), Some("pty flake"));
    }

    #[test]
    fn clone_base_is_most_common_parent() {
        let roots = ["/a/gh/one", "/a/gh/two", "/b/three"].map(String::from);
        assert_eq!(clone_base(&roots, "/home/x"), "/a/gh");
        assert_eq!(clone_base(&[], "/home/x"), "/home/x/github");
    }

    #[test]
    fn join_marks_transcript_and_live_and_names() {
        let sessions = sessions_from_history(&parse_history(HISTORY));
        let mut repos = group_repos(sessions.into_values().collect(), &fake_root, &quiet, &[], &[]);
        let live = parse_live(
            r#"[{"id":"a","cwd":"/x","kind":"interactive","pid":10,"sessionId":"aaaa-1","name":"mnemo-f2"},
                {"id":"h","cwd":"/x","kind":"interactive","pid":12,"sessionId":"hhhh-8","name":"port the sidebar tests"},
                {"id":"i","cwd":"/x","kind":"background","sessionId":"iiii-9","name":"issue 288","state":"working"}]"#,
        )
        .unwrap();
        join_live(&mut repos, &live, &[], &|_cwd, id| id == "aaaa-1");
        let mnemo = repos.iter().find(|r| r.name == "mnemo").unwrap();
        let a = mnemo.sessions.iter().find(|s| s.id == "aaaa-1").unwrap();
        // The history prompt is the title; the agent name is only a badge.
        assert_eq!(a.title, "fix the flaky test in pty.rs please");
        assert_eq!(a.agent.as_deref(), Some("mnemo-f2"));
        assert!(a.transcript);
        assert_eq!(a.live, Some(Live::Elsewhere));
        let h = mnemo.sessions.iter().find(|s| s.id == "hhhh-8").unwrap();
        assert_eq!(h.agent, None, "same as the title: no badge");
        let c = mnemo.children.iter().find(|s| s.id == "cccc-3").unwrap();
        assert!(!c.transcript);
        assert_eq!(c.live, None);
        // Children are joined too.
        let i = mnemo.children.iter().find(|s| s.id == "iiii-9").unwrap();
        assert_eq!((i.live, i.kind.as_str()), (Some(Live::Bg), "background"));
    }

    #[test]
    fn agent_name_is_the_title_when_history_has_none() {
        let s = KnownSession { id: "n".into(), cwd: "/gh/r".into(), title: String::new(), first_at: 1, last_at: 1 };
        let mut repos = group_repos(vec![s], &|p| Some(p.to_string()), &quiet, &[], &[]);
        let live = parse_live(r#"[{"id":"n","cwd":"/gh/r","kind":"interactive","sessionId":"n","name":"r-f1"}]"#).unwrap();
        join_live(&mut repos, &live, &[], &|_, _| true);
        assert_eq!((repos[0].sessions[0].title.as_str(), repos[0].sessions[0].agent.as_deref()), ("r-f1", None));
    }

    /// Dogfood: `cargo test home::tests::dump_real_home -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn dump_real_home() {
        let snap = collect_home(&[], &[], &[], &[]);
        eprintln!("clone_base={} protected={} errors={:?}", snap.clone_base, snap.protected, snap.errors);
        for r in &snap.repos {
            eprintln!(
                "{:<28} {:>3} sessions {:>3} children  last={}  unresolved={}  {}",
                r.name,
                r.sessions.len(),
                r.children.len(),
                r.last_at,
                r.unresolved,
                r.root
            );
            for s in r.sessions.iter().take(3) {
                eprintln!("    {:?} {:?} t={} {} | {} {:?}", s.live, s.transcript, s.kind, &s.id[..8], s.title, s.agent);
            }
        }
    }

    #[test]
    fn github_lists_join_from_the_cache_and_errors_name_their_repos() {
        let sessions = sessions_from_history(&parse_history(HISTORY));
        let mut repos = group_repos(sessions.into_values().collect(), &fake_root, &quiet, &[], &["/Users/me/github/other".to_string()]);
        let may_probe = |p: &str| !crate::mission::is_protected(p, "/Users/me");
        let guarded = group_repos(sessions_from_history(&parse_history(HISTORY)).into_values().collect(), &fake_root, &may_probe, &[], &[]);
        // Hidden and unresolved repos are never fetched.
        assert_eq!(github_roots(&repos), vec!["/Users/me/github/mnemo".to_string()]);
        assert!(github_roots(&guarded).iter().all(|r| !r.contains("/Downloads")));

        let pr = lens::parse_prs(r#"[{"number":7,"title":"t","state":"OPEN","isDraft":false,"url":"u","headRefName":"fix/issue-1"}]"#).unwrap();
        let mut cache = HashMap::new();
        cache.insert("/Users/me/github/mnemo".to_string(), lens::RepoGithub { issues: vec![], prs: pr, error: None });
        cache.insert("/Users/me/github/other".to_string(), lens::RepoGithub { error: Some("no git remotes found".into()), ..Default::default() });
        let errors = join_github(&mut repos, &cache);
        let mnemo = repos.iter().find(|r| r.name == "mnemo").unwrap();
        assert_eq!(mnemo.prs.iter().map(|p| (p.number, p.child.clone())).collect::<Vec<_>>(), vec![(7, None)]);
        assert!(repos.iter().find(|r| r.name == "other").unwrap().prs.is_empty());
        assert_eq!(errors, vec!["github (other): no git remotes found".to_string()]);

        let json = serde_json::to_value(mnemo).unwrap();
        assert_eq!(json["prs"][0], serde_json::json!({"number": 7, "title": "t", "state": "open", "checks": "none", "child": null, "url": "u"}));
        assert_eq!(json["issues"], serde_json::json!([]));
    }

    #[test]
    fn live_serialises_lowercase() {
        assert_eq!(serde_json::to_string(&Some(Live::Elsewhere)).unwrap(), "\"elsewhere\"");
    }
}

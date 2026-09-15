//! Home screen data: repositories and past Claude Code sessions, from
//! `~/.claude/history.jsonl` joined with `claude agents --json --all`.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

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

/// Sessions keyed by id. Title = first prompt that is not a slash command (else the
/// first prompt), cut to `TITLE_MAX` chars; `cwd` = the project of the first row.
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
        let is_slash = line.starts_with('/');
        if !line.is_empty() && (e.title.is_empty() || (e.title.starts_with('/') && !is_slash)) {
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
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HomeRepo {
    pub root: String,
    pub name: String,
    pub last_at: u64,
    pub pinned: bool,
    pub hidden: bool,
    pub sessions: Vec<HomeSession>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct HomeSnapshot {
    pub repos: Vec<HomeRepo>,
    pub clone_base: String,
    pub errors: Vec<String>,
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
/// checkout. Sessions newest first (max `SESSIONS_PER_REPO`); repos pinned first, then
/// by last activity. Hidden repos stay in the list with `hidden: true` so the view can
/// offer "mostrar".
pub fn group_repos(
    sessions: Vec<KnownSession>,
    root_of: &dyn Fn(&str) -> Option<String>,
    pinned: &[String],
    hidden: &[String],
) -> Vec<HomeRepo> {
    let mut by_root: HashMap<String, Vec<KnownSession>> = HashMap::new();
    let mut cache: HashMap<String, Option<String>> = HashMap::new();
    let resolve = |cwd: &str| root_of(cwd).or_else(|| worktree_sibling(cwd).and_then(|sib| root_of(&sib)));
    for s in sessions {
        let root = cache.entry(s.cwd.clone()).or_insert_with(|| resolve(&s.cwd)).clone();
        if let Some(root) = root {
            by_root.entry(root).or_default().push(s);
        }
    }
    let mut repos: Vec<HomeRepo> = by_root
        .into_iter()
        .map(|(root, mut ss)| {
            ss.sort_by(|a, b| b.last_at.cmp(&a.last_at));
            ss.truncate(SESSIONS_PER_REPO);
            HomeRepo {
                name: basename(&root),
                last_at: ss.iter().map(|s| s.last_at).max().unwrap_or(0),
                pinned: pinned.contains(&root),
                hidden: hidden.contains(&root),
                sessions: ss
                    .into_iter()
                    .map(|s| HomeSession {
                        id: s.id,
                        title: s.title,
                        cwd: s.cwd,
                        last_at: s.last_at,
                        transcript: false,
                        live: None,
                        kind: "interactive".into(),
                    })
                    .collect(),
                root,
            }
        })
        .collect();
    sort_repos(&mut repos);
    repos
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

/// Fill `live`, `kind`, `transcript`, and prefer the agent's `name` as title.
pub fn join_live(
    repos: &mut [HomeRepo],
    live: &HashMap<String, LiveRow>,
    here: &[String],
    has_transcript: &dyn Fn(&str, &str) -> bool,
) {
    for r in repos.iter_mut() {
        for s in r.sessions.iter_mut() {
            s.transcript = has_transcript(&s.cwd, &s.id);
            s.live = classify_live(live, &s.id, here);
            if let Some(row) = live.get(&s.id) {
                s.kind = row.kind.clone();
                if let Some(n) = row.name.as_ref().filter(|n| !n.is_empty()) {
                    s.title = cut(n, TITLE_MAX);
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
    let mut repos = group_repos(sessions.into_values().collect(), &crate::mission::repo_root, pinned, hidden);
    repos.retain(|r| !is_internal_root(&r.root, &home));
    for root in extra_roots {
        if !repos.iter().any(|r| &r.root == root) {
            repos.push(HomeRepo {
                root: root.clone(),
                name: basename(root),
                last_at: 0,
                pinned: pinned.contains(root),
                hidden: hidden.contains(root),
                sessions: vec![],
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
    let roots: Vec<String> = repos.iter().map(|r| r.root.clone()).collect();
    HomeSnapshot { repos, clone_base: clone_base(&roots, &home), errors }
}

/// A folder the user picked: its main-checkout root, or an error when it is not a git repo.
pub fn register_repo(path: &str) -> Result<String, String> {
    crate::mission::repo_root(path).ok_or_else(|| "não é um repositório git".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    const HISTORY: &str = include_str!("../fixtures/history.jsonl");

    #[test]
    fn parse_history_skips_bad_lines() {
        let rows = parse_history(HISTORY);
        assert_eq!(rows.len(), 8);
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
    }

    fn fake_root(p: &str) -> Option<String> {
        match p {
            "/Users/me/github/mnemo" | "/Users/me/github/mnemo-wt-233" => Some("/Users/me/github/mnemo".into()),
            "/Users/me/github/other" => Some("/Users/me/github/other".into()),
            _ => None,
        }
    }

    #[test]
    fn group_repos_collapses_worktrees_and_drops_non_git() {
        let sessions = sessions_from_history(&parse_history(HISTORY));
        let repos = group_repos(sessions.into_values().collect(), &fake_root, &["/Users/me/github/other".to_string()], &[]);
        let names: Vec<&str> = repos.iter().map(|r| r.name.as_str()).collect();
        assert_eq!(names, vec!["other", "mnemo"]);
        let mnemo = &repos[1];
        assert_eq!(mnemo.sessions.len(), 2);
        assert_eq!(mnemo.sessions[0].id, "cccc-3");
        assert_eq!(mnemo.sessions[0].cwd, "/Users/me/github/mnemo-wt-233");
        assert_eq!(mnemo.last_at, 1789310001000);
        assert!(repos[0].pinned && !repos[1].pinned);
    }

    #[test]
    fn removed_dispatch_worktree_falls_back_to_the_sibling_repo() {
        // `/Users/me/github/mnemo-wt-999` no longer exists (fake_root → None) but `mnemo` does.
        let s = KnownSession { id: "w".into(), cwd: "/Users/me/github/mnemo-wt-999".into(), title: "t".into(), first_at: 5, last_at: 5 };
        let repos = group_repos(vec![s], &fake_root, &[], &[]);
        assert_eq!(repos.len(), 1);
        assert_eq!(repos[0].root, "/Users/me/github/mnemo");
        assert_eq!(repos[0].sessions[0].cwd, "/Users/me/github/mnemo-wt-999");
        assert_eq!(worktree_sibling("/Users/me/github/plain"), None);
        assert_eq!(worktree_sibling("C:\\src\\mnemo-wt-3").as_deref(), Some("C:\\src\\mnemo"));
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
        let repos = group_repos(sessions.into_values().collect(), &fake_root, &[], &["/Users/me/github/mnemo".to_string()]);
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
        let mut repos = group_repos(sessions.into_values().collect(), &fake_root, &[], &[]);
        let live = parse_live(r#"[{"id":"a","cwd":"/x","kind":"interactive","pid":10,"sessionId":"aaaa-1","name":"pty flake"}]"#).unwrap();
        join_live(&mut repos, &live, &[], &|_cwd, id| id == "aaaa-1");
        let mnemo = repos.iter().find(|r| r.name == "mnemo").unwrap();
        let a = mnemo.sessions.iter().find(|s| s.id == "aaaa-1").unwrap();
        assert_eq!(a.title, "pty flake");
        assert!(a.transcript);
        assert_eq!(a.live, Some(Live::Elsewhere));
        let c = mnemo.sessions.iter().find(|s| s.id == "cccc-3").unwrap();
        assert!(!c.transcript);
        assert_eq!(c.live, None);
    }

    /// Dogfood: `cargo test home::tests::dump_real_home -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn dump_real_home() {
        let snap = collect_home(&[], &[], &[], &[]);
        eprintln!("clone_base={} errors={:?}", snap.clone_base, snap.errors);
        for r in &snap.repos {
            eprintln!("{:<28} {:>3} sessions  last={}  {}", r.name, r.sessions.len(), r.last_at, r.root);
            for s in r.sessions.iter().take(3) {
                eprintln!("    {:?} {:?} t={} {} | {}", s.live, s.transcript, s.kind, &s.id[..8], s.title);
            }
        }
    }

    #[test]
    fn live_serialises_lowercase() {
        assert_eq!(serde_json::to_string(&Some(Live::Elsewhere)).unwrap(), "\"elsewhere\"");
    }
}

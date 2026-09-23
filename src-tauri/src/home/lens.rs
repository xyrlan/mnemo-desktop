//! The lens's GitHub half: each repo's open issues and open PRs through `gh`, and the
//! dispatch child that opened each PR. Fetched only when `refresh` is called (the front's
//! `refreshGithub()`), never on the snapshot's own poll; the snapshot reads what the last
//! refresh left. Nothing here is written to disk.
//!
//! A PR's child comes from `~/.claude/jobs/<short>/state.json`: first its `children`, where
//! Claude Code records the PR a job opened; when that is empty, the branch the job's
//! dispatch worktree implies (`<repo>-wt-288` → `fix/issue-288`, `<repo>-wt-c-parser` →
//! `feat/<feature>/parser`), the same derivation `mnemo`'s `delivery.py` falls back to. The
//! open-PR list already carries each head branch, so that fallback costs no `gh` call.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use serde::Serialize;

use crate::github::{parse_issues, Issue};
use crate::home::worktree_sibling;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Pr {
    pub number: u64,
    pub title: String,
    /// `open` or `draft`: only open PRs are listed.
    pub state: String,
    /// `pass` | `fail` | `pending` | `none`, folded from every check on the head commit.
    pub checks: String,
    /// Short id (`~/.claude/jobs/<short>`) of the child that opened the PR. None is an
    /// ordinary outcome: a PR opened by hand, or by a job whose record is gone.
    pub child: Option<String>,
    pub url: String,
    /// The head branch; not serialised, it only feeds the child resolution.
    #[serde(skip)]
    pub head: String,
}

/// What one refresh learned about one repo.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct RepoGithub {
    pub issues: Vec<Issue>,
    pub prs: Vec<Pr>,
    /// Why the last refresh could not read this repo; `issues`/`prs` then keep what the
    /// refresh before it read, if any.
    pub error: Option<String>,
}

// ------------------------------------------------------------- parsing --

pub const PR_FIELDS: &str = "number,title,state,isDraft,headRefName,url,statusCheckRollup";
const ISSUE_FIELDS: &str = "number,title,labels,assignees,state,url,updatedAt,milestone";

/// `gh pr list --json PR_FIELDS`. Rows without a number or title are skipped; `child` is
/// left for `resolve_children`.
pub fn parse_prs(json: &str) -> Result<Vec<Pr>, String> {
    let rows: Vec<serde_json::Value> = serde_json::from_str(json).map_err(|e| format!("prs json: {e}"))?;
    let s = |r: &serde_json::Value, k: &str| r.get(k).and_then(|x| x.as_str()).unwrap_or_default().to_string();
    Ok(rows
        .iter()
        .filter_map(|r| {
            let draft = r.get("isDraft").and_then(|x| x.as_bool()).unwrap_or(false);
            Some(Pr {
                number: r.get("number")?.as_u64()?,
                title: r.get("title")?.as_str()?.to_string(),
                state: if draft { "draft".into() } else { s(r, "state").to_lowercase() },
                checks: fold_checks(r.get("statusCheckRollup")).into(),
                child: None,
                url: s(r, "url"),
                head: s(r, "headRefName"),
            })
        })
        .collect())
}

/// A failure anywhere wins, then anything unfinished; skipped and neutral runs pass.
/// `statusCheckRollup` mixes check runs (`status`, `conclusion`) with commit statuses
/// (`state`).
pub fn fold_checks(rollup: Option<&serde_json::Value>) -> &'static str {
    let Some(items) = rollup.and_then(|r| r.as_array()).filter(|a| !a.is_empty()) else { return "none" };
    let (mut failed, mut pending) = (false, false);
    for c in items {
        let get = |k: &str| c.get(k).and_then(|x| x.as_str()).unwrap_or_default().to_ascii_uppercase();
        match c.get("state").and_then(|x| x.as_str()).map(str::to_ascii_uppercase) {
            Some(state) => match state.as_str() {
                "FAILURE" | "ERROR" => failed = true,
                "SUCCESS" => {}
                _ => pending = true,
            },
            None => match (get("status").as_str(), get("conclusion").as_str()) {
                (_, "FAILURE" | "TIMED_OUT" | "CANCELLED" | "ACTION_REQUIRED" | "STARTUP_FAILURE") => failed = true,
                ("COMPLETED", _) => {}
                _ => pending = true,
            },
        }
    }
    if failed {
        "fail"
    } else if pending {
        "pending"
    } else {
        "pass"
    }
}

/// A background job as the lens needs it: where it ran and the PRs it says it opened.
#[derive(Debug, Clone, PartialEq)]
pub struct Job {
    /// The directory name under `~/.claude/jobs/`: the id `claude attach` takes.
    pub short: String,
    pub cwd: String,
    /// `href`s of `children` entries whose kind is `pr`.
    pub prs: Vec<String>,
    pub updated_at: String,
}

/// One job's `state.json`; None when it is not JSON or names no cwd.
pub fn parse_job(short: &str, json: &str) -> Option<Job> {
    let v: serde_json::Value = serde_json::from_str(json).ok()?;
    let cwd = v.get("cwd")?.as_str()?.to_string();
    let prs = v
        .get("children")
        .and_then(|c| c.as_array())
        .map(|a| {
            a.iter()
                .filter(|c| c.get("kind").and_then(|k| k.as_str()) == Some("pr"))
                .filter_map(|c| c.get("href")?.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    let updated_at = v.get("updatedAt").and_then(|x| x.as_str()).unwrap_or_default().to_string();
    Some(Job { short: short.to_string(), cwd, prs, updated_at })
}

/// Every readable job under `dir`, in no particular order. A missing dir is no jobs.
pub fn read_jobs(dir: &Path) -> Vec<Job> {
    let Ok(entries) = std::fs::read_dir(dir) else { return vec![] };
    entries
        .flatten()
        .filter_map(|e| {
            let short = e.file_name().to_string_lossy().to_string();
            let text = std::fs::read_to_string(e.path().join("state.json")).ok()?;
            parse_job(&short, &text)
        })
        .collect()
}

/// The dispatch target a worktree cwd encodes: `mnemo-wt-288` → `288`, `mnemo-wt-c-parser`
/// → `c-parser`. None for any other path, including a `-wt-` suffix `mnemo` never writes.
pub fn dispatch_target(cwd: &str) -> Option<String> {
    let sib = worktree_sibling(cwd)?;
    let name = cwd.trim_end_matches(['/', '\\']);
    let target = name.get(sib.len() + "-wt-".len()..)?;
    let is_issue = !target.is_empty() && target.bytes().all(|b| b.is_ascii_digit());
    let is_slug = target.strip_prefix("c-").is_some_and(|s| {
        !s.is_empty() && s.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
    });
    (is_issue || is_slug).then(|| target.to_string())
}

/// Whether `head` is the branch `mnemo dispatch` names for `target`: `fix/issue-<n>` for an
/// issue, `feat/<feature>/<slug>` for a contract piece (`c-<slug>`).
pub fn branch_matches(target: &str, head: &str) -> bool {
    match target.strip_prefix("c-") {
        Some(slug) => head
            .strip_prefix("feat/")
            .and_then(|rest| rest.split_once('/'))
            .is_some_and(|(feature, s)| !feature.is_empty() && s == slug),
        None => head == format!("fix/issue-{target}"),
    }
}

fn same_pr_url(a: &str, b: &str) -> bool {
    let norm = |s: &str| s.trim().trim_end_matches('/').to_ascii_lowercase();
    !a.trim().is_empty() && norm(a) == norm(b)
}

/// Fill each PR's `child` from the jobs that ran in `root` or in a dispatch worktree beside
/// it. A job's own record of the PR wins; failing that, a job whose worktree implies the
/// PR's head branch. When several jobs qualify the most recently updated one wins.
pub fn resolve_children(prs: &mut [Pr], root: &str, jobs: &[Job]) {
    let root = root.trim_end_matches(['/', '\\']);
    let mut mine: Vec<&Job> = jobs
        .iter()
        .filter(|j| {
            let cwd = j.cwd.trim_end_matches(['/', '\\']);
            cwd == root || worktree_sibling(cwd).as_deref() == Some(root)
        })
        .collect();
    mine.sort_by(|a, b| b.updated_at.cmp(&a.updated_at).then(a.short.cmp(&b.short)));
    for pr in prs.iter_mut() {
        let recorded = mine.iter().find(|j| j.prs.iter().any(|h| same_pr_url(h, &pr.url)));
        let derived = || {
            mine.iter()
                .filter(|j| j.prs.is_empty())
                .find(|j| dispatch_target(&j.cwd).is_some_and(|t| branch_matches(&t, &pr.head)))
        };
        pr.child = recorded.or_else(derived).map(|j| j.short.clone());
    }
}

// ------------------------------------------------------------- running --

/// Runs `gh` in a directory: stdout, or a one-line reason.
pub type GhRun<'a> = &'a (dyn Fn(&[&str], &Path) -> Result<String, String> + Sync);

pub const GH_MISSING: &str = "gh not found in PATH (brew install gh)";

fn run_gh(args: &[&str], cwd: &Path) -> Result<String, String> {
    let out = crate::proc::command("gh")
        .args(args)
        .current_dir(cwd)
        .env("PATH", crate::mission::login_path())
        .stdin(std::process::Stdio::null())
        .output()
        .map_err(|e| if e.kind() == std::io::ErrorKind::NotFound { GH_MISSING.to_string() } else { e.to_string() })?;
    if out.status.success() {
        return Ok(String::from_utf8_lossy(&out.stdout).to_string());
    }
    let err = String::from_utf8_lossy(&out.stderr);
    let text = if err.trim().is_empty() { String::from_utf8_lossy(&out.stdout) } else { err };
    Err(text.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("gh failed").to_string())
}

/// One repo's open issues and PRs, children resolved against `jobs`.
pub fn fetch_repo(root: &str, gh: GhRun, jobs: &[Job]) -> Result<(Vec<Issue>, Vec<Pr>), String> {
    let dir = Path::new(root);
    let with_prs = format!("{ISSUE_FIELDS},closedByPullRequestsReferences");
    let list = |fields: &str| gh(&["issue", "list", "--state", "open", "--limit", "200", "--json", fields], dir);
    // `closedByPullRequestsReferences` is recent; an older `gh` refuses the whole field list.
    let issues = match list(&with_prs) {
        Err(e) if e.contains("Unknown JSON field") => list(ISSUE_FIELDS),
        r => r,
    }?;
    let issues = parse_issues(&issues)?;
    let prs = gh(&["pr", "list", "--state", "open", "--limit", "100", "--json", PR_FIELDS], dir)?;
    let mut prs = parse_prs(&prs)?;
    resolve_children(&mut prs, root, jobs);
    Ok((issues, prs))
}

/// Refresh every root into `cache`, in parallel, one `gh` pair per repo. A failure keeps the
/// repo's previous lists and records why. When `gh` itself is missing no other repo is tried.
pub fn refresh_into(cache: &Mutex<HashMap<String, RepoGithub>>, roots: &[String], gh: GhRun, jobs: &[Job]) {
    let first = match roots.first() {
        Some(r) => fetch_repo(r, gh, jobs),
        None => return,
    };
    let gone = matches!(&first, Err(e) if e == GH_MISSING);
    let mut results = vec![(roots[0].clone(), first)];
    if gone {
        results.extend(roots[1..].iter().map(|r| (r.clone(), Err(GH_MISSING.to_string()))));
    } else {
        std::thread::scope(|s| {
            let handles: Vec<_> = roots[1..].iter().map(|r| (r, s.spawn(move || fetch_repo(r, gh, jobs)))).collect();
            for (r, h) in handles {
                results.push((r.clone(), h.join().unwrap_or_else(|_| Err("gh fetch panicked".into()))));
            }
        });
    }
    let mut c = cache.lock().unwrap_or_else(|p| p.into_inner());
    for (root, res) in results {
        let e = c.entry(root).or_default();
        match res {
            Ok((issues, prs)) => *e = RepoGithub { issues, prs, error: None },
            Err(err) => e.error = Some(err),
        }
    }
}

/// `errors` lines for the snapshot, one per distinct reason, naming the repos it hit.
pub fn error_lines(cache: &HashMap<String, RepoGithub>, names: &[(String, String)]) -> Vec<String> {
    let mut by_reason: Vec<(String, Vec<String>)> = vec![];
    for (root, name) in names {
        let Some(err) = cache.get(root).and_then(|g| g.error.clone()) else { continue };
        match by_reason.iter_mut().find(|(e, _)| *e == err) {
            Some((_, ns)) => ns.push(name.clone()),
            None => by_reason.push((err, vec![name.clone()])),
        }
    }
    by_reason.into_iter().map(|(e, ns)| format!("github ({}): {e}", ns.join(", "))).collect()
}

pub fn cache() -> &'static Mutex<HashMap<String, RepoGithub>> {
    static C: OnceLock<Mutex<HashMap<String, RepoGithub>>> = OnceLock::new();
    C.get_or_init(Default::default)
}

/// Roots the last snapshot listed that a refresh may run `gh` in: resolved and not hidden.
pub fn last_roots() -> &'static Mutex<Option<Vec<String>>> {
    static R: OnceLock<Mutex<Option<Vec<String>>>> = OnceLock::new();
    R.get_or_init(Default::default)
}

pub fn jobs_dir() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default().join(".claude").join("jobs")
}

/// Fetch `roots` for real, into the process cache.
pub fn refresh(roots: &[String]) {
    let roots: Vec<String> = roots.iter().filter(|r| Path::new(r).is_dir()).cloned().collect();
    refresh_into(cache(), &roots, &run_gh, &read_jobs(&jobs_dir()));
}

#[cfg(test)]
mod tests {
    use super::*;

    const PRS: &str = include_str!("../../fixtures/lens/prs.json");
    const ISSUES: &str = include_str!("../../fixtures/github/issues.json");
    const ROOT: &str = "/gh/desk";

    fn fixture_jobs() -> Vec<Job> {
        read_jobs(&Path::new(env!("CARGO_MANIFEST_DIR")).join("fixtures/lens/jobs"))
    }

    fn resolved() -> Vec<Pr> {
        let mut prs = parse_prs(PRS).unwrap();
        resolve_children(&mut prs, ROOT, &fixture_jobs());
        prs
    }

    fn child_of(prs: &[Pr], n: u64) -> Option<&str> {
        prs.iter().find(|p| p.number == n).unwrap().child.as_deref()
    }

    #[test]
    fn prs_parse_state_and_checks() {
        let prs = parse_prs(PRS).unwrap();
        let row = |n: u64| prs.iter().find(|p| p.number == n).unwrap();
        assert_eq!(prs.len(), 5, "the row without a title is skipped");
        assert_eq!((row(120).state.as_str(), row(120).checks.as_str()), ("open", "pass"));
        assert_eq!(row(120).head, "fix/issue-101");
        assert_eq!(row(120).url, "https://github.com/me/desk/pull/120");
        assert_eq!(row(121).checks, "fail");
        assert_eq!((row(122).state.as_str(), row(122).checks.as_str()), ("draft", "pending"));
        assert_eq!(row(123).checks, "none");
        assert_eq!(row(124).checks, "pass", "skipped and neutral runs, and a green status, pass");
        assert!(prs.iter().all(|p| p.child.is_none()));
    }

    #[test]
    fn checks_fold_statuses_and_runs() {
        let fold = |j: &str| fold_checks(Some(&serde_json::from_str(j).unwrap()));
        assert_eq!(fold_checks(None), "none");
        assert_eq!(fold("[]"), "none");
        assert_eq!(fold(r#"[{"state":"PENDING"},{"status":"COMPLETED","conclusion":"SUCCESS"}]"#), "pending");
        assert_eq!(fold(r#"[{"state":"ERROR"},{"status":"IN_PROGRESS","conclusion":""}]"#), "fail");
        assert_eq!(fold(r#"[{"status":"COMPLETED","conclusion":"TIMED_OUT"}]"#), "fail");
        assert_eq!(fold(r#"[{"status":"QUEUED"}]"#), "pending");
    }

    #[test]
    fn jobs_parse_their_pr_links_only() {
        let jobs = fixture_jobs();
        let job = |s: &str| jobs.iter().find(|j| j.short == s).unwrap();
        assert_eq!(job("aaaa1111").prs, vec!["https://github.com/me/desk/pull/120".to_string()]);
        assert!(job("bbbb2222").prs.is_empty(), "children null");
        assert!(job("cccc3333").prs.is_empty(), "only a shell child");
        assert!(jobs.iter().all(|j| j.short != "broken0"), "not JSON: skipped");
        assert!(read_jobs(Path::new("/nonexistent/jobs")).is_empty());
    }

    #[test]
    fn a_pr_the_job_recorded_resolves_to_that_job() {
        let prs = resolved();
        assert_eq!(child_of(&prs, 120), Some("aaaa1111"));
        // `ffff6666` in another repo also lists a `pull/120`, of that repo: no match by number.
        assert_ne!(child_of(&prs, 120), Some("ffff6666"));
    }

    #[test]
    fn an_empty_record_falls_back_to_the_worktree_branch() {
        let prs = resolved();
        assert_eq!(child_of(&prs, 121), Some("bbbb2222"), "desk-wt-102 → fix/issue-102");
        assert_eq!(child_of(&prs, 122), Some("cccc3333"), "desk-wt-c-parser → feat/round9/parser");
    }

    #[test]
    fn a_pr_no_job_opened_has_no_child() {
        let prs = resolved();
        assert_eq!(child_of(&prs, 123), None);
        // `eeee5555` ran in desk-wt-124 and recorded a different PR: its record is the
        // answer, so the branch derivation does not claim #124 for it.
        assert_eq!(child_of(&prs, 124), None);
        // Serialised, a missing child is null, not an error.
        let json = serde_json::to_value(prs.iter().find(|p| p.number == 123).unwrap()).unwrap();
        assert_eq!(json["child"], serde_json::Value::Null);
        assert!(json.get("head").is_none());
    }

    #[test]
    fn the_newest_job_wins_when_two_claim_a_pr() {
        let mut prs = parse_prs(PRS).unwrap();
        let job = |short: &str, at: &str| Job {
            short: short.into(),
            cwd: "/gh/desk-wt-101".into(),
            prs: vec!["https://github.com/me/desk/pull/120/".into()],
            updated_at: at.into(),
        };
        resolve_children(&mut prs, "/gh/desk/", &[job("old", "2026-09-01T00:00:00Z"), job("new", "2026-09-02T00:00:00Z")]);
        assert_eq!(child_of(&prs, 120), Some("new"));
    }

    #[test]
    fn dispatch_targets_and_branches() {
        assert_eq!(dispatch_target("/gh/desk-wt-288").as_deref(), Some("288"));
        assert_eq!(dispatch_target("/gh/desk-wt-c-lens-data/").as_deref(), Some("c-lens-data"));
        assert_eq!(dispatch_target("/gh/desk-wt-hotkeyfix"), None);
        assert_eq!(dispatch_target("/gh/desk"), None);
        assert!(branch_matches("288", "fix/issue-288"));
        assert!(!branch_matches("28", "fix/issue-288"));
        assert!(branch_matches("c-lens-data", "feat/round14/lens-data"));
        assert!(!branch_matches("c-lens-data", "feat/lens-data"));
        assert!(!branch_matches("c-lens", "feat/round14/lens-data"));
    }

    fn fake_gh(root: &'static str, fail: Option<&'static str>) -> impl Fn(&[&str], &Path) -> Result<String, String> + Sync {
        move |args: &[&str], dir: &Path| {
            if dir == Path::new(root) {
                if let Some(f) = fail {
                    return Err(f.to_string());
                }
            }
            match args.first() {
                Some(&"issue") => Ok(ISSUES.to_string()),
                Some(&"pr") => Ok(PRS.to_string()),
                _ => Err("unexpected".into()),
            }
        }
    }

    #[test]
    fn a_refresh_fills_each_repo_and_keeps_the_last_good_lists_on_failure() {
        let cache = Mutex::new(HashMap::new());
        let roots = vec![ROOT.to_string(), "/gh/other".to_string()];
        let jobs = fixture_jobs();
        refresh_into(&cache, &roots, &fake_gh(ROOT, None), &jobs);
        {
            let c = cache.lock().unwrap();
            let desk = &c[ROOT];
            assert_eq!(desk.issues.len(), parse_issues(ISSUES).unwrap().len());
            assert_eq!(child_of(&desk.prs, 120), Some("aaaa1111"));
            assert_eq!(desk.error, None);
            assert_eq!(child_of(&c["/gh/other"].prs, 120), None, "desk's jobs are not other's");
        }
        refresh_into(&cache, &roots, &fake_gh(ROOT, Some("no git remotes found")), &jobs);
        let c = cache.lock().unwrap();
        assert_eq!(c[ROOT].error.as_deref(), Some("no git remotes found"));
        assert_eq!(c[ROOT].prs.len(), 5, "the previous lists survive a failed refresh");
        assert_eq!(c["/gh/other"].error, None);
    }

    #[test]
    fn a_missing_gh_degrades_every_repo_with_one_line() {
        let cache = Mutex::new(HashMap::new());
        let calls = std::sync::atomic::AtomicUsize::new(0);
        let gh = |_: &[&str], _: &Path| {
            calls.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            Err::<String, _>(GH_MISSING.to_string())
        };
        let roots = vec!["/gh/a".to_string(), "/gh/b".to_string()];
        refresh_into(&cache, &roots, &gh, &[]);
        assert_eq!(calls.into_inner(), 1, "no other repo is tried");
        let c = cache.lock().unwrap();
        assert!(c.values().all(|g| g.issues.is_empty() && g.prs.is_empty()));
        let names = vec![("/gh/a".to_string(), "a".to_string()), ("/gh/b".to_string(), "b".to_string()), ("/gh/c".to_string(), "c".to_string())];
        assert_eq!(error_lines(&c, &names), vec![format!("github (a, b): {GH_MISSING}")]);
    }

    #[test]
    fn issue_fields_fall_back_for_an_older_gh() {
        let seen = Mutex::new(vec![]);
        let gh = |args: &[&str], _: &Path| {
            let fields = args.last().unwrap().to_string();
            seen.lock().unwrap().push(fields.clone());
            match args[0] {
                "issue" if fields.contains("closedBy") => Err("Unknown JSON field: \"closedByPullRequestsReferences\"".into()),
                "issue" => Ok("[]".to_string()),
                _ => Ok("[]".to_string()),
            }
        };
        let (issues, prs) = fetch_repo(ROOT, &gh, &[]).unwrap();
        assert!(issues.is_empty() && prs.is_empty());
        assert_eq!(seen.lock().unwrap().len(), 3);
    }

    /// Dogfood: `cargo test home::lens::tests::dump_real_lens -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn dump_real_lens() {
        let root = env!("CARGO_MANIFEST_DIR").trim_end_matches("/src-tauri").to_string();
        let main = crate::mission::git_root(&root).unwrap_or(root);
        let (issues, prs) = fetch_repo(&main, &run_gh, &read_jobs(&jobs_dir())).unwrap();
        eprintln!("{main}: {} issues, {} prs", issues.len(), prs.len());
        for p in &prs {
            eprintln!("  #{} {:<7} {:<7} {:<10} {} ({})", p.number, p.state, p.checks, p.child.as_deref().unwrap_or("-"), p.title, p.head);
        }
    }
}

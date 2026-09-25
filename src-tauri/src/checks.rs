//! The right sidebar's Checks tab: the pull request of a worktree's branch, its CI checks, a
//! check's job (steps, annotations, the failing log's tail) and the review comments, all through
//! `gh` run in the worktree, as Orca's checks panel reads them (`get-pr-checks.ts`,
//! `get-pr-check-details.ts`, `check-job-log-tails.ts`).
//!
//! Two writes: marking a draft ready, and the merge. A merge lands only what the maintainer would
//! merge by hand, the cockpit's rule (`src/cockpit/merge.ts`): the PR is read again at the moment
//! of the merge, every check must have passed on its head, only the head that was shown is merged
//! (`--match-head-commit`), never with `--admin`, and "merged" is said once GitHub says so.
//!
//! Every `gh` is killed after `GH_TIMEOUT`: a hung network call must not freeze the tab. Parsing
//! is pure and tested on output captured from `gh` (`fixtures/checks/`); the reads and the merge
//! take the `gh` runner as an argument, so their tests answer for it.

use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::mission::{check_verdict, login_path, may_probe};

/// A `gh` (or `git`) run: its stdout, or the first line it said on failing.
pub type Run<'a> = &'a (dyn Fn(&str, &[&str], &Path) -> Result<String, String> + Sync);

pub const GH_MISSING: &str = "gh not found in PATH (brew install gh)";
const GH_TIMEOUT: Duration = Duration::from_secs(60);

/// Lines of a failed job's log kept, ending at its last error.
pub const TAIL_LINES: usize = 80;
/// Bytes of that tail, at most: it goes into a prompt.
pub const TAIL_BYTES: usize = 12_000;
/// Annotations asked of one check run.
const ANNOTATIONS: usize = 30;

const PR_FIELDS: &str = "number,title,url,state,isDraft,mergeable,mergeStateStatus,reviewDecision,baseRefName,headRefName,headRefOid,updatedAt,author,additions,deletions,changedFiles,statusCheckRollup,comments,reviews";
const GATE_FIELDS: &str = "number,state,isDraft,headRefOid,statusCheckRollup";
const THREADS_QUERY: &str = "query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100){nodes{id isResolved isOutdated path line originalLine comments(first:50){nodes{author{login} body createdAt url diffHunk}}}}}}}";

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Pr {
    pub number: u64,
    pub title: String,
    pub url: String,
    /// `open`, `draft`, `merged` or `closed`.
    pub state: String,
    pub base: String,
    pub head: String,
    /// The commit the checks ran on, and the only one a merge from here lands.
    pub head_sha: String,
    pub author: Option<String>,
    /// `MERGEABLE`, `CONFLICTING` or `UNKNOWN` (GitHub has not computed it yet).
    pub mergeable: String,
    /// GitHub's `mergeStateStatus`: `CLEAN`, `BLOCKED`, `BEHIND`, `DIRTY`, `UNSTABLE`, …
    pub merge_state: String,
    /// `APPROVED`, `CHANGES_REQUESTED` or `REVIEW_REQUIRED`; None when no review is asked for.
    pub review_decision: Option<String>,
    pub updated_at: String,
    pub additions: u64,
    pub deletions: u64,
    pub changed_files: u64,
}

/// One entry of the PR's `statusCheckRollup`: a check run, or a commit status (`vercel`, …).
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Check {
    pub name: String,
    pub workflow: Option<String>,
    /// `pass`, `fail` or `pending`: `mission::check_verdict`, the rule the whole app reads CI by.
    pub verdict: String,
    /// `queued`, `in_progress`, `completed`, or `pending` for a commit status still running.
    pub status: String,
    /// GitHub's conclusion, lowercased (`success`, `failure`, `timed_out`, …); None while it runs.
    pub conclusion: Option<String>,
    pub url: Option<String>,
    pub description: Option<String>,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    /// The Actions job behind the check, from its URL: what its details are read by.
    pub job_id: Option<u64>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Comment {
    pub author: String,
    pub body: String,
    pub created_at: String,
    pub url: Option<String>,
    /// A review's verdict for a review's own text (`APPROVED`, `CHANGES_REQUESTED`, `COMMENTED`);
    /// None for a comment.
    pub review: Option<String>,
    /// The code a thread's comment is on: the end of its diff hunk.
    pub diff_hunk: Option<String>,
}

/// A review thread: comments on one place in the code.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Thread {
    pub id: String,
    pub path: String,
    pub line: Option<u64>,
    pub resolved: bool,
    /// The code it was written on has changed since.
    pub outdated: bool,
    pub comments: Vec<Comment>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ChecksView {
    /// The worktree's top folder, where every `gh` runs.
    pub root: String,
    /// None on a detached HEAD.
    pub branch: Option<String>,
    /// The branch's pull request; None when it has none.
    pub pr: Option<Pr>,
    /// Failing first, then running, then the rest, each by name.
    pub checks: Vec<Check>,
    /// Review threads, unresolved first.
    pub threads: Vec<Thread>,
    /// The conversation's comments and the reviews' own texts, oldest first.
    pub comments: Vec<Comment>,
    /// Why the review threads could not be read; the rest stands without them.
    pub threads_error: Option<String>,
    /// The merge methods the repository allows, in GitHub's order (`squash`, `merge`, `rebase`).
    pub merge_methods: Vec<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Step {
    pub number: u64,
    pub name: String,
    pub status: String,
    pub conclusion: Option<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Annotation {
    pub path: String,
    pub line: Option<u64>,
    /// `failure`, `warning` or `notice`.
    pub level: String,
    pub title: Option<String>,
    pub message: String,
}

/// An Actions job, read when its check is opened (and for Fix).
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CheckDetails {
    pub job_id: u64,
    pub name: String,
    pub status: String,
    pub conclusion: Option<String>,
    pub url: Option<String>,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub steps: Vec<Step>,
    /// Failures first.
    pub annotations: Vec<Annotation>,
    /// The failed log's last lines, up to its last error; None when the job did not fail.
    pub log_tail: Option<String>,
    /// Why the log could not be read (expired, still being written, …).
    pub log_error: Option<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Merged {
    /// GitHub says the PR is merged. False when `gh` accepted it but it is still open (a queue).
    pub merged: bool,
    pub message: String,
}

// ------------------------------------------------------------- parsing --

type Json = serde_json::Value;

fn text(v: &Json, key: &str) -> Option<String> {
    v.get(key).and_then(|x| x.as_str()).map(str::to_string).filter(|s| !s.is_empty())
}

fn num(v: &Json, key: &str) -> u64 {
    v.get(key).and_then(|x| x.as_u64()).unwrap_or(0)
}

/// GitHub's zero time stands for "not yet" in a check run that is still going.
fn time(v: &Json, key: &str) -> Option<String> {
    text(v, key).filter(|t| !t.starts_with("0001-"))
}

fn login(v: &Json) -> String {
    v.get("author").and_then(|a| a.get("login")).and_then(|x| x.as_str()).unwrap_or("ghost").to_string()
}

/// The job id and the `owner/repo` of an Actions check, from
/// `https://github.com/<owner>/<repo>/actions/runs/<run>/job/<job>`.
pub fn actions_job(url: &str) -> Option<(String, u64)> {
    let rest = url.strip_prefix("https://github.com/")?;
    let parts: Vec<&str> = rest.split(['?', '#']).next()?.split('/').collect();
    match parts.as_slice() {
        [owner, repo, "actions", "runs", _, "job", job, ..] if !owner.is_empty() && !repo.is_empty() => Some((format!("{owner}/{repo}"), job.parse().ok()?)),
        _ => None,
    }
}

fn check_of(c: &Json) -> Option<Check> {
    let verdict = check_verdict(c).to_string();
    if c.get("__typename").and_then(|t| t.as_str()) == Some("StatusContext") || c.get("context").is_some() {
        let state = c.get("state").and_then(|x| x.as_str()).unwrap_or("");
        let conclusion = match state {
            "SUCCESS" => Some("success".to_string()),
            "FAILURE" | "ERROR" => Some("failure".to_string()),
            _ => None,
        };
        let url = text(c, "targetUrl");
        return Some(Check {
            name: text(c, "context")?,
            workflow: None,
            verdict,
            status: if conclusion.is_some() { "completed".into() } else { "pending".into() },
            conclusion,
            job_id: url.as_deref().and_then(actions_job).map(|(_, id)| id),
            url,
            description: text(c, "description"),
            started_at: time(c, "startedAt"),
            completed_at: None,
        });
    }
    let url = text(c, "detailsUrl");
    Some(Check {
        name: text(c, "name")?,
        workflow: text(c, "workflowName"),
        verdict,
        status: text(c, "status").unwrap_or_else(|| "queued".into()).to_lowercase(),
        conclusion: text(c, "conclusion").map(|s| s.to_lowercase()),
        job_id: url.as_deref().and_then(actions_job).map(|(_, id)| id),
        url,
        description: None,
        started_at: time(c, "startedAt"),
        completed_at: time(c, "completedAt"),
    })
}

fn rank(verdict: &str) -> u8 {
    match verdict {
        "fail" => 0,
        "pending" => 1,
        _ => 2,
    }
}

/// `statusCheckRollup`, failing first, then running, then the rest, each by name.
pub fn parse_checks(rollup: Option<&Json>) -> Vec<Check> {
    let mut checks: Vec<Check> = rollup.and_then(|r| r.as_array()).map(|a| a.iter().filter_map(check_of).collect()).unwrap_or_default();
    checks.sort_by(|a, b| rank(&a.verdict).cmp(&rank(&b.verdict)).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    checks
}

/// `gh pr view --json PR_FIELDS`: the PR, its checks, and its comments with the reviews' texts
/// (a review with no text of its own and a hidden comment are left out).
pub fn parse_pr(json: &str) -> Result<(Pr, Vec<Check>, Vec<Comment>), String> {
    let v: Json = serde_json::from_str(json).map_err(|e| format!("gh pr view: {e}"))?;
    let draft = v.get("isDraft").and_then(|x| x.as_bool()).unwrap_or(false);
    let state = match v.get("state").and_then(|x| x.as_str()).unwrap_or("OPEN") {
        "MERGED" => "merged",
        "CLOSED" => "closed",
        _ if draft => "draft",
        _ => "open",
    };
    let pr = Pr {
        number: v.get("number").and_then(|x| x.as_u64()).ok_or("gh pr view: no number")?,
        title: text(&v, "title").unwrap_or_default(),
        url: text(&v, "url").unwrap_or_default(),
        state: state.into(),
        base: text(&v, "baseRefName").unwrap_or_default(),
        head: text(&v, "headRefName").unwrap_or_default(),
        head_sha: text(&v, "headRefOid").unwrap_or_default(),
        author: v.get("author").and_then(|a| a.get("login")).and_then(|x| x.as_str()).map(str::to_string),
        mergeable: text(&v, "mergeable").unwrap_or_else(|| "UNKNOWN".into()),
        merge_state: text(&v, "mergeStateStatus").unwrap_or_else(|| "UNKNOWN".into()),
        review_decision: text(&v, "reviewDecision"),
        updated_at: text(&v, "updatedAt").unwrap_or_default(),
        additions: num(&v, "additions"),
        deletions: num(&v, "deletions"),
        changed_files: num(&v, "changedFiles"),
    };
    let mut comments: Vec<Comment> = v
        .get("comments")
        .and_then(|c| c.as_array())
        .map(|a| {
            a.iter()
                .filter(|c| c.get("isMinimized").and_then(|m| m.as_bool()) != Some(true))
                .filter_map(|c| {
                    Some(Comment { author: login(c), body: text(c, "body")?, created_at: text(c, "createdAt").unwrap_or_default(), url: text(c, "url"), review: None, diff_hunk: None })
                })
                .collect()
        })
        .unwrap_or_default();
    if let Some(reviews) = v.get("reviews").and_then(|r| r.as_array()) {
        comments.extend(reviews.iter().filter_map(|r| {
            Some(Comment {
                author: login(r),
                body: text(r, "body")?,
                created_at: text(r, "submittedAt").unwrap_or_default(),
                url: None,
                review: text(r, "state"),
                diff_hunk: None,
            })
        }));
    }
    comments.sort_by(|a, b| a.created_at.cmp(&b.created_at));
    Ok((pr, parse_checks(v.get("statusCheckRollup")), comments))
}

/// The last `n` lines of a diff hunk: the lines a comment was made under.
fn hunk_end(hunk: &str, n: usize) -> String {
    let lines: Vec<&str> = hunk.lines().collect();
    lines[lines.len().saturating_sub(n)..].join("\n")
}

/// The `reviewThreads` GraphQL answer, unresolved threads first.
pub fn parse_threads(json: &str) -> Result<Vec<Thread>, String> {
    let v: Json = serde_json::from_str(json).map_err(|e| format!("review threads: {e}"))?;
    if let Some(errs) = v.get("errors").and_then(|e| e.as_array()).filter(|e| !e.is_empty()) {
        return Err(errs[0].get("message").and_then(|m| m.as_str()).unwrap_or("review threads: GitHub refused the query").to_string());
    }
    let nodes = v.pointer("/data/repository/pullRequest/reviewThreads/nodes").and_then(|n| n.as_array()).cloned().unwrap_or_default();
    let mut threads: Vec<Thread> = nodes
        .iter()
        .filter_map(|t| {
            let comments: Vec<Comment> = t
                .pointer("/comments/nodes")
                .and_then(|c| c.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|c| {
                            Some(Comment {
                                author: login(c),
                                body: text(c, "body")?,
                                created_at: text(c, "createdAt").unwrap_or_default(),
                                url: text(c, "url"),
                                review: None,
                                diff_hunk: text(c, "diffHunk").map(|h| hunk_end(&h, 6)),
                            })
                        })
                        .collect()
                })
                .unwrap_or_default();
            if comments.is_empty() {
                return None;
            }
            Some(Thread {
                id: text(t, "id")?,
                path: text(t, "path").unwrap_or_default(),
                line: t.get("line").and_then(|x| x.as_u64()).or_else(|| t.get("originalLine").and_then(|x| x.as_u64())),
                resolved: t.get("isResolved").and_then(|x| x.as_bool()).unwrap_or(false),
                outdated: t.get("isOutdated").and_then(|x| x.as_bool()).unwrap_or(false),
                comments,
            })
        })
        .collect();
    threads.sort_by_key(|t| t.resolved);
    Ok(threads)
}

/// `gh repo view --json squashMergeAllowed,mergeCommitAllowed,rebaseMergeAllowed`.
pub fn parse_merge_methods(json: &str) -> Vec<String> {
    let Ok(v) = serde_json::from_str::<Json>(json) else { return all_methods() };
    let allowed = |k: &str| v.get(k).and_then(|x| x.as_bool()).unwrap_or(false);
    let methods: Vec<String> = [("squash", "squashMergeAllowed"), ("merge", "mergeCommitAllowed"), ("rebase", "rebaseMergeAllowed")]
        .iter()
        .filter(|(_, k)| allowed(k))
        .map(|(m, _)| m.to_string())
        .collect();
    if methods.is_empty() {
        all_methods()
    } else {
        methods
    }
}

/// When the repository's settings cannot be read: every method, and GitHub refuses one it does
/// not allow with its own reason.
fn all_methods() -> Vec<String> {
    vec!["squash".into(), "merge".into(), "rebase".into()]
}

/// `gh api repos/<o>/<r>/actions/jobs/<id>`.
pub fn parse_job(json: &str) -> Result<CheckDetails, String> {
    let v: Json = serde_json::from_str(json).map_err(|e| format!("job: {e}"))?;
    let steps = v
        .get("steps")
        .and_then(|s| s.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|s| {
                    Some(Step {
                        number: num(s, "number"),
                        name: text(s, "name")?,
                        status: text(s, "status").unwrap_or_default(),
                        conclusion: text(s, "conclusion"),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(CheckDetails {
        job_id: v.get("id").and_then(|x| x.as_u64()).ok_or("job: no id")?,
        name: text(&v, "name").unwrap_or_default(),
        status: text(&v, "status").unwrap_or_else(|| "queued".into()),
        conclusion: text(&v, "conclusion"),
        url: text(&v, "html_url"),
        started_at: time(&v, "started_at"),
        completed_at: time(&v, "completed_at"),
        steps,
        annotations: vec![],
        log_tail: None,
        log_error: None,
    })
}

/// `gh api repos/<o>/<r>/check-runs/<id>/annotations`, failures first.
pub fn parse_annotations(json: &str) -> Vec<Annotation> {
    let Ok(Json::Array(rows)) = serde_json::from_str::<Json>(json) else { return vec![] };
    let mut out: Vec<Annotation> = rows
        .iter()
        .filter_map(|a| {
            Some(Annotation {
                path: text(a, "path").unwrap_or_default(),
                line: a.get("start_line").and_then(|x| x.as_u64()),
                level: text(a, "annotation_level").unwrap_or_else(|| "notice".into()),
                title: text(a, "title"),
                message: text(a, "message")?,
            })
        })
        .collect();
    let order = |l: &str| match l {
        "failure" => 0,
        "warning" => 1,
        _ => 2,
    };
    out.sort_by_key(|a| order(&a.level));
    out
}

/// A job failed: its log is worth reading.
pub fn failed(conclusion: Option<&str>) -> bool {
    matches!(conclusion, Some("failure" | "timed_out" | "startup_failure" | "cancelled"))
}

/// Drops the `2026-09-24T16:18:07.6860211Z ` stamp Actions puts on every log line (an empty
/// line is the stamp alone).
fn unstamp(line: &str) -> &str {
    let b = line.as_bytes();
    if b.len() > 20 && b[4] == b'-' && b[7] == b'-' && b[10] == b'T' {
        if let Some(z) = b[..b.len().min(40)].iter().position(|&c| c == b'Z') {
            let rest = &line[z + 1..];
            return rest.strip_prefix(' ').unwrap_or(rest);
        }
    }
    line
}

/// Drops terminal escape sequences (colour, cursor) a CI tool wrote into its log.
fn strip_ansi(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut chars = line.chars().peekable();
    while let Some(c) = chars.next() {
        if c != '\u{1b}' {
            out.push(c);
            continue;
        }
        if chars.peek() == Some(&'[') {
            chars.next();
            // Parameters and intermediates, then one final byte in `@`..`~`.
            for f in chars.by_ref() {
                if ('@'..='~').contains(&f) {
                    break;
                }
            }
        } else {
            chars.next();
        }
    }
    out
}

/// A failed job's log as an agent reads it: the lines up to its last error (or up to the runner's
/// cleanup when there is none), at most `TAIL_LINES` of them and `TAIL_BYTES`, with the
/// timestamps and escape sequences gone.
pub fn log_tail(log: &str) -> String {
    let lines: Vec<String> = log
        .trim_start_matches('\u{feff}')
        .lines()
        .map(|l| strip_ansi(unstamp(l)))
        .filter(|l| l != "##[endgroup]")
        .collect();
    let end = match lines.iter().rposition(|l| l.contains("##[error]")) {
        Some(i) => i + 1,
        None => lines.iter().position(|l| l == "Post job cleanup.").unwrap_or(lines.len()),
    };
    let mut kept = lines[end.saturating_sub(TAIL_LINES)..end].to_vec();
    while kept.first().is_some_and(|l| l.trim().is_empty()) {
        kept.remove(0);
    }
    let mut tail = kept.join("\n");
    if tail.len() > TAIL_BYTES {
        let mut cut = tail.len() - TAIL_BYTES;
        while !tail.is_char_boundary(cut) {
            cut += 1;
        }
        // Start on a whole line.
        let from = tail[cut..].find('\n').map(|i| cut + i + 1).unwrap_or(cut);
        tail = tail[from..].to_string();
    }
    tail
}

/// Whether the PR read at the moment of a merge may be merged, pinned to `sha` (the head the
/// user was shown): open, not a draft, still at `sha`, with checks, every one passed.
pub fn gate(json: &str, sha: &str) -> Result<(), String> {
    let v: Json = serde_json::from_str(json).map_err(|e| format!("gh pr view: {e}"))?;
    let n = num(&v, "number");
    match v.get("state").and_then(|x| x.as_str()).unwrap_or("") {
        "OPEN" => {}
        "MERGED" => return Err(format!("PR #{n} was already merged on GitHub")),
        other => return Err(format!("PR #{n} is {}", other.to_lowercase())),
    }
    if v.get("isDraft").and_then(|x| x.as_bool()) == Some(true) {
        return Err(format!("PR #{n} is a draft: mark it ready for review first"));
    }
    let head = text(&v, "headRefOid").unwrap_or_default();
    if head != sha {
        return Err(format!("its head moved to {} since it was shown: look at the checks again", &head[..head.len().min(7)]));
    }
    let checks = parse_checks(v.get("statusCheckRollup"));
    if checks.is_empty() {
        return Err("no checks ran on its head, so nothing says it is green".into());
    }
    let named = |verdict: &str| checks.iter().filter(|c| c.verdict == verdict).map(|c| c.name.as_str()).collect::<Vec<_>>();
    let count = |n: usize| if n == 1 { "1 check".to_string() } else { format!("{n} checks") };
    let failing = named("fail");
    if !failing.is_empty() {
        return Err(format!("{} failed: {}", count(failing.len()), failing.join(", ")));
    }
    let pending = named("pending");
    if !pending.is_empty() {
        return Err(format!("{} not finished: {}", count(pending.len()), pending.join(", ")));
    }
    Ok(())
}

// ------------------------------------------------------------- running --

/// Runs `program` in `cwd` with the login PATH, never prompting, killed after `GH_TIMEOUT`.
/// stdout on success; otherwise the first line it said.
pub fn run(program: &str, args: &[&str], cwd: &Path) -> Result<String, String> {
    let mut cmd = crate::proc::command(program);
    cmd.args(args)
        .current_dir(cwd)
        .env("PATH", login_path())
        .env("GH_PROMPT_DISABLED", "1")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("NO_COLOR", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| if e.kind() == std::io::ErrorKind::NotFound && program == "gh" { GH_MISSING.to_string() } else { format!("{program}: {e}") })?;
    let drain = |mut r: Box<dyn Read + Send>| {
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            let _ = r.read_to_end(&mut buf);
            String::from_utf8_lossy(&buf).into_owned()
        })
    };
    let out = drain(Box::new(child.stdout.take().expect("stdout is piped")));
    let err = drain(Box::new(child.stderr.take().expect("stderr is piped")));
    let deadline = Instant::now() + GH_TIMEOUT;
    let status = loop {
        match child.try_wait().map_err(|e| format!("{program}: {e}"))? {
            Some(s) => break s,
            None if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("{program} {} gave no answer in {}s and was stopped", args.first().unwrap_or(&""), GH_TIMEOUT.as_secs()));
            }
            None => std::thread::sleep(Duration::from_millis(25)),
        }
    };
    let (stdout, stderr) = (out.join().unwrap_or_default(), err.join().unwrap_or_default());
    if status.success() {
        return Ok(stdout);
    }
    let said = if stderr.trim().is_empty() { &stdout } else { &stderr };
    Err(said.lines().map(|l| unmark(l.trim())).find(|l| !l.is_empty()).unwrap_or("it exited without saying why").to_string())
}

/// `gh`'s refusal without the mark it opens with (`X Pull request … is not mergeable`).
fn unmark(line: &str) -> &str {
    ["X ", "! ", "✗ "].iter().find_map(|m| line.strip_prefix(m)).map(str::trim_start).unwrap_or(line)
}

/// The worktree's top folder and branch (None on a detached HEAD).
fn locate(worktree: &str, run: Run) -> Result<(PathBuf, Option<String>), String> {
    let dir = Path::new(worktree);
    if !dir.is_dir() || !may_probe(worktree) {
        return Err(format!("{worktree}: folder not accessible"));
    }
    let root = PathBuf::from(run("git", &["rev-parse", "--show-toplevel"], dir).map_err(|e| format!("not a git repository: {e}"))?.trim());
    let branch = run("git", &["symbolic-ref", "--quiet", "--short", "HEAD"], &root).ok().map(|b| b.trim().to_string()).filter(|b| !b.is_empty());
    Ok((root, branch))
}

fn no_pr(e: &str) -> bool {
    e.contains("no pull requests found") || e.contains("no open pull requests")
}

fn methods_cache() -> &'static Mutex<HashMap<PathBuf, (Instant, Vec<String>)>> {
    static C: OnceLock<Mutex<HashMap<PathBuf, (Instant, Vec<String>)>>> = OnceLock::new();
    C.get_or_init(Default::default)
}

/// The repository's merge methods, read once every ten minutes.
fn merge_methods(root: &Path, run: Run) -> Vec<String> {
    const TTL: Duration = Duration::from_secs(600);
    if let Some((at, m)) = methods_cache().lock().unwrap().get(root) {
        if at.elapsed() < TTL {
            return m.clone();
        }
    }
    match run("gh", &["repo", "view", "--json", "squashMergeAllowed,mergeCommitAllowed,rebaseMergeAllowed"], root) {
        Ok(json) => {
            let m = parse_merge_methods(&json);
            methods_cache().lock().unwrap().insert(root.to_path_buf(), (Instant::now(), m.clone()));
            m
        }
        Err(_) => all_methods(),
    }
}

/// What the Checks tab shows for `worktree`. No PR is an answer (`pr: None`), not an error.
pub fn read_view(worktree: &str, run: Run) -> Result<ChecksView, String> {
    let (root, branch) = locate(worktree, run)?;
    let mut view = ChecksView { root: root.to_string_lossy().into_owned(), branch, ..ChecksView::default() };
    if view.branch.is_none() {
        return Ok(view);
    }
    // No argument: gh finds the branch's PR through its upstream, as `gh pr view` in a terminal.
    let json = match run("gh", &["pr", "view", "--json", PR_FIELDS], &root) {
        Err(e) if no_pr(&e) => return Ok(view),
        r => r?,
    };
    let (pr, checks, comments) = parse_pr(&json)?;
    let number = pr.number.to_string();
    let (threads, methods) = std::thread::scope(|s| {
        let methods = s.spawn(|| merge_methods(&root, run));
        let q = format!("query={THREADS_QUERY}");
        let threads = run("gh", &["api", "graphql", "-F", "owner={owner}", "-F", "name={repo}", "-F", &format!("number={number}"), "-f", &q], &root).and_then(|j| parse_threads(&j));
        (threads, methods.join().unwrap_or_else(|_| all_methods()))
    });
    match threads {
        Ok(t) => view.threads = t,
        Err(e) => view.threads_error = Some(e),
    }
    view.pr = Some(pr);
    view.checks = checks;
    view.comments = comments;
    view.merge_methods = methods;
    Ok(view)
}

fn details_cache() -> &'static Mutex<HashMap<String, CheckDetails>> {
    static C: OnceLock<Mutex<HashMap<String, CheckDetails>>> = OnceLock::new();
    C.get_or_init(Default::default)
}

/// Finished jobs kept; a finished job never changes.
const DETAILS_KEPT: usize = 64;

/// The Actions job behind the check at `url`: its steps, annotations and, when it failed, its
/// log's tail. A failed annotation or log read leaves the rest; a finished job is read once.
pub fn read_details(worktree: &str, url: &str, run: Run) -> Result<CheckDetails, String> {
    let (repo, job) = actions_job(url).ok_or("This check did not run on GitHub Actions: its details are on the page it links to.")?;
    if let Some(d) = details_cache().lock().unwrap().get(url) {
        return Ok(d.clone());
    }
    let dir = Path::new(worktree);
    if !dir.is_dir() || !may_probe(worktree) {
        return Err(format!("{worktree}: folder not accessible"));
    }
    let base = format!("repos/{repo}");
    let mut details = parse_job(&run("gh", &["api", &format!("{base}/actions/jobs/{job}")], dir)?)?;
    let (annotations, log) = std::thread::scope(|s| {
        let annotations = s.spawn(|| run("gh", &["api", &format!("{base}/check-runs/{job}/annotations?per_page={ANNOTATIONS}")], dir));
        let log = failed(details.conclusion.as_deref()).then(|| run("gh", &["api", &format!("{base}/actions/jobs/{job}/logs")], dir));
        (annotations.join().unwrap_or_else(|_| Err("annotations: the read panicked".into())), log)
    });
    details.annotations = annotations.map(|j| parse_annotations(&j)).unwrap_or_default();
    match log {
        Some(Ok(text)) => details.log_tail = Some(log_tail(&text)).filter(|t| !t.is_empty()),
        Some(Err(e)) => details.log_error = Some(e),
        None => {}
    }
    if details.status == "completed" && details.log_error.is_none() {
        let mut cache = details_cache().lock().unwrap();
        if cache.len() >= DETAILS_KEPT {
            cache.clear();
        }
        cache.insert(url.to_string(), details.clone());
    }
    Ok(details)
}

/// Merges PR `number` by `method`, pinned to `sha`, once `gate` passes on a fresh read.
pub fn merge(worktree: &str, number: u64, method: &str, sha: &str, run: Run) -> Result<Merged, String> {
    if !["squash", "merge", "rebase"].contains(&method) {
        return Err(format!("unknown merge method {method}"));
    }
    if sha.is_empty() {
        return Err("no head commit to merge".into());
    }
    let (root, _) = locate(worktree, run)?;
    let n = number.to_string();
    let read = || run("gh", &["pr", "view", &n, "--json", GATE_FIELDS], &root).map_err(|e| format!("could not read PR #{n}: {e}"));
    gate(&read()?, sha).map_err(|e| format!("Not merged: {e}"))?;
    run("gh", &["pr", "merge", &n, &format!("--{method}"), "--match-head-commit", sha], &root).map_err(|e| format!("Not merged: {e}"))?;
    // gh exits 0 on a PR it only queued; merged is what GitHub says.
    let after = read().map_err(|e| format!("gh said it merged, but reading it back failed ({e})"))?;
    let state = serde_json::from_str::<Json>(&after).ok().and_then(|v| text(&v, "state")).unwrap_or_default();
    Ok(if state == "MERGED" {
        Merged { merged: true, message: format!("Merged PR #{n}") }
    } else {
        Merged { merged: false, message: format!("gh accepted it, but PR #{n} is still {} on GitHub", state.to_lowercase()) }
    })
}

/// Marks draft PR `number` ready for review.
pub fn ready(worktree: &str, number: u64, run: Run) -> Result<(), String> {
    let (root, _) = locate(worktree, run)?;
    run("gh", &["pr", "ready", &number.to_string()], &root).map(|_| ()).map_err(|e| format!("Not marked ready: {e}"))
}

// ------------------------------------------------------------ commands --

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

/// The worktree's PR, checks, review threads and comments.
#[tauri::command]
pub async fn checks_read(worktree: String) -> Result<ChecksView, String> {
    blocking(move || read_view(&worktree, &run)).await
}

/// The Actions job behind a check: steps, annotations, and a failed log's tail.
#[tauri::command]
pub async fn checks_details(worktree: String, url: String) -> Result<CheckDetails, String> {
    blocking(move || read_details(&worktree, &url, &run)).await
}

#[tauri::command]
pub async fn checks_merge(worktree: String, number: u64, method: String, sha: String) -> Result<Merged, String> {
    blocking(move || merge(&worktree, number, &method, &sha, &run)).await
}

#[tauri::command]
pub async fn checks_ready(worktree: String, number: u64) -> Result<(), String> {
    blocking(move || ready(&worktree, number, &run)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex as StdMutex;

    const PR: &str = include_str!("../fixtures/checks/pr_view.json");
    const THREADS: &str = include_str!("../fixtures/checks/threads.json");
    const JOB: &str = include_str!("../fixtures/checks/job.json");
    const ANNOTATIONS_JSON: &str = include_str!("../fixtures/checks/annotations.json");
    const LOG: &str = include_str!("../fixtures/checks/job.log");

    #[test]
    fn a_pr_reads_as_its_header_checks_and_comments() {
        let (pr, checks, comments) = parse_pr(PR).unwrap();
        assert_eq!(pr.number, 240);
        assert_eq!(pr.state, "open");
        assert_eq!((pr.base.as_str(), pr.head.as_str()), ("main", "feat/orca-redesign-e/checks"));
        assert_eq!(pr.head_sha, "de92f99410241cdcb2de6aad015b0482e065943e");
        assert_eq!(pr.author.as_deref(), Some("xyrlan"));
        assert_eq!((pr.mergeable.as_str(), pr.merge_state.as_str()), ("MERGEABLE", "UNSTABLE"));
        assert_eq!(pr.review_decision.as_deref(), Some("CHANGES_REQUESTED"));
        assert_eq!((pr.additions, pr.deletions, pr.changed_files), (412, 37, 9));

        // Failing, then running, then the rest by name.
        let names: Vec<(&str, &str)> = checks.iter().map(|c| (c.name.as_str(), c.verdict.as_str())).collect();
        assert_eq!(names, vec![("test (windows-latest)", "fail"), ("test (ubuntu-latest)", "pending"), ("test (macos-latest)", "pass"), ("vercel", "pass")]);
        let win = &checks[0];
        assert_eq!(win.conclusion.as_deref(), Some("failure"));
        assert_eq!(win.status, "completed");
        assert_eq!(win.job_id, Some(107723124603));
        assert_eq!(win.workflow.as_deref(), Some("ci"));
        let running = &checks[1];
        assert_eq!((running.status.as_str(), running.conclusion.as_deref(), running.completed_at.as_deref()), ("in_progress", None, None));
        let vercel = &checks[3];
        assert_eq!((vercel.status.as_str(), vercel.conclusion.as_deref(), vercel.job_id), ("completed", Some("success"), None));
        assert_eq!(vercel.description.as_deref(), Some("Deployment has completed"));
        assert_eq!(vercel.url.as_deref(), Some("https://vercel.com/xyrlan/mnemo/abc"));

        // The review's text and the visible comment, oldest first; the hidden one and the review
        // with no text of its own are gone.
        let said: Vec<(&str, Option<&str>)> = comments.iter().map(|c| (c.body.as_str(), c.review.as_deref())).collect();
        assert_eq!(said, vec![("Two things before this lands, inline.", Some("CHANGES_REQUESTED")), ("Does this still build on Windows? The last run failed there.", None)]);
        assert_eq!(comments[1].author, "octo-reviewer");
    }

    #[test]
    fn a_draft_and_a_merged_pr_say_so() {
        let draft = PR.replace(r#""isDraft": false"#, r#""isDraft": true"#);
        assert_eq!(parse_pr(&draft).unwrap().0.state, "draft");
        let merged = PR.replace(r#""state": "OPEN""#, r#""state": "MERGED""#);
        assert_eq!(parse_pr(&merged).unwrap().0.state, "merged");
        let closed = draft.replace(r#""state": "OPEN""#, r#""state": "CLOSED""#);
        assert_eq!(parse_pr(&closed).unwrap().0.state, "closed");
        assert_eq!(parse_pr(&PR.replace(r#""reviewDecision": "CHANGES_REQUESTED""#, r#""reviewDecision": """#)).unwrap().0.review_decision, None);
        assert!(parse_pr("nope").is_err());
    }

    #[test]
    fn a_pending_commit_status_is_pending_and_an_errored_one_failed() {
        let rollup: Json = serde_json::from_str(
            r#"[{"__typename":"StatusContext","context":"ci/a","state":"PENDING","targetUrl":""},
                {"__typename":"StatusContext","context":"ci/b","state":"ERROR"},
                {"__typename":"CheckRun","name":"queued","status":"QUEUED","conclusion":"","detailsUrl":"https://example.com/x"}]"#,
        )
        .unwrap();
        let checks = parse_checks(Some(&rollup));
        let got: Vec<(&str, &str, &str, Option<&str>)> = checks.iter().map(|c| (c.name.as_str(), c.verdict.as_str(), c.status.as_str(), c.conclusion.as_deref())).collect();
        assert_eq!(got, vec![("ci/b", "fail", "completed", Some("failure")), ("ci/a", "pending", "pending", None), ("queued", "pending", "queued", None)]);
        assert_eq!(checks[1].url, None);
        assert_eq!(checks[2].job_id, None);
        assert!(parse_checks(None).is_empty());
    }

    #[test]
    fn only_an_actions_job_url_names_a_job() {
        assert_eq!(actions_job("https://github.com/o/r/actions/runs/1/job/22"), Some(("o/r".into(), 22)));
        assert_eq!(actions_job("https://github.com/o/r/actions/runs/1/job/22?pr=5"), Some(("o/r".into(), 22)));
        assert_eq!(actions_job("https://github.com/o/r/actions/runs/1"), None);
        assert_eq!(actions_job("https://github.com/o/r/runs/22"), None);
        assert_eq!(actions_job("https://evil.example/o/r/actions/runs/1/job/22"), None);
        assert_eq!(actions_job("https://github.com/o/r/actions/runs/1/job/x"), None);
    }

    #[test]
    fn review_threads_read_unresolved_first_with_the_code_they_are_on() {
        let threads = parse_threads(THREADS).unwrap();
        assert_eq!(threads.len(), 2);
        let open = &threads[0];
        assert_eq!((open.path.as_str(), open.line, open.resolved, open.outdated), ("src-tauri/src/checks.rs", Some(42), false, false));
        assert_eq!(open.comments.len(), 2);
        assert_eq!(open.comments[0].author, "octo-reviewer");
        let hunk = open.comments[0].diff_hunk.as_deref().unwrap();
        assert!(hunk.ends_with("        .output()"), "{hunk}");
        assert_eq!(hunk.lines().count(), 5);
        // A thread whose line is gone keeps the line it was written on; a deleted author is ghost.
        let done = &threads[1];
        assert_eq!((done.line, done.resolved, done.outdated), (Some(12), true, true));
        assert_eq!(done.comments[0].author, "ghost");
        assert_eq!(parse_threads(r#"{"errors":[{"message":"Could not resolve to a PullRequest"}]}"#), Err("Could not resolve to a PullRequest".into()));
    }

    #[test]
    fn merge_methods_follow_the_repository_and_default_to_all() {
        assert_eq!(parse_merge_methods(r#"{"squashMergeAllowed":true,"mergeCommitAllowed":false,"rebaseMergeAllowed":true}"#), vec!["squash", "rebase"]);
        assert_eq!(parse_merge_methods(r#"{"squashMergeAllowed":false,"mergeCommitAllowed":false,"rebaseMergeAllowed":false}"#), vec!["squash", "merge", "rebase"]);
        assert_eq!(parse_merge_methods("oops"), vec!["squash", "merge", "rebase"]);
    }

    #[test]
    fn a_job_reads_as_its_steps_and_its_annotations_failures_first() {
        let job = parse_job(JOB).unwrap();
        assert_eq!(job.job_id, 107723124603);
        assert_eq!(job.name, "test (windows-latest)");
        assert_eq!((job.status.as_str(), job.conclusion.as_deref()), ("completed", Some("failure")));
        let failed_step = job.steps.iter().find(|s| s.conclusion.as_deref() == Some("failure")).unwrap();
        assert_eq!(failed_step.name, "Run cargo test --manifest-path src-tauri/Cargo.toml");
        assert_eq!(failed_step.number, 11);
        let notes = parse_annotations(ANNOTATIONS_JSON);
        assert_eq!(notes.len(), 2);
        assert_eq!((notes[0].level.as_str(), notes[0].message.as_str(), notes[0].line), ("failure", "Process completed with exit code 1.", Some(445)));
        assert_eq!(notes[1].level, "warning");
        assert_eq!(notes[0].title, None);
        assert!(parse_annotations("{}").is_empty());
    }

    #[test]
    fn the_log_tail_ends_at_the_last_error_without_stamps_or_colour() {
        let tail = log_tail(LOG);
        let lines: Vec<&str> = tail.lines().collect();
        assert_eq!(lines.last(), Some(&"##[error]Process completed with exit code 1."));
        assert!(lines.len() <= TAIL_LINES);
        assert!(tail.contains("test result: FAILED. 280 passed; 2 failed"));
        assert!(!tail.contains("Post job cleanup."));
        assert!(!tail.contains('\u{1b}'));
        assert!(!tail.contains("2026-09-24T16:23:36"));
        assert!(tail.contains("error: test failed, to rerun pass `--lib`"), "{tail}");
        // No error marker (a cancelled job): up to the runner's cleanup.
        let cancelled = "2026-09-24T16:00:00.0000000Z building\n2026-09-24T16:00:01.0000000Z The operation was canceled.\n2026-09-24T16:00:02.0000000Z Post job cleanup.\n2026-09-24T16:00:03.0000000Z noise";
        assert_eq!(log_tail(cancelled), "building\nThe operation was canceled.");
        // Long: the last TAIL_LINES lines, then cut to TAIL_BYTES on a line start.
        let long: String = (0..500).map(|i| format!("line {i} {}\n", "é".repeat(100))).collect();
        let t = log_tail(&long);
        assert!(t.len() <= TAIL_BYTES);
        assert!(t.starts_with("line "), "{}", &t[..20]);
        assert!(t.ends_with(&format!("line 499 {}", "é".repeat(100))));
        assert_eq!(log_tail(""), "");
    }

    #[test]
    fn escape_sequences_and_stamps_go_and_the_text_stays() {
        assert_eq!(strip_ansi("\u{1b}[1m\u{1b}[91merror\u{1b}[0m: x"), "error: x");
        assert_eq!(unstamp("2026-09-24T16:23:36.7179273Z ##[error]boom"), "##[error]boom");
        assert_eq!(unstamp("no stamp here at all, nothing to drop"), "no stamp here at all, nothing to drop");
        assert_eq!(unstamp("2026-09-24T16:23:36.6253318Z"), "");
        assert_eq!(unstamp("2026-09-24T16:23:36.6253318Z ééééééééééééééé"), "ééééééééééééééé");
        assert_eq!(unstamp(""), "");
    }

    fn gate_json(state: &str, draft: bool, head: &str, rollup: &str) -> String {
        format!(r#"{{"number":7,"state":"{state}","isDraft":{draft},"headRefOid":"{head}","statusCheckRollup":{rollup}}}"#)
    }

    const GREEN: &str = r#"[{"__typename":"CheckRun","name":"a","status":"COMPLETED","conclusion":"SUCCESS"},{"__typename":"StatusContext","context":"b","state":"SUCCESS"}]"#;

    #[test]
    fn the_gate_lets_through_only_an_open_green_pr_at_the_head_shown() {
        assert_eq!(gate(&gate_json("OPEN", false, "abc", GREEN), "abc"), Ok(()));
        assert_eq!(gate(&gate_json("MERGED", false, "abc", GREEN), "abc"), Err("PR #7 was already merged on GitHub".into()));
        assert_eq!(gate(&gate_json("CLOSED", false, "abc", GREEN), "abc"), Err("PR #7 is closed".into()));
        assert_eq!(gate(&gate_json("OPEN", true, "abc", GREEN), "abc"), Err("PR #7 is a draft: mark it ready for review first".into()));
        assert_eq!(gate(&gate_json("OPEN", false, "def4567890", GREEN), "abc"), Err("its head moved to def4567 since it was shown: look at the checks again".into()));
        assert_eq!(gate(&gate_json("OPEN", false, "abc", "[]"), "abc"), Err("no checks ran on its head, so nothing says it is green".into()));
        assert_eq!(gate(&gate_json("OPEN", false, "abc", "null"), "abc"), Err("no checks ran on its head, so nothing says it is green".into()));
        let red = r#"[{"__typename":"CheckRun","name":"win","status":"COMPLETED","conclusion":"FAILURE"},{"__typename":"CheckRun","name":"mac","status":"COMPLETED","conclusion":"SUCCESS"}]"#;
        assert_eq!(gate(&gate_json("OPEN", false, "abc", red), "abc"), Err("1 check failed: win".into()));
        let running = r#"[{"__typename":"CheckRun","name":"a","status":"IN_PROGRESS","conclusion":""},{"__typename":"StatusContext","context":"b","state":"PENDING"}]"#;
        assert_eq!(gate(&gate_json("OPEN", false, "abc", running), "abc"), Err("2 checks not finished: a, b".into()));
    }

    /// A scripted `git`/`gh`: each call is recorded; `answer` maps the joined argv to a reply.
    struct Script {
        calls: StdMutex<Vec<String>>,
        answer: Box<dyn Fn(&str) -> Result<String, String> + Sync + Send>,
    }

    impl Script {
        fn new(answer: impl Fn(&str) -> Result<String, String> + Sync + Send + 'static) -> Self {
            Script { calls: StdMutex::new(vec![]), answer: Box::new(answer) }
        }
        fn run(&self, program: &str, args: &[&str], _cwd: &Path) -> Result<String, String> {
            let line = format!("{program} {}", args.join(" "));
            self.calls.lock().unwrap().push(line.clone());
            (self.answer)(&line)
        }
        fn calls(&self) -> Vec<String> {
            self.calls.lock().unwrap().clone()
        }
    }

    fn git_ok(line: &str) -> Option<Result<String, String>> {
        if line.starts_with("git rev-parse") {
            return Some(Ok(format!("{}\n", env!("CARGO_MANIFEST_DIR"))));
        }
        if line.starts_with("git symbolic-ref") {
            return Some(Ok("feat/orca-redesign-e/checks\n".into()));
        }
        None
    }

    const DIR: &str = env!("CARGO_MANIFEST_DIR");

    #[test]
    fn the_view_reads_the_pr_then_its_threads_and_merge_methods() {
        let s = Script::new(|line| {
            if let Some(r) = git_ok(line) {
                return r;
            }
            if line.starts_with("gh pr view --json") {
                return Ok(PR.into());
            }
            if line.starts_with("gh api graphql") {
                assert!(line.contains("-F number=240"), "{line}");
                return Ok(THREADS.into());
            }
            if line.starts_with("gh repo view") {
                return Ok(r#"{"squashMergeAllowed":true,"mergeCommitAllowed":false,"rebaseMergeAllowed":false}"#.into());
            }
            Err(format!("unexpected {line}"))
        });
        let view = read_view(DIR, &|p, a, c| s.run(p, a, c)).unwrap();
        assert_eq!(view.branch.as_deref(), Some("feat/orca-redesign-e/checks"));
        assert_eq!(view.pr.as_ref().map(|p| p.number), Some(240));
        assert_eq!(view.checks.len(), 4);
        assert_eq!(view.threads.len(), 2);
        assert_eq!(view.comments.len(), 2);
        assert_eq!(view.threads_error, None);
        // Merge methods are cached per repository, and the other tests share this one.
        assert!(!view.merge_methods.is_empty());
        assert!(s.calls().iter().any(|c| c.starts_with("gh pr view --json number,title")));
    }

    #[test]
    fn merge_methods_are_read_once_per_repository_and_a_failure_is_not_kept() {
        let root = Path::new("/checks-test/merge-methods");
        let s = Script::new(|_| Ok(r#"{"squashMergeAllowed":true,"mergeCommitAllowed":false,"rebaseMergeAllowed":false}"#.into()));
        assert_eq!(merge_methods(root, &|p, a, c| s.run(p, a, c)), vec!["squash"]);
        assert_eq!(merge_methods(root, &|p, a, c| s.run(p, a, c)), vec!["squash"]);
        assert_eq!(s.calls().len(), 1);
        let other = Path::new("/checks-test/merge-methods-unreadable");
        let no = Script::new(|_| Err("HTTP 502".into()));
        assert_eq!(merge_methods(other, &|p, a, c| no.run(p, a, c)).len(), 3);
        merge_methods(other, &|p, a, c| no.run(p, a, c));
        assert_eq!(no.calls().len(), 2);
    }

    #[test]
    fn gh_marks_go_and_words_that_start_like_them_stay() {
        assert_eq!(unmark("X Pull request #7 is not mergeable"), "Pull request #7 is not mergeable");
        assert_eq!(unmark("✗ nope"), "nope");
        assert_eq!(unmark("XML parse error"), "XML parse error");
    }

    #[test]
    fn no_pr_and_a_detached_head_are_answers_and_a_thread_failure_keeps_the_rest() {
        let none = Script::new(|line| git_ok(line).unwrap_or_else(|| Err("no pull requests found for branch \"feat/orca-redesign-e/checks\"".into())));
        let view = read_view(DIR, &|p, a, c| none.run(p, a, c)).unwrap();
        assert_eq!((view.branch.is_some(), view.pr.is_none(), view.checks.len()), (true, true, 0));

        let detached = Script::new(|line| {
            if line.starts_with("git symbolic-ref") {
                return Err("".into());
            }
            git_ok(line).unwrap_or_else(|| Err(format!("gh must not run: {line}")))
        });
        let view = read_view(DIR, &|p, a, c| detached.run(p, a, c)).unwrap();
        assert_eq!((view.branch, view.pr), (None, None));
        assert!(detached.calls().iter().all(|c| c.starts_with("git ")));

        let no_threads = Script::new(|line| {
            git_ok(line).unwrap_or_else(|| {
                if line.starts_with("gh pr view") {
                    Ok(PR.into())
                } else if line.starts_with("gh api graphql") {
                    Err("HTTP 502".into())
                } else {
                    Ok("{}".into())
                }
            })
        });
        let view = read_view(DIR, &|p, a, c| no_threads.run(p, a, c)).unwrap();
        assert_eq!(view.threads_error.as_deref(), Some("HTTP 502"));
        assert_eq!(view.checks.len(), 4);

        let broken = Script::new(|line| git_ok(line).unwrap_or_else(|| Err("gh: Not Found (HTTP 404)".into())));
        assert_eq!(read_view(DIR, &|p, a, c| broken.run(p, a, c)), Err("gh: Not Found (HTTP 404)".into()));
        assert!(read_view("/no/such/folder/anywhere", &|p, a, c| broken.run(p, a, c)).is_err());
    }

    #[test]
    fn details_read_the_job_its_annotations_and_a_failed_log() {
        let url = "https://github.com/xyrlan/mnemo-desktop/actions/runs/36026166545/job/107723124603?test=details";
        let s = Script::new(|line| {
            if line == "gh api repos/xyrlan/mnemo-desktop/actions/jobs/107723124603" {
                return Ok(JOB.into());
            }
            if line.starts_with("gh api repos/xyrlan/mnemo-desktop/check-runs/107723124603/annotations") {
                return Ok(ANNOTATIONS_JSON.into());
            }
            if line == "gh api repos/xyrlan/mnemo-desktop/actions/jobs/107723124603/logs" {
                return Ok(LOG.into());
            }
            Err(format!("unexpected {line}"))
        });
        let d = read_details(DIR, url, &|p, a, c| s.run(p, a, c)).unwrap();
        assert_eq!(d.annotations.len(), 2);
        assert!(d.log_tail.as_deref().unwrap().ends_with("##[error]Process completed with exit code 1."));
        assert_eq!(d.log_error, None);
        assert_eq!(s.calls().len(), 3);
        // Finished: the second read asks nothing.
        let again = read_details(DIR, url, &|p, a, c| s.run(p, a, c)).unwrap();
        assert_eq!(again, d);
        assert_eq!(s.calls().len(), 3);

        // A passing job's log is not read; an unreadable log says why and is not kept.
        let url = "https://github.com/o/r/actions/runs/1/job/5";
        let ok = Script::new(|line| {
            if line == "gh api repos/o/r/actions/jobs/5" {
                return Ok(JOB.replace(r#""conclusion":"failure""#, r#""conclusion":"success""#));
            }
            Ok("[]".into())
        });
        let d = read_details(DIR, url, &|p, a, c| ok.run(p, a, c)).unwrap();
        assert_eq!((d.log_tail, d.log_error), (None, None));
        assert!(!ok.calls().iter().any(|c| c.ends_with("/logs")));

        let url = "https://github.com/o/r/actions/runs/1/job/6";
        let gone = Script::new(|line| {
            if line == "gh api repos/o/r/actions/jobs/6" {
                return Ok(JOB.replace("107723124603", "6"));
            }
            if line.ends_with("/logs") {
                return Err("gh: Not Found (HTTP 404)".into());
            }
            Err("gh: annotations unavailable".into())
        });
        let d = read_details(DIR, url, &|p, a, c| gone.run(p, a, c)).unwrap();
        assert_eq!(d.log_error.as_deref(), Some("gh: Not Found (HTTP 404)"));
        assert!(d.annotations.is_empty());
        read_details(DIR, url, &|p, a, c| gone.run(p, a, c)).unwrap();
        assert_eq!(gone.calls().iter().filter(|c| c.ends_with("jobs/6")).count(), 2);

        assert!(read_details(DIR, "https://vercel.com/x", &|p, a, c| gone.run(p, a, c)).unwrap_err().contains("did not run on GitHub Actions"));
    }

    #[test]
    fn a_merge_reads_again_merges_only_the_head_shown_and_says_merged_once_github_does() {
        const SHA: &str = "abc1234";
        let reads = StdMutex::new(0);
        let s = Script::new(move |line| {
            if let Some(r) = git_ok(line) {
                return r;
            }
            if line.starts_with("gh pr view 7 --json") {
                let mut n = reads.lock().unwrap();
                *n += 1;
                return Ok(gate_json(if *n == 1 { "OPEN" } else { "MERGED" }, false, SHA, GREEN));
            }
            if line.starts_with("gh pr merge") {
                return Ok(String::new());
            }
            Err(format!("unexpected {line}"))
        });
        let got = merge(DIR, 7, "squash", SHA, &|p, a, c| s.run(p, a, c)).unwrap();
        assert_eq!(got, Merged { merged: true, message: "Merged PR #7".into() });
        assert!(s.calls().contains(&"gh pr merge 7 --squash --match-head-commit abc1234".to_string()));
        assert!(!s.calls().iter().any(|c| c.contains("--admin")));

        // gh accepts, GitHub still has it open (a merge queue): not called merged.
        let queued = Script::new(|line| git_ok(line).unwrap_or_else(|| if line.starts_with("gh pr view") { Ok(gate_json("OPEN", false, SHA, GREEN)) } else { Ok(String::new()) }));
        let got = merge(DIR, 7, "rebase", SHA, &|p, a, c| queued.run(p, a, c)).unwrap();
        assert_eq!(got, Merged { merged: false, message: "gh accepted it, but PR #7 is still open on GitHub".into() });

        // The gate refuses: gh pr merge never runs.
        let red = r#"[{"__typename":"CheckRun","name":"win","status":"COMPLETED","conclusion":"FAILURE"}]"#;
        let refused = Script::new(move |line| git_ok(line).unwrap_or_else(|| if line.starts_with("gh pr view") { Ok(gate_json("OPEN", false, SHA, red)) } else { Err(format!("must not run: {line}")) }));
        assert_eq!(merge(DIR, 7, "squash", SHA, &|p, a, c| refused.run(p, a, c)), Err("Not merged: 1 check failed: win".into()));
        assert!(!refused.calls().iter().any(|c| c.starts_with("gh pr merge")));

        // gh's own refusal is passed on.
        let no = Script::new(|line| {
            git_ok(line).unwrap_or_else(|| if line.starts_with("gh pr view") { Ok(gate_json("OPEN", false, SHA, GREEN)) } else { Err("Pull request is not mergeable: the base branch policy prohibits the merge.".into()) })
        });
        assert_eq!(merge(DIR, 7, "merge", SHA, &|p, a, c| no.run(p, a, c)), Err("Not merged: Pull request is not mergeable: the base branch policy prohibits the merge.".into()));

        assert_eq!(merge(DIR, 7, "--admin", SHA, &|p, a, c| no.run(p, a, c)), Err("unknown merge method --admin".into()));
        assert_eq!(merge(DIR, 7, "squash", "", &|p, a, c| no.run(p, a, c)), Err("no head commit to merge".into()));
    }

    #[test]
    fn ready_marks_the_pr_and_passes_on_a_refusal() {
        let s = Script::new(|line| git_ok(line).unwrap_or_else(|| if line == "gh pr ready 7" { Ok(String::new()) } else { Err(format!("unexpected {line}")) }));
        assert_eq!(ready(DIR, 7, &|p, a, c| s.run(p, a, c)), Ok(()));
        let no = Script::new(|line| git_ok(line).unwrap_or_else(|| Err("GraphQL: Resource not accessible by integration".into())));
        assert_eq!(ready(DIR, 7, &|p, a, c| no.run(p, a, c)), Err("Not marked ready: GraphQL: Resource not accessible by integration".into()));
    }

    #[test]
    fn run_answers_stdout_or_the_first_line_said_and_knows_a_missing_program() {
        let dir = Path::new(DIR);
        assert_eq!(run("git", &["rev-parse", "--is-inside-work-tree"], dir).map(|s| s.trim().to_string()), Ok("true".into()));
        let err = run("git", &["no-such-subcommand-here"], dir).unwrap_err();
        assert!(err.contains("no-such-subcommand-here"), "{err}");
        assert!(run("mnemo-desktop-no-such-program", &[], dir).unwrap_err().contains("mnemo-desktop-no-such-program"));
    }

    /// Against the real `gh` in this checkout: `cargo test -- --ignored checks_live`.
    #[test]
    #[ignore]
    fn checks_live() {
        let root = env!("CARGO_MANIFEST_DIR").trim_end_matches("/src-tauri");
        let view = read_view(root, &run);
        println!("{view:#?}");
        if let Ok(v) = view {
            if let Some(url) = v.checks.iter().find_map(|c| c.url.clone().filter(|u| actions_job(u).is_some())) {
                println!("{:#?}", read_details(root, &url, &run));
            }
        }
    }
}

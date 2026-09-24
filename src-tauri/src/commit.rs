//! The commit composer's git and GitHub work, for one worktree: what changed, a commit message
//! written by `claude -p` from the diff, the commit itself, the push, and a pull request whose
//! title and body `claude` drafts from the branch's commits (`gh pr create`).
//!
//! Every step answers `Err` with what git, `gh` or `claude` said, so the composer can show it:
//! a hook's complaint, a rejected push, `gh` not logged in. Nothing here prompts — git and `gh`
//! are told not to ask for credentials, so a push that needs them fails instead of hanging.
//! Parsing and prompt building are pure and tested on their own; the git steps are tested
//! against a scratch repo, and the `claude` ones against a fake `claude`.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::mission::login_path;

/// One changed path, from `git status --porcelain=v2`.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    pub path: String,
    /// The path it was renamed or copied from.
    pub orig_path: Option<String>,
    /// Git's two status letters, index then worktree (`.` for unchanged, `?` untracked).
    pub index: String,
    pub worktree: String,
    /// Unmerged: a conflict to resolve before it can be committed.
    pub conflicted: bool,
}

#[derive(Serialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// The worktree's top folder, where every step runs.
    pub root: String,
    /// None on a detached HEAD.
    pub branch: Option<String>,
    /// The remote a push goes to; None when the repo has none.
    pub remote: Option<String>,
    /// `<remote>/<branch>` exists: the branch was pushed before.
    pub published: bool,
    /// Commits a push would send: ahead of `<remote>/<branch>`, or of the base when unpublished.
    pub ahead: u32,
    /// Commits on `<remote>/<branch>` this branch lacks; a push is refused until they are pulled.
    pub behind: u32,
    /// The branch a pull request targets: the remote's default branch, else `main` or `master`.
    pub base: String,
    /// No commit yet.
    pub unborn: bool,
    pub changes: Vec<Change>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Committed {
    pub sha: String,
    pub summary: String,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequest {
    pub number: u64,
    pub url: String,
    /// `OPEN`, `CLOSED` or `MERGED`, as `gh` spells it.
    pub state: String,
    pub title: String,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PrDraft {
    pub title: String,
    pub body: String,
}

/// How much diff goes into a prompt. Past it the patch is cut, the file list still whole.
const MAX_PATCH_BYTES: usize = 60_000;
/// An untracked file's content, per file, in the commit prompt.
const MAX_NEW_FILE_BYTES: usize = 8_000;
/// Past this many paths the diff is taken whole instead of path by path (a command line has a
/// length limit, and the prompt is cut anyway).
const MAX_DIFF_PATHSPECS: usize = 400;
const GIT_TIMEOUT: Duration = Duration::from_secs(60);
const NET_TIMEOUT: Duration = Duration::from_secs(180);
const CLAUDE_TIMEOUT: Duration = Duration::from_secs(180);
/// Git's empty tree, to diff against before the first commit.
const EMPTY_TREE: &str = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

// ----------------------------------------------------------------- running --

struct Ran {
    ok: bool,
    stdout: String,
    stderr: String,
}

impl Ran {
    /// What the program said, for an error: its stderr and stdout both (a hook writes to
    /// either), or its exit when it said nothing.
    fn said(&self) -> String {
        let text = [self.stderr.trim(), self.stdout.trim()].iter().filter(|s| !s.is_empty()).cloned().collect::<Vec<_>>().join("\n");
        if text.is_empty() {
            "it exited without saying why".into()
        } else {
            text
        }
    }
}

/// Runs `program` in `cwd` with the login PATH, `stdin` fed and closed, never prompting, and
/// killed after `timeout`. `Err` only when it could not run or timed out.
fn exec(program: &str, args: &[&str], cwd: &Path, stdin: Option<&[u8]>, timeout: Duration) -> Result<Ran, String> {
    let mut cmd = crate::proc::command(program);
    cmd.args(args)
        .current_dir(cwd)
        .env("PATH", login_path())
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GH_PROMPT_DISABLED", "1")
        .env("NO_COLOR", "1")
        .stdin(if stdin.is_some() { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| format!("{program}: {e}"))?;
    let feed = stdin.map(|bytes| {
        let mut pipe = child.stdin.take().expect("stdin is piped");
        let bytes = bytes.to_vec();
        // A writer thread, so a program that answers before reading all its input cannot
        // deadlock against a full pipe.
        std::thread::spawn(move || {
            let _ = pipe.write_all(&bytes);
        })
    });
    let drain = |mut r: Box<dyn Read + Send>| {
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            let _ = r.read_to_end(&mut buf);
            String::from_utf8_lossy(&buf).into_owned()
        })
    };
    let out = drain(Box::new(child.stdout.take().expect("stdout is piped")));
    let err = drain(Box::new(child.stderr.take().expect("stderr is piped")));
    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait().map_err(|e| format!("{program}: {e}"))? {
            Some(s) => break s,
            None if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("{program} {} gave no answer in {}s and was stopped", args.first().unwrap_or(&""), timeout.as_secs()));
            }
            None => std::thread::sleep(Duration::from_millis(25)),
        }
    };
    if let Some(f) = feed {
        let _ = f.join();
    }
    Ok(Ran { ok: status.success(), stdout: out.join().unwrap_or_default(), stderr: err.join().unwrap_or_default() })
}

/// `git <args>` in `root`; its stdout, or what it said.
fn git(root: &Path, args: &[&str]) -> Result<String, String> {
    git_in(root, args, None)
}

fn git_in(root: &Path, args: &[&str], stdin: Option<&[u8]>) -> Result<String, String> {
    let ran = exec("git", args, root, stdin, GIT_TIMEOUT)?;
    if ran.ok {
        Ok(ran.stdout)
    } else {
        let verb = args.iter().find(|a| !a.starts_with('-')).unwrap_or(&"");
        Err(format!("git {verb}: {}", ran.said()))
    }
}

/// The top folder of the worktree `path` is in.
fn toplevel(path: &str) -> Result<PathBuf, String> {
    let dir = Path::new(path);
    if !dir.is_dir() {
        return Err(format!("{path} is not a folder"));
    }
    Ok(PathBuf::from(git(dir, &["rev-parse", "--show-toplevel"])?.trim()))
}

// ----------------------------------------------------------------- parsing --

/// `git status --porcelain=v2 --branch -z`: the branch headers and the changes. Ignored
/// entries are skipped.
pub fn parse_status(text: &str) -> (Option<String>, bool, Vec<Change>) {
    let mut branch = None;
    let mut unborn = false;
    let mut changes = Vec::new();
    let mut fields = text.split('\0');
    while let Some(entry) = fields.next() {
        if let Some(head) = entry.strip_prefix("# branch.head ") {
            branch = (head != "(detached)").then(|| head.to_string());
        } else if entry == "# branch.oid (initial)" {
            unborn = true;
        } else if let Some(rest) = entry.strip_prefix("1 ") {
            // XY sub mH mI mW hH hI path
            if let Some((xy, path)) = split_entry(rest, 7) {
                changes.push(change(xy, path, None, false));
            }
        } else if let Some(rest) = entry.strip_prefix("2 ") {
            // XY sub mH mI mW hH hI Xscore path, then the original path as the next field.
            if let Some((xy, path)) = split_entry(rest, 8) {
                let orig = fields.next().map(str::to_string);
                changes.push(change(xy, path, orig, false));
            }
        } else if let Some(rest) = entry.strip_prefix("u ") {
            // XY sub m1 m2 m3 mW h1 h2 h3 path
            if let Some((xy, path)) = split_entry(rest, 9) {
                changes.push(change(xy, path, None, true));
            }
        } else if let Some(path) = entry.strip_prefix("? ") {
            changes.push(Change { path: path.into(), orig_path: None, index: "?".into(), worktree: "?".into(), conflicted: false });
        }
    }
    (branch, unborn, changes)
}

/// The XY field and the path after `skip` space-separated fields (the path may hold spaces).
fn split_entry(rest: &str, skip: usize) -> Option<(&str, &str)> {
    let mut parts = rest.splitn(skip + 1, ' ');
    let xy = parts.next()?;
    let path = parts.nth(skip - 1)?;
    (xy.len() == 2 && !path.is_empty()).then_some((xy, path))
}

fn change(xy: &str, path: &str, orig: Option<String>, conflicted: bool) -> Change {
    let (x, y) = xy.split_at(1);
    Change { path: path.into(), orig_path: orig, index: x.into(), worktree: y.into(), conflicted }
}

/// `rev-list --left-right --count A...B`: (only in A, only in B).
fn parse_counts(text: &str) -> (u32, u32) {
    let mut it = text.split_whitespace().map(|n| n.parse().unwrap_or(0));
    (it.next().unwrap_or(0), it.next().unwrap_or(0))
}

/// A model's answer with the fences and preamble it was asked not to write taken off.
pub fn clean_answer(text: &str) -> String {
    let t = text.trim();
    let t = match t.strip_prefix("```") {
        Some(rest) => {
            // Drop the fence's language tag line and the closing fence.
            let body = rest.split_once('\n').map(|(_, b)| b).unwrap_or("");
            body.trim_end().strip_suffix("```").unwrap_or(body)
        }
        None => t,
    };
    t.trim().to_string()
}

/// The PR draft from `claude`'s answer: the first line is the title, the rest the body.
pub fn parse_pr_draft(text: &str) -> Option<PrDraft> {
    let text = clean_answer(text);
    let mut lines = text.lines().skip_while(|l| l.trim().is_empty());
    let first = lines.next()?.trim();
    let title = first.strip_prefix("Title:").or_else(|| first.strip_prefix("TITLE:")).unwrap_or(first);
    let title = title.trim().trim_start_matches('#').trim().trim_matches('"').trim().to_string();
    let rest: Vec<&str> = lines.collect();
    let body = rest.join("\n");
    let body = body.trim();
    let body = body.strip_prefix("Body:").or_else(|| body.strip_prefix("BODY:")).unwrap_or(body).trim().to_string();
    (!title.is_empty()).then_some(PrDraft { title, body })
}

/// The PR number at the end of `gh pr create`'s URL.
fn pr_number(url: &str) -> u64 {
    url.trim().trim_end_matches('/').rsplit('/').next().and_then(|n| n.parse().ok()).unwrap_or(0)
}

/// `s` cut to at most `max` bytes on a character boundary, saying so.
fn cut(s: &str, max: usize) -> String {
    if s.len() <= max {
        return s.to_string();
    }
    let mut end = max;
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}\n[… cut: {} more bytes]", &s[..end], s.len() - end)
}

pub fn commit_prompt(files: &str, recent: &str, patch: &str) -> String {
    let style = if recent.trim().is_empty() {
        String::new()
    } else {
        format!("\nRecent commit subjects in this repo, to match their style (a `type(scope):` prefix, say, if they use one):\n{}\n", recent.trim_end())
    };
    format!(
        "Write a git commit message for the change below. The first line summarises it in the imperative mood in at most 72 characters. If the change needs explaining, add a blank line and a short body wrapped at 72 columns saying what changed and why. Output only the commit message: no code fences, no quotes, no preamble.\n{style}\nFiles:\n{files}\nDiff:\n{patch}"
    )
}

pub fn pr_prompt(branch: &str, base: &str, commits: &str, patch: &str) -> String {
    format!(
        "Write the title and description of a GitHub pull request that merges the branch `{branch}` into `{base}`. Output the title on the first line, in plain words, at most 72 characters, with no prefix or quotes. Then a blank line, then the description in GitHub Markdown: what the change does and why, then how it was tested if the commits say. Keep it short. Output nothing else.\n\nCommits:\n{commits}\nDiff:\n{patch}"
    )
}

// ----------------------------------------------------------------- the steps --

fn remote_of(root: &Path, branch: Option<&str>) -> Option<String> {
    if let Some(b) = branch {
        if let Ok(r) = git(root, &["config", "--get", &format!("branch.{b}.remote")]) {
            let r = r.trim();
            if !r.is_empty() && r != "." {
                return Some(r.to_string());
            }
        }
    }
    let remotes = git(root, &["remote"]).ok()?;
    let names: Vec<&str> = remotes.lines().map(str::trim).filter(|r| !r.is_empty()).collect();
    names.iter().find(|r| **r == "origin").or(names.first()).map(|r| r.to_string())
}

fn ref_exists(root: &Path, name: &str) -> bool {
    git(root, &["rev-parse", "--verify", "--quiet", &format!("{name}^{{commit}}")]).is_ok()
}

fn base_of(root: &Path, remote: Option<&str>) -> String {
    if let Some(r) = remote {
        if let Ok(head) = git(root, &["symbolic-ref", "--quiet", "--short", &format!("refs/remotes/{r}/HEAD")]) {
            if let Some(b) = head.trim().strip_prefix(&format!("{r}/")) {
                return b.to_string();
            }
        }
    }
    for b in ["main", "master"] {
        let remote_has = remote.is_some_and(|r| ref_exists(root, &format!("refs/remotes/{r}/{b}")));
        if remote_has || ref_exists(root, &format!("refs/heads/{b}")) {
            return b.to_string();
        }
    }
    "main".into()
}

/// The ref a PR's base is compared against: the remote's copy when there is one.
fn base_ref(root: &Path, remote: Option<&str>, base: &str) -> Option<String> {
    let remote_ref = remote.map(|r| format!("refs/remotes/{r}/{base}"));
    remote_ref.filter(|r| ref_exists(root, r)).or_else(|| Some(format!("refs/heads/{base}")).filter(|r| ref_exists(root, r)))
}

pub fn status(worktree: &str) -> Result<Status, String> {
    let root = toplevel(worktree)?;
    let text = git(&root, &["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"])?;
    let (branch, unborn, changes) = parse_status(&text);
    let remote = remote_of(&root, branch.as_deref());
    let base = base_of(&root, remote.as_deref());
    let mut st = Status { root: root.to_string_lossy().into(), branch: branch.clone(), remote: remote.clone(), base: base.clone(), unborn, changes, ..Status::default() };
    if unborn {
        return Ok(st);
    }
    let pushed = match (&remote, &branch) {
        (Some(r), Some(b)) => Some(format!("refs/remotes/{r}/{b}")).filter(|r| ref_exists(&root, r)),
        _ => None,
    };
    st.published = pushed.is_some();
    let against = pushed.or_else(|| base_ref(&root, remote.as_deref(), &base));
    if let Some(against) = against {
        let counts = git(&root, &["rev-list", "--left-right", "--count", &format!("HEAD...{against}")]).unwrap_or_default();
        let (ahead, behind) = parse_counts(&counts);
        st.ahead = ahead;
        st.behind = if st.published { behind } else { 0 };
    }
    Ok(st)
}

/// Every path a commit of `paths` touches: renames bring their old path along.
fn with_origins(root: &Path, paths: &[String]) -> Result<Vec<String>, String> {
    let text = git(root, &["status", "--porcelain=v2", "-z", "--untracked-files=all"])?;
    let (_, _, changes) = parse_status(&text);
    let mut out: Vec<String> = paths.to_vec();
    for c in changes.iter().filter(|c| paths.contains(&c.path)) {
        if let Some(o) = &c.orig_path {
            if !out.contains(o) {
                out.push(o.clone());
            }
        }
    }
    Ok(out)
}

fn nul_list(paths: &[String]) -> Vec<u8> {
    let mut v = Vec::new();
    for p in paths {
        v.extend_from_slice(p.as_bytes());
        v.push(0);
    }
    v
}

/// What the commit prompt shows of `paths`: the file list, the patch against HEAD (tracked
/// files) and the start of each new file.
fn change_context(root: &Path, paths: &[String]) -> Result<(String, String), String> {
    let text = git(root, &["status", "--porcelain=v2", "-z", "--untracked-files=all"])?;
    let (_, unborn, changes) = parse_status(&text);
    let picked: Vec<&Change> = changes.iter().filter(|c| paths.contains(&c.path)).collect();
    if picked.is_empty() {
        return Err("None of the chosen files has changes any more.".into());
    }
    let files = picked
        .iter()
        .map(|c| match &c.orig_path {
            Some(o) => format!("{}{} {} (from {})", c.index, c.worktree, c.path, o),
            None => format!("{}{} {}", c.index, c.worktree, c.path),
        })
        .collect::<Vec<_>>()
        .join("\n");
    let tracked: Vec<String> = picked.iter().filter(|c| c.index != "?").flat_map(|c| std::iter::once(c.path.clone()).chain(c.orig_path.clone())).collect();
    let mut patch = String::new();
    if !tracked.is_empty() {
        let from = if unborn { EMPTY_TREE } else { "HEAD" };
        let mut args = vec!["--literal-pathspecs", "diff", "--no-color", "--no-ext-diff", "--minimal", from];
        if tracked.len() <= MAX_DIFF_PATHSPECS {
            args.push("--");
            args.extend(tracked.iter().map(String::as_str));
        }
        patch = git(root, &args)?;
    }
    for c in picked.iter().filter(|c| c.index == "?") {
        if patch.len() >= MAX_PATCH_BYTES {
            break;
        }
        let bytes = std::fs::read(root.join(&c.path)).unwrap_or_default();
        if bytes.contains(&0) {
            patch.push_str(&format!("\nnew binary file {}\n", c.path));
        } else {
            let text = String::from_utf8_lossy(&bytes);
            patch.push_str(&format!("\nnew file {}\n{}\n", c.path, cut(&text, MAX_NEW_FILE_BYTES)));
        }
    }
    Ok((files, cut(&patch, MAX_PATCH_BYTES)))
}

/// Asks `claude` (haiku, as `mission_translate` does) with `prompt` on stdin.
fn ask_claude(program: &str, prompt: &str) -> Result<String, String> {
    let cwd = std::env::temp_dir();
    let ran = exec(program, &["-p", "--model", "haiku", "--output-format", "text"], &cwd, Some(prompt.as_bytes()), CLAUDE_TIMEOUT)?;
    if !ran.ok {
        return Err(format!("claude: {}", ran.said()));
    }
    let answer = clean_answer(&ran.stdout);
    if answer.is_empty() {
        return Err("claude answered with nothing".into());
    }
    Ok(answer)
}

/// A commit message for `paths` of `worktree`, written by `program` (`claude`).
pub fn message_with(program: &str, worktree: &str, paths: &[String]) -> Result<String, String> {
    let root = toplevel(worktree)?;
    let (files, patch) = change_context(&root, paths)?;
    let recent = git(&root, &["log", "-n", "12", "--format=%s"]).unwrap_or_default();
    ask_claude(program, &commit_prompt(&files, &recent, &patch))
}

pub fn message(worktree: &str, paths: &[String]) -> Result<String, String> {
    message_with("claude", worktree, paths)
}

/// Commits exactly `paths`, as they are in the worktree, with `message`. Whatever else was
/// staged stays staged and out of the commit.
pub fn commit(worktree: &str, paths: &[String], message: &str) -> Result<Committed, String> {
    if message.trim().is_empty() {
        return Err("Write a commit message first.".into());
    }
    if paths.is_empty() {
        return Err("Choose at least one file to commit.".into());
    }
    let root = toplevel(worktree)?;
    // `add` brings new files into git's view; a rename's old path is already gone from the
    // index, so only `commit` gets it, to record it removed.
    git_in(&root, &["--literal-pathspecs", "add", "-A", "--pathspec-from-file=-", "--pathspec-file-nul"], Some(&nul_list(paths)))?;
    let all = with_origins(&root, paths)?;
    git_in(&root, &["--literal-pathspecs", "commit", "--cleanup=strip", "-m", message, "--pathspec-from-file=-", "--pathspec-file-nul"], Some(&nul_list(&all)))?;
    let sha = git(&root, &["rev-parse", "--short", "HEAD"])?.trim().to_string();
    let summary = git(&root, &["log", "-1", "--format=%s"])?.trim().to_string();
    Ok(Committed { sha, summary })
}

/// Pushes the branch to its remote, under the same name, and tracks it there.
pub fn push(worktree: &str) -> Result<String, String> {
    let st = status(worktree)?;
    let root = PathBuf::from(&st.root);
    let branch = st.branch.ok_or("HEAD is detached: check out a branch to push it.")?;
    let remote = st.remote.ok_or("This repo has no remote to push to.")?;
    let ran = exec("git", &["push", "-u", &remote, "HEAD"], &root, None, NET_TIMEOUT)?;
    if !ran.ok {
        return Err(format!("git push: {}", ran.said()));
    }
    Ok(format!("Pushed {branch} to {remote}"))
}

fn gh(root: &Path, args: &[&str], stdin: Option<&[u8]>) -> Result<String, String> {
    let ran = exec("gh", args, root, stdin, NET_TIMEOUT).map_err(|e| if e.contains("No such file") || e.contains("not found") { format!("{e} — install the GitHub CLI (gh) to open pull requests") } else { e })?;
    if ran.ok {
        Ok(ran.stdout)
    } else {
        Err(format!("gh {}: {}", args.iter().take(2).cloned().collect::<Vec<_>>().join(" "), ran.said()))
    }
}

/// The branch's pull request, when it has one.
pub fn find_pr(worktree: &str) -> Result<Option<PullRequest>, String> {
    let st = status(worktree)?;
    let Some(branch) = st.branch else { return Ok(None) };
    if st.remote.is_none() {
        return Ok(None);
    }
    let root = PathBuf::from(&st.root);
    match gh(&root, &["pr", "view", &branch, "--json", "number,url,state,title"], None) {
        Ok(json) => {
            let v: serde_json::Value = serde_json::from_str(&json).map_err(|e| format!("gh pr view: {e}"))?;
            Ok(Some(PullRequest {
                number: v["number"].as_u64().unwrap_or(0),
                url: v["url"].as_str().unwrap_or("").into(),
                state: v["state"].as_str().unwrap_or("").into(),
                title: v["title"].as_str().unwrap_or("").into(),
            }))
        }
        Err(e) if e.contains("no pull requests found") || e.contains("no open pull requests") => Ok(None),
        Err(e) => Err(e),
    }
}

/// A title and body for a PR of the branch into `base`, written by `program` (`claude`).
pub fn pr_draft_with(program: &str, worktree: &str, base: &str) -> Result<PrDraft, String> {
    let st = status(worktree)?;
    let root = PathBuf::from(&st.root);
    let branch = st.branch.ok_or("HEAD is detached: check out a branch to open a pull request.")?;
    let against = base_ref(&root, st.remote.as_deref(), base).ok_or_else(|| format!("There is no branch {base} to compare {branch} with."))?;
    let range = format!("{against}..HEAD");
    let commits = git(&root, &["log", "--no-color", "--format=- %s%n%w(0,2,2)%b", &range])?;
    if commits.trim().is_empty() {
        return Err(format!("{branch} has no commits that {base} does not have."));
    }
    let patch = git(&root, &["diff", "--no-color", "--no-ext-diff", "--minimal", &format!("{against}...HEAD")])?;
    let answer = ask_claude(program, &pr_prompt(&branch, base, &cut(&commits, 12_000), &cut(&patch, MAX_PATCH_BYTES)))?;
    parse_pr_draft(&answer).ok_or_else(|| format!("claude's answer had no title: {answer}"))
}

pub fn pr_draft(worktree: &str, base: &str) -> Result<PrDraft, String> {
    pr_draft_with("claude", worktree, base)
}

pub fn create_pr(worktree: &str, base: &str, title: &str, body: &str, draft: bool) -> Result<PullRequest, String> {
    if title.trim().is_empty() {
        return Err("Give the pull request a title.".into());
    }
    let st = status(worktree)?;
    let root = PathBuf::from(&st.root);
    let branch = st.branch.ok_or("HEAD is detached: check out a branch to open a pull request.")?;
    let mut args = vec!["pr", "create", "--base", base, "--head", &branch, "--title", title, "--body-file", "-"];
    if draft {
        args.push("--draft");
    }
    let out = gh(&root, &args, Some(body.as_bytes()))?;
    let url = out.lines().map(str::trim).rfind(|l| l.starts_with("http")).ok_or_else(|| format!("gh pr create answered without a link: {}", out.trim()))?.to_string();
    Ok(PullRequest { number: pr_number(&url), url, state: "OPEN".into(), title: title.trim().into() })
}

// ----------------------------------------------------------------- commands --

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn commit_status(worktree: String) -> Result<Status, String> {
    blocking(move || status(&worktree)).await
}

#[tauri::command]
pub async fn commit_message(worktree: String, paths: Vec<String>) -> Result<String, String> {
    blocking(move || message(&worktree, &paths)).await
}

#[tauri::command]
pub async fn commit_create(worktree: String, paths: Vec<String>, message: String) -> Result<Committed, String> {
    blocking(move || commit(&worktree, &paths, &message)).await
}

#[tauri::command]
pub async fn commit_push(worktree: String) -> Result<String, String> {
    blocking(move || push(&worktree)).await
}

#[tauri::command]
pub async fn commit_pr_find(worktree: String) -> Result<Option<PullRequest>, String> {
    blocking(move || find_pr(&worktree)).await
}

#[tauri::command]
pub async fn commit_pr_draft(worktree: String, base: String) -> Result<PrDraft, String> {
    blocking(move || pr_draft(&worktree, &base)).await
}

#[tauri::command]
pub async fn commit_pr_create(worktree: String, base: String, title: String, body: String, draft: bool) -> Result<PullRequest, String> {
    blocking(move || create_pr(&worktree, &base, &title, &body, draft)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_parses_every_kind_of_entry() {
        let text = [
            "# branch.oid 1234",
            "# branch.head feat/x",
            "# branch.upstream origin/feat/x",
            "# branch.ab +2 -1",
            "1 .M N... 100644 100644 100644 aaa bbb src/a file.ts",
            "1 A. N... 000000 100644 100644 000 ccc new.ts",
            "2 R. N... 100644 100644 100644 ddd ddd R100 moved.ts",
            "old.ts",
            "u UU N... 100644 100644 100644 100644 e f g both.ts",
            "? notes/todo.md",
            "! ignored.log",
            "",
        ]
        .join("\0");
        let (branch, unborn, changes) = parse_status(&text);
        assert_eq!(branch.as_deref(), Some("feat/x"));
        assert!(!unborn);
        let row = |p: &str, o: Option<&str>, x: &str, y: &str, c: bool| Change { path: p.into(), orig_path: o.map(Into::into), index: x.into(), worktree: y.into(), conflicted: c };
        assert_eq!(
            changes,
            vec![
                row("src/a file.ts", None, ".", "M", false),
                row("new.ts", None, "A", ".", false),
                row("moved.ts", Some("old.ts"), "R", ".", false),
                row("both.ts", None, "U", "U", true),
                row("notes/todo.md", None, "?", "?", false),
            ]
        );
    }

    #[test]
    fn status_knows_a_detached_head_and_an_unborn_branch() {
        assert_eq!(parse_status("# branch.oid abc\0# branch.head (detached)\0").0, None);
        let (b, unborn, _) = parse_status("# branch.oid (initial)\0# branch.head main\0");
        assert_eq!(b.as_deref(), Some("main"));
        assert!(unborn);
    }

    #[test]
    fn an_answer_loses_its_fences() {
        assert_eq!(clean_answer("```text\nfix: it\n\nbody\n```\n"), "fix: it\n\nbody");
        assert_eq!(clean_answer("  fix: it  \n"), "fix: it");
    }

    #[test]
    fn a_pr_draft_is_its_first_line_and_the_rest() {
        let d = parse_pr_draft("Title: Commit from the diff\n\nBody:\n## What\nIt commits.\n").unwrap();
        assert_eq!(d, PrDraft { title: "Commit from the diff".into(), body: "## What\nIt commits.".into() });
        let d = parse_pr_draft("\n# \"Push it\"\n\nIt pushes.").unwrap();
        assert_eq!(d.title, "Push it");
        assert_eq!(d.body, "It pushes.");
        assert_eq!(parse_pr_draft("  \n "), None);
    }

    #[test]
    fn a_long_text_is_cut_on_a_character_boundary() {
        let s = "é".repeat(10);
        let c = cut(&s, 5);
        assert!(c.starts_with("éé"));
        assert!(c.contains("cut: 16 more bytes"), "{c}");
        assert_eq!(cut("short", 10), "short");
    }

    #[test]
    fn the_pr_number_is_the_last_part_of_its_url() {
        assert_eq!(pr_number("https://github.com/o/r/pull/213\n"), 213);
        assert_eq!(pr_number("https://github.com/o/r/pull/7/"), 7);
    }

    #[test]
    fn the_commit_prompt_carries_the_style_the_files_and_the_diff() {
        let p = commit_prompt("M a.ts", "feat(x): one\nfix: two\n", "@@ diff");
        assert!(p.contains("feat(x): one\nfix: two\n"), "{p}");
        assert!(p.contains("Files:\nM a.ts\n"), "{p}");
        assert!(p.ends_with("Diff:\n@@ diff"), "{p}");
        assert!(!commit_prompt("M a.ts", "", "d").contains("Recent commit"));
    }

    // ----------------------------------------------------------- against git --

    #[cfg(unix)]
    mod repo {
        use super::super::*;
        use crate::testutil::{temp_dir, write_script};

        fn sh(dir: &Path, args: &[&str]) -> String {
            git(dir, args).unwrap_or_else(|e| panic!("{e}"))
        }

        /// A repo with one commit on `main` and a bare `origin` it was pushed to.
        fn repo(tag: &str) -> (PathBuf, PathBuf) {
            let base = temp_dir(&format!("commit-{tag}"));
            let origin = base.join("origin.git");
            let work = base.join("work");
            std::fs::create_dir_all(&work).unwrap();
            sh(&base, &["init", "--bare", "-b", "main", origin.to_str().unwrap()]);
            sh(&work, &["init", "-b", "main"]);
            sh(&work, &["config", "user.email", "t@t"]);
            sh(&work, &["config", "user.name", "t"]);
            sh(&work, &["config", "commit.gpgsign", "false"]);
            std::fs::write(work.join("keep.txt"), "one\n").unwrap();
            std::fs::write(work.join("old.txt"), "moving\n").unwrap();
            std::fs::write(work.join("gone.txt"), "bye\n").unwrap();
            sh(&work, &["add", "."]);
            sh(&work, &["commit", "-m", "feat: start"]);
            sh(&work, &["remote", "add", "origin", origin.to_str().unwrap()]);
            sh(&work, &["push", "-u", "origin", "main"]);
            sh(&work, &["remote", "set-head", "origin", "main"]);
            (base, work)
        }

        fn fake_claude(dir: &Path, answer: &str) -> PathBuf {
            std::fs::write(dir.join("answer"), answer).unwrap();
            let fake = dir.join("claude");
            let script = format!("#!/bin/sh\necho \"$@\" > '{d}/args'\ncat > '{d}/prompt'\ncat '{d}/answer'\n", d = dir.display());
            write_script(&fake, &script);
            fake
        }

        #[test]
        fn a_commit_takes_only_the_chosen_files_renames_and_deletions_included() {
            let (base, work) = repo("pick");
            let w = work.to_str().unwrap();
            std::fs::write(work.join("keep.txt"), "one\ntwo\n").unwrap();
            sh(&work, &["mv", "old.txt", "new name.txt"]);
            std::fs::remove_file(work.join("gone.txt")).unwrap();
            std::fs::write(work.join("fresh*.txt"), "new\n").unwrap();
            std::fs::write(work.join("later.txt"), "not now\n").unwrap();
            sh(&work, &["add", "later.txt"]);

            let st = status(w).unwrap();
            assert_eq!(st.branch.as_deref(), Some("main"));
            assert_eq!(st.remote.as_deref(), Some("origin"));
            assert_eq!(st.base, "main");
            assert!(st.published);
            let paths: Vec<&str> = st.changes.iter().map(|c| c.path.as_str()).collect();
            for p in ["keep.txt", "new name.txt", "gone.txt", "fresh*.txt", "later.txt"] {
                assert!(paths.contains(&p), "{p} missing from {paths:?}");
            }

            let chosen: Vec<String> = ["keep.txt", "new name.txt", "gone.txt", "fresh*.txt"].map(String::from).to_vec();
            let done = commit(w, &chosen, "feat: pick\n\nwhy\n").unwrap();
            assert_eq!(done.summary, "feat: pick");
            let files = sh(&work, &["show", "--name-status", "--format=", "HEAD"]);
            assert!(files.contains("M\tkeep.txt"), "{files}");
            assert!(files.contains("R100\told.txt\tnew name.txt"), "{files}");
            assert!(files.contains("D\tgone.txt"), "{files}");
            assert!(files.contains("A\tfresh*.txt"), "{files}");
            assert!(!files.contains("later.txt"), "{files}");
            // The file left out is still staged, as it was.
            assert_eq!(sh(&work, &["diff", "--cached", "--name-only"]).trim(), "later.txt");

            let st = status(w).unwrap();
            assert_eq!((st.ahead, st.behind), (1, 0));
            let _ = std::fs::remove_dir_all(base);
        }

        #[test]
        fn a_refused_commit_says_what_the_hook_said() {
            let (base, work) = repo("hook");
            let hook = work.join(".git/hooks/pre-commit");
            write_script(&hook, "#!/bin/sh\necho 'lint: 3 problems' \nexit 1\n");
            std::fs::write(work.join("keep.txt"), "changed\n").unwrap();
            let err = commit(work.to_str().unwrap(), &["keep.txt".into()], "fix: it").unwrap_err();
            assert!(err.contains("lint: 3 problems"), "{err}");
            let err = commit(work.to_str().unwrap(), &["keep.txt".into()], "  ").unwrap_err();
            assert!(err.contains("message"), "{err}");
            let _ = std::fs::remove_dir_all(base);
        }

        #[test]
        fn a_new_branch_pushes_under_its_own_name_and_is_then_published() {
            let (base, work) = repo("push");
            let w = work.to_str().unwrap();
            // Started from origin/main, so git tracks origin/main: the push must still go to feat.
            sh(&work, &["checkout", "-b", "feat", "--track", "origin/main"]);
            std::fs::write(work.join("keep.txt"), "feat\n").unwrap();
            commit(w, &["keep.txt".into()], "feat: one").unwrap();
            let st = status(w).unwrap();
            assert!(!st.published);
            assert_eq!(st.ahead, 1);
            assert_eq!(push(w).unwrap(), "Pushed feat to origin");
            let st = status(w).unwrap();
            assert!(st.published);
            assert_eq!((st.ahead, st.behind), (0, 0));
            let origin = base.join("origin.git");
            assert!(sh(&origin, &["branch", "--list", "feat"]).contains("feat"));
            let _ = std::fs::remove_dir_all(base);
        }

        #[test]
        fn a_refused_push_says_why() {
            let (base, work) = repo("reject");
            let w = work.to_str().unwrap();
            let origin = base.join("origin.git");
            // Someone else pushed to main meanwhile.
            let other = base.join("other");
            sh(&base, &["clone", origin.to_str().unwrap(), other.to_str().unwrap()]);
            sh(&other, &["-c", "user.email=o@o", "-c", "user.name=o", "commit", "--allow-empty", "-m", "theirs"]);
            sh(&other, &["push"]);
            std::fs::write(work.join("keep.txt"), "mine\n").unwrap();
            commit(w, &["keep.txt".into()], "mine").unwrap();
            let err = push(w).unwrap_err();
            assert!(err.starts_with("git push:"), "{err}");
            assert!(err.contains("rejected") || err.contains("fetch first"), "{err}");
            let _ = std::fs::remove_dir_all(base);
        }

        #[test]
        fn the_message_comes_from_claude_given_the_diff_and_the_new_files() {
            let (base, work) = repo("msg");
            std::fs::write(work.join("keep.txt"), "one\nadded line\n").unwrap();
            std::fs::write(work.join("brand-new.md"), "# hello\n").unwrap();
            std::fs::write(work.join("skip.txt"), "unchosen\n").unwrap();
            let fake = fake_claude(&base, "```\nfeat: add a line\n```\n");
            let msg = message_with(fake.to_str().unwrap(), work.to_str().unwrap(), &["keep.txt".into(), "brand-new.md".into()]).unwrap();
            assert_eq!(msg, "feat: add a line");
            let prompt = std::fs::read_to_string(base.join("prompt")).unwrap();
            assert!(prompt.contains("+added line"), "{prompt}");
            assert!(prompt.contains("new file brand-new.md\n# hello"), "{prompt}");
            assert!(prompt.contains("feat: start"), "recent subjects for style: {prompt}");
            assert!(!prompt.contains("skip.txt"), "{prompt}");
            let args = std::fs::read_to_string(base.join("args")).unwrap();
            assert!(args.contains("-p --model haiku"), "{args}");
            let _ = std::fs::remove_dir_all(base);
        }

        #[test]
        fn a_failing_claude_is_an_error_not_an_empty_message() {
            let (base, work) = repo("msgfail");
            std::fs::write(work.join("keep.txt"), "x\n").unwrap();
            let fake = base.join("claude");
            write_script(&fake, "#!/bin/sh\necho 'Invalid API key' >&2\nexit 1\n");
            let err = message_with(fake.to_str().unwrap(), work.to_str().unwrap(), &["keep.txt".into()]).unwrap_err();
            assert!(err.contains("Invalid API key"), "{err}");
            let empty = fake_claude(&base, "  \n");
            let err = message_with(empty.to_str().unwrap(), work.to_str().unwrap(), &["keep.txt".into()]).unwrap_err();
            assert!(err.contains("nothing"), "{err}");
            let err = message_with(empty.to_str().unwrap(), work.to_str().unwrap(), &["nope.txt".into()]).unwrap_err();
            assert!(err.contains("None of the chosen files"), "{err}");
            let _ = std::fs::remove_dir_all(base);
        }

        #[test]
        fn the_pr_draft_is_written_from_the_branch_commits() {
            let (base, work) = repo("pr");
            let w = work.to_str().unwrap();
            sh(&work, &["checkout", "-b", "feat"]);
            let fake = fake_claude(&base, "Add the thing\n\nIt adds the thing.\n");
            let err = pr_draft_with(fake.to_str().unwrap(), w, "main").unwrap_err();
            assert!(err.contains("no commits"), "{err}");
            std::fs::write(work.join("keep.txt"), "thing\n").unwrap();
            commit(w, &["keep.txt".into()], "feat: the thing\n\nbecause").unwrap();
            let d = pr_draft_with(fake.to_str().unwrap(), w, "main").unwrap();
            assert_eq!(d, PrDraft { title: "Add the thing".into(), body: "It adds the thing.".into() });
            let prompt = std::fs::read_to_string(base.join("prompt")).unwrap();
            assert!(prompt.contains("`feat` into `main`"), "{prompt}");
            assert!(prompt.contains("- feat: the thing\n  because"), "{prompt}");
            assert!(prompt.contains("+thing"), "{prompt}");
            let err = pr_draft_with(fake.to_str().unwrap(), w, "nowhere").unwrap_err();
            assert!(err.contains("no branch nowhere"), "{err}");
            let _ = std::fs::remove_dir_all(base);
        }

        #[test]
        fn a_folder_that_is_not_a_repo_says_so() {
            let dir = temp_dir("commit-norepo");
            let err = status(dir.to_str().unwrap()).unwrap_err();
            assert!(err.starts_with("git rev-parse"), "{err}");
            assert!(status("/no/such/folder").unwrap_err().contains("not a folder"));
            let _ = std::fs::remove_dir_all(dir);
        }

        #[test]
        fn a_program_that_hangs_is_stopped() {
            let dir = temp_dir("commit-hang");
            let slow = dir.join("slow");
            write_script(&slow, "#!/bin/sh\nsleep 5\n");
            let t = Instant::now();
            let err = exec(slow.to_str().unwrap(), &["x"], &dir, None, Duration::from_millis(200)).err().unwrap();
            assert!(err.contains("was stopped"), "{err}");
            assert!(t.elapsed() < Duration::from_secs(3));
            let _ = std::fs::remove_dir_all(dir);
        }
    }
}

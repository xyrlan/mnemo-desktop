//! A repo's worktrees: listed, created for a new workspace, removed.
//!
//! A new tree is the sibling `<repo>-wt-<name>` of the main checkout, the convention `mnemo
//! dispatch` uses, so one folder holds both kinds; a tree is *dispatched* when it holds
//! `.mnemo-child-profile/dispatch.json`. The branch of a new tree is `name`: an existing branch
//! is checked out as it is, a new one starts at `base` (or the main checkout's HEAD).
//!
//! Once the tree exists, the gitignored files the repo's `.worktreeinclude` names (gitignore
//! syntax: `.env`, `config/*.local`) are copied in from the main checkout, and the repo's setup
//! command, when given, starts in the tree as a headless job (`job-line` / `job-exit`, id
//! `worktree-setup:<path>`). Creation returns once the tree exists, not when setup ends.
//!
//! Nothing here reaches outside the repo's parent directory: a name is one plain path segment,
//! and a path to remove must be a listed, non-main worktree under that parent.
//!
//! For cleaning up, `cleanup_facts` says of each tree but the main checkout whether its work is
//! already in the repo's default branch (`merged`): with no changes either, removing it loses
//! nothing, since the branch is kept. A repo that squash- or rebase-merges never makes a branch
//! an ancestor of the default branch, so `merged` also takes a branch whose changes are all
//! there, and one whose pull request was merged or closed at the commit the tree is on. Only
//! facts: nothing here removes anything.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::job::{self, JobEvent};
use crate::mission::{git_root, run};

/// `WorktreeInfo` in `src/worktrees/client.ts`.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeInfo {
    pub path: String,
    /// `None` on a detached HEAD.
    pub branch: Option<String>,
    /// The commit checked out, in full.
    pub head: String,
    pub is_main: bool,
    pub dispatched: bool,
    /// Anything `git status` reports, untracked files included: what `git worktree remove`
    /// refuses to throw away without `force`.
    pub dirty: bool,
    /// The job id of the setup command while it runs in this tree.
    pub setup_job: Option<String>,
}

pub const DISPATCH_MARK: &str = ".mnemo-child-profile/dispatch.json";
pub const INCLUDE_FILE: &str = ".worktreeinclude";

pub fn setup_job_id(path: &str) -> String {
    format!("worktree-setup:{path}")
}

/// Tree path → its running setup job's id.
fn setups() -> std::sync::MutexGuard<'static, HashMap<String, String>> {
    static SETUPS: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    SETUPS.get_or_init(Default::default).lock().unwrap_or_else(|e| e.into_inner())
}

fn git(args: &[&str], cwd: &Path) -> Result<String, String> {
    run("git", args, Some(cwd))
}

/// One entry of `git worktree list --porcelain`, before the per-tree probes.
#[derive(Debug, PartialEq)]
struct Entry {
    path: String,
    head: String,
    branch: Option<String>,
}

/// The entries of `git worktree list --porcelain`, main checkout first. A bare repo's own entry
/// and trees whose folder is gone (`prunable`) are left out: neither is a place to work.
fn parse_porcelain(text: &str) -> Vec<Entry> {
    let mut out = Vec::new();
    for block in text.replace("\r\n", "\n").split("\n\n") {
        let (mut path, mut head, mut branch, mut skip) = (None, String::new(), None, false);
        for line in block.lines() {
            if let Some(p) = line.strip_prefix("worktree ") {
                path = Some(p.to_string());
            } else if let Some(h) = line.strip_prefix("HEAD ") {
                head = h.to_string();
            } else if let Some(b) = line.strip_prefix("branch ") {
                branch = Some(b.strip_prefix("refs/heads/").unwrap_or(b).to_string());
            } else if line == "bare" || line == "prunable" || line.starts_with("prunable ") {
                skip = true;
            }
        }
        if let (Some(path), false) = (path, skip) {
            out.push(Entry { path, head, branch });
        }
    }
    out
}

fn info(e: Entry, is_main: bool) -> WorktreeInfo {
    let p = Path::new(&e.path);
    let dirty = git(&["status", "--porcelain"], p).map(|s| !s.trim().is_empty()).unwrap_or(false);
    WorktreeInfo {
        dispatched: p.join(DISPATCH_MARK).is_file(),
        setup_job: setups().get(&e.path).cloned(),
        path: e.path,
        branch: e.branch,
        head: e.head,
        is_main,
        dirty,
    }
}

/// Every worktree of the repo `repo` is in (any of its trees, or a folder inside one), the main
/// checkout first.
pub fn list(repo: &str) -> Result<Vec<WorktreeInfo>, String> {
    let text = git(&["worktree", "list", "--porcelain"], Path::new(repo))?;
    Ok(parse_porcelain(&text).into_iter().enumerate().map(|(i, e)| info(e, i == 0)).collect())
}

/// A name is one plain path segment and a valid branch: letters, digits, `.`, `_`, `-`, not
/// starting with `.` or `-`, no `..`, and not ending in `.lock` (git refuses such a branch).
pub fn check_name(name: &str) -> Result<(), String> {
    let plain = name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'));
    if name.is_empty() || name.len() > 100 || !plain || name.starts_with(['.', '-']) || name.contains("..") || name.ends_with(".lock") || name.ends_with('.') {
        return Err(format!("invalid worktree name {name:?}: use letters, digits, '.', '_' and '-'"));
    }
    Ok(())
}

/// The main checkout of the repo `repo` is in.
fn main_root(repo: &str) -> Result<PathBuf, String> {
    if !Path::new(repo).is_dir() {
        return Err(format!("{repo} is not a folder"));
    }
    git_root(repo).map(PathBuf::from).map_err(|_| format!("{repo} is not in a git repository"))
}

/// `<root>` → `<root>-wt-<name>`, beside it.
fn sibling(root: &Path, name: &str) -> Result<PathBuf, String> {
    let base = root.file_name().ok_or_else(|| format!("{} has no folder name", root.display()))?;
    let parent = root.parent().ok_or_else(|| format!("{} has no parent folder", root.display()))?;
    Ok(parent.join(format!("{}-wt-{name}", base.to_string_lossy())))
}

/// The gitignored files of `root` that its `.worktreeinclude` names, relative to `root`. git
/// does the matching: once with the include file as the only exclude list, once with the
/// repo's own ignore rules, and a file is copied when both name it.
fn included(root: &Path) -> Result<Vec<String>, String> {
    let file = root.join(INCLUDE_FILE);
    if !file.is_file() {
        return Ok(vec![]);
    }
    let from = format!("--exclude-from={}", file.display());
    let named = git(&["ls-files", "-z", "--others", "--ignored", &from], root)?;
    let ignored = git(&["ls-files", "-z", "--others", "--ignored", "--exclude-standard"], root)?;
    let ignored: std::collections::HashSet<&str> = ignored.split('\0').collect();
    Ok(named.split('\0').filter(|p| !p.is_empty() && ignored.contains(p)).map(String::from).collect())
}

fn copy_included(root: &Path, tree: &Path) -> Result<(), String> {
    for rel in included(root)? {
        let (from, to) = (root.join(&rel), tree.join(&rel));
        if to.symlink_metadata().is_ok() {
            continue;
        }
        if let Some(dir) = to.parent() {
            std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
        }
        let meta = from.symlink_metadata().map_err(|e| format!("{rel}: {e}"))?;
        #[cfg(unix)]
        if meta.file_type().is_symlink() {
            let target = std::fs::read_link(&from).map_err(|e| format!("{rel}: {e}"))?;
            std::os::unix::fs::symlink(target, &to).map_err(|e| format!("{rel}: {e}"))?;
            continue;
        }
        let _ = meta;
        std::fs::copy(&from, &to).map_err(|e| format!("copying {rel}: {e}"))?;
    }
    Ok(())
}

/// The setup command's argv: the user's own line, handed to a shell as a whole.
fn setup_argv(setup: &str) -> Vec<String> {
    if cfg!(windows) {
        vec!["cmd".into(), "/C".into(), setup.into()]
    } else {
        vec!["sh".into(), "-c".into(), setup.into()]
    }
}

/// Starts `setup` in `tree`; the tree reports the job as its `setupJob` until it exits.
fn start_setup(tree: &str, setup: &str, sink: Arc<dyn Fn(JobEvent) + Send + Sync>) -> Result<String, String> {
    let id = setup_job_id(tree);
    setups().insert(tree.to_string(), id.clone());
    let key = tree.to_string();
    let forward: Arc<dyn Fn(JobEvent) + Send + Sync> = Arc::new(move |e| {
        if matches!(e, JobEvent::Exit(_)) {
            setups().remove(&key);
        }
        sink(e);
    });
    if let Err(e) = job::run(&id, tree, &setup_argv(setup), forward) {
        setups().remove(tree);
        return Err(e);
    }
    Ok(id)
}

/// Creates `<root>-wt-<name>` on branch `name` and returns it once it exists; see the module
/// doc for the included files and the setup job, whose events go to `sink`.
pub fn create(repo: &str, name: &str, base: Option<&str>, setup: Option<&str>, sink: Arc<dyn Fn(JobEvent) + Send + Sync>) -> Result<WorktreeInfo, String> {
    check_name(name)?;
    let root = main_root(repo)?;
    let tree = sibling(&root, name)?;
    if tree.symlink_metadata().is_ok() {
        return Err(format!("{} already exists", tree.display()));
    }
    let base = base.map(str::trim).filter(|b| !b.is_empty());
    if let Some(b) = base {
        if b.starts_with('-') {
            return Err(format!("invalid base {b:?}"));
        }
    }
    let tree_s = tree.to_string_lossy().to_string();
    let exists = git(&["rev-parse", "--verify", "--quiet", &format!("refs/heads/{name}")], &root).is_ok();
    match (exists, base) {
        (true, Some(_)) => return Err(format!("branch {name} already exists; open it without a base")),
        (true, None) => git(&["worktree", "add", "--", &tree_s, name], &root)?,
        (false, b) => {
            let mut args = vec!["worktree", "add", "-b", name, "--", &tree_s];
            args.extend(b);
            git(&args, &root)?
        }
    };
    if let Err(e) = copy_included(&root, &tree) {
        // All or nothing: a tree without its `.env` looks ready and is not.
        let _ = git(&["worktree", "remove", "--force", "--", &tree_s], &root);
        if !exists {
            let _ = git(&["branch", "-D", "--", name], &root);
        }
        return Err(format!("{INCLUDE_FILE}: {e}"));
    }
    // The path as git prints it (symlinks resolved), so it matches what `list` returns.
    let listed = list(&tree_s)?;
    let canon = tree.canonicalize().unwrap_or(tree.clone());
    let mut made = listed
        .into_iter()
        .find(|w| Path::new(&w.path).canonicalize().map(|p| p == canon).unwrap_or(false))
        .ok_or_else(|| format!("{tree_s} was created but git does not list it"))?;
    if let Some(cmd) = setup.map(str::trim).filter(|s| !s.is_empty()) {
        made.setup_job = Some(start_setup(&made.path, cmd, sink)?);
    }
    Ok(made)
}

/// Removes the worktree at `path`. Refused for the main checkout, for a folder that is not one
/// of its repo's worktrees or lies outside the repo's parent folder, and while its setup runs.
/// Without `force`, git refuses a tree with changes; the branch is kept either way.
pub fn remove(path: &str, force: bool) -> Result<(), String> {
    let root = main_root(path)?;
    let canon = |p: &Path| p.canonicalize().map_err(|e| format!("{}: {e}", p.display()));
    let target = canon(Path::new(path))?;
    let parent = root.parent().ok_or("the repo has no parent folder")?;
    if !target.starts_with(canon(parent)?) {
        return Err(format!("{path} is outside {}", parent.display()));
    }
    let trees = list(path)?;
    let tree = trees
        .iter()
        .find(|w| Path::new(&w.path).canonicalize().map(|p| p == target).unwrap_or(false))
        .ok_or_else(|| format!("{path} is not a worktree of {}", root.display()))?;
    if tree.is_main {
        return Err("the main checkout is not removed".into());
    }
    if tree.setup_job.is_some() {
        return Err(format!("setup is still running in {path}"));
    }
    let mut args = vec!["worktree", "remove"];
    if force {
        args.push("--force");
    }
    args.extend(["--", tree.path.as_str()]);
    git(&args, &root).map(|_| ())
}

/// One tree as `cleanup_facts` reports it: `CleanupTree` in `src/worktrees/client.ts`.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CleanupTree {
    #[serde(flatten)]
    pub info: WorktreeInfo,
    /// Its work is in the default branch (local or the remote's): its HEAD is there, or the
    /// changes it makes are (a squash or rebase merge), or its branch's pull request was merged
    /// or closed with the tree's HEAD in it. True too for a tree that never made a commit.
    pub merged: bool,
}

/// `CleanupFacts` in `src/worktrees/client.ts`.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CleanupFacts {
    /// The branch `merged` is measured against, as git spells it (`origin/main`); `None` when
    /// there is none to measure against, and then nothing is `merged`.
    pub base: Option<String>,
    /// Every tree but the main checkout, in `list`'s order.
    pub trees: Vec<CleanupTree>,
}

/// The refs a tree's HEAD is looked for in: the remote's default branch (`origin/HEAD`) and the
/// local branch of the same name, else the main checkout's branch; only those that resolve.
fn bases(root: &Path, main_branch: Option<&str>) -> Vec<String> {
    let remote = git(&["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], root).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    let local = remote.as_deref().and_then(|r| r.split_once('/')).map(|(_, b)| b.to_string()).or(main_branch.map(String::from));
    let resolves = |r: &str| git(&["rev-parse", "--verify", "--quiet", &format!("{r}^{{commit}}")], root).is_ok();
    remote.into_iter().chain(local).filter(|r| !r.starts_with('-') && resolves(r)).collect()
}

/// Whether the changes `head` makes since it left `base` are all in `base`, however they got
/// there. Two ways to tell, as a squash-merge detector would: merging `head` into `base` changes
/// nothing, or `head`'s changes squashed into one commit match one of `base`'s by patch id (`git
/// cherry`), which still holds after `base` went on to change the same lines. Either writes a
/// throwaway object into the repo and nothing else.
fn changes_in(root: &Path, head: &str, base: &str) -> bool {
    let Ok(fork) = git(&["merge-base", head, base], root) else { return false };
    let fork = fork.trim();
    // `--write-tree` is git 2.38; an older git refuses it and the patch-id test stands alone.
    let merged_tree = git(&["merge-tree", "--write-tree", "--no-messages", base, head], root);
    let base_tree = git(&["rev-parse", &format!("{base}^{{tree}}")], root);
    if let (Ok(m), Ok(b)) = (&merged_tree, &base_tree) {
        if m.lines().next().map(str::trim) == Some(b.trim()) {
            return true;
        }
    }
    let ident = ["-c", "user.name=mnemo", "-c", "user.email=mnemo@localhost", "-c", "commit.gpgsign=false"];
    let tree = format!("{head}^{{tree}}");
    let squash = git(&[&ident[..], &["commit-tree", &tree, "-p", fork, "-m", "squash"]].concat(), root);
    let Ok(squash) = squash else { return false };
    let Ok(cherry) = git(&["cherry", base, squash.trim()], root) else { return false };
    let mut lines = cherry.lines().filter(|l| !l.trim().is_empty()).peekable();
    lines.peek().is_some() && lines.all(|l| l.starts_with('-'))
}

/// One pull request of `gh pr list`, as far as cleaning up cares.
#[derive(serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct Pr {
    head_ref_name: String,
    head_ref_oid: String,
    state: String,
}

/// Runs `gh` in a directory: stdout, or why not.
type GhRun<'a> = &'a dyn Fn(&[&str], &Path) -> Result<String, String>;

fn run_gh(args: &[&str], cwd: &Path) -> Result<String, String> {
    run("gh", args, Some(cwd))
}

/// Branch → the head commits of its pull requests that were merged or closed, for branches with
/// no open one. Empty when `gh` is missing, signed out or the repo is not on GitHub: then only
/// git's own signals count.
fn ended_prs(root: &Path, gh: GhRun) -> HashMap<String, Vec<String>> {
    let fields = "headRefName,headRefOid,state";
    let text = gh(&["pr", "list", "--state", "all", "--limit", "1000", "--json", fields], root).unwrap_or_default();
    let prs: Vec<Pr> = serde_json::from_str(&text).unwrap_or_default();
    let open: std::collections::HashSet<&str> = prs.iter().filter(|p| p.state == "OPEN").map(|p| p.head_ref_name.as_str()).collect();
    let mut out: HashMap<String, Vec<String>> = HashMap::new();
    for p in &prs {
        if matches!(p.state.as_str(), "MERGED" | "CLOSED") && !open.contains(p.head_ref_name.as_str()) && !p.head_ref_oid.starts_with('-') {
            out.entry(p.head_ref_name.clone()).or_default().push(p.head_ref_oid.clone());
        }
    }
    out
}

/// What cleaning up needs to know of the repo `repo` is in; see the module doc.
pub fn cleanup_facts(repo: &str) -> Result<CleanupFacts, String> {
    cleanup_facts_with(repo, &run_gh)
}

fn cleanup_facts_with(repo: &str, gh: GhRun) -> Result<CleanupFacts, String> {
    let root = main_root(repo)?;
    let mut trees = list(repo)?;
    let main_branch = trees.first().filter(|w| w.is_main).and_then(|w| w.branch.clone());
    let bases = bases(&root, main_branch.as_deref());
    trees.retain(|w| !w.is_main);
    let prs = if bases.is_empty() || trees.is_empty() { HashMap::new() } else { ended_prs(&root, gh) };
    let ancestor = |a: &str, b: &str| git(&["merge-base", "--is-ancestor", a, b], &root).is_ok();
    let merged = |w: &WorktreeInfo| {
        let head = w.head.as_str();
        if head.is_empty() || head.starts_with('-') || bases.is_empty() {
            return false;
        }
        // A pull request that ended with this very work in it; later commits are new work.
        let pr_ended = || w.branch.as_ref().and_then(|b| prs.get(b)).is_some_and(|oids| oids.iter().any(|o| ancestor(head, o)));
        bases.iter().any(|b| ancestor(head, b)) || pr_ended() || bases.iter().any(|b| changes_in(&root, head, b))
    };
    Ok(CleanupFacts {
        base: bases.first().cloned(),
        trees: trees.into_iter().map(|info| CleanupTree { merged: merged(&info), info }).collect(),
    })
}

fn emitter(app: AppHandle) -> Arc<dyn Fn(JobEvent) + Send + Sync> {
    Arc::new(move |e| {
        let _ = match e {
            JobEvent::Line(l) => app.emit(job::LINE_EVENT, l),
            JobEvent::Exit(x) => app.emit(job::EXIT_EVENT, x),
        };
    })
}

/// `listWorktrees` in `src/worktrees/client.ts`.
#[tauri::command]
pub async fn worktree_list(repo: String) -> Result<Vec<WorktreeInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || list(&repo)).await.map_err(|e| e.to_string())?
}

/// `createWorktree` in `src/worktrees/client.ts`.
#[tauri::command]
pub async fn worktree_create(app: AppHandle, repo: String, name: String, base: Option<String>, setup: Option<String>) -> Result<WorktreeInfo, String> {
    tauri::async_runtime::spawn_blocking(move || create(&repo, &name, base.as_deref(), setup.as_deref(), emitter(app)))
        .await
        .map_err(|e| e.to_string())?
}

/// `removeWorktree` in `src/worktrees/client.ts`.
#[tauri::command]
pub async fn worktree_remove(path: String, force: bool) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || remove(&path, force)).await.map_err(|e| e.to_string())?
}

/// `cleanupFacts` in `src/worktrees/client.ts`.
#[tauri::command]
pub async fn worktree_cleanup_facts(repo: String) -> Result<CleanupFacts, String> {
    tauri::async_runtime::spawn_blocking(move || cleanup_facts(&repo)).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::temp_dir;
    use std::sync::mpsc;
    use std::time::Duration;

    fn sh_git(args: &[&str], cwd: &Path) {
        let out = crate::proc::command("git")
            .args(["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false"])
            .args(args)
            .current_dir(cwd)
            .output()
            .unwrap();
        assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
    }

    /// `p` with symlinks resolved (macOS's `/var` is `/private/var`), minus the `\\?\` prefix
    /// Windows puts on a canonical path: git cannot create a tree under one.
    fn real(p: &Path) -> PathBuf {
        let canon = p.canonicalize().unwrap();
        match canon.to_string_lossy().strip_prefix(r"\\?\") {
            Some(rest) => PathBuf::from(rest),
            None => canon,
        }
    }

    /// A path spelled the way `list` reports it: git's own spelling, `C:/…` on Windows.
    fn git_form(p: &Path) -> String {
        s(p).replace('\\', "/")
    }

    /// `<tmp>/<tag>/repo` with one commit on `main`, symlinks resolved.
    fn repo(tag: &str) -> PathBuf {
        let root = real(&temp_dir(tag)).join("repo");
        std::fs::create_dir_all(&root).unwrap();
        sh_git(&["init", "-q", "-b", "main"], &root);
        std::fs::write(root.join("README"), "hi\n").unwrap();
        sh_git(&["add", "-A"], &root);
        sh_git(&["commit", "-q", "-m", "one"], &root);
        root
    }

    fn quiet() -> Arc<dyn Fn(JobEvent) + Send + Sync> {
        Arc::new(|_| {})
    }

    fn s(p: &Path) -> String {
        p.to_string_lossy().to_string()
    }

    #[test]
    fn porcelain_keeps_main_first_and_drops_bare_and_prunable() {
        let text = "worktree /r\nHEAD aaa\nbranch refs/heads/main\n\n\
                    worktree /r-wt-x\nHEAD bbb\ndetached\n\n\
                    worktree /gone\nHEAD ccc\nbranch refs/heads/gone\nprunable gitdir file points to non-existent location\n\n\
                    worktree /r-wt-y\nHEAD ddd\nbranch refs/heads/feat/y\nlocked\n";
        assert_eq!(
            parse_porcelain(text),
            [
                Entry { path: "/r".into(), head: "aaa".into(), branch: Some("main".into()) },
                Entry { path: "/r-wt-x".into(), head: "bbb".into(), branch: None },
                Entry { path: "/r-wt-y".into(), head: "ddd".into(), branch: Some("feat/y".into()) },
            ]
        );
        assert_eq!(parse_porcelain("worktree /b.git\nbare\n"), []);
    }

    #[test]
    fn names_that_are_not_one_plain_segment_are_refused() {
        for bad in ["", "..", "../x", "a/b", "a\\b", ".hidden", "-f", "a..b", "x.lock", "x.", "a b", "é", "a:b"] {
            assert!(check_name(bad).is_err(), "{bad:?} was accepted");
        }
        for good in ["x", "fix-181", "feat_a.2", "A1"] {
            assert_eq!(check_name(good), Ok(()), "{good:?} was refused");
        }
    }

    #[test]
    fn create_list_and_remove_a_sibling_tree() {
        let root = repo("wt-cycle");
        let made = create(&s(&root), "task", None, None, quiet()).unwrap();
        let want = git_form(&root.parent().unwrap().join("repo-wt-task"));
        assert_eq!(made.path, want);
        assert_eq!(made.branch.as_deref(), Some("task"));
        assert!(!made.is_main && !made.dispatched && !made.dirty);
        assert_eq!(made.setup_job, None);
        assert_eq!(made.head.len(), 40);

        // From any tree, the same list, main first.
        let from_tree = list(&made.path).unwrap();
        assert_eq!(from_tree, list(&s(&root)).unwrap());
        assert_eq!(from_tree.iter().map(|w| (w.path.as_str(), w.is_main)).collect::<Vec<_>>(), [(git_form(&root).as_str(), true), (want.as_str(), false)]);

        // Dirty: an untracked file counts, and git keeps it without force.
        std::fs::write(Path::new(&want).join("scratch"), "x").unwrap();
        assert!(list(&s(&root)).unwrap()[1].dirty);
        assert!(remove(&want, false).is_err());
        assert!(Path::new(&want).exists());
        remove(&want, true).unwrap();
        assert!(!Path::new(&want).exists());
        assert_eq!(list(&s(&root)).unwrap().len(), 1);
        // The branch outlives the tree, and a new tree on it checks it out again.
        let again = create(&s(&root), "task", None, None, quiet()).unwrap();
        assert_eq!(again.branch.as_deref(), Some("task"));
        assert!(create(&s(&root), "task2", Some("task"), None, quiet()).is_ok());
    }

    #[test]
    fn create_refuses_what_it_should() {
        let root = repo("wt-refuse");
        let r = s(&root);
        assert!(create(&r, "../escape", None, None, quiet()).is_err());
        assert!(create(&r, "x", Some("--orphan"), None, quiet()).is_err());
        std::fs::create_dir(root.parent().unwrap().join("repo-wt-taken")).unwrap();
        assert!(create(&r, "taken", None, None, quiet()).unwrap_err().contains("already exists"));
        assert!(create(&r, "main", Some("main"), None, quiet()).unwrap_err().contains("already exists"));
        let plain = temp_dir("wt-plain");
        assert!(create(&s(&plain), "x", None, None, quiet()).unwrap_err().contains("not in a git repository"));
    }

    #[test]
    fn a_base_starts_the_new_branch_there() {
        let root = repo("wt-base");
        let first = git(&["rev-parse", "HEAD"], &root).unwrap().trim().to_string();
        std::fs::write(root.join("two"), "2").unwrap();
        sh_git(&["add", "-A"], &root);
        sh_git(&["commit", "-q", "-m", "two"], &root);
        let made = create(&s(&root), "old", Some(&first), None, quiet()).unwrap();
        assert_eq!(made.head, first);
    }

    #[test]
    fn remove_refuses_main_strangers_and_paths_outside_the_parent() {
        let root = repo("wt-rm");
        assert!(remove(&s(&root), true).unwrap_err().contains("main checkout"));
        // A plain folder inside the repo is in the repo, but not one of its trees.
        std::fs::create_dir(root.join("sub")).unwrap();
        assert!(remove(&s(&root.join("sub")), true).unwrap_err().contains("not a worktree"));
        // A tree git knows, put outside the repo's parent folder.
        let far = real(&temp_dir("wt-far")).join("far");
        sh_git(&["worktree", "add", "-q", "-b", "far", &s(&far)], &root);
        assert!(remove(&s(&far), true).unwrap_err().contains("outside"));
        assert!(far.exists());
    }

    #[test]
    fn dispatched_is_the_dispatch_mark() {
        let root = repo("wt-mark");
        let made = create(&s(&root), "child", None, None, quiet()).unwrap();
        let dir = Path::new(&made.path).join(".mnemo-child-profile");
        std::fs::create_dir(&dir).unwrap();
        std::fs::write(dir.join("dispatch.json"), "{}").unwrap();
        assert!(list(&s(&root)).unwrap()[1].dispatched);
    }

    #[test]
    fn worktreeinclude_copies_only_ignored_files_it_names() {
        let root = repo("wt-include");
        std::fs::write(root.join(".gitignore"), ".env\nsecrets/\nbuild/\n").unwrap();
        std::fs::write(root.join(INCLUDE_FILE), ".env\nsecrets/\nuntracked.txt\n").unwrap();
        sh_git(&["add", "-A"], &root);
        sh_git(&["commit", "-q", "-m", "ignore"], &root);
        std::fs::write(root.join(".env"), "KEY=1\n").unwrap();
        std::fs::create_dir_all(root.join("secrets/deep")).unwrap();
        std::fs::write(root.join("secrets/deep/k"), "k").unwrap();
        std::fs::create_dir(root.join("build")).unwrap();
        std::fs::write(root.join("build/out"), "o").unwrap();
        // Named but not ignored: git's to carry, not ours.
        std::fs::write(root.join("untracked.txt"), "u").unwrap();

        let made = create(&s(&root), "inc", None, None, quiet()).unwrap();
        let t = Path::new(&made.path);
        assert_eq!(std::fs::read_to_string(t.join(".env")).unwrap(), "KEY=1\n");
        assert_eq!(std::fs::read_to_string(t.join("secrets/deep/k")).unwrap(), "k");
        assert!(!t.join("build").exists());
        assert!(!t.join("untracked.txt").exists());
        // Copied files are ignored there too: the new tree is clean.
        assert!(!made.dirty);
    }

    #[cfg(unix)]
    #[test]
    fn setup_runs_in_the_tree_as_a_job_and_create_does_not_wait() {
        let root = repo("wt-setup");
        let (tx, rx) = mpsc::channel();
        let tx = Mutex::new(tx);
        let sink: Arc<dyn Fn(JobEvent) + Send + Sync> = Arc::new(move |e| tx.lock().unwrap().send(e).unwrap());
        // Setup waits for `go`, so it is surely running while the tree is looked at.
        let go = root.parent().unwrap().join("go");
        let cmd = format!("while [ ! -e '{}' ]; do sleep 0.05; done; pwd; exit 4", go.display());
        let made = create(&s(&root), "set", None, Some(&cmd), sink).unwrap();
        let id = setup_job_id(&made.path);
        assert_eq!(made.setup_job.as_deref(), Some(id.as_str()));
        // Still running: the tree says so, and will not be removed under it.
        assert_eq!(list(&s(&root)).unwrap()[1].setup_job.as_deref(), Some(id.as_str()));
        assert!(remove(&made.path, true).unwrap_err().contains("setup is still running"));
        std::fs::write(&go, "").unwrap();

        let mut lines = vec![];
        let code = loop {
            match rx.recv_timeout(Duration::from_secs(10)).expect("setup ends") {
                JobEvent::Line(l) => {
                    assert_eq!(l.id, id);
                    lines.push(l.line);
                }
                JobEvent::Exit(x) => {
                    assert_eq!(x.id, id);
                    break x.code;
                }
            }
        };
        assert_eq!(code, Some(4));
        assert_eq!(lines, [made.path.clone()]);
        assert_eq!(list(&s(&root)).unwrap()[1].setup_job, None);
        remove(&made.path, false).unwrap();
    }

    fn commit(dir: &Path, file: &str) {
        std::fs::write(dir.join(file), file).unwrap();
        sh_git(&["add", "-A"], dir);
        sh_git(&["commit", "-q", "-m", file], dir);
    }

    fn no_gh(_: &[&str], _: &Path) -> Result<String, String> {
        Err("gh: not found".into())
    }

    fn head_of(dir: &Path) -> String {
        git(&["rev-parse", "HEAD"], dir).unwrap().trim().to_string()
    }

    fn merged_of(facts: &CleanupFacts) -> Vec<(String, bool, bool)> {
        facts.trees.iter().map(|t| (t.info.branch.clone().unwrap_or_default(), t.merged, t.info.dirty)).collect()
    }

    #[test]
    fn cleanup_facts_say_which_trees_are_in_the_default_branch() {
        let root = repo("wt-facts");
        let r = s(&root);
        let done = create(&r, "done", None, None, quiet()).unwrap();
        commit(Path::new(&done.path), "done.txt");
        let open = create(&r, "open", None, None, quiet()).unwrap();
        commit(Path::new(&open.path), "open.txt");
        let fresh = create(&r, "fresh", None, None, quiet()).unwrap();
        sh_git(&["merge", "-q", "--no-edit", "done"], &root);
        std::fs::write(Path::new(&fresh.path).join("scratch"), "x").unwrap();

        let facts = cleanup_facts_with(&r, &no_gh).unwrap();
        // No remote: measured against the main checkout's own branch.
        assert_eq!(facts.base.as_deref(), Some("main"));
        // The main checkout is left out; the rest keep `list`'s order, which is git's (by path).
        assert_eq!(
            merged_of(&facts),
            [("done".into(), true, false), ("fresh".into(), true, true), ("open".into(), false, false)]
        );
        // Asked from inside a tree, the same answer.
        assert_eq!(cleanup_facts_with(&open.path, &no_gh).unwrap(), facts);
    }

    #[test]
    fn cleanup_facts_measure_against_the_remotes_default_branch() {
        let origin = repo("wt-facts-remote");
        let clone = origin.parent().unwrap().join("clone");
        sh_git(&["clone", "-q", &s(&origin), &s(&clone)], origin.parent().unwrap());
        let c = s(&clone);
        let tree = create(&c, "shipped", None, None, quiet()).unwrap();
        commit(Path::new(&tree.path), "shipped.txt");
        // Merged upstream and fetched, while the local main stays behind.
        sh_git(&["fetch", "-q", &tree.path, "shipped:shipped"], &origin);
        sh_git(&["merge", "-q", "--no-edit", "shipped"], &origin);
        sh_git(&["fetch", "-q"], &clone);
        let facts = cleanup_facts_with(&c, &no_gh).unwrap();
        assert_eq!(facts.base.as_deref(), Some("origin/main"));
        assert_eq!(merged_of(&facts), [("shipped".into(), true, false)]);
        // With no default branch to measure against, nothing counts as merged.
        sh_git(&["checkout", "-q", "--detach"], &clone);
        sh_git(&["remote", "remove", "origin"], &clone);
        let none = cleanup_facts_with(&c, &no_gh).unwrap();
        assert_eq!((none.base, none.trees[0].merged), (None, false));
    }

    #[test]
    fn a_squash_merged_branch_is_merged() {
        let root = repo("wt-squash");
        let r = s(&root);
        let sq = create(&r, "sq", None, None, quiet()).unwrap();
        commit(Path::new(&sq.path), "a.txt");
        commit(Path::new(&sq.path), "b.txt");
        let half = create(&r, "half", None, None, quiet()).unwrap();
        commit(Path::new(&half.path), "c.txt");
        commit(Path::new(&half.path), "d.txt");
        // main moves on first, so neither branch is behind main's tip by accident.
        commit(&root, "later.txt");
        sh_git(&["merge", "-q", "--squash", "sq"], &root);
        sh_git(&["commit", "-q", "-m", "sq (#1)"], &root);
        // Only one of `half`'s two commits lands.
        sh_git(&["cherry-pick", &format!("{}~1", head_of(Path::new(&half.path)))], &root);
        let facts = cleanup_facts_with(&r, &no_gh).unwrap();
        assert_eq!(merged_of(&facts), [("half".into(), false, false), ("sq".into(), true, false)]);
    }

    #[test]
    fn a_squash_merge_counts_after_the_default_branch_rewrites_the_same_lines() {
        let root = repo("wt-squash-later");
        let r = s(&root);
        let sq = create(&r, "sq", None, None, quiet()).unwrap();
        let t = Path::new(&sq.path);
        std::fs::write(t.join("README"), "hi\nfrom sq\n").unwrap();
        sh_git(&["commit", "-q", "-am", "one"], t);
        std::fs::write(t.join("README"), "hi\nfrom sq, twice\n").unwrap();
        sh_git(&["commit", "-q", "-am", "two"], t);
        sh_git(&["merge", "-q", "--squash", "sq"], &root);
        sh_git(&["commit", "-q", "-m", "sq (#1)"], &root);
        // Merging `sq` again now conflicts; its squashed patch is still main's.
        std::fs::write(root.join("README"), "hi\nrewritten\n").unwrap();
        sh_git(&["commit", "-q", "-am", "rewrite"], &root);
        let head = head_of(t);
        assert!(!changes_in_merge_tree_only(&root, &head, "main"));
        assert!(changes_in(&root, &head, "main"));
        let facts = cleanup_facts_with(&r, &no_gh).unwrap();
        assert_eq!(merged_of(&facts), [("sq".into(), true, false)]);
    }

    /// The first of `changes_in`'s two tests alone.
    fn changes_in_merge_tree_only(root: &Path, head: &str, base: &str) -> bool {
        let m = git(&["merge-tree", "--write-tree", "--no-messages", base, head], root);
        let b = git(&["rev-parse", &format!("{base}^{{tree}}")], root).unwrap();
        m.is_ok_and(|m| m.lines().next().map(str::trim) == Some(b.trim()))
    }

    #[test]
    fn a_rebase_merged_branch_is_merged() {
        let root = repo("wt-rebase");
        let r = s(&root);
        let rb = create(&r, "rb", None, None, quiet()).unwrap();
        commit(Path::new(&rb.path), "a.txt");
        commit(Path::new(&rb.path), "b.txt");
        commit(&root, "later.txt");
        let tip = head_of(Path::new(&rb.path));
        sh_git(&["cherry-pick", &format!("{tip}~1"), &tip], &root);
        let facts = cleanup_facts_with(&r, &no_gh).unwrap();
        assert_eq!(merged_of(&facts), [("rb".into(), true, false)]);
    }

    #[test]
    fn a_branch_whose_pull_request_ended_is_merged() {
        let root = repo("wt-prs");
        let r = s(&root);
        let mut heads = HashMap::new();
        for name in ["closed", "merged", "moved", "open", "reopened", "unknown"] {
            let t = create(&r, name, None, None, quiet()).unwrap();
            commit(Path::new(&t.path), &format!("{name}.txt"));
            heads.insert(name, head_of(Path::new(&t.path)));
        }
        // `moved` got a commit after its PR was merged: new work.
        let moved = Path::new(&list(&r).unwrap().iter().find(|w| w.branch.as_deref() == Some("moved")).unwrap().path).to_path_buf();
        commit(&moved, "after.txt");
        let pr = |b: &str, oid: &str, state: &str| format!(r#"{{"headRefName":"{b}","headRefOid":"{oid}","state":"{state}"}}"#);
        let json = format!(
            "[{}]",
            [
                pr("closed", &heads["closed"], "CLOSED"),
                pr("merged", &heads["merged"], "MERGED"),
                pr("moved", &heads["moved"], "MERGED"),
                pr("open", &heads["open"], "OPEN"),
                pr("reopened", &heads["reopened"], "MERGED"),
                pr("reopened", &heads["reopened"], "OPEN"),
            ]
            .join(",")
        );
        let asked = Mutex::new(vec![]);
        let gh = |args: &[&str], _: &Path| -> Result<String, String> {
            asked.lock().unwrap().push(args.join(" "));
            Ok(json.clone())
        };
        let facts = cleanup_facts_with(&r, &gh).unwrap();
        assert_eq!(
            merged_of(&facts),
            [
                ("closed".into(), true, false),
                ("merged".into(), true, false),
                ("moved".into(), false, false),
                ("open".into(), false, false),
                ("reopened".into(), false, false),
                ("unknown".into(), false, false),
            ]
        );
        // One `gh` call for the whole repo, every state.
        assert_eq!(*asked.lock().unwrap(), ["pr list --state all --limit 1000 --json headRefName,headRefOid,state"]);
        // `gh` failing or saying nonsense leaves git's signals alone.
        for bad in [&no_gh as GhRun, &|_: &[&str], _: &Path| Ok("not json".to_string())] {
            assert!(cleanup_facts_with(&r, bad).unwrap().trees.iter().all(|t| !t.merged));
        }
    }
}

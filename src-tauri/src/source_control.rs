//! The right sidebar's Source Control panel: a worktree's changes split as git keeps them —
//! staged, unstaged, untracked and conflicted — with stage, unstage and discard per file, and a
//! watch on the tree so the panel reads them again when files change or a commit lands.
//!
//! Paths cross from the front as git printed them, relative to the tree's top level. They are
//! checked to stay inside the tree, and handed to git as literal pathspecs on stdin, so a name
//! with `*`, `:` or a leading `-` means only that file. Discarding an untracked file deletes it:
//! only a file git itself lists as untracked right now is removed, never a folder.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime};

use crate::mission::login_path;
use crate::worktree_diff::{parse_numstat, parse_status, safe_relative, Numstat};

/// Entries listed at most; a tree with more (a vendored folder not yet ignored) says so.
pub const MAX_ENTRIES: usize = 5_000;
/// Untracked files whose lines are counted, and the largest one counted.
const COUNT_UNTRACKED: usize = 300;
const COUNT_UNTRACKED_BYTES: u64 = 512 * 1024;
/// How far into a file a NUL byte marks it binary: git's own heuristic.
const BINARY_PROBE: usize = 8_000;

/// The event the watch sends, with the watched tree's top level as its payload.
pub const CHANGED_EVENT: &str = "source-control://changed";
/// Quiet time after the last change before the panel is told, and the longest a stream of
/// changes (a build writing its output) holds the news back.
const SETTLE: Duration = Duration::from_millis(300);
const MAX_HOLD: Duration = Duration::from_secs(2);

/// `ScmEntry` in `src/source-control/client.ts`.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScmEntry {
    /// Relative to the tree's top level, `/`-separated.
    pub path: String,
    /// Where a renamed or copied file came from.
    pub old_path: Option<String>,
    /// staged | unstaged | untracked | conflicted
    pub area: String,
    /// modified | added | deleted | renamed | copied | untracked | conflicted
    pub status: String,
    /// Lines added and removed in this area; none for a binary file or when git could not say.
    pub added: Option<u32>,
    pub removed: Option<u32>,
}

/// `ScmStatus` in `src/source-control/client.ts`.
#[derive(Serialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ScmStatus {
    /// The tree's top level, which every `path` is relative to.
    pub root: String,
    /// None on a detached HEAD.
    pub branch: Option<String>,
    pub entries: Vec<ScmEntry>,
    /// More entries than `MAX_ENTRIES`.
    pub truncated: bool,
}

// ------------------------------------------------------------------- git --

/// `git <args>` in `cwd`, with `stdin` fed and closed; its stdout, or what it said.
fn git(cwd: &Path, args: &[&str], stdin: Option<&[u8]>) -> Result<Vec<u8>, String> {
    let mut cmd = crate::proc::command("git");
    cmd.args(args)
        .current_dir(cwd)
        .env("PATH", login_path())
        .env("GIT_TERMINAL_PROMPT", "0")
        // A path is a path: no globs, no `:(magic)`.
        .env("GIT_LITERAL_PATHSPECS", "1")
        // Reading the status must not take the index lock a commit running beside it needs.
        .env("GIT_OPTIONAL_LOCKS", "0")
        .stdin(if stdin.is_some() { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| format!("git: {e}"))?;
    let feed = stdin.map(|bytes| {
        let mut pipe = child.stdin.take().expect("stdin is piped");
        let bytes = bytes.to_vec();
        std::thread::spawn(move || {
            let _ = pipe.write_all(&bytes);
        })
    });
    let out = child.wait_with_output().map_err(|e| format!("git: {e}"))?;
    if let Some(f) = feed {
        let _ = f.join();
    }
    if !out.status.success() {
        let verb = args.iter().find(|a| !a.starts_with('-')).unwrap_or(&"");
        return Err(format!("git {verb}: {}", String::from_utf8_lossy(&out.stderr).trim()));
    }
    Ok(out.stdout)
}

fn git_text(cwd: &Path, args: &[&str]) -> Result<String, String> {
    Ok(String::from_utf8_lossy(&git(cwd, args, None)?).trim().to_string())
}

/// The top folder of the tree `worktree` is in.
fn top_level(worktree: &str) -> Result<PathBuf, String> {
    let dir = Path::new(worktree);
    if !dir.is_dir() {
        return Err(format!("{worktree} is not a folder"));
    }
    Ok(PathBuf::from(git_text(dir, &["rev-parse", "--show-toplevel"])?))
}

fn has_head(top: &Path) -> bool {
    git(top, &["rev-parse", "--verify", "--quiet", "HEAD"], None).is_ok()
}

/// `paths` checked to stay inside the tree, as NUL-separated pathspecs for `--pathspec-from-file`.
fn pathspecs(paths: &[String]) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    for p in paths {
        safe_relative(p)?;
        out.extend_from_slice(p.as_bytes());
        out.push(0);
    }
    Ok(out)
}

const FROM_STDIN: [&str; 2] = ["--pathspec-from-file=-", "--pathspec-file-nul"];

// --------------------------------------------------------------- parsing --

fn status_of(letter: char) -> &'static str {
    match letter {
        'A' => "added",
        'D' => "deleted",
        'R' => "renamed",
        'C' => "copied",
        _ => "modified",
    }
}

fn is_conflict(x: char, y: char) -> bool {
    x == 'U' || y == 'U' || (x == 'A' && y == 'A') || (x == 'D' && y == 'D')
}

/// `git status --porcelain=v1 -z` as the panel's rows: an entry changed in the index and again
/// in the tree is two rows, one per area. Ignored entries are left out.
pub fn entries_of(raw: &[u8]) -> Vec<ScmEntry> {
    let row = |path: &str, old: Option<&String>, area: &str, status: &str| ScmEntry {
        path: path.to_string(),
        old_path: old.cloned(),
        area: area.into(),
        status: status.into(),
        added: None,
        removed: None,
    };
    let mut out = Vec::new();
    for e in parse_status(raw) {
        match (e.x, e.y) {
            ('!', '!') => {}
            ('?', '?') => out.push(row(&e.path, None, "untracked", "untracked")),
            (x, y) if is_conflict(x, y) => out.push(row(&e.path, None, "conflicted", "conflicted")),
            (x, y) => {
                if x != ' ' {
                    let old = e.from.as_ref().filter(|_| x == 'R' || x == 'C');
                    out.push(row(&e.path, old, "staged", status_of(x)));
                }
                if y != ' ' {
                    let old = e.from.as_ref().filter(|_| y == 'R' || y == 'C');
                    out.push(row(&e.path, old, "unstaged", status_of(y)));
                }
            }
        }
    }
    out
}

fn looks_binary(bytes: &[u8]) -> bool {
    bytes[..bytes.len().min(BINARY_PROBE)].contains(&0)
}

/// Lines a new file adds, as git counts them: a last line without a newline still counts.
fn line_count(bytes: &[u8]) -> u32 {
    if bytes.is_empty() {
        return 0;
    }
    let n = bytes.iter().filter(|b| **b == b'\n').count();
    (n + usize::from(!bytes.ends_with(b"\n"))) as u32
}

fn apply_counts(entries: &mut [ScmEntry], area: &str, counts: &[Numstat]) {
    for e in entries.iter_mut().filter(|e| e.area == area) {
        if let Some(c) = counts.iter().find(|c| c.path == e.path) {
            e.added = c.added;
            e.removed = c.removed;
        }
    }
}

// ---------------------------------------------------------------- status --

/// The changes of the tree `worktree` is in, area by area, in the order git lists them.
pub fn status(worktree: &str) -> Result<ScmStatus, String> {
    let top = top_level(worktree)?;
    let raw = git(&top, &["status", "--porcelain=v1", "-z", "--untracked-files=all"], None)?;
    let mut entries = entries_of(&raw);
    let truncated = entries.len() > MAX_ENTRIES;
    entries.truncate(MAX_ENTRIES);

    // With no commit yet, `diff --cached` still compares the index with the empty tree.
    let staged = git(&top, &["diff", "--cached", "--numstat", "-z", "-M"], None).unwrap_or_default();
    apply_counts(&mut entries, "staged", &parse_numstat(&staged));
    let unstaged = git(&top, &["diff", "--numstat", "-z"], None).unwrap_or_default();
    apply_counts(&mut entries, "unstaged", &parse_numstat(&unstaged));
    // `git diff` leaves untracked files out: count a new file's lines ourselves, a few of them.
    for e in entries.iter_mut().filter(|e| e.area == "untracked").take(COUNT_UNTRACKED) {
        let full = top.join(&e.path);
        let small = std::fs::symlink_metadata(&full).is_ok_and(|m| m.is_file() && m.len() <= COUNT_UNTRACKED_BYTES);
        if let Some(bytes) = small.then(|| std::fs::read(&full).ok()).flatten() {
            if !looks_binary(&bytes) {
                e.added = Some(line_count(&bytes));
                e.removed = Some(0);
            }
        }
    }

    let branch = git_text(&top, &["symbolic-ref", "--short", "-q", "HEAD"]).ok().filter(|b| !b.is_empty());
    Ok(ScmStatus { root: top.to_string_lossy().to_string(), branch, entries, truncated })
}

// ------------------------------------------------------------ operations --

/// Stages `paths` as they are on disk now: changed, new or deleted. Staging a conflicted file
/// marks it resolved.
pub fn stage(worktree: &str, paths: &[String]) -> Result<(), String> {
    if paths.is_empty() {
        return Ok(());
    }
    let top = top_level(worktree)?;
    let mut args = vec!["add", "-A"];
    args.extend(FROM_STDIN);
    git(&top, &args, Some(&pathspecs(paths)?)).map(drop)
}

/// Takes `paths` out of the index, back to `HEAD`'s version, leaving the files on disk as they
/// are. A rename is unstaged by naming both its paths.
pub fn unstage(worktree: &str, paths: &[String]) -> Result<(), String> {
    if paths.is_empty() {
        return Ok(());
    }
    let top = top_level(worktree)?;
    let specs = pathspecs(paths)?;
    let mut args = if has_head(&top) {
        vec!["restore", "--staged"]
    } else {
        // Nothing to go back to: out of the index altogether.
        vec!["rm", "--cached", "-r", "-f", "-q", "--ignore-unmatch"]
    };
    args.extend(FROM_STDIN);
    git(&top, &args, Some(&specs)).map(drop)
}

/// Throws away the unstaged changes of the tracked `tracked` (back to the index's version) and
/// deletes the untracked files `untracked`. Neither can be undone.
pub fn discard(worktree: &str, tracked: &[String], untracked: &[String]) -> Result<(), String> {
    let top = top_level(worktree)?;
    if !tracked.is_empty() {
        let mut args = vec!["restore", "--worktree"];
        args.extend(FROM_STDIN);
        git(&top, &args, Some(&pathspecs(tracked)?))?;
    }
    if untracked.is_empty() {
        return Ok(());
    }
    // Only what git lists as untracked now: a list read before a `git add` never deletes a
    // file that has since become tracked.
    pathspecs(untracked)?;
    let raw = git(&top, &["status", "--porcelain=v1", "-z", "--untracked-files=all"], None)?;
    let listed: std::collections::HashSet<String> = entries_of(&raw).into_iter().filter(|e| e.area == "untracked").map(|e| e.path).collect();
    let mut failed = Vec::new();
    for p in untracked {
        if !listed.contains(p) {
            failed.push(format!("{p}: git does not list it as untracked"));
            continue;
        }
        let full = top.join(safe_relative(p)?);
        match std::fs::symlink_metadata(&full) {
            Ok(m) if m.is_dir() => failed.push(format!("{p}: a folder, not deleted")),
            Ok(_) => {
                if let Err(e) = std::fs::remove_file(&full) {
                    failed.push(format!("{p}: {e}"));
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => failed.push(format!("{p}: {e}")),
        }
    }
    if failed.is_empty() {
        Ok(())
    } else {
        Err(failed.join("\n"))
    }
}

// ----------------------------------------------------------------- watch --

/// Whether a change at `path` can change what the panel shows: anything in the tree but git's
/// own folder, where only the index (stage, unstage, commit) and HEAD (a checkout) count.
pub fn relevant(path: &Path, top: &Path, git_dir: &Path) -> bool {
    if path.starts_with(git_dir) {
        return path.parent() == Some(git_dir) && path.file_name().is_some_and(|n| n == "index" || n == "HEAD");
    }
    path.starts_with(top) && !path.starts_with(top.join(".git"))
}

struct Watching {
    top: PathBuf,
    _watchers: Vec<notify::RecommendedWatcher>,
}

/// The one tree watched: the panel shows one worktree at a time.
static WATCHING: Mutex<Option<Watching>> = Mutex::new(None);

/// Calls `tell` once changes settle; ends when every sender (the watchers) is gone.
fn settle(tell: impl Fn() + Send + 'static) -> Sender<()> {
    let (tx, rx) = channel::<()>();
    std::thread::spawn(move || {
        while rx.recv().is_ok() {
            let first = Instant::now();
            loop {
                match rx.recv_timeout(SETTLE) {
                    Ok(()) if first.elapsed() < MAX_HOLD => continue,
                    Ok(()) | Err(RecvTimeoutError::Timeout) => break,
                    Err(RecvTimeoutError::Disconnected) => return,
                }
            }
            tell();
        }
    });
    tx
}

fn watcher(tx: Sender<()>, top: PathBuf, git_dir: PathBuf, at: &Path, mode: notify::RecursiveMode) -> Result<notify::RecommendedWatcher, String> {
    use notify::Watcher;
    let tx = Mutex::new(tx);
    let mut w = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let Ok(ev) = res else { return };
        if matches!(ev.kind, notify::EventKind::Access(_)) {
            return;
        }
        if ev.paths.iter().any(|p| relevant(p, &top, &git_dir)) {
            let _ = tx.lock().map(|t| t.send(()));
        }
    })
    .map_err(|e| format!("watch: {e}"))?;
    w.watch(at, mode).map_err(|e| format!("watch {}: {e}", at.display()))?;
    Ok(w)
}

/// Watches the tree whose top level is `top`, calling `tell` when what the panel shows may have
/// changed. Watching stops when the result is dropped.
fn start(top: &Path, tell: impl Fn() + Send + 'static) -> Result<Watching, String> {
    let git_dir = PathBuf::from(git_text(top, &["rev-parse", "--absolute-git-dir"])?);
    // The canonical paths, as the watcher reports them (macOS's /var is /private/var).
    let top_c = top.canonicalize().unwrap_or_else(|_| top.to_path_buf());
    let git_c = git_dir.canonicalize().unwrap_or(git_dir);
    let tx = settle(tell);
    let mut watchers = vec![watcher(tx.clone(), top_c.clone(), git_c.clone(), &top_c, notify::RecursiveMode::Recursive)?];
    // A linked worktree keeps its index outside the tree.
    if !git_c.starts_with(&top_c) {
        watchers.push(watcher(tx, top_c, git_c.clone(), &git_c, notify::RecursiveMode::NonRecursive)?);
    }
    Ok(Watching { top: top.to_path_buf(), _watchers: watchers })
}

/// Watches the tree `worktree` is in, in place of the one watched before, sending
/// `CHANGED_EVENT`; `None` stops watching. `Err` when the tree cannot be watched (more folders
/// than the system lets one watch): the panel then reads the changes on its own clock.
pub fn watch<R: Runtime>(app: AppHandle<R>, worktree: Option<&str>) -> Result<(), String> {
    let mut slot = WATCHING.lock().unwrap_or_else(|e| e.into_inner());
    let Some(worktree) = worktree else {
        *slot = None;
        return Ok(());
    };
    let top = top_level(worktree)?;
    if slot.as_ref().is_some_and(|w| w.top == top) {
        return Ok(());
    }
    *slot = None;
    let payload = top.to_string_lossy().to_string();
    *slot = Some(start(&top, move || {
        let _ = app.emit(CHANGED_EVENT, &payload);
    })?);
    Ok(())
}

// -------------------------------------------------------------- commands --

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn source_control_status(worktree: String) -> Result<ScmStatus, String> {
    blocking(move || status(&worktree)).await
}

#[tauri::command]
pub async fn source_control_stage(worktree: String, paths: Vec<String>) -> Result<(), String> {
    blocking(move || stage(&worktree, &paths)).await
}

#[tauri::command]
pub async fn source_control_unstage(worktree: String, paths: Vec<String>) -> Result<(), String> {
    blocking(move || unstage(&worktree, &paths)).await
}

#[tauri::command]
pub async fn source_control_discard(worktree: String, tracked: Vec<String>, untracked: Vec<String>) -> Result<(), String> {
    blocking(move || discard(&worktree, &tracked, &untracked)).await
}

#[tauri::command]
pub async fn source_control_watch<R: Runtime>(app: AppHandle<R>, worktree: Option<String>) -> Result<(), String> {
    blocking(move || watch(app, worktree.as_deref())).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::temp_dir;

    fn sh_git(args: &[&str], cwd: &Path) {
        let out = crate::proc::command("git")
            .args(["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false"])
            .args(args)
            .current_dir(cwd)
            .output()
            .unwrap();
        assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
    }

    /// A repo with `keep.txt`, `edit.txt`, `gone.txt` and `old.txt` committed.
    fn repo(tag: &str) -> PathBuf {
        let root = temp_dir(tag).join("repo");
        std::fs::create_dir_all(&root).unwrap();
        sh_git(&["init", "-q", "-b", "main"], &root);
        for (f, body) in [("keep.txt", "same\n"), ("edit.txt", "one\ntwo\n"), ("gone.txt", "bye\n"), ("old.txt", "moved\nalong\n")] {
            std::fs::write(root.join(f), body).unwrap();
        }
        sh_git(&["add", "-A"], &root);
        sh_git(&["commit", "-q", "-m", "one"], &root);
        root
    }

    fn s(p: &Path) -> String {
        p.to_string_lossy().to_string()
    }

    fn v(xs: &[&str]) -> Vec<String> {
        xs.iter().map(|x| x.to_string()).collect()
    }

    /// `(area, status, path)` of every entry, sorted.
    fn rows(st: &ScmStatus) -> Vec<(String, String, String)> {
        let mut r: Vec<_> = st.entries.iter().map(|e| (e.area.clone(), e.status.clone(), e.path.clone())).collect();
        r.sort();
        r
    }

    fn row(area: &str, status: &str, path: &str) -> (String, String, String) {
        (area.into(), status.into(), path.into())
    }

    #[test]
    fn an_entry_changed_in_both_places_is_a_row_in_each_area() {
        let raw = b"MM both.txt\0 M tree.txt\0A  new.txt\0R  new name.txt\0old.txt\0?? n.txt\0!! ignored.log\0UU fight.txt\0AA twice.txt\0 D gone.txt\0";
        let got = entries_of(raw);
        let short: Vec<_> = got.iter().map(|e| (e.area.as_str(), e.status.as_str(), e.path.as_str(), e.old_path.as_deref())).collect();
        assert_eq!(
            short,
            vec![
                ("staged", "modified", "both.txt", None),
                ("unstaged", "modified", "both.txt", None),
                ("unstaged", "modified", "tree.txt", None),
                ("staged", "added", "new.txt", None),
                ("staged", "renamed", "new name.txt", Some("old.txt")),
                ("untracked", "untracked", "n.txt", None),
                ("conflicted", "conflicted", "fight.txt", None),
                ("conflicted", "conflicted", "twice.txt", None),
                ("unstaged", "deleted", "gone.txt", None),
            ]
        );
    }

    #[test]
    fn status_splits_the_areas_and_counts_lines_in_each() {
        let root = repo("scm-status");
        std::fs::write(root.join("edit.txt"), "one\nTWO\nthree\n").unwrap();
        sh_git(&["add", "edit.txt"], &root);
        std::fs::write(root.join("edit.txt"), "one\nTWO\nthree\nfour\n").unwrap();
        std::fs::remove_file(root.join("gone.txt")).unwrap();
        std::fs::create_dir_all(root.join("dir")).unwrap();
        std::fs::write(root.join("dir/n w.txt"), "a\nb\nc").unwrap();
        let st = status(&s(&root)).unwrap();
        assert_eq!(st.branch.as_deref(), Some("main"));
        assert!(!st.truncated);
        assert_eq!(
            rows(&st),
            vec![
                row("staged", "modified", "edit.txt"),
                row("unstaged", "deleted", "gone.txt"),
                row("unstaged", "modified", "edit.txt"),
                row("untracked", "untracked", "dir/n w.txt"),
            ]
        );
        let find = |area: &str, path: &str| st.entries.iter().find(|e| e.area == area && e.path == path).unwrap().clone();
        let staged = find("staged", "edit.txt");
        assert_eq!((staged.added, staged.removed), (Some(2), Some(1)));
        let unstaged = find("unstaged", "edit.txt");
        assert_eq!((unstaged.added, unstaged.removed), (Some(1), Some(0)));
        let new = find("untracked", "dir/n w.txt");
        assert_eq!((new.added, new.removed), (Some(3), Some(0)));
        // Asked from a folder inside the tree, the paths are still the top level's.
        std::fs::create_dir_all(root.join("sub")).unwrap();
        assert_eq!(status(&s(&root.join("sub"))).unwrap().entries.len(), 4);
    }

    #[test]
    fn stage_and_unstage_move_a_file_between_the_areas() {
        let root = repo("scm-stage");
        std::fs::write(root.join("edit.txt"), "changed\n").unwrap();
        std::fs::remove_file(root.join("gone.txt")).unwrap();
        std::fs::write(root.join("*.txt"), "a star\n").unwrap();
        stage(&s(&root), &v(&["edit.txt", "gone.txt", "*.txt"])).unwrap();
        let st = status(&s(&root)).unwrap();
        assert_eq!(rows(&st), vec![row("staged", "added", "*.txt"), row("staged", "deleted", "gone.txt"), row("staged", "modified", "edit.txt")]);
        // `*.txt` is a file here, not a glob: unstaging it leaves the others staged.
        unstage(&s(&root), &v(&["*.txt"])).unwrap();
        let st = status(&s(&root)).unwrap();
        assert_eq!(rows(&st), vec![row("staged", "deleted", "gone.txt"), row("staged", "modified", "edit.txt"), row("untracked", "untracked", "*.txt")]);
        assert_eq!(std::fs::read_to_string(root.join("edit.txt")).unwrap(), "changed\n");
    }

    #[test]
    fn a_rename_unstages_by_both_its_paths() {
        let root = repo("scm-rename");
        sh_git(&["mv", "old.txt", "new.txt"], &root);
        let st = status(&s(&root)).unwrap();
        let e = st.entries.iter().find(|e| e.area == "staged").unwrap();
        assert_eq!((e.status.as_str(), e.path.as_str(), e.old_path.as_deref()), ("renamed", "new.txt", Some("old.txt")));
        unstage(&s(&root), &v(&["new.txt", "old.txt"])).unwrap();
        let st = status(&s(&root)).unwrap();
        assert_eq!(rows(&st), vec![row("unstaged", "deleted", "old.txt"), row("untracked", "untracked", "new.txt")]);
    }

    #[test]
    fn unstage_works_before_the_first_commit() {
        let root = temp_dir("scm-unborn").join("repo");
        std::fs::create_dir_all(&root).unwrap();
        sh_git(&["init", "-q", "-b", "main"], &root);
        std::fs::write(root.join("a.txt"), "a\n").unwrap();
        std::fs::write(root.join("b.txt"), "b\n").unwrap();
        stage(&s(&root), &v(&["a.txt", "b.txt"])).unwrap();
        let st = status(&s(&root)).unwrap();
        assert_eq!(rows(&st), vec![row("staged", "added", "a.txt"), row("staged", "added", "b.txt")]);
        unstage(&s(&root), &v(&["a.txt"])).unwrap();
        let st = status(&s(&root)).unwrap();
        assert_eq!(rows(&st), vec![row("staged", "added", "b.txt"), row("untracked", "untracked", "a.txt")]);
        assert!(root.join("a.txt").exists());
    }

    #[test]
    fn discard_reverts_the_tree_to_the_index_and_deletes_untracked_files() {
        let root = repo("scm-discard");
        std::fs::write(root.join("edit.txt"), "staged\n").unwrap();
        sh_git(&["add", "edit.txt"], &root);
        std::fs::write(root.join("edit.txt"), "staged\nand more\n").unwrap();
        std::fs::remove_file(root.join("gone.txt")).unwrap();
        std::fs::write(root.join("new.txt"), "new\n").unwrap();
        discard(&s(&root), &v(&["edit.txt", "gone.txt"]), &v(&["new.txt"])).unwrap();
        // The staged change stays: discard only drops what is not staged.
        assert_eq!(std::fs::read_to_string(root.join("edit.txt")).unwrap(), "staged\n");
        assert_eq!(std::fs::read_to_string(root.join("gone.txt")).unwrap(), "bye\n");
        assert!(!root.join("new.txt").exists());
        assert_eq!(rows(&status(&s(&root)).unwrap()), vec![row("staged", "modified", "edit.txt")]);
    }

    #[test]
    fn discard_never_deletes_a_file_git_does_not_list_as_untracked() {
        let root = repo("scm-discard-tracked");
        std::fs::write(root.join("new.txt"), "new\n").unwrap();
        sh_git(&["add", "new.txt"], &root);
        let err = discard(&s(&root), &[], &v(&["new.txt", "keep.txt"])).unwrap_err();
        assert!(err.contains("new.txt: git does not list it as untracked"), "{err}");
        assert!(err.contains("keep.txt"), "{err}");
        assert!(root.join("new.txt").exists() && root.join("keep.txt").exists());
    }

    #[test]
    fn discard_leaves_an_untracked_folder_alone() {
        let root = repo("scm-discard-folder");
        // A repository of its own inside the tree: git lists it as one untracked folder.
        let inner = root.join("inner");
        std::fs::create_dir_all(&inner).unwrap();
        sh_git(&["init", "-q"], &inner);
        std::fs::write(inner.join("work.txt"), "precious\n").unwrap();
        let st = status(&s(&root)).unwrap();
        assert_eq!(rows(&st), vec![row("untracked", "untracked", "inner/")]);
        let err = discard(&s(&root), &[], &v(&["inner/"])).unwrap_err();
        assert!(err.contains("inner/: a folder, not deleted"), "{err}");
        assert!(inner.join("work.txt").exists());
    }

    #[test]
    fn paths_leaving_the_tree_are_refused() {
        let root = repo("scm-escape");
        let outside = root.parent().unwrap().join("outside.txt");
        std::fs::write(&outside, "keep me\n").unwrap();
        for bad in ["../outside.txt", "/etc/hosts", ""] {
            // Refused by us, before git or the file system is asked.
            for err in [discard(&s(&root), &[], &v(&[bad])), discard(&s(&root), &v(&[bad]), &[]), stage(&s(&root), &v(&[bad])), unstage(&s(&root), &v(&[bad]))] {
                assert!(err.unwrap_err().contains("not a path inside the worktree"), "{bad}");
            }
        }
        assert!(outside.exists());
    }

    #[test]
    fn a_folder_that_is_not_a_repo_says_so() {
        let dir = temp_dir("scm-norepo");
        assert!(status(&s(&dir)).is_err());
        assert!(status(&s(&dir.join("missing"))).unwrap_err().contains("not a folder"));
    }

    /// Waits for the watch to tell, up to `within`; false when it stayed quiet.
    fn told(rx: &std::sync::mpsc::Receiver<()>, within: Duration) -> bool {
        rx.recv_timeout(within).is_ok()
    }

    #[test]
    fn the_watch_tells_of_a_file_changed_and_of_a_stage_in_a_linked_worktree() {
        let main = repo("scm-watch");
        let linked = main.parent().unwrap().join("linked");
        sh_git(&["worktree", "add", "-q", "-b", "side", &s(&linked)], &main);
        std::fs::write(linked.join("edit.txt"), "changed\n").unwrap();
        let (tx, rx) = channel();
        let tx = Mutex::new(tx);
        let w = start(&linked, move || {
            let _ = tx.lock().unwrap().send(());
        })
        .unwrap();
        // Let the watch settle in before touching anything (FSEvents starts late).
        std::thread::sleep(Duration::from_millis(500));
        while rx.try_recv().is_ok() {}
        std::fs::write(linked.join("new.txt"), "new\n").unwrap();
        assert!(told(&rx, Duration::from_secs(5)), "a new file in the tree");
        std::thread::sleep(SETTLE * 2);
        while rx.try_recv().is_ok() {}
        // Staging touches only the index, which lives in the main repo's `.git/worktrees/`.
        stage(&s(&linked), &v(&["edit.txt"])).unwrap();
        assert!(told(&rx, Duration::from_secs(5)), "a stage");
        drop(w);
    }

    #[test]
    fn only_the_index_and_head_count_inside_git_s_folder() {
        let top = Path::new("/r");
        let git = Path::new("/r/.git");
        assert!(relevant(Path::new("/r/src/a.ts"), top, git));
        assert!(relevant(Path::new("/r/.git/index"), top, git));
        assert!(relevant(Path::new("/r/.git/HEAD"), top, git));
        assert!(!relevant(Path::new("/r/.git/index.lock"), top, git));
        assert!(!relevant(Path::new("/r/.git/objects/ab/cdef"), top, git));
        assert!(!relevant(Path::new("/r/.git/refs/heads/HEAD"), top, git));
        assert!(!relevant(Path::new("/elsewhere/a.ts"), top, git));
        // A linked worktree: `.git` is a file, and its index lives in the main repo's folder.
        let linked = Path::new("/main/.git/worktrees/r");
        assert!(relevant(Path::new("/main/.git/worktrees/r/index"), top, linked));
        assert!(!relevant(Path::new("/main/.git/worktrees/r/logs/HEAD"), top, linked));
        assert!(!relevant(Path::new("/r/.git"), top, linked));
    }
}

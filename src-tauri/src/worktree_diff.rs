//! A worktree's uncommitted changes, for the diff tab: the files that differ from `HEAD` (staged,
//! unstaged and untracked alike — what a commit of everything would carry), and, one file at a
//! time, its two sides as text for the front's Monaco diff editor.
//!
//! The list is `git status` and `git diff HEAD --numstat`, both run in the tree. A side is read
//! only when the user opens that file: `HEAD`'s blob through `git show`, the working side from
//! disk. What crosses to the front is bounded: a side past `MAX_SIDE_BYTES`, or one that looks
//! binary, comes back empty with the reason, and the list stops at `MAX_FILES`.
//!
//! A child's branch is compared to where it was cut from instead: given a `base`, both the list and
//! the sides are taken against the merge base of that ref (or, for an empty `base`, of the repo's
//! default branch) and `HEAD`, so the child's commits and its uncommitted work show together.
//!
//! The file named must be one of the tree's own: a relative path with no `..`, read under the
//! tree's top level.

use std::path::{Component, Path, PathBuf};

use serde::Serialize;

use crate::mission::login_path;

/// Files listed at most; a tree with more (a vendored folder not yet ignored) says so.
pub const MAX_FILES: usize = 2_000;
/// Bytes of one side sent to the front; a larger file is shown as too large to diff.
pub const MAX_SIDE_BYTES: usize = 2 * 1024 * 1024;
/// How far into a side a NUL byte marks it binary: git's own heuristic.
const BINARY_PROBE: usize = 8_000;

/// `ChangedFile` in `src/diff/client.ts`.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChangedFile {
    /// Relative to the tree's top level, `/`-separated.
    pub path: String,
    /// The path in `HEAD` when the file was renamed.
    pub old_path: Option<String>,
    /// added | modified | deleted | renamed | untracked | conflicted
    pub status: String,
    /// Lines added and removed against `HEAD`; none for a binary file or when git could not say.
    pub additions: Option<u32>,
    pub deletions: Option<u32>,
    pub binary: bool,
}

/// `ChangeList` in `src/diff/client.ts`.
#[derive(Serialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ChangeList {
    /// The tree's top level, the folder every `path` is relative to.
    pub root: String,
    pub files: Vec<ChangedFile>,
    /// More files changed than `MAX_FILES`.
    pub truncated: bool,
    /// What the files are compared to when that is a branch's base rather than `HEAD`: the ref's
    /// name and the merge base's short hash, e.g. `main @ 1a2b3c4`.
    pub base: Option<String>,
}

/// `FileSides` in `src/diff/client.ts`.
#[derive(Serialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct FileSides {
    /// `HEAD`'s text; empty for a new file.
    pub original: String,
    /// The working tree's text; empty for a deleted file.
    pub modified: String,
    /// Either side looks binary: both come back empty.
    pub binary: bool,
    /// Either side is past `MAX_SIDE_BYTES`: both come back empty.
    pub too_large: bool,
}

fn git_bytes(args: &[&str], cwd: &Path) -> Result<Vec<u8>, String> {
    let mut cmd = crate::proc::command("git");
    cmd.args(args).env("PATH", login_path()).current_dir(cwd).stdin(std::process::Stdio::null());
    let out = cmd.output().map_err(|e| format!("git: {e}"))?;
    if !out.status.success() {
        return Err(format!("git {}: {}", args.join(" "), String::from_utf8_lossy(&out.stderr).trim()));
    }
    Ok(out.stdout)
}

fn top_level(worktree: &str) -> Result<PathBuf, String> {
    let out = git_bytes(&["rev-parse", "--show-toplevel"], Path::new(worktree))?;
    Ok(PathBuf::from(String::from_utf8_lossy(&out).trim()))
}

/// Whether the tree has a commit to diff against; a fresh `git init` has none.
fn has_head(top: &Path) -> bool {
    git_bytes(&["rev-parse", "--verify", "--quiet", "HEAD"], top).is_ok()
}

/// One `git status --porcelain=v1 -z` entry: its two status letters, path and, for a rename or
/// copy, the path it came from.
#[derive(Debug, PartialEq)]
pub(crate) struct StatusEntry {
    pub x: char,
    pub y: char,
    pub path: String,
    pub from: Option<String>,
}

/// `git status --porcelain=v1 -z` output: `XY path\0`, a rename or copy followed by `from\0`.
pub(crate) fn parse_status(raw: &[u8]) -> Vec<StatusEntry> {
    let mut out = Vec::new();
    let mut parts = raw.split(|b| *b == 0).filter(|p| !p.is_empty());
    while let Some(p) = parts.next() {
        if p.len() < 4 {
            continue;
        }
        let x = p[0] as char;
        let y = p[1] as char;
        let path = String::from_utf8_lossy(&p[3..]).to_string();
        let from = if x == 'R' || x == 'C' || y == 'R' || y == 'C' {
            parts.next().map(|f| String::from_utf8_lossy(f).to_string())
        } else {
            None
        };
        out.push(StatusEntry { x, y, path, from });
    }
    out
}

/// What a status pair means against `HEAD`; none for a file that is in neither `HEAD` nor the
/// working tree (added to the index, then deleted from disk).
pub(crate) fn status_word(x: char, y: char) -> Option<&'static str> {
    match (x, y) {
        ('?', '?') => Some("untracked"),
        ('!', '!') => None,
        ('A', 'D') => None,
        ('U', _) | (_, 'U') | ('A', 'A') | ('D', 'D') => Some("conflicted"),
        (_, 'D') | ('D', _) => Some("deleted"),
        ('R', _) | (_, 'R') => Some("renamed"),
        ('A', _) | ('C', _) => Some("added"),
        _ => Some("modified"),
    }
}

/// One `git diff --numstat -z` count: added, removed (none when binary), and the path.
#[derive(Debug, PartialEq)]
pub(crate) struct Numstat {
    pub added: Option<u32>,
    pub removed: Option<u32>,
    pub path: String,
}

/// `git diff --numstat -z` output: `a\tr\tpath\0`, a rename `a\tr\t\0from\0to\0`; `-\t-` for a
/// binary file.
pub(crate) fn parse_numstat(raw: &[u8]) -> Vec<Numstat> {
    let mut out = Vec::new();
    let mut parts = raw.split(|b| *b == 0);
    while let Some(p) = parts.next() {
        if p.is_empty() {
            continue;
        }
        let text = String::from_utf8_lossy(p);
        let mut cols = text.splitn(3, '\t');
        let (Some(a), Some(r), Some(rest)) = (cols.next(), cols.next(), cols.next()) else { continue };
        let path = if rest.is_empty() {
            // A rename: the from and to paths follow as their own fields.
            let _from = parts.next();
            match parts.next() {
                Some(to) => String::from_utf8_lossy(to).to_string(),
                None => continue,
            }
        } else {
            rest.to_string()
        };
        out.push(Numstat { added: a.parse().ok(), removed: r.parse().ok(), path });
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

/// The changed files of the tree `worktree` is in, in the order git lists them.
pub fn changes(worktree: &str) -> Result<ChangeList, String> {
    changes_against(worktree, None)
}

/// Where a branch was cut from: the merge base of `HEAD` and `base` (an empty `base`: the default
/// branch), as a full hash and a label. None when no default branch is found, and when `HEAD`
/// is the merge base itself the diff is simply the uncommitted work.
fn resolve_base(top: &Path, base: &str) -> Result<Option<(String, String)>, String> {
    let name = if base.is_empty() {
        match default_branch(top) {
            Some(n) => n,
            None => return Ok(None),
        }
    } else {
        base.to_string()
    };
    if !has_head(top) {
        return Ok(None);
    }
    let out = git_bytes(&["merge-base", &name, "HEAD"], top)?;
    let sha = String::from_utf8_lossy(&out).trim().to_string();
    if sha.is_empty() {
        return Err(format!("no merge base between {name} and HEAD"));
    }
    let short: String = sha.chars().take(7).collect();
    Ok(Some((sha, format!("{name} @ {short}"))))
}

fn ref_exists(top: &Path, name: &str) -> bool {
    git_bytes(&["rev-parse", "--verify", "--quiet", &format!("{name}^{{commit}}")], top).is_ok()
}

/// The repo's default branch: what `origin/HEAD` names (its local branch when there is one, since
/// that is where the work lands first), else `main` or `master`.
fn default_branch(top: &Path) -> Option<String> {
    let mut candidates = Vec::new();
    if let Ok(out) = git_bytes(&["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], top) {
        let full = String::from_utf8_lossy(&out).trim().to_string();
        if let Some(short) = full.strip_prefix("origin/") {
            candidates.push(short.to_string());
        }
        candidates.push(full);
    }
    for n in ["main", "master", "origin/main", "origin/master"] {
        candidates.push(n.to_string());
    }
    candidates.into_iter().find(|c| ref_exists(top, c))
}

/// One `git diff --name-status -z` entry: its letter, path and, for a rename, the path it had.
fn parse_name_status(raw: &[u8]) -> Vec<(char, String, Option<String>)> {
    let mut out = Vec::new();
    let mut parts = raw.split(|b| *b == 0).filter(|p| !p.is_empty());
    while let Some(code) = parts.next() {
        let letter = code[0] as char;
        let Some(first) = parts.next() else { break };
        let first = String::from_utf8_lossy(first).to_string();
        if letter == 'R' || letter == 'C' {
            let Some(to) = parts.next() else { break };
            out.push((letter, String::from_utf8_lossy(to).to_string(), Some(first)));
        } else {
            out.push((letter, first, None));
        }
    }
    out
}

/// The changed files against `base` (see `resolve_base`); `None` is against `HEAD`.
pub fn changes_against(worktree: &str, base: Option<&str>) -> Result<ChangeList, String> {
    let top = top_level(worktree)?;
    if let Some(base) = base {
        if let Some((sha, label)) = resolve_base(&top, base)? {
            return branch_changes(&top, &sha, label);
        }
    }
    let status = git_bytes(&["status", "--porcelain=v1", "-z", "--untracked-files=all"], &top)?;
    let head = has_head(&top);
    let counts = if head {
        parse_numstat(&git_bytes(&["diff", "HEAD", "--numstat", "-z", "-M"], &top).unwrap_or_default())
    } else {
        Vec::new()
    };
    let mut files = Vec::new();
    let mut truncated = false;
    for e in parse_status(&status) {
        let Some(word) = status_word(e.x, e.y) else { continue };
        if files.len() == MAX_FILES {
            truncated = true;
            break;
        }
        // With no commit yet, everything is new.
        let word = if head || word == "untracked" { word } else { "added" };
        let count = counts.iter().find(|c| c.path == e.path);
        let (mut additions, mut deletions, mut binary) =
            (count.and_then(|c| c.added), count.and_then(|c| c.removed), count.is_some_and(|c| c.added.is_none()));
        if count.is_none() && (word == "untracked" || word == "added") {
            // `git diff HEAD` leaves untracked files out: count the new file's lines ourselves.
            if let Ok(bytes) = std::fs::read(top.join(&e.path)) {
                binary = looks_binary(&bytes);
                if !binary {
                    additions = Some(line_count(&bytes));
                    deletions = Some(0);
                }
            }
        }
        files.push(ChangedFile {
            path: e.path,
            old_path: e.from.filter(|_| word == "renamed"),
            status: word.to_string(),
            additions,
            deletions,
            binary,
        });
    }
    Ok(ChangeList { root: top.to_string_lossy().to_string(), files, truncated, base: None })
}

/// Everything that differs from `sha` in the working tree: the branch's commits, its staged and
/// unstaged edits and its untracked files.
fn branch_changes(top: &Path, sha: &str, label: String) -> Result<ChangeList, String> {
    let tracked = parse_name_status(&git_bytes(&["diff", sha, "--name-status", "-z", "-M"], top)?);
    let counts = parse_numstat(&git_bytes(&["diff", sha, "--numstat", "-z", "-M"], top).unwrap_or_default());
    let status = parse_status(&git_bytes(&["status", "--porcelain=v1", "-z", "--untracked-files=all"], top)?);
    let mut rows: Vec<(String, Option<String>, &str)> = Vec::new();
    for (letter, path, from) in tracked {
        let word = match letter {
            'A' | 'C' => "added",
            'D' => "deleted",
            'R' => "renamed",
            'U' => "conflicted",
            _ => "modified",
        };
        rows.push((path, from, word));
    }
    for e in &status {
        match status_word(e.x, e.y) {
            Some("untracked") => rows.push((e.path.clone(), None, "untracked")),
            Some("conflicted") => {
                if let Some(r) = rows.iter_mut().find(|r| r.0 == e.path) {
                    r.2 = "conflicted";
                } else {
                    rows.push((e.path.clone(), None, "conflicted"));
                }
            }
            _ => {}
        }
    }
    let mut files = Vec::new();
    let mut truncated = false;
    for (path, from, word) in rows {
        if files.len() == MAX_FILES {
            truncated = true;
            break;
        }
        let count = counts.iter().find(|c| c.path == path);
        let (mut additions, mut deletions, mut binary) =
            (count.and_then(|c| c.added), count.and_then(|c| c.removed), count.is_some_and(|c| c.added.is_none()));
        if count.is_none() && word == "untracked" {
            if let Ok(bytes) = std::fs::read(top.join(&path)) {
                binary = looks_binary(&bytes);
                if !binary {
                    additions = Some(line_count(&bytes));
                    deletions = Some(0);
                }
            }
        }
        files.push(ChangedFile { path, old_path: from, status: word.to_string(), additions, deletions, binary });
    }
    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(ChangeList { root: top.to_string_lossy().to_string(), files, truncated, base: Some(label) })
}

/// `file` as a path under the tree: relative, and never climbing out of it.
pub(crate) fn safe_relative(file: &str) -> Result<&Path, String> {
    let p = Path::new(file);
    if file.is_empty() || !p.components().all(|c| matches!(c, Component::Normal(_) | Component::CurDir)) {
        return Err(format!("not a path inside the worktree: {file}"));
    }
    Ok(p)
}

enum Side {
    Text(String),
    Binary,
    TooLarge,
}

fn side_of(bytes: Vec<u8>) -> Side {
    if bytes.len() > MAX_SIDE_BYTES {
        Side::TooLarge
    } else if looks_binary(&bytes) {
        Side::Binary
    } else {
        Side::Text(String::from_utf8_lossy(&bytes).to_string())
    }
}

/// The working side: a symlink is its target, as git stores it; a missing file is empty.
fn working_side(top: &Path, rel: &Path) -> Result<Side, String> {
    let full = top.join(rel);
    let meta = match std::fs::symlink_metadata(&full) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Side::Text(String::new())),
        Err(e) => return Err(format!("{}: {e}", rel.display())),
    };
    if meta.file_type().is_symlink() {
        let target = std::fs::read_link(&full).map_err(|e| format!("{}: {e}", rel.display()))?;
        return Ok(Side::Text(target.to_string_lossy().to_string()));
    }
    if meta.is_dir() {
        return Err(format!("{} is a folder (a submodule?), not a file", rel.display()));
    }
    if meta.len() as usize > MAX_SIDE_BYTES {
        return Ok(Side::TooLarge);
    }
    std::fs::read(&full).map(side_of).map_err(|e| format!("{}: {e}", rel.display()))
}

/// `rev`'s side of `rel`: empty when `rev` has no such file (or there is no `HEAD`).
fn head_side(top: &Path, rev: &str, rel: &str) -> Side {
    if !has_head(top) {
        return Side::Text(String::new());
    }
    match git_bytes(&["show", &format!("{rev}:{rel}")], top) {
        Ok(bytes) => side_of(bytes),
        Err(_) => Side::Text(String::new()),
    }
}

/// Both sides of `file` in the tree `worktree` is in; `old_path` is where a renamed file was.
pub fn sides(worktree: &str, file: &str, old_path: Option<&str>) -> Result<FileSides, String> {
    sides_against(worktree, file, old_path, None)
}

/// As `sides`, the original taken from the merge base `changes_against` compares to.
pub fn sides_against(worktree: &str, file: &str, old_path: Option<&str>, base: Option<&str>) -> Result<FileSides, String> {
    let rel = safe_relative(file)?;
    let base_path = match old_path {
        Some(o) => {
            safe_relative(o)?;
            o
        }
        None => file,
    };
    let top = top_level(worktree)?;
    let rev = match base {
        Some(b) => resolve_base(&top, b)?.map(|(sha, _)| sha),
        None => None,
    }
    .unwrap_or_else(|| "HEAD".to_string());
    let original = head_side(&top, &rev, &base_path.replace('\\', "/"));
    let modified = working_side(&top, rel)?;
    let mut out = FileSides::default();
    for (side, slot) in [(original, &mut out.original), (modified, &mut out.modified)] {
        match side {
            Side::Text(t) => *slot = t,
            Side::Binary => out.binary = true,
            Side::TooLarge => out.too_large = true,
        }
    }
    if out.binary || out.too_large {
        out.original.clear();
        out.modified.clear();
    }
    Ok(out)
}

#[tauri::command]
pub async fn worktree_diff_files(worktree: String, base: Option<String>) -> Result<ChangeList, String> {
    tauri::async_runtime::spawn_blocking(move || changes_against(&worktree, base.as_deref())).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn worktree_diff_file(
    worktree: String,
    file: String,
    old_path: Option<String>,
    base: Option<String>,
) -> Result<FileSides, String> {
    tauri::async_runtime::spawn_blocking(move || sides_against(&worktree, &file, old_path.as_deref(), base.as_deref()))
        .await
        .map_err(|e| e.to_string())?
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

    #[test]
    fn parses_status_with_a_rename() {
        let raw = b" M edit.txt\0R  new.txt\0old.txt\0?? dir/n w.txt\0D  gone.txt\0";
        let got = parse_status(raw);
        assert_eq!(got.len(), 4);
        assert_eq!(got[0], StatusEntry { x: ' ', y: 'M', path: "edit.txt".into(), from: None });
        assert_eq!(got[1], StatusEntry { x: 'R', y: ' ', path: "new.txt".into(), from: Some("old.txt".into()) });
        assert_eq!(got[2].path, "dir/n w.txt");
        assert_eq!((got[3].x, got[3].y), ('D', ' '));
    }

    #[test]
    fn status_words_read_against_head() {
        assert_eq!(status_word('?', '?'), Some("untracked"));
        assert_eq!(status_word(' ', 'M'), Some("modified"));
        assert_eq!(status_word('M', 'M'), Some("modified"));
        assert_eq!(status_word('A', ' '), Some("added"));
        assert_eq!(status_word('A', 'M'), Some("added"));
        assert_eq!(status_word('A', 'D'), None);
        assert_eq!(status_word(' ', 'D'), Some("deleted"));
        assert_eq!(status_word('D', ' '), Some("deleted"));
        assert_eq!(status_word('R', 'M'), Some("renamed"));
        assert_eq!(status_word('U', 'U'), Some("conflicted"));
    }

    #[test]
    fn parses_numstat_with_binary_and_rename() {
        let raw = b"3\t1\tedit.txt\0-\t-\tlogo.png\0" as &[u8];
        let rename = b"0\t0\t\0old.txt\0new.txt\0" as &[u8];
        let got = parse_numstat(&[raw, rename].concat());
        assert_eq!(got[0], Numstat { added: Some(3), removed: Some(1), path: "edit.txt".into() });
        assert_eq!(got[1], Numstat { added: None, removed: None, path: "logo.png".into() });
        assert_eq!(got[2], Numstat { added: Some(0), removed: Some(0), path: "new.txt".into() });
    }

    #[test]
    fn lists_every_kind_of_change_with_counts() {
        let root = repo("wtdiff-list");
        std::fs::write(root.join("edit.txt"), "one\n2\nthree\n").unwrap();
        std::fs::remove_file(root.join("gone.txt")).unwrap();
        sh_git(&["mv", "old.txt", "new.txt"], &root);
        std::fs::create_dir_all(root.join("sub")).unwrap();
        std::fs::write(root.join("sub/fresh.txt"), "a\nb\nc").unwrap();
        std::fs::write(root.join("blob.bin"), [0u8, 1, 2, 0]).unwrap();

        let list = changes(&s(&root.join("sub"))).unwrap();
        assert_eq!(Path::new(&list.root).canonicalize().unwrap(), root.canonicalize().unwrap());
        let by = |p: &str| list.files.iter().find(|f| f.path == p).unwrap_or_else(|| panic!("{p} listed: {:?}", list.files));
        assert_eq!(by("edit.txt").status, "modified");
        assert_eq!((by("edit.txt").additions, by("edit.txt").deletions), (Some(2), Some(1)));
        assert_eq!(by("gone.txt").status, "deleted");
        assert_eq!(by("gone.txt").deletions, Some(1));
        assert_eq!(by("new.txt").status, "renamed");
        assert_eq!(by("new.txt").old_path.as_deref(), Some("old.txt"));
        assert_eq!(by("sub/fresh.txt").status, "untracked");
        assert_eq!((by("sub/fresh.txt").additions, by("sub/fresh.txt").deletions), (Some(3), Some(0)));
        assert!(by("blob.bin").binary);
        assert!(list.files.iter().all(|f| f.path != "keep.txt"));
        assert!(!list.truncated);
    }

    #[test]
    fn a_clean_tree_lists_nothing() {
        let root = repo("wtdiff-clean");
        assert!(changes(&s(&root)).unwrap().files.is_empty());
    }

    #[test]
    fn a_repo_with_no_commit_lists_everything_as_new() {
        let root = temp_dir("wtdiff-nohead").join("repo");
        std::fs::create_dir_all(&root).unwrap();
        sh_git(&["init", "-q", "-b", "main"], &root);
        std::fs::write(root.join("a.txt"), "x\n").unwrap();
        std::fs::write(root.join("b.txt"), "y\n").unwrap();
        sh_git(&["add", "b.txt"], &root);
        let list = changes(&s(&root)).unwrap();
        let words: Vec<_> = list.files.iter().map(|f| (f.path.as_str(), f.status.as_str())).collect();
        assert!(words.contains(&("a.txt", "untracked")), "{words:?}");
        assert!(words.contains(&("b.txt", "added")), "{words:?}");
        let b = sides(&s(&root), "b.txt", None).unwrap();
        assert_eq!((b.original.as_str(), b.modified.as_str()), ("", "y\n"));
    }

    #[test]
    fn reads_both_sides_of_a_file() {
        let root = repo("wtdiff-sides");
        std::fs::write(root.join("edit.txt"), "one\n2\n").unwrap();
        std::fs::remove_file(root.join("gone.txt")).unwrap();
        std::fs::write(root.join("fresh.txt"), "new\n").unwrap();
        sh_git(&["mv", "old.txt", "new.txt"], &root);
        std::fs::write(root.join("new.txt"), "moved\nalong\nfurther\n").unwrap();

        let edit = sides(&s(&root), "edit.txt", None).unwrap();
        assert_eq!((edit.original.as_str(), edit.modified.as_str()), ("one\ntwo\n", "one\n2\n"));
        let gone = sides(&s(&root), "gone.txt", None).unwrap();
        assert_eq!((gone.original.as_str(), gone.modified.as_str()), ("bye\n", ""));
        let fresh = sides(&s(&root), "fresh.txt", None).unwrap();
        assert_eq!((fresh.original.as_str(), fresh.modified.as_str()), ("", "new\n"));
        let moved = sides(&s(&root), "new.txt", Some("old.txt")).unwrap();
        assert_eq!(moved.original, "moved\nalong\n");
        assert_eq!(moved.modified, "moved\nalong\nfurther\n");
    }

    #[test]
    fn binary_and_huge_sides_come_back_empty() {
        let root = repo("wtdiff-big");
        std::fs::write(root.join("edit.txt"), [b'a', 0, b'b']).unwrap();
        let bin = sides(&s(&root), "edit.txt", None).unwrap();
        assert!(bin.binary);
        assert_eq!((bin.original.as_str(), bin.modified.as_str()), ("", ""));
        std::fs::write(root.join("huge.txt"), "x".repeat(MAX_SIDE_BYTES + 1)).unwrap();
        let huge = sides(&s(&root), "huge.txt", None).unwrap();
        assert!(huge.too_large);
        assert!(huge.modified.is_empty());
    }

    #[test]
    fn refuses_a_path_outside_the_tree() {
        let root = repo("wtdiff-escape");
        for bad in ["../etc/passwd", "/etc/passwd", "a/../../b", ""] {
            assert!(sides(&s(&root), bad, None).is_err(), "{bad} refused");
        }
        assert!(sides(&s(&root), "edit.txt", Some("../x")).is_err());
        assert!(safe_relative("dir/./f.txt").is_ok());
    }

    #[test]
    fn a_folder_that_is_no_repo_is_an_error() {
        let dir = temp_dir("wtdiff-norepo");
        assert!(changes(&s(&dir)).is_err());
    }

    /// A repo on `main` with a child branch that committed one edit, one add and one delete, then
    /// left an uncommitted edit and an untracked file.
    fn child_repo(tag: &str) -> PathBuf {
        let root = repo(tag);
        // Windows runners check files out with CRLF (`core.autocrlf=true`): switching back to the
        // child's branch below would rewrite its files as `…\r\n`.
        sh_git(&["config", "core.autocrlf", "false"], &root);
        sh_git(&["checkout", "-q", "-b", "feat/x/child"], &root);
        std::fs::write(root.join("edit.txt"), "one\ntwo\nthree\n").unwrap();
        std::fs::write(root.join("added.txt"), "a\n").unwrap();
        std::fs::remove_file(root.join("gone.txt")).unwrap();
        sh_git(&["add", "-A"], &root);
        sh_git(&["commit", "-q", "-m", "child work"], &root);
        // The base moves on after the cut: its own change is not the child's.
        sh_git(&["checkout", "-q", "main"], &root);
        std::fs::write(root.join("keep.txt"), "main moved\n").unwrap();
        sh_git(&["commit", "-qam", "main moves"], &root);
        sh_git(&["checkout", "-q", "feat/x/child"], &root);
        std::fs::write(root.join("added.txt"), "a\nb\n").unwrap();
        std::fs::write(root.join("loose.txt"), "x\ny\n").unwrap();
        root
    }

    #[test]
    fn a_child_diff_covers_its_commits_and_its_uncommitted_work() {
        let root = child_repo("wtdiff-child");
        for base in [Some(""), Some("main")] {
            let list = changes_against(&s(&root), base).unwrap();
            let by = |p: &str| list.files.iter().find(|f| f.path == p).unwrap_or_else(|| panic!("{p} listed: {:?}", list.files));
            assert_eq!(by("edit.txt").status, "modified");
            assert_eq!(by("edit.txt").additions, Some(1));
            assert_eq!(by("added.txt").status, "added");
            assert_eq!(by("added.txt").additions, Some(2));
            assert_eq!(by("gone.txt").status, "deleted");
            assert_eq!(by("loose.txt").status, "untracked");
            assert!(list.files.iter().all(|f| f.path != "keep.txt"), "the base's own moves are not the child's");
            assert!(list.base.as_deref().is_some_and(|b| b.starts_with("main @ ")), "{:?}", list.base);
        }
        // Against HEAD the same tree shows only the uncommitted work.
        let head = changes(&s(&root)).unwrap();
        assert!(head.files.iter().all(|f| f.path != "edit.txt"));
        assert!(head.base.is_none());
    }

    #[test]
    fn a_child_diffs_read_the_merge_base_side() {
        let root = child_repo("wtdiff-child-sides");
        let edit = sides_against(&s(&root), "edit.txt", None, Some("")).unwrap();
        assert_eq!((edit.original.as_str(), edit.modified.as_str()), ("one\ntwo\n", "one\ntwo\nthree\n"));
        let gone = sides_against(&s(&root), "gone.txt", None, Some("")).unwrap();
        assert_eq!((gone.original.as_str(), gone.modified.as_str()), ("bye\n", ""));
        let keep = sides_against(&s(&root), "keep.txt", None, Some("")).unwrap();
        assert_eq!(keep.original, "same\n");
    }

    #[test]
    fn a_renamed_file_is_one_entry_against_the_base() {
        let root = repo("wtdiff-child-rename");
        sh_git(&["checkout", "-q", "-b", "feat/x/child"], &root);
        sh_git(&["mv", "old.txt", "new.txt"], &root);
        sh_git(&["commit", "-qm", "rename"], &root);
        let list = changes_against(&s(&root), Some("")).unwrap();
        assert_eq!(list.files.len(), 1, "{:?}", list.files);
        assert_eq!(list.files[0].status, "renamed");
        assert_eq!(list.files[0].old_path.as_deref(), Some("old.txt"));
        let side = sides_against(&s(&root), "new.txt", Some("old.txt"), Some("")).unwrap();
        assert_eq!(side.original, "moved\nalong\n");
    }

    #[test]
    fn on_the_default_branch_or_with_none_the_diff_is_the_uncommitted_work() {
        let root = repo("wtdiff-child-main");
        std::fs::write(root.join("edit.txt"), "changed\n").unwrap();
        let list = changes_against(&s(&root), Some("")).unwrap();
        assert_eq!(list.files.len(), 1);
        // No default branch to find (a repo whose only branch is another name).
        sh_git(&["branch", "-m", "trunk"], &root);
        let list = changes_against(&s(&root), Some("")).unwrap();
        assert_eq!(list.files.len(), 1);
        assert!(list.base.is_none());
    }

    #[test]
    fn an_unknown_base_is_an_error() {
        let root = repo("wtdiff-child-bad");
        assert!(changes_against(&s(&root), Some("no-such-branch")).is_err());
    }
}

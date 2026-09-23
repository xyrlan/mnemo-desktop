//! The PR view's native reading: one PR's files and hunks, from `gh pr diff` and
//! `gh pr view --json`, both run from the repo root. The unified diff is parsed here, so the
//! front only draws lines.
//!
//! A child's PR runs to a few hundred lines, but nothing stops one from touching a lock file
//! or a minified bundle. What crosses to the front is bounded: at most `MAX_LINES` diff lines
//! in all, each cut at `MAX_LINE_CHARS` characters. GitHub itself refuses a diff past 20 000
//! lines (`gh pr diff` fails with the reason); then the file list still comes from
//! `gh pr view`, with the reason in `diff_error`, and the webview is one click away.

use std::path::Path;

use serde::Serialize;

use crate::home::lens::{GhRun, GH_MISSING};
use crate::mission::{login_path, may_probe};

/// Diff lines sent to the front, over every file. GitHub's own ceiling for a PR diff.
pub const MAX_LINES: usize = 20_000;
/// Characters kept of one diff line; a minified bundle is one line of hundreds of kilobytes.
pub const MAX_LINE_CHARS: usize = 1_000;

const VIEW_FIELDS: &str = "files,headRefName,baseRefName,state,isDraft";

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    /// A context line, in both sides.
    Ctx,
    Add,
    Del,
    /// `\ No newline at end of file`, about the line before it.
    Note,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Line {
    pub kind: Kind,
    /// Line number on the base side; none for an added line or a note.
    pub old: Option<u32>,
    /// Line number on the head side; none for a deleted line or a note.
    pub new: Option<u32>,
    pub text: String,
    /// The text was cut at `MAX_LINE_CHARS`.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub cut: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Hunk {
    /// The whole `@@ -a,b +c,d @@ fn …` line.
    pub header: String,
    pub lines: Vec<Line>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct FileDiff {
    /// The head side's path; the base side's for a deleted file.
    pub path: String,
    /// The base side's path when the file was renamed.
    pub old_path: Option<String>,
    /// added | deleted | renamed | modified
    pub status: String,
    pub additions: u32,
    pub deletions: u32,
    pub binary: bool,
    pub hunks: Vec<Hunk>,
    /// Diff lines this file has, counted before any was dropped for `MAX_LINES`.
    pub lines: u32,
    /// Some of its lines were dropped for `MAX_LINES`.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
pub struct Review {
    pub head: String,
    pub base: String,
    /// `gh`'s own `state` (OPEN, CLOSED, MERGED): the shape the cockpit's PRs carry.
    pub state: String,
    pub draft: bool,
    pub files: Vec<FileDiff>,
    /// Why there are no hunks: `gh pr diff` failed, and `files` came from `gh pr view`.
    pub diff_error: Option<String>,
    /// Lines were dropped past `MAX_LINES`.
    pub truncated: bool,
}

// ------------------------------------------------------------- parsing --

/// `"a/x y"` → `a/x y`: git quotes a path with unusual characters, C-style.
fn unquote(p: &str) -> String {
    let p = p.trim_end_matches('\t');
    let Some(inner) = p.strip_prefix('"').and_then(|s| s.strip_suffix('"')) else { return p.to_string() };
    let mut out = Vec::new();
    let mut bytes = inner.bytes().peekable();
    while let Some(b) = bytes.next() {
        if b != b'\\' {
            out.push(b);
            continue;
        }
        match bytes.next() {
            Some(b'n') => out.push(b'\n'),
            Some(b't') => out.push(b'\t'),
            Some(d @ b'0'..=b'7') => {
                // Up to three octal digits: a UTF-8 byte.
                let mut v = (d - b'0') as u32;
                for _ in 0..2 {
                    match bytes.peek() {
                        Some(&n @ b'0'..=b'7') => {
                            v = v * 8 + (n - b'0') as u32;
                            bytes.next();
                        }
                        _ => break,
                    }
                }
                out.push(v as u8);
            }
            Some(c) => out.push(c),
            None => {}
        }
    }
    String::from_utf8_lossy(&out).to_string()
}

/// A side's path from a `---`/`+++` line: none for `/dev/null`.
fn side_path(rest: &str, prefix: &str) -> Option<String> {
    let p = unquote(rest.trim_end());
    if p == "/dev/null" {
        return None;
    }
    Some(p.strip_prefix(prefix).map(str::to_string).unwrap_or(p))
}

/// The path of `diff --git a/P b/P` when both sides agree — the only case where the header
/// alone is unambiguous, and the one that matters: a binary or mode-only change has no
/// `---`/`+++` lines. A rename names its paths on `rename from`/`rename to`.
fn header_path(rest: &str) -> Option<String> {
    if rest.starts_with('"') {
        let end = rest[1..].find("\" ")? + 1;
        return side_path(&rest[..=end], "a/");
    }
    let n = rest.len().checked_sub(1)? / 2;
    let (a, b) = (rest.get(..n)?, rest.get(n + 1..)?);
    (a.strip_prefix("a/")? == b.strip_prefix("b/")?).then(|| a[2..].to_string())
}

/// `@@ -12,7 +12,8 @@` → (12, 12).
fn hunk_starts(header: &str) -> Option<(u32, u32)> {
    let mut parts = header.split_whitespace().skip(1);
    let start = |s: Option<&str>, sign: char| -> Option<u32> { s?.strip_prefix(sign)?.split(',').next()?.parse().ok() };
    Some((start(parts.next(), '-')?, start(parts.next(), '+')?))
}

fn cut(text: &str) -> (String, bool) {
    match text.char_indices().nth(MAX_LINE_CHARS) {
        Some((i, _)) => (text[..i].to_string(), true),
        None => (text.to_string(), false),
    }
}

/// The unified diff `gh pr diff` prints, as files and hunks, with every line numbered on the
/// side it belongs to. Keeps at most `budget` lines in all; the files past it still list
/// their counts, without hunks, marked `truncated`. The flag is whether any line was dropped.
pub fn parse_diff(diff: &str, budget: usize) -> (Vec<FileDiff>, bool) {
    let mut files: Vec<FileDiff> = Vec::new();
    let mut left = budget;
    let mut dropped = false;
    // Line numbers inside the current hunk; none before the first `@@` of a file.
    let mut at: Option<(u32, u32)> = None;
    for raw in diff.split('\n') {
        let line = raw.strip_suffix('\r').unwrap_or(raw);
        if let Some(rest) = line.strip_prefix("diff --git ") {
            let path = header_path(rest).unwrap_or_default();
            files.push(FileDiff {
                path,
                old_path: None,
                status: "modified".into(),
                additions: 0,
                deletions: 0,
                binary: false,
                hunks: Vec::new(),
                lines: 0,
                truncated: false,
            });
            at = None;
            continue;
        }
        let Some(f) = files.last_mut() else { continue };
        if at.is_none() {
            // The file's header lines, before its first hunk.
            if line.starts_with("new file mode") {
                f.status = "added".into();
            } else if line.starts_with("deleted file mode") {
                f.status = "deleted".into();
            } else if let Some(p) = line.strip_prefix("rename from ") {
                f.old_path = Some(unquote(p));
                f.status = "renamed".into();
            } else if let Some(p) = line.strip_prefix("rename to ") {
                f.path = unquote(p);
                f.status = "renamed".into();
            } else if line.starts_with("Binary files ") || line == "GIT binary patch" {
                f.binary = true;
            } else if let Some(p) = line.strip_prefix("--- ") {
                if let (Some(p), true) = (side_path(p, "a/"), f.path.is_empty()) {
                    f.path = p;
                }
            } else if let Some(p) = line.strip_prefix("+++ ") {
                if let Some(p) = side_path(p, "b/") {
                    f.path = p;
                }
            }
        }
        if line.starts_with("@@ ") {
            let Some(starts) = hunk_starts(line) else { continue };
            at = Some(starts);
            f.hunks.push(Hunk { header: line.to_string(), lines: Vec::new() });
            continue;
        }
        let Some((old, new)) = at.as_mut() else { continue };
        let (kind, text) = match line.as_bytes().first() {
            Some(b' ') => (Kind::Ctx, &line[1..]),
            Some(b'+') => (Kind::Add, &line[1..]),
            Some(b'-') => (Kind::Del, &line[1..]),
            Some(b'\\') => (Kind::Note, line.trim_start_matches('\\').trim_start()),
            // The diff's trailing newline, or anything git does not put in a hunk.
            _ => continue,
        };
        let (num_old, num_new) = match kind {
            Kind::Ctx => {
                let n = (Some(*old), Some(*new));
                *old += 1;
                *new += 1;
                n
            }
            Kind::Add => {
                f.additions += 1;
                let n = (None, Some(*new));
                *new += 1;
                n
            }
            Kind::Del => {
                f.deletions += 1;
                let n = (Some(*old), None);
                *old += 1;
                n
            }
            Kind::Note => (None, None),
        };
        f.lines += 1;
        if left == 0 {
            f.truncated = true;
            dropped = true;
            continue;
        }
        left -= 1;
        let (text, was_cut) = cut(text);
        if let Some(h) = f.hunks.last_mut() {
            h.lines.push(Line { kind, old: num_old, new: num_new, text, cut: was_cut });
        }
    }
    (files, dropped)
}

/// What `gh pr view --json VIEW_FIELDS` says: head, base, state, draft, and the file list
/// (path, additions, deletions, changeType when `gh` is recent enough to give it).
pub fn parse_view(json: &str) -> Result<Review, String> {
    let v: serde_json::Value = serde_json::from_str(json).map_err(|e| format!("pr view json: {e}"))?;
    let s = |k: &str| v.get(k).and_then(|x| x.as_str()).unwrap_or_default().to_string();
    let n = |f: &serde_json::Value, k: &str| f.get(k).and_then(|x| x.as_u64()).unwrap_or(0) as u32;
    let files = v
        .get("files")
        .and_then(|f| f.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|f| {
                    let path = f.get("path")?.as_str()?.to_string();
                    let status = match f.get("changeType").and_then(|c| c.as_str()) {
                        Some("ADDED") => "added",
                        Some("DELETED") => "deleted",
                        Some("RENAMED") => "renamed",
                        _ => "modified",
                    };
                    Some(FileDiff {
                        path,
                        old_path: None,
                        status: status.into(),
                        additions: n(f, "additions"),
                        deletions: n(f, "deletions"),
                        binary: false,
                        hunks: Vec::new(),
                        lines: 0,
                        truncated: false,
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(Review {
        head: s("headRefName"),
        base: s("baseRefName"),
        state: s("state"),
        draft: v.get("isDraft").and_then(|d| d.as_bool()).unwrap_or(false),
        files,
        diff_error: None,
        truncated: false,
    })
}

// ------------------------------------------------------------- running --

fn run_gh(args: &[&str], cwd: &Path) -> Result<String, String> {
    let out = crate::proc::command("gh")
        .args(args)
        .current_dir(cwd)
        .env("PATH", login_path())
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

/// PR `number` of the repo at `root`: `gh pr view` and `gh pr diff` side by side. The view
/// failing is the whole read failing (no head, no files); the diff failing leaves the view's
/// file list, with the reason.
pub fn read_review(root: &str, number: u64, gh: GhRun) -> Result<Review, String> {
    let dir = Path::new(root);
    if !dir.is_dir() || !may_probe(root) {
        return Err(format!("{root}: repository not accessible"));
    }
    let n = number.to_string();
    let (view, diff) = std::thread::scope(|s| {
        let diff = s.spawn(|| gh(&["pr", "diff", &n, "--color", "never"], dir));
        let view = gh(&["pr", "view", &n, "--json", VIEW_FIELDS], dir);
        (view, diff.join().unwrap_or_else(|_| Err("gh pr diff panicked".into())))
    });
    let mut review = parse_view(&view?)?;
    match diff {
        Ok(text) => {
            let (files, dropped) = parse_diff(&text, MAX_LINES);
            review.files = files;
            review.truncated = dropped;
        }
        Err(e) => review.diff_error = Some(e),
    }
    Ok(review)
}

#[tauri::command]
pub async fn review_pr(root: String, number: u64) -> Result<Review, String> {
    tauri::async_runtime::spawn_blocking(move || read_review(&root, number, &run_gh))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    const DIFF: &str = "\
diff --git a/src/a.rs b/src/a.rs
index 98e4614..e310609 100644
--- a/src/a.rs
+++ b/src/a.rs
@@ -10,4 +10,5 @@ pub fn run() {
     one
-    two
+    deux
+    trois
     four
\\ No newline at end of file
diff --git a/new.txt b/new.txt
new file mode 100644
index 0000000..1111111
--- /dev/null
+++ b/new.txt
@@ -0,0 +1 @@
+hello
diff --git a/gone.txt b/gone.txt
deleted file mode 100644
index 1111111..0000000
--- a/gone.txt
+++ /dev/null
@@ -1 +0,0 @@
-bye
diff --git a/old name.md b/docs/new name.md
similarity index 90%
rename from old name.md
rename to docs/new name.md
index 1..2 100644
--- a/old name.md
+++ b/docs/new name.md
@@ -1,2 +1,2 @@
-x
+y
 z
diff --git a/logo.png b/logo.png
index 1..2 100644
Binary files a/logo.png and b/logo.png differ
diff --git \"a/caf\\303\\251.txt\" \"b/caf\\303\\251.txt\"
index 1..2 100644
--- \"a/caf\\303\\251.txt\"
+++ \"b/caf\\303\\251.txt\"
@@ -1 +1 @@
-a
+b
";

    #[test]
    fn a_diff_reads_as_files_hunks_and_numbered_lines() {
        let (files, dropped) = parse_diff(DIFF, MAX_LINES);
        assert!(!dropped);
        let paths: Vec<_> = files.iter().map(|f| (f.path.as_str(), f.status.as_str())).collect();
        assert_eq!(
            paths,
            [
                ("src/a.rs", "modified"),
                ("new.txt", "added"),
                ("gone.txt", "deleted"),
                ("docs/new name.md", "renamed"),
                ("logo.png", "modified"),
                ("café.txt", "modified"),
            ]
        );
        let a = &files[0];
        assert_eq!((a.additions, a.deletions, a.lines), (2, 1, 6));
        assert_eq!(a.hunks.len(), 1);
        assert_eq!(a.hunks[0].header, "@@ -10,4 +10,5 @@ pub fn run() {");
        let nums: Vec<_> = a.hunks[0].lines.iter().map(|l| (l.kind.clone(), l.old, l.new, l.text.as_str())).collect();
        assert_eq!(
            nums,
            [
                (Kind::Ctx, Some(10), Some(10), "    one"),
                (Kind::Del, Some(11), None, "    two"),
                (Kind::Add, None, Some(11), "    deux"),
                (Kind::Add, None, Some(12), "    trois"),
                (Kind::Ctx, Some(12), Some(13), "    four"),
                (Kind::Note, None, None, "No newline at end of file"),
            ]
        );
        assert_eq!(files[3].old_path.as_deref(), Some("old name.md"));
        assert!(files[4].binary && files[4].hunks.is_empty());
        assert_eq!(files[2].hunks[0].lines[0].old, Some(1));
    }

    #[test]
    fn the_budget_bounds_what_crosses_and_every_count_survives_it() {
        let (files, dropped) = parse_diff(DIFF, 3);
        assert!(dropped);
        assert_eq!(files[0].hunks[0].lines.len(), 3);
        assert!(files[0].truncated);
        // Counts are the file's own, not what was kept.
        assert_eq!((files[0].additions, files[0].deletions, files[0].lines), (2, 1, 6));
        assert!(files[1].truncated && files[1].hunks[0].lines.is_empty());
        assert_eq!(files[1].additions, 1);
    }

    #[test]
    fn a_minified_line_is_cut_not_sent_whole() {
        let long = "x".repeat(MAX_LINE_CHARS * 50);
        let diff = format!("diff --git a/b.js b/b.js\n--- a/b.js\n+++ b/b.js\n@@ -1 +1 @@\n-{long}\n+é{long}\n");
        let (files, _) = parse_diff(&diff, MAX_LINES);
        let lines = &files[0].hunks[0].lines;
        assert_eq!(lines[0].text.chars().count(), MAX_LINE_CHARS);
        assert!(lines[0].cut && lines[1].cut);
        assert!(lines[1].text.starts_with('é'));
    }

    #[test]
    fn view_json_gives_head_state_draft_and_files() {
        let json = r#"{"baseRefName":"main","headRefName":"feat/x","state":"OPEN","isDraft":true,
            "files":[{"path":"a.rs","additions":3,"deletions":1,"changeType":"ADDED"},{"path":"b.rs","additions":0,"deletions":2}]}"#;
        let r = parse_view(json).unwrap();
        assert_eq!((r.head.as_str(), r.base.as_str(), r.state.as_str(), r.draft), ("feat/x", "main", "OPEN", true));
        assert_eq!(r.files.len(), 2);
        assert_eq!((r.files[0].status.as_str(), r.files[0].additions), ("added", 3));
        assert_eq!((r.files[1].status.as_str(), r.files[1].deletions), ("modified", 2));
        assert!(parse_view("not json").is_err());
    }

    #[test]
    fn a_failed_diff_keeps_the_view_and_says_why_and_a_failed_view_fails() {
        let dir = std::env::temp_dir();
        let root = dir.to_str().unwrap();
        let calls = std::sync::Mutex::new(Vec::new());
        let view = r#"{"headRefName":"h","baseRefName":"main","state":"OPEN","isDraft":false,"files":[{"path":"big.lock","additions":30000,"deletions":0}]}"#;
        let gh = |args: &[&str], _: &Path| -> Result<String, String> {
            calls.lock().unwrap().push(args.join(" "));
            match args[1] {
                "view" => Ok(view.to_string()),
                _ => Err("could not find pull request diff: HTTP 406: diff exceeded the maximum number of lines (20000)".into()),
            }
        };
        let r = read_review(root, 7, &gh).unwrap();
        assert_eq!(r.head, "h");
        assert_eq!(r.files[0].path, "big.lock");
        assert!(r.diff_error.unwrap().contains("maximum number of lines"));
        let mut calls = calls.into_inner().unwrap();
        calls.sort();
        assert_eq!(calls, ["pr diff 7 --color never", format!("pr view 7 --json {VIEW_FIELDS}").as_str()]);

        let gone = |_: &[&str], _: &Path| -> Result<String, String> { Err(GH_MISSING.into()) };
        assert_eq!(read_review(root, 7, &gone).unwrap_err(), GH_MISSING);
        assert!(read_review("/no/such/dir", 7, &gone).unwrap_err().contains("not accessible"));
    }

    /// `cargo test review_live -- --ignored --nocapture`: this repo's PRs through the real `gh`,
    /// with each file's counts checked against what `gh pr view` says of it.
    #[test]
    #[ignore]
    fn review_live() {
        let root = env!("CARGO_MANIFEST_DIR").trim_end_matches("/src-tauri");
        let n: u64 = std::env::var("REVIEW_PR").ok().and_then(|s| s.parse().ok()).unwrap_or(146);
        let t = std::time::Instant::now();
        let r = read_review(root, n, &run_gh).unwrap();
        let view = parse_view(&run_gh(&["pr", "view", &n.to_string(), "--json", VIEW_FIELDS], Path::new(root)).unwrap()).unwrap();
        println!("#{n} {} <- {} {} draft={} in {:?}", r.base, r.head, r.state, r.draft, t.elapsed());
        assert!(r.diff_error.is_none(), "{:?}", r.diff_error);
        for f in &r.files {
            let v = view.files.iter().find(|v| v.path == f.path).unwrap_or_else(|| panic!("{} not in gh pr view", f.path));
            println!("  {} {} +{} -{} lines={} hunks={}", f.status, f.path, f.additions, f.deletions, f.lines, f.hunks.len());
            if !f.binary {
                assert_eq!((f.additions, f.deletions), (v.additions, v.deletions), "{}", f.path);
            }
        }
        assert_eq!(r.files.len(), view.files.len());
    }
}

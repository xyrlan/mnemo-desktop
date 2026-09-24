//! Search across a worktree's files, for the right sidebar's Search panel.
//!
//! `git grep` walks the files: it honours `.gitignore` (tracked files and untracked ones that are
//! not ignored), skips binaries, and matches fixed strings, whole words and regular expressions
//! (Perl-compatible where git was built with PCRE, POSIX extended otherwise). The app carries no
//! regex or gitignore crate, and every worktree already needs git. A folder outside any repository
//! is searched with `--no-index`, still minus what a `.gitignore` in it names.
//!
//! This module bounds the search — at most `maxResults` matches and [`TIME_LIMIT`] of git, and a
//! newer search stops an older one — then reads each matched line so the panel gets its text and
//! the match's column in UTF-16 units, as the editor counts them.

use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc;
use std::time::{Duration, Instant};

/// How long git may search before the results so far are returned as they are.
pub const TIME_LIMIT: Duration = Duration::from_secs(8);
/// Matches returned when the panel does not say.
pub const DEFAULT_MAX_RESULTS: usize = 2000;
/// The most matches any search returns, whatever the panel asks for.
pub const MAX_RESULTS: usize = 10_000;
/// A matched line longer than this (UTF-16 units) is cut to a window around the match.
const MAX_LINE: usize = 300;
/// How much of a cut line is kept before the match.
const CUT_BEFORE: usize = 60;

#[derive(Deserialize, Debug, Clone, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct SearchOpts {
    pub case_sensitive: bool,
    pub whole_word: bool,
    pub use_regex: bool,
    /// Globs to search, comma separated: `*.ts, src/**`. Empty searches everything.
    pub include: String,
    /// Globs to leave out, comma separated: `*.min.js, dist/**`.
    pub exclude: String,
    /// Defaults to [`DEFAULT_MAX_RESULTS`]; capped at [`MAX_RESULTS`].
    pub max_results: Option<usize>,
}

/// One match. `line` and `column` are 1-based; `column` and `matchLength` count UTF-16 units.
#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatch {
    pub line: u32,
    pub column: u32,
    pub match_length: u32,
    /// The matched line, cut around the match when it is long.
    pub line_content: String,
    /// Where the match sits in `lineContent` when the line was cut.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_column: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_match_length: Option<u32>,
}

#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SearchFileResult {
    /// Absolute.
    pub file_path: String,
    /// From the searched root, `/`-separated.
    pub relative_path: String,
    pub matches: Vec<SearchMatch>,
}

#[derive(Serialize, Debug, Clone, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub files: Vec<SearchFileResult>,
    pub total_matches: usize,
    /// More matches exist than were returned: the result limit or the time limit stopped git.
    pub truncated: bool,
    /// The time limit stopped git.
    pub timed_out: bool,
}

/// The pathspecs for the include and exclude globs. A glob with no `/` matches at any depth, a
/// leading `/` anchors it at the root, and a folder's glob also matches everything inside it.
pub fn pathspecs(include: &str, exclude: &str) -> Vec<String> {
    let mut out = Vec::new();
    for (list, magic) in [(include, "glob"), (exclude, "exclude,glob")] {
        for glob in split_globs(list) {
            for spec in glob_specs(&glob) {
                out.push(format!(":({magic}){spec}"));
            }
        }
    }
    out
}

/// `a, b/{c,d}` → `a`, `b/c`, `b/d`: split on commas outside braces, then expand the braces
/// (git's globs have none).
fn split_globs(list: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let (mut depth, mut start) = (0i32, 0usize);
    for (i, c) in list.char_indices() {
        match c {
            '{' => depth += 1,
            '}' => depth = (depth - 1).max(0),
            ',' if depth == 0 => {
                parts.push(&list[start..i]);
                start = i + 1;
            }
            _ => {}
        }
    }
    parts.push(&list[start..]);
    parts.into_iter().map(str::trim).filter(|p| !p.is_empty()).flat_map(expand_braces).collect()
}

fn expand_braces(glob: &str) -> Vec<String> {
    let Some(open) = glob.find('{') else { return vec![glob.to_string()] };
    let mut depth = 0;
    let mut close = None;
    for (i, c) in glob[open..].char_indices() {
        match c {
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    close = Some(open + i);
                    break;
                }
            }
            _ => {}
        }
    }
    let Some(close) = close else { return vec![glob.to_string()] };
    let (head, body, tail) = (&glob[..open], &glob[open + 1..close], &glob[close + 1..]);
    let mut alts = Vec::new();
    let (mut depth, mut start) = (0, 0);
    for (i, c) in body.char_indices() {
        match c {
            '{' => depth += 1,
            '}' => depth -= 1,
            ',' if depth == 0 => {
                alts.push(&body[start..i]);
                start = i + 1;
            }
            _ => {}
        }
    }
    alts.push(&body[start..]);
    alts.into_iter().flat_map(|alt| expand_braces(&format!("{head}{alt}{tail}"))).collect()
}

fn glob_specs(glob: &str) -> [String; 2] {
    let g = glob.trim_start_matches("./").trim_end_matches('/');
    let g = match g.strip_prefix('/') {
        Some(anchored) => anchored.to_string(),
        None if !g.contains('/') && !g.starts_with("**") => format!("**/{g}"),
        None => g.to_string(),
    };
    [format!("{g}/**"), g]
}

/// One `-o -z` line of `git grep`: path, line, byte column (all 1-based) and the matched text.
fn parse_record(rec: &[u8]) -> Option<(String, u32, usize, String)> {
    let mut it = rec.splitn(4, |b| *b == 0);
    let path = String::from_utf8_lossy(it.next()?).into_owned();
    let line = std::str::from_utf8(it.next()?).ok()?.parse().ok()?;
    let col = std::str::from_utf8(it.next()?).ok()?.parse().ok()?;
    let text = String::from_utf8_lossy(it.next()?).into_owned();
    Some((path, line, col, text))
}

type Record = (String, u32, usize, String);
/// A file's matches as git gave them: line, byte column, text.
type FileRecords = (String, Vec<(u32, usize, String)>);

enum Outcome {
    Done { records: Vec<Record>, truncated: bool, timed_out: bool },
    Failed(String),
}

fn in_repo(root: &Path) -> bool {
    crate::proc::command("git")
        .arg("-C")
        .arg(root)
        .args(["rev-parse", "--is-inside-work-tree"])
        .stderr(Stdio::null())
        .output()
        .map(|o| o.status.success() && o.stdout.starts_with(b"true"))
        .unwrap_or(false)
}

/// Runs one `git grep`, collecting at most `max + 1` records until `deadline`, or until
/// `superseded` says a newer search started.
fn grep(root: &Path, args: &[String], max: usize, deadline: Instant, superseded: &dyn Fn() -> bool) -> Result<Outcome, String> {
    let mut child = crate::proc::command("git")
        .arg("-C")
        .arg(root)
        // A user's `grep.fullName` would make paths relative to the repo instead of `root`.
        .args(["-c", "grep.fullName=false", "-c", "core.quotePath=off", "grep"])
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("could not run git: {e}"))?;
    let stdout = child.stdout.take().expect("piped stdout");
    let mut stderr = child.stderr.take().expect("piped stderr");
    let err_reader = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = stderr.read_to_string(&mut s);
        s
    });
    let (tx, rx) = mpsc::channel::<Record>();
    std::thread::spawn(move || {
        let mut out = BufReader::new(stdout);
        let mut buf = Vec::new();
        loop {
            buf.clear();
            match out.read_until(b'\n', &mut buf) {
                Ok(0) | Err(_) => break,
                Ok(_) => {}
            }
            if buf.last() == Some(&b'\n') {
                buf.pop();
            }
            if let Some(r) = parse_record(&buf) {
                if tx.send(r).is_err() {
                    break;
                }
            }
        }
    });

    let mut records = Vec::new();
    let (mut stopped, mut timed_out) = (false, false);
    loop {
        if superseded() {
            let _ = child.kill();
            let _ = child.wait();
            return Err("search superseded".into());
        }
        let now = Instant::now();
        if now >= deadline {
            timed_out = true;
            stopped = true;
            break;
        }
        match rx.recv_timeout((deadline - now).min(Duration::from_millis(50))) {
            Ok(r) => {
                records.push(r);
                if records.len() > max {
                    stopped = true;
                    break;
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
    if stopped {
        let _ = child.kill();
        let _ = child.wait();
        return Ok(Outcome::Done { truncated: true, timed_out, records });
    }
    let status = child.wait().map_err(|e| format!("git grep: {e}"))?;
    let err = err_reader.join().unwrap_or_default();
    // 1 is "nothing matched".
    if status.success() || status.code() == Some(1) {
        return Ok(Outcome::Done { records, truncated: false, timed_out: false });
    }
    let msg = err.lines().find(|l| !l.trim().is_empty()).unwrap_or("git grep failed");
    Ok(Outcome::Failed(msg.trim().trim_start_matches("fatal: ").to_string()))
}

/// Reads the lines `wanted` (1-based) of `path`, stopping at the last one; CR is dropped.
fn read_lines(path: &Path, wanted: &BTreeSet<u32>) -> std::collections::HashMap<u32, Vec<u8>> {
    let mut got = std::collections::HashMap::new();
    let Some(&last) = wanted.last() else { return got };
    let Ok(file) = std::fs::File::open(path) else { return got };
    let mut r = BufReader::new(file);
    let mut buf = Vec::new();
    for n in 1..=last {
        buf.clear();
        match r.read_until(b'\n', &mut buf) {
            Ok(0) | Err(_) => break,
            Ok(_) => {}
        }
        if wanted.contains(&n) {
            while matches!(buf.last(), Some(b'\n' | b'\r')) {
                buf.pop();
            }
            got.insert(n, std::mem::take(&mut buf));
        }
    }
    got
}

const fn is_word(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_'
}

/// Where each of a line's matches starts (a byte offset), from git's columns and matched texts.
///
/// `git grep -o --column` gets only a line's first column right: for every later match it prints
/// the first match's column plus where the previous match ends (git 2.54). A position is taken
/// only where the line holds that exact text: git's columns if they all fit (a git that reports
/// them right), else the first column, the previous match's end read back from the next
/// column, and last a search forward from the previous match — at word edges under `-w`.
fn place(line: &[u8], found: &[(usize, &str)], whole_word: bool) -> Vec<Option<usize>> {
    let fits = |at: usize, text: &str, from: usize| at >= from && line.get(at..at + text.len()) == Some(text.as_bytes());
    let mut end = 0;
    if found.iter().all(|&(col, text)| {
        let ok = col >= 1 && fits(col - 1, text, end);
        end = col.saturating_sub(1) + text.len();
        ok
    }) {
        return found.iter().map(|&(col, _)| Some(col - 1)).collect();
    }
    let first = found.first().map_or(0, |f| f.0);
    let at_edges = |at: usize, len: usize| !whole_word || ((at == 0 || !is_word(line[at - 1])) && line.get(at + len).map_or(true, |b| !is_word(*b)));
    let mut end = 0;
    let mut out = Vec::with_capacity(found.len());
    for (k, &(col, text)) in found.iter().enumerate() {
        let hinted = if k == 0 { col.checked_sub(1) } else { found.get(k + 1).and_then(|next| (next.0.checked_sub(first)?).checked_sub(text.len())) };
        let at = hinted.filter(|&at| fits(at, text, end)).or_else(|| {
            (end..=line.len().saturating_sub(text.len())).find(|&at| fits(at, text, end) && at_edges(at, text.len()))
        });
        if let Some(at) = at {
            end = at + text.len().max(1);
        }
        out.push(at);
    }
    out
}

/// The match on `line` starting at byte `at` with text `text`, in UTF-16 units, the line cut
/// around it when long. Without the line or the position (the file changed since git read it),
/// the match's own text stands in for the line.
fn build_match(line_no: u32, line: Option<&[u8]>, at: Option<usize>, text: &str) -> SearchMatch {
    let len16 = text.encode_utf16().count();
    let (units, col16): (Vec<u16>, usize) = match (line, at) {
        (Some(l), Some(at)) if at <= l.len() => {
            let before = String::from_utf8_lossy(&l[..at]).encode_utf16().count();
            (String::from_utf8_lossy(l).encode_utf16().collect(), before + 1)
        }
        _ => (text.encode_utf16().collect(), 1),
    };
    let mut m = SearchMatch {
        line: line_no,
        column: col16 as u32,
        match_length: len16 as u32,
        line_content: String::from_utf16_lossy(&units),
        display_column: None,
        display_match_length: None,
    };
    if units.len() > MAX_LINE {
        let at = col16 - 1;
        let start = at.saturating_sub(CUT_BEFORE).min(units.len());
        let end = (start + MAX_LINE).max(at + len16).min(units.len());
        m.line_content = String::from_utf16_lossy(&units[start..end]);
        m.display_column = Some((at - start + 1) as u32);
        m.display_match_length = Some(len16.min(end.saturating_sub(at)) as u32);
    }
    m
}

fn group(root: &Path, records: Vec<Record>, whole_word: bool) -> Vec<SearchFileResult> {
    let mut files: Vec<FileRecords> = Vec::new();
    for (path, line, col, text) in records {
        match files.last_mut() {
            Some((p, ms)) if *p == path => ms.push((line, col, text)),
            _ => files.push((path, vec![(line, col, text)])),
        }
    }
    files
        .into_iter()
        .map(|(rel, ms)| {
            let abs = root.join(&rel);
            let wanted = ms.iter().map(|m| m.0).collect();
            let lines = read_lines(&abs, &wanted);
            let mut matches = Vec::with_capacity(ms.len());
            for same_line in ms.chunk_by(|a, b| a.0 == b.0) {
                let n = same_line[0].0;
                let line = lines.get(&n).map(Vec::as_slice);
                let found: Vec<(usize, &str)> = same_line.iter().map(|m| (m.1, m.2.as_str())).collect();
                let at = line.map_or_else(|| vec![None; found.len()], |l| place(l, &found, whole_word));
                matches.extend(found.iter().zip(at).map(|(&(_, text), at)| build_match(n, line, at, text)));
            }
            SearchFileResult { file_path: abs.to_string_lossy().into_owned(), relative_path: rel, matches }
        })
        .collect()
}

/// Searches the files under `root` (which must lie inside `home`) for `query`.
pub fn search_in(root: &str, query: &str, opts: &SearchOpts, home: &Path, limit: Duration, superseded: &dyn Fn() -> bool) -> Result<SearchResult, String> {
    let deadline = Instant::now() + limit;
    let root: PathBuf = crate::fs::guard(root, home)?;
    if !root.is_dir() {
        return Err(format!("{} is not a folder", root.display()));
    }
    if query.is_empty() {
        return Ok(SearchResult::default());
    }
    let max = opts.max_results.unwrap_or(DEFAULT_MAX_RESULTS).clamp(1, MAX_RESULTS);

    let mut args: Vec<String> = ["--no-color", "-I", "-n", "--column", "-o", "-z"].map(String::from).to_vec();
    if in_repo(&root) {
        args.push("--untracked".into());
    } else {
        args.extend(["--no-index", "--exclude-standard"].map(String::from));
    }
    if !opts.case_sensitive {
        args.push("-i".into());
    }
    if opts.whole_word {
        args.push("-w".into());
    }
    let kind_at = args.len();
    args.push(if opts.use_regex { "-P" } else { "-F" }.into());
    args.extend(["-e".into(), query.to_string(), "--".into()]);
    args.extend(pathspecs(&opts.include, &opts.exclude));

    let mut outcome = grep(&root, &args, max, deadline, superseded)?;
    // A git built without PCRE: fall back to POSIX extended expressions.
    if let Outcome::Failed(msg) = &outcome {
        if opts.use_regex && (msg.contains("Perl-compatible") || msg.contains("PCRE")) {
            args[kind_at] = "-E".into();
            outcome = grep(&root, &args, max, deadline, superseded)?;
        }
    }
    match outcome {
        Outcome::Failed(msg) => Err(msg),
        Outcome::Done { mut records, truncated, timed_out } => {
            records.truncate(max);
            let files = group(&root, records, opts.whole_word);
            let total_matches = files.iter().map(|f| f.matches.len()).sum();
            Ok(SearchResult { files, total_matches, truncated, timed_out })
        }
    }
}

/// Bumped by every search; a search whose number is no longer the latest stops.
static LATEST: AtomicU64 = AtomicU64::new(0);

fn home() -> Result<PathBuf, String> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .ok_or_else(|| "cannot determine home directory".to_string())
}

#[tauri::command]
pub async fn search_worktree(root: String, query: String, opts: SearchOpts) -> Result<SearchResult, String> {
    let n = LATEST.fetch_add(1, Ordering::SeqCst) + 1;
    tauri::async_runtime::spawn_blocking(move || {
        search_in(&root, &query, &opts, &home()?, TIME_LIMIT, &|| LATEST.load(Ordering::SeqCst) != n)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::temp_dir;

    fn git(dir: &Path, args: &[&str]) {
        let out = crate::proc::command("git").arg("-C").arg(dir).args(args).output().unwrap();
        assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
    }

    fn write(dir: &Path, rel: &str, text: &str) {
        let p = dir.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, text).unwrap();
    }

    /// A repo with a tracked file, an untracked one, an ignored folder and a binary.
    fn repo() -> PathBuf {
        let d = temp_dir("search");
        git(&d, &["init", "-q"]);
        write(&d, ".gitignore", "build/\n");
        write(&d, "src/main.ts", "const foo = 1\nconst Foo = foo + food\n");
        write(&d, "src/deep/util.ts", "export function foo() {}\n");
        write(&d, "README.md", "# foo\n");
        write(&d, "build/out.js", "foo foo foo\n");
        std::fs::write(d.join("blob.bin"), b"foo\0\x01\x02").unwrap();
        git(&d, &["add", ".gitignore", "src/main.ts", "blob.bin"]);
        d
    }

    fn run(root: &Path, query: &str, opts: SearchOpts) -> Result<SearchResult, String> {
        search_in(root.to_str().unwrap(), query, &opts, root.parent().unwrap(), TIME_LIMIT, &|| false)
    }

    fn found(r: &SearchResult) -> Vec<(String, u32, u32)> {
        r.files.iter().flat_map(|f| f.matches.iter().map(|m| (f.relative_path.clone(), m.line, m.column))).collect()
    }

    #[test]
    fn finds_tracked_and_untracked_files_but_not_ignored_or_binary_ones() {
        let d = repo();
        let r = run(&d, "foo", SearchOpts { case_sensitive: true, ..Default::default() }).unwrap();
        assert_eq!(
            found(&r),
            vec![
                ("README.md".into(), 1, 3),
                ("src/deep/util.ts".into(), 1, 17),
                ("src/main.ts".into(), 1, 7),
                ("src/main.ts".into(), 2, 13),
                ("src/main.ts".into(), 2, 19),
            ]
        );
        assert_eq!(r.total_matches, 5);
        assert!(!r.truncated && !r.timed_out);
        let main = &r.files[2];
        assert_eq!(main.file_path, d.canonicalize().unwrap().join("src/main.ts").to_string_lossy());
        assert_eq!(main.matches[1].line_content, "const Foo = foo + food");
        assert_eq!(main.matches[1].match_length, 3);
    }

    #[test]
    fn case_whole_word_and_regex() {
        let d = repo();
        let any_case = run(&d, "FOO", SearchOpts::default()).unwrap();
        assert_eq!(any_case.total_matches, 6);
        let word = run(&d, "foo", SearchOpts { case_sensitive: true, whole_word: true, ..Default::default() }).unwrap();
        assert_eq!(word.total_matches, 4, "food is not the word foo: {:?}", found(&word));
        let re = run(&d, r"fo+d?\b", SearchOpts { use_regex: true, case_sensitive: true, include: "src/main.ts".into(), ..Default::default() }).unwrap();
        let texts: Vec<_> = re.files[0].matches.iter().map(|m| m.match_length).collect();
        assert_eq!(texts, vec![3, 3, 4]);
        // Without the regex switch the same text is taken literally.
        assert_eq!(run(&d, "fo+", SearchOpts::default()).unwrap().total_matches, 0);
    }

    #[test]
    fn a_bad_regex_is_an_error_with_gits_reason() {
        let d = repo();
        let err = run(&d, "(", SearchOpts { use_regex: true, ..Default::default() }).unwrap_err();
        assert!(!err.starts_with("fatal:") && !err.is_empty(), "{err}");
    }

    #[test]
    fn a_query_that_looks_like_an_option_is_searched_for() {
        let d = repo();
        write(&d, "flags.txt", "run with -n please\n");
        assert_eq!(found(&run(&d, "-n", SearchOpts::default()).unwrap()), vec![("flags.txt".into(), 1, 10)]);
    }

    #[test]
    fn include_and_exclude_globs() {
        let d = repo();
        let opts = |include: &str, exclude: &str| SearchOpts { include: include.into(), exclude: exclude.into(), ..Default::default() };
        let files = |r: SearchResult| r.files.into_iter().map(|f| f.relative_path).collect::<Vec<_>>();
        assert_eq!(files(run(&d, "foo", opts("*.ts", "")).unwrap()), vec!["src/deep/util.ts", "src/main.ts"]);
        assert_eq!(files(run(&d, "foo", opts("src/deep", "")).unwrap()), vec!["src/deep/util.ts"]);
        assert_eq!(files(run(&d, "foo", opts("", "deep, *.md")).unwrap()), vec!["src/main.ts"]);
        assert_eq!(files(run(&d, "foo", opts("*.{md,ts}", "src/main.ts")).unwrap()), vec!["README.md", "src/deep/util.ts"]);
        assert_eq!(files(run(&d, "foo", opts("/main.ts", "")).unwrap()), Vec::<String>::new());
    }

    #[test]
    fn pathspecs_from_globs() {
        assert_eq!(pathspecs("", " , "), Vec::<String>::new());
        assert_eq!(
            pathspecs("*.ts, ./src/", "dist/**"),
            vec![":(glob)**/*.ts/**", ":(glob)**/*.ts", ":(glob)**/src/**", ":(glob)**/src", ":(exclude,glob)dist/**/**", ":(exclude,glob)dist/**"]
        );
        assert_eq!(split_globs("a/{b,c{d,e}}.x, f"), vec!["a/b.x", "a/cd.x", "a/ce.x", "f"]);
        assert_eq!(split_globs("{unclosed,x"), vec!["{unclosed,x"]);
    }

    #[test]
    fn stops_at_the_result_limit() {
        let d = repo();
        write(&d, "many.txt", &"hit\n".repeat(50));
        let r = run(&d, "hit", SearchOpts { max_results: Some(10), ..Default::default() }).unwrap();
        assert_eq!(r.total_matches, 10);
        assert!(r.truncated && !r.timed_out);
        let all = run(&d, "hit", SearchOpts { max_results: Some(50), ..Default::default() }).unwrap();
        assert_eq!(all.total_matches, 50);
        assert!(!all.truncated);
    }

    #[test]
    fn stops_at_the_time_limit_and_when_superseded() {
        let d = repo();
        let r = search_in(d.to_str().unwrap(), "foo", &SearchOpts::default(), d.parent().unwrap(), Duration::ZERO, &|| false).unwrap();
        assert!(r.truncated && r.timed_out);
        assert_eq!(r.total_matches, 0);
        let err = search_in(d.to_str().unwrap(), "foo", &SearchOpts::default(), d.parent().unwrap(), TIME_LIMIT, &|| true).unwrap_err();
        assert_eq!(err, "search superseded");
    }

    #[test]
    fn columns_count_utf16_units_and_long_lines_are_cut() {
        let d = repo();
        write(&d, "wide.txt", "héllo 😀 foo\r\n");
        let m = &run(&d, "foo", SearchOpts { include: "wide.txt".into(), ..Default::default() }).unwrap().files[0].matches[0];
        assert_eq!((m.column, m.match_length), (10, 3));
        assert_eq!(m.line_content, "héllo 😀 foo");
        assert_eq!(m.display_column, None);

        write(&d, "long.txt", &format!("{}needle{}\n", "a".repeat(1000), "b".repeat(1000)));
        let m = &run(&d, "needle", SearchOpts::default()).unwrap().files[0].matches[0];
        assert_eq!(m.column, 1001);
        assert_eq!(m.line_content.encode_utf16().count(), MAX_LINE);
        let at = m.display_column.unwrap() as usize - 1;
        assert_eq!(&m.line_content[at..at + 6], "needle");
        assert_eq!(m.display_match_length, Some(6));
    }

    #[test]
    fn a_folder_outside_a_repo_still_honours_its_gitignore() {
        let d = temp_dir("search-plain");
        write(&d, ".gitignore", "skip.txt\n");
        write(&d, "keep.txt", "foo\n");
        write(&d, "skip.txt", "foo\n");
        let r = run(&d, "foo", SearchOpts::default()).unwrap();
        assert_eq!(found(&r), vec![("keep.txt".into(), 1, 1)]);
    }

    #[test]
    fn refuses_a_root_outside_home_and_answers_an_empty_query_with_nothing() {
        let d = repo();
        let elsewhere = temp_dir("search-home");
        let err = search_in(d.to_str().unwrap(), "foo", &SearchOpts::default(), &elsewhere, TIME_LIMIT, &|| false).unwrap_err();
        assert!(err.contains("outside the home directory"), "{err}");
        assert_eq!(run(&d, "", SearchOpts::default()).unwrap(), SearchResult::default());
    }

    #[test]
    fn a_line_that_changed_since_git_read_it_falls_back_to_the_match() {
        let m = build_match(3, None, Some(6), "foo");
        assert_eq!((m.line, m.column, m.match_length, m.line_content.as_str()), (3, 1, 3, "foo"));
    }

    #[test]
    fn places_later_matches_on_a_line_despite_gits_columns() {
        let line = b"const Foo = foo + food";
        // What git 2.54 prints for `-o --column -i -F foo`: 7, then 7+9, then 7+15.
        assert_eq!(place(line, &[(7, "Foo"), (16, "foo"), (22, "foo")], false), vec![Some(6), Some(12), Some(18)]);
        // A git that reports the columns right.
        assert_eq!(place(line, &[(7, "Foo"), (13, "foo"), (19, "foo")], false), vec![Some(6), Some(12), Some(18)]);
        // The last match has no next column to read back: a word search skips `food`.
        assert_eq!(place(b"foo food foo", &[(1, "foo"), (4, "foo")], true), vec![Some(0), Some(9)]);
        assert_eq!(place(b"foo food", &[(1, "foo"), (4, "foo")], false), vec![Some(0), Some(4)]);
        // A text the line no longer holds.
        assert_eq!(place(b"bar", &[(1, "foo")], false), vec![None]);
    }

    #[test]
    fn many_matches_on_one_line_through_git() {
        let d = repo();
        write(&d, "row.txt", "ab_ab ab-ab xab ab\n");
        let r = run(&d, "ab", SearchOpts { whole_word: true, case_sensitive: true, include: "row.txt".into(), ..Default::default() }).unwrap();
        assert_eq!(found(&r), vec![("row.txt".into(), 1, 7), ("row.txt".into(), 1, 10), ("row.txt".into(), 1, 17)]);
        let r = run(&d, "a.", SearchOpts { use_regex: true, include: "row.txt".into(), ..Default::default() }).unwrap();
        let cols: Vec<u32> = r.files[0].matches.iter().map(|m| m.column).collect();
        assert_eq!(cols, vec![1, 4, 7, 10, 14, 17]);
    }

    #[test]
    fn opts_arrive_in_camel_case_with_defaults() {
        let o: SearchOpts = serde_json::from_str(r#"{"caseSensitive":true,"include":"*.rs","maxResults":5}"#).unwrap();
        assert!(o.case_sensitive && !o.whole_word && !o.use_regex);
        assert_eq!((o.include.as_str(), o.max_results), ("*.rs", Some(5)));
        let r = SearchResult { files: vec![], total_matches: 0, truncated: true, timed_out: false };
        assert_eq!(serde_json::to_string(&r).unwrap(), r#"{"files":[],"totalMatches":0,"truncated":true,"timedOut":false}"#);
    }
}

//! Vault pane: the mnemo vault on disk, read-only, plus six `mnemo` subcommands.
//!
//! The vault root is whatever `mnemo status` names (`Vault: <path>`). Inside it,
//! pages are Markdown files with YAML frontmatter: an agent's own under
//! `bots/<agent>/memory/`, universal ones under `shared/<type>/`. Folders starting
//! with `_` (`_inbox`, `_archive`) hold staged or retired pages and are skipped.
//!
//! Reading is pure (`parse_frontmatter`, `parse_page`, `read_tree`, `page_at`),
//! `mnemo` is confined to `// -- io --`, and `vault_run` only ever runs an
//! allowlisted subcommand with checked arguments (`check_run`).

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;

/// Page types in the order the tree shows them; anything else follows, `untyped` last.
pub const TYPES: &[&str] = &["feedback", "project", "reference", "user"];
pub const UNTYPED: &str = "untyped";
/// Index files that sit beside pages without being one.
const NOT_PAGES: &[&str] = &["MEMORY.md", "README.md", "HOME.md", "INDEX.md"];
/// How deep under `memory/` or `shared/` pages are looked for (`shared/feedback/x.md` is 2).
const MAX_DEPTH: usize = 2;

// ---------------------------------------------------------------- model --

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
pub struct PageInfo {
    /// Absolute path of the file, what `vault_page` and the editor take.
    pub path: String,
    /// Frontmatter `slug`, else the file stem: what `mnemo disable-rule` takes.
    pub slug: String,
    /// Frontmatter `name`, else the slug.
    pub name: String,
    pub description: String,
    /// `metadata.type`, else `type`, else the folder when it is a type, else `untyped`.
    #[serde(rename = "type")]
    pub page_type: String,
    pub confidence: Option<String>,
    /// `topics`, else `tags` (top level or under `metadata`).
    pub topics: Vec<String>,
    /// File mtime, ms since the epoch.
    pub modified: Option<u64>,
    /// The Markdown after the frontmatter; the pane searches it.
    pub body: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Group {
    #[serde(rename = "type")]
    pub page_type: String,
    pub pages: Vec<PageInfo>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Agent {
    /// `shared`, or the `bots/<agent>` folder name (named after a repo).
    pub name: String,
    /// `shared`, `repo`, or `other` (test runs, worktrees, scratch dirs the tree folds away).
    pub kind: String,
    /// Absolute path of the folder holding the pages.
    pub dir: String,
    pub groups: Vec<Group>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Field {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
pub struct Page {
    #[serde(flatten)]
    pub info: PageInfo,
    pub runtime: Option<String>,
    /// Every frontmatter key in file order, nested ones as `metadata.type`, lists joined by `, `.
    pub frontmatter: Vec<Field>,
    /// Why the page could not be read; the other fields are empty then.
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
pub struct RunResult {
    pub stdout: String,
    pub stderr: String,
    /// Exit code; `None` when the command never ran (refused, not found) or died on a signal.
    pub code: Option<i32>,
}

// ---------------------------------------------------------- frontmatter --

#[derive(Debug, Clone, PartialEq)]
pub enum Yaml {
    Str(String),
    List(Vec<String>),
    Map(Vec<(String, Yaml)>),
}

/// `---\n<yaml>\n---\n<body>` → (yaml, body). None when the text has no frontmatter.
pub fn split_frontmatter(text: &str) -> Option<(String, String)> {
    let text = text.replace("\r\n", "\n");
    let rest = text.strip_prefix("---\n")?;
    if let Some(end) = rest.find("\n---\n") {
        return Some((rest[..end].to_string(), rest[end + 5..].to_string()));
    }
    if let Some(yaml) = rest.strip_suffix("\n---") {
        return Some((yaml.to_string(), String::new()));
    }
    // `---\n---\n`: empty frontmatter.
    rest.strip_prefix("---\n").map(|body| (String::new(), body.to_string()))
}

fn dequote(s: &str) -> String {
    let s = s.trim();
    if s.len() >= 2 && s.starts_with('\'') && s.ends_with('\'') {
        return s[1..s.len() - 1].replace("''", "'");
    }
    if s.len() >= 2 && s.starts_with('"') && s.ends_with('"') {
        return s[1..s.len() - 1].replace("\\\"", "\"").replace("\\\\", "\\");
    }
    s.to_string()
}

/// `[a, 'b c']` → `["a", "b c"]`.
fn inline_list(s: &str) -> Vec<String> {
    s.trim()[1..s.trim().len() - 1].split(',').map(dequote).filter(|x| !x.is_empty()).collect()
}

/// `key: value` or `key:`; a colon inside the value (`at: 2026-09-14T07:34`) is not a split.
fn split_key(line: &str) -> Option<(String, &str)> {
    let (k, v) = match line.find(": ") {
        Some(i) => (&line[..i], &line[i + 2..]),
        None => (line.strip_suffix(':')?, ""),
    };
    let k = dequote(k);
    (!k.is_empty()).then_some((k, v.trim()))
}

/// The YAML subset mnemo and Claude Code write: nested maps, block and inline lists of
/// scalars, quoted scalars (single-line or wrapped), and `|` / `>` block scalars. A list of
/// maps keeps each item's first line as a string.
pub fn parse_frontmatter(yaml: &str) -> Vec<(String, Yaml)> {
    let lines: Vec<(usize, &str)> = yaml
        .lines()
        .filter(|l| !l.trim().is_empty() && !l.trim_start().starts_with('#'))
        .map(|l| (l.len() - l.trim_start().len(), l.trim()))
        .collect();
    let mut i = 0;
    match block(&lines, &mut i, 0) {
        Yaml::Map(m) => m,
        _ => vec![],
    }
}

fn is_item(s: &str) -> bool {
    s == "-" || s.starts_with("- ")
}

fn block(lines: &[(usize, &str)], i: &mut usize, indent: usize) -> Yaml {
    if *i < lines.len() && is_item(lines[*i].1) {
        let mut items = Vec::new();
        while *i < lines.len() && lines[*i].0 == indent && is_item(lines[*i].1) {
            let item = dequote(lines[*i].1.trim_start_matches('-'));
            *i += 1;
            while *i < lines.len() && lines[*i].0 > indent {
                *i += 1;
            }
            if !item.is_empty() {
                items.push(item);
            }
        }
        return Yaml::List(items);
    }
    let mut map = Vec::new();
    while *i < lines.len() {
        let (ind, line) = lines[*i];
        if ind < indent {
            break;
        }
        *i += 1;
        if ind > indent || is_item(line) {
            continue;
        }
        let Some((key, value)) = split_key(line) else { continue };
        let deeper = |i: &usize| *i < lines.len() && lines[*i].0 > indent;
        let v = if value.is_empty() {
            if deeper(i) {
                block(lines, i, lines[*i].0)
            } else if *i < lines.len() && lines[*i].0 == indent && is_item(lines[*i].1) {
                // `tags:\n- a`: a list at the key's own indent.
                block(lines, i, indent)
            } else {
                Yaml::Str(String::new())
            }
        } else if matches!(value.chars().next(), Some('|') | Some('>')) && value.len() <= 2 {
            let mut parts = Vec::new();
            while deeper(i) {
                parts.push(lines[*i].1);
                *i += 1;
            }
            Yaml::Str(parts.join(if value.starts_with('|') { "\n" } else { " " }))
        } else if value.starts_with('[') && value.ends_with(']') {
            Yaml::List(inline_list(value))
        } else {
            // A wrapped scalar continues on deeper lines.
            let mut s = value.to_string();
            while deeper(i) {
                s.push(' ');
                s.push_str(lines[*i].1);
                *i += 1;
            }
            Yaml::Str(dequote(&s))
        };
        map.push((key, v));
    }
    Yaml::Map(map)
}

/// `metadata.type` style lookup.
pub fn lookup<'a>(fm: &'a [(String, Yaml)], path: &str) -> Option<&'a Yaml> {
    let (head, rest) = match path.split_once('.') {
        Some((h, r)) => (h, Some(r)),
        None => (path, None),
    };
    let v = fm.iter().find(|(k, _)| k == head).map(|(_, v)| v)?;
    match (rest, v) {
        (None, v) => Some(v),
        (Some(r), Yaml::Map(m)) => lookup(m, r),
        _ => None,
    }
}

fn scalar(fm: &[(String, Yaml)], paths: &[&str]) -> Option<String> {
    paths.iter().find_map(|p| match lookup(fm, p) {
        Some(Yaml::Str(s)) if !s.trim().is_empty() => Some(s.trim().to_string()),
        _ => None,
    })
}

fn list(fm: &[(String, Yaml)], paths: &[&str]) -> Vec<String> {
    paths
        .iter()
        .find_map(|p| match lookup(fm, p) {
            Some(Yaml::List(l)) if !l.is_empty() => Some(l.clone()),
            Some(Yaml::Str(s)) if !s.trim().is_empty() => {
                Some(s.split(',').map(|t| t.trim().to_string()).filter(|t| !t.is_empty()).collect())
            }
            _ => None,
        })
        .unwrap_or_default()
}

fn flatten(fm: &[(String, Yaml)], prefix: &str, out: &mut Vec<Field>) {
    for (k, v) in fm {
        let key = format!("{prefix}{k}");
        match v {
            Yaml::Str(s) => out.push(Field { key, value: s.clone() }),
            Yaml::List(l) => out.push(Field { key, value: l.join(", ") }),
            Yaml::Map(m) => flatten(m, &format!("{key}."), out),
        }
    }
}

// ---------------------------------------------------------------- pages --

/// A page from its file's text. `modified` is the caller's, since it needs the disk.
pub fn parse_page(path: &Path, text: &str, modified: Option<u64>) -> Page {
    let (fm, body) = match split_frontmatter(text) {
        Some((yaml, body)) => (parse_frontmatter(&yaml), body),
        None => (vec![], text.replace("\r\n", "\n")),
    };
    let stem = path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let folder = path.parent().and_then(|p| p.file_name()).map(|s| s.to_string_lossy().to_string());
    let slug = scalar(&fm, &["slug", "metadata.slug"]).unwrap_or(stem);
    let page_type = scalar(&fm, &["metadata.type", "type"])
        .or_else(|| folder.filter(|f| TYPES.contains(&f.as_str())))
        .unwrap_or_else(|| UNTYPED.to_string());
    let mut frontmatter = Vec::new();
    flatten(&fm, "", &mut frontmatter);
    Page {
        info: PageInfo {
            path: path.to_string_lossy().to_string(),
            name: scalar(&fm, &["name", "metadata.name"]).unwrap_or_else(|| slug.clone()),
            slug,
            description: scalar(&fm, &["description", "metadata.description"]).unwrap_or_default(),
            page_type,
            confidence: scalar(&fm, &["metadata.confidence", "confidence"]),
            topics: list(&fm, &["metadata.topics", "topics", "metadata.tags", "tags"]),
            modified,
            body: body.trim_start_matches('\n').to_string(),
        },
        runtime: scalar(&fm, &["metadata.runtime", "runtime"]),
        frontmatter,
        error: None,
    }
}

fn mtime_ms(path: &Path) -> Option<u64> {
    let t = std::fs::metadata(path).ok()?.modified().ok()?;
    Some(t.duration_since(std::time::UNIX_EPOCH).ok()?.as_millis() as u64)
}

fn read_page(path: &Path) -> Option<Page> {
    let text = std::fs::read_to_string(path).ok()?;
    Some(parse_page(path, &text, mtime_ms(path)))
}

/// Every page file under `dir`, sorted, `_`/`.` folders and index files skipped.
fn page_files(dir: &Path) -> Vec<PathBuf> {
    fn walk(dir: &Path, depth: usize, out: &mut Vec<PathBuf>) {
        let Ok(rd) = std::fs::read_dir(dir) else { return };
        let mut entries: Vec<PathBuf> = rd.flatten().map(|e| e.path()).collect();
        entries.sort();
        for p in entries {
            let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            if name.starts_with('_') || name.starts_with('.') {
                continue;
            }
            if p.is_dir() {
                if depth > 1 {
                    walk(&p, depth - 1, out);
                }
            } else if name.ends_with(".md") && !NOT_PAGES.contains(&name.as_str()) {
                out.push(p);
            }
        }
    }
    let mut out = Vec::new();
    walk(dir, MAX_DEPTH, &mut out);
    out
}

fn type_rank(t: &str) -> (usize, String) {
    match TYPES.iter().position(|x| *x == t) {
        Some(i) => (i, String::new()),
        None if t == UNTYPED => (TYPES.len() + 1, String::new()),
        None => (TYPES.len(), t.to_string()),
    }
}

/// Pages grouped by type in `TYPES` order, each group sorted by name.
pub fn group(pages: Vec<PageInfo>) -> Vec<Group> {
    let mut groups: Vec<Group> = Vec::new();
    for p in pages {
        match groups.iter_mut().find(|g| g.page_type == p.page_type) {
            Some(g) => g.pages.push(p),
            None => groups.push(Group { page_type: p.page_type.clone(), pages: vec![p] }),
        }
    }
    groups.sort_by_key(|g| type_rank(&g.page_type));
    for g in &mut groups {
        g.pages.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()).then(a.path.cmp(&b.path)));
    }
    groups
}

/// Agents that are not a project: pytest runs, worktrees, scratch and probe dirs.
pub fn is_noise(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    const EXACT: &[&str] = &["lean", "live", "live-full", "live-model", "tmp", "probe", "scratchpad"];
    const PREFIX: &[&str] = &["bg-", "tmp", "claude-", "test_"];
    const CONTAINS: &[&str] = &["-wt-", "pytest", "scratchpad", "probe", "--"];
    EXACT.contains(&n.as_str()) || PREFIX.iter().any(|p| n.starts_with(p)) || CONTAINS.iter().any(|c| n.contains(c))
}

/// `shared` first, then projects, then noise, each by name. Agents without pages are left out.
pub fn read_tree(root: &Path) -> Vec<Agent> {
    let agent = |name: String, kind: &str, dir: PathBuf| {
        let pages: Vec<PageInfo> = page_files(&dir).iter().filter_map(|f| read_page(f)).map(|p| p.info).collect();
        // Forward slashes everywhere: the front-end shows and joins these, and Windows accepts them.
        (!pages.is_empty()).then(|| Agent { name, kind: kind.to_string(), dir: dir.to_string_lossy().replace('\\', "/"), groups: group(pages) })
    };
    let mut out: Vec<Agent> = agent("shared".into(), "shared", root.join("shared")).into_iter().collect();
    let mut bots: Vec<PathBuf> = std::fs::read_dir(root.join("bots")).into_iter().flatten().flatten().map(|e| e.path()).collect();
    bots.sort();
    let mut others = Vec::new();
    for b in bots {
        let Some(name) = b.file_name().map(|n| n.to_string_lossy().to_string()) else { continue };
        if name.starts_with('.') || !b.join("memory").is_dir() {
            continue;
        }
        let noise = is_noise(&name);
        if let Some(a) = agent(name, if noise { "other" } else { "repo" }, b.join("memory")) {
            if noise { others.push(a) } else { out.push(a) }
        }
    }
    out.extend(others);
    out
}

/// A page by path, refused unless it is a `.md` file inside the vault.
pub fn page_at(root: &Path, path: &str) -> Page {
    let fail = |e: String| Page { info: PageInfo { path: path.to_string(), ..Default::default() }, error: Some(e), ..Default::default() };
    let (Ok(root), Ok(file)) = (root.canonicalize(), Path::new(path).canonicalize()) else {
        return fail(format!("{path}: no such page"));
    };
    if !file.starts_with(&root) || file.extension().map(|x| x != "md").unwrap_or(true) || !file.is_file() {
        return fail(format!("{path}: not a page in the vault ({})", root.display()));
    }
    match std::fs::read_to_string(&file) {
        // The path as asked, so the pane matches it against the tree's.
        Ok(text) => parse_page(Path::new(path), &text, mtime_ms(&file)),
        Err(e) => fail(format!("{path}: {e}")),
    }
}

// ------------------------------------------------------------ allowlist --

/// The subcommands the pane may run, and nothing else.
pub const ACTIONS: &[&str] = &["disable-rule", "why", "reverify", "rewrites", "learn", "status"];

/// A slug, rewrite key or session id: no flag, no traversal, no shell metacharacters.
fn is_word(s: &str) -> bool {
    !s.is_empty()
        && !s.starts_with('-')
        && !s.contains("..")
        && s.chars().all(|c| c.is_ascii_alphanumeric() || "-_.:/".contains(c))
}

/// Checks `args` against what `action` accepts. Err names the first thing refused.
pub fn check_run(action: &str, args: &[String]) -> Result<(), String> {
    if !ACTIONS.contains(&action) {
        return Err(format!("mnemo {action}: not an allowed action (allowed: {})", ACTIONS.join(", ")));
    }
    // flag → the check its value must pass, or None when it takes no value.
    type Check = Option<fn(&str) -> bool>;
    let flags: &[(&str, Check)] = match action {
        "disable-rule" => {
            return match args {
                [slug] if is_word(slug) => Ok(()),
                _ => Err(format!("mnemo disable-rule takes one slug, got {args:?}")),
            };
        }
        "why" => &[("--json", None), ("--all-projects", None), ("--limit", Some(|v| v.parse::<u32>().is_ok_and(|n| (1..=1000).contains(&n))))],
        "reverify" => &[("--json", None)],
        "rewrites" => &[("--apply-safe", None), ("--show", Some(is_word)), ("--accept", Some(is_word)), ("--reject", Some(is_word))],
        "learn" => &[("--dry-run", None), ("--session", Some(is_word))],
        "status" => &[("--scope", Some(|v| ["project", "global", "all"].contains(&v)))],
        _ => unreachable!(),
    };
    let mut it = args.iter();
    while let Some(a) = it.next() {
        let Some((_, check)) = flags.iter().find(|(f, _)| f == a) else {
            return Err(format!("mnemo {action}: argument {a:?} not allowed"));
        };
        if let Some(ok) = check {
            match it.next() {
                Some(v) if ok(v) => {}
                v => return Err(format!("mnemo {action} {a}: bad value {v:?}")),
            }
        }
    }
    Ok(())
}

/// Drops terminal escapes (`ESC [ … letter`) the CLI may print despite NO_COLOR.
pub fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c != '\u{1b}' {
            out.push(c);
            continue;
        }
        if chars.peek() == Some(&'[') {
            chars.next();
            for d in chars.by_ref() {
                if ('@'..='~').contains(&d) {
                    break;
                }
            }
        }
    }
    out
}

/// `Vault: /Users/x/mnemo  (exists)` → `/Users/x/mnemo`.
pub fn parse_status_root(text: &str) -> Option<PathBuf> {
    let text = strip_ansi(text);
    let line = text.lines().find_map(|l| l.trim().strip_prefix("Vault:"))?.trim();
    let path = match line.rsplit_once(" (") {
        Some((p, tail)) if tail.ends_with(')') => p.trim(),
        _ => line,
    };
    (!path.is_empty()).then(|| PathBuf::from(path))
}

// ------------------------------------------------------------------ io --

/// Runs `program <action> <args>` in `cwd` (home when empty) after `check_run`.
pub fn run_with(program: &str, path_env: &str, action: &str, args: &[String], cwd: &str) -> RunResult {
    let refuse = |stderr: String| RunResult { stderr, ..Default::default() };
    if let Err(e) = check_run(action, args) {
        return refuse(e);
    }
    let dir = match cwd.trim() {
        "" => std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("/")),
        d => PathBuf::from(d),
    };
    if !dir.is_dir() {
        return refuse(format!("{}: not a directory", dir.display()));
    }
    let out = Command::new(program)
        .arg(action)
        .args(args)
        .current_dir(&dir)
        .env("PATH", path_env)
        .env("NO_COLOR", "1")
        .stdin(std::process::Stdio::null())
        .output();
    match out {
        Ok(o) => RunResult {
            stdout: strip_ansi(&String::from_utf8_lossy(&o.stdout)),
            stderr: strip_ansi(&String::from_utf8_lossy(&o.stderr)),
            code: o.status.code(),
        },
        Err(e) => refuse(format!("{program}: {e}")),
    }
}

/// Only a root that exists is cached, so installing mnemo later is picked up.
static ROOT: std::sync::Mutex<Option<PathBuf>> = std::sync::Mutex::new(None);

/// The vault `mnemo status` names, else `~/mnemo` when it holds a `mnemo.config.json`.
pub fn vault_root() -> Option<PathBuf> {
    if let Some(r) = ROOT.lock().ok()?.clone() {
        return Some(r);
    }
    let status = run_with("mnemo", &crate::mission::login_path(), "status", &[], "");
    let found = parse_status_root(&status.stdout).filter(|p| p.is_dir()).or_else(|| {
        let home = PathBuf::from(std::env::var_os("HOME")?).join("mnemo");
        home.join("mnemo.config.json").is_file().then_some(home)
    })?;
    *ROOT.lock().ok()? = Some(found.clone());
    Some(found)
}

// ------------------------------------------------------------ commands --

#[tauri::command]
pub async fn vault_tree() -> Vec<Agent> {
    tauri::async_runtime::spawn_blocking(|| vault_root().map(|r| read_tree(&r)).unwrap_or_default()).await.unwrap_or_default()
}

#[tauri::command]
pub async fn vault_page(path: String) -> Page {
    tauri::async_runtime::spawn_blocking(move || match vault_root() {
        Some(root) => page_at(&root, &path),
        None => Page { error: Some("no mnemo vault found (`mnemo status` names none)".into()), ..Default::default() },
    })
    .await
    .unwrap_or_default()
}

#[tauri::command]
pub async fn vault_run(action: String, args: Vec<String>, cwd: String) -> RunResult {
    tauri::async_runtime::spawn_blocking(move || run_with("mnemo", &crate::mission::login_path(), &action, &args, &cwd))
        .await
        .unwrap_or_else(|e| RunResult { stderr: e.to_string(), ..Default::default() })
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/fixtures/vault");

    fn strs(a: &[&str]) -> Vec<String> {
        a.iter().map(|s| s.to_string()).collect()
    }

    fn names(g: &Group) -> Vec<&str> {
        g.pages.iter().map(|p| p.name.as_str()).collect()
    }

    // ---- frontmatter

    #[test]
    fn frontmatter_reads_nested_maps_block_and_inline_lists() {
        let yaml = "name: x\nmetadata:\n  type: project\n  topics:\n    - build\n    - 'work trees'\n  runtime: claude-code\ntags: [a, \"b\"]\n";
        let fm = parse_frontmatter(yaml);
        assert_eq!(lookup(&fm, "metadata.type"), Some(&Yaml::Str("project".into())));
        assert_eq!(lookup(&fm, "metadata.topics"), Some(&Yaml::List(strs(&["build", "work trees"]))));
        assert_eq!(lookup(&fm, "metadata.runtime"), Some(&Yaml::Str("claude-code".into())));
        assert_eq!(lookup(&fm, "tags"), Some(&Yaml::List(strs(&["a", "b"]))));
        assert_eq!(lookup(&fm, "name.type"), None);
    }

    #[test]
    fn frontmatter_scalars_keep_colons_quotes_and_wraps() {
        let yaml = "at: 2026-09-14T07:34:53\ndescription: 'the user''s: rule'\nlong: first half\n  second half\nlit: |\n  one\n  two\ntags:\n- same-indent\nevidence:\n  quote: roda: os testes\n";
        let fm = parse_frontmatter(yaml);
        let s = |k| scalar(&fm, &[k]);
        assert_eq!(s("at").as_deref(), Some("2026-09-14T07:34:53"));
        assert_eq!(s("description").as_deref(), Some("the user's: rule"));
        assert_eq!(s("long").as_deref(), Some("first half second half"));
        assert_eq!(s("lit").as_deref(), Some("one\ntwo"));
        assert_eq!(lookup(&fm, "tags"), Some(&Yaml::List(strs(&["same-indent"]))));
        assert_eq!(s("evidence.quote").as_deref(), Some("roda: os testes"));
    }

    #[test]
    fn split_frontmatter_handles_crlf_missing_and_empty() {
        assert_eq!(split_frontmatter("---\r\na: 1\r\n---\r\nbody\r\n"), Some(("a: 1".into(), "body\n".into())));
        assert_eq!(split_frontmatter("# no frontmatter\n"), None);
        assert_eq!(split_frontmatter("---\n---\nbody"), Some(("".into(), "body".into())));
        assert_eq!(split_frontmatter("---\na: 1\n---"), Some(("a: 1".into(), "".into())));
    }

    // ---- pages

    #[test]
    fn claude_code_page_reads_type_topics_and_runtime_under_metadata() {
        let p = page_at(Path::new(FIXTURE), &format!("{FIXTURE}/bots/mnemo-desktop/memory/no-silent-contract-changes.md"));
        assert_eq!(p.error, None);
        assert_eq!(p.info.slug, "no-silent-contract-changes");
        assert_eq!(p.info.name, "no-silent-contract-changes");
        assert_eq!(p.info.page_type, "feedback");
        assert_eq!(p.info.description, "A piece that cannot deliver a contract signature stops and says so");
        assert_eq!(p.info.topics, strs(&["process", "contracts"]));
        assert_eq!(p.runtime.as_deref(), Some("claude-code"));
        assert_eq!(p.info.confidence, None);
        assert!(p.info.modified.is_some());
        assert!(p.info.body.starts_with("Other pieces"), "{:?}", p.info.body);
        let keys: Vec<&str> = p.frontmatter.iter().map(|f| f.key.as_str()).collect();
        assert_eq!(keys, ["name", "description", "metadata.type", "metadata.runtime", "metadata.topics"]);
        assert_eq!(p.frontmatter[4].value, "process, contracts");
    }

    #[test]
    fn shared_page_reads_top_level_type_slug_confidence_and_tags() {
        let p = page_at(Path::new(FIXTURE), &format!("{FIXTURE}/shared/feedback/run-tests-before-commit.md"));
        assert_eq!(p.info.slug, "run-tests-before-commit");
        assert_eq!(p.info.name, "Run the full test suite before committing");
        assert_eq!(p.info.page_type, "feedback");
        assert_eq!(p.info.confidence.as_deref(), Some("verified"));
        assert_eq!(p.info.topics, strs(&["testing", "workflow"]));
        assert!(p.frontmatter.contains(&Field { key: "evidence.quote".into(), value: "roda os testes antes".into() }));
    }

    #[test]
    fn page_without_frontmatter_falls_back_to_file_and_folder() {
        let p = parse_page(Path::new("/v/shared/reference/plain-note.md"), "Just text.\n", None);
        assert_eq!((p.info.slug.as_str(), p.info.name.as_str(), p.info.page_type.as_str()), ("plain-note", "plain-note", "reference"));
        assert_eq!(p.info.body, "Just text.\n");
        let q = parse_page(Path::new("/v/bots/a/memory/x.md"), "---\nname: ''\nslug: \"\"\ndescription:\n---\nb", None);
        assert_eq!((q.info.slug.as_str(), q.info.name.as_str(), q.info.page_type.as_str()), ("x", "x", UNTYPED));
    }

    #[test]
    fn page_at_refuses_paths_outside_the_vault_and_non_pages() {
        let root = Path::new(FIXTURE);
        let outside = concat!(env!("CARGO_MANIFEST_DIR"), "/fixtures/contract.md");
        assert!(page_at(root, outside).error.is_some());
        assert!(page_at(root, &format!("{FIXTURE}/shared/../../contract.md")).error.is_some());
        assert!(page_at(root, &format!("{FIXTURE}/mnemo.config.json")).error.is_some());
        assert!(page_at(root, &format!("{FIXTURE}/shared/feedback/missing.md")).error.is_some());
        assert!(page_at(root, &format!("{FIXTURE}/shared")).error.is_some());
    }

    // ---- tree

    #[test]
    fn tree_orders_shared_then_repos_then_noise_and_groups_by_type() {
        let tree = read_tree(Path::new(FIXTURE));
        let agents: Vec<(&str, &str)> = tree.iter().map(|a| (a.name.as_str(), a.kind.as_str())).collect();
        assert_eq!(
            agents,
            [("shared", "shared"), ("mnemo-desktop", "repo"), ("bg-T-pytest-of-user-pytest-12-test-lean-child0-lean", "other")]
        );
        let desk = &tree[1];
        // `dir` is forward-slashed; the fixture path carries backslashes on Windows.
        assert_eq!(desk.dir, format!("{FIXTURE}/bots/mnemo-desktop/memory").replace('\\', "/"));
        let types: Vec<&str> = desk.groups.iter().map(|g| g.page_type.as_str()).collect();
        assert_eq!(types, ["feedback", "project"]);
        assert_eq!(names(&desk.groups[0]), ["no-silent-contract-changes"]);
        assert_eq!(names(&desk.groups[1]), ["shared-target-dir"]);
        assert_eq!(desk.groups[1].pages[0].topics, strs(&["build", "worktrees"]));
    }

    #[test]
    fn tree_skips_inbox_index_files_briefings_and_home() {
        let tree = read_tree(Path::new(FIXTURE));
        let paths: Vec<&str> = tree.iter().flat_map(|a| &a.groups).flat_map(|g| &g.pages).map(|p| p.path.as_str()).collect();
        assert_eq!(paths.len(), 4, "{paths:?}");
        for bad in ["_inbox", "MEMORY.md", "briefings", "HOME.md"] {
            assert!(!paths.iter().any(|p| p.contains(bad)), "{bad} listed: {paths:?}");
        }
        assert_eq!(tree[0].groups[0].pages[0].slug, "run-tests-before-commit");
    }

    #[test]
    fn group_orders_known_types_then_others_then_untyped_and_sorts_names() {
        let page = |name: &str, t: &str| PageInfo { name: name.into(), page_type: t.into(), path: format!("/{name}"), ..Default::default() };
        let groups = group(vec![page("b", UNTYPED), page("z", "user"), page("B", "feedback"), page("a", "feedback"), page("c", "zeta"), page("d", "alpha")]);
        let types: Vec<&str> = groups.iter().map(|g| g.page_type.as_str()).collect();
        assert_eq!(types, ["feedback", "user", "alpha", "zeta", UNTYPED]);
        assert_eq!(names(&groups[0]), ["a", "B"]);
    }

    #[test]
    fn noise_is_test_runs_worktrees_and_scratch_not_repos() {
        for n in ["bg-77p0-T-pytest-of-x", "mnemo-wt-158", "mnemo-desktop-wt-c-vault", "tmp.H06a3erqDC", "live-full", "lean", "claude-jobs-1f87-tmp-probe", "501--Users-x-scratchpad", "test_session_start0"] {
            assert!(is_noise(n), "{n} should be noise");
        }
        for n in ["mnemo", "mnemo-desktop", "clearframe-fase2", "saints-network", "public", "app"] {
            assert!(!is_noise(n), "{n} is a repo");
        }
    }

    #[test]
    fn empty_or_missing_vault_is_an_empty_tree() {
        assert!(read_tree(Path::new("/definitely/not/a/vault")).is_empty());
    }

    // ---- allowlist and running

    #[test]
    fn allowlist_accepts_the_six_actions_with_their_arguments() {
        let ok = |a: &str, args: &[&str]| check_run(a, &strs(args));
        assert_eq!(ok("disable-rule", &["run-tests-before-commit"]), Ok(()));
        assert_eq!(ok("why", &["--json", "--limit", "20", "--all-projects"]), Ok(()));
        assert_eq!(ok("reverify", &[]), Ok(()));
        assert_eq!(ok("reverify", &["--json"]), Ok(()));
        assert_eq!(ok("rewrites", &[]), Ok(()));
        assert_eq!(ok("rewrites", &["--show", "project/clubinho__sprints-github"]), Ok(()));
        assert_eq!(ok("rewrites", &["--apply-safe"]), Ok(()));
        assert_eq!(ok("learn", &[]), Ok(()));
        assert_eq!(ok("status", &["--scope", "project"]), Ok(()));
    }

    #[test]
    fn allowlist_refuses_other_commands_flags_and_bad_values() {
        let bad = |a: &str, args: &[&str]| assert!(check_run(a, &strs(args)).is_err(), "{a} {args:?} passed");
        bad("init", &[]);
        bad("uninstall", &[]);
        bad("dispatch", &["x"]);
        bad("status; rm -rf ~", &[]);
        bad("disable-rule", &[]);
        bad("disable-rule", &["a", "b"]);
        bad("disable-rule", &["--help"]);
        bad("disable-rule", &["$(touch x)"]);
        bad("why", &["--limit"]);
        bad("why", &["--limit", "0"]);
        bad("why", &["--limit", "abc"]);
        bad("reverify", &["--apply"]);
        bad("reverify", &["--undo", "run"]);
        bad("rewrites", &["--undo", "run"]);
        bad("rewrites", &["--show", "../../etc/passwd"]);
        bad("rewrites", &["--accept", "--apply-safe"]);
        bad("learn", &["--session"]);
        bad("status", &["--scope", "everything"]);
    }

    #[test]
    fn status_root_parses_mnemo_status_output() {
        let out = "\u{1b}[1mVault:\u{1b}[0m /Users/x/my vault  (exists)\nHooks: ok\n";
        assert_eq!(parse_status_root(out), Some(PathBuf::from("/Users/x/my vault")));
        assert_eq!(parse_status_root("Vault: /v\n"), Some(PathBuf::from("/v")));
        assert_eq!(parse_status_root("no vault configured\n"), None);
    }

    #[cfg(unix)]
    fn fake_mnemo(dir: &Path) -> String {
        use std::os::unix::fs::PermissionsExt;
        let bin = dir.join("mnemo");
        std::fs::write(&bin, "#!/bin/sh\necho \"ran $* in $(pwd)\"\necho oops >&2\nexit 3\n").unwrap();
        std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755)).unwrap();
        bin.to_string_lossy().to_string()
    }

    #[cfg(unix)]
    #[test]
    fn run_passes_allowed_args_in_cwd_and_returns_both_streams_and_code() {
        let dir = std::env::temp_dir().join(format!("mnemo-desktop-vault-run-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let bin = fake_mnemo(&dir);
        let cwd = dir.canonicalize().unwrap();
        let r = run_with(&bin, "/usr/bin:/bin", "why", &strs(&["--json"]), &cwd.to_string_lossy());
        assert_eq!(r.stdout.trim(), format!("ran why --json in {}", cwd.display()));
        assert_eq!(r.stderr.trim(), "oops");
        assert_eq!(r.code, Some(3));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn run_refuses_before_spawning() {
        let dir = std::env::temp_dir().join(format!("mnemo-desktop-vault-refuse-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let bin = fake_mnemo(&dir);
        let refused = run_with(&bin, "/usr/bin:/bin", "doctor", &[], &dir.to_string_lossy());
        assert_eq!((refused.code, refused.stdout.as_str()), (None, ""));
        assert!(refused.stderr.contains("not an allowed action"), "{}", refused.stderr);
        let no_dir = run_with(&bin, "/usr/bin:/bin", "status", &[], "/definitely/not/here");
        assert_eq!(no_dir.code, None);
        assert!(no_dir.stderr.contains("not a directory"));
        let missing = run_with("/definitely/not/mnemo", "/usr/bin", "status", &[], &dir.to_string_lossy());
        assert_eq!(missing.code, None);
        assert!(missing.stderr.starts_with("/definitely/not/mnemo:"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn strip_ansi_removes_csi_sequences_only() {
        assert_eq!(strip_ansi("\u{1b}[1;34musage:\u{1b}[0m mnemo [x]"), "usage: mnemo [x]");
    }

    #[test]
    fn page_serializes_flat_with_type_key() {
        let p = parse_page(Path::new("/v/shared/user/a.md"), "---\nname: A\n---\nbody", Some(5));
        let v = serde_json::to_value(&p).unwrap();
        assert_eq!(v["type"], "user");
        assert_eq!(v["name"], "A");
        assert_eq!(v["modified"], 5);
        assert_eq!(v["frontmatter"][0]["key"], "name");
        assert!(v["error"].is_null());
    }
}

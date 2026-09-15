//! Marketplace pane: rule sets published with `mnemo publish` in any git repo.
//!
//! Sources are git URLs in `~/.mnemo-desktop/marketplace.json`; each is kept as a
//! shallow clone under `~/.mnemo-desktop/marketplace/<hash>/`. A rule set is one
//! `.mnemo-shared/` tree inside a clone, laid out as `<tree>/<type>/<slug>.md`
//! (mnemo's `core/share/format.py`). Importing hands the tree to `mnemo import`,
//! which stages it into the vault for review; nothing here writes to a vault.
//!
//! Reading a tree is pure (`read_tree`, `parse_page`), git and `mnemo` are
//! confined to `// -- io --`, and every path is rooted in a `Marketplace` so tests
//! run against a temporary home.

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::process::Command;

/// The source a fresh install lists.
pub const DEFAULT_SOURCE: &str = "https://github.com/xyrlan/mnemo-rules";
/// `format.SHARE_DIR` in mnemo.
pub const SHARE_DIR: &str = ".mnemo-shared";
/// How deep under a clone a tree is looked for (`sets/react/.mnemo-shared` is 3).
const MAX_TREE_DEPTH: usize = 4;

// ---------------------------------------------------------------- model --

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct RuleSet {
    /// The source URL exactly as listed in `marketplace.json`.
    pub source: String,
    pub name: String,
    /// Absolute path of the `.mnemo-shared/` tree, what `marketplace_import` takes.
    /// Empty when `error` is set.
    pub path: String,
    pub description: String,
    pub rule_count: usize,
    /// Page type → rules of that type.
    pub types: BTreeMap<String, usize>,
    /// Topic tags, most used first.
    pub topics: Vec<String>,
    /// Publisher projects named by the pages' provenance.
    pub projects: Vec<String>,
    /// Committer date of the clone's last commit touching the tree, ISO 8601.
    pub last_commit: Option<String>,
    /// Why this source has no rule sets to show (fetch failed, no tree).
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Config {
    #[serde(default)]
    pub sources: Vec<String>,
}

impl Default for Config {
    fn default() -> Self {
        Config { sources: vec![DEFAULT_SOURCE.to_string()] }
    }
}

/// One portable page, reduced to what a card shows.
#[derive(Debug, Clone, PartialEq)]
pub struct Page {
    pub slug: String,
    pub page_type: String,
    pub tags: Vec<String>,
    pub project: String,
}

// ------------------------------------------------------------- parsers --

#[derive(Debug, Clone, PartialEq)]
enum Value {
    Scalar(String),
    List(Vec<String>),
    Map(HashMap<String, String>),
}

/// `_yaml_scalar`'s inverse: a single-quoted scalar with doubled inner quotes, a
/// double-quoted one, or a bare one.
fn dequote(s: &str) -> String {
    let s = s.trim();
    if s.len() >= 2 && s.starts_with('\'') && s.ends_with('\'') {
        return s[1..s.len() - 1].replace("''", "'");
    }
    if s.len() >= 2 && s.starts_with('"') && s.ends_with('"') {
        return s[1..s.len() - 1].to_string();
    }
    s.to_string()
}

/// The frontmatter mnemo writes: top-level scalars, top-level block lists, and
/// one nesting level of `key: scalar` (lists nested there are ignored).
fn parse_frontmatter(text: &str) -> Option<HashMap<String, Value>> {
    let text = text.replace("\r\n", "\n");
    let rest = text.strip_prefix("---\n")?;
    let end = rest.find("\n---\n").or_else(|| rest.strip_suffix("\n---").map(|r| r.len()))?;
    let mut out: HashMap<String, Value> = HashMap::new();
    let mut open: Option<String> = None;
    for line in rest[..end].lines() {
        if line.trim().is_empty() {
            continue;
        }
        if !line.starts_with(' ') {
            let Some((k, v)) = line.split_once(':') else { continue };
            let (k, v) = (k.trim().to_string(), v.trim());
            if v.is_empty() {
                open = Some(k);
            } else {
                open = None;
                let value = if v == "[]" { Value::List(vec![]) } else { Value::Scalar(dequote(v)) };
                out.insert(k, value);
            }
            continue;
        }
        let Some(key) = &open else { continue };
        let t = line.trim();
        if let Some(item) = t.strip_prefix("- ") {
            // Only a two-space item is the open key's own list; deeper ones belong
            // to a nested key.
            if line.len() - line.trim_start().len() != 2 {
                continue;
            }
            match out.entry(key.clone()).or_insert_with(|| Value::List(vec![])) {
                Value::List(l) => l.push(dequote(item)),
                _ => continue,
            }
        } else if let Some((k, v)) = t.split_once(':') {
            if v.trim().is_empty() {
                continue;
            }
            match out.entry(key.clone()).or_insert_with(|| Value::Map(HashMap::new())) {
                Value::Map(m) => {
                    m.insert(k.trim().to_string(), dequote(v));
                }
                _ => continue,
            }
        }
    }
    Some(out)
}

/// `format.from_portable`'s acceptance rule: a `published:` block naming a vault,
/// a slug (or name) and a type. Anything else in a tree is not a rule.
pub fn parse_page(text: &str) -> Option<Page> {
    let fm = parse_frontmatter(text)?;
    let scalar = |k: &str| match fm.get(k) {
        Some(Value::Scalar(s)) if !s.trim().is_empty() => Some(s.trim().to_string()),
        _ => None,
    };
    let Some(Value::Map(published)) = fm.get("published") else { return None };
    if published.get("vault").map(|v| v.trim().is_empty()).unwrap_or(true) {
        return None;
    }
    let slug = scalar("slug").or_else(|| scalar("name"))?;
    let page_type = scalar("type")?;
    let tags = match fm.get("tags") {
        Some(Value::List(l)) => l.iter().filter(|t| !t.is_empty()).cloned().collect(),
        _ => vec![],
    };
    let project = published.get("project").cloned().unwrap_or_default();
    Some(Page { slug, page_type, tags, project })
}

/// The first paragraph of a README, headings skipped, lines joined.
pub fn first_paragraph(md: &str) -> String {
    let mut words: Vec<&str> = Vec::new();
    for line in md.lines() {
        let t = line.trim();
        if t.is_empty() || t.starts_with('#') {
            if words.is_empty() {
                continue;
            }
            break;
        }
        words.push(t);
    }
    words.join(" ")
}

/// A rule set from a tree on disk: every `<tree>/<type>/*.md` that is a page.
/// `name` and `last_commit` are the caller's, since both depend on the clone.
pub fn read_tree(tree: &Path) -> RuleSet {
    let mut pages = Vec::new();
    let mut files: Vec<PathBuf> = std::fs::read_dir(tree)
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .flat_map(|d| std::fs::read_dir(d).into_iter().flatten().flatten().map(|e| e.path()))
        .filter(|p| p.is_file() && p.extension().map(|x| x == "md").unwrap_or(false))
        .collect();
    files.sort();
    for f in files {
        if let Some(p) = std::fs::read_to_string(&f).ok().and_then(|t| parse_page(&t)) {
            pages.push(p);
        }
    }

    let mut types = BTreeMap::new();
    let mut topic_counts: HashMap<String, usize> = HashMap::new();
    let mut projects: Vec<String> = Vec::new();
    for p in &pages {
        *types.entry(p.page_type.clone()).or_insert(0) += 1;
        for t in &p.tags {
            *topic_counts.entry(t.clone()).or_insert(0) += 1;
        }
        if !p.project.is_empty() && !projects.contains(&p.project) {
            projects.push(p.project.clone());
        }
    }
    let mut topics: Vec<(String, usize)> = topic_counts.into_iter().collect();
    topics.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));

    // A README inside the tree is about the rules; one beside it is about the repo
    // or folder that holds them. Either beats a synthesized line.
    let readme = |dir: &Path| std::fs::read_to_string(dir.join("README.md")).ok().map(|t| first_paragraph(&t));
    let description = readme(tree)
        .filter(|d| !d.is_empty())
        .or_else(|| tree.parent().and_then(readme).filter(|d| !d.is_empty()))
        .unwrap_or_else(|| match projects.len() {
            0 => String::new(),
            _ => format!("Published from {}", projects.join(", ")),
        });

    RuleSet {
        path: tree.to_string_lossy().to_string(),
        description,
        rule_count: pages.len(),
        types,
        topics: topics.into_iter().map(|(t, _)| t).collect(),
        projects,
        ..Default::default()
    }
}

/// Every `.mnemo-shared/` directory under `root`, root's own first. A tree is not
/// searched inside, and `.git` / `node_modules` never are.
pub fn find_trees(root: &Path) -> Vec<PathBuf> {
    fn walk(dir: &Path, depth: usize, out: &mut Vec<PathBuf>) {
        let Ok(rd) = std::fs::read_dir(dir) else { return };
        let mut dirs: Vec<PathBuf> = rd.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect();
        dirs.sort();
        for d in &dirs {
            if d.file_name().map(|n| n == SHARE_DIR).unwrap_or(false) {
                out.push(d.clone());
            }
        }
        if depth == 0 {
            return;
        }
        for d in dirs {
            let name = d.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            if name == SHARE_DIR || name == ".git" || name == "node_modules" {
                continue;
            }
            walk(&d, depth - 1, out);
        }
    }
    let mut out = Vec::new();
    walk(root, MAX_TREE_DEPTH - 1, &mut out);
    out
}

/// `https://github.com/a/rules.git` → `rules`.
pub fn repo_name(url: &str) -> String {
    let t = url.trim().trim_end_matches(['/', '\\']);
    let last = t.rsplit(['/', '\\', ':']).next().unwrap_or(t);
    let name = last.strip_suffix(".git").unwrap_or(last);
    if name.is_empty() { t.to_string() } else { name.to_string() }
}

/// Where a source is cloned: FNV-1a of the URL, stable across builds and runs
/// (std's hasher promises neither).
pub fn source_dir_name(url: &str) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in url.trim().as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    format!("{h:016x}")
}

/// A source must be something `git clone` reads as a repository, never as a flag.
pub fn validate_source(url: &str) -> Result<String, String> {
    let u = url.trim();
    if u.is_empty() {
        return Err("source URL is empty".into());
    }
    if u.starts_with('-') || u.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err(format!("not a git URL: {u}"));
    }
    let remote = ["https://", "http://", "ssh://", "git://", "file://"].iter().any(|p| u.starts_with(p));
    let scp = u.starts_with("git@") && u.contains(':');
    // `/abs/path` counts as absolute on every platform: local sources are
    // written with forward slashes even on Windows.
    if remote || scp || Path::new(u).is_absolute() || u.starts_with('/') {
        Ok(u.to_string())
    } else {
        Err(format!("not a git URL: {u} (expected https://, ssh://, git@host:path or an absolute path)"))
    }
}

// ------------------------------------------------------------------ io --

/// Serializes clones and fetches: the pane's first load and a refresh must not
/// clone into the same directory at once.
static SYNC: std::sync::Mutex<()> = std::sync::Mutex::new(());

pub struct Marketplace {
    /// `marketplace.json`.
    pub config: PathBuf,
    /// Parent of every clone.
    pub cache: PathBuf,
    /// The PATH given to `git` and `mnemo`.
    pub path_env: String,
}

impl Marketplace {
    pub fn at_home() -> Marketplace {
        let base = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default().join(".mnemo-desktop");
        Marketplace {
            config: base.join("marketplace.json"),
            cache: base.join("marketplace"),
            path_env: crate::mission::login_path(),
        }
    }

    /// A missing file is the default list; a broken one is an error, never
    /// silently replaced (the next `add_source` would overwrite the user's list).
    pub fn read_config(&self) -> Result<Config, String> {
        match std::fs::read_to_string(&self.config) {
            Ok(t) => serde_json::from_str(&t).map_err(|e| format!("{}: {e}", self.config.display())),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Config::default()),
            Err(e) => Err(format!("{}: {e}", self.config.display())),
        }
    }

    fn write_config(&self, c: &Config) -> Result<(), String> {
        if let Some(d) = self.config.parent() {
            std::fs::create_dir_all(d).map_err(|e| e.to_string())?;
        }
        let tmp = self.config.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_string_pretty(c).map_err(|e| e.to_string())? + "\n")
            .map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, &self.config).map_err(|e| e.to_string())
    }

    pub fn add_source(&self, url: &str) -> Result<(), String> {
        let url = validate_source(url)?;
        let mut c = self.read_config()?;
        if !c.sources.iter().any(|s| s.trim() == url) {
            c.sources.push(url);
            self.write_config(&c)?;
        }
        Ok(())
    }

    /// Drops the source and its clone.
    pub fn remove_source(&self, url: &str) -> Result<(), String> {
        let mut c = self.read_config()?;
        let before = c.sources.len();
        c.sources.retain(|s| s.trim() != url.trim());
        if c.sources.len() != before {
            self.write_config(&c)?;
        }
        let _ = std::fs::remove_dir_all(self.cache.join(source_dir_name(url)));
        Ok(())
    }

    fn git(&self, args: &[&str], cwd: Option<&Path>) -> Result<String, String> {
        let mut cmd = Command::new("git");
        cmd.args(args).env("PATH", &self.path_env).env("GIT_TERMINAL_PROMPT", "0").stdin(std::process::Stdio::null());
        if let Some(d) = cwd {
            cmd.current_dir(d);
        }
        let out = cmd.output().map_err(|e| format!("git: {e}"))?;
        if !out.status.success() {
            let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
            return Err(if err.is_empty() { format!("git {} failed", args[0]) } else { err });
        }
        Ok(String::from_utf8_lossy(&out.stdout).to_string())
    }

    /// Shallow-clones a source that has no clone yet; with `fetch`, also brings an
    /// existing clone to the remote's HEAD. A clone goes to a sibling directory
    /// first so a failed one never leaves a half-written source behind.
    fn sync(&self, url: &str, fetch: bool) -> Result<PathBuf, String> {
        let dir = self.cache.join(source_dir_name(url));
        if dir.join(".git").is_dir() {
            if fetch {
                self.git(&["fetch", "--quiet", "--depth", "1", "origin", "HEAD"], Some(&dir))?;
                self.git(&["reset", "--quiet", "--hard", "FETCH_HEAD"], Some(&dir))?;
            }
            return Ok(dir);
        }
        std::fs::create_dir_all(&self.cache).map_err(|e| format!("{}: {e}", self.cache.display()))?;
        let partial = dir.with_extension("partial");
        let _ = std::fs::remove_dir_all(&partial);
        let _ = std::fs::remove_dir_all(&dir);
        let target = partial.to_string_lossy().to_string();
        let res = self.git(&["clone", "--quiet", "--depth", "1", "--", url, &target], None);
        if let Err(e) = res {
            let _ = std::fs::remove_dir_all(&partial);
            return Err(e);
        }
        std::fs::rename(&partial, &dir).map_err(|e| e.to_string())?;
        Ok(dir)
    }

    fn sets_in(&self, url: &str, clone: &Path) -> Vec<RuleSet> {
        let trees = find_trees(clone);
        if trees.is_empty() {
            return vec![RuleSet {
                source: url.to_string(),
                name: repo_name(url),
                error: Some(format!("no {SHARE_DIR}/ tree in this repository")),
                ..Default::default()
            }];
        }
        trees
            .iter()
            .map(|tree| {
                let rel = tree.strip_prefix(clone).unwrap_or(tree);
                let holder = rel.parent().filter(|p| !p.as_os_str().is_empty());
                let rel_s = rel.to_string_lossy().replace('\\', "/");
                let last_commit = self
                    .git(&["log", "-1", "--format=%cI", "--", &rel_s], Some(clone))
                    .ok()
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty());
                RuleSet {
                    source: url.to_string(),
                    name: match holder {
                        Some(h) => h.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
                        None => repo_name(url),
                    },
                    last_commit,
                    ..read_tree(tree)
                }
            })
            .collect()
    }

    /// Every configured source's rule sets, in config order. With `fetch` set to
    /// `None` nothing already cloned touches the network; `Some(None)` fetches
    /// every source, `Some(Some(url))` that one. A failing source becomes one
    /// entry carrying its error; the others still list.
    pub fn list(&self, fetch: Option<Option<&str>>) -> Vec<RuleSet> {
        let config = match self.read_config() {
            Ok(c) => c,
            Err(e) => return vec![RuleSet { name: "marketplace.json".into(), error: Some(e), ..Default::default() }],
        };
        let _guard = SYNC.lock().unwrap_or_else(|p| p.into_inner());
        let mut sources: Vec<String> = Vec::new();
        for s in config.sources.iter().map(|s| s.trim()).filter(|s| !s.is_empty()) {
            if !sources.iter().any(|x| x == s) {
                sources.push(s.to_string());
            }
        }
        // Sources fetch in parallel; results keep config order.
        std::thread::scope(|scope| {
            let handles: Vec<_> = sources
                .iter()
                .map(|url| {
                    let want = match fetch {
                        None => false,
                        Some(None) => true,
                        Some(Some(one)) => one.trim() == url,
                    };
                    scope.spawn(move || match validate_source(url).and_then(|u| self.sync(&u, want)) {
                        Ok(clone) => self.sets_in(url, &clone),
                        Err(e) => vec![RuleSet {
                            source: url.clone(),
                            name: repo_name(url),
                            error: Some(e),
                            ..Default::default()
                        }],
                    })
                })
                .collect();
            handles.into_iter().flat_map(|h| h.join().unwrap_or_default()).collect()
        })
    }
}

/// `mnemo import <path>` in `cwd`: the project is the cwd's, the vault mnemo's
/// own. Ok with the combined output on exit 0; Err with it otherwise (exit 1 is
/// "some rules refused", which the card shows as a failure with the reasons).
pub fn import_with(program: &str, path_env: &str, path: &str, cwd: &str) -> Result<String, String> {
    if !Path::new(path).is_dir() {
        return Err(format!("{path} is not a directory"));
    }
    if cwd.trim().is_empty() || !Path::new(cwd).is_dir() {
        return Err(format!("no project to import into: {cwd:?} is not a directory"));
    }
    let out = Command::new(program)
        .args(["import", path])
        .current_dir(cwd)
        .env("PATH", path_env)
        .stdin(std::process::Stdio::null())
        .output()
        .map_err(|e| format!("{program}: {e}"))?;
    let text = [String::from_utf8_lossy(&out.stdout).trim(), String::from_utf8_lossy(&out.stderr).trim()]
        .into_iter()
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    if out.status.success() {
        Ok(text)
    } else if text.is_empty() {
        Err(format!("{program} import exited with {}", out.status.code().unwrap_or(-1)))
    } else {
        Err(text)
    }
}

// ------------------------------------------------------------ commands --

#[tauri::command]
pub async fn marketplace_list() -> Vec<RuleSet> {
    tauri::async_runtime::spawn_blocking(|| Marketplace::at_home().list(None)).await.unwrap_or_default()
}

/// Fetches one source (or all, with `url` null) and lists again.
#[tauri::command]
pub async fn marketplace_refresh(url: Option<String>) -> Vec<RuleSet> {
    tauri::async_runtime::spawn_blocking(move || Marketplace::at_home().list(Some(url.as_deref())))
        .await
        .unwrap_or_default()
}

#[tauri::command]
pub fn marketplace_add_source(url: String) -> Result<(), String> {
    Marketplace::at_home().add_source(&url)
}

#[tauri::command]
pub fn marketplace_remove_source(url: String) -> Result<(), String> {
    Marketplace::at_home().remove_source(&url)
}

#[tauri::command]
pub async fn marketplace_import(path: String, cwd: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || import_with("mnemo", &crate::mission::login_path(), &path, &cwd))
        .await
        .map_err(|e| e.to_string())?
}

// --------------------------------------------------------------- tests --

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/fixtures/marketplace/rules-repo");

    fn temp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("mnemo-desktop-mkt-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn market(home: &Path) -> Marketplace {
        Marketplace {
            config: home.join("marketplace.json"),
            cache: home.join("marketplace"),
            path_env: std::env::var("PATH").unwrap_or_default(),
        }
    }

    fn copy_dir(from: &Path, to: &Path) {
        std::fs::create_dir_all(to).unwrap();
        for e in std::fs::read_dir(from).unwrap().flatten() {
            let p = e.path();
            if p.is_dir() {
                copy_dir(&p, &to.join(e.file_name()));
            } else {
                std::fs::copy(&p, to.join(e.file_name())).unwrap();
            }
        }
    }

    fn git(args: &[&str], cwd: &Path) {
        let out = Command::new("git")
            .args(["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false"])
            .args(args)
            .current_dir(cwd)
            .output()
            .unwrap();
        assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
    }

    /// The fixture as a real git repository, committed on a fixed date.
    fn fixture_repo(tag: &str) -> PathBuf {
        let repo = temp(tag).join("rules-repo");
        copy_dir(Path::new(FIXTURE), &repo);
        git(&["init", "--quiet", "-b", "main"], &repo);
        git(&["add", "-A"], &repo);
        let out = Command::new("git")
            .args(["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "rules"])
            .env("GIT_COMMITTER_DATE", "2026-09-10T12:00:00+00:00")
            .env("GIT_AUTHOR_DATE", "2026-09-10T12:00:00+00:00")
            .current_dir(&repo)
            .output()
            .unwrap();
        assert!(out.status.success());
        repo
    }

    #[test]
    fn page_parses_published_fixture() {
        let text = std::fs::read_to_string(Path::new(FIXTURE).join(".mnemo-shared/feedback/no-silent-contract-changes.md")).unwrap();
        let p = parse_page(&text).unwrap();
        assert_eq!(p.slug, "no-silent-contract-changes");
        assert_eq!(p.page_type, "feedback");
        assert_eq!(p.tags, vec!["process", "communication", "api"]);
        assert_eq!(p.project, "mnemo-desktop");
    }

    #[test]
    fn page_refuses_what_from_portable_refuses() {
        assert!(parse_page("# notes\n\nno frontmatter").is_none());
        assert!(parse_page("---\nslug: a\ntype: feedback\n---\n\nbody").is_none(), "no published block");
        assert!(parse_page("---\nslug: a\ntype: feedback\npublished:\n  project: p\n---\n\n").is_none(), "no vault");
        assert!(parse_page("---\nslug: a\npublished:\n  vault: v\n---\n\n").is_none(), "no type");
        let by_name = parse_page("---\nname: 'it''s'\ntype: feedback\ntags: []\npublished:\n  vault: v\n---\n\n").unwrap();
        assert_eq!(by_name.slug, "it's");
        assert!(by_name.tags.is_empty());
        let crlf = parse_page("---\r\nslug: a\r\ntype: project\r\npublished:\r\n  vault: v\r\n---\r\n\r\nbody").unwrap();
        assert_eq!(crlf.page_type, "project");
    }

    #[test]
    fn nested_lists_do_not_leak_into_the_parent_key() {
        let text = "---\nslug: a\ntype: feedback\nevidence:\n  quote: q\n  paths:\n    - x\npublished:\n  vault: v\n---\n\n";
        assert!(parse_page(text).is_some());
    }

    #[test]
    fn tree_counts_pages_types_and_topics_and_skips_strays() {
        let set = read_tree(&Path::new(FIXTURE).join(SHARE_DIR));
        assert_eq!(set.rule_count, 4, "notes.md has no provenance and is not a rule");
        assert_eq!(set.types.get("feedback"), Some(&3));
        assert_eq!(set.types.get("project"), Some(&1));
        assert_eq!(set.topics[0], "workflow", "the most used topic comes first");
        assert!(set.topics.contains(&"debugging".to_string()));
        assert_eq!(set.projects, vec!["mnemo-desktop"]);
        assert!(set.description.starts_with("Corrections learned while building"));
    }

    #[test]
    fn description_falls_back_to_readme_beside_the_tree_then_projects() {
        let react = read_tree(&Path::new(FIXTURE).join("sets/react").join(SHARE_DIR));
        assert_eq!(react.description, "React habits from a web app.");
        let bare = temp("bare");
        copy_dir(&Path::new(FIXTURE).join("sets/react").join(SHARE_DIR), &bare.join(SHARE_DIR));
        assert_eq!(read_tree(&bare.join(SHARE_DIR)).description, "Published from web-app");
        assert_eq!(read_tree(&bare.join("missing")).rule_count, 0);
    }

    #[test]
    fn trees_are_found_root_first_and_not_inside_each_other() {
        let trees = find_trees(Path::new(FIXTURE));
        let rel: Vec<String> =
            trees.iter().map(|t| t.strip_prefix(FIXTURE).unwrap().to_string_lossy().replace('\\', "/")).collect();
        assert_eq!(rel, vec![".mnemo-shared", "sets/react/.mnemo-shared"]);
    }

    #[test]
    fn names_hashes_and_source_validation() {
        assert_eq!(repo_name("https://github.com/xyrlan/mnemo-rules"), "mnemo-rules");
        assert_eq!(repo_name("git@github.com:xyrlan/rules.git"), "rules");
        assert_eq!(repo_name("/tmp/x/rules-repo/"), "rules-repo");
        assert_eq!(source_dir_name("https://a"), source_dir_name(" https://a "));
        assert_ne!(source_dir_name("https://a"), source_dir_name("https://b"));
        assert_eq!(source_dir_name("https://github.com/xyrlan/mnemo-rules").len(), 16);
        assert!(validate_source("https://github.com/a/b").is_ok());
        assert!(validate_source("git@github.com:a/b.git").is_ok());
        assert!(validate_source("/abs/path").is_ok());
        assert!(validate_source("--upload-pack=touch /tmp/pwned").is_err());
        assert!(validate_source("relative/path").is_err());
        assert!(validate_source("https://a b").is_err());
        assert!(validate_source("  ").is_err());
    }

    #[test]
    fn config_defaults_adds_once_and_refuses_to_clobber_a_broken_file() {
        let home = temp("config");
        let m = market(&home);
        assert_eq!(m.read_config().unwrap().sources, vec![DEFAULT_SOURCE]);
        m.add_source(" https://example.com/r.git ").unwrap();
        m.add_source("https://example.com/r.git").unwrap();
        assert_eq!(m.read_config().unwrap().sources, vec![DEFAULT_SOURCE, "https://example.com/r.git"]);
        assert!(m.add_source("-oops").is_err());
        m.remove_source("https://example.com/r.git").unwrap();
        assert_eq!(m.read_config().unwrap().sources, vec![DEFAULT_SOURCE]);
        std::fs::write(&m.config, "{ not json").unwrap();
        assert!(m.add_source("https://example.com/other").is_err());
        assert_eq!(std::fs::read_to_string(&m.config).unwrap(), "{ not json");
        let listed = m.list(None);
        assert_eq!(listed.len(), 1);
        assert!(listed[0].error.is_some());
    }

    #[test]
    fn list_clones_a_source_and_reads_every_tree_with_its_commit_date() {
        let repo = fixture_repo("list");
        let home = temp("list-home");
        let m = market(&home);
        let url = repo.to_string_lossy().to_string();
        std::fs::write(&m.config, serde_json::json!({ "sources": [url, "/nonexistent/mnemo-rules"] }).to_string()).unwrap();

        let sets = m.list(None);
        assert_eq!(sets.len(), 3, "{sets:#?}");
        let root = &sets[0];
        assert_eq!(root.name, "rules-repo");
        assert_eq!(root.source, url);
        assert_eq!(root.rule_count, 4);
        assert!(root.error.is_none());
        assert!(root.path.starts_with(m.cache.to_string_lossy().as_ref()));
        assert!(root.path.ends_with(SHARE_DIR));
        assert!(root.last_commit.as_deref().unwrap().starts_with("2026-09-10T12:00:00"), "{:?}", root.last_commit);
        let react = &sets[1];
        assert_eq!(react.name, "react");
        assert_eq!(react.rule_count, 1);
        assert_eq!(react.topics, vec!["react", "ui"]);
        let broken = &sets[2];
        assert_eq!(broken.name, "mnemo-rules");
        assert!(broken.error.is_some(), "a failing source is listed with its error");
        assert!(broken.path.is_empty());
    }

    #[test]
    fn refresh_fetches_new_commits_and_a_repo_without_a_tree_says_so() {
        let repo = fixture_repo("refresh");
        let home = temp("refresh-home");
        let m = market(&home);
        let url = repo.to_string_lossy().to_string();
        m.write_config(&Config { sources: vec![url.clone()] }).unwrap();
        assert_eq!(m.list(None)[0].rule_count, 4);

        std::fs::remove_file(repo.join(SHARE_DIR).join("project/shared-target-dir.md")).unwrap();
        git(&["commit", "--quiet", "-am", "drop one"], &repo);
        assert_eq!(m.list(None)[0].rule_count, 4, "listing alone does not fetch");
        assert_eq!(m.list(Some(Some("/some/other/source")))[0].rule_count, 4, "refreshing another source does not fetch this one");
        assert_eq!(m.list(Some(Some(&url)))[0].rule_count, 3);

        std::fs::remove_dir_all(repo.join(SHARE_DIR)).unwrap();
        std::fs::remove_dir_all(repo.join("sets")).unwrap();
        git(&["commit", "--quiet", "-am", "unpublish"], &repo);
        let sets = m.list(Some(None));
        assert_eq!(sets.len(), 1);
        assert!(sets[0].error.as_deref().unwrap().contains(SHARE_DIR));
    }

    #[cfg(unix)]
    #[test]
    fn import_runs_mnemo_in_the_cwd_and_reports_output_either_way() {
        use std::os::unix::fs::PermissionsExt;
        let dir = temp("import");
        let project = dir.join("project");
        std::fs::create_dir_all(&project).unwrap();
        let tree = Path::new(FIXTURE).join(SHARE_DIR);
        let fake = dir.join("mnemo");
        std::fs::write(
            &fake,
            "#!/bin/sh\necho \"$1 $2 in $(pwd -P)\"\ncase \"$2\" in *react*) echo 'refused feedback/x: collision' >&2; exit 1;; esac\n",
        )
        .unwrap();
        std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
        let fake = fake.to_string_lossy().to_string();
        let path_env = std::env::var("PATH").unwrap_or_default();
        let cwd = project.to_string_lossy().to_string();

        let ok = import_with(&fake, &path_env, &tree.to_string_lossy(), &cwd).unwrap();
        let canon = project.canonicalize().unwrap();
        assert_eq!(ok, format!("import {} in {}", tree.display(), canon.display()));

        let react = Path::new(FIXTURE).join("sets/react").join(SHARE_DIR);
        let err = import_with(&fake, &path_env, &react.to_string_lossy(), &cwd).unwrap_err();
        assert!(err.ends_with("refused feedback/x: collision"), "{err}");

        assert!(import_with(&fake, &path_env, "/nonexistent/tree", &cwd).unwrap_err().contains("not a directory"));
        assert!(import_with(&fake, &path_env, &tree.to_string_lossy(), "").unwrap_err().contains("no project"));
    }
}

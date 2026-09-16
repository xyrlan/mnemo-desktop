//! Vault pane: the mnemo vault on disk, read-only, plus seven `mnemo` subcommands, the rules
//! of the health table with their heat and badges (`vault_rules`), the neighbourhood of one
//! rule (`vault_ego`) and a health report (`vault_health`).
//!
//! The vault root is whatever `mnemo status` names (`Vault: <path>`). Inside it,
//! pages are Markdown files with YAML frontmatter: an agent's own under
//! `bots/<agent>/memory/`, universal ones under `shared/<type>/`. Folders starting
//! with `_` (`_inbox`, `_archive`) hold staged or retired pages and are skipped.
//!
//! Reading is pure (`parse_frontmatter`, `parse_page`, `read_tree`, `page_at`, `count_fires`,
//! `rule_rows`, `ego_graph`, `parse_tiles`, `review`), `mnemo` is confined to `// -- io --`, and
//! `vault_run` only ever runs an allowlisted subcommand with checked arguments (`check_run`).
//! `vault_health` runs `status` and `doctor` itself, with no argument from the front-end.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
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
            // Forward slashes everywhere: graph ids and health rows are compared as strings
            // across platforms, and Windows file APIs accept them.
            path: path.to_string_lossy().replace('\\', "/"),
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

/// `(name, kind, pages dir)` of every agent: `shared` first, then projects, then noise, each by name.
fn agent_dirs(root: &Path) -> Vec<(String, &'static str, PathBuf)> {
    let mut out = vec![("shared".to_string(), "shared", root.join("shared"))];
    let mut bots: Vec<PathBuf> = std::fs::read_dir(root.join("bots")).into_iter().flatten().flatten().map(|e| e.path()).collect();
    bots.sort();
    let mut others = Vec::new();
    for b in bots {
        let Some(name) = b.file_name().map(|n| n.to_string_lossy().to_string()) else { continue };
        if name.starts_with('.') || !b.join("memory").is_dir() {
            continue;
        }
        if is_noise(&name) {
            others.push((name, "other", b.join("memory")));
        } else {
            out.push((name, "repo", b.join("memory")));
        }
    }
    out.extend(others);
    out
}

/// `shared` first, then projects, then noise, each by name. Agents without pages are left out.
pub fn read_tree(root: &Path) -> Vec<Agent> {
    agent_dirs(root)
        .into_iter()
        .filter_map(|(name, kind, dir)| {
            let pages: Vec<PageInfo> = page_files(&dir).iter().filter_map(|f| read_page(f)).map(|p| p.info).collect();
            // Forward slashes everywhere: the front-end shows and joins these, and Windows accepts them.
            (!pages.is_empty()).then(|| Agent { name, kind: kind.to_string(), dir: dir.to_string_lossy().replace('\\', "/"), groups: group(pages) })
        })
        .collect()
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

// ---------------------------------------------------------------- fires --

/// How often a rule fired, when it last did, and when each dated fire was (ms since the epoch).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Fire {
    pub count: u32,
    pub last: Option<u64>,
    /// One per fire whose row carried a timestamp, in log order: what `heat` decays.
    pub times: Vec<u64>,
}

/// Rule key (a slug, or the page name an MCP read asked for) → its fires.
pub type Fires = HashMap<String, Fire>;

/// Where the reflex hook and the MCP server log, under the vault root. The reflex log
/// rotates once into `.1`.
const REFLEX_LOGS: &[&str] = &[".mnemo/reflex-log.jsonl.1", ".mnemo/reflex-log.jsonl"];
const ACCESS_LOG: &str = ".mnemo/mcp-access-log.jsonl";

/// A rule id names its slug: `mnemo__x`, `project/x` and `x` all name `x`.
pub fn rule_slug(id: &str) -> &str {
    let id = id.rsplit('/').next().unwrap_or(id);
    id.rsplit_once("__").map_or(id, |(_, s)| s)
}

#[derive(Deserialize)]
struct ReflexRow {
    emitted: Option<Vec<String>>,
    ts: Option<String>,
}

#[derive(Deserialize)]
struct AccessRow {
    tool: Option<String>,
    hit_slugs: Option<Vec<String>>,
    timestamp: Option<String>,
}

fn bump(fires: &mut Fires, key: &str, ts: Option<&str>) {
    let f = fires.entry(key.to_string()).or_default();
    f.count += 1;
    let at = ts.and_then(crate::mission::iso_ms);
    f.last = f.last.max(at);
    f.times.extend(at);
}

/// Fires from the reflex log (each `emitted` id) and the MCP access log (each
/// `read_mnemo_rule` hit). Lines that are not JSON rows are skipped.
pub fn count_fires(reflex: &[&str], access: &str) -> Fires {
    let mut fires = Fires::new();
    for line in reflex.iter().flat_map(|t| t.lines()) {
        let Ok(row) = serde_json::from_str::<ReflexRow>(line) else { continue };
        for id in row.emitted.unwrap_or_default() {
            bump(&mut fires, rule_slug(&id), row.ts.as_deref());
        }
    }
    for line in access.lines() {
        let Ok(row) = serde_json::from_str::<AccessRow>(line) else { continue };
        if row.tool.as_deref() == Some("read_mnemo_rule") {
            for hit in row.hit_slugs.unwrap_or_default() {
                bump(&mut fires, rule_slug(&hit), row.timestamp.as_deref());
            }
        }
    }
    fires
}

pub fn read_fires(root: &Path) -> Fires {
    let read = |rel: &str| std::fs::read_to_string(root.join(rel)).unwrap_or_default();
    let reflex: Vec<String> = REFLEX_LOGS.iter().map(|r| read(r)).collect();
    count_fires(&reflex.iter().map(String::as_str).collect::<Vec<_>>(), &read(ACCESS_LOG))
}

/// A page's fires, by slug and, when an MCP read named it that way, by name.
pub fn fire_of(fires: &Fires, page: &PageInfo) -> Fire {
    let by_slug = fires.get(&page.slug).cloned().unwrap_or_default();
    match fires.get(&page.name) {
        Some(n) if page.name != page.slug => Fire {
            count: by_slug.count + n.count,
            last: by_slug.last.max(n.last),
            times: by_slug.times.iter().chain(&n.times).copied().collect(),
        },
        _ => by_slug,
    }
}

/// A fire this many days old counts half as much as one now.
pub const HEAT_HALF_LIFE_DAYS: f64 = 30.0;

/// Fires with a 30-day half-life as of `now`: a fire today is 1, a month ago 0.5. A fire in
/// the future (another machine's clock) counts as now; an undated one counts nothing.
pub fn heat(fire: &Fire, now: u64) -> f64 {
    let half_life = HEAT_HALF_LIFE_DAYS * DAY_MS as f64;
    fire.times.iter().map(|t| 0.5f64.powf(now.saturating_sub(*t) as f64 / half_life)).sum()
}

// ---------------------------------------------------------------- rules --

/// A shared or project page and the agent it belongs to: what the table and the ego graph read.
#[derive(Debug, Clone, PartialEq)]
pub struct LivePage {
    /// `shared`, or the repo agent's name.
    pub agent: String,
    pub page: Page,
}

/// One row of the health table.
#[derive(Debug, Clone, Serialize, PartialEq, Default)]
pub struct RuleRow {
    pub path: String,
    pub slug: String,
    pub name: String,
    pub description: String,
    #[serde(rename = "type")]
    pub page_type: String,
    /// `shared`, or the repo agent the page belongs to.
    pub agent: String,
    pub confidence: Option<String>,
    pub topics: Vec<String>,
    /// Reflex emissions plus MCP reads, all time.
    pub fires: u32,
    /// ms since the epoch.
    pub last_fired: Option<u64>,
    /// Fires decayed with a `HEAT_HALF_LIFE_DAYS` half-life; the rows come sorted by it.
    pub heat: f64,
    /// `never` (no fire on record), `review` (see `reasons`), `inbox` (a proposal with this
    /// slug is staged in an `_inbox`). `stale` is the front-end's to add: `mnemo stale` checks
    /// a repo, and this command has none.
    pub badges: Vec<String>,
    /// Why `review`: `verified without evidence`, `has activates_on, never fired`, …
    pub reasons: Vec<String>,
}

/// Every term (case-folded, split on whitespace) appears in the name, slug, description,
/// topics or body.
pub fn page_matches(page: &PageInfo, filter: &str) -> bool {
    let terms: Vec<String> = filter.split_whitespace().map(str::to_lowercase).collect();
    if terms.is_empty() {
        return true;
    }
    let hay = format!("{}\n{}\n{}\n{}\n{}", page.name, page.slug, page.description, page.topics.join(" "), page.body).to_lowercase();
    terms.iter().all(|t| hay.contains(t.as_str()))
}

/// Does `page` fall in `scope`: empty or `all` is every live page, else `agent:<name>` or
/// `topic:<name>` as `parse_scope` reads them.
fn in_scope(scope: &Option<Scope>, p: &LivePage) -> bool {
    match scope {
        None => true,
        Some(Scope::Agent(a)) => p.agent == *a,
        Some(Scope::Topic(t)) => p.page.info.topics.iter().any(|x| x.trim().eq_ignore_ascii_case(t)),
    }
}

fn read_scope(scope: &str) -> Result<Option<Scope>, String> {
    match scope.trim() {
        "" | "all" => Ok(None),
        s => parse_scope(s).map(Some),
    }
}

/// The table's rows: the pages in `scope` matching `filter`, hottest first, then by fires and name.
pub fn rule_rows(pages: &[LivePage], scope: &str, filter: &str, fires: &Fires, inbox: &HashSet<String>, now: u64) -> Result<Vec<RuleRow>, String> {
    let scope = read_scope(scope)?;
    let mut rows: Vec<RuleRow> = pages
        .iter()
        .filter(|p| in_scope(&scope, p) && page_matches(&p.page.info, filter))
        .map(|lp| {
            let (p, info) = (&lp.page, &lp.page.info);
            let fire = fire_of(fires, info);
            let reasons = review_reasons(p, &fire, now);
            let mut badges = Vec::new();
            if fire.count == 0 {
                badges.push("never".to_string());
            }
            if !reasons.is_empty() {
                badges.push("review".to_string());
            }
            if inbox.contains(&info.slug) {
                badges.push("inbox".to_string());
            }
            RuleRow {
                path: info.path.clone(),
                slug: info.slug.clone(),
                name: info.name.clone(),
                description: info.description.clone(),
                page_type: info.page_type.clone(),
                agent: lp.agent.clone(),
                confidence: info.confidence.clone(),
                topics: info.topics.clone(),
                fires: fire.count,
                last_fired: fire.last,
                heat: heat(&fire, now),
                badges,
                reasons,
            }
        })
        .collect();
    rows.sort_by(|a, b| {
        b.heat
            .total_cmp(&a.heat)
            .then(b.fires.cmp(&a.fires))
            .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
            .then(a.path.cmp(&b.path))
    });
    Ok(rows)
}

// ------------------------------------------------------------------ ego --

/// The most nodes an ego graph holds, its centre included: past that a neighbourhood stops
/// reading at a glance.
pub const MAX_EGO_NODES: usize = 30;

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
pub struct GraphNode {
    /// The page path.
    pub id: String,
    pub label: String,
    pub slug: String,
    #[serde(rename = "type")]
    pub page_type: String,
    pub confidence: Option<String>,
    pub topics: Vec<String>,
    /// Reflex emissions plus MCP reads.
    pub fires: u32,
    /// ms since the epoch.
    pub last_fired: Option<u64>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct GraphEdge {
    pub id: String,
    pub source: String,
    pub target: String,
    /// `link` (a `[[wikilink]]` from source to target) or `topic` (the centre and a neighbour
    /// share topics, named in `label`).
    pub kind: String,
    /// The shared topics of a `topic` edge, `, `-joined; empty for a link.
    pub label: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
pub struct VaultGraph {
    /// The centre's path, as asked.
    pub center: String,
    /// The centre first, then its neighbours: linked pages, then those sharing rare topics, then
    /// those sharing only hub topics.
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
    /// Linked and rare-topic neighbours found before the node limit cut them; pages sharing only
    /// hub topics never count, though they may fill spare room.
    pub total: usize,
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Scope {
    /// `agent:<name>`, or a bare name: one agent's pages (`shared` is one).
    Agent(String),
    /// `topic:<name>`: every shared and project page carrying the topic.
    Topic(String),
}

pub fn parse_scope(scope: &str) -> Result<Scope, String> {
    let s = scope.trim();
    let (topic, name) = match s.split_once(':') {
        Some(("topic", t)) => (true, t.trim()),
        Some(("agent", a)) => (false, a.trim()),
        _ => (false, s),
    };
    let bad = name.is_empty() || name.starts_with('.') || name.contains("..") || name.contains(['/', '\\']);
    match (topic, bad) {
        (_, true) => Err(format!("{scope:?}: not a scope (`agent:<name>` or `topic:<name>`)")),
        (true, _) => Ok(Scope::Topic(name.to_string())),
        (false, _) => Ok(Scope::Agent(name.to_string())),
    }
}

/// `[[target]]`, `[[dir/target|label]]`, `[[target#heading]]` → the targets, outside code fences.
pub fn wikilinks(body: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut fenced = false;
    for line in body.lines() {
        if line.trim_start().starts_with("```") {
            fenced = !fenced;
            continue;
        }
        if fenced {
            continue;
        }
        let mut rest = line;
        while let Some(start) = rest.find("[[") {
            let Some(len) = rest[start + 2..].find("]]") else { break };
            let inner = &rest[start + 2..start + 2 + len];
            let target = inner.split(['|', '#']).next().unwrap_or("").trim();
            if !target.is_empty() {
                out.push(target.trim_end_matches(".md").to_string());
            }
            rest = &rest[start + 2 + len + 2..];
        }
    }
    out
}

fn stem(path: &str) -> &str {
    let file = path.rsplit('/').next().unwrap_or(path);
    file.strip_suffix(".md").unwrap_or(file)
}

fn parent(path: &str) -> &str {
    path.rsplit_once('/').map_or("", |(d, _)| d)
}

/// The page a wikilink in `from` lands on: for `dir/target`, a path ending in it; else a slug
/// or file stem equal to its last segment, a page in `from`'s own folder first.
fn resolve(target: &str, from: &PageInfo, pages: &[PageInfo]) -> Option<usize> {
    let last = target.rsplit('/').next().unwrap_or(target);
    let suffix = format!("/{target}.md");
    let hit = |p: &PageInfo| p.path != from.path && (p.path.ends_with(&suffix) || p.slug == last || stem(&p.path) == last);
    let by_path = || if target.contains('/') { pages.iter().position(|p| p.path != from.path && p.path.ends_with(&suffix)) } else { None };
    by_path()
        .or_else(|| pages.iter().position(|p| hit(p) && parent(&p.path) == parent(&from.path)))
        .or_else(|| pages.iter().position(hit))
}

fn folded_topics(p: &PageInfo) -> Vec<String> {
    let mut out: Vec<String> = p.topics.iter().map(|t| t.trim().to_lowercase()).filter(|t| !t.is_empty()).collect();
    out.sort();
    out.dedup();
    out
}

/// A topic carried by more pages than this is a hub (`#auto-promoted` sits on nearly every page):
/// sharing it says nothing about two pages, so it never makes a page a counted neighbour.
pub const HUB_PAGES: usize = 100;

/// The neighbourhood of the page at `path` among `pages`, `limit` nodes at most (0 or anything
/// past `MAX_EGO_NODES` means `MAX_EGO_NODES`), ranked in three tiers: pages it links to or
/// that link to it; pages sharing a rare topic (one on at most `HUB_PAGES` pages), most rare
/// topics shared first; then pages sharing only hub topics, to fill the room left. Ties go to
/// the hottest. `total` counts the first two tiers only. Links between any two kept nodes are
/// edges; each topic neighbour gets one `topic` edge from the centre, labelled with the topics
/// that ranked it.
pub fn ego_graph(path: &str, pages: &[PageInfo], fires: &Fires, limit: u32, now: u64) -> VaultGraph {
    let Some(c) = pages.iter().position(|p| p.path == path) else {
        return VaultGraph { center: path.to_string(), error: Some(format!("{path}: not a rule in the vault")), ..Default::default() };
    };
    let limit = match limit as usize {
        0 => MAX_EGO_NODES,
        n => n.min(MAX_EGO_NODES),
    };
    let centre = &pages[c];

    let mut linked: Vec<usize> = Vec::new();
    for t in wikilinks(&centre.body) {
        if let Some(i) = resolve(&t, centre, pages) {
            linked.push(i);
        }
    }
    let (centre_slug, centre_stem) = (centre.slug.as_str(), stem(&centre.path));
    for (i, p) in pages.iter().enumerate() {
        if i == c {
            continue;
        }
        // Cheap test on the last segment first; `resolve` confirms it lands on the centre.
        let names_centre = |t: &String| {
            let last = t.rsplit('/').next().unwrap_or(t);
            (last == centre_slug || last == centre_stem) && resolve(t, p, pages) == Some(c)
        };
        if wikilinks(&p.body).iter().any(names_centre) {
            linked.push(i);
        }
    }
    let mut seen = HashSet::new();
    linked.retain(|i| *i != c && seen.insert(*i));
    let hot = |i: usize| heat(&fire_of(fires, &pages[i]), now);
    let by_heat = |a: &usize, b: &usize| hot(*b).total_cmp(&hot(*a)).then(pages[*a].name.to_lowercase().cmp(&pages[*b].name.to_lowercase()));
    linked.sort_by(by_heat);

    let own = folded_topics(centre);
    let mut carriers: HashMap<&str, usize> = own.iter().map(|t| (t.as_str(), 0)).collect();
    let topics: Vec<Vec<String>> = pages.iter().map(folded_topics).collect();
    for t in topics.iter().flatten() {
        if let Some(n) = carriers.get_mut(t.as_str()) {
            *n += 1;
        }
    }
    let is_hub = |t: &str| carriers.get(t).is_some_and(|n| *n > HUB_PAGES);
    let mut rare: Vec<(usize, Vec<String>)> = Vec::new();
    let mut hubbed: Vec<(usize, Vec<String>)> = Vec::new();
    for (i, ts) in topics.iter().enumerate() {
        if i == c || seen.contains(&i) {
            continue;
        }
        let (hubs, rares): (Vec<String>, Vec<String>) = ts.iter().filter(|t| own.contains(t)).cloned().partition(|t| is_hub(t));
        match (rares.is_empty(), hubs.is_empty()) {
            (false, _) => rare.push((i, rares)),
            (true, false) => hubbed.push((i, hubs)),
            (true, true) => {}
        }
    }
    let by_path = |a: &usize, b: &usize| pages[*a].path.cmp(&pages[*b].path);
    rare.sort_by(|(a, sa), (b, sb)| sb.len().cmp(&sa.len()).then(by_heat(a, b)).then(by_path(a, b)));
    hubbed.sort_by(|(a, _), (b, _)| by_heat(a, b).then(by_path(a, b)));

    let total = linked.len() + rare.len();
    let room = limit - 1;
    linked.truncate(room);
    let mut topical = rare;
    topical.extend(hubbed);
    topical.truncate(room - linked.len());

    let kept: Vec<usize> = std::iter::once(c).chain(linked.iter().copied()).chain(topical.iter().map(|(i, _)| *i)).collect();
    let nodes = kept
        .iter()
        .map(|&i| {
            let (p, f) = (&pages[i], fire_of(fires, &pages[i]));
            GraphNode {
                id: p.path.clone(),
                label: p.name.clone(),
                slug: p.slug.clone(),
                page_type: p.page_type.clone(),
                confidence: p.confidence.clone(),
                topics: p.topics.clone(),
                fires: f.count,
                last_fired: f.last,
            }
        })
        .collect();

    let mut edges = Vec::new();
    let mut pairs = HashSet::new();
    for &i in &kept {
        for t in wikilinks(&pages[i].body) {
            let Some(j) = resolve(&t, &pages[i], pages) else { continue };
            if j != i && kept.contains(&j) && pairs.insert((i, j)) {
                let (s, d) = (&pages[i].path, &pages[j].path);
                edges.push(GraphEdge { id: format!("link:{s}->{d}"), source: s.clone(), target: d.clone(), kind: "link".into(), label: String::new() });
            }
        }
    }
    for (i, shared) in &topical {
        let (s, d) = (&centre.path, &pages[*i].path);
        edges.push(GraphEdge { id: format!("topic:{s}->{d}"), source: s.clone(), target: d.clone(), kind: "topic".into(), label: shared.join(", ") });
    }
    VaultGraph { center: path.to_string(), nodes, edges, total, error: None }
}

// --------------------------------------------------------------- health --

/// A rule with `activates_on` that has not fired in this many days needs review.
pub const DORMANT_DAYS: u64 = 30;

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
pub struct Tile {
    pub key: String,
    pub label: String,
    pub value: String,
    pub detail: String,
    /// `ok`, `bad` or `muted`.
    pub tone: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
pub struct Review {
    pub path: String,
    pub slug: String,
    pub name: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
pub struct Health {
    pub root: Option<String>,
    /// `mnemo status` and `mnemo doctor`, ANSI stripped.
    pub status: RunResult,
    pub doctor: RunResult,
    /// The few numbers `status` prints that matter at a glance.
    pub tiles: Vec<Tile>,
    /// `confidence: verified` (or a `verified` key) with no `evidence` behind it.
    pub label_only: Vec<Review>,
    /// `activates_on` set, yet not fired in `DORMANT_DAYS`.
    pub dormant: Vec<Review>,
    /// Shared and project pages, and how many of them never fired at all.
    pub pages: usize,
    pub never_fired: usize,
    /// Proposals staged in `_inbox` folders, rejected ones not counted.
    pub inbox: usize,
    pub error: Option<String>,
}

/// Tiles from `mnemo status`: reflex injection rate, recall primacy, briefings, circuit breaker.
pub fn parse_tiles(status: &str) -> Vec<Tile> {
    let text = strip_ansi(status);
    let tile = |key: &str, label: &str, value: &str, detail: &str, tone: &str| Tile {
        key: key.into(),
        label: label.into(),
        value: value.trim().into(),
        detail: detail.trim().into(),
        tone: tone.into(),
    };
    let mut out = Vec::new();
    for line in text.lines().map(str::trim) {
        if let Some(rest) = line.strip_prefix("reflex: injected on ") {
            // `117 of 2350 prompts (5.0%)`
            let (detail, pct) = rest.rsplit_once(" (").unwrap_or((rest, ""));
            out.push(tile("reflex", "reflex injected", pct.trim_end_matches(')'), detail, "muted"));
        } else if let Some(rest) = line.strip_prefix("recall: ") {
            // `primacy@5 34.4% over 90 cases (mnemo recall, 2026-09-14)`
            let rest = rest.rsplit_once(" (").map_or(rest, |(r, _)| r);
            let mut words = rest.splitn(3, ' ');
            let (metric, value, detail) = (words.next().unwrap_or(""), words.next().unwrap_or(""), words.next().unwrap_or(""));
            out.push(tile("recall", &format!("recall {metric}"), value, detail, "muted"));
        } else if let Some(rest) = line.strip_prefix("Briefings: ") {
            // `362 across 14 agents (2.5 MB) — 0 prunable (…)`
            let head = rest.split(" — ").next().unwrap_or(rest);
            let (value, detail) = head.split_once(' ').unwrap_or((head, ""));
            out.push(tile("briefings", "briefings", value, detail, "muted"));
        } else if let Some(rest) = line.strip_prefix("Circuit breaker: ") {
            // `closed (ok)`
            let (state, note) = rest.split_once(" (").map_or((rest, ""), |(s, n)| (s, n.trim_end_matches(')')));
            let ok = note == "ok" || (note.is_empty() && state == "closed");
            out.push(tile("breaker", "circuit breaker", state, note, if ok { "ok" } else { "bad" }));
        }
    }
    out
}

/// Frontmatter keys that are `key` or nested under it, with a non-empty value.
fn has_key(page: &Page, key: &str) -> bool {
    let meta = format!("metadata.{key}");
    page.frontmatter.iter().any(|f| {
        let k = f.key.as_str();
        let under = |p: &str| k == p || k.strip_prefix(p).is_some_and(|r| r.starts_with('.'));
        (under(key) || under(&meta)) && !f.value.trim().is_empty()
    })
}

fn is_label_only(page: &Page) -> bool {
    let verified_key = page.frontmatter.iter().any(|f| {
        (f.key == "verified" || f.key == "metadata.verified") && !matches!(f.value.trim().to_lowercase().as_str(), "" | "false" | "no")
    });
    let verified = verified_key || page.info.confidence.as_deref().is_some_and(|c| c.eq_ignore_ascii_case("verified"));
    verified && !has_key(page, "evidence")
}

const DAY_MS: u64 = 24 * 60 * 60 * 1000;

/// `activates_on` set, yet not fired in `DORMANT_DAYS` as of `now`: why, else None.
fn dormant_reason(page: &Page, fire: &Fire, now: u64) -> Option<String> {
    let cutoff = now.saturating_sub(DORMANT_DAYS * DAY_MS);
    if !has_key(page, "activates_on") || fire.last.is_some_and(|t| t >= cutoff) {
        return None;
    }
    Some(match fire.last {
        None => "has activates_on, never fired".to_string(),
        Some(t) => format!("has activates_on, last fired {} days ago", now.saturating_sub(t) / DAY_MS),
    })
}

const LABEL_ONLY: &str = "verified without evidence";

/// Why `page` needs review as of `now`: verified without evidence, a dormant activation.
pub fn review_reasons(page: &Page, fire: &Fire, now: u64) -> Vec<String> {
    is_label_only(page).then(|| LABEL_ONLY.to_string()).into_iter().chain(dormant_reason(page, fire, now)).collect()
}

/// The needs-review lists and counts over `pages`, as of `now` (ms since the epoch).
pub fn review(pages: &[Page], fires: &Fires, now: u64) -> (Vec<Review>, Vec<Review>, usize) {
    let item = |p: &Page, reason: String| Review { path: p.info.path.clone(), slug: p.info.slug.clone(), name: p.info.name.clone(), reason };
    let mut label_only = Vec::new();
    let mut dormant = Vec::new();
    let mut never = 0;
    for p in pages {
        let fire = fire_of(fires, &p.info);
        if fire.count == 0 {
            never += 1;
        }
        if is_label_only(p) {
            label_only.push(item(p, LABEL_ONLY.into()));
        }
        if let Some(reason) = dormant_reason(p, &fire, now) {
            dormant.push(item(p, reason));
        }
    }
    let by_name = |a: &Review, b: &Review| a.name.to_lowercase().cmp(&b.name.to_lowercase()).then(a.path.cmp(&b.path));
    label_only.sort_by(by_name);
    dormant.sort_by(by_name);
    (label_only, dormant, never)
}

/// `.md` files under `shared/_inbox` and each agent's `memory/_inbox`, `rejected-*` folders skipped.
pub fn inbox_files(root: &Path) -> Vec<PathBuf> {
    fn walk(dir: &Path, depth: usize, out: &mut Vec<PathBuf>) {
        let Ok(rd) = std::fs::read_dir(dir) else { return };
        let mut entries: Vec<PathBuf> = rd.flatten().map(|e| e.path()).collect();
        entries.sort();
        for p in entries {
            let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            if name.starts_with('.') || name.starts_with("rejected") {
                continue;
            }
            if p.is_dir() {
                if depth > 1 {
                    walk(&p, depth - 1, out);
                }
            } else if name.ends_with(".md") {
                out.push(p);
            }
        }
    }
    let mut out = Vec::new();
    for (_, _, dir) in agent_dirs(root) {
        walk(&dir.join("_inbox"), 3, &mut out);
    }
    out
}

pub fn count_inbox(root: &Path) -> usize {
    inbox_files(root).len()
}

/// The slugs the staged proposals would write: a live page with one of them has a rewrite waiting.
pub fn inbox_slugs(root: &Path) -> HashSet<String> {
    inbox_files(root).iter().filter_map(|f| read_page(f)).map(|p| p.info.slug).collect()
}

/// Every shared and project page, noise agents left out, in `agent_dirs` order.
pub fn live_pages(root: &Path) -> Vec<LivePage> {
    agent_dirs(root)
        .into_iter()
        .filter(|(_, kind, _)| *kind != "other")
        .flat_map(|(agent, _, dir)| page_files(&dir).into_iter().filter_map(|f| read_page(&f)).map(move |page| LivePage { agent: agent.clone(), page }))
        .collect()
}

/// Everything in `Health` that reads the disk only: shared and project pages, noise left out.
pub fn health_at(root: &Path, fires: &Fires, now: u64) -> Health {
    let pages: Vec<Page> = live_pages(root).into_iter().map(|p| p.page).collect();
    let (label_only, dormant, never_fired) = review(&pages, fires, now);
    Health {
        root: Some(root.to_string_lossy().replace('\\', "/")),
        label_only,
        dormant,
        pages: pages.len(),
        never_fired,
        inbox: count_inbox(root),
        ..Default::default()
    }
}

// ---------------------------------------------------------------- level --

/// A page counts toward `fired_recent` when it fired within this many days.
pub const RECENT_FIRE_DAYS: u64 = 7;

/// What the sidebar square renders: `health_at`'s counts without its lists, plus the fire
/// totals the xp formula reads. No subprocess, so the square can poll it.
#[derive(Debug, Clone, Serialize, PartialEq, Default)]
pub struct VaultLevel {
    pub root: Option<String>,
    /// Shared and project pages, noise left out.
    pub pages: usize,
    /// Pages that fired at least once.
    pub rules_fired: usize,
    /// Every fire of those pages on record (the logs are a window, so this can fall).
    pub fires: usize,
    /// Pages that fired within `RECENT_FIRE_DAYS`.
    pub fired_recent: usize,
    pub dormant: usize,
    pub label_only: usize,
    /// Proposals staged in `_inbox` folders, rejected ones not counted.
    pub inbox: usize,
    pub error: Option<String>,
}

/// The square's numbers over `pages`, as of `now`.
pub fn level_of(pages: &[LivePage], fires: &Fires, inbox: usize, now: u64) -> VaultLevel {
    let cutoff = now.saturating_sub(RECENT_FIRE_DAYS * DAY_MS);
    let mut out = VaultLevel { pages: pages.len(), inbox, ..Default::default() };
    for p in pages {
        let page = &p.page;
        let fire = fire_of(fires, &page.info);
        if fire.count > 0 {
            out.rules_fired += 1;
            out.fires += fire.count as usize;
        }
        if fire.last.is_some_and(|t| t >= cutoff) {
            out.fired_recent += 1;
        }
        if is_label_only(page) {
            out.label_only += 1;
        }
        if dormant_reason(page, &fire, now).is_some() {
            out.dormant += 1;
        }
    }
    out
}

fn level_best_path() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default().join(".mnemo-desktop").join("vault-level.json")
}

/// The highest xp in the file at `path` after offering `xp`; written only when `xp` beats it.
/// An unreadable file counts as 0, so the worst case is a level that restarts, never a crash.
pub fn record_best(path: &Path, xp: u64) -> u64 {
    let best = std::fs::read_to_string(path)
        .ok()
        .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
        .and_then(|v| v.get("best_xp")?.as_u64())
        .unwrap_or(0);
    if xp <= best {
        return best;
    }
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let _ = std::fs::write(path, serde_json::json!({ "best_xp": xp }).to_string());
    xp
}

// ------------------------------------------------------------ allowlist --

/// The subcommands the pane may run, and nothing else.
pub const ACTIONS: &[&str] = &["disable-rule", "why", "reverify", "rewrites", "learn", "status", "stale"];

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
        // The health panel runs it in the current repo: stale-ness is checked against its git.
        "stale" => &[("--json", None)],
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
    match check_run(action, args) {
        Ok(()) => exec(program, path_env, action, args, cwd),
        Err(stderr) => RunResult { stderr, ..Default::default() },
    }
}

/// `run_with` without the allowlist: only for fixed commands this file spells out.
fn exec(program: &str, path_env: &str, action: &str, args: &[String], cwd: &str) -> RunResult {
    let refuse = |stderr: String| RunResult { stderr, ..Default::default() };
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

/// What the table and the ego graph read, kept `PAGES_TTL` so typing in the filter or clicking
/// through neighbours does not re-read a few thousand files each time.
struct PagesCache {
    root: PathBuf,
    at: std::time::Instant,
    pages: std::sync::Arc<Vec<LivePage>>,
    inbox: std::sync::Arc<HashSet<String>>,
    fires: std::sync::Arc<Fires>,
}

const PAGES_TTL: std::time::Duration = std::time::Duration::from_secs(10);

static PAGES: std::sync::Mutex<Option<PagesCache>> = std::sync::Mutex::new(None);

type Snapshot = (std::sync::Arc<Vec<LivePage>>, std::sync::Arc<HashSet<String>>, std::sync::Arc<Fires>);

/// The live pages, inbox slugs and fires of the vault at `root`, from the cache when fresh.
fn snapshot(root: &Path) -> Snapshot {
    if let Ok(guard) = PAGES.lock() {
        if let Some(c) = guard.as_ref().filter(|c| c.root == root && c.at.elapsed() < PAGES_TTL) {
            return (c.pages.clone(), c.inbox.clone(), c.fires.clone());
        }
    }
    let fresh = PagesCache {
        root: root.to_path_buf(),
        at: std::time::Instant::now(),
        pages: std::sync::Arc::new(live_pages(root)),
        inbox: std::sync::Arc::new(inbox_slugs(root)),
        fires: std::sync::Arc::new(read_fires(root)),
    };
    let out = (fresh.pages.clone(), fresh.inbox.clone(), fresh.fires.clone());
    if let Ok(mut guard) = PAGES.lock() {
        *guard = Some(fresh);
    }
    out
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}

const NO_VAULT: &str = "no mnemo vault found (`mnemo status` names none)";

/// The health table: rules in `scope` (empty, `agent:<name>` or `topic:<name>`) matching
/// `filter`, hottest first. No vault or a bad scope is no rows.
#[tauri::command]
pub async fn vault_rules(scope: String, filter: String) -> Vec<RuleRow> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(root) = vault_root() else { return vec![] };
        let (pages, inbox, fires) = snapshot(&root);
        rule_rows(&pages, &scope, &filter, &fires, &inbox, now_ms()).unwrap_or_default()
    })
    .await
    .unwrap_or_default()
}

/// The page at `path` and at most `limit` (≤ `MAX_EGO_NODES`) nodes of its neighbourhood.
#[tauri::command]
pub async fn vault_ego(path: String, limit: u32) -> VaultGraph {
    tauri::async_runtime::spawn_blocking(move || match vault_root() {
        Some(root) => {
            let (pages, _, fires) = snapshot(&root);
            let infos: Vec<PageInfo> = pages.iter().map(|p| p.page.info.clone()).collect();
            ego_graph(&path, &infos, &fires, limit, now_ms())
        }
        None => VaultGraph { center: path.clone(), error: Some(NO_VAULT.into()), ..Default::default() },
    })
    .await
    .unwrap_or_else(|e| VaultGraph { error: Some(e.to_string()), ..Default::default() })
}

#[tauri::command]
pub async fn vault_health() -> Health {
    tauri::async_runtime::spawn_blocking(|| {
        let path = crate::mission::login_path();
        let (status, doctor) = std::thread::scope(|s| {
            let doctor = s.spawn(|| exec("mnemo", &path, "doctor", &[], ""));
            (exec("mnemo", &path, "status", &[], ""), doctor.join().unwrap_or_default())
        });
        let mut health = match vault_root() {
            Some(root) => health_at(&root, &read_fires(&root), now_ms()),
            None => Health { error: Some(NO_VAULT.into()), ..Default::default() },
        };
        health.tiles = parse_tiles(&status.stdout);
        health.status = status;
        health.doctor = doctor;
        health
    })
    .await
    .unwrap_or_else(|e| Health { error: Some(e.to_string()), ..Default::default() })
}

/// The square's numbers: the page walk and the fire logs (cached like the table), no `mnemo`.
#[tauri::command]
pub async fn vault_level() -> VaultLevel {
    tauri::async_runtime::spawn_blocking(|| match vault_root() {
        Some(root) => {
            let (pages, _, fires) = snapshot(&root);
            VaultLevel { root: Some(root.to_string_lossy().replace('\\', "/")), ..level_of(&pages, &fires, count_inbox(&root), now_ms()) }
        }
        None => VaultLevel { error: Some(NO_VAULT.into()), ..Default::default() },
    })
    .await
    .unwrap_or_else(|e| VaultLevel { error: Some(e.to_string()), ..Default::default() })
}

/// Offers `xp` as the highest ever seen; returns the highest ever seen. The level reads this,
/// so a rule retired by the friction loop moves the colour and not the bar.
#[tauri::command]
pub async fn vault_level_best(xp: u64) -> u64 {
    tauri::async_runtime::spawn_blocking(move || record_best(&level_best_path(), xp)).await.unwrap_or(xp)
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
        assert_eq!(paths.len(), 6, "{paths:?}");
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
    fn allowlist_accepts_the_seven_actions_with_their_arguments() {
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
        assert_eq!(ok("stale", &["--json"]), Ok(()));
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
        bad("stale", &["--repo", "/etc"]);
        bad("doctor", &[]);
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

    // ---- fires

    /// 2026-09-15T12:00:00Z, the fixture logs' "now".
    const NOW: u64 = 1_789_473_600_000;

    fn fixture_fires() -> Fires {
        read_fires(Path::new(FIXTURE))
    }

    /// The fire of rows dated `times`, in log order.
    fn fire(times: &[&str]) -> Fire {
        let times: Vec<u64> = times.iter().map(|t| crate::mission::iso_ms(t).unwrap()).collect();
        Fire { count: times.len() as u32, last: times.iter().max().copied(), times }
    }

    #[test]
    fn rule_ids_name_their_slug() {
        assert_eq!(rule_slug("mnemo-desktop__shared-target-dir"), "shared-target-dir");
        assert_eq!(rule_slug("project/clubinho__sprints"), "sprints");
        assert_eq!(rule_slug("plain"), "plain");
    }

    #[test]
    fn fires_count_reflex_emissions_and_mcp_reads_not_candidates_or_other_tools() {
        let fires = fixture_fires();
        assert_eq!(fires.get("run-tests-before-commit"), Some(&fire(&["2026-09-14T08:00:00Z", "2026-09-15T11:00:00Z"])));
        assert_eq!(fires.get("Run the full test suite before committing"), Some(&fire(&["2026-09-12T10:00:00Z"])));
        // The rotated log is read first.
        assert_eq!(fires.get("shared-target-dir"), Some(&fire(&["2026-09-01T10:00:00Z", "2026-09-15T11:00:00Z"])));
        assert_eq!(fires.get("no-silent-contract-changes").map(|f| f.count), Some(1));
        assert_eq!(fires.get("dormant-activation").map(|f| f.count), Some(1));
        // A candidate that did not fire, and a `list_rules_by_topic` hit, are not fires.
        assert_eq!(fires.get("verified-without-evidence"), None);
        assert_eq!(fires.len(), 5, "{fires:?}");
        assert!(read_fires(Path::new("/definitely/not/a/vault")).is_empty());
    }

    #[test]
    fn a_page_fires_by_slug_and_by_name() {
        let fires = fixture_fires();
        let page = page_at(Path::new(FIXTURE), &format!("{FIXTURE}/shared/feedback/run-tests-before-commit.md")).info;
        assert_eq!(fire_of(&fires, &page), fire(&["2026-09-14T08:00:00Z", "2026-09-15T11:00:00Z", "2026-09-12T10:00:00Z"]));
    }

    // ---- rules

    fn fixture() -> String {
        FIXTURE.replace('\\', "/")
    }

    fn rows_of(scope: &str, filter: &str) -> Result<Vec<RuleRow>, String> {
        let root = Path::new(FIXTURE);
        rule_rows(&live_pages(root), scope, filter, &fixture_fires(), &inbox_slugs(root), NOW)
    }

    fn slugs(rows: &[RuleRow]) -> Vec<&str> {
        rows.iter().map(|r| r.slug.as_str()).collect()
    }

    #[test]
    fn heat_halves_every_thirty_days_and_ignores_undated_fires() {
        let day = |d: u64| NOW - d * DAY_MS;
        let fire = |times: Vec<u64>| Fire { count: times.len() as u32 + 1, last: times.iter().max().copied(), times };
        assert_eq!(heat(&fire(vec![NOW]), NOW), 1.0);
        assert!((heat(&fire(vec![day(30)]), NOW) - 0.5).abs() < 1e-9);
        assert!((heat(&fire(vec![day(60), day(30), NOW]), NOW) - 1.75).abs() < 1e-9);
        // Another machine's clock ahead of ours: counts as now, never more.
        assert_eq!(heat(&fire(vec![NOW + DAY_MS]), NOW), 1.0);
        assert_eq!(heat(&Fire { count: 4, last: None, times: vec![] }, NOW), 0.0);
    }

    #[test]
    fn rows_are_every_live_rule_hottest_first_with_their_badges_and_reasons() {
        let rows = rows_of("", "").unwrap();
        // Heat, not count: shared-target-dir (2 fires, one a fortnight old) passes
        // no-silent-contract-changes (1), and dormant-activation's July fire has cooled to almost nothing.
        assert_eq!(slugs(&rows), ["run-tests-before-commit", "shared-target-dir", "no-silent-contract-changes", "dormant-activation", "verified-without-evidence"]);
        let view: Vec<(&str, &str, u32, Vec<&str>, Vec<&str>)> = rows
            .iter()
            .map(|r| (r.slug.as_str(), r.agent.as_str(), r.fires, r.badges.iter().map(String::as_str).collect(), r.reasons.iter().map(String::as_str).collect()))
            .collect();
        assert_eq!(
            view,
            [
                ("run-tests-before-commit", "shared", 3, vec!["inbox"], vec![]),
                ("shared-target-dir", "mnemo-desktop", 2, vec![], vec![]),
                ("no-silent-contract-changes", "mnemo-desktop", 1, vec![], vec![]),
                ("dormant-activation", "shared", 1, vec!["review"], vec!["has activates_on, last fired 76 days ago"]),
                ("verified-without-evidence", "shared", 0, vec!["never", "review"], vec!["verified without evidence", "has activates_on, never fired"]),
            ]
        );
        let run = &rows[0];
        assert!((run.heat - 2.9037).abs() < 1e-3, "{}", run.heat);
        assert_eq!((run.name.as_str(), run.page_type.as_str(), run.confidence.as_deref()), ("Run the full test suite before committing", "feedback", Some("verified")));
        assert_eq!(run.last_fired, crate::mission::iso_ms("2026-09-15T11:00:00Z"));
        assert_eq!(run.path, format!("{}/shared/feedback/run-tests-before-commit.md", fixture()));
        assert_eq!(rows[4].heat, 0.0);
        assert_eq!(rows[4].last_fired, None);
    }

    #[test]
    fn rows_narrow_to_a_scope_and_to_every_filter_term() {
        assert_eq!(slugs(&rows_of("agent:mnemo-desktop", "").unwrap()), ["shared-target-dir", "no-silent-contract-changes"]);
        assert_eq!(slugs(&rows_of("all", "").unwrap()).len(), 5);
        assert_eq!(slugs(&rows_of("topic:BUILD", "").unwrap()), ["shared-target-dir", "dormant-activation"]);
        // Terms match name, description, topics and body, case-folded, all of them.
        assert_eq!(slugs(&rows_of("", "cargo TARGET").unwrap()), ["shared-target-dir"]);
        assert_eq!(slugs(&rows_of("", "workflow").unwrap()), ["run-tests-before-commit", "dormant-activation"]);
        assert_eq!(slugs(&rows_of("shared", "diff claiming").unwrap()), ["verified-without-evidence"]);
        assert!(rows_of("", "cargo nothing-matches").unwrap().is_empty());
        // Noise agents are not rules of the table.
        assert!(rows_of("agent:bg-T-pytest-of-user-pytest-12-test-lean-child0-lean", "").unwrap().is_empty());
        assert!(rows_of("agent:../x", "").is_err());
    }

    #[test]
    fn inbox_slugs_are_the_staged_proposals_not_the_rejected_ones() {
        assert_eq!(inbox_slugs(Path::new(FIXTURE)), HashSet::from(["run-tests-before-commit".to_string()]));
        assert_eq!(count_inbox(Path::new(FIXTURE)), 1);
    }

    #[test]
    fn rows_serialize_with_type_and_snake_case_keys() {
        let v = serde_json::to_value(&rows_of("", "").unwrap()[0]).unwrap();
        assert_eq!(v["type"], "feedback");
        assert_eq!(v["badges"][0], "inbox");
        assert!(v["heat"].is_f64() && v["last_fired"].is_u64());
    }

    // ---- ego

    fn ego_of(path: &str, limit: u32) -> VaultGraph {
        let infos: Vec<PageInfo> = live_pages(Path::new(FIXTURE)).into_iter().map(|p| p.page.info).collect();
        ego_graph(&format!("{}{path}", fixture()), &infos, &fixture_fires(), limit, NOW)
    }

    fn ids(g: &VaultGraph) -> Vec<String> {
        g.nodes.iter().map(|n| n.id.replace(&fixture(), "")).collect()
    }

    fn edges(g: &VaultGraph) -> Vec<(String, String, String, String)> {
        g.edges.iter().map(|e| (e.source.replace(&fixture(), ""), e.target.replace(&fixture(), ""), e.kind.clone(), e.label.clone())).collect()
    }

    fn e(s: &str, t: &str, kind: &str, label: &str) -> (String, String, String, String) {
        (s.into(), t.into(), kind.into(), label.into())
    }

    #[test]
    fn scopes_are_an_agent_or_a_topic_and_never_a_path() {
        assert_eq!(parse_scope("agent:shared"), Ok(Scope::Agent("shared".into())));
        assert_eq!(parse_scope("mnemo-desktop"), Ok(Scope::Agent("mnemo-desktop".into())));
        assert_eq!(parse_scope(" topic: testing "), Ok(Scope::Topic("testing".into())));
        for bad in ["", "agent:", "topic:", "agent:../x", "agent:a/b", "topic:.hidden", "..", "a\\b"] {
            assert!(parse_scope(bad).is_err(), "{bad:?} passed");
        }
    }

    #[test]
    fn wikilinks_take_the_target_and_skip_code_fences() {
        let body = "See [[a]] and [[dir/b.md|label]], [[c#Why]].\n```\n[[in-code]]\n```\n[[ ]] [[unclosed";
        assert_eq!(wikilinks(body), strs(&["a", "dir/b", "c"]));
    }

    #[test]
    fn ego_holds_the_centre_then_pages_it_links_to_and_from_across_agents() {
        let g = ego_of("/bots/mnemo-desktop/memory/shared-target-dir.md", 30);
        assert_eq!(g.error, None);
        // Out-link and in-link, hottest first; dormant-activation shares `build` but a link outranks that.
        assert_eq!(ids(&g), ["/bots/mnemo-desktop/memory/shared-target-dir.md", "/bots/mnemo-desktop/memory/no-silent-contract-changes.md", "/shared/project/dormant-activation.md"]);
        assert_eq!(g.total, 2);
        assert_eq!(
            edges(&g),
            [
                e("/bots/mnemo-desktop/memory/shared-target-dir.md", "/bots/mnemo-desktop/memory/no-silent-contract-changes.md", "link", ""),
                e("/shared/project/dormant-activation.md", "/bots/mnemo-desktop/memory/shared-target-dir.md", "link", ""),
            ]
        );
        let centre = &g.nodes[0];
        assert_eq!((centre.label.as_str(), centre.slug.as_str(), centre.page_type.as_str(), centre.fires), ("shared-target-dir", "shared-target-dir", "project", 2));
    }

    #[test]
    fn ego_adds_topic_neighbours_after_links_and_cuts_at_the_limit() {
        let g = ego_of("/shared/feedback/run-tests-before-commit.md", 0);
        assert_eq!(ids(&g), ["/shared/feedback/run-tests-before-commit.md", "/shared/feedback/verified-without-evidence.md", "/shared/project/dormant-activation.md"]);
        // The briefing link lands on no page and is dropped.
        assert_eq!(
            edges(&g),
            [
                e("/shared/feedback/verified-without-evidence.md", "/shared/feedback/run-tests-before-commit.md", "link", ""),
                e("/shared/feedback/run-tests-before-commit.md", "/shared/project/dormant-activation.md", "topic", "workflow"),
            ]
        );
        let cut = ego_of("/shared/feedback/run-tests-before-commit.md", 2);
        assert_eq!((ids(&cut).len(), cut.total, cut.edges.len()), (2, 2, 1));
        assert_eq!(ego_of("/shared/feedback/run-tests-before-commit.md", 1).nodes.len(), 1);
    }

    #[test]
    fn ego_ranks_topic_neighbours_by_topics_shared_then_heat_and_never_passes_thirty_nodes() {
        let page = |slug: &str, topics: &[&str]| PageInfo { path: format!("/v/shared/feedback/{slug}.md"), slug: slug.into(), name: slug.into(), topics: strs(topics), ..Default::default() };
        let mut pages = vec![page("centre", &["a", "B"]), page("one", &["a"]), page("hot", &["a"]), page("both", &["b", "A", "c"]), page("none", &["c"])];
        pages.extend((0..60).map(|i| page(&format!("n{i:02}"), &["a"])));
        let fires: Fires = [("hot".to_string(), Fire { count: 1, last: Some(NOW), times: vec![NOW] })].into();
        let g = ego_graph("/v/shared/feedback/centre.md", &pages, &fires, 500, NOW);
        let labels: Vec<&str> = g.nodes.iter().map(|n| n.label.as_str()).collect();
        assert_eq!(&labels[..4], ["centre", "both", "hot", "n00"]);
        assert_eq!((g.nodes.len(), g.total), (MAX_EGO_NODES, 63));
        assert!(!labels.contains(&"none"));
        assert_eq!(g.edges[0].label, "a, b");
    }

    #[test]
    fn ego_ranks_links_then_rare_topics_then_hubs_and_counts_no_hub_page() {
        let page = |slug: &str, topics: &[&str], body: &str| PageInfo { path: format!("/v/shared/feedback/{slug}.md"), slug: slug.into(), name: slug.into(), topics: strs(topics), body: body.into(), ..Default::default() };
        let mut pages = vec![
            page("centre", &["auto-promoted", "git", "worktrees"], "[[out]]"),
            page("out", &["auto-promoted"], ""),
            page("in", &[], "[[centre]]"),
            page("git", &["git", "auto-promoted"], ""),
            page("both", &["Git", "worktrees"], ""),
        ];
        // 150 pages carry the hub; the hottest of them still ranks after every rare-topic page.
        pages.extend((0..150).map(|i| page(&format!("h{i:03}"), &["auto-promoted"], "")));
        let fires: Fires = [("h149".to_string(), Fire { count: 9, last: Some(NOW), times: vec![NOW; 9] })].into();
        let g = ego_graph("/v/shared/feedback/centre.md", &pages, &fires, 12, NOW);
        let labels: Vec<&str> = g.nodes.iter().map(|n| n.label.as_str()).collect();
        assert_eq!(&labels[..6], ["centre", "in", "out", "both", "git", "h149"]);
        assert_eq!((g.nodes.len(), g.total), (12, 4));
        let label_of = |slug: &str| g.edges.iter().find(|e| e.kind == "topic" && e.target.ends_with(&format!("/{slug}.md"))).map(|e| e.label.as_str());
        // A rare neighbour is labelled by the rare topics that ranked it, a hub-only one by the hub.
        assert_eq!((label_of("both"), label_of("git"), label_of("h149"), label_of("out")), (Some("git, worktrees"), Some("git"), Some("auto-promoted"), None));

        // With exactly `HUB_PAGES` carriers the topic is rare again and every carrier counts.
        let rare: Vec<PageInfo> = pages.iter().take(5 + HUB_PAGES - 3).cloned().collect();
        let g = ego_graph("/v/shared/feedback/centre.md", &rare, &Fires::new(), 12, NOW);
        assert_eq!(g.total, 2 + 2 + HUB_PAGES - 3);
    }

    #[test]
    fn ego_links_resolve_to_the_page_in_the_same_folder_first() {
        let page = |path: &str, body: &str| PageInfo { path: path.into(), slug: stem(path).into(), name: path.into(), body: body.into(), ..Default::default() };
        let pages = vec![page("/v/bots/a/memory/x.md", ""), page("/v/bots/b/memory/centre.md", "[[x]] [[bots/a/memory/x]]"), page("/v/bots/b/memory/x.md", "")];
        let g = ego_graph("/v/bots/b/memory/centre.md", &pages, &Fires::new(), 30, NOW);
        let targets: Vec<&str> = g.edges.iter().map(|e| e.target.as_str()).collect();
        assert_eq!(targets, ["/v/bots/b/memory/x.md", "/v/bots/a/memory/x.md"]);
    }

    #[test]
    fn ego_of_a_path_that_is_no_rule_is_an_error() {
        let g = ego_of("/shared/_inbox/run-tests-before-commit.md", 30);
        assert!(g.error.unwrap().contains("not a rule in the vault"));
        assert!(g.nodes.is_empty());
        let v = serde_json::to_value(&ego_of("/shared/feedback/run-tests-before-commit.md", 30)).unwrap();
        assert_eq!(v["nodes"][0]["type"], "feedback");
        assert_eq!(v["edges"][1]["label"], "workflow");
        assert!(v["center"].as_str().unwrap().ends_with("run-tests-before-commit.md"));
        assert!(v["error"].is_null());
    }

    /// The square's numbers on the real vault, to calibrate `src/vaultlevel/level.ts`:
    /// `cargo test --lib level_live -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn level_live() {
        let root = vault_root().expect("a mnemo vault");
        let t = std::time::Instant::now();
        let (pages, _, fires) = snapshot(&root);
        let l = level_of(&pages, &fires, count_inbox(&root), now_ms());
        println!("{l:?} in {:?}", t.elapsed());
    }

    /// Against the real vault: `cargo test --lib vault_live -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn vault_live() {
        let root = vault_root().expect("a mnemo vault");
        let t = std::time::Instant::now();
        let (pages, inbox, fires) = snapshot(&root);
        let read = t.elapsed();
        let t = std::time::Instant::now();
        let rows = rule_rows(&pages, "", "", &fires, &inbox, now_ms()).unwrap();
        let filtered = rule_rows(&pages, "", "test", &fires, &inbox, now_ms()).unwrap();
        let ranked = t.elapsed();
        let infos: Vec<PageInfo> = pages.iter().map(|p| p.page.info.clone()).collect();
        let t = std::time::Instant::now();
        let g = ego_graph(&rows[0].path, &infos, &fires, 30, now_ms());
        println!("read {} pages in {read:?}; {} rows, {} filtered in {ranked:?}; ego of {} in {:?}: {} nodes of {}, {} edges", pages.len(), rows.len(), filtered.len(), rows[0].slug, t.elapsed(), g.nodes.len(), g.total, g.edges.len());
        for r in rows.iter().take(5) {
            println!("  {:.2} {} {} {:?}", r.heat, r.fires, r.slug, r.badges);
        }
        assert!(snapshot(&root).0.len() == pages.len());
    }

    // ---- health

    #[test]
    fn tiles_parse_the_numbers_mnemo_status_prints() {
        let status = "Vault: /v  (exists)\nBriefings: 362 across 14 agents (2.5 MB) — 0 prunable (retention 180d, keep 20/agent)\n\
            Circuit breaker: closed (ok)\nReflex: enabled (3 emissions today)\n\nNumbers (last 14 days):\n\
            \u{1b}[1m  reflex: injected on 117 of 2350 prompts (5.0%)\u{1b}[0m\n  recall: primacy@5 34.4% over 90 cases (mnemo recall, 2026-09-14)\n";
        let parsed = parse_tiles(status);
        let tiles: Vec<_> = parsed.iter().map(|t| (t.key.as_str(), t.label.as_str(), t.value.as_str(), t.detail.as_str(), t.tone.as_str())).collect();
        assert_eq!(
            tiles,
            [
                ("briefings", "briefings", "362", "across 14 agents (2.5 MB)", "muted"),
                ("breaker", "circuit breaker", "closed", "ok", "ok"),
                ("reflex", "reflex injected", "5.0%", "117 of 2350 prompts", "muted"),
                ("recall", "recall primacy@5", "34.4%", "over 90 cases", "muted"),
            ]
        );
        assert_eq!(parse_tiles("Circuit breaker: open (3 failures)\n")[0].tone, "bad");
        assert!(parse_tiles("mnemo: command not found").is_empty());
    }

    #[test]
    fn health_lists_label_only_verified_and_dormant_activations_and_counts_the_inbox() {
        let h = health_at(Path::new(FIXTURE), &fixture_fires(), NOW);
        let rows = |r: &[Review]| r.iter().map(|x| (x.slug.clone(), x.reason.clone())).collect::<Vec<_>>();
        assert_eq!(rows(&h.label_only), [("verified-without-evidence".to_string(), "verified without evidence".to_string())]);
        assert_eq!(
            rows(&h.dormant),
            [
                ("dormant-activation".to_string(), "has activates_on, last fired 76 days ago".to_string()),
                ("verified-without-evidence".to_string(), "has activates_on, never fired".to_string()),
            ]
        );
        assert_eq!(h.dormant[0].path, format!("{}/shared/project/dormant-activation.md", fixture()));
        // Noise agents are not counted; `rejected-*` proposals are not inbox.
        assert_eq!((h.pages, h.never_fired, h.inbox), (5, 1, 1));
        assert_eq!(h.root.as_deref(), Some(FIXTURE.replace('\\', "/").as_str()));
        assert_eq!(h.error, None);
    }

    #[test]
    fn level_counts_fired_recent_dormant_and_label_only_without_a_subprocess() {
        let root = Path::new(FIXTURE);
        let fires = fixture_fires();
        let l = level_of(&live_pages(root), &fires, count_inbox(root), NOW);
        let h = health_at(root, &fires, NOW);
        // The same page walk as `health_at`, so the counts agree with the health pane.
        assert_eq!((l.pages, l.rules_fired, l.dormant, l.label_only, l.inbox), (h.pages, h.pages - h.never_fired, h.dormant.len(), h.label_only.len(), h.inbox));
        assert!(l.fires >= l.rules_fired);
        assert!(l.fired_recent <= l.rules_fired);
        // Far enough in the future, nothing is recent.
        assert_eq!(level_of(&live_pages(root), &fires, 0, NOW + 10_000 * DAY_MS).fired_recent, 0);
    }

    #[test]
    fn the_best_xp_only_climbs() {
        let dir = std::env::temp_dir().join(format!("mnemo-level-{}", std::process::id()));
        let path = dir.join("nested").join("vault-level.json");
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(record_best(&path, 120), 120);
        assert_eq!(record_best(&path, 90), 120);
        assert_eq!(record_best(&path, 300), 300);
        std::fs::write(&path, "not json").unwrap();
        assert_eq!(record_best(&path, 5), 5);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_verified_key_or_evidence_under_metadata_counts() {
        let page = |fm: &str| parse_page(Path::new("/v/shared/feedback/x.md"), &format!("---\n{fm}\n---\nb"), None);
        assert!(is_label_only(&page("verified: 2026-09-01")));
        assert!(!is_label_only(&page("verified: false")));
        assert!(!is_label_only(&page("confidence: verified\nmetadata:\n  evidence:\n    quote: yes")));
        assert!(is_label_only(&page("confidence: Verified\nevidence:")));
        assert!(!is_label_only(&page("confidence: inferred")));
        assert!(has_key(&page("activates_on:\n  - Bash"), "activates_on"));
        assert!(!has_key(&page("activates_onward: x"), "activates_on"));
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

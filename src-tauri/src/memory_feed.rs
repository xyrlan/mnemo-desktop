//! The memory feed: what the right sidebar's Memory panel shows for the worktree and session in
//! front of you, read-only over what mnemo already writes in its vault.
//!
//! - `fired`: the rules that fired in the session. The reflex log (`emitted`) and the MCP access
//!   log (`read_mnemo_rule` hits) carry a `session_id`; the denial log (`pre_tool_use`) carries
//!   only a project and a time, so a denial counts when it is the project's and no older than
//!   the session's first logged row. Without a session, the project's latest fires.
//! - `learned`: the learned ledger (`.mnemo/learned.jsonl`), the pages extraction promoted for
//!   the project, newest first.
//! - `inbox`: the staged pages attributable to the project, as `mnemo inbox --project` lists
//!   them (`inbox.staged_pages`): the `.md` files directly in `shared/_inbox/<type>/`, rewrites
//!   left out, the project read from a `bots/<name>/` source else a `project`/`projects` key.
//! - `briefing`: the project's newest session briefing that is not this session's own.
//!
//! The project is named as mnemo names it (`install_review::project_of`). Reading is pure
//! (`*_from`, `*_at`, `feed_at`); the vault root, the clock's offset and the command are io.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::vault::{lookup, parse_frontmatter, rule_slug, split_frontmatter, Yaml, TYPES};

/// At most this many rows of `fired` and of `learned`: the panel is a glance, not a log.
pub const MAX_FIRED: usize = 50;
pub const MAX_LEARNED: usize = 30;
/// mnemo's `inbox.EXCERPT_CHARS`.
pub const EXCERPT_CHARS: usize = 300;

/// Each log rotates once into `.1`; the older file comes first.
const REFLEX_LOGS: &[&str] = &[".mnemo/reflex-log.jsonl.1", ".mnemo/reflex-log.jsonl"];
const ACCESS_LOGS: &[&str] = &[".mnemo/mcp-access-log.jsonl.1", ".mnemo/mcp-access-log.jsonl"];
const DENIAL_LOGS: &[&str] = &[".mnemo/denial-log.jsonl.1", ".mnemo/denial-log.jsonl"];
/// Rewritten in place when it grows (`learned.MAX_BYTES`), so there is no `.1`.
const LEARNED_LOG: &str = ".mnemo/learned.jsonl";
/// mnemo's staged-rewrite suffixes (`filters.PROPOSED_SUFFIXES`), as in `vault.rs`.
const PROPOSED_SUFFIXES: &[&str] = &[".proposed.md", ".update-proposed.md"];

// ---------------------------------------------------------------- model --

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct MemoryFeed {
    pub project: String,
    pub briefing: Option<Briefing>,
    pub fired: Vec<Fired>,
    pub learned: Vec<Learned>,
    pub inbox: Vec<InboxItem>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Briefing {
    pub session_id: String,
    /// The frontmatter's `date` (`YYYY-MM-DD`), empty when it has none.
    pub date: String,
    pub tldr: String,
    /// Absolute, forward slashes: what `vault_page` takes.
    pub path: String,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    Reflex,
    Mcp,
    Denial,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Fired {
    pub slug: String,
    pub name: String,
    /// ms since the epoch.
    pub at: u64,
    pub source: Source,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Learned {
    pub slug: String,
    pub name: String,
    /// ms since the epoch.
    pub at: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct InboxItem {
    /// `<type>/<slug>`: what `mnemo inbox --promote` / `--drop` take.
    pub key: String,
    #[serde(rename = "type")]
    pub page_type: String,
    pub title: String,
    pub excerpt: String,
}

// ---------------------------------------------------------------- time --

/// An ISO time as mnemo writes them, in ms since the epoch: `…Z` is UTC, anything without a
/// zone is local time (`datetime.now().isoformat()`), read with `offset_ms` east of UTC.
pub fn time_ms(s: &str, offset_ms: i64) -> Option<u64> {
    if s.ends_with('Z') {
        return crate::mission::iso_ms(s);
    }
    let utc = crate::mission::iso_ms(&format!("{s}Z"))? as i64;
    u64::try_from(utc - offset_ms).ok()
}

/// `+0300` / `-0330` (what `date +%z` prints) in ms east of UTC.
pub fn parse_offset(z: &str) -> Option<i64> {
    let z = z.trim();
    let (sign, rest) = match z.as_bytes().first()? {
        b'+' => (1, &z[1..]),
        b'-' => (-1, &z[1..]),
        _ => return None,
    };
    if rest.len() != 4 || !rest.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let (h, m): (i64, i64) = (rest[..2].parse().ok()?, rest[2..].parse().ok()?);
    Some(sign * (h * 60 + m) * 60 * 1000)
}

// --------------------------------------------------------------- fired --

#[derive(Deserialize)]
struct ReflexRow {
    session_id: Option<String>,
    project: Option<String>,
    emitted: Option<Vec<String>>,
    ts: Option<String>,
}

#[derive(Deserialize)]
struct AccessRow {
    session_id: Option<String>,
    project: Option<String>,
    tool: Option<String>,
    hit_slugs: Option<Vec<String>>,
    timestamp: Option<String>,
}

#[derive(Deserialize)]
struct DenialRow {
    project: Option<String>,
    slug: Option<String>,
    timestamp: Option<String>,
}

/// One fire before its rule is named: the id as logged, when, and from where.
#[derive(Debug, Clone, PartialEq)]
pub struct RawFire {
    pub id: String,
    pub at: u64,
    pub source: Source,
}

fn rows<'a, T: Deserialize<'a>>(texts: &[&'a str]) -> Vec<T> {
    texts.iter().flat_map(|t| t.lines()).filter_map(|l| serde_json::from_str::<T>(l).ok()).collect()
}

/// The fires of `session` (else of `project`), newest first, one per rule and source. A
/// denial row has no session: with one given, it counts when it is the project's and no
/// older than the session's first row in the reflex or access log.
pub fn fired_from(reflex: &[&str], access: &[&str], denial: &[&str], project: &str, session: Option<&str>) -> Vec<RawFire> {
    let mine = |row_session: &Option<String>, row_project: &Option<String>| match session {
        Some(s) => row_session.as_deref() == Some(s),
        None => row_project.as_deref() == Some(project),
    };
    let mut start: Option<u64> = None;
    let mut out = Vec::new();
    for row in rows::<ReflexRow>(reflex) {
        if !mine(&row.session_id, &row.project) {
            continue;
        }
        let Some(at) = row.ts.as_deref().and_then(crate::mission::iso_ms) else { continue };
        start = Some(start.map_or(at, |s| s.min(at)));
        out.extend(row.emitted.unwrap_or_default().into_iter().map(|id| RawFire { id, at, source: Source::Reflex }));
    }
    for row in rows::<AccessRow>(access) {
        if !mine(&row.session_id, &row.project) {
            continue;
        }
        let Some(at) = row.timestamp.as_deref().and_then(crate::mission::iso_ms) else { continue };
        start = Some(start.map_or(at, |s| s.min(at)));
        if row.tool.as_deref() == Some("read_mnemo_rule") {
            out.extend(row.hit_slugs.unwrap_or_default().into_iter().map(|id| RawFire { id, at, source: Source::Mcp }));
        }
    }
    // Without a session every row of the project counts; with one, only from its start.
    let since = match session {
        Some(_) => start,
        None => Some(0),
    };
    if let Some(since) = since {
        for row in rows::<DenialRow>(denial) {
            let (Some(id), Some(at)) = (row.slug, row.timestamp.as_deref().and_then(crate::mission::iso_ms)) else { continue };
            if row.project.as_deref() == Some(project) && at >= since {
                out.push(RawFire { id, at, source: Source::Denial });
            }
        }
    }
    out.sort_by_key(|f| std::cmp::Reverse(f.at));
    let mut seen = HashSet::new();
    out.retain(|f| seen.insert((rule_slug(&f.id).to_string(), f.source)));
    out.truncate(MAX_FIRED);
    out
}

fn read_fm(path: &Path) -> Option<Vec<(String, Yaml)>> {
    let text = std::fs::read_to_string(path).ok()?;
    let (yaml, _) = split_frontmatter(&text)?;
    Some(parse_frontmatter(&yaml))
}

fn str_at(fm: &[(String, Yaml)], key: &str) -> Option<String> {
    match lookup(fm, key)? {
        Yaml::Str(s) if !s.is_empty() => Some(s.clone()),
        _ => None,
    }
}

/// The `name` of the page a fire's id names, looked for where mnemo keeps it: the project's
/// `memory/`, then `shared/<type>/` under the id as logged, the bare slug or the slug
/// prefixed with the project (`<project>__<slug>`). None when no such page has a name.
pub fn rule_name(root: &Path, project: &str, id: &str) -> Option<String> {
    let slug = rule_slug(id);
    let last = id.rsplit('/').next().unwrap_or(id);
    // An MCP read may ask by name: no file is named after one.
    if slug.is_empty() || slug.contains(['/', '\\', ' ']) || slug.starts_with('.') {
        return None;
    }
    let mut candidates = vec![root.join("bots").join(project).join("memory").join(format!("{slug}.md"))];
    for t in TYPES {
        let dir = root.join("shared").join(t);
        for stem in [last.to_string(), slug.to_string(), format!("{project}__{slug}")] {
            candidates.push(dir.join(format!("{stem}.md")));
        }
    }
    candidates.iter().filter_map(|p| read_fm(p)).find_map(|fm| str_at(&fm, "name"))
}

/// `raw` named: the slug as `vault.rs` keys fires (`rule_slug`), the page's name else the slug.
pub fn name_fires(root: &Path, project: &str, raw: Vec<RawFire>) -> Vec<Fired> {
    let mut names: HashMap<String, String> = HashMap::new();
    raw.into_iter()
        .map(|f| {
            let slug = rule_slug(&f.id).to_string();
            let name = names.entry(f.id.clone()).or_insert_with(|| rule_name(root, project, &f.id).unwrap_or_else(|| slug.clone())).clone();
            Fired { slug, name, at: f.at, source: f.source }
        })
        .collect()
}

// ------------------------------------------------------------- learned --

#[derive(Deserialize)]
struct LearnedRow {
    ts: Option<String>,
    slug: Option<String>,
    name: Option<String>,
    projects: Option<Vec<String>>,
    seq: Option<u64>,
}

/// The ledger's pages promoted for `project`, newest first (by `seq`, which orders a batch
/// sharing one `ts`), at most `MAX_LEARNED`, one per slug.
pub fn learned_from(text: &str, project: &str, offset_ms: i64) -> Vec<Learned> {
    let mut found: Vec<(u64, usize, Learned)> = Vec::new();
    for (i, row) in rows::<LearnedRow>(&[text]).into_iter().enumerate() {
        if !row.projects.as_ref().is_some_and(|p| p.iter().any(|p| p == project)) {
            continue;
        }
        let (Some(slug), Some(at)) = (row.slug.filter(|s| !s.is_empty()), row.ts.as_deref().and_then(|t| time_ms(t, offset_ms))) else { continue };
        let name = row.name.filter(|n| !n.is_empty()).unwrap_or_else(|| slug.clone());
        found.push((row.seq.unwrap_or(0), i, Learned { slug, name, at }));
    }
    found.sort_by_key(|(seq, i, l)| std::cmp::Reverse((l.at, *seq, *i)));
    let mut seen = HashSet::new();
    found.into_iter().map(|(_, _, l)| l).filter(|l| seen.insert(l.slug.clone())).take(MAX_LEARNED).collect()
}

// --------------------------------------------------------------- inbox --

/// mnemo's `projects_for_rule`: the segment after the last `bots` of each source, else the
/// frontmatter's `projects` list, else its `project`.
pub fn page_projects(fm: &[(String, Yaml)]) -> Vec<String> {
    let sources = match lookup(fm, "sources") {
        Some(Yaml::List(l)) => l.clone(),
        Some(Yaml::Str(s)) if !s.is_empty() => vec![s.clone()],
        _ => vec![],
    };
    let mut out: Vec<String> = sources
        .iter()
        .filter_map(|s| {
            let parts: Vec<&str> = s.split(['/', '\\']).filter(|p| !p.is_empty()).collect();
            let i = parts.iter().take(parts.len().saturating_sub(1)).rposition(|p| *p == "bots")?;
            Some(parts[i + 1].to_string())
        })
        .collect();
    if out.is_empty() {
        out = match (lookup(fm, "projects"), lookup(fm, "project")) {
            (Some(Yaml::List(l)), _) => l.iter().filter(|p| !p.is_empty()).cloned().collect(),
            (_, Some(Yaml::Str(s))) if !s.is_empty() => vec![s.clone()],
            _ => vec![],
        };
    }
    out.sort();
    out.dedup();
    out
}

/// The body's first `EXCERPT_CHARS` characters, whitespace runs folded into one space.
pub fn excerpt(body: &str) -> String {
    body.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(EXCERPT_CHARS).collect()
}

fn mtime(p: &Path) -> std::time::SystemTime {
    std::fs::metadata(p).and_then(|m| m.modified()).unwrap_or(std::time::UNIX_EPOCH)
}

/// The staged pages of `project`, oldest first as `mnemo inbox` lists them (by mtime, then key).
pub fn inbox_at(root: &Path, project: &str) -> Vec<InboxItem> {
    let inbox = root.join("shared").join("_inbox");
    let mut found = Vec::new();
    for t in TYPES {
        let Ok(rd) = std::fs::read_dir(inbox.join(t)) else { continue };
        for path in rd.flatten().map(|e| e.path()) {
            let file = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            if !path.is_file() || !file.ends_with(".md") || PROPOSED_SUFFIXES.iter().any(|s| file.ends_with(s)) {
                continue;
            }
            let Ok(text) = std::fs::read_to_string(&path) else { continue };
            let (fm, body) = match split_frontmatter(&text) {
                Some((yaml, body)) => (parse_frontmatter(&yaml), body),
                None => (vec![], text.clone()),
            };
            if !page_projects(&fm).iter().any(|p| p == project) {
                continue;
            }
            let slug = file.trim_end_matches(".md").to_string();
            let item = InboxItem { key: format!("{t}/{slug}"), page_type: t.to_string(), title: str_at(&fm, "name").unwrap_or(slug), excerpt: excerpt(&body) };
            found.push((mtime(&path), item));
        }
    }
    found.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.key.cmp(&b.1.key)));
    found.into_iter().map(|(_, i)| i).collect()
}

// ------------------------------------------------------------ briefing --

/// The text under `## TL;DR` up to the next heading, else the body's first paragraph that is
/// not a heading.
pub fn tldr(body: &str) -> String {
    let mut lines = body.lines();
    if lines.by_ref().any(|l| l.trim().trim_start_matches('#').trim().eq_ignore_ascii_case("tl;dr") && l.trim_start().starts_with('#')) {
        let section: Vec<&str> = lines.take_while(|l| !l.trim_start().starts_with('#')).collect();
        return section.join("\n").trim().to_string();
    }
    body.split("\n\n").map(str::trim).find(|p| !p.is_empty() && !p.starts_with('#')).unwrap_or("").to_string()
}

/// The newest briefing (by mtime) under `bots/<project>/briefings/sessions/` that is not
/// `session`'s own.
pub fn briefing_at(root: &Path, project: &str, session: Option<&str>) -> Option<Briefing> {
    let dir = root.join("bots").join(project).join("briefings").join("sessions");
    let mut files: Vec<PathBuf> = std::fs::read_dir(dir).ok()?.flatten().map(|e| e.path()).filter(|p| p.is_file() && p.extension().is_some_and(|x| x == "md")).collect();
    files.sort_by_key(|p| std::cmp::Reverse((mtime(p), p.clone())));
    files.into_iter().find_map(|path| {
        let stem = path.file_stem()?.to_string_lossy().to_string();
        let text = std::fs::read_to_string(&path).ok()?;
        let (fm, body) = match split_frontmatter(&text) {
            Some((yaml, body)) => (parse_frontmatter(&yaml), body),
            None => (vec![], text.clone()),
        };
        let session_id = str_at(&fm, "session_id").unwrap_or(stem);
        if Some(session_id.as_str()) == session {
            return None;
        }
        Some(Briefing { session_id, date: str_at(&fm, "date").unwrap_or_default(), tldr: tldr(&body), path: path.to_string_lossy().replace('\\', "/") })
    })
}

// ---------------------------------------------------------------- feed --

fn read_all(root: &Path, rels: &[&str]) -> Vec<String> {
    rels.iter().map(|r| std::fs::read_to_string(root.join(r)).unwrap_or_default()).collect()
}

fn strs(v: &[String]) -> Vec<&str> {
    v.iter().map(String::as_str).collect()
}

/// Everything the panel shows for `project` and `session`, from the vault at `root`.
pub fn feed_at(root: &Path, project: &str, session: Option<&str>, offset_ms: i64) -> MemoryFeed {
    let (reflex, access, denial) = (read_all(root, REFLEX_LOGS), read_all(root, ACCESS_LOGS), read_all(root, DENIAL_LOGS));
    let raw = fired_from(&strs(&reflex), &strs(&access), &strs(&denial), project, session);
    MemoryFeed {
        project: project.to_string(),
        briefing: briefing_at(root, project, session),
        fired: name_fires(root, project, raw),
        learned: learned_from(&std::fs::read_to_string(root.join(LEARNED_LOG)).unwrap_or_default(), project, offset_ms),
        inbox: inbox_at(root, project),
    }
}

/// A session id is a Claude Code UUID or a short id: nothing that could be a path.
pub fn is_session(s: &str) -> bool {
    !s.is_empty() && s.len() <= 128 && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

// ------------------------------------------------------------------ io --

/// mnemo's `resolve_canonical_agent`: the main checkout's name through worktrees, else (outside
/// a repo, or a cwd not probed) the cwd's own folder name, sanitized.
fn project_name(cwd: &str) -> Option<String> {
    if let Some(p) = crate::install_review::project_of(cwd) {
        return Some(p.project);
    }
    let name = Path::new(cwd.trim_end_matches(['/', '\\'])).file_name()?.to_string_lossy().to_string();
    Some(crate::install_review::sanitize(&name))
}

/// This machine's offset from UTC, read once: the learned ledger's times carry no zone. `date`
/// is on every Unix; elsewhere, or when it fails, the times are read as UTC.
fn local_offset_ms() -> i64 {
    static OFFSET: std::sync::OnceLock<i64> = std::sync::OnceLock::new();
    *OFFSET.get_or_init(|| {
        if cfg!(windows) {
            return 0;
        }
        crate::proc::command("date").arg("+%z").output().ok().and_then(|o| parse_offset(&String::from_utf8_lossy(&o.stdout))).unwrap_or(0)
    })
}

fn feed(cwd: &str, session_id: Option<&str>) -> Result<MemoryFeed, String> {
    if cwd.trim().is_empty() {
        return Err("memory feed: no working directory".into());
    }
    let session = session_id.filter(|s| !s.is_empty());
    if let Some(s) = session.filter(|s| !is_session(s)) {
        return Err(format!("memory feed: bad session id {s:?}"));
    }
    let project = project_name(cwd).ok_or_else(|| format!("memory feed: {cwd}: no project"))?;
    let root = crate::vault::vault_root().ok_or("no mnemo vault found (`mnemo status` names none)")?;
    Ok(feed_at(&root, &project, session, local_offset_ms()))
}

// ------------------------------------------------------------ commands --

/// The Memory panel's data for the worktree at `cwd` and, when given, the session in front of
/// you. No vault, or no project, is an error.
#[tauri::command]
pub async fn memory_feed(cwd: String, session_id: Option<String>) -> Result<MemoryFeed, String> {
    tauri::async_runtime::spawn_blocking(move || feed(&cwd, session_id.as_deref())).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::temp_dir;

    const FIXTURE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/fixtures/vault");
    const HOUR: i64 = 3_600_000;

    fn write(root: &Path, rel: &str, text: &str) {
        let p = root.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, text).unwrap();
    }

    fn ms(s: &str) -> u64 {
        crate::mission::iso_ms(s).unwrap()
    }

    fn ids(f: &[RawFire]) -> Vec<(&str, Source)> {
        f.iter().map(|f| (f.id.as_str(), f.source)).collect()
    }

    // ---- time

    #[test]
    fn times_without_a_zone_are_local() {
        assert_eq!(time_ms("2026-09-24T12:40:49Z", -3 * HOUR), Some(ms("2026-09-24T12:40:49Z")));
        assert_eq!(time_ms("2026-09-24T12:40:49", -3 * HOUR), Some(ms("2026-09-24T15:40:49Z")));
        assert_eq!(time_ms("2026-09-24T12:40:49.500", 2 * HOUR), Some(ms("2026-09-24T10:40:49.500Z")));
        assert_eq!(time_ms("yesterday", 0), None);
    }

    #[test]
    fn offsets_read_as_date_prints_them() {
        assert_eq!(parse_offset("-0300\n"), Some(-3 * HOUR));
        assert_eq!(parse_offset("+0530"), Some(5 * HOUR + 30 * 60_000));
        assert_eq!(parse_offset("+0000"), Some(0));
        for bad in ["", "0300", "+03", "+03:00", "UTC"] {
            assert_eq!(parse_offset(bad), None, "{bad}");
        }
    }

    // ---- fired

    const REFLEX: &str = concat!(
        r#"{"session_id": "s1", "project": "app", "emitted": ["app__alpha"], "ts": "2026-09-24T10:00:00Z"}"#, "\n",
        r#"{"session_id": "s1", "project": "app", "emitted": [], "ts": "2026-09-24T09:00:00Z"}"#, "\n",
        "not json\n",
        r#"{"session_id": "s1", "project": "app", "emitted": ["alpha", "shared/beta"], "ts": "2026-09-24T11:00:00Z"}"#, "\n",
        r#"{"session_id": "s2", "project": "app", "emitted": ["gamma"], "ts": "2026-09-24T12:00:00Z"}"#, "\n",
        r#"{"session_id": "s3", "project": "other", "emitted": ["delta"], "ts": "2026-09-24T13:00:00Z"}"#, "\n",
    );
    const ACCESS: &str = concat!(
        r#"{"timestamp": "2026-09-24T10:30:00Z", "tool": "read_mnemo_rule", "project": "app", "session_id": "s1", "hit_slugs": ["beta"]}"#, "\n",
        r#"{"timestamp": "2026-09-24T10:31:00Z", "tool": "list_rules_by_topic", "project": "app", "session_id": "s1", "hit_slugs": ["epsilon"]}"#, "\n",
        r#"{"timestamp": "2026-09-24T08:00:00Z", "tool": "list_rules_by_topic", "project": "app", "session_id": "s4", "hit_slugs": []}"#, "\n",
    );
    const DENIAL: &str = concat!(
        r#"{"timestamp": "2026-09-24T08:59:00Z", "slug": "too-early", "project": "app", "tool": "Bash"}"#, "\n",
        r#"{"timestamp": "2026-09-24T09:30:00Z", "slug": "no-force-push", "project": "app", "tool": "Bash"}"#, "\n",
        r#"{"timestamp": "2026-09-24T09:40:00Z", "slug": "elsewhere", "project": "other", "tool": "Bash"}"#, "\n",
    );

    #[test]
    fn a_session_s_fires_newest_first_one_per_rule_and_source() {
        let f = fired_from(&[REFLEX], &[ACCESS], &[DENIAL], "app", Some("s1"));
        // `alpha` fired twice by reflex (as `app__alpha` and `alpha`): the newest stays.
        // `list_rules_by_topic` is a search, not a fire. The denial before the session's
        // first row, and another project's, are left out.
        assert_eq!(ids(&f), vec![("alpha", Source::Reflex), ("shared/beta", Source::Reflex), ("beta", Source::Mcp), ("no-force-push", Source::Denial)]);
        assert_eq!(f[0].at, ms("2026-09-24T11:00:00Z"));
    }

    #[test]
    fn a_session_with_no_row_has_no_denials() {
        assert!(fired_from(&[REFLEX], &[ACCESS], &[DENIAL], "app", Some("nobody")).is_empty());
    }

    #[test]
    fn a_session_s_first_row_may_come_from_the_access_log() {
        let denial = r#"{"timestamp": "2026-09-24T08:30:00Z", "slug": "d", "project": "app"}"#;
        let f = fired_from(&[REFLEX], &[ACCESS], &[denial], "app", Some("s4"));
        assert_eq!(ids(&f), vec![("d", Source::Denial)]);
    }

    #[test]
    fn without_a_session_the_project_s_fires() {
        let f = fired_from(&[REFLEX], &[ACCESS], &[DENIAL], "app", None);
        let got: Vec<_> = ids(&f);
        assert_eq!(got[0], ("gamma", Source::Reflex));
        assert!(got.contains(&("too-early", Source::Denial)));
        assert!(!got.iter().any(|(id, _)| *id == "delta" || *id == "elsewhere"));
    }

    #[test]
    fn fires_are_capped() {
        let reflex: String = (0..MAX_FIRED + 10).map(|i| format!("{{\"session_id\": \"s\", \"emitted\": [\"r{i}\"], \"ts\": \"2026-09-24T10:{:02}:00Z\"}}\n", i % 60)).collect();
        assert_eq!(fired_from(&[&reflex], &[], &[], "app", Some("s")).len(), MAX_FIRED);
    }

    #[test]
    fn fires_are_named_from_the_page_mnemo_keeps() {
        let root = temp_dir("feed-names");
        write(&root, "bots/app/memory/alpha.md", "---\nname: Alpha rule\n---\nbody\n");
        write(&root, "shared/project/app__beta.md", "---\nname: 'Beta rule'\n---\n");
        write(&root, "shared/feedback/gamma.md", "---\nmetadata:\n  type: feedback\nname: Gamma rule\n---\n");
        let raw = |id: &str| RawFire { id: id.into(), at: 1, source: Source::Reflex };
        let named = name_fires(&root, "app", vec![raw("app__alpha"), raw("beta"), raw("shared/gamma"), raw("Run the tests first"), raw("../../etc")]);
        let got: Vec<_> = named.iter().map(|f| (f.slug.as_str(), f.name.as_str())).collect();
        assert_eq!(got, vec![("alpha", "Alpha rule"), ("beta", "Beta rule"), ("gamma", "Gamma rule"), ("Run the tests first", "Run the tests first"), ("etc", "etc")]);
    }

    // ---- learned

    #[test]
    fn learned_is_the_project_s_newest_first() {
        let text = concat!(
            r#"{"seq": 1, "ts": "2026-09-20T10:00:00", "slug": "old", "name": "Old", "projects": ["app"]}"#, "\n",
            r#"{"seq": 2, "ts": "2026-09-24T10:00:00", "slug": "a", "name": "A", "projects": ["app", "x"]}"#, "\n",
            r#"{"seq": 3, "ts": "2026-09-24T10:00:00", "slug": "b", "projects": ["app"]}"#, "\n",
            r#"{"seq": 4, "ts": "2026-09-24T11:00:00", "slug": "c", "name": "C", "projects": ["other"]}"#, "\n",
            "garbage\n",
            r#"{"seq": 5, "ts": "2026-09-19T10:00:00", "slug": "old", "name": "Old again", "projects": ["app"]}"#, "\n",
        );
        let got = learned_from(text, "app", -3 * HOUR);
        let slugs: Vec<_> = got.iter().map(|l| (l.slug.as_str(), l.name.as_str())).collect();
        // One batch shares a `ts`; `seq` orders it. A slug without a name is named by it.
        assert_eq!(slugs, vec![("b", "b"), ("a", "A"), ("old", "Old")]);
        assert_eq!(got[1].at, ms("2026-09-24T13:00:00Z"));
    }

    // ---- inbox

    #[test]
    fn a_page_s_project_is_read_as_mnemo_reads_it() {
        let fm = |y: &str| parse_frontmatter(y);
        assert_eq!(page_projects(&fm("sources:\n  - /Users/x/mnemo/bots/app/memory/x.md\n  - bots/web/briefings/sessions/s.md\n")), vec!["app", "web"]);
        assert_eq!(page_projects(&fm("sources:\n  - /tmp/bots/outer/vault/bots/inner/memory/x.md\n")), vec!["inner"]);
        assert_eq!(page_projects(&fm("sources: []\nprojects: [app, web]\n")), vec!["app", "web"]);
        assert_eq!(page_projects(&fm("project: app\n")), vec!["app"]);
        assert!(page_projects(&fm("sources:\n  - notes/x.md\n")).is_empty());
    }

    #[test]
    fn the_inbox_is_the_project_s_staged_pages_rewrites_left_out() {
        let root = temp_dir("feed-inbox");
        write(&root, "shared/_inbox/feedback/one.md", "---\nname: One\nsources:\n  - bots/app/briefings/sessions/s.md\n---\n\nFirst   line.\n\nSecond.\n");
        write(&root, "shared/_inbox/project/two.md", "---\nprojects: [app]\n---\nTwo body\n");
        write(&root, "shared/_inbox/project/theirs.md", "---\nname: Theirs\nproject: other\n---\n");
        write(&root, "shared/_inbox/feedback/one.proposed.md", "---\nname: Rewrite\nproject: app\n---\n");
        write(&root, "shared/_inbox/feedback/one.update-proposed.md", "---\nname: Rewrite\nproject: app\n---\n");
        write(&root, "shared/_inbox/proposals/archived.md", "---\nproject: app\n---\n");
        write(&root, "shared/_inbox/feedback/deep/nested.md", "---\nproject: app\n---\n");
        let got = inbox_at(&root, "app");
        let mut rows: Vec<_> = got.iter().map(|i| (i.key.as_str(), i.page_type.as_str(), i.title.as_str(), i.excerpt.as_str())).collect();
        rows.sort();
        assert_eq!(rows, vec![("feedback/one", "feedback", "One", "First line. Second."), ("project/two", "project", "two", "Two body")]);
    }

    #[test]
    fn an_excerpt_is_cut_at_mnemo_s_length() {
        assert_eq!(excerpt(&"é".repeat(EXCERPT_CHARS + 5)).chars().count(), EXCERPT_CHARS);
    }

    // ---- briefing

    #[test]
    fn a_tldr_is_its_section_else_the_first_paragraph() {
        assert_eq!(tldr("# Briefing\n\n## TL;DR\n\nDid the thing.\nAll green.\n\n## What I did\n\nx\n"), "Did the thing.\nAll green.");
        assert_eq!(tldr("# briefing\n\nSession notes.\n\nMore.\n"), "Session notes.");
        assert_eq!(tldr(""), "");
    }

    #[test]
    fn the_last_briefing_is_the_newest_not_this_session_s() {
        let root = temp_dir("feed-briefing");
        let dir = "bots/app/briefings/sessions";
        write(&root, &format!("{dir}/old.md"), "---\nsession_id: old\ndate: 2026-09-20\n---\n## TL;DR\n\nOld.\n");
        std::thread::sleep(std::time::Duration::from_millis(20));
        write(&root, &format!("{dir}/new.md"), "---\nsession_id: new\ndate: 2026-09-24\n---\n## TL;DR\n\nNew.\n");
        let b = briefing_at(&root, "app", None).unwrap();
        assert_eq!((b.session_id.as_str(), b.date.as_str(), b.tldr.as_str()), ("new", "2026-09-24", "New."));
        assert!(b.path.ends_with("bots/app/briefings/sessions/new.md"));
        assert_eq!(briefing_at(&root, "app", Some("new")).unwrap().session_id, "old");
        assert!(briefing_at(&root, "nobody", None).is_none());
    }

    // ---- the whole feed, on the shared vault fixture

    #[test]
    fn the_fixture_vault_feeds_its_project() {
        let f = feed_at(Path::new(FIXTURE), "mnemo-desktop", Some("s6"), 0);
        assert_eq!(f.project, "mnemo-desktop");
        let fired: Vec<_> = f.fired.iter().map(|x| (x.slug.as_str(), x.source)).collect();
        assert_eq!(fired, vec![("shared-target-dir", Source::Reflex), ("run-tests-before-commit", Source::Reflex)]);
        let b = f.briefing.unwrap();
        assert_eq!(b.session_id, "0000-session");
        assert_eq!(b.tldr, "Session notes. Not a page: only memory/ holds pages.");
        assert!(f.learned.is_empty());
    }

    #[test]
    fn it_serializes_as_the_front_reads_it() {
        let f = MemoryFeed {
            project: "app".into(),
            briefing: Some(Briefing { session_id: "s".into(), date: "d".into(), tldr: "t".into(), path: "/p".into() }),
            fired: vec![Fired { slug: "x".into(), name: "X".into(), at: 1, source: Source::Denial }],
            learned: vec![Learned { slug: "y".into(), name: "Y".into(), at: 2 }],
            inbox: vec![InboxItem { key: "feedback/z".into(), page_type: "feedback".into(), title: "Z".into(), excerpt: "e".into() }],
        };
        let v = serde_json::to_value(&f).unwrap();
        assert_eq!(v["briefing"]["sessionId"], "s");
        assert_eq!(v["fired"][0]["source"], "denial");
        assert_eq!(v["inbox"][0]["type"], "feedback");
        assert_eq!(v["learned"][0]["at"], 2);
    }

    #[test]
    fn session_ids_cannot_be_paths() {
        assert!(is_session("6359db3a-961c-494a-b561-8908c50d6f22"));
        for bad in ["", "../x", "a/b", "a b", &"x".repeat(129)] {
            assert!(!is_session(bad), "{bad}");
        }
        assert!(feed("/tmp", Some("../x")).is_err());
        assert!(feed("  ", None).is_err());
    }
}

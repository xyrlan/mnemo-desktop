//! Marketplace pane: rule sets published with `mnemo publish` in any git repo.
//!
//! Sources are git URLs in `~/.mnemo-desktop/marketplace.json`; each is kept as a
//! shallow clone under `~/.mnemo-desktop/marketplace/<hash>/`. A rule set is one
//! `.mnemo-shared/` tree inside a clone, laid out as `<tree>/<type>/<slug>.md`
//! (mnemo's `core/share/format.py`). Importing hands the tree to `mnemo import`,
//! which stages it into the vault for review; nothing here writes to a vault.
//!
//! The repo of the focused pane is an implicit first source, "this repo": its
//! working copy's own tree, read in place and compared rule by rule with the local
//! vault (`classify`), with `mnemo publish` and a branch-and-PR flow beside it.
//!
//! Reading a tree is pure (`read_tree`, `parse_page`, `classify`), git, `gh` and
//! `mnemo` are confined to `// -- io --`, and every path is rooted in a
//! `Marketplace` or passed in so tests run against a temporary home.

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};

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
    pub description: String,
    pub tags: Vec<String>,
    pub project: String,
    /// `published.vault`: the id of the vault that published it.
    pub vault: String,
}

/// How a rule in this repo's tree stands against the local vault.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Standing {
    /// Nothing of it in the vault: no page, never imported.
    New,
    /// The vault has a page (or took an earlier version) and it differs.
    Changed,
    /// Import would change nothing.
    Same,
    /// This vault published it.
    Yours,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RepoRule {
    pub slug: String,
    pub page_type: String,
    pub description: String,
    /// `<type>/<file>.md` inside the tree.
    pub rel: String,
    /// `None` when no local vault was found to compare with.
    pub standing: Option<Standing>,
}

/// The "this repo" section: the working copy of the focused pane's repo.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct RepoRules {
    /// Top of the working copy (a worktree's own, not its main checkout's: that is
    /// where `mnemo publish` writes and what a branch is cut from).
    pub root: String,
    pub name: String,
    /// The root's tree as a rule set, what the Import button takes. `None` when
    /// nothing is published yet.
    pub set: Option<RuleSet>,
    pub rules: Vec<RepoRule>,
    /// The vault the rules were compared with.
    pub vault: Option<String>,
    /// `origin`'s default branch as the clone last saw it.
    pub default_branch: Option<String>,
    /// Current branch, `None` when detached.
    pub branch: Option<String>,
    /// The tree has changes git has not committed, so a PR has something to carry.
    pub uncommitted: bool,
    /// Why there is no section to show (not a repository, git failed).
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct Published {
    pub output: String,
    pub uncommitted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct OpenedPr {
    pub branch: String,
    pub base: String,
    /// The PR's URL as `gh` printed it; empty if it printed none.
    pub url: String,
    /// Every command run and what it said, for the inline log.
    pub output: String,
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
    let vault = published.get("vault").map(|v| v.trim().to_string()).unwrap_or_default();
    let description = scalar("description").unwrap_or_default();
    Some(Page { slug, page_type, description, tags, project, vault })
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

// ------------------------------------------------------------- this repo --

/// `hashlib.sha256(...).hexdigest()`. Hand-rolled: two hashes per rule do not
/// justify a dependency.
pub fn sha256_hex(data: &[u8]) -> String {
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];
    let mut h: [u32; 8] = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    let mut msg = data.to_vec();
    msg.push(0x80);
    while msg.len() % 64 != 56 {
        msg.push(0);
    }
    msg.extend_from_slice(&((data.len() as u64).wrapping_mul(8)).to_be_bytes());
    for chunk in msg.chunks(64) {
        let mut w = [0u32; 64];
        for (i, word) in chunk.chunks(4).enumerate() {
            w[i] = u32::from_be_bytes([word[0], word[1], word[2], word[3]]);
        }
        for i in 16..64 {
            let (s0, s1) = (w[i - 15], w[i - 2]);
            w[i] = w[i - 16]
                .wrapping_add(s0.rotate_right(7) ^ s0.rotate_right(18) ^ (s0 >> 3))
                .wrapping_add(w[i - 7])
                .wrapping_add(s1.rotate_right(17) ^ s1.rotate_right(19) ^ (s1 >> 10));
        }
        let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut hh] = h;
        for i in 0..64 {
            let t1 = hh
                .wrapping_add(e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25))
                .wrapping_add((e & f) ^ (!e & g))
                .wrapping_add(K[i])
                .wrapping_add(w[i]);
            let t2 = (a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22)).wrapping_add((a & b) ^ (a & c) ^ (b & c));
            hh = g;
            g = f;
            f = e;
            e = d.wrapping_add(t1);
            d = c;
            c = b;
            b = a;
            a = t1.wrapping_add(t2);
        }
        for (x, y) in h.iter_mut().zip([a, b, c, d, e, f, g, hh]) {
            *x = x.wrapping_add(y);
        }
    }
    h.iter().map(|x| format!("{x:08x}")).collect()
}

/// `format.portable_hash`: what both the publish manifest and the import ledger
/// record for a page.
pub fn portable_hash(text: &str) -> String {
    sha256_hex(text.replace("\r\n", "\n").replace('\r', "\n").as_bytes())
}

/// The markdown after the frontmatter, or all of it when there is none.
fn page_body(text: &str) -> String {
    let text = text.replace("\r\n", "\n");
    match text.strip_prefix("---\n").and_then(|rest| rest.find("\n---\n").map(|i| rest[i + 5..].to_string())) {
        Some(body) => body,
        None => text,
    }
}

/// What a rule says, as two vaults' copies of it can be compared: the description
/// and the body `retrieval_body` keeps (no graph section, no `> _mnemo` notes),
/// with trailing spaces and blank-line runs ignored. A vault page and the portable
/// page published from it carry different frontmatter and the same of this.
pub fn rule_content(description: &str, text: &str) -> String {
    let body = page_body(text);
    let body = match body.find("<!-- mnemo:graph-section -->") {
        Some(i) => &body[..i],
        None => &body[..],
    };
    let mut lines: Vec<&str> = Vec::new();
    let mut in_note = false;
    for line in body.lines() {
        let t = line.trim();
        if t.starts_with("> _mnemo ") {
            in_note = true;
            continue;
        }
        if in_note && t.starts_with('>') {
            continue;
        }
        in_note = false;
        let l = line.trim_end();
        if l.is_empty() && lines.last().map(|p| p.is_empty()).unwrap_or(true) {
            continue;
        }
        lines.push(l);
    }
    while lines.last().map(|l| l.is_empty()).unwrap_or(false) {
        lines.pop();
    }
    format!("{}\n\n{}", description.trim(), lines.join("\n"))
}

/// What the local vault knows about shared rules: its id, the import ledger, and
/// the publish manifests. Read only; a missing file is simply nothing known (the id
/// is never created here, unlike `format.vault_id`).
#[derive(Debug, Clone, Default)]
pub struct LocalVault {
    pub root: PathBuf,
    pub id: Option<String>,
    /// `<type>/<slug>` → `portable_hash` last imported (`.mnemo/share/imports.json`).
    pub imported: HashMap<String, String>,
    /// `(cwd, slug → portable_hash)` per publish manifest (`.mnemo/share/<project>.json`).
    pub published: Vec<(String, HashMap<String, String>)>,
}

impl LocalVault {
    pub fn read(root: &Path) -> LocalVault {
        let share = root.join(".mnemo/share");
        let json = |p: &Path| std::fs::read_to_string(p).ok().and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok());
        let hashes = |v: &serde_json::Value, pick: &dyn Fn(&serde_json::Value) -> Option<String>| -> HashMap<String, String> {
            v.get("rules")
                .and_then(|r| r.as_object())
                .map(|m| m.iter().filter_map(|(k, e)| pick(e).map(|h| (k.clone(), h))).collect())
                .unwrap_or_default()
        };
        let imported = json(&share.join("imports.json"))
            .map(|v| hashes(&v, &|e| e.get("hash").and_then(|h| h.as_str()).map(str::to_string)))
            .unwrap_or_default();
        let mut manifests: Vec<PathBuf> = std::fs::read_dir(&share)
            .into_iter()
            .flatten()
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.extension().map(|x| x == "json").unwrap_or(false) && p.file_name().map(|n| n != "imports.json").unwrap_or(false))
            .collect();
        manifests.sort();
        let published = manifests
            .iter()
            .filter_map(|p| json(p))
            .map(|v| {
                let cwd = v.get("cwd").and_then(|c| c.as_str()).unwrap_or_default().to_string();
                (cwd, hashes(&v, &|e| e.as_str().map(str::to_string)))
            })
            .collect();
        let id = std::fs::read_to_string(root.join(".mnemo/vault-id")).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
        LocalVault { root: root.to_path_buf(), id, imported, published }
    }
}

fn same_dir(a: &Path, b: &Path) -> bool {
    match (a.canonicalize(), b.canonicalize()) {
        (Ok(x), Ok(y)) => x == y,
        _ => a == b,
    }
}

/// One path segment mnemo would write, never `..` or a nested path.
fn plain_segment(s: &str) -> bool {
    !s.is_empty() && s != "." && s != ".." && !s.contains(['/', '\\'])
}

/// A tree rule against the local vault, in the order `mnemo import` routes:
///
/// 1. `yours` — its provenance names this vault's id, or a publish manifest of this
///    vault lists the slug (at these exact bytes, or for this very repo): the hop
///    rule re-publishes an imported rule under its original vault's id.
/// 2. `same` — the import ledger holds it at this hash. A staged page the user
///    promoted, edited or deleted is a decision already made; import is a no-op.
/// 3. a page for it in the vault (live, staged, or staged as a proposed rewrite):
///    `same` when one says what the tree says, `changed` otherwise.
/// 4. no page: `changed` when an earlier version was imported, else `new`.
pub fn classify(page: &Page, text: &str, vault: &LocalVault, repo_root: &Path) -> Standing {
    let hash = portable_hash(text);
    if vault.id.as_deref() == Some(page.vault.as_str()) {
        return Standing::Yours;
    }
    let listed = vault.published.iter().any(|(cwd, rules)| match rules.get(&page.slug) {
        Some(h) => *h == hash || (!cwd.is_empty() && same_dir(Path::new(cwd), repo_root)),
        None => false,
    });
    if listed {
        return Standing::Yours;
    }
    let key = format!("{}/{}", page.page_type, page.slug);
    if vault.imported.get(&key) == Some(&hash) {
        return Standing::Same;
    }
    let mut local_pages = Vec::new();
    if plain_segment(&page.page_type) && plain_segment(&page.slug) {
        let shared = vault.root.join("shared");
        let inbox = shared.join("_inbox").join(&page.page_type);
        local_pages = vec![
            shared.join(&page.page_type).join(format!("{}.md", page.slug)),
            inbox.join(format!("{}.md", page.slug)),
            inbox.join(format!("{}.proposed.md", page.slug)),
        ];
    }
    let theirs = rule_content(&page.description, text);
    let mut found = false;
    for p in local_pages {
        let Ok(local) = std::fs::read_to_string(&p) else { continue };
        found = true;
        let description = parse_frontmatter(&local)
            .and_then(|fm| match fm.get("description") {
                Some(Value::Scalar(s)) => Some(s.clone()),
                _ => None,
            })
            .unwrap_or_default();
        if rule_content(&description, &local) == theirs {
            return Standing::Same;
        }
    }
    if found || vault.imported.contains_key(&key) {
        Standing::Changed
    } else {
        Standing::New
    }
}

/// Every rule of the tree at `tree`, classified when a vault is given. Sorted by
/// path, like `read_tree` and `format.iter_portable`.
pub fn repo_rules(tree: &Path, repo_root: &Path, vault: Option<&LocalVault>) -> Vec<RepoRule> {
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
    files
        .iter()
        .filter_map(|f| {
            let text = std::fs::read_to_string(f).ok()?;
            let page = parse_page(&text)?;
            let rel = f.strip_prefix(tree).unwrap_or(f).to_string_lossy().replace('\\', "/");
            Some(RepoRule {
                standing: vault.map(|v| classify(&page, &text, v, repo_root)),
                slug: page.slug,
                page_type: page.page_type,
                description: page.description,
                rel,
            })
        })
        .collect()
}

/// `team-rules/<date>`, suffixed `-2`, `-3`… past the names `taken` says exist.
pub fn branch_name(date: &str, taken: impl Fn(&str) -> bool) -> String {
    let base = format!("team-rules/{date}");
    if !taken(&base) {
        return base;
    }
    (2..).map(|n| format!("{base}-{n}")).find(|b| !taken(b)).unwrap_or(base)
}

/// `YYYY-MM-DD`, the only shape a branch date may take.
pub fn valid_date(date: &str) -> bool {
    let b = date.as_bytes();
    b.len() == 10 && b[4] == b'-' && b[7] == b'-' && b.iter().enumerate().all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit())
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
        let base = crate::app_dir::app_dir();
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
        let mut cmd = crate::proc::command("git");
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
    let out = crate::proc::command(program)
        .args(["import", path])
        .current_dir(cwd)
        .env("PATH", path_env)
        .stdin(std::process::Stdio::null())
        .output()
        .map_err(|e| format!("{program}: {e}"))?;
    let text = combined(&out);
    if out.status.success() {
        Ok(text)
    } else if text.is_empty() {
        Err(format!("{program} import exited with {}", out.status.code().unwrap_or(-1)))
    } else {
        Err(text)
    }
}

/// Both streams of a finished command, stdout first, blank ones dropped.
fn combined(out: &std::process::Output) -> String {
    [String::from_utf8_lossy(&out.stdout).trim(), String::from_utf8_lossy(&out.stderr).trim()]
        .into_iter()
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

/// `program args` in `cwd` with `path_env` (which is also where `program` is looked
/// up), no stdin, no colour, no credential prompts. Ok with stdout on exit 0, Err
/// with what it said otherwise.
fn run_in(program: &str, args: &[&str], cwd: &Path, path_env: &str) -> Result<String, String> {
    let out = crate::proc::command(program)
        .args(args)
        .current_dir(cwd)
        .env("PATH", path_env)
        .env("NO_COLOR", "1")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GH_PROMPT_DISABLED", "1")
        .stdin(std::process::Stdio::null())
        .output()
        .map_err(|e| format!("{program}: {e}"))?;
    if out.status.success() {
        return Ok(String::from_utf8_lossy(&out.stdout).to_string());
    }
    let text = combined(&out);
    Err(if text.is_empty() { format!("{program} {} exited with {}", args.join(" "), out.status.code().unwrap_or(-1)) } else { text })
}

/// Top of the working copy holding `cwd`.
pub fn toplevel(cwd: &Path, path_env: &str) -> Result<PathBuf, String> {
    if !cwd.is_dir() {
        return Err(format!("{}: not a directory", cwd.display()));
    }
    match run_in("git", &["rev-parse", "--show-toplevel"], cwd, path_env) {
        Ok(s) if !s.trim().is_empty() => Ok(PathBuf::from(s.trim())),
        Ok(_) => Err(format!("{} is not in a git working copy", cwd.display())),
        Err(e) if e.contains("not a git repository") => Err(format!("{} is not in a git repository", cwd.display())),
        Err(e) => Err(e),
    }
}

/// `root` itself, when it is the top of a working copy: publish and PR commands
/// take nothing else.
fn checked_root(root: &str, path_env: &str) -> Result<PathBuf, String> {
    let p = PathBuf::from(root.trim());
    let top = toplevel(&p, path_env)?;
    if same_dir(&top, &p) {
        Ok(p)
    } else {
        Err(format!("{} is not the top of a git working copy ({} is)", p.display(), top.display()))
    }
}

fn tree_uncommitted(root: &Path, path_env: &str) -> bool {
    run_in("git", &["status", "--porcelain", "--untracked-files=all", "--", SHARE_DIR], root, path_env)
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false)
}

fn current_branch(root: &Path, path_env: &str) -> Option<String> {
    run_in("git", &["symbolic-ref", "--quiet", "--short", "HEAD"], root, path_env).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

/// `origin/HEAD` as the clone knows it; with `ask_gh`, the forge's answer when
/// the clone does not know.
fn default_branch(root: &Path, path_env: &str, ask_gh: bool) -> Option<String> {
    let local = run_in("git", &["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], root, path_env)
        .ok()
        .and_then(|s| s.trim().strip_prefix("origin/").map(str::to_string))
        .filter(|s| !s.is_empty());
    if local.is_some() || !ask_gh {
        return local;
    }
    run_in("gh", &["repo", "view", "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"], root, path_env)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// The "this repo" section for `cwd`, compared with the vault at `vault` if any.
pub fn repo_with(path_env: &str, cwd: &str, vault: Option<&Path>) -> RepoRules {
    let root = match toplevel(Path::new(cwd.trim()), path_env) {
        Ok(r) => r,
        Err(e) => return RepoRules { error: Some(e), ..Default::default() },
    };
    let root_s = root.to_string_lossy().to_string();
    let name = root.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| root_s.clone());
    let tree = root.join(SHARE_DIR);
    let local = vault.map(LocalVault::read);
    let (set, rules) = if tree.is_dir() {
        let last_commit = run_in("git", &["log", "-1", "--format=%cI", "--", SHARE_DIR], &root, path_env)
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let set = RuleSet { source: root_s.clone(), name: name.clone(), last_commit, ..read_tree(&tree) };
        (Some(set), repo_rules(&tree, &root, local.as_ref()))
    } else {
        (None, vec![])
    };
    RepoRules {
        name,
        set,
        rules,
        vault: vault.map(|v| v.to_string_lossy().to_string()),
        default_branch: default_branch(&root, path_env, false),
        branch: current_branch(&root, path_env),
        uncommitted: tree_uncommitted(&root, path_env),
        error: None,
        root: root_s,
    }
}

/// `mnemo publish` at the top of the working copy `root`. Ok with its output on
/// exit 0 (and whether the tree now has something to commit), Err with it otherwise.
pub fn publish_with(program: &str, path_env: &str, root: &str) -> Result<Published, String> {
    let root = checked_root(root, path_env)?;
    let out = crate::proc::command(program)
        .arg("publish")
        .current_dir(&root)
        .env("PATH", path_env)
        .env("NO_COLOR", "1")
        .stdin(std::process::Stdio::null())
        .output()
        .map_err(|e| format!("{program}: {e}"))?;
    let output = combined(&out);
    if !out.status.success() {
        return Err(if output.is_empty() { format!("{program} publish exited with {}", out.status.code().unwrap_or(-1)) } else { output });
    }
    Ok(Published { output, uncommitted: tree_uncommitted(&root, path_env) })
}

/// Commands run for the Open PR flow, echoed with what they said.
struct Transcript<'a> {
    root: &'a Path,
    path_env: &'a str,
    log: Vec<String>,
}

impl Transcript<'_> {
    fn run(&mut self, program: &str, args: &[&str]) -> Result<String, String> {
        let shown: Vec<String> = args
            .iter()
            .map(|a| if a.contains('\n') { "…".to_string() } else if a.contains(' ') { format!("'{a}'") } else { a.to_string() })
            .collect();
        self.log.push(format!("$ {program} {}", shown.join(" ")));
        let res = run_in(program, args, self.root, self.path_env);
        match &res {
            Ok(o) if !o.trim().is_empty() => self.log.push(o.trim().to_string()),
            Err(e) => self.log.push(e.clone()),
            _ => {}
        }
        res
    }

    /// A read that is not worth showing.
    fn ask(&self, program: &str, args: &[&str]) -> Result<String, String> {
        run_in(program, args, self.root, self.path_env)
    }

    fn has_ref(&self, name: &str) -> bool {
        self.ask("git", &["rev-parse", "--verify", "--quiet", name]).is_ok()
    }

    /// Stages and commits the tree and nothing else, whatever else is staged.
    fn commit_tree(&mut self, message: &str) -> Result<(), String> {
        self.run("git", &["add", "-A", "--", SHARE_DIR])?;
        self.run("git", &["commit", "--quiet", "-m", message, "--", SHARE_DIR]).map(|_| ())
    }
}

/// Puts the tree's uncommitted changes up for review: a `team-rules/<date>` branch
/// cut from origin's default branch (not from HEAD, whose own commits are not the
/// team's rules), one commit of `.mnemo-shared/` only, a push, and `gh pr create`.
/// Other changes in the working copy stay uncommitted and come along. On a
/// `team-rules/` branch already pushed, the commit goes there instead and its open
/// PR follows. Nothing is ever committed on the default branch. Err carries every
/// command run up to the failure.
pub fn open_pr_with(path_env: &str, root: &str, date: &str) -> Result<OpenedPr, String> {
    if !valid_date(date) {
        return Err(format!("not a YYYY-MM-DD date: {date:?}"));
    }
    let root = checked_root(root, path_env)?;
    let mut t = Transcript { root: &root, path_env, log: Vec::new() };
    let res = open_pr(&mut t, date);
    let log = t.log.join("\n");
    match res {
        Ok(mut pr) => {
            pr.output = log;
            Ok(pr)
        }
        Err(e) if log.is_empty() => Err(e),
        Err(e) if log.ends_with(&e) => Err(log),
        Err(e) => Err(format!("{log}\n{e}")),
    }
}

fn open_pr(t: &mut Transcript, date: &str) -> Result<OpenedPr, String> {
    if !tree_uncommitted(t.root, t.path_env) {
        return Err(format!("nothing to commit: {SHARE_DIR}/ has no changes"));
    }
    if t.ask("git", &["remote", "get-url", "origin"]).is_err() {
        return Err("no `origin` remote to push to".into());
    }
    let base = default_branch(t.root, t.path_env, true)
        .ok_or("cannot tell origin's default branch: run `git remote set-head origin --auto`")?;
    let message = format!("team rules: publish {date}");

    let current = current_branch(t.root, t.path_env);
    if let Some(branch) = current.filter(|b| b.starts_with("team-rules/") && *b != base) {
        if t.has_ref(&format!("refs/remotes/origin/{branch}")) {
            t.commit_tree(&message)?;
            t.run("git", &["push", "--quiet", "origin", &branch])?;
            let url = t.ask("gh", &["pr", "view", &branch, "--json", "url", "--jq", ".url"]).map(|u| u.trim().to_string()).unwrap_or_default();
            return Ok(OpenedPr { branch, base, url, output: String::new() });
        }
    }

    t.run("git", &["fetch", "--quiet", "origin", &format!("+refs/heads/{base}:refs/remotes/origin/{base}")])?;
    let branch = branch_name(date, |b| t.has_ref(&format!("refs/heads/{b}")) || t.has_ref(&format!("refs/remotes/origin/{b}")));
    t.run("git", &["checkout", "--quiet", "--no-track", "-b", &branch, &format!("origin/{base}")])?;
    if current_branch(t.root, t.path_env).as_deref() != Some(branch.as_str()) {
        return Err(format!("not on {branch} after checkout; nothing committed"));
    }
    t.commit_tree(&message)?;
    t.run("git", &["push", "--quiet", "--set-upstream", "origin", &branch])?;
    let body = format!(
        "Rules written by `mnemo publish` into `{SHARE_DIR}/`.\n\nOnce this merges, teammates see them in the marketplace pane and review them with `mnemo import`."
    );
    let out = t.run("gh", &["pr", "create", "--base", &base, "--head", &branch, "--title", &message, "--body", &body])?;
    let url = out.lines().map(str::trim).rev().find(|l| l.starts_with("http")).unwrap_or_default().to_string();
    Ok(OpenedPr { branch, base, url, output: String::new() })
}

/// `mnemo import` of only the rules `classify` calls new: they are copied to a
/// scratch tree of their own, since import takes a whole tree.
pub fn import_new_with(program: &str, path_env: &str, cwd: &str, vault: &Path) -> Result<String, String> {
    let root = toplevel(Path::new(cwd.trim()), path_env)?;
    let tree = root.join(SHARE_DIR);
    let local = LocalVault::read(vault);
    let new: Vec<RepoRule> =
        repo_rules(&tree, &root, Some(&local)).into_iter().filter(|r| r.standing == Some(Standing::New)).collect();
    if new.is_empty() {
        return Err("no new rules to import".into());
    }
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let scratch = std::env::temp_dir().join(format!("mnemo-desktop-new-rules-{}-{nanos}", std::process::id()));
    let copy = || -> Result<(), String> {
        for r in &new {
            let to = scratch.join(SHARE_DIR).join(&r.rel);
            std::fs::create_dir_all(to.parent().unwrap_or(&scratch)).map_err(|e| e.to_string())?;
            std::fs::copy(tree.join(&r.rel), &to).map_err(|e| format!("{}: {e}", r.rel))?;
        }
        Ok(())
    };
    let res = copy().and_then(|_| import_with(program, path_env, &scratch.join(SHARE_DIR).to_string_lossy(), cwd));
    let _ = std::fs::remove_dir_all(&scratch);
    res
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

#[tauri::command]
pub async fn marketplace_repo(cwd: String) -> RepoRules {
    tauri::async_runtime::spawn_blocking(move || {
        let vault = crate::vault::vault_root();
        repo_with(&crate::mission::login_path(), &cwd, vault.as_deref())
    })
    .await
    .unwrap_or_default()
}

#[tauri::command]
pub async fn marketplace_publish(root: String) -> Result<Published, String> {
    tauri::async_runtime::spawn_blocking(move || publish_with("mnemo", &crate::mission::login_path(), &root))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn marketplace_open_pr(root: String, date: String) -> Result<OpenedPr, String> {
    tauri::async_runtime::spawn_blocking(move || open_pr_with(&crate::mission::login_path(), &root, &date))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn marketplace_import_new(cwd: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let vault = crate::vault::vault_root().ok_or("no mnemo vault found (`mnemo status` names none)")?;
        import_new_with("mnemo", &crate::mission::login_path(), &cwd, &vault)
    })
    .await
    .map_err(|e| e.to_string())?
}

// --------------------------------------------------------------- tests --

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/fixtures/marketplace/rules-repo");

    fn temp(tag: &str) -> PathBuf {
        let d = crate::testutil::temp_dir(&format!("mkt-{tag}"));
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
        let out = crate::proc::command("git")
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
        let out = crate::proc::command("git")
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
        let dir = temp("import");
        let project = dir.join("project");
        std::fs::create_dir_all(&project).unwrap();
        let tree = Path::new(FIXTURE).join(SHARE_DIR);
        let fake = dir.join("mnemo");
        crate::testutil::write_script(
            &fake,
            "#!/bin/sh\necho \"$1 $2 in $(pwd -P)\"\ncase \"$2\" in *react*) echo 'refused feedback/x: collision' >&2; exit 1;; esac\n",
        );
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

    // -- this repo --

    const VAULT: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/fixtures/marketplace/local-vault");

    fn standings(rules: &[RepoRule]) -> Vec<(String, Option<Standing>)> {
        rules.iter().map(|r| (r.rel.clone(), r.standing)).collect()
    }

    fn standing_of(tree: &Path, vault: &Path, rel: &str) -> Standing {
        let text = std::fs::read_to_string(tree.join(rel)).unwrap();
        classify(&parse_page(&text).unwrap(), &text, &LocalVault::read(vault), Path::new("/elsewhere"))
    }

    #[test]
    fn sha256_matches_known_vectors_and_what_mnemo_recorded() {
        assert_eq!(sha256_hex(b""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
        assert_eq!(sha256_hex(b"abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        assert_eq!(
            sha256_hex(b"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
            "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"
        );
        assert_eq!(sha256_hex(&[b'a'; 1000]), "41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3");
        // A CRLF checkout (Windows runners) must not double the CR when the test re-adds it.
        let text = std::fs::read_to_string(Path::new(FIXTURE).join(".mnemo-shared/project/shared-target-dir.md")).unwrap().replace("\r\n", "\n");
        assert_eq!(portable_hash(&text), LocalVault::read(Path::new(VAULT)).imported["project/shared-target-dir"]);
        assert_eq!(portable_hash(&text.replace('\n', "\r\n")), portable_hash(&text), "a CRLF checkout hashes the same");
    }

    #[test]
    fn rule_content_is_description_and_body_without_graph_section_or_notes() {
        let portable = "---\nslug: a\ndescription: d\npublished:\n  vault: v\n---\n\nDo the thing.\n\n**Why:** because.\n";
        let vault = "---\nslug: a\nsources:\n  - x\n---\n\nDo the thing.\n\n\n> _mnemo stripped an enforce block_\n> more\n\n**Why:** because.  \n\n<!-- mnemo:graph-section -->\n## Sources\n- [[x]]\n";
        assert_eq!(rule_content("d", portable), rule_content(" d ", vault));
        assert_ne!(rule_content("d", portable), rule_content("other", vault));
        assert_ne!(rule_content("d", portable), rule_content("d", &vault.replace("because", "reasons")));
    }

    #[test]
    fn the_fixture_tree_against_the_fake_vault_is_new_changed_same_and_yours() {
        let tree = Path::new(FIXTURE).join(SHARE_DIR);
        let vault = LocalVault::read(Path::new(VAULT));
        assert_eq!(vault.id.as_deref(), Some("b7e4d1c9a3f6082e5d9c1b4a7e3f6d20"));
        let rules = repo_rules(&tree, Path::new(FIXTURE), Some(&vault));
        assert_eq!(
            standings(&rules),
            vec![
                ("feedback/login-shell-path-for-clis.md".to_string(), Some(Standing::Yours)),
                ("feedback/no-silent-contract-changes.md".to_string(), Some(Standing::New)),
                ("feedback/run-tests-before-commit.md".to_string(), Some(Standing::Changed)),
                ("project/shared-target-dir.md".to_string(), Some(Standing::Same)),
            ],
            "notes.md is not a rule and is not listed"
        );
        assert_eq!(rules[1].slug, "no-silent-contract-changes");
        assert_eq!(rules[1].page_type, "feedback");
        assert_eq!(rules[1].description, "Never change a shared signature silently: stop and say so");
        assert!(repo_rules(&tree, Path::new(FIXTURE), None).iter().all(|r| r.standing.is_none()), "no vault, no verdict");
        assert_eq!(serde_json::to_value(Standing::Yours).unwrap(), "yours");
    }

    #[test]
    fn yours_comes_from_the_vault_id_or_this_vaults_publish_manifest() {
        let tree = Path::new(FIXTURE).join(SHARE_DIR);
        let rel = "feedback/login-shell-path-for-clis.md";
        let vault = temp("yours").join("vault");
        copy_dir(Path::new(VAULT), &vault);
        std::fs::write(vault.join(".mnemo/vault-id"), "someone-else\n").unwrap();
        assert_eq!(standing_of(&tree, &vault, rel), Standing::Yours, "manifest lists the slug at these bytes (the hop rule)");

        let manifest = vault.join(".mnemo/share/mnemo-desktop.json");
        let text = std::fs::read_to_string(&manifest).unwrap().replace("71a148e6", "00000000");
        std::fs::write(&manifest, &text).unwrap();
        assert_eq!(standing_of(&tree, &vault, rel), Standing::New, "another hash, published from another checkout");
        let repo = tree.parent().unwrap();
        // The manifest is JSON: a Windows path needs its backslashes escaped.
        let text = text.replace("/Users/me/github/mnemo-desktop", &repo.to_string_lossy().replace('\\', "\\\\"));
        std::fs::write(&manifest, text).unwrap();
        let page_text = std::fs::read_to_string(tree.join(rel)).unwrap();
        let v = LocalVault::read(&vault);
        assert_eq!(classify(&parse_page(&page_text).unwrap(), &page_text, &v, repo), Standing::Yours, "published from this repo");

        std::fs::remove_file(&manifest).unwrap();
        assert_eq!(standing_of(&tree, &vault, rel), Standing::New);
        std::fs::remove_dir_all(vault.join(".mnemo")).unwrap();
        assert_eq!(standing_of(&tree, &vault, rel), Standing::New, "a vault that never shared anything");
    }

    #[test]
    fn same_and_changed_follow_the_ledger_then_the_pages_in_the_vault() {
        let tree = Path::new(FIXTURE).join(SHARE_DIR);
        let vault = temp("standing").join("vault");
        copy_dir(Path::new(VAULT), &vault);
        let project = "project/shared-target-dir.md";
        let staged = vault.join("shared/_inbox/project/shared-target-dir.md");

        std::fs::write(&staged, std::fs::read_to_string(&staged).unwrap().replace("points every", "pointed every")).unwrap();
        assert_eq!(standing_of(&tree, &vault, project), Standing::Same, "imported at this hash: a local edit is the user's call");
        std::fs::remove_file(vault.join(".mnemo/share/imports.json")).unwrap();
        assert_eq!(standing_of(&tree, &vault, project), Standing::Changed, "no ledger, and the staged page differs");
        std::fs::write(&staged, std::fs::read_to_string(&staged).unwrap().replace("pointed every", "points every")).unwrap();
        assert_eq!(standing_of(&tree, &vault, project), Standing::Same, "no ledger, and the staged page says the same");
        std::fs::remove_file(&staged).unwrap();
        assert_eq!(standing_of(&tree, &vault, project), Standing::New);

        let ledger = r#"{"rules": {"project/shared-target-dir": {"hash": "an-earlier-version"}}}"#;
        std::fs::write(vault.join(".mnemo/share/imports.json"), ledger).unwrap();
        assert_eq!(standing_of(&tree, &vault, project), Standing::Changed, "an earlier version was imported, then dropped");

        // A live page learned in this vault, in vault form, saying what the tree says.
        let rel = "feedback/no-silent-contract-changes.md";
        let live = vault.join("shared/feedback/no-silent-contract-changes.md");
        std::fs::write(
            &live,
            "---\nname: No silent contract changes\nslug: no-silent-contract-changes\ndescription: 'Never change a shared signature silently: stop and say so'\ntype: feedback\nsources:\n  - bots/x/memory/a.md\nextracted_at: 2026-09-01T10:00:00\n---\n\nWhen a signature other pieces build against cannot be delivered, stop and report it.\n\n<!-- mnemo:graph-section -->\n## Sources\n- [[bots/x/memory/a]]\n",
        )
        .unwrap();
        assert_eq!(standing_of(&tree, &vault, rel), Standing::Same);
        std::fs::write(&live, std::fs::read_to_string(&live).unwrap().replace("report it", "work around it")).unwrap();
        assert_eq!(standing_of(&tree, &vault, rel), Standing::Changed);
        let proposed = vault.join("shared/_inbox/feedback/no-silent-contract-changes.proposed.md");
        std::fs::create_dir_all(proposed.parent().unwrap()).unwrap();
        std::fs::copy(tree.join(rel), &proposed).unwrap();
        assert_eq!(standing_of(&tree, &vault, rel), Standing::Same, "already staged as a proposed rewrite");

        let sneaky = "---\nslug: ../../etc\ntype: feedback\npublished:\n  vault: v\n---\n\nx\n";
        assert_eq!(classify(&parse_page(sneaky).unwrap(), sneaky, &LocalVault::read(&vault), &vault), Standing::New);
    }

    #[test]
    fn branch_names_step_past_taken_ones_and_dates_are_checked() {
        assert_eq!(branch_name("2026-09-15", |_| false), "team-rules/2026-09-15");
        let taken = ["team-rules/2026-09-15", "team-rules/2026-09-15-2"];
        assert_eq!(branch_name("2026-09-15", |b| taken.contains(&b)), "team-rules/2026-09-15-3");
        assert!(valid_date("2026-09-15"));
        for bad in ["2026-9-15", "2026/09/15", "--force", "2026-09-15 x", ""] {
            assert!(!valid_date(bad), "{bad}");
        }
    }

    #[test]
    fn repo_section_reads_the_working_copy_of_any_cwd_inside_it() {
        let repo = fixture_repo("repo-section");
        let path_env = std::env::var("PATH").unwrap_or_default();
        let r = repo_with(&path_env, &repo.join("sets/react").to_string_lossy(), Some(Path::new(VAULT)));
        assert!(r.error.is_none(), "{r:?}");
        assert!(same_dir(Path::new(&r.root), &repo));
        assert_eq!(r.name, "rules-repo");
        assert_eq!(r.branch.as_deref(), Some("main"));
        assert!(!r.uncommitted);
        let set = r.set.as_ref().unwrap();
        assert_eq!(set.rule_count, 4);
        assert!(set.last_commit.as_deref().unwrap().starts_with("2026-09-10"));
        assert_eq!(
            r.rules.iter().map(|x| x.standing.unwrap()).collect::<Vec<_>>(),
            vec![Standing::Yours, Standing::New, Standing::Changed, Standing::Same]
        );

        std::fs::remove_dir_all(repo.join(SHARE_DIR)).unwrap();
        let empty = repo_with(&path_env, &repo.to_string_lossy(), None);
        assert!(empty.set.is_none() && empty.rules.is_empty());
        assert!(empty.uncommitted, "a deleted tree is a change to commit");

        let outside = temp("not-a-repo");
        assert!(repo_with(&path_env, &outside.to_string_lossy(), None).error.unwrap().contains("not in a git"));
        assert!(repo_with(&path_env, "/nonexistent/dir", None).error.unwrap().contains("not a directory"));
    }

    #[cfg(unix)]
    fn script(path: &Path, body: &str) {
        crate::testutil::write_script(path, body);
    }

    fn git_out(args: &[&str], cwd: &Path) -> String {
        let out = crate::proc::command("git").args(args).current_dir(cwd).output().unwrap();
        assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    }

    #[cfg(unix)]
    #[test]
    fn publish_then_open_pr_branches_from_the_default_branch_and_commits_only_the_tree() {
        let dir = temp("pr");
        let bin = dir.join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        // `mnemo publish` writes one more rule each run; `gh` logs its arguments.
        script(
            &bin.join("mnemo"),
            "#!/bin/sh\n[ \"$1\" = publish ] || exit 2\nmkdir -p .mnemo-shared/feedback\nn=$(ls .mnemo-shared/feedback | wc -l | tr -d ' ')\nprintf -- '---\\nslug: r%s\\ntype: feedback\\npublished:\\n  vault: me\\n---\\n\\nrule %s\\n' $n $n > .mnemo-shared/feedback/r$n.md\necho \"published 1 rule\"\necho 'commit .mnemo-shared and push'\n",
        );
        script(
            &bin.join("gh"),
            "#!/bin/sh\necho \"$*\" >> \"$(dirname \"$0\")/gh.log\"\ncase \"$1 $2\" in\n  'repo view') echo main ;;\n  'pr create'|'pr view') echo https://github.com/team/repo/pull/7 ;;\n  *) exit 1 ;;\nesac\n",
        );
        script(&bin.join("mnemo-broken"), "#!/bin/sh\necho 'error: no vault configured' >&2\nexit 1\n");
        let path_env = format!("{}:{}", bin.display(), std::env::var("PATH").unwrap_or_default());
        let gh_log = || std::fs::read_to_string(bin.join("gh.log")).unwrap_or_default();

        let origin = dir.join("origin.git");
        std::fs::create_dir_all(&origin).unwrap();
        git(&["init", "--quiet", "--bare", "-b", "main"], &origin);
        let work = dir.join("work");
        git(&["clone", "--quiet", &origin.to_string_lossy(), &work.to_string_lossy()], &dir);
        for (k, v) in [("user.name", "t"), ("user.email", "t@t"), ("commit.gpgsign", "false")] {
            git(&["config", k, v], &work);
        }
        std::fs::write(work.join("README.md"), "hello\n").unwrap();
        git(&["add", "-A"], &work);
        git(&["commit", "--quiet", "-m", "init"], &work);
        git(&["push", "--quiet", "-u", "origin", "main"], &work);
        let main_tip = git_out(&["rev-parse", "main"], &work);
        // The user is on a feature branch with its own commit, an edit and a staged file.
        git(&["checkout", "--quiet", "-b", "feature"], &work);
        std::fs::write(work.join("feature.txt"), "wip\n").unwrap();
        git(&["add", "feature.txt"], &work);
        git(&["commit", "--quiet", "-m", "feature work"], &work);
        std::fs::write(work.join("README.md"), "hello, edited\n").unwrap();
        std::fs::write(work.join("staged.txt"), "staged\n").unwrap();
        git(&["add", "staged.txt"], &work);
        let root = work.to_string_lossy().to_string();

        assert!(open_pr_with(&path_env, &root, "2026-09-15").unwrap_err().contains("nothing to commit"));
        assert!(open_pr_with(&path_env, &root, "main; rm -rf /").unwrap_err().contains("not a YYYY-MM-DD"));
        assert!(publish_with("mnemo", &path_env, &work.join("sub").to_string_lossy()).is_err());
        std::fs::create_dir_all(work.join("sub")).unwrap();
        assert!(publish_with("mnemo", &path_env, &work.join("sub").to_string_lossy()).unwrap_err().contains("not the top"));
        assert_eq!(publish_with("mnemo-broken", &path_env, &root).unwrap_err(), "error: no vault configured");

        let published = publish_with("mnemo", &path_env, &root).unwrap();
        assert_eq!(published.output, "published 1 rule\ncommit .mnemo-shared and push");
        assert!(published.uncommitted);

        // origin/HEAD is unknown to a clone of an empty repo: gh names the default branch.
        let pr = open_pr_with(&path_env, &root, "2026-09-15").unwrap();
        assert_eq!((pr.branch.as_str(), pr.base.as_str()), ("team-rules/2026-09-15", "main"));
        assert_eq!(pr.url, "https://github.com/team/repo/pull/7");
        assert!(pr.output.contains("$ git checkout --quiet --no-track -b team-rules/2026-09-15 origin/main"), "{}", pr.output);
        assert_eq!(git_out(&["symbolic-ref", "--short", "HEAD"], &work), "team-rules/2026-09-15");
        assert_eq!(git_out(&["rev-parse", "HEAD^"], &work), main_tip, "cut from main, not from feature");
        assert_eq!(git_out(&["show", "--name-only", "--format=", "HEAD"], &work), ".mnemo-shared/feedback/r0.md");
        assert_eq!(git_out(&["rev-parse", "main"], &work), main_tip, "main never gets a commit");
        assert_eq!(git_out(&["rev-parse", "main"], &origin), main_tip);
        assert_eq!(git_out(&["rev-parse", "team-rules/2026-09-15"], &origin), git_out(&["rev-parse", "HEAD"], &work), "pushed");
        // (`git_out` trims the leading space of ` M README.md`.)
        assert_eq!(git_out(&["status", "--porcelain"], &work), "M README.md\nA  staged.txt", "the rest stays uncommitted");
        assert!(gh_log().contains("pr create --base main --head team-rules/2026-09-15 --title team rules: publish 2026-09-15"), "{}", gh_log());

        // Publishing again on that branch adds to it; its PR follows.
        publish_with("mnemo", &path_env, &root).unwrap();
        let again = open_pr_with(&path_env, &root, "2026-09-16").unwrap();
        assert_eq!(again.branch, "team-rules/2026-09-15");
        assert_eq!(again.url, "https://github.com/team/repo/pull/7");
        assert_eq!(gh_log().matches("pr create").count(), 1);
        assert_eq!(git_out(&["rev-parse", "team-rules/2026-09-15"], &origin), git_out(&["rev-parse", "HEAD"], &work));
        assert!(open_pr_with(&path_env, &root, "2026-09-16").unwrap_err().contains("nothing to commit"));

        // Back on main the same day: a fresh branch beside the taken name.
        git(&["checkout", "--quiet", "main"], &work);
        git(&["remote", "set-head", "origin", "main"], &work);
        let asked = gh_log().matches("repo view").count();
        publish_with("mnemo", &path_env, &root).unwrap();
        let third = open_pr_with(&path_env, &root, "2026-09-15").unwrap();
        assert_eq!(third.branch, "team-rules/2026-09-15-2");
        assert_eq!(git_out(&["rev-parse", "main"], &work), main_tip);
        assert_eq!(gh_log().matches("repo view").count(), asked, "origin/HEAD known now: gh not asked");

        // A push that fails reports every step up to it.
        git(&["checkout", "--quiet", "main"], &work);
        publish_with("mnemo", &path_env, &root).unwrap();
        git(&["remote", "set-url", "origin", &dir.join("gone.git").to_string_lossy()], &work);
        let err = open_pr_with(&path_env, &root, "2026-09-17").unwrap_err();
        assert!(err.starts_with("$ git fetch"), "{err}");
        assert_eq!(git_out(&["rev-parse", "main"], &work), main_tip);
    }

    #[cfg(unix)]
    #[test]
    fn import_all_new_hands_mnemo_a_tree_of_only_the_new_rules() {
        let repo = fixture_repo("import-new");
        let dir = repo.parent().unwrap().to_path_buf();
        let fake = dir.join("mnemo");
        script(&fake, "#!/bin/sh\necho \"$2\"\ncd \"$2\" && find . -name '*.md' | sort\n");
        let path_env = std::env::var("PATH").unwrap_or_default();
        let cwd = repo.join("sets").to_string_lossy().to_string();
        let out = import_new_with(&fake.to_string_lossy(), &path_env, &cwd, Path::new(VAULT)).unwrap();
        let mut lines = out.lines();
        let scratch = PathBuf::from(lines.next().unwrap());
        assert_eq!(lines.collect::<Vec<_>>(), vec!["./feedback/no-silent-contract-changes.md"]);
        assert!(!scratch.exists(), "the scratch tree is removed");

        let nothing_new = dir.join("vault");
        std::fs::create_dir_all(nothing_new.join(".mnemo")).unwrap();
        std::fs::write(nothing_new.join(".mnemo/vault-id"), "3f9c2a7e5b1d4c8a9e6f0b2d4a6c8e1f").unwrap();
        std::fs::create_dir_all(nothing_new.join("shared/feedback")).unwrap();
        let theirs = repo.join(SHARE_DIR).join("feedback/login-shell-path-for-clis.md");
        std::fs::copy(theirs, nothing_new.join("shared/feedback/login-shell-path-for-clis.md")).unwrap();
        let err = import_new_with(&fake.to_string_lossy(), &path_env, &cwd, &nothing_new).unwrap_err();
        assert_eq!(err, "no new rules to import");
    }
}

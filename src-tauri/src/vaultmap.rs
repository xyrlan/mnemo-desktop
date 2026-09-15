//! Vault map (issue #71): the whole vault as one graph the front-end draws with sigma, where
//! it sits, and pages being born in it.
//!
//! - `vault_map(scope)`: one node per live page in `scope` (empty or `all`, `agent:<name>`,
//!   `topic:<name>`), `link` edges for `[[wikilinks]]`, faint `topic` edges for shared rare
//!   topics (each page keeps its `TOPIC_NEIGHBOURS` strongest), and a hollow `ghost` node per
//!   `_inbox` proposal with a `rewrite` edge to the page it would rewrite.
//! - `vault_map_positions_read/write(scope)`: where the user last saw each page, by path, in
//!   `~/.mnemo-desktop/vault-map-positions.json`, so regions stay put between opens.
//! - A watcher (`watch_start`, from `lib.rs` setup) rescans the vault's page files whenever
//!   `notify` sees a change under `shared/` or `bots/`, `.mnemo/learned.jsonl` grows, or
//!   `RESCAN` passes, and emits `mnemo://vault-born { path, slug }` per new page and
//!   `mnemo://vault-changed { paths }` for rewritten, removed and inbox pages. Nothing is
//!   replayed: the first scan only sets the baseline.
//!
//! Pages, fires and heat come from `vault.rs`; building the map (`build_map`), the positions
//! file (`read_positions`, `write_positions`) and the scan diff (`diff`) are pure or confined to
//! the paths they are given.

use crate::vault::{self, LivePage, Page, PageInfo, Scope};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

pub const BORN_EVENT: &str = "mnemo://vault-born";
pub const CHANGED_EVENT: &str = "mnemo://vault-changed";

/// Topic edges each page keeps: past a handful, shared topics turn the map into a hairball.
pub const TOPIC_NEIGHBOURS: usize = 3;

// ---------------------------------------------------------------- model --

/// Mirrored by `src/vault/map/types.ts`.
#[derive(Debug, Clone, Serialize, PartialEq, Default)]
pub struct MapNode {
    /// The page path: the node id, what `vault_page` takes.
    pub path: String,
    pub slug: String,
    pub name: String,
    pub confidence: Option<String>,
    /// Fires with a 30-day half-life (`vault::heat`); 0 for a ghost.
    pub heat: f64,
    #[serde(rename = "type")]
    pub page_type: String,
    /// `shared`, or the repo agent the page belongs to (a ghost: the page it would rewrite's).
    pub agent: String,
    /// Reflex emissions plus MCP reads, all time: a rule that never fired is drawn grey.
    pub fires: u32,
    /// An `_inbox` proposal, not a live page.
    pub ghost: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct MapEdge {
    pub source: String,
    pub target: String,
    /// `link` (a wikilink, either way), `topic` (shared rare topics) or `rewrite` (ghost → page).
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
pub struct VaultMap {
    pub nodes: Vec<MapNode>,
    pub edges: Vec<MapEdge>,
    pub error: Option<String>,
}

// ------------------------------------------------------------------ map --

fn read_scope(scope: &str) -> Result<Option<Scope>, String> {
    match scope.trim() {
        "" | "all" => Ok(None),
        s => vault::parse_scope(s).map(Some),
    }
}

fn in_scope(scope: &Option<Scope>, p: &LivePage) -> bool {
    match scope {
        None => true,
        Some(Scope::Agent(a)) => p.agent == *a,
        Some(Scope::Topic(t)) => p.page.info.topics.iter().any(|x| x.trim().eq_ignore_ascii_case(t)),
    }
}

fn stem(path: &str) -> &str {
    let file = path.rsplit('/').next().unwrap_or(path);
    file.strip_suffix(".md").unwrap_or(file)
}

fn parent(path: &str) -> &str {
    path.rsplit_once('/').map_or("", |(d, _)| d)
}

/// Wikilink resolution over a few thousand pages without a scan per link: pages by slug and by
/// file stem. Lands where `vault.rs`'s `resolve` does: a `dir/target` path match first, then a
/// page in the linking page's folder, then the first page by order.
struct Index<'a> {
    pages: &'a [&'a PageInfo],
    by_name: HashMap<&'a str, Vec<usize>>,
}

impl<'a> Index<'a> {
    fn new(pages: &'a [&'a PageInfo]) -> Index<'a> {
        let mut by_name: HashMap<&str, Vec<usize>> = HashMap::new();
        for (i, p) in pages.iter().enumerate() {
            by_name.entry(p.slug.as_str()).or_default().push(i);
            let s = stem(&p.path);
            if s != p.slug {
                by_name.entry(s).or_default().push(i);
            }
        }
        // A page named twice (slug and stem) under one key was pushed once; keep page order.
        for v in by_name.values_mut() {
            v.sort_unstable();
            v.dedup();
        }
        Index { pages, by_name }
    }

    fn resolve(&self, target: &str, from: usize) -> Option<usize> {
        let last = target.rsplit('/').next().unwrap_or(target);
        let cands: Vec<usize> = self.by_name.get(last)?.iter().copied().filter(|&i| self.pages[i].path != self.pages[from].path).collect();
        if target.contains('/') {
            let suffix = format!("/{target}.md");
            if let Some(&i) = cands.iter().find(|&&i| self.pages[i].path.ends_with(&suffix)) {
                return Some(i);
            }
        }
        let home = parent(&self.pages[from].path);
        cands.iter().copied().find(|&i| parent(&self.pages[i].path) == home).or_else(|| cands.first().copied())
    }
}

fn folded_topics(p: &PageInfo) -> Vec<String> {
    let mut out: Vec<String> = p.topics.iter().map(|t| t.trim().to_lowercase()).filter(|t| !t.is_empty()).collect();
    out.sort();
    out.dedup();
    out
}

/// The map of `scope` over every live page (links and topic rarity are read across the whole
/// vault, then kept only between nodes in scope) and the staged proposals in `inbox`.
pub fn build_map(pages: &[LivePage], inbox: &[Page], scope: &str, fires: &vault::Fires, now: u64) -> Result<VaultMap, String> {
    let scope = read_scope(scope)?;
    let infos: Vec<&PageInfo> = pages.iter().map(|p| &p.page.info).collect();
    let kept: Vec<usize> = (0..pages.len()).filter(|&i| in_scope(&scope, &pages[i])).collect();
    let shown: HashSet<usize> = kept.iter().copied().collect();

    let mut nodes: Vec<MapNode> = kept
        .iter()
        .map(|&i| {
            let (p, fire) = (infos[i], vault::fire_of(fires, infos[i]));
            MapNode {
                path: p.path.clone(),
                slug: p.slug.clone(),
                name: p.name.clone(),
                confidence: p.confidence.clone(),
                heat: vault::heat(&fire, now),
                page_type: p.page_type.clone(),
                agent: pages[i].agent.clone(),
                fires: fire.count,
                ghost: false,
            }
        })
        .collect();

    let pair = |a: usize, b: usize| if a < b { (a, b) } else { (b, a) };
    let mut edges = Vec::new();
    let index = Index::new(&infos);
    let mut linked: HashSet<(usize, usize)> = HashSet::new();
    for &i in &kept {
        for t in vault::wikilinks(&infos[i].body) {
            let Some(j) = index.resolve(&t, i) else { continue };
            if j != i && shown.contains(&j) && linked.insert(pair(i, j)) {
                edges.push(MapEdge { source: infos[i].path.clone(), target: infos[j].path.clone(), kind: "link".into() });
            }
        }
    }

    // Rare topics: carried by at most `HUB_PAGES` pages vault-wide. A pair's weight sums
    // 1/carriers over the rare topics it shares, so one very rare topic beats a common one.
    let topics: Vec<Vec<String>> = infos.iter().map(|p| folded_topics(p)).collect();
    let mut carriers: HashMap<&str, Vec<usize>> = HashMap::new();
    for (i, ts) in topics.iter().enumerate() {
        for t in ts {
            carriers.entry(t.as_str()).or_default().push(i);
        }
    }
    let mut weight: HashMap<(usize, usize), f64> = HashMap::new();
    for all in carriers.values().filter(|c| c.len() >= 2 && c.len() <= vault::HUB_PAGES) {
        let w = 1.0 / all.len() as f64;
        let members: Vec<usize> = all.iter().copied().filter(|i| shown.contains(i)).collect();
        for (k, &a) in members.iter().enumerate() {
            for &b in &members[k + 1..] {
                *weight.entry((a, b)).or_default() += w;
            }
        }
    }
    let mut strongest: HashMap<usize, Vec<(usize, f64)>> = HashMap::new();
    for (&(a, b), &w) in &weight {
        strongest.entry(a).or_default().push((b, w));
        strongest.entry(b).or_default().push((a, w));
    }
    let mut topical: Vec<(usize, usize)> = Vec::new();
    let mut seen = HashSet::new();
    for &i in &kept {
        let Some(list) = strongest.get_mut(&i) else { continue };
        list.sort_by(|(a, wa), (b, wb)| wb.total_cmp(wa).then(infos[*a].path.cmp(&infos[*b].path)));
        for &(j, _) in list.iter().take(TOPIC_NEIGHBOURS) {
            let p = pair(i, j);
            if !linked.contains(&p) && seen.insert(p) {
                topical.push(p);
            }
        }
    }
    edges.extend(topical.into_iter().map(|(a, b)| MapEdge { source: infos[a].path.clone(), target: infos[b].path.clone(), kind: "topic".into() }));

    // Ghosts: a proposal whose slug names a page on the map.
    let mut by_slug: HashMap<&str, usize> = HashMap::new();
    for &i in kept.iter().rev() {
        by_slug.insert(infos[i].slug.as_str(), i);
    }
    for proposal in inbox {
        let Some(&i) = by_slug.get(proposal.info.slug.as_str()) else { continue };
        let p = &proposal.info;
        nodes.push(MapNode {
            path: p.path.clone(),
            slug: p.slug.clone(),
            name: p.name.clone(),
            confidence: p.confidence.clone(),
            heat: 0.0,
            page_type: p.page_type.clone(),
            agent: pages[i].agent.clone(),
            fires: 0,
            ghost: true,
        });
        edges.push(MapEdge { source: p.path.clone(), target: infos[i].path.clone(), kind: "rewrite".into() });
    }
    Ok(VaultMap { nodes, edges, error: None })
}

// ------------------------------------------------------------ positions --

pub type Positions = HashMap<String, [f32; 2]>;

fn positions_file() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default().join(".mnemo-desktop").join("vault-map-positions.json")
}

fn scope_key(scope: &str) -> String {
    match scope.trim() {
        "" => "all".to_string(),
        s => s.to_string(),
    }
}

fn read_all(file: &Path) -> HashMap<String, Positions> {
    std::fs::read_to_string(file).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

/// The positions saved for `scope` (`""` and `all` are one), none when the file is missing or
/// unreadable.
pub fn read_positions(file: &Path, scope: &str) -> Positions {
    read_all(file).remove(&scope_key(scope)).unwrap_or_default()
}

/// Merges `positions` into `scope`'s, dropping non-finite ones: a page out of the map for a
/// while (a filter, a demotion) keeps its place. Written through a temporary file so a crash
/// mid-write never loses the layout.
pub fn write_positions(file: &Path, scope: &str, positions: Positions) -> Result<(), String> {
    let mut all = read_all(file);
    let entry = all.entry(scope_key(scope)).or_default();
    entry.extend(positions.into_iter().filter(|(_, [x, y])| x.is_finite() && y.is_finite()));
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    }
    let text = serde_json::to_string(&all).map_err(|e| e.to_string())?;
    let tmp = file.with_extension("json.tmp");
    std::fs::write(&tmp, text).map_err(|e| format!("{}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, file).map_err(|e| format!("{}: {e}", file.display()))
}

// ---------------------------------------------------------------- watch --

/// Mirrors `vault.rs`'s index files beside pages.
const NOT_PAGES: &[&str] = &["MEMORY.md", "README.md", "HOME.md", "INDEX.md"];
/// Mirrors `vault.rs`'s `MAX_DEPTH`: `shared/feedback/x.md` is 2.
const MAX_DEPTH: usize = 2;

/// Path → mtime (ms, 0 when unknown).
pub type Stamps = HashMap<String, u64>;

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Scan {
    /// Live pages: what `vault::live_pages` reads, without reading them.
    pub pages: Stamps,
    /// `_inbox` proposals.
    pub inbox: Stamps,
}

fn stamp(path: &Path) -> (String, u64) {
    let ms = std::fs::metadata(path).and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map_or(0, |d| d.as_millis() as u64);
    (path.to_string_lossy().replace('\\', "/"), ms)
}

/// The page files `vault::live_pages` would read (shared and project agents, `_`/`.` folders and
/// index files skipped), listed and stat'ed only: a few milliseconds for the whole vault.
pub fn scan(root: &Path) -> Scan {
    fn walk(dir: &Path, depth: usize, out: &mut Stamps) {
        let Ok(rd) = std::fs::read_dir(dir) else { return };
        for p in rd.flatten().map(|e| e.path()) {
            let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            if name.starts_with('_') || name.starts_with('.') {
                continue;
            }
            if p.is_dir() {
                if depth > 1 {
                    walk(&p, depth - 1, out);
                }
            } else if name.ends_with(".md") && !NOT_PAGES.contains(&name.as_str()) {
                let (k, v) = stamp(&p);
                out.insert(k, v);
            }
        }
    }
    let mut pages = Stamps::new();
    walk(&root.join("shared"), MAX_DEPTH, &mut pages);
    for bot in std::fs::read_dir(root.join("bots")).into_iter().flatten().flatten().map(|e| e.path()) {
        let name = bot.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        if !name.starts_with('.') && !vault::is_noise(&name) {
            walk(&bot.join("memory"), MAX_DEPTH, &mut pages);
        }
    }
    let inbox = vault::inbox_files(root).iter().map(|p| stamp(p)).collect();
    Scan { pages, inbox }
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Delta {
    /// Pages in `new` only, sorted.
    pub born: Vec<String>,
    /// Pages rewritten or gone, and proposals staged, rewritten or gone; sorted.
    pub changed: Vec<String>,
}

pub fn diff(old: &Scan, new: &Scan) -> Delta {
    fn moved(a: &Stamps, b: &Stamps, out: &mut Vec<String>) {
        out.extend(b.iter().filter(|(k, v)| a.get(*k).is_some_and(|w| w != *v)).map(|(k, _)| k.clone()));
        out.extend(a.keys().filter(|k| !b.contains_key(*k)).cloned());
    }
    let mut born: Vec<String> = new.pages.keys().filter(|k| !old.pages.contains_key(*k)).cloned().collect();
    let mut changed = Vec::new();
    moved(&old.pages, &new.pages, &mut changed);
    moved(&old.inbox, &new.inbox, &mut changed);
    changed.extend(new.inbox.keys().filter(|k| !old.inbox.contains_key(*k)).cloned());
    born.sort();
    changed.sort();
    changed.dedup();
    Delta { born, changed }
}

/// `mnemo://vault-born`. Mirrored by `src/vault/map/types.ts`.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Born {
    pub path: String,
    pub slug: String,
}

/// `mnemo://vault-changed`.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Changed {
    pub paths: Vec<String>,
}

/// The born event of the page at `path`: its frontmatter slug, else the file stem.
pub fn born(path: &str) -> Born {
    let text = std::fs::read_to_string(path).unwrap_or_default();
    Born { path: path.to_string(), slug: vault::parse_page(Path::new(path), &text, None).info.slug }
}

/// Mnemo appends a row here per rule it learns; the page lands beside it.
const LEARNED: &str = ".mnemo/learned.jsonl";
/// Changes arriving closer than this are one rescan.
const SETTLE: Duration = Duration::from_millis(300);
/// A rescan happens at least this often, for whatever `notify` missed.
const RESCAN: Duration = Duration::from_secs(30);
const NO_VAULT_RETRY: Duration = Duration::from_secs(30);

static WATCHING: AtomicBool = AtomicBool::new(false);

/// Starts the born watcher once; later calls do nothing.
pub fn watch_start(app: tauri::AppHandle) {
    use notify::Watcher;
    use tauri::Emitter;
    if WATCHING.swap(true, Ordering::SeqCst) {
        return;
    }
    std::thread::spawn(move || {
        let root = loop {
            if let Some(root) = vault::vault_root() {
                break root;
            }
            std::thread::sleep(NO_VAULT_RETRY);
        };
        let (tx, rx) = std::sync::mpsc::channel::<()>();
        // Kept alive for the thread's life; without it (no FSEvents, a limit hit) the learned
        // tail and `RESCAN` still find every page, only later.
        let _watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
            if res.is_ok_and(|e| e.paths.iter().any(|p| !p.components().any(|c| c.as_os_str() == "briefings"))) {
                let _ = tx.send(());
            }
        })
        .and_then(|mut w| {
            for dir in ["shared", "bots"] {
                w.watch(&root.join(dir), notify::RecursiveMode::Recursive)?;
            }
            Ok(w)
        })
        .map_err(|e| log::warn!("vaultmap: no file watch, polling only: {e}"))
        .ok();

        let mut learned = crate::pulse::Tail::at_end(root.join(LEARNED));
        let mut last = scan(&root);
        let mut scanned = Instant::now();
        let mut dirty: Option<Instant> = None;
        loop {
            if rx.recv_timeout(Duration::from_secs(1)).is_ok() {
                dirty = Some(Instant::now());
                while rx.try_recv().is_ok() {}
            }
            if !learned.read().is_empty() {
                dirty = dirty.or(Some(Instant::now()));
            }
            let due = dirty.is_some_and(|at| at.elapsed() >= SETTLE) || scanned.elapsed() >= RESCAN;
            if !due {
                continue;
            }
            let now = scan(&root);
            let delta = diff(&last, &now);
            (last, scanned, dirty) = (now, Instant::now(), None);
            for path in &delta.born {
                let _ = app.emit(BORN_EVENT, born(path));
            }
            if !delta.changed.is_empty() {
                let _ = app.emit(CHANGED_EVENT, Changed { paths: delta.changed });
            }
        }
    });
}

// ------------------------------------------------------------ commands --

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}

const NO_VAULT: &str = "no mnemo vault found (`mnemo status` names none)";

#[tauri::command]
pub async fn vault_map(scope: String) -> VaultMap {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(root) = vault::vault_root() else { return VaultMap { error: Some(NO_VAULT.into()), ..Default::default() } };
        let (pages, fires) = std::thread::scope(|s| {
            let fires = s.spawn(|| vault::read_fires(&root));
            (vault::live_pages(&root), fires.join().unwrap_or_default())
        });
        let inbox: Vec<Page> = vault::inbox_files(&root).iter().map(|f| vault::page_at(&root, &f.to_string_lossy())).filter(|p| p.error.is_none()).collect();
        build_map(&pages, &inbox, &scope, &fires, now_ms()).unwrap_or_else(|e| VaultMap { error: Some(e), ..Default::default() })
    })
    .await
    .unwrap_or_else(|e| VaultMap { error: Some(e.to_string()), ..Default::default() })
}

#[tauri::command]
pub async fn vault_map_positions_read(scope: String) -> Positions {
    tauri::async_runtime::spawn_blocking(move || read_positions(&positions_file(), &scope)).await.unwrap_or_default()
}

#[tauri::command]
pub async fn vault_map_positions_write(scope: String, positions: Positions) {
    let _ = tauri::async_runtime::spawn_blocking(move || {
        if let Err(e) = write_positions(&positions_file(), &scope, positions) {
            log::warn!("vaultmap: positions not saved: {e}");
        }
    })
    .await;
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/fixtures/vault");
    const NOW: u64 = 1_789_430_400_000;

    fn fixture_map(scope: &str) -> VaultMap {
        let root = Path::new(FIXTURE);
        let inbox: Vec<Page> = vault::inbox_files(root).iter().map(|f| vault::page_at(root, &f.to_string_lossy())).collect();
        build_map(&vault::live_pages(root), &inbox, scope, &vault::read_fires(root), NOW).unwrap()
    }

    fn short(p: &str) -> &str {
        p.strip_prefix(FIXTURE).unwrap_or(p)
    }

    fn edges(m: &VaultMap) -> Vec<(String, String, String)> {
        let mut out: Vec<_> = m.edges.iter().map(|e| (e.kind.clone(), short(&e.source).to_string(), short(&e.target).to_string())).collect();
        out.sort();
        out
    }

    fn live(agent: &str, path: &str, body: &str, topics: &[&str]) -> LivePage {
        let slug = stem(path).to_string();
        LivePage {
            agent: agent.into(),
            page: Page {
                info: PageInfo { path: path.into(), name: slug.clone(), slug, body: body.into(), topics: topics.iter().map(|t| t.to_string()).collect(), ..Default::default() },
                ..Default::default()
            },
        }
    }

    #[test]
    fn fixture_map_has_every_live_page_links_and_a_ghost_for_the_staged_rewrite() {
        let m = fixture_map("");
        let mut paths: Vec<&str> = m.nodes.iter().map(|n| short(&n.path)).collect();
        paths.sort();
        assert_eq!(
            paths,
            [
                "/bots/mnemo-desktop/memory/no-silent-contract-changes.md",
                "/bots/mnemo-desktop/memory/shared-target-dir.md",
                "/shared/_inbox/run-tests-before-commit.md",
                "/shared/feedback/run-tests-before-commit.md",
                "/shared/feedback/verified-without-evidence.md",
                "/shared/project/dormant-activation.md",
            ]
        );
        let e = edges(&m);
        let links: Vec<_> = e.iter().filter(|(k, _, _)| k == "link").map(|(_, s, t)| (s.as_str(), t.as_str())).collect();
        assert_eq!(
            links,
            [
                ("/bots/mnemo-desktop/memory/shared-target-dir.md", "/bots/mnemo-desktop/memory/no-silent-contract-changes.md"),
                ("/shared/feedback/verified-without-evidence.md", "/shared/feedback/run-tests-before-commit.md"),
                ("/shared/project/dormant-activation.md", "/bots/mnemo-desktop/memory/shared-target-dir.md"),
            ]
        );
        assert!(e.contains(&("rewrite".into(), "/shared/_inbox/run-tests-before-commit.md".into(), "/shared/feedback/run-tests-before-commit.md".into())));
        let ghost = m.nodes.iter().find(|n| n.ghost).unwrap();
        assert_eq!((ghost.slug.as_str(), ghost.agent.as_str(), ghost.heat), ("run-tests-before-commit", "shared", 0.0));
        let rule = m.nodes.iter().find(|n| n.slug == "run-tests-before-commit" && !n.ghost).unwrap();
        assert_eq!((rule.agent.as_str(), rule.confidence.as_deref(), rule.page_type.as_str()), ("shared", Some("verified"), "feedback"));
        // Noise agents stay off the map, as they stay off the table.
        assert!(!m.nodes.iter().any(|n| n.path.contains("pytest")));
    }

    #[test]
    fn scope_keeps_its_pages_and_the_edges_between_them_only() {
        let m = fixture_map("agent:mnemo-desktop");
        assert_eq!(m.nodes.len(), 2);
        assert!(m.nodes.iter().all(|n| n.agent == "mnemo-desktop"));
        assert_eq!(edges(&m), [("link".into(), "/bots/mnemo-desktop/memory/shared-target-dir.md".into(), "/bots/mnemo-desktop/memory/no-silent-contract-changes.md".into())]);
        assert_eq!(fixture_map("all"), fixture_map(""));
        let root = Path::new(FIXTURE);
        assert!(build_map(&vault::live_pages(root), &[], "agent:../x", &Default::default(), NOW).is_err());
    }

    #[test]
    fn fixture_nodes_carry_heat_and_fires_from_the_logs() {
        let root = Path::new(FIXTURE);
        let rows = vault::rule_rows(&vault::live_pages(root), "", "", &vault::read_fires(root), &Default::default(), NOW).unwrap();
        let m = fixture_map("");
        for r in rows {
            let n = m.nodes.iter().find(|n| n.path == r.path && !n.ghost).unwrap();
            assert_eq!((n.heat, n.fires), (r.heat, r.fires), "{}", r.path);
        }
    }

    #[test]
    fn links_resolve_folder_first_then_path_and_count_once_per_pair() {
        let pages = vec![
            live("a", "/v/a/x.md", "[[y]] and again [[y]]", &[]),
            live("a", "/v/a/y.md", "back to [[x]]", &[]),
            live("b", "/v/b/y.md", "", &[]),
            live("b", "/v/b/z.md", "[[y]] [[a/y]] [[missing]] [[z]]", &[]),
        ];
        let m = build_map(&pages, &[], "", &Default::default(), NOW).unwrap();
        let e = edges(&m);
        assert_eq!(
            e,
            [
                ("link".into(), "/v/a/x.md".into(), "/v/a/y.md".into()),
                ("link".into(), "/v/b/z.md".into(), "/v/a/y.md".into()),
                ("link".into(), "/v/b/z.md".into(), "/v/b/y.md".into()),
            ]
        );
    }

    #[test]
    fn topic_edges_skip_hubs_and_linked_pairs_and_keep_the_strongest_few() {
        let mut pages = vec![
            live("a", "/v/0.md", "[[1]]", &["rare", "hub"]),
            live("a", "/v/1.md", "", &["rare"]),
            live("a", "/v/2.md", "", &["rare", "Rarer "]),
            live("a", "/v/3.md", "", &["rarer"]),
        ];
        // `hub` on more pages than `HUB_PAGES`: sharing it is no edge.
        for i in 0..vault::HUB_PAGES {
            pages.push(live("hubs", &format!("/v/h{i}.md"), "", &["hub"]));
        }
        let m = build_map(&pages, &[], "", &Default::default(), NOW).unwrap();
        let topic: Vec<_> = edges(&m).into_iter().filter(|(k, _, _)| k == "topic").map(|(_, s, t)| (s, t)).collect();
        assert_eq!(topic, [("/v/0.md".into(), "/v/2.md".into()), ("/v/1.md".into(), "/v/2.md".into()), ("/v/2.md".into(), "/v/3.md".into())]);

        // Twelve pages on one rare topic: each keeps `TOPIC_NEIGHBOURS`, not eleven.
        let crowd: Vec<LivePage> = (0..12).map(|i| live("a", &format!("/v/c{i:02}.md"), "", &["crowd"])).collect();
        let m = build_map(&crowd, &[], "", &Default::default(), NOW).unwrap();
        assert!(m.edges.len() <= 12 * TOPIC_NEIGHBOURS && m.edges.len() >= 12 * TOPIC_NEIGHBOURS / 2, "{}", m.edges.len());
    }

    /// `cargo test --lib vaultmap_live -- --ignored --nocapture`: the real vault's size and timings.
    #[test]
    #[ignore]
    fn vaultmap_live() {
        let root = vault::vault_root().expect("a vault");
        let t = Instant::now();
        let (pages, fires) = (vault::live_pages(&root), vault::read_fires(&root));
        let inbox: Vec<Page> = vault::inbox_files(&root).iter().map(|f| vault::page_at(&root, &f.to_string_lossy())).collect();
        let read = t.elapsed();
        let m = build_map(&pages, &inbox, "", &fires, now_ms()).unwrap();
        let count = |k: &str| m.edges.iter().filter(|e| e.kind == k).count();
        eprintln!(
            "{} nodes ({} ghosts), {} links, {} topic, {} rewrite; read {read:?}, built {:?}; scan {:?}",
            m.nodes.len(),
            m.nodes.iter().filter(|n| n.ghost).count(),
            count("link"),
            count("topic"),
            count("rewrite"),
            t.elapsed() - read,
            {
                let s = Instant::now();
                scan(&root);
                s.elapsed()
            }
        );
        assert!(m.nodes.len() > 100);
    }

    #[test]
    fn positions_round_trip_per_scope_and_merge() {
        let dir = std::env::temp_dir().join(format!("mnemo-desktop-vaultmap-pos-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let file = dir.join("vault-map-positions.json");
        assert!(read_positions(&file, "").is_empty());
        write_positions(&file, "", HashMap::from([("/a.md".to_string(), [1.0, 2.0]), ("/nan.md".to_string(), [f32::NAN, 0.0])])).unwrap();
        write_positions(&file, "agent:x", HashMap::from([("/a.md".to_string(), [9.0, 9.0])])).unwrap();
        write_positions(&file, "all", HashMap::from([("/b.md".to_string(), [3.0, -4.5])])).unwrap();
        assert_eq!(read_positions(&file, "all"), HashMap::from([("/a.md".to_string(), [1.0, 2.0]), ("/b.md".to_string(), [3.0, -4.5])]));
        assert_eq!(read_positions(&file, "agent:x"), HashMap::from([("/a.md".to_string(), [9.0, 9.0])]));
        std::fs::write(&file, "not json").unwrap();
        assert!(read_positions(&file, "").is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn scan_lists_exactly_the_pages_the_map_reads() {
        let root = Path::new(FIXTURE);
        let mut scanned: Vec<String> = scan(root).pages.into_keys().collect();
        scanned.sort();
        let mut read: Vec<String> = vault::live_pages(root).into_iter().map(|p| p.page.info.path).collect();
        read.sort();
        assert_eq!(scanned, read);
        let inbox: Vec<String> = scan(root).inbox.into_keys().map(|p| short(&p).to_string()).collect();
        assert_eq!(inbox, ["/shared/_inbox/run-tests-before-commit.md"]);
    }

    #[test]
    fn diff_reports_born_pages_and_rewritten_removed_or_staged_ones() {
        let s = |pages: &[(&str, u64)], inbox: &[(&str, u64)]| Scan {
            pages: pages.iter().map(|(k, v)| (k.to_string(), *v)).collect(),
            inbox: inbox.iter().map(|(k, v)| (k.to_string(), *v)).collect(),
        };
        let old = s(&[("/a", 1), ("/b", 1), ("/c", 1)], &[("/i", 1)]);
        let new = s(&[("/a", 1), ("/b", 2), ("/d", 1), ("/e", 1)], &[("/j", 1)]);
        assert_eq!(diff(&old, &new), Delta { born: vec!["/d".into(), "/e".into()], changed: vec!["/b".into(), "/c".into(), "/i".into(), "/j".into()] });
        assert_eq!(diff(&new, &new), Delta::default());
    }

    #[test]
    fn a_page_written_into_a_scratch_vault_is_born_with_its_slug() {
        let dir = std::env::temp_dir().join(format!("mnemo-desktop-vaultmap-born-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("shared/feedback")).unwrap();
        std::fs::create_dir_all(dir.join("bots/clubinho/memory/_inbox")).unwrap();
        let before = scan(&dir);
        std::fs::write(dir.join("shared/feedback/new-rule.md"), "---\nname: New\nslug: brand-new\n---\nbody\n").unwrap();
        std::fs::write(dir.join("bots/clubinho/memory/painel.md"), "no frontmatter").unwrap();
        std::fs::write(dir.join("bots/clubinho/memory/MEMORY.md"), "index").unwrap();
        std::fs::write(dir.join("bots/clubinho/memory/_inbox/painel.md"), "---\nname: p\n---\n").unwrap();
        let delta = diff(&before, &scan(&dir));
        let born: Vec<Born> = delta.born.iter().map(|p| born(p)).collect();
        let d = dir.to_string_lossy().replace('\\', "/");
        assert_eq!(
            born,
            [
                Born { path: format!("{d}/bots/clubinho/memory/painel.md"), slug: "painel".into() },
                Born { path: format!("{d}/shared/feedback/new-rule.md"), slug: "brand-new".into() },
            ]
        );
        assert_eq!(delta.changed, [format!("{d}/bots/clubinho/memory/_inbox/painel.md")]);
        let json = serde_json::to_value(&born[1]).unwrap();
        assert_eq!(json, serde_json::json!({ "path": format!("{d}/shared/feedback/new-rule.md"), "slug": "brand-new" }));
        let _ = std::fs::remove_dir_all(&dir);
    }
}

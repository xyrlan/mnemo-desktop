//! What the vault handed a child and what the child pushed back against, joined by
//! `session_id` — read for the mission pane, so memory is visible where the work is and
//! not only on the vault screen.
//!
//! Three of the vault's logs carry a session id today: `.mnemo/briefing-log.jsonl`
//! (`reader_session_id`, the briefing a session started with), `.mnemo/reflex-log.jsonl`
//! (+ its rotated `.1`, `session_id` and `emitted`, the rules injected into its prompts)
//! and `.mnemo/friction-ledger.jsonl` (`session_id`, `contradicts` and
//! `injected_in_session`, the rules its session contradicted). `.mnemo/mcp-access-log.jsonl`
//! only gained one on vaults built after xyrlan/mnemo#438; read the field when a row
//! carries it, and say so rather than guess when none does.
//!
//! `vault::vault_root` and `pulse`, which tail the same logs, are read-only here: this
//! module parses its own rows rather than reuse theirs, the way `vault.rs` and `pulse.rs`
//! already each parse `reflex-log.jsonl` on their own terms.

use crate::mission::iso_ms;
use crate::vault::rule_slug;
use serde::{Deserialize, Serialize};
use std::path::Path;

/// Mirrored by `src/mission/memory/types.ts`.
#[derive(Debug, Clone, Serialize, PartialEq, Default)]
pub struct ChildMemory {
    pub briefing: Option<BriefingRef>,
    /// Rules injected into the session's prompts, in log order (a rotated `.1` first).
    pub injected: Vec<RuleHit>,
    /// Corrections made during the session, in log order.
    pub friction: Vec<Pushback>,
    /// Rule slugs the session read over MCP (`read_mnemo_rule`). `None` when no row in
    /// the log carries a `session_id` at all: the vault predates #438, and an empty list
    /// here would wrongly say "read nothing" instead of "cannot say".
    pub mcp_reads: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct BriefingRef {
    pub path: String,
    pub at: Option<u64>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct RuleHit {
    pub slug: String,
    pub at: Option<u64>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Pushback {
    pub rule_text: String,
    pub contradicts: Vec<String>,
    pub injected_in_session: Vec<String>,
    pub at: Option<u64>,
}

const REFLEX_LOGS: &[&str] = &[".mnemo/reflex-log.jsonl.1", ".mnemo/reflex-log.jsonl"];

#[derive(Deserialize)]
struct BriefingRow {
    reader_session_id: Option<String>,
    path: Option<String>,
    timestamp: Option<String>,
}

#[derive(Deserialize)]
struct ReflexRow {
    session_id: Option<String>,
    emitted: Option<Vec<String>>,
    ts: Option<String>,
}

#[derive(Deserialize)]
struct FrictionRow {
    session_id: Option<String>,
    rule_text: Option<String>,
    contradicts: Option<Vec<String>>,
    injected_in_session: Option<Vec<String>>,
    ts: Option<String>,
}

#[derive(Deserialize)]
struct AccessRow {
    session_id: Option<String>,
    tool: Option<String>,
    hit_slugs: Option<Vec<String>>,
}

fn slugs(ids: &[String]) -> Vec<String> {
    ids.iter().map(|id| rule_slug(id).to_string()).collect()
}

/// The briefing `session_id` started with: the last matching row, since a re-briefed
/// session (a restart re-injects) is running on the latest one, not its first.
fn briefing_for(text: &str, session_id: &str) -> Option<BriefingRef> {
    text.lines()
        .filter_map(|l| serde_json::from_str::<BriefingRow>(l).ok())
        .rfind(|r| r.reader_session_id.as_deref() == Some(session_id))
        .and_then(|r| r.path.map(|path| BriefingRef { path, at: r.timestamp.as_deref().and_then(iso_ms) }))
}

/// Rules injected into `session_id`'s prompts, oldest rotation first, log order within it.
fn injected_for(texts: &[String], session_id: &str) -> Vec<RuleHit> {
    texts
        .iter()
        .flat_map(|t| t.lines())
        .filter_map(|l| serde_json::from_str::<ReflexRow>(l).ok())
        .filter(|r| r.session_id.as_deref() == Some(session_id))
        .flat_map(|r| {
            let at = r.ts.as_deref().and_then(iso_ms);
            slugs(&r.emitted.unwrap_or_default()).into_iter().map(move |slug| RuleHit { slug, at })
        })
        .collect()
}

/// Corrections made during `session_id`, in log order.
fn friction_for(text: &str, session_id: &str) -> Vec<Pushback> {
    text.lines()
        .filter_map(|l| serde_json::from_str::<FrictionRow>(l).ok())
        .filter(|r| r.session_id.as_deref() == Some(session_id))
        .map(|r| Pushback {
            rule_text: r.rule_text.unwrap_or_default(),
            contradicts: slugs(&r.contradicts.unwrap_or_default()),
            injected_in_session: slugs(&r.injected_in_session.unwrap_or_default()),
            at: r.ts.as_deref().and_then(iso_ms),
        })
        .collect()
}

/// Rules `session_id` read over MCP, or `None` when the whole log carries no session id
/// yet (see the `mcp_reads` field doc).
fn mcp_reads_for(text: &str, session_id: &str) -> Option<Vec<String>> {
    let rows: Vec<AccessRow> = text.lines().filter_map(|l| serde_json::from_str(l).ok()).collect();
    if !rows.iter().any(|r| r.session_id.is_some()) {
        return None;
    }
    Some(
        rows.into_iter()
            .filter(|r| r.session_id.as_deref() == Some(session_id) && r.tool.as_deref() == Some("read_mnemo_rule"))
            .flat_map(|r| slugs(&r.hit_slugs.unwrap_or_default()))
            .collect(),
    )
}

fn read(root: &Path, rel: &str) -> String {
    std::fs::read_to_string(root.join(rel)).unwrap_or_default()
}

/// What the vault gave `session_id` and what it pushed back against. A session with no
/// rows in a log reads as empty there; it is never an error, since a fresh child or one
/// with no `session_id` yet has none to find.
pub fn collect(root: &Path, session_id: &str) -> ChildMemory {
    let reflex: Vec<String> = REFLEX_LOGS.iter().map(|f| read(root, f)).collect();
    ChildMemory {
        briefing: briefing_for(&read(root, ".mnemo/briefing-log.jsonl"), session_id),
        injected: injected_for(&reflex, session_id),
        friction: friction_for(&read(root, ".mnemo/friction-ledger.jsonl"), session_id),
        mcp_reads: mcp_reads_for(&read(root, ".mnemo/mcp-access-log.jsonl"), session_id),
    }
}

#[tauri::command]
pub async fn child_memory(session_id: String) -> ChildMemory {
    tauri::async_runtime::spawn_blocking(move || match crate::vault::vault_root() {
        Some(root) => collect(&root, &session_id),
        None => ChildMemory::default(),
    })
    .await
    .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    const FIXTURE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/fixtures/child_memory");

    fn fixture(name: &str) -> String {
        std::fs::read_to_string(Path::new(FIXTURE).join(name)).unwrap()
    }

    #[test]
    fn briefing_takes_the_last_row_this_session_read() {
        let f = fixture("briefing-log.jsonl");
        let b = briefing_for(&f, "sess-b").unwrap();
        assert_eq!(b.path, "bots/mnemo/briefings/sessions/second.md");
        assert!(b.at.is_some());
        assert!(briefing_for(&f, "sess-unknown").is_none());
    }

    #[test]
    fn injected_strips_prefixes_and_filters_by_session_across_rotations() {
        let rotated = fixture("reflex-log.jsonl.1");
        let current = fixture("reflex-log.jsonl");
        let hits = injected_for(&[rotated, current], "sess-b");
        let slugs: Vec<_> = hits.iter().map(|h| h.slug.as_str()).collect();
        assert_eq!(slugs, ["old-rule", "run-the-tests", "bg-spare-pool-is-one-spare"], "the rotated file comes first");
        assert!(injected_for(&[fixture("reflex-log.jsonl")], "sess-unknown").is_empty());
    }

    #[test]
    fn friction_filters_by_session_and_normalises_slugs() {
        let p = friction_for(&fixture("friction-ledger.jsonl"), "sess-b");
        assert_eq!(p.len(), 1);
        assert_eq!(p[0].rule_text, "Ask before rewriting a whole file.");
        assert_eq!(p[0].contradicts, ["cockpit-graph-react-flow-with-filtered-nodes"]);
        assert_eq!(p[0].injected_in_session, ["readme-dispatch-loop-243", "merge-requires-admin"]);
    }

    #[test]
    fn mcp_reads_is_none_when_no_row_in_the_log_carries_a_session_id() {
        assert_eq!(mcp_reads_for(&fixture("mcp-access-log-no-session.jsonl"), "sess-b"), None);
    }

    #[test]
    fn mcp_reads_is_the_matched_slugs_once_the_log_carries_session_ids() {
        let reads = mcp_reads_for(&fixture("mcp-access-log.jsonl"), "sess-b").unwrap();
        assert_eq!(reads, ["stream-state-persist-with-overlay-not-swap"]);
        // A session with rows but no `read_mnemo_rule` hit really did read nothing: `Some([])`,
        // not `None`, once the log itself proves the field is recorded.
        assert_eq!(mcp_reads_for(&fixture("mcp-access-log.jsonl"), "sess-no-reads"), Some(vec![]));
    }

    fn scratch(tag: &str) -> std::path::PathBuf {
        let dir = crate::testutil::temp_dir(&format!("child-memory-{tag}"));
        std::fs::create_dir_all(dir.join(".mnemo")).unwrap();
        dir
    }

    fn write(path: &Path, text: &str) {
        std::fs::File::create(path).unwrap().write_all(text.as_bytes()).unwrap();
    }

    #[test]
    fn collect_joins_every_log_by_session_id() {
        let dir = scratch("collect");
        write(&dir.join(".mnemo/briefing-log.jsonl"), &fixture("briefing-log.jsonl"));
        write(&dir.join(".mnemo/reflex-log.jsonl"), &fixture("reflex-log.jsonl"));
        write(&dir.join(".mnemo/friction-ledger.jsonl"), &fixture("friction-ledger.jsonl"));
        write(&dir.join(".mnemo/mcp-access-log.jsonl"), &fixture("mcp-access-log.jsonl"));

        let m = collect(&dir, "sess-b");
        assert_eq!(m.briefing.unwrap().path, "bots/mnemo/briefings/sessions/second.md");
        assert!(!m.injected.is_empty());
        assert_eq!(m.friction.len(), 1);
        assert_eq!(m.mcp_reads, Some(vec!["stream-state-persist-with-overlay-not-swap".to_string()]));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn collect_on_a_child_with_no_rows_anywhere_is_empty_not_an_error() {
        let dir = scratch("empty");
        let m = collect(&dir, "sess-nobody");
        assert_eq!(m, ChildMemory { briefing: None, injected: vec![], friction: vec![], mcp_reads: None });
        let _ = std::fs::remove_dir_all(&dir);
    }
}

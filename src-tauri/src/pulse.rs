//! Pulse (issue #44): mnemo at work, as it happens. A thread tails the vault's activity
//! logs once a second and emits one `mnemo://pulse` per new line that is an event: a rule
//! the reflex hook injected, an MCP tool call, a rule enriching a tool call, a command
//! enforcement blocked. It starts at the end of every log, so history is never replayed.

use crate::vault::rule_slug;
use serde::{Deserialize, Serialize};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

pub const EVENT: &str = "mnemo://pulse";
const POLL: Duration = Duration::from_secs(1);
/// How long to wait before asking for the vault again when `mnemo status` names none.
const NO_VAULT_RETRY: Duration = Duration::from_secs(30);

/// Mirrored by `src/pulse/types.ts`.
#[derive(Debug, Clone, Serialize, PartialEq, Default)]
pub struct PulseEvent {
    /// ms since the epoch, from the log row (the time it was read when the row has none).
    pub at: u64,
    /// `reflex`, `tool`, `enrich` or `enforce`.
    pub kind: &'static str,
    pub project: String,
    /// The row's agent, else its project.
    pub agent: String,
    /// Rule slugs, without their `agent__` / `dir/` prefix (the vault graph's node slugs).
    pub slugs: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hits: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
}

/// One of the logs mnemo writes under `<vault>/.mnemo/`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Log {
    /// `reflex-log.jsonl`: one row per prompt, with the rules it `emitted`.
    Reflex,
    /// `mcp-access-log.jsonl`: MCP tool calls and session-start injections.
    Access,
    /// `enrichment-log.jsonl`: rules attached to an Edit/Write before it ran.
    Enrich,
    /// `denial-log.jsonl`: commands enforcement blocked.
    Denial,
}

pub const LOGS: [Log; 4] = [Log::Reflex, Log::Access, Log::Enrich, Log::Denial];

impl Log {
    pub fn file(self) -> &'static str {
        match self {
            Log::Reflex => ".mnemo/reflex-log.jsonl",
            Log::Access => ".mnemo/mcp-access-log.jsonl",
            Log::Enrich => ".mnemo/enrichment-log.jsonl",
            Log::Denial => ".mnemo/denial-log.jsonl",
        }
    }
}

/// Every field any of the logs uses; each log fills some.
#[derive(Deserialize, Default)]
#[serde(default)]
struct Row {
    ts: Option<String>,
    timestamp: Option<String>,
    project: Option<String>,
    agent: Option<String>,
    session_id: Option<String>,
    emitted: Option<Vec<String>>,
    tool: Option<String>,
    tool_name: Option<String>,
    hit_slugs: Option<Vec<String>>,
    result_count: Option<u32>,
    slug: Option<String>,
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn slugs(ids: &[String]) -> Vec<String> {
    ids.iter().map(|id| rule_slug(id).to_string()).filter(|s| !s.is_empty()).collect()
}

/// The event a log line stands for, if it is one. Not events: reflex rows that emitted
/// nothing, `llm.*` rows (mnemo's own background calls, not the agent using mnemo), and
/// anything that is not a JSON row. `now` stands in for a row without a timestamp.
pub fn parse_line(log: Log, line: &str, now: u64) -> Option<PulseEvent> {
    let row: Row = serde_json::from_str(line).ok()?;
    let at = row.ts.as_deref().or(row.timestamp.as_deref()).and_then(crate::mission::iso_ms).unwrap_or(now);
    let project = row.project.clone().unwrap_or_default();
    let agent = row.agent.clone().filter(|a| !a.is_empty()).unwrap_or_else(|| project.clone());
    let base = PulseEvent { at, project, agent, session_id: row.session_id.clone(), ..Default::default() };
    match log {
        Log::Reflex => {
            let slugs = slugs(row.emitted.as_deref().unwrap_or_default());
            (!slugs.is_empty()).then(|| PulseEvent { kind: "reflex", hits: Some(slugs.len() as u32), slugs, ..base })
        }
        Log::Access => {
            let tool = row.tool.filter(|t| !t.is_empty() && !t.starts_with("llm."))?;
            let slugs = slugs(row.hit_slugs.as_deref().unwrap_or_default());
            Some(PulseEvent { kind: "tool", tool: Some(tool), hits: row.result_count, slugs, ..base })
        }
        Log::Enrich => {
            let slugs = slugs(row.hit_slugs.as_deref().unwrap_or_default());
            (!slugs.is_empty()).then(|| PulseEvent { kind: "enrich", tool: row.tool_name, hits: Some(slugs.len() as u32), slugs, ..base })
        }
        Log::Denial => {
            let slug = row.slug.as_deref().map(rule_slug).filter(|s| !s.is_empty())?;
            Some(PulseEvent { kind: "enforce", tool: row.tool, hits: Some(1), slugs: vec![slug.to_string()], ..base })
        }
    }
}

#[cfg(unix)]
fn file_id(meta: &std::fs::Metadata) -> u64 {
    std::os::unix::fs::MetadataExt::ino(meta)
}
#[cfg(not(unix))]
fn file_id(_: &std::fs::Metadata) -> u64 {
    0
}

/// New complete lines of one file, from a byte bookmark. A file that shrank or was
/// replaced (mnemo rotates a full log to `.1`) is read again from its start; a line
/// still being written waits for its newline.
#[derive(Debug)]
pub struct Tail {
    path: PathBuf,
    offset: u64,
    id: u64,
    partial: Vec<u8>,
}

impl Tail {
    /// Bookmarked at the current end of `path`. A log that does not exist yet is read
    /// from its first line once it appears.
    pub fn at_end(path: PathBuf) -> Tail {
        let meta = std::fs::metadata(&path).ok();
        Tail { offset: meta.as_ref().map_or(0, |m| m.len()), id: meta.as_ref().map_or(0, file_id), path, partial: Vec::new() }
    }

    pub fn read(&mut self) -> Vec<String> {
        let Ok(meta) = std::fs::metadata(&self.path) else {
            *self = Tail { path: std::mem::take(&mut self.path), offset: 0, id: 0, partial: Vec::new() };
            return Vec::new();
        };
        let id = file_id(&meta);
        if meta.len() < self.offset || (self.id != 0 && id != self.id) {
            self.offset = 0;
            self.partial.clear();
        }
        self.id = id;
        if meta.len() == self.offset {
            return Vec::new();
        }
        let mut chunk = Vec::new();
        let read = std::fs::File::open(&self.path).and_then(|mut f| {
            f.seek(SeekFrom::Start(self.offset))?;
            f.read_to_end(&mut chunk)
        });
        if read.is_err() {
            return Vec::new();
        }
        self.offset += chunk.len() as u64;
        self.partial.extend_from_slice(&chunk);
        let Some(end) = self.partial.iter().rposition(|&b| b == b'\n') else { return Vec::new() };
        let done: Vec<u8> = self.partial.drain(..=end).collect();
        String::from_utf8_lossy(&done).lines().filter(|l| !l.trim().is_empty()).map(str::to_string).collect()
    }
}

/// Every log of one vault, bookmarked at its end.
pub struct Pulse {
    tails: Vec<(Log, Tail)>,
}

impl Pulse {
    pub fn new(root: &Path) -> Pulse {
        Pulse { tails: LOGS.iter().map(|&l| (l, Tail::at_end(root.join(l.file())))).collect() }
    }

    /// The events written since the last poll, log by log in file order.
    pub fn poll(&mut self, now: u64) -> Vec<PulseEvent> {
        self.tails.iter_mut().flat_map(|(log, tail)| tail.read().into_iter().filter_map(|l| parse_line(*log, &l, now)).collect::<Vec<_>>()).collect()
    }
}

static STARTED: AtomicBool = AtomicBool::new(false);

/// Starts the tailing thread; later calls (a reloaded window) do nothing.
#[tauri::command]
pub fn pulse_start(app: AppHandle) {
    if STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    std::thread::spawn(move || {
        let root = loop {
            if let Some(root) = crate::vault::vault_root() {
                break root;
            }
            std::thread::sleep(NO_VAULT_RETRY);
        };
        let mut pulse = Pulse::new(&root);
        loop {
            std::thread::sleep(POLL);
            for event in pulse.poll(now_ms()) {
                let _ = app.emit(EVENT, event);
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    const FIXTURE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/fixtures/pulse");

    fn fixture(name: &str) -> String {
        std::fs::read_to_string(Path::new(FIXTURE).join(name)).unwrap()
    }

    fn events(log: Log, name: &str) -> Vec<PulseEvent> {
        fixture(name).lines().filter_map(|l| parse_line(log, l, 7)).collect()
    }

    #[test]
    fn reflex_rows_are_events_only_when_they_emitted() {
        let e = events(Log::Reflex, "reflex-log.jsonl");
        assert_eq!(e.len(), 2);
        assert_eq!(
            e[0],
            PulseEvent {
                at: crate::mission::iso_ms("2026-09-15T11:22:22Z").unwrap(),
                kind: "reflex",
                project: "mnemo-desktop".into(),
                agent: "mnemo-desktop".into(),
                slugs: vec!["migrate-hand-before-auto-deploy".into()],
                tool: None,
                hits: Some(1),
                session_id: Some("f11816fc-b362-4779-b511-f98ed8d5c994".into()),
            }
        );
        // Prefixed ids name the graph's slugs.
        assert_eq!(e[1].slugs, ["bg-spare-pool-is-one-spare", "run-the-tests"]);
        assert_eq!(e[1].hits, Some(2));
    }

    #[test]
    fn access_rows_are_tool_events_except_mnemo_s_own_llm_calls() {
        let e = events(Log::Access, "mcp-access-log.jsonl");
        let tools: Vec<_> = e.iter().map(|e| (e.tool.as_deref().unwrap(), e.slugs.len(), e.hits)).collect();
        assert_eq!(tools, [("session_start.inject", 0, Some(1)), ("list_rules_by_topic", 2, Some(2)), ("read_mnemo_rule", 1, Some(1))]);
        assert!(e.iter().all(|e| e.kind == "tool" && e.session_id.is_none()));
        // Inject rows carry their agent; MCP calls only a project, which stands in.
        assert_eq!((e[0].agent.as_str(), e[2].agent.as_str()), ("sg-imports", "mnemo-desktop"));
    }

    #[test]
    fn enrichment_and_denial_rows() {
        let e = events(Log::Enrich, "enrichment-log.jsonl");
        assert_eq!(e.len(), 1);
        assert_eq!((e[0].kind, e[0].tool.as_deref(), e[0].project.as_str()), ("enrich", Some("Edit"), "clubinho"));
        assert_eq!(e[0].slugs, ["plan-upgrade-reuses-renewal-infrastructure-no-new-endpoint"]);

        let d = events(Log::Denial, "denial-log.jsonl");
        assert_eq!(d.len(), 1);
        assert_eq!((d[0].kind, d[0].tool.as_deref(), d[0].slugs.as_slice()), ("enforce", Some("Bash"), &["never-force-push-main".to_string()][..]));
    }

    #[test]
    fn junk_and_timestampless_rows() {
        assert_eq!(parse_line(Log::Reflex, "not json", 7), None);
        assert_eq!(parse_line(Log::Access, r#"{"project":"p"}"#, 7), None);
        assert_eq!(parse_line(Log::Enrich, r#"{"project":"p","hit_slugs":[]}"#, 7), None);
        assert_eq!(parse_line(Log::Denial, r#"{"project":"p"}"#, 7), None);
        let e = parse_line(Log::Access, r#"{"tool":"get_mnemo_topics","project":"p","ts":"yesterday"}"#, 7).unwrap();
        assert_eq!((e.at, e.hits), (7, None));
        let json = serde_json::to_value(&e).unwrap();
        assert_eq!(json, serde_json::json!({ "at": 7, "kind": "tool", "project": "p", "agent": "p", "slugs": [], "tool": "get_mnemo_topics" }));
    }

    fn scratch(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("mnemo-desktop-pulse-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join(".mnemo")).unwrap();
        dir
    }

    fn append(path: &Path, text: &str) {
        std::fs::OpenOptions::new().create(true).append(true).open(path).unwrap().write_all(text.as_bytes()).unwrap();
    }

    #[test]
    fn tail_starts_at_the_end_waits_for_newlines_and_follows_rotation() {
        let dir = scratch("tail");
        let path = dir.join("log.jsonl");
        append(&path, "old 1\nold 2\n");
        let mut tail = Tail::at_end(path.clone());
        assert!(tail.read().is_empty(), "history is not replayed");

        append(&path, "new 1\nnew 2 half");
        assert_eq!(tail.read(), ["new 1"]);
        append(&path, "\n\n");
        assert_eq!(tail.read(), ["new 2 half"]);
        assert!(tail.read().is_empty());

        // Rotation: the full log moves to `.1`, a fresh one starts.
        std::fs::rename(&path, dir.join("log.jsonl.1")).unwrap();
        assert!(tail.read().is_empty());
        append(&path, "after rotation\n");
        assert_eq!(tail.read(), ["after rotation"]);

        // Truncated in place.
        std::fs::write(&path, "").unwrap();
        assert!(tail.read().is_empty());
        append(&path, "after truncation\n");
        assert_eq!(tail.read(), ["after truncation"]);

        // A log that did not exist at launch is read from its first line.
        let later = dir.join("later.jsonl");
        let mut tail = Tail::at_end(later.clone());
        append(&later, "first\n");
        assert_eq!(tail.read(), ["first"]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn pulse_emits_only_what_was_written_after_it_started() {
        let dir = scratch("poll");
        for log in LOGS {
            let name = Path::new(log.file()).file_name().unwrap().to_str().unwrap();
            append(&dir.join(log.file()), &fixture(name));
        }
        let mut pulse = Pulse::new(&dir);
        assert!(pulse.poll(7).is_empty());

        for log in [Log::Denial, Log::Reflex] {
            let name = Path::new(log.file()).file_name().unwrap().to_str().unwrap();
            append(&dir.join(log.file()), &fixture(name));
        }
        let kinds: Vec<_> = pulse.poll(7).iter().map(|e| e.kind).collect();
        assert_eq!(kinds, ["reflex", "reflex", "enforce"]);
        assert!(pulse.poll(7).is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }
}

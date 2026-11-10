//! What a session's sub-agents spent: the transcripts Claude Code writes beside the session's
//! own, `<session>/subagents/agent-<id>.jsonl`, and a workflow's under
//! `<session>/subagents/workflows/<run>/`. Each has an `agent-<id>.meta.json` saying what the
//! agent was started for.
//!
//! Each transcript is read from where the last read stopped, like the session's. One that has
//! not been written to for a while is over: it is looked at again only once a minute.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use serde_json::Value;

use super::line::{is, short, text, Line};
use super::session::{message_key, plus, usage_row};
use super::tail::{Sink, Tail};
use super::{SubagentTokens, TokenRow};

/// The sub-agent folders are listed again after this long.
pub const LIST_EVERY_MS: u64 = 10_000;
/// A transcript untouched for this long is cold.
pub const COLD_AFTER_MS: u64 = 10 * 60_000;
/// A cold transcript is looked at again after this long.
pub const COLD_EVERY_MS: u64 = 60_000;
/// `subagents/workflows/<run>/agent-*.jsonl` is this deep; nothing is looked for deeper.
const DEPTH: usize = 3;

#[derive(Default)]
struct Tally {
    /// Every API message of the transcript, by `message_key`: its last record.
    rows: HashMap<u64, TokenRow>,
    model: Option<String>,
}

impl Sink for Tally {
    fn restart(&mut self) {
        *self = Tally::default();
    }

    fn line(&mut self, _offset: u64, raw: &str) {
        let Ok(l) = serde_json::from_str::<Line>(raw) else { return };
        if !is(l.kind, "assistant") {
            return;
        }
        let Some(m) = &l.message else { return };
        let Some(model) = text(m.model).filter(|m| m.starts_with("claude")) else { return };
        let Some(id) = text(m.id).or_else(|| text(l.uuid)) else { return };
        self.rows.insert(message_key(&id), usage_row(m.usage));
        self.model = Some(model);
    }
}

#[derive(Default)]
struct Sub {
    tail: Tail,
    tally: Tally,
    description: String,
    agent_type: Option<String>,
    meta_mtime: Option<SystemTime>,
    /// When it was last looked at, and whether it was cold then.
    checked: u64,
    cold: bool,
}

#[derive(Default)]
pub struct Subagents {
    listed: Option<u64>,
    /// By transcript path: a session's own agents sort before its workflows'.
    subs: BTreeMap<PathBuf, Sub>,
}

fn epoch_ms(t: SystemTime) -> u64 {
    t.duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}

/// Every `agent-*.jsonl` under `dir`, at most `depth` folders down.
fn transcripts(dir: &Path, depth: usize, found: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        let (path, name) = (e.path(), e.file_name().to_string_lossy().into_owned());
        let is_dir = e.file_type().is_ok_and(|t| t.is_dir());
        if is_dir && depth > 1 {
            transcripts(&path, depth - 1, found);
        } else if !is_dir && name.starts_with("agent-") && name.ends_with(".jsonl") {
            found.push(path);
        }
    }
}

impl Subagents {
    /// Bring what is known of the sub-agents of the session at `transcript` up to `now`;
    /// whether anything changed.
    pub fn refresh(&mut self, transcript: &Path, now: u64) -> bool {
        let mut changed = false;
        if self.listed.map_or(true, |at| now >= at + LIST_EVERY_MS) {
            self.listed = Some(now);
            let mut found = Vec::new();
            transcripts(&transcript.with_extension("").join("subagents"), DEPTH, &mut found);
            let before = self.subs.len();
            self.subs.retain(|path, _| found.contains(path));
            changed |= self.subs.len() != before;
            for path in found {
                self.subs.entry(path).or_default();
            }
        }
        for (path, sub) in &mut self.subs {
            if sub.cold && now < sub.checked + COLD_EVERY_MS {
                continue;
            }
            sub.checked = now;
            changed |= sub.tail.refresh(path, &mut sub.tally).unwrap_or(false);
            let written = std::fs::metadata(path).and_then(|m| m.modified()).map_or(0, epoch_ms);
            sub.cold = written + COLD_AFTER_MS <= now;
            changed |= sub.read_meta(&path.with_extension("meta.json"));
        }
        changed
    }

    /// One row per sub-agent, in path order. An API message the session's own transcript holds
    /// too (a fork opens on its parent's last message) or an earlier sub-agent's does is the
    /// same message: it is counted where it was first, not again here.
    pub fn tokens(&self, in_session: impl Fn(u64) -> bool) -> Vec<SubagentTokens> {
        let mut seen = HashSet::new();
        self.subs
            .iter()
            .map(|(path, sub)| {
                let mut row = SubagentTokens {
                    id: path.file_stem().map(|s| s.to_string_lossy().trim_start_matches("agent-").to_string()).unwrap_or_default(),
                    description: sub.description.clone(),
                    agent_type: sub.agent_type.clone(),
                    model: sub.tally.model.clone(),
                    calls: 0,
                    tokens: TokenRow::default(),
                };
                for (key, tokens) in &sub.tally.rows {
                    if !in_session(*key) && seen.insert(*key) {
                        row.calls += 1;
                        plus(&mut row.tokens, tokens);
                    }
                }
                row
            })
            .collect()
    }
}

impl Subagents {
    /// Each sub-agent transcript, and how far into it the reading reaches.
    #[cfg(test)]
    pub fn read_to(&self) -> Vec<(PathBuf, u64)> {
        self.subs.iter().map(|(path, sub)| (path.clone(), sub.tail.offset())).collect()
    }
}

impl Sub {
    /// Read the agent's meta file when it was written since the last read; whether it was.
    fn read_meta(&mut self, path: &Path) -> bool {
        let Ok(mtime) = std::fs::metadata(path).and_then(|m| m.modified()) else { return false };
        if self.meta_mtime == Some(mtime) {
            return false;
        }
        let Some(meta) = std::fs::read_to_string(path).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok()) else { return false };
        self.meta_mtime = Some(mtime);
        let said = |key: &str| meta.get(key).and_then(Value::as_str).filter(|s| !s.is_empty());
        self.description = short(said("description").unwrap_or_default(), 120);
        self.agent_type = said("agentType").or_else(|| said("subagent_type")).map(str::to_string);
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const NOW: u64 = 1_792_065_600_000; // 2026-10-15T12:00:00Z, before any file a test writes

    fn call(id: &str, model: &str, input: u64, output: u64) -> String {
        json!({ "type": "assistant", "isSidechain": true, "timestamp": "2026-10-15T12:00:00.000Z", "message": { "id": id, "model": model,
            "usage": { "input_tokens": input, "output_tokens": output, "cache_read_input_tokens": 100, "cache_creation_input_tokens": 10, "output_tokens_details": { "thinking_tokens": 1 } } } })
        .to_string()
            + "\n"
    }

    /// A session's transcript path in a fresh folder, and its `subagents/`.
    fn session(tag: &str) -> (PathBuf, PathBuf) {
        let dir = crate::testutil::temp_dir(tag);
        let subagents = dir.join("s1").join("subagents");
        std::fs::create_dir_all(&subagents).unwrap();
        (dir.join("s1.jsonl"), subagents)
    }

    fn append(path: &Path, text: &str) {
        use std::io::Write;
        std::fs::OpenOptions::new().append(true).create(true).open(path).and_then(|mut f| f.write_all(text.as_bytes())).unwrap();
    }

    fn row(input: u64, output: u64, messages: u64) -> TokenRow {
        TokenRow { input, output, cache_read: 100 * messages, cache_creation: 10 * messages, thinking: messages }
    }

    #[test]
    fn each_sub_agent_is_one_row_counting_a_message_once() {
        let (transcript, dir) = session("insight-subagents");
        // Two records of m1: the last one is the message. A synthetic line is no call.
        append(&dir.join("agent-a1.jsonl"), &(call("m1", "claude-haiku-5", 5, 1) + &call("m1", "claude-haiku-5", 5, 40) + &call("m2", "claude-sonnet-5", 7, 2) + &call("m3", "<synthetic>", 9, 9) + "{not json\n"));
        std::fs::write(dir.join("agent-a1.meta.json"), json!({ "agentType": "Explore", "description": "Find   the\nreader", "spawnDepth": 1 }).to_string()).unwrap();
        let workflow = dir.join("workflows").join("wf_1");
        std::fs::create_dir_all(&workflow).unwrap();
        append(&workflow.join("agent-b2.jsonl"), &call("m9", "claude-opus-5", 1, 1));
        std::fs::write(workflow.join("agent-b2.meta.json"), json!({ "subagent_type": "reviewer" }).to_string()).unwrap();
        std::fs::write(dir.join("notes.jsonl"), call("m8", "claude-opus-5", 999, 999)).unwrap();

        let mut subs = Subagents::default();
        assert!(subs.refresh(&transcript, NOW));
        let rows = subs.tokens(|_| false);
        assert_eq!(
            rows,
            [
                SubagentTokens { id: "a1".into(), description: "Find the reader".into(), agent_type: Some("Explore".into()), model: Some("claude-sonnet-5".into()), calls: 2, tokens: row(12, 42, 2) },
                SubagentTokens { id: "b2".into(), description: String::new(), agent_type: Some("reviewer".into()), model: Some("claude-opus-5".into()), calls: 1, tokens: row(1, 1, 1) },
            ]
        );
        assert!(!subs.refresh(&transcript, NOW + 3_000), "nothing was written: nothing changed");
        let _ = std::fs::remove_dir_all(transcript.parent().unwrap());
    }

    #[test]
    fn a_message_the_session_or_an_earlier_sub_agent_holds_is_not_counted_again() {
        let (transcript, dir) = session("insight-subagents-shared");
        append(&dir.join("agent-a1.jsonl"), &(call("parent", "claude-opus-5", 500, 500) + &call("m1", "claude-opus-5", 5, 5)));
        append(&dir.join("agent-b2.jsonl"), &(call("m1", "claude-opus-5", 5, 5) + &call("m2", "claude-opus-5", 7, 7)));
        let mut subs = Subagents::default();
        subs.refresh(&transcript, NOW);
        let rows = subs.tokens(|key| key == message_key("parent"));
        assert_eq!((rows[0].calls, rows[0].tokens), (1, row(5, 5, 1)));
        assert_eq!((rows[1].calls, rows[1].tokens), (1, row(7, 7, 1)));
        let _ = std::fs::remove_dir_all(transcript.parent().unwrap());
    }

    #[test]
    fn what_a_sub_agent_writes_later_is_read_and_a_new_one_found_at_the_next_listing() {
        let (transcript, dir) = session("insight-subagents-later");
        append(&dir.join("agent-a1.jsonl"), &call("m1", "claude-opus-5", 5, 5));
        let mut subs = Subagents::default();
        subs.refresh(&transcript, NOW);

        append(&dir.join("agent-a1.jsonl"), &call("m2", "claude-opus-5", 1, 1));
        append(&dir.join("agent-z9.jsonl"), &call("m3", "claude-opus-5", 2, 2));
        assert!(subs.refresh(&transcript, NOW + 3_000));
        let rows = subs.tokens(|_| false);
        assert_eq!((rows.len(), rows[0].calls), (1, 2), "the folder is not listed again yet");
        assert!(subs.refresh(&transcript, NOW + LIST_EVERY_MS));
        assert_eq!(subs.tokens(|_| false).len(), 2);

        // Its meta file written later is read then; one that is gone leaves the answer.
        std::fs::write(dir.join("agent-a1.meta.json"), json!({ "agentType": "Plan", "description": "Plan it" }).to_string()).unwrap();
        assert!(subs.refresh(&transcript, NOW + LIST_EVERY_MS + 1));
        assert_eq!(subs.tokens(|_| false)[0].agent_type.as_deref(), Some("Plan"));
        std::fs::remove_file(dir.join("agent-z9.jsonl")).unwrap();
        assert!(subs.refresh(&transcript, NOW + 2 * LIST_EVERY_MS));
        assert_eq!(subs.tokens(|_| false).len(), 1);
        let _ = std::fs::remove_dir_all(transcript.parent().unwrap());
    }

    #[test]
    fn a_transcript_untouched_for_a_while_is_looked_at_once_a_minute() {
        let (transcript, dir) = session("insight-subagents-cold");
        let file = dir.join("agent-a1.jsonl");
        append(&file, &call("m1", "claude-opus-5", 5, 5));
        // An hour after the file was written: it is cold from the first look.
        let later = epoch_ms(SystemTime::now()) + 3_600_000;
        let mut subs = Subagents::default();
        subs.refresh(&transcript, later);
        append(&file, &call("m2", "claude-opus-5", 1, 1));
        assert!(!subs.refresh(&transcript, later + COLD_EVERY_MS - 1));
        assert_eq!(subs.tokens(|_| false)[0].calls, 1);
        assert!(subs.refresh(&transcript, later + COLD_EVERY_MS));
        assert_eq!(subs.tokens(|_| false)[0].calls, 2);

        // Written to a moment before the look: warm, and read at every call.
        let mut subs = Subagents::default();
        let now = epoch_ms(SystemTime::now()) + 1_000;
        subs.refresh(&transcript, now);
        append(&file, &call("m3", "claude-opus-5", 1, 1));
        assert!(subs.refresh(&transcript, now + 1));
        assert_eq!(subs.tokens(|_| false)[0].calls, 3);
        let _ = std::fs::remove_dir_all(transcript.parent().unwrap());
    }

    #[test]
    fn a_session_without_sub_agents_has_none() {
        let dir = crate::testutil::temp_dir("insight-subagents-none");
        let mut subs = Subagents::default();
        assert!(!subs.refresh(&dir.join("s1.jsonl"), NOW));
        assert!(subs.tokens(|_| false).is_empty());
        let _ = std::fs::remove_dir_all(dir);
    }
}

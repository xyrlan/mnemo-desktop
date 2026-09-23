//! The conversation face's tailer (round 20): streams a Claude Code transcript
//! (`~/.claude/projects/<escaped cwd>/<session>.jsonl`, found with `mission::transcript_path`) to the
//! front-end as raw lines. It never parses a record: the shape belongs to `src/conversation/parse.ts`,
//! so a Claude Code format change is fixed in one TypeScript module.
//!
//! Round 20 seam: the `tailer` piece writes these bodies (docs/contracts/round20.md). The commands
//! are already registered in `lib.rs`; state lives in this module (no `.manage`).

use serde::Serialize;
use tauri::ipc::Channel;

/// One message on a follow's Channel; mirrors `FollowEvent` in `src/conversation/types.ts`.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum FollowEvent {
    /// Complete lines (no trailing newline) spanning bytes `start..end` of the file.
    Lines { start: u64, end: u64, lines: Vec<String> },
    /// The file shrank or was replaced: the front-end drops what it has; lines restart at 0.
    Reset,
    /// No transcript for this session yet; the follow keeps looking.
    Missing,
}

/// Earlier lines for "load earlier"; mirrors `Chunk` in `src/conversation/types.ts`.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Chunk {
    pub start: u64,
    pub end: u64,
    pub lines: Vec<String>,
}

/// Starts following `session_id`'s transcript: the last `tail` complete lines first, then each
/// line appended. Returns the follow's id for `conversation_unfollow`.
#[tauri::command]
pub fn conversation_follow(session_id: String, cwd: String, tail: usize, on_event: Channel<FollowEvent>) -> Result<u32, String> {
    let _ = (session_id, cwd, tail, on_event);
    Err("conversation: the tailer is not built yet (round 20)".into())
}

/// Stops a follow; an unknown id is ignored.
#[tauri::command]
pub fn conversation_unfollow(id: u32) {
    let _ = id;
}

/// The `count` complete lines that end right before byte `before`.
#[tauri::command]
pub fn conversation_earlier(session_id: String, cwd: String, before: u64, count: usize) -> Result<Chunk, String> {
    let _ = (session_id, cwd, before, count);
    Err("conversation: the tailer is not built yet (round 20)".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn follow_event_serialises_as_the_front_end_reads_it() {
        let lines = serde_json::to_value(FollowEvent::Lines { start: 0, end: 3, lines: vec!["{}".into()] }).unwrap();
        assert_eq!(lines, serde_json::json!({ "kind": "lines", "start": 0, "end": 3, "lines": ["{}"] }));
        assert_eq!(serde_json::to_value(FollowEvent::Reset).unwrap(), serde_json::json!({ "kind": "reset" }));
        assert_eq!(serde_json::to_value(FollowEvent::Missing).unwrap(), serde_json::json!({ "kind": "missing" }));
    }
}

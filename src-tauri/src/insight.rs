//! What a session has spent, holds, did, saw and loaded, read from its transcript
//! (`docs/superpowers/specs/2026-11-10-recreation-core.md`, "Session insight").
//!
//! `nexus_feed` answers "what is this session doing this second" with the last tool call and
//! the last call's context. This module answers the rest of what the transcript knows: tokens
//! by kind with sub-agents, the context against its window and over time, every tool call,
//! what the session read on the web, the files Claude Code loaded as memory, and the session's
//! own title and recap.
//!
//! The types below are the contract: they serialise as `src/insight/types.ts` reads them, and
//! the front is written against them. The commands answer nothing yet.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

/// One session to read. `key`: what the answer is keyed by (a child's `id`, a parent's
/// `session_id`). `account`: the account id the session runs on, which says where its
/// transcript lives.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InsightAsk {
    pub key: String,
    pub session_id: String,
    pub cwd: String,
    pub account: String,
}

/// Tokens of one kind of work. `thinking` is the part of `output` spent thinking.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TokenRow {
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
    pub cache_creation: u64,
    pub thinking: u64,
}

/// One sub-agent transcript beside the session's own.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SubagentTokens {
    pub id: String,
    pub description: String,
    pub agent_type: Option<String>,
    pub model: Option<String>,
    pub calls: u64,
    pub tokens: TokenRow,
}

/// One API message is counted once: its last transcript record wins.
/// `own` = `main` + `sidechain` + every sub-agent.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Tokens {
    pub main: TokenRow,
    pub sidechain: TokenRow,
    pub subagents: Vec<SubagentTokens>,
    pub by_model: HashMap<String, TokenRow>,
    pub own: TokenRow,
}

/// What Claude Code itself recorded of the session's cost, when it did.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Cost {
    pub usd: f64,
    pub api_ms: u64,
    pub tool_ms: u64,
    pub lines_added: u64,
    pub lines_removed: u64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Compaction {
    pub at: u64,
    pub pre: u64,
    pub post: u64,
    pub trigger: Option<String>,
}

/// `tokens`: input + both caches + output of the last main-chain call. `window`: 1,000,000 when
/// the session asked for the 1M beta or has ever passed 200k, else 200,000. `series` is the
/// curve, `(epoch ms, tokens)` per call, thinned to a few hundred points.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Context {
    pub tokens: Option<u64>,
    pub window: u64,
    pub percent: Option<f64>,
    pub series: Vec<(u64, u64)>,
    pub compactions: Vec<Compaction>,
}

/// One tool call. `kind` is one of `read`, `search-code`, `edit`, `write`, `shell`,
/// `web-search`, `web-fetch`, `browser`, `artifact`, `agent`, `message`, `skill`, `ask`,
/// `memory`, `mcp`, `meta`, `other`. `running` while no result has come back; `ok` and `ms`
/// once one has.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolCall {
    pub at: u64,
    pub tool: String,
    pub kind: String,
    pub target: String,
    pub running: bool,
    pub ok: Option<bool>,
    pub ms: Option<u64>,
}

/// Tool calls in one 5-minute bucket starting at `t`, by kind.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Bucket {
    pub t: u64,
    pub kinds: HashMap<String, u64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub title: String,
    pub url: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Search {
    pub at: u64,
    pub query: String,
    pub results: Vec<SearchHit>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Fetch {
    pub at: u64,
    pub url: String,
    pub code: Option<u16>,
    pub bytes: Option<u64>,
    pub ms: Option<u64>,
    pub summary: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    pub at: u64,
    pub url: String,
    pub title: String,
}

/// A screenshot the session's browser tools took. `id` is what `insight_shot` takes; the
/// picture itself is not in the feed.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Shot {
    pub id: String,
    pub at: u64,
    pub url: Option<String>,
    pub title: Option<String>,
    pub media_type: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Artifact {
    pub at: u64,
    pub url: String,
    pub title: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Web {
    pub searches: Vec<Search>,
    pub fetches: Vec<Fetch>,
    pub pages: Vec<Page>,
    pub shots: Vec<Shot>,
    pub artifacts: Vec<Artifact>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EditedFile {
    pub path: String,
    pub edits: u64,
    pub last_at: u64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReadFile {
    pub path: String,
    pub count: u64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Files {
    pub edited: Vec<EditedFile>,
    pub read: Vec<ReadFile>,
}

/// A file Claude Code loaded when the session started. `kind` is Claude Code's own word for
/// it: `Project` (a `CLAUDE.md`), `User`, `AutoMem` (the `MEMORY.md` index), and so on.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Instruction {
    pub path: String,
    pub kind: String,
    pub at: u64,
    pub bytes: u64,
}

/// A later touch of Claude Code's own memory. `file`: `claude-memory` or `claude-md`.
/// `op`: `read`, `write` or `edit`. `via`: `tool` or the attachment type that carried it.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MemoryTouch {
    pub at: u64,
    pub path: String,
    pub file: String,
    pub op: String,
    pub via: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SkillUse {
    pub at: u64,
    pub name: String,
}

/// What Claude Code's own memory gave the session. mnemo's side is `memory_trail`.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeMemory {
    pub instructions: Vec<Instruction>,
    pub touches: Vec<MemoryTouch>,
    pub skills: Vec<SkillUse>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Words {
    pub at: u64,
    pub text: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AskOption {
    pub label: String,
    pub description: String,
}

/// A question the session asked that has no answer yet.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PendingAsk {
    pub id: String,
    pub at: u64,
    pub question: String,
    pub options: Vec<AskOption>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PrLink {
    pub number: u64,
    pub url: String,
    pub repo: String,
}

/// Everything one transcript says. Times are epoch ms. `activity` is the newest calls, oldest
/// first, capped; `activity_total` and `activity_counts` cover the whole session.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Insight {
    /// Claude Code's own title for the session, a person's name for it winning.
    pub title: Option<String>,
    pub model: Option<String>,
    pub effort: Option<String>,
    pub permission_mode: Option<String>,
    /// The account uuid that owns the session, as the transcript records it.
    pub account_uuid: Option<String>,
    pub branch: Option<String>,
    pub started_at: Option<u64>,
    pub last_at: Option<u64>,
    /// Claude Code's own "while you were away" summary, the newest one.
    pub recap: Option<Words>,
    /// The last prompt a person typed.
    pub last_prompt: Option<String>,
    /// The last thing the session said.
    pub said: Option<Words>,
    pub pending_ask: Option<PendingAsk>,
    pub turns: u64,
    pub turn_ms: u64,
    pub tokens: Tokens,
    pub cost: Option<Cost>,
    pub context: Context,
    pub activity: Vec<ToolCall>,
    pub activity_total: u64,
    pub activity_counts: HashMap<String, u64>,
    pub timeline: Vec<Bucket>,
    pub web: Web,
    pub files: Files,
    pub prs: Vec<PrLink>,
    pub memory: ClaudeMemory,
}

/// Each asked session's insight, keyed by `InsightAsk::key`. A session whose transcript is not
/// found is absent from the answer.
#[tauri::command]
pub async fn session_insight(asks: Vec<InsightAsk>) -> HashMap<String, Insight> {
    let _ = asks;
    HashMap::new()
}

/// One screenshot's bytes, base64, by `Shot::id`.
#[tauri::command]
pub async fn insight_shot(ask: InsightAsk, id: String) -> Result<String, String> {
    let _ = (ask, id);
    Err("not read yet".into())
}

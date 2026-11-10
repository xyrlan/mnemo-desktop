//! What mnemo gave each session, and what it held back, read from the vault's logs
//! (`docs/superpowers/specs/2026-11-10-recreation-core.md`, "Memory trail").
//!
//! `memory_feed` answers per project, for one session at a time, with the rules that fired.
//! This module answers per session, for many at once, with everything mnemo's logs join to a
//! session id: the rules it injected and how sure it was, the prompts where it found candidates
//! and stayed silent and why, the rules the session asked for itself, the briefings it was
//! handed, and the corrections it wrote down. `vault_pulse` is the same logs for the vault as
//! a whole.
//!
//! The types below are the contract: they serialise as `src/insight/types.ts` reads them. The
//! commands answer nothing yet.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

/// A rule mnemo put into one of the session's prompts. `score`: the retrieval score.
/// `judge`: the relevance the judge gave it, 0 to 1. `name`: the rule page's own name.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Injected {
    pub at: u64,
    pub slug: String,
    pub name: Option<String>,
    pub score: Option<f64>,
    pub judge: Option<f64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub slug: String,
    pub name: Option<String>,
    pub score: f64,
    pub judge: Option<f64>,
}

/// A prompt where mnemo found candidates and said nothing. `reason` is the log's own
/// `silence_reason`: `judge_none_relevant`, `notice_below_bar`, `deduped`, and so on.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Considered {
    pub at: u64,
    pub reason: String,
    pub candidates: Vec<Candidate>,
}

/// A read the session itself made over mnemo's MCP server.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RuleRead {
    pub at: u64,
    pub tool: String,
    pub slug: Option<String>,
    pub topic: Option<String>,
    pub query: Option<String>,
    pub hits: Vec<String>,
    pub ms: Option<f64>,
}

/// A session briefing mnemo handed the session when it started.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BriefingRead {
    pub at: u64,
    pub project: String,
    pub date: Option<String>,
    pub path: String,
    pub source: Option<String>,
    pub entries: Option<u64>,
}

/// A correction the maintainer gave in the session that mnemo wrote down as a candidate rule.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Friction {
    pub at: u64,
    pub quote: String,
    pub rule: String,
    pub origin: Option<String>,
}

/// `prompts`: how many of the session's prompts mnemo looked at. Lists are oldest first;
/// `considered` keeps the newest few dozen.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Trail {
    pub prompts: u64,
    pub injected: Vec<Injected>,
    pub considered: Vec<Considered>,
    pub read: Vec<RuleRead>,
    pub briefings: Vec<BriefingRead>,
    pub frictions: Vec<Friction>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LearnedRule {
    pub at: u64,
    pub slug: String,
    pub name: String,
    pub projects: Vec<String>,
}

/// One event of the vault as a whole, newest last. `kind`: `injected`, `read`, `learned`.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PulseEvent {
    pub at: u64,
    pub kind: String,
    pub slug: String,
    pub session_id: Option<String>,
    pub project: Option<String>,
}

/// The vault as a whole. `rules`: how many rule documents retrieval searches. `outcomes`: the
/// prompts mnemo looked at, by what came of each (`emitted`, or a silence reason).
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VaultPulse {
    pub rules: Option<u64>,
    pub prompts: u64,
    pub outcomes: HashMap<String, u64>,
    pub learned: Vec<LearnedRule>,
    pub recent: Vec<PulseEvent>,
}

/// Each session's trail, keyed by session id. A session mnemo's logs do not name has an empty
/// trail.
#[tauri::command]
pub async fn memory_trail(session_ids: Vec<String>) -> HashMap<String, Trail> {
    let _ = session_ids;
    HashMap::new()
}

/// The vault's pulse; `since` (epoch ms) bounds `recent`.
#[tauri::command]
pub async fn vault_pulse(since: Option<u64>) -> VaultPulse {
    let _ = since;
    VaultPulse::default()
}

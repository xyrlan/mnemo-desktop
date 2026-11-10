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
//! the front is written against them.
//!
//! The front asks every few seconds for every session on screen, so everything read is kept
//! between calls (`State`): a transcript is read from where the last call stopped
//! (`tail::Tail`), its lines add to what is held of the session (`session::Session`), its
//! sub-agents' transcripts likewise (`subagents::Subagents`), and the `Insight` they add up to
//! is built again only when one of them grew. A screenshot is listed by where it is and read
//! when it is asked for (`shot`).
//!
//! `tools/insight/check.mjs` counts the same transcripts another way and compares.

#[cfg(test)]
mod fixture;
mod line;
#[cfg(test)]
mod probe;
mod session;
mod shot;
mod subagents;
mod tail;

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};

use crate::mission::account_dirs::Accounts;

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
    /// The first question and its options.
    pub question: String,
    pub options: Vec<AskOption>,
    /// Every question of the call, the first included, in the order its dialog asks them: a
    /// dialog of several ends on a review that submits them.
    #[serde(default)]
    pub questions: Vec<AskQuestion>,
}

/// One question of a call that asks several.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AskQuestion {
    /// The short name its tab carries in the dialog.
    pub header: String,
    pub question: String,
    pub options: Vec<AskOption>,
    /// It takes several answers, ticked in the terminal.
    pub multi: bool,
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

/// A transcript not found is looked for again after this long: the lookup may list every
/// account's project dirs.
const MISS_EVERY_MS: u64 = 30_000;
/// What no ask has named for this long is forgotten.
const FORGET_MS: u64 = 10 * 60_000;
/// Transcripts read at once, at most.
const READ_THREADS: usize = 8;

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// What the insight asks of the machine besides the transcripts themselves, so tests can
/// answer for it.
pub struct Deps {
    /// An ask → its session's transcript, on any account.
    pub transcript: Box<dyn Fn(&InsightAsk) -> Option<PathBuf> + Send + Sync>,
}

struct Found {
    path: Option<PathBuf>,
    looked: u64,
    used: u64,
}

/// One session as read so far, and the answer that reading gives.
#[derive(Default)]
struct Held {
    tail: tail::Tail,
    session: session::Session,
    subagents: subagents::Subagents,
    built: Option<Insight>,
    used: u64,
}

impl Held {
    /// Read what the session and its sub-agents wrote since the last call, and build the
    /// answer again when they wrote anything.
    fn refresh(&mut self, path: &Path, now: u64) -> Result<(), String> {
        let grew = self.tail.refresh(path, &mut self.session)?;
        let sub_agents_grew = self.subagents.refresh(path, now);
        if grew || sub_agents_grew || self.built.is_none() {
            let session = &self.session;
            self.built = Some(session.insight(self.subagents.tokens(|key| session.counted(key))));
        }
        Ok(())
    }
}

/// What the insight keeps between calls.
#[derive(Default)]
pub struct State {
    /// By transcript path.
    held: HashMap<PathBuf, Held>,
    /// By `(cwd, session id)`.
    found: HashMap<(String, String), Found>,
}

impl State {
    pub fn answer(&mut self, asks: &[InsightAsk], now: u64, deps: &Deps) -> HashMap<String, Insight> {
        let paths: Vec<Option<PathBuf>> = asks.iter().map(|a| self.path(a, now, deps)).collect();
        self.read(&paths, now);
        let mut answer = HashMap::new();
        for (ask, path) in asks.iter().zip(&paths) {
            let Some(path) = path else { continue };
            if let Some(insight) = self.held.get(path).and_then(|h| h.built.clone()) {
                answer.insert(ask.key.clone(), insight);
            }
        }
        self.held.retain(|_, h| h.used + FORGET_MS > now);
        self.found.retain(|_, f| f.used + FORGET_MS > now);
        answer
    }

    /// The ask's transcript, looked up again only when the one found is gone, or after
    /// `MISS_EVERY_MS` for one not found.
    fn path(&mut self, ask: &InsightAsk, now: u64, deps: &Deps) -> Option<PathBuf> {
        let key = (ask.cwd.clone(), ask.session_id.clone());
        let f = self.found.entry(key).or_insert(Found { path: None, looked: 0, used: now });
        f.used = now;
        let fresh = match &f.path {
            Some(p) => p.is_file(),
            None => f.looked != 0 && now < f.looked + MISS_EVERY_MS,
        };
        if !fresh {
            f.path = (deps.transcript)(ask);
            f.looked = now.max(1);
        }
        f.path.clone()
    }

    /// Bring every session asked about up to its transcript's end, several at once. One whose
    /// transcript cannot be read is held no longer.
    fn read(&mut self, paths: &[Option<PathBuf>], now: u64) {
        let unique: HashSet<&PathBuf> = paths.iter().flatten().collect();
        let mut work: Vec<(PathBuf, Held, bool)> = unique.into_iter().map(|p| (p.clone(), self.held.remove(p).unwrap_or_default(), true)).collect();
        let per = work.len().div_ceil(READ_THREADS).max(1);
        std::thread::scope(|s| {
            for chunk in work.chunks_mut(per) {
                s.spawn(move || {
                    for (path, held, ok) in chunk {
                        *ok = held.refresh(path, now).is_ok();
                    }
                });
            }
        });
        for (path, mut held, ok) in work {
            if ok {
                held.used = now;
                self.held.insert(path, held);
            }
        }
    }
}

/// Whether `id` could be a session's: it names a file, so it holds nothing a path is made of.
fn is_session_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 128 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Where an ask's session writes its Claude transcript, on any account. A Grok account's
/// session writes none.
fn transcript_of(ask: &InsightAsk, accounts: &Accounts) -> Option<PathBuf> {
    if !is_session_id(&ask.session_id) || accounts.get(&ask.account).is_some_and(|a| a.kind == crate::agent_kind::AgentKind::Grok) {
        return None;
    }
    // Every account's `projects/`, once each: they are one dir through links unless a link
    // was replaced by a copy.
    let mut seen = HashSet::new();
    let claude = accounts.iter().filter(|a| a.kind == crate::agent_kind::AgentKind::Claude);
    let projects: Vec<PathBuf> = claude.map(|a| a.projects_dir()).filter(|d| seen.insert(d.canonicalize().unwrap_or_else(|_| d.clone()))).collect();
    crate::mission::transcript_in(&projects, &ask.cwd, &ask.session_id)
}

fn live_deps() -> Deps {
    Deps { transcript: Box::new(|ask| transcript_of(ask, &crate::mission::account_dirs::accounts())) }
}

fn state() -> &'static Mutex<State> {
    static STATE: OnceLock<Mutex<State>> = OnceLock::new();
    STATE.get_or_init(Default::default)
}

/// Each asked session's insight, keyed by `InsightAsk::key`. A session whose transcript is not
/// found is absent from the answer.
#[tauri::command]
pub async fn session_insight(asks: Vec<InsightAsk>) -> HashMap<String, Insight> {
    tauri::async_runtime::spawn_blocking(move || state().lock().unwrap_or_else(|e| e.into_inner()).answer(&asks, now_ms(), &live_deps())).await.unwrap_or_default()
}

/// One screenshot's bytes, base64, by `Shot::id`.
#[tauri::command]
pub async fn insight_shot(ask: InsightAsk, id: String) -> Result<String, String> {
    let read = move || {
        let path = transcript_of(&ask, &crate::mission::account_dirs::accounts()).ok_or_else(|| format!("no transcript of {}", ask.session_id))?;
        shot::read(&path, &id)
    };
    tauri::async_runtime::spawn_blocking(read).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
#[path = "insight/tests.rs"]
mod tests;

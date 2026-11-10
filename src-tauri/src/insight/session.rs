//! One transcript's lines, taken in as they are appended, and the `Insight` they add up to.
//!
//! What is kept is bounded by what the answer shows, not by how long the session ran: the
//! newest tool calls, a thinned context curve, the newest of each list. The exceptions are the
//! counts, which cover the whole session: one row per API message (so its last record can
//! replace its earlier ones) and one per file touched.

use std::collections::{BTreeMap, HashMap, VecDeque};
use std::hash::{Hash, Hasher};

use serde_json::Value;

use super::line::{self, clip, is, kind_of, memory_file, number, page_of, parsed, short, text, truthy, Attachment, Block, Input, Line, Usage};
use super::tail::Sink;
use super::{
    shot, Artifact, AskOption, Bucket, ClaudeMemory, Compaction, Context, Cost, EditedFile, Fetch, Files, Insight, Instruction, MemoryTouch, Page, PendingAsk, PrLink, ReadFile, Search, SearchHit, Shot,
    SkillUse, SubagentTokens, TokenRow, Tokens, ToolCall, Web, Words,
};
use crate::mission::stamp_ms;

/// The newest tool calls kept.
pub const ACTIVITY_CAP: usize = 400;
/// The context curve is thinned to between this many points and twice as many.
pub const SERIES_CAP: usize = 240;
const BUCKET_MS: u64 = 5 * 60_000;
/// The newest 5-minute buckets with a call in them: a day's worth when none is empty.
const BUCKETS_CAP: usize = 288;
/// The most edited and the most read files shown.
const FILES_CAP: usize = 60;
/// The newest searches, fetches, screenshots, artifacts, compactions and skills kept, each.
const LIST_CAP: usize = 100;
const PAGES_CAP: usize = 200;
const TOUCHES_CAP: usize = 300;
/// Calls without a result remembered, at most, before the ones too old to show are dropped.
const OPEN_CAP: usize = 1024;
const SAID_CHARS: usize = 2000;
const PROMPT_CHARS: usize = 400;
const WINDOW: u64 = 200_000;
const WINDOW_1M: u64 = 1_000_000;

/// Records the insight reads nothing from, told by how they open, so their megabytes (each
/// request's messages, pictures included) are stepped over without being parsed.
const SKIPPED: [&str; 2] = ["{\"type\":\"api-request-blob\"", "{\"type\":\"api-request-shape\""];

/// What an API message's id is counted under.
pub fn message_key(id: &str) -> u64 {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    id.hash(&mut h);
    h.finish()
}

pub fn plus(total: &mut TokenRow, row: &TokenRow) {
    total.input += row.input;
    total.output += row.output;
    total.cache_read += row.cache_read;
    total.cache_creation += row.cache_creation;
    total.thinking += row.thinking;
}

fn minus(total: &mut TokenRow, row: &TokenRow) {
    total.input -= row.input;
    total.output -= row.output;
    total.cache_read -= row.cache_read;
    total.cache_creation -= row.cache_creation;
    total.thinking -= row.thinking;
}

pub fn usage_row(raw: Option<&serde_json::value::RawValue>) -> TokenRow {
    let u: Usage = parsed(raw).unwrap_or_default();
    TokenRow {
        input: u.input_tokens.unwrap_or(0),
        output: u.output_tokens.unwrap_or(0),
        cache_read: u.cache_read_input_tokens.unwrap_or(0),
        cache_creation: u.cache_creation_input_tokens.unwrap_or(0),
        thinking: u.output_tokens_details.and_then(|d| d.thinking_tokens).unwrap_or(0),
    }
}

/// One API message as it was last recorded.
struct Counted {
    row: TokenRow,
    side: bool,
    model: usize,
}

/// A tool call whose result has not been read yet.
struct Open {
    /// Which call of the session it is, from 0.
    seq: u64,
    at: u64,
    tool: String,
    kind: &'static str,
    target: String,
}

/// The context call by call, thinned as it grows: every `stride`-th call is kept, and when the
/// kept ones reach twice `SERIES_CAP` every other one goes and the stride doubles. The newest
/// call is always shown.
struct Curve {
    kept: Vec<(u64, u64)>,
    stride: u64,
    seen: u64,
    newest: Option<(u64, u64)>,
    newest_kept: bool,
}

impl Default for Curve {
    fn default() -> Curve {
        Curve { kept: Vec::new(), stride: 1, seen: 0, newest: None, newest_kept: false }
    }
}

impl Curve {
    fn push(&mut self, at: u64, tokens: u64) {
        self.newest_kept = self.seen % self.stride == 0;
        self.seen += 1;
        self.newest = Some((at, tokens));
        if !self.newest_kept {
            return;
        }
        self.kept.push((at, tokens));
        if self.kept.len() >= 2 * SERIES_CAP {
            let mut i = 0;
            self.kept.retain(|_| {
                i += 1;
                i % 2 == 1
            });
            self.stride *= 2;
            // An even count loses its last point, the newest.
            self.newest_kept = false;
        }
    }

    /// The newest call's size, by a later record of the same call.
    fn amend(&mut self, tokens: u64) {
        if let Some(n) = self.newest.as_mut() {
            n.1 = tokens;
        }
        if self.newest_kept {
            if let Some(last) = self.kept.last_mut() {
                last.1 = tokens;
            }
        }
    }

    fn points(&self) -> Vec<(u64, u64)> {
        let mut out = self.kept.clone();
        if !self.newest_kept {
            out.extend(self.newest);
        }
        out
    }
}

fn push_capped<T>(list: &mut Vec<T>, item: T, cap: usize) {
    list.push(item);
    if list.len() > cap {
        let over = list.len() - cap;
        list.drain(..over);
    }
}

#[derive(Default)]
pub struct Session {
    ai_title: Option<String>,
    custom_title: Option<String>,
    model: Option<String>,
    effort: Option<String>,
    permission_mode: Option<String>,
    account_uuid: Option<String>,
    /// The last `gitBranch` as it was written, quotes and all, and what it said.
    branch_raw: String,
    branch: Option<String>,
    started_at: Option<u64>,
    last_at: Option<u64>,
    recap: Option<Words>,
    last_prompt: Option<String>,
    said: Option<Words>,
    pending_ask: Option<PendingAsk>,
    turns: u64,
    turn_ms: u64,

    /// Every API message of the transcript, by `message_key`.
    counted: HashMap<u64, Counted>,
    /// Lines of a real model's message that carried no id: each is its own message.
    anonymous: u64,
    main: TokenRow,
    side: TokenRow,
    models: Vec<(String, TokenRow)>,
    cost: Option<Cost>,

    context: Option<u64>,
    /// The largest the context has been, a compaction's `preTokens` included.
    peak: u64,
    /// Whether the last main request asked for the 1M window: by its betas, by its model.
    beta_1m: bool,
    model_1m: bool,
    curve: Curve,
    /// The main-chain message the curve's newest point is of.
    newest_call: Option<u64>,
    compactions: Vec<Compaction>,

    activity: VecDeque<ToolCall>,
    total: u64,
    counts: HashMap<&'static str, u64>,
    open: HashMap<String, Open>,
    buckets: BTreeMap<u64, HashMap<&'static str, u64>>,

    web: Web,
    /// path → (edits, last edit).
    edited: HashMap<String, (u64, u64)>,
    read: HashMap<String, u64>,
    prs: Vec<PrLink>,
    instructions: Vec<Instruction>,
    touches: Vec<MemoryTouch>,
    skills: Vec<SkillUse>,
}

impl Sink for Session {
    fn restart(&mut self) {
        *self = Session::default();
    }

    fn line(&mut self, offset: u64, raw: &str) {
        if SKIPPED.iter().any(|open| raw.starts_with(open)) {
            return;
        }
        let Ok(line) = serde_json::from_str::<Line>(raw) else { return };
        self.take(offset, &line);
    }
}

impl Session {
    fn take(&mut self, offset: u64, l: &Line) {
        let at = text(l.timestamp).as_deref().and_then(stamp_ms);
        if let Some(at) = at {
            self.started_at.get_or_insert(at);
            self.last_at = Some(self.last_at.map_or(at, |t| t.max(at)));
        }
        if let Some(raw) = l.git_branch.filter(|r| r.get() != self.branch_raw) {
            self.branch_raw = raw.get().to_string();
            if let Some(b) = text(Some(raw)).filter(|b| !b.is_empty()) {
                self.branch = Some(b);
            }
        }
        let side = truthy(l.is_sidechain);
        let Some(kind) = text(l.kind) else { return };
        match kind.as_str() {
            "assistant" => self.assistant(l, at, side),
            "user" if !side => {
                self.mode(l);
                self.user(l, at, offset);
            }
            "attachment" if !side => self.attachment(l, at.unwrap_or(0)),
            "system" if !side => self.system(l, at.or(self.last_at).unwrap_or(0)),
            "ai-title" => self.ai_title = text(l.ai_title).map(|t| short(&t, 200)).filter(|t| !t.is_empty()).or(self.ai_title.take()),
            "custom-title" => self.custom_title = text(l.custom_title).map(|t| short(&t, 200)).filter(|t| !t.is_empty()).or(self.custom_title.take()),
            "permission-mode" => self.mode(l),
            "session-owner" => self.account_uuid = text(l.account_uuid).or(self.account_uuid.take()),
            "last-prompt" => self.prompt_recorded(l),
            "pr-link" => self.pr(l),
            "cost-state" => self.cost_state(l),
            "api-request" if is(l.query_source, "repl_main_thread") || is(l.query_source, "sdk") => {
                let params: Value = parsed(l.params).unwrap_or_default();
                self.beta_1m = params.get("betas").and_then(Value::as_array).is_some_and(|b| b.iter().any(|x| x.as_str().is_some_and(|s| s.contains("context-1m"))));
            }
            _ => {}
        }
    }

    fn mode(&mut self, l: &Line) {
        if let Some(mode) = text(l.permission_mode).filter(|m| !m.is_empty()) {
            self.permission_mode = Some(mode);
        }
    }

    // ---------------------------------------------------------------- tokens --

    /// Count one record of an API message: it replaces whatever an earlier record of the same
    /// message said.
    fn count(&mut self, key: u64, row: TokenRow, side: bool, model: &str) {
        let at = match self.models.iter().position(|(m, _)| m == model) {
            Some(i) => i,
            None => {
                self.models.push((model.to_string(), TokenRow::default()));
                self.models.len() - 1
            }
        };
        if let Some(old) = self.counted.insert(key, Counted { row, side, model: at }) {
            minus(if old.side { &mut self.side } else { &mut self.main }, &old.row);
            minus(&mut self.models[old.model].1, &old.row);
        }
        plus(if side { &mut self.side } else { &mut self.main }, &row);
        plus(&mut self.models[at].1, &row);
    }

    /// Whether the transcript itself holds this API message.
    pub fn counted(&self, key: u64) -> bool {
        self.counted.contains_key(&key)
    }

    fn assistant(&mut self, l: &Line, at: Option<u64>, side: bool) {
        let Some(m) = &l.message else { return };
        let model = text(m.model).unwrap_or_default();
        // `<synthetic>` messages are Claude Code's own words: no call was made.
        if model.starts_with("claude") {
            let row = usage_row(m.usage);
            let key = match text(m.id).or_else(|| text(l.uuid)) {
                Some(id) => message_key(&id),
                None => {
                    self.anonymous += 1;
                    message_key(&format!("\0{}", self.anonymous))
                }
            };
            self.count(key, row, side, &model);
            if !side {
                self.model = Some(model);
                if let Some(effort) = text(l.effort) {
                    self.effort = Some(effort);
                }
                if let Some(asked) = text(l.requested_model) {
                    self.model_1m = asked.ends_with("[1m]");
                }
                let context = row.input + row.cache_read + row.cache_creation + row.output;
                self.context = Some(context);
                self.peak = self.peak.max(context);
                if self.newest_call == Some(key) {
                    self.curve.amend(context);
                } else if let Some(at) = at {
                    self.curve.push(at, context);
                    self.newest_call = Some(key);
                }
            }
        }
        let (Some(at), false) = (at, side) else { return };
        let (plain, blocks) = line::content(m.content);
        if let Some(t) = plain {
            self.say(&t, at);
        }
        for b in &blocks {
            if is(b.kind, "text") {
                if let Some(t) = text(b.text) {
                    self.say(&t, at);
                }
            } else if is(b.kind, "tool_use") {
                self.tool_use(b, at);
            }
        }
    }

    fn say(&mut self, words: &str, at: u64) {
        let words = words.trim();
        if !words.is_empty() {
            self.said = Some(Words { at, text: clip(words, SAID_CHARS) });
        }
    }

    // -------------------------------------------------------------- activity --

    fn tool_use(&mut self, b: &Block, at: u64) {
        let name = text(b.name).unwrap_or_default();
        let input: Input = parsed(b.input).unwrap_or_default();
        let kind = kind_of(&name);
        let target = input.target(&name);
        let id = text(b.id);

        if let Some(path) = input.file() {
            if let (Some(file), "Read" | "Edit" | "Write") = (memory_file(path), name.as_str()) {
                push_capped(&mut self.touches, MemoryTouch { at, path: path.to_string(), file: file.into(), op: name.to_lowercase(), via: "tool".into() }, TOUCHES_CAP);
            }
            match kind {
                "edit" | "write" => {
                    let e = self.edited.entry(path.to_string()).or_default();
                    *e = (e.0 + 1, at);
                }
                "read" => *self.read.entry(path.to_string()).or_default() += 1,
                _ => {}
            }
        }
        if let ("Skill", Some(skill)) = (name.as_str(), input.skill()) {
            push_capped(&mut self.skills, SkillUse { at, name: skill.to_string() }, LIST_CAP);
        }
        if name == "AskUserQuestion" {
            if let (Some(id), Some((question, options))) = (id.clone(), input.question()) {
                let options = options.into_iter().map(|(label, description)| AskOption { label: short(&label, 80), description: short(&description, 240) }).collect();
                self.pending_ask = Some(PendingAsk { id, at, question: short(&question, 400), options });
            }
        }

        *self.counts.entry(kind).or_default() += 1;
        *self.buckets.entry(at / BUCKET_MS * BUCKET_MS).or_default().entry(kind).or_default() += 1;
        while self.buckets.len() > BUCKETS_CAP {
            self.buckets.pop_first();
        }
        if let Some(id) = id {
            self.open.insert(id, Open { seq: self.total, at, tool: name.clone(), kind, target: target.clone() });
            if self.open.len() > OPEN_CAP {
                let oldest_shown = self.total.saturating_sub(ACTIVITY_CAP as u64);
                self.open.retain(|_, o| o.seq >= oldest_shown);
            }
        }
        self.total += 1;
        self.activity.push_back(ToolCall { at, tool: name, kind: kind.into(), target, running: true, ok: None, ms: None });
        if self.activity.len() > ACTIVITY_CAP {
            self.activity.pop_front();
        }
    }

    /// The row of the `seq`-th call, while it is among the newest kept.
    fn row(&mut self, seq: u64) -> Option<&mut ToolCall> {
        let first = self.total - self.activity.len() as u64;
        self.activity.get_mut(usize::try_from(seq.checked_sub(first)?).ok()?)
    }

    fn user(&mut self, l: &Line, at: Option<u64>, offset: u64) {
        let Some(m) = &l.message else { return };
        let (plain, blocks) = line::content(m.content);
        let mut answered = false;
        for (index, b) in blocks.iter().enumerate().filter(|(_, b)| is(b.kind, "tool_result")) {
            answered = true;
            let Some(id) = text(b.tool_use_id) else { continue };
            if self.pending_ask.as_ref().is_some_and(|p| p.id == id) {
                self.pending_ask = None;
            }
            let Some(call) = self.open.remove(&id) else { continue };
            let (ok, ms) = (!truthy(b.is_error), at.map(|t| t.saturating_sub(call.at)));
            if let Some(row) = self.row(call.seq) {
                row.running = false;
                row.ok = Some(ok);
                row.ms = ms;
            }
            self.result(&call, b, index, l, offset);
        }
        if answered {
            return;
        }
        let words = plain.unwrap_or_else(|| blocks.iter().filter(|b| is(b.kind, "text")).filter_map(|b| text(b.text)).collect::<Vec<_>>().join("\n"));
        let Some(prompt) = line::typed(l, &words) else { return };
        self.turns += 1;
        self.last_prompt = Some(short(&prompt, PROMPT_CHARS));
        // A person typed after the calls: whatever they were waiting on is over.
        let waiting: Vec<u64> = self.open.values().map(|o| o.seq).collect();
        for seq in waiting {
            if let Some(row) = self.row(seq) {
                row.running = false;
            }
        }
        self.pending_ask = None;
    }

    // ------------------------------------------------------------------- web --

    /// What a call's result adds to what the session saw. `block` is where the result sits in
    /// its line's content, and `offset` where that line starts: a screenshot is found again by
    /// the two.
    fn result(&mut self, call: &Open, b: &Block, block: usize, l: &Line, offset: u64) {
        let said = |v: &Value, key: &str| v.get(key).and_then(Value::as_str).filter(|s| !s.is_empty()).map(str::to_string);
        match call.tool.as_str() {
            "WebSearch" => {
                let Some(r) = parsed::<Value>(l.tool_use_result).filter(Value::is_object) else { return };
                let hits = r.get("results").and_then(Value::as_array).into_iter().flatten().flat_map(|found| found.get("content").and_then(Value::as_array).into_iter().flatten());
                let results = hits.filter_map(|hit| Some(SearchHit { title: short(hit.get("title").and_then(Value::as_str).unwrap_or_default(), 120), url: said(hit, "url")? })).take(10).collect();
                push_capped(&mut self.web.searches, Search { at: call.at, query: said(&r, "query").unwrap_or_else(|| call.target.clone()), results }, LIST_CAP);
            }
            "WebFetch" => {
                let Some(r) = parsed::<Value>(l.tool_use_result).filter(Value::is_object) else { return };
                let n = |key: &str| r.get(key).and_then(Value::as_u64);
                let fetch = Fetch {
                    at: call.at,
                    url: said(&r, "url").unwrap_or_else(|| call.target.clone()),
                    code: n("code").and_then(|c| u16::try_from(c).ok()),
                    bytes: n("bytes"),
                    ms: n("durationMs"),
                    summary: short(r.get("result").and_then(Value::as_str).unwrap_or_default(), 400),
                };
                push_capped(&mut self.web.fetches, fetch, LIST_CAP);
            }
            // A publish answers with the artifact's own address and title; a listing or a
            // quickstart names other people's, and publishes nothing.
            "Artifact" => {
                let Some(r) = parsed::<Value>(l.tool_use_result).filter(Value::is_object) else { return };
                let Some(url) = said(&r, "url").filter(|u| u.contains("/artifact/")) else { return };
                let title = short(&said(&r, "title").unwrap_or_else(|| call.target.clone()), 120);
                match self.web.artifacts.iter_mut().find(|a| a.url == url) {
                    Some(known) => known.title = title,
                    None => push_capped(&mut self.web.artifacts, Artifact { at: call.at, url, title }, LIST_CAP),
                }
            }
            _ if call.kind == "browser" => {
                let (plain, parts) = line::parts(b.content);
                let mut words = plain.unwrap_or_default();
                for p in parts.iter().filter(|p| is(p.kind, "text")) {
                    words.push('\n');
                    words.push_str(&text(p.text).unwrap_or_default());
                }
                let page = page_of(&words);
                if let Some((title, url)) = page.as_ref().filter(|(_, url)| url.starts_with("http")) {
                    if self.web.pages.last().map(|p| &p.url) != Some(url) {
                        push_capped(&mut self.web.pages, Page { at: call.at, url: url.clone(), title: short(title, 120) }, PAGES_CAP);
                    }
                }
                for (part, p) in parts.iter().enumerate().filter(|(_, p)| is(p.kind, "image")) {
                    // A picture held elsewhere (by address, by file id) has no data here to hand over.
                    let Some(source) = p.source.as_ref().filter(|s| s.data.is_some()) else { continue };
                    let (title, url) = page.clone().map_or((None, None), |(t, u)| (Some(short(&t, 120)), Some(u)));
                    let shot = Shot { id: shot::id(offset, block, part), at: call.at, url, title, media_type: text(source.media_type).unwrap_or_default() };
                    push_capped(&mut self.web.shots, shot, LIST_CAP);
                }
            }
            _ => {}
        }
    }

    // ---------------------------------------------------------------- memory --

    fn attachment(&mut self, l: &Line, at: u64) {
        let Some(a) = parsed::<Attachment>(l.attachment) else { return };
        let Some(kind) = text(a.kind) else { return };
        let said = |v: &Value, key: &str| v.get(key).and_then(Value::as_str).map(str::to_string);
        match kind.as_str() {
            "instructions" => {
                for f in parsed::<Vec<Value>>(a.files).unwrap_or_default() {
                    let Some(path) = said(&f, "path") else { continue };
                    let loaded = Instruction { path, kind: said(&f, "type").unwrap_or_default(), at, bytes: f.get("content").and_then(Value::as_str).map_or(0, |c| c.len() as u64) };
                    match self.instructions.iter_mut().find(|i| i.path == loaded.path) {
                        Some(known) => *known = loaded,
                        None => push_capped(&mut self.instructions, loaded, LIST_CAP),
                    }
                }
            }
            "file" | "edited_text_file" | "compact_file_reference" => {
                let Some(path) = text(a.filename) else { return };
                if let Some(file) = memory_file(&path) {
                    push_capped(&mut self.touches, MemoryTouch { at, path, file: file.into(), op: "read".into(), via: kind.clone() }, TOUCHES_CAP);
                }
            }
            // Written after a compaction, of the skills invoked before it: most are known.
            "invoked_skills" => {
                for s in parsed::<Vec<Value>>(a.skills).unwrap_or_default() {
                    let Some(name) = said(&s, "name") else { continue };
                    if !self.skills.iter().any(|known| known.name == name) {
                        push_capped(&mut self.skills, SkillUse { at, name }, LIST_CAP);
                    }
                }
            }
            _ => {}
        }
    }

    // ---------------------------------------------------------------- others --

    fn system(&mut self, l: &Line, at: u64) {
        if is(l.subtype, "turn_duration") {
            self.turn_ms += number(l.duration_ms).unwrap_or(0);
        } else if is(l.subtype, "away_summary") {
            if let Some(words) = text(l.content).map(|c| short(&c, 500)).filter(|c| !c.is_empty()) {
                self.recap = Some(Words { at, text: words });
            }
        } else if is(l.subtype, "compact_boundary") {
            let meta: Value = parsed(l.compact_metadata).unwrap_or_default();
            let n = |key: &str| meta.get(key).and_then(Value::as_u64).unwrap_or(0);
            let (pre, post) = (n("preTokens"), n("postTokens"));
            let trigger = meta.get("trigger").and_then(Value::as_str).map(str::to_string);
            push_capped(&mut self.compactions, Compaction { at, pre, post, trigger }, LIST_CAP);
            self.peak = self.peak.max(pre);
            // What the context is until the next call says: Claude Code's own count of it.
            if post > 0 {
                self.context = Some(post);
                self.curve.push(at, post);
                self.newest_call = None;
            }
        }
    }

    /// Claude Code's own record of the last prompt, which it cuts short. The prompt as it was
    /// typed stays when the record is the start of it.
    fn prompt_recorded(&mut self, l: &Line) {
        let Some(recorded) = text(l.last_prompt).map(|p| short(&p, PROMPT_CHARS)).filter(|p| !p.is_empty()) else { return };
        let stem = recorded.trim_end_matches('…').trim_end();
        if !self.last_prompt.as_deref().is_some_and(|held| held.starts_with(stem)) {
            self.last_prompt = Some(recorded);
        }
    }

    fn pr(&mut self, l: &Line) {
        let Some(url) = text(l.pr_url).filter(|u| !u.is_empty()) else { return };
        let link = PrLink { number: number(l.pr_number).unwrap_or(0), url, repo: text(l.pr_repository).unwrap_or_default() };
        match self.prs.iter_mut().find(|p| p.url == link.url) {
            Some(known) => *known = link,
            None => push_capped(&mut self.prs, link, LIST_CAP),
        }
    }

    fn cost_state(&mut self, l: &Line) {
        // Read by `str::parse`, which rounds a decimal to the nearest double; serde_json's own
        // reading may land one off, and the front would then show another number than the
        // transcript's.
        let Some(usd) = l.total_cost_usd.and_then(|raw| raw.get().parse::<f64>().ok()).filter(|usd| usd.is_finite()) else { return };
        let n = |raw: Option<&serde_json::value::RawValue>| number(raw).unwrap_or(0);
        self.cost = Some(Cost { usd, api_ms: n(l.total_api_duration), tool_ms: n(l.total_tool_duration), lines_added: n(l.total_lines_added), lines_removed: n(l.total_lines_removed) });
    }

    // ---------------------------------------------------------------- answer --

    /// What the lines taken in so far add up to, with the session's sub-agents beside them.
    pub fn insight(&self, subagents: Vec<SubagentTokens>) -> Insight {
        let mut own = self.main;
        plus(&mut own, &self.side);
        for s in &subagents {
            plus(&mut own, &s.tokens);
        }
        let window = if self.beta_1m || self.model_1m || self.peak > WINDOW { WINDOW_1M } else { WINDOW };

        let mut edited: Vec<EditedFile> = self.edited.iter().map(|(path, (edits, last_at))| EditedFile { path: path.clone(), edits: *edits, last_at: *last_at }).collect();
        edited.sort_by(|a, b| b.edits.cmp(&a.edits).then(b.last_at.cmp(&a.last_at)).then_with(|| a.path.cmp(&b.path)));
        edited.truncate(FILES_CAP);
        let mut read: Vec<ReadFile> = self.read.iter().map(|(path, count)| ReadFile { path: path.clone(), count: *count }).collect();
        read.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.path.cmp(&b.path)));
        read.truncate(FILES_CAP);

        let kinds = |k: &HashMap<&'static str, u64>| k.iter().map(|(kind, n)| (kind.to_string(), *n)).collect::<HashMap<String, u64>>();
        Insight {
            title: self.custom_title.clone().or_else(|| self.ai_title.clone()),
            model: self.model.clone(),
            effort: self.effort.clone(),
            permission_mode: self.permission_mode.clone(),
            account_uuid: self.account_uuid.clone(),
            branch: self.branch.clone(),
            started_at: self.started_at,
            last_at: self.last_at,
            recap: self.recap.clone(),
            last_prompt: self.last_prompt.clone(),
            said: self.said.clone(),
            pending_ask: self.pending_ask.clone(),
            turns: self.turns,
            turn_ms: self.turn_ms,
            tokens: Tokens { main: self.main, sidechain: self.side, subagents, by_model: self.models.iter().cloned().collect(), own },
            cost: self.cost.clone(),
            context: Context {
                tokens: self.context,
                window,
                percent: self.context.map(|t| (1000.0 * t as f64 / window as f64).round() / 10.0),
                series: self.curve.points(),
                compactions: self.compactions.clone(),
            },
            activity: self.activity.iter().cloned().collect(),
            activity_total: self.total,
            activity_counts: kinds(&self.counts),
            timeline: self.buckets.iter().map(|(t, k)| Bucket { t: *t, kinds: kinds(k) }).collect(),
            web: self.web.clone(),
            files: Files { edited, read },
            prs: self.prs.clone(),
            memory: ClaudeMemory { instructions: self.instructions.clone(), touches: self.touches.clone(), skills: self.skills.clone() },
        }
    }

    /// The size of the context as the transcript last stated it.
    #[cfg(test)]
    pub fn context(&self) -> Option<u64> {
        self.context
    }

    /// How many compactions are held, and the size the last one was made at.
    #[cfg(test)]
    pub fn compacted(&self) -> (usize, u64) {
        (self.compactions.len(), self.compactions.last().map_or(0, |c| c.pre))
    }

    /// How many API messages the transcript holds, by chain: `(main, sidechain)`.
    #[cfg(test)]
    pub fn messages(&self) -> (u64, u64) {
        let side = self.counted.values().filter(|c| c.side).count() as u64;
        (self.counted.len() as u64 - side, side)
    }
}

#[cfg(test)]
#[path = "session_tests.rs"]
mod tests;

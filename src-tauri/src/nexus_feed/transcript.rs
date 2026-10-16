//! One session's transcript, read the way `mission::Tally` reads it: each call reads only the
//! lines appended since the previous one, and keeps what they said. A poll over 15 sessions then
//! costs a `stat` each, plus whatever they wrote in the last 3 s.
//!
//! Lines are read into structs that name only the fields the feed needs, so a tool result or a
//! file a `Write` put down is skipped by the parser, never copied.

use std::collections::VecDeque;
use std::path::Path;
use std::time::SystemTime;

use serde::Deserialize;
use serde_json::value::RawValue;
use serde_json::Value;

use super::{Activity, Ask, Said, SessionFeed};
use crate::mission::stamp_ms;

/// The fleet's rate is over this window.
pub const RATE_WINDOW_MS: u64 = 5 * 60_000;
/// A tool call's target, at most; the ship's line clips it again.
const TARGET_CHARS: usize = 90;
/// A parent's topic or title, at most (`ship-types.ts`, `SessionFeed.topic`).
const TOPIC_CHARS: usize = 200;
/// Bytes read at a time. A line longer than this is read whole before it is parsed.
const CHUNK: usize = 8 << 20;

/// One API call, counted once per message id: Claude Code writes a line per content block of an
/// assistant message, each repeating the message's usage.
#[derive(Debug, Clone, PartialEq)]
pub struct Call {
    pub id: Option<String>,
    pub at: u64,
    pub output: u64,
    pub input: u64,
    pub cache_read: u64,
    pub cache_creation: u64,
}

#[derive(Debug, Default)]
pub struct Reader {
    offset: u64,
    len: u64,
    mtime: Option<SystemTime>,
    activity: Option<Activity>,
    /// The `tool_use` id behind `activity`, so its result can end `running`.
    tool_id: Option<String>,
    said: Option<Said>,
    context: Option<u64>,
    model: Option<String>,
    topic: Option<String>,
    /// The latest `ai-title`: Claude Code names the session, and names it again as it goes on.
    ai_title: Option<String>,
    /// The latest `custom-title`: the name a person gave it (`/rename`, `claude --name`).
    custom_title: Option<String>,
    /// The unanswered `AskUserQuestion`, by its `tool_use` id.
    ask: Option<(String, Ask)>,
    /// Calls made within `RATE_WINDOW_MS` of the last read, oldest first.
    calls: VecDeque<Call>,
}

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct Line<'a> {
    #[serde(rename = "type")]
    kind: String,
    timestamp: Option<String>,
    is_meta: Option<bool>,
    is_sidechain: Option<bool>,
    is_compact_summary: Option<bool>,
    origin: Option<Origin>,
    #[serde(borrow)]
    message: Option<Message<'a>>,
    ai_title: Option<String>,
    custom_title: Option<String>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct Origin {
    kind: Option<String>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct Message<'a> {
    id: Option<String>,
    model: Option<String>,
    #[serde(borrow)]
    content: Option<&'a RawValue>,
    usage: Option<Usage>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct Usage {
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
    cache_read_input_tokens: Option<u64>,
    cache_creation_input_tokens: Option<u64>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct Block<'a> {
    #[serde(rename = "type")]
    kind: String,
    text: Option<String>,
    id: Option<String>,
    name: Option<String>,
    #[serde(borrow)]
    input: Option<&'a RawValue>,
    tool_use_id: Option<String>,
}

/// The input keys a target is read from, in the order `capture.py` tries them. Values stay
/// `Value`: one tool's string is another's object, and a mismatch must not lose the line.
#[derive(Deserialize, Default)]
#[serde(default)]
struct Input {
    command: Option<Value>,
    file_path: Option<Value>,
    pattern: Option<Value>,
    description: Option<Value>,
    prompt: Option<Value>,
    url: Option<Value>,
    query: Option<Value>,
    skill: Option<Value>,
    path: Option<Value>,
    notebook_path: Option<Value>,
    message: Option<Value>,
    questions: Option<Value>,
}

/// A message's content: a plain string, or its blocks.
fn content<'a>(raw: Option<&'a RawValue>) -> (Option<String>, Vec<Block<'a>>) {
    let Some(raw) = raw else { return (None, vec![]) };
    if raw.get().trim_start().starts_with('"') {
        return (serde_json::from_str(raw.get()).ok(), vec![]);
    }
    (None, serde_json::from_str(raw.get()).unwrap_or_default())
}

fn squeeze(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn clip(s: &str, n: usize) -> String {
    if s.chars().count() <= n {
        return s.to_string();
    }
    let mut out: String = s.chars().take(n - 1).collect();
    out.push('…');
    out
}

/// `home` written as `~`, so a path on screen names no user.
fn tilde(s: &str, home: &str) -> String {
    if home.len() < 2 {
        return s.to_string();
    }
    s.replace(home, "~")
}

fn questions(v: Option<&Value>) -> Option<Ask> {
    let q = v?.as_array()?.first()?;
    let question = q.get("question")?.as_str()?.to_string();
    let options = q
        .get("options")
        .and_then(|o| o.as_array())
        .map(|o| o.iter().filter_map(|x| x.get("label").and_then(|l| l.as_str()).or(x.as_str()).map(str::to_string)).collect())
        .unwrap_or_default();
    Some(Ask { question, options })
}

/// What a tool call is about, as `capture.py`'s `tool_target` says it: a path by its file name.
fn target(name: &str, input: &Input, home: &str) -> String {
    let s = |v: &Option<Value>| v.as_ref().and_then(|x| x.as_str()).filter(|x| !x.trim().is_empty()).map(str::to_string);
    let text = if name == "SendMessage" && s(&input.message).is_some() {
        s(&input.message)
    } else if name == "AskUserQuestion" {
        questions(input.questions.as_ref()).map(|a| a.question)
    } else {
        let paths = [&input.file_path, &input.path, &input.notebook_path];
        [&input.command, &input.file_path, &input.pattern, &input.description, &input.prompt, &input.url, &input.query, &input.skill, &input.path, &input.notebook_path]
            .into_iter()
            .find_map(|k| {
                let v = s(k)?;
                if paths.iter().any(|p| std::ptr::eq(*p, k)) {
                    let t = v.trim_end_matches(['/', '\\']);
                    return Some(t.rsplit(['/', '\\']).next().unwrap_or(t).to_string());
                }
                Some(v)
            })
    };
    clip(&squeeze(&tilde(&text.unwrap_or_default(), home)), TARGET_CHARS)
}

/// Wrappers Claude Code puts around what a person did not type as a prompt: a `/command`, a `!`
/// command and its output, a local command's output.
fn is_wrapper(text: &str) -> bool {
    let t = text.trim_start();
    ["<command-name>", "<command-message>", "<command-args>", "<bash-input>", "<bash-stdout>", "<bash-stderr>", "<local-command-"]
        .iter()
        .any(|w| t.starts_with(w))
}

/// `text` with every `<system-reminder>…</system-reminder>` taken out.
fn without_reminders(text: &str) -> String {
    let (open, close) = ("<system-reminder>", "</system-reminder>");
    let mut out = String::new();
    let mut rest = text;
    while let Some(i) = rest.find(open) {
        out.push_str(&rest[..i]);
        match rest[i..].find(close) {
            Some(j) => rest = &rest[i + j + close.len()..],
            None => {
                rest = "";
                break;
            }
        }
    }
    out.push_str(rest);
    out
}

/// The prompt a person typed, when this user line is one. Newer Claude Code marks it
/// (`origin.kind: human`); an older line has no `origin`, and then anything opening on a tag (a
/// reminder, a peer's message, a finished child's notice) or a caveat is not one.
fn typed(line: &Line, text: &str) -> Option<String> {
    if line.is_meta == Some(true) || line.is_compact_summary == Some(true) {
        return None;
    }
    let marked = match line.origin.as_ref().and_then(|o| o.kind.as_deref()) {
        Some("human") => true,
        Some(_) => return None,
        None => false,
    };
    let text = without_reminders(text);
    let t = text.trim();
    if t.is_empty() || is_wrapper(t) || t.starts_with("[Request interrupted") {
        return None;
    }
    if !marked && (t.starts_with('<') || t.starts_with("Caveat:")) {
        return None;
    }
    Some(t.to_string())
}

impl Reader {
    /// Read what was appended to `path` since the last call. An unchanged size and mtime reads
    /// nothing; a file that shrank is read again from the start; a trailing line still being
    /// written waits for its newline.
    pub fn refresh(&mut self, path: &Path, now: u64, home: &str) -> Result<(), String> {
        use std::io::{Read, Seek, SeekFrom};
        let meta = std::fs::metadata(path).map_err(|e| format!("{}: {e}", path.display()))?;
        let (len, mtime) = (meta.len(), meta.modified().ok());
        if len == self.len && mtime == self.mtime {
            return Ok(());
        }
        if len < self.offset {
            *self = Reader::default();
        }
        let mut f = std::fs::File::open(path).map_err(|e| format!("{}: {e}", path.display()))?;
        f.seek(SeekFrom::Start(self.offset)).map_err(|e| e.to_string())?;
        let mut left = len - self.offset;
        let mut pending: Vec<u8> = Vec::new();
        let mut buf = vec![0u8; CHUNK.min(left as usize)];
        while left > 0 {
            let want = (CHUNK as u64).min(left) as usize;
            let n = f.read(&mut buf[..want]).map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            left -= n as u64;
            pending.extend_from_slice(&buf[..n]);
            if let Some(end) = pending.iter().rposition(|b| *b == b'\n') {
                self.feed(&String::from_utf8_lossy(&pending[..=end]), now, home);
                self.offset += end as u64 + 1;
                pending.drain(..=end);
            }
        }
        self.len = len;
        self.mtime = mtime;
        Ok(())
    }

    /// Take in complete transcript lines.
    pub fn feed(&mut self, text: &str, now: u64, home: &str) {
        for raw in text.lines() {
            let Ok(line) = serde_json::from_str::<Line>(raw) else { continue };
            if line.is_sidechain == Some(true) {
                continue;
            }
            // Title lines carry no timestamp.
            let title = |t: &Option<String>| t.as_deref().map(|t| clip(&squeeze(t), TOPIC_CHARS)).filter(|t| !t.is_empty());
            match line.kind.as_str() {
                "ai-title" => self.ai_title = title(&line.ai_title).or(self.ai_title.take()),
                "custom-title" => self.custom_title = title(&line.custom_title).or(self.custom_title.take()),
                _ => {}
            }
            let Some(at) = line.timestamp.as_deref().and_then(stamp_ms) else { continue };
            match line.kind.as_str() {
                "assistant" => self.assistant(&line, at, now, home),
                "user" => self.user(&line, home),
                _ => {}
            }
        }
        self.forget_before(now);
    }

    fn assistant(&mut self, line: &Line, at: u64, now: u64, home: &str) {
        let Some(m) = &line.message else { return };
        let real = m.model.as_deref().is_some_and(|x| x.starts_with("claude"));
        if real {
            self.model = m.model.clone();
            if let Some(u) = &m.usage {
                let n = |x: Option<u64>| x.unwrap_or(0);
                let call = Call {
                    id: m.id.clone(),
                    at,
                    output: n(u.output_tokens),
                    input: n(u.input_tokens),
                    cache_read: n(u.cache_read_input_tokens),
                    cache_creation: n(u.cache_creation_input_tokens),
                };
                self.context = Some(call.input + call.cache_read + call.cache_creation);
                if at + RATE_WINDOW_MS > now {
                    self.count(call);
                }
            }
        }
        let (text, blocks) = content(m.content);
        if let Some(t) = text.filter(|t| !t.trim().is_empty()) {
            self.said = Some(Said { text: tilde(&t, home), at });
        }
        for b in blocks {
            match b.kind.as_str() {
                "text" => {
                    if let Some(t) = b.text.filter(|t| !t.trim().is_empty()) {
                        self.said = Some(Said { text: tilde(&t, home), at });
                    }
                }
                "tool_use" => {
                    let name = b.name.unwrap_or_default();
                    let input: Input = b.input.and_then(|i| serde_json::from_str(i.get()).ok()).unwrap_or_default();
                    if name == "AskUserQuestion" {
                        self.ask = questions(input.questions.as_ref()).and_then(|a| Some((b.id.clone()?, a)));
                    }
                    self.activity = Some(Activity { target: target(&name, &input, home), tool: name, at, running: true });
                    self.tool_id = b.id;
                }
                _ => {}
            }
        }
    }

    fn user(&mut self, line: &Line, home: &str) {
        let Some(m) = &line.message else { return };
        let (text, blocks) = content(m.content);
        let mut answered = false;
        for b in blocks.iter().filter(|b| b.kind == "tool_result") {
            answered = true;
            let Some(id) = b.tool_use_id.as_deref() else { continue };
            if self.tool_id.as_deref() == Some(id) {
                if let Some(a) = self.activity.as_mut() {
                    a.running = false;
                }
            }
            if self.ask.as_ref().is_some_and(|(q, _)| q == id) {
                self.ask = None;
            }
        }
        if answered {
            return;
        }
        let text = text.unwrap_or_else(|| blocks.iter().filter(|b| b.kind == "text").filter_map(|b| b.text.as_deref()).collect::<Vec<_>>().join("\n"));
        if let Some(t) = typed(line, &text) {
            self.topic = Some(clip(&squeeze(&tilde(&t, home)), TOPIC_CHARS));
            // A person typed after the call: whatever it was waiting on is over.
            if let Some(a) = self.activity.as_mut() {
                a.running = false;
            }
            self.ask = None;
        }
    }

    /// Keep one row per message id: the last line of a message carries its final usage.
    fn count(&mut self, call: Call) {
        if call.id.is_some() {
            if let Some(same) = self.calls.iter_mut().rev().take(64).find(|c| c.id == call.id) {
                *same = Call { at: same.at, ..call };
                return;
            }
        }
        self.calls.push_back(call);
    }

    fn forget_before(&mut self, now: u64) {
        while self.calls.front().is_some_and(|c| c.at + RATE_WINDOW_MS <= now) {
            self.calls.pop_front();
        }
    }

    /// The calls made in the window ending at `now`.
    pub fn recent(&self, now: u64) -> impl Iterator<Item = &Call> {
        self.calls.iter().filter(move |c| c.at + RATE_WINDOW_MS > now)
    }

    /// What the feed says of this session. `topic` and `title` are a parent's alone; the name a
    /// person gave it is its title before the one Claude Code did.
    pub fn session(&self, parent: bool) -> SessionFeed {
        SessionFeed {
            activity: self.activity.clone(),
            said: self.said.clone(),
            context: self.context,
            model: self.model.clone(),
            topic: if parent { self.topic.clone() } else { None },
            title: if parent { self.custom_title.clone().or_else(|| self.ai_title.clone()) } else { None },
            contract: None,
            ask: self.ask.as_ref().map(|(_, a)| a.clone()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const T0: &str = "2026-10-15T12:00:00.000Z";
    const T0_MS: u64 = 1_792_065_600_000;

    fn at(s: u64) -> String {
        let ms = T0_MS + s * 1000;
        let secs = ms / 1000 - T0_MS / 1000;
        format!("2026-10-15T12:{:02}:{:02}.000Z", secs / 60, secs % 60)
    }

    fn assistant(s: u64, id: &str, content: Value, usage: Value) -> String {
        json!({ "type": "assistant", "timestamp": at(s), "message": { "id": id, "model": "claude-opus-5", "role": "assistant", "content": content, "usage": usage } }).to_string()
    }

    fn tool(s: u64, msg: &str, tool_id: &str, name: &str, input: Value) -> String {
        assistant(s, msg, json!([{ "type": "tool_use", "id": tool_id, "name": name, "input": input }]), json!({ "input_tokens": 1, "output_tokens": 10, "cache_read_input_tokens": 100, "cache_creation_input_tokens": 5 }))
    }

    fn result(s: u64, tool_id: &str) -> String {
        json!({ "type": "user", "timestamp": at(s), "message": { "role": "user", "content": [{ "type": "tool_result", "tool_use_id": tool_id, "content": "lorem ipsum" }] }, "toolUseResult": { "stdout": "lorem" } }).to_string()
    }

    fn prompt(s: u64, content: Value, origin: Option<&str>) -> String {
        let mut v = json!({ "type": "user", "timestamp": at(s), "message": { "role": "user", "content": content } });
        if let Some(k) = origin {
            v["origin"] = json!({ "kind": k });
        }
        v.to_string()
    }

    fn read(lines: &[String]) -> Reader {
        let mut r = Reader::default();
        r.feed(&(lines.join("\n") + "\n"), T0_MS + 600_000, "/Users/you");
        r
    }

    #[test]
    fn the_test_clock_starts_where_its_stamps_do() {
        assert_eq!(stamp_ms(T0), Some(T0_MS));
        assert_eq!(stamp_ms(&at(61)), Some(T0_MS + 61_000));
    }

    #[test]
    fn the_last_tool_call_runs_until_its_result_arrives() {
        let call = tool(10, "m1", "t1", "Bash", json!({ "command": "gh pr checks 1 --watch", "description": "lorem" }));
        let r = read(&[call.clone()]);
        assert_eq!(r.session(false).activity, Some(Activity { tool: "Bash".into(), target: "gh pr checks 1 --watch".into(), at: T0_MS + 10_000, running: true }));
        let r = read(&[call, result(70, "t1")]);
        assert!(!r.session(false).activity.unwrap().running);
    }

    #[test]
    fn a_result_for_an_earlier_call_leaves_the_last_one_running() {
        let r = read(&[
            tool(1, "m1", "t1", "Read", json!({ "file_path": "/Users/you/src/lorem.rs" })),
            tool(2, "m2", "t2", "Edit", json!({ "file_path": "/Users/you/src/ipsum.rs", "old_string": "a", "new_string": "b" })),
            result(3, "t1"),
        ]);
        let a = r.session(false).activity.unwrap();
        assert_eq!((a.tool.as_str(), a.target.as_str(), a.running), ("Edit", "ipsum.rs", true));
    }

    #[test]
    fn targets_name_a_file_by_its_name_and_a_home_as_tilde() {
        let input = |v: Value| serde_json::from_value::<Input>(v).unwrap();
        assert_eq!(target("Write", &input(json!({ "file_path": "/Users/you/a/b.ts", "content": "x" })), "/Users/you"), "b.ts");
        assert_eq!(target("Bash", &input(json!({ "command": "ls   /Users/you/x\n  -la" })), "/Users/you"), "ls ~/x -la");
        assert_eq!(target("Grep", &input(json!({ "pattern": "fn main", "path": "/r" })), ""), "fn main");
        assert_eq!(target("SendMessage", &input(json!({ "to": "a", "message": "hello" })), ""), "hello");
        assert_eq!(target("Mystery", &input(json!({ "other": 3 })), ""), "");
        let long = "x".repeat(200);
        assert_eq!(target("Bash", &input(json!({ "command": long })), "").chars().count(), TARGET_CHARS);
    }

    #[test]
    fn said_is_the_last_assistant_text_whole() {
        let usage = json!({ "input_tokens": 1, "output_tokens": 1 });
        let r = read(&[
            assistant(1, "m1", json!([{ "type": "text", "text": "first" }]), usage.clone()),
            assistant(2, "m2", json!([{ "type": "thinking", "thinking": "hmm" }, { "type": "text", "text": "second line\n\nand more" }]), usage.clone()),
            assistant(3, "m3", json!([{ "type": "text", "text": "  " }]), usage),
        ]);
        assert_eq!(r.session(false).said, Some(Said { text: "second line\n\nand more".into(), at: T0_MS + 2_000 }));
    }

    #[test]
    fn context_is_the_last_calls_input_and_model_the_last_real_one() {
        let r = read(&[
            assistant(1, "m1", json!([{ "type": "text", "text": "a" }]), json!({ "input_tokens": 3, "output_tokens": 9, "cache_read_input_tokens": 140_000, "cache_creation_input_tokens": 900 })),
            json!({ "type": "assistant", "timestamp": at(2), "message": { "id": "m2", "model": "<synthetic>", "content": [{ "type": "text", "text": "No response requested." }], "usage": { "input_tokens": 0, "output_tokens": 0 } } }).to_string(),
        ]);
        let s = r.session(false);
        assert_eq!(s.context, Some(140_903));
        assert_eq!(s.model.as_deref(), Some("claude-opus-5"));
    }

    #[test]
    fn an_unanswered_question_is_the_ask_and_its_answer_clears_it() {
        let q = tool(5, "m1", "q1", "AskUserQuestion", json!({ "questions": [
            { "question": "Which layout?", "header": "x", "multiSelect": false, "options": [{ "label": "attention", "description": "d" }, { "label": "station", "description": "d" }] },
            { "question": "Second?", "options": [{ "label": "y" }] },
        ] }));
        let s = read(&[q.clone()]).session(false);
        assert_eq!(s.ask, Some(Ask { question: "Which layout?".into(), options: vec!["attention".into(), "station".into()] }));
        assert_eq!(s.activity.unwrap().target, "Which layout?");
        assert_eq!(read(&[q, result(30, "q1")]).session(false).ask, None);
    }

    #[test]
    fn a_question_outlives_later_calls_until_answered() {
        let r = read(&[
            tool(5, "m1", "q1", "AskUserQuestion", json!({ "questions": [{ "question": "Q?", "options": [{ "label": "a" }] }] })),
            tool(6, "m1", "t2", "Read", json!({ "file_path": "/a" })),
        ]);
        assert_eq!(r.session(false).ask.map(|a| a.question), Some("Q?".into()));
    }

    #[test]
    fn the_topic_is_the_latest_prompt_a_person_typed() {
        let r = read(&[
            prompt(1, json!("land the feed piece"), None),
            prompt(2, json!("<command-name>/clear</command-name>\n<command-args></command-args>"), Some("human")),
            prompt(3, json!("<bash-input>ls</bash-input>"), Some("human")),
            prompt(4, json!("<task-notification><summary>done</summary></task-notification>"), Some("task-notification")),
            prompt(5, json!("a peer wrote this"), Some("peer")),
            json!({ "type": "user", "isMeta": true, "timestamp": at(6), "message": { "content": "Caveat: lorem" } }).to_string(),
            prompt(7, json!("[Request interrupted by user]"), None),
            prompt(8, json!("<mnemo-child-finished id=\"a1\">lorem</mnemo-child-finished>"), None),
            result(9, "nothing"),
        ]);
        assert_eq!(r.session(true).topic.as_deref(), Some("land the feed piece"));
        assert_eq!(r.session(false).topic, None, "a child has no topic");
    }

    #[test]
    fn the_title_is_the_latest_ai_title_unless_a_person_named_it() {
        let ai = |t: &str| json!({ "type": "ai-title", "aiTitle": t, "sessionId": "s" }).to_string();
        let custom = |t: &str| json!({ "type": "custom-title", "customTitle": t, "sessionId": "s" }).to_string();
        let r = read(&[prompt(1, json!("[Pasted text #1 +40 lines] lorem"), Some("human")), ai("Subscriber cohort analysis"), ai("  Second   version of\nthe checkout ")]);
        assert_eq!(r.session(true).title.as_deref(), Some("Second version of the checkout"), "lines without a timestamp are read; the last wins");
        assert_eq!(r.session(false).title, None, "a child has no title");
        let r = read(&[ai("Subscriber cohort analysis"), ai("   ")]);
        assert_eq!(r.session(true).title.as_deref(), Some("Subscriber cohort analysis"), "a blank title changes nothing");
        let r = read(&[custom("approve probe"), ai("Probe the approval route")]);
        assert_eq!(r.session(true).title.as_deref(), Some("approve probe"), "the name a person gave it wins");
        assert_eq!(read(&[prompt(1, json!("lorem"), Some("human"))]).session(true).title, None);

        let mut r = Reader::default();
        r.feed(&(ai("First") + "\n"), T0_MS, "/Users/you");
        r.feed(&(ai("Later") + "\n"), T0_MS, "/Users/you");
        assert_eq!(r.session(true).title.as_deref(), Some("Later"), "a later read renames it");
    }

    #[test]
    fn a_typed_prompt_loses_its_reminders_and_keeps_a_pasted_tag() {
        let r = read(&[prompt(1, json!([{ "type": "text", "text": "<system-reminder>lorem</system-reminder>" }, { "type": "text", "text": "\n<pasted kind=\"x\">\nipsum\n</pasted>\n   review   this" }]), Some("human"))]);
        assert_eq!(r.session(true).topic.as_deref(), Some("<pasted kind=\"x\"> ipsum </pasted> review this"));
        let long = "y".repeat(500);
        assert_eq!(read(&[prompt(1, json!(long), Some("human"))]).session(true).topic.unwrap().chars().count(), TOPIC_CHARS);
    }

    #[test]
    fn a_person_typing_ends_a_call_left_without_a_result() {
        let r = read(&[tool(1, "m1", "t1", "Bash", json!({ "command": "sleep 99" })), prompt(9, json!("stop that"), Some("human"))]);
        assert!(!r.session(true).activity.unwrap().running);
    }

    #[test]
    fn calls_count_once_per_message_and_only_inside_the_window() {
        let now = T0_MS + 600_000;
        let u = |out: u64| json!({ "input_tokens": 2, "output_tokens": out, "cache_read_input_tokens": 50, "cache_creation_input_tokens": 8 });
        let mut r = Reader::default();
        let lines = [
            assistant(100, "old", json!([{ "type": "text", "text": "a" }]), u(1)),
            assistant(400, "m1", json!([{ "type": "thinking", "thinking": "x" }]), u(5)),
            assistant(401, "m1", json!([{ "type": "text", "text": "b" }]), u(7)),
            assistant(500, "m2", json!([{ "type": "text", "text": "c" }]), u(3)),
        ];
        r.feed(&(lines.join("\n") + "\n"), now, "");
        let calls: Vec<_> = r.recent(now).cloned().collect();
        assert_eq!(calls.len(), 2);
        assert_eq!((calls[0].at, calls[0].output, calls[0].cache_read), (T0_MS + 400_000, 7, 50));
        assert_eq!(r.recent(T0_MS + 400_000 + RATE_WINDOW_MS).count(), 1, "m1 leaves the window first");
    }

    #[test]
    fn sidechain_and_unparsable_lines_are_skipped() {
        let mut side: Value = serde_json::from_str(&tool(1, "m1", "t1", "Bash", json!({ "command": "x" }))).unwrap();
        side["isSidechain"] = json!(true);
        let r = read(&[side.to_string(), "{not json".into(), json!({ "type": "file-history-snapshot", "snapshot": {} }).to_string()]);
        assert_eq!(r.session(false), SessionFeed::default());
    }

    #[test]
    fn refresh_reads_only_what_was_appended() {
        let dir = crate::testutil::temp_dir("nexus-feed-reader");
        let path = dir.join("s.jsonl");
        let now = T0_MS + 600_000;
        std::fs::write(&path, tool(1, "m1", "t1", "Bash", json!({ "command": "pnpm test" })) + "\n").unwrap();
        let mut r = Reader::default();
        r.refresh(&path, now, "").unwrap();
        assert!(r.session(false).activity.unwrap().running);
        let first = r.offset;

        // Half a line waits for its newline.
        let res = result(2, "t1");
        let (a, b) = res.split_at(20);
        std::fs::OpenOptions::new().append(true).open(&path).and_then(|mut f| std::io::Write::write_all(&mut f, a.as_bytes())).unwrap();
        r.refresh(&path, now, "").unwrap();
        assert_eq!(r.offset, first);
        assert!(r.session(false).activity.unwrap().running);

        std::fs::OpenOptions::new().append(true).open(&path).and_then(|mut f| std::io::Write::write_all(&mut f, format!("{b}\n").as_bytes())).unwrap();
        r.refresh(&path, now, "").unwrap();
        assert!(!r.session(false).activity.unwrap().running);
        assert!(r.offset > first);

        // A file rewritten shorter is read again from the start.
        std::fs::write(&path, tool(3, "m9", "t9", "Read", json!({ "file_path": "/x/y.md" })) + "\n").unwrap();
        r.refresh(&path, now, "").unwrap();
        let a = r.session(false).activity.unwrap();
        assert_eq!((a.tool.as_str(), a.target.as_str(), a.running), ("Read", "y.md", true));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_line_longer_than_a_chunk_is_read_whole() {
        let dir = crate::testutil::temp_dir("nexus-feed-long");
        let path = dir.join("s.jsonl");
        let big = json!({ "type": "user", "timestamp": at(1), "message": { "content": [{ "type": "tool_result", "tool_use_id": "t1", "content": "z".repeat(CHUNK + 10) }] } }).to_string();
        let text = [tool(0, "m1", "t1", "Bash", json!({ "command": "cat big" })), big, tool(2, "m2", "t2", "Read", json!({ "file_path": "/a/b" }))].join("\n") + "\n";
        std::fs::write(&path, text).unwrap();
        let mut r = Reader::default();
        r.refresh(&path, T0_MS, "").unwrap();
        let a = r.session(false).activity.unwrap();
        assert_eq!((a.tool.as_str(), a.running), ("Read", true));
        let _ = std::fs::remove_dir_all(dir);
    }
}

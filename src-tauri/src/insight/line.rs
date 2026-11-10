//! A transcript line, by the fields the insight reads, and the small readings of text it shares.
//!
//! Every field is kept as the raw JSON it was written as and read only when it is used: a
//! megabyte of tool result or of screenshot is stepped over, never copied, and a field that a
//! later Claude Code writes in another shape loses that field alone, not the line.

use serde::Deserialize;
use serde_json::value::RawValue;
use serde_json::Value;

type Raw<'a> = Option<&'a RawValue>;

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct Line<'a> {
    #[serde(rename = "type", borrow)]
    pub kind: Raw<'a>,
    #[serde(borrow)]
    pub subtype: Raw<'a>,
    #[serde(borrow)]
    pub timestamp: Raw<'a>,
    #[serde(borrow)]
    pub uuid: Raw<'a>,
    #[serde(borrow)]
    pub is_sidechain: Raw<'a>,
    #[serde(borrow)]
    pub is_meta: Raw<'a>,
    #[serde(borrow)]
    pub is_compact_summary: Raw<'a>,
    #[serde(borrow)]
    pub origin: Raw<'a>,
    #[serde(borrow)]
    pub git_branch: Raw<'a>,
    #[serde(borrow)]
    pub effort: Raw<'a>,
    #[serde(borrow)]
    pub requested_model: Raw<'a>,
    #[serde(borrow)]
    pub message: Option<Message<'a>>,
    #[serde(borrow)]
    pub tool_use_result: Raw<'a>,
    #[serde(borrow)]
    pub attachment: Raw<'a>,
    /// A `system` line's words (`away_summary`).
    #[serde(borrow)]
    pub content: Raw<'a>,
    #[serde(borrow)]
    pub duration_ms: Raw<'a>,
    #[serde(borrow)]
    pub compact_metadata: Raw<'a>,
    #[serde(borrow)]
    pub ai_title: Raw<'a>,
    #[serde(borrow)]
    pub custom_title: Raw<'a>,
    #[serde(borrow)]
    pub permission_mode: Raw<'a>,
    #[serde(borrow)]
    pub account_uuid: Raw<'a>,
    #[serde(borrow)]
    pub last_prompt: Raw<'a>,
    #[serde(borrow)]
    pub pr_url: Raw<'a>,
    #[serde(borrow)]
    pub pr_number: Raw<'a>,
    #[serde(borrow)]
    pub pr_repository: Raw<'a>,
    #[serde(rename = "totalCostUSD", borrow)]
    pub total_cost_usd: Raw<'a>,
    #[serde(rename = "totalAPIDuration", borrow)]
    pub total_api_duration: Raw<'a>,
    #[serde(borrow)]
    pub total_tool_duration: Raw<'a>,
    #[serde(borrow)]
    pub total_lines_added: Raw<'a>,
    #[serde(borrow)]
    pub total_lines_removed: Raw<'a>,
    #[serde(borrow)]
    pub query_source: Raw<'a>,
    #[serde(borrow)]
    pub params: Raw<'a>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct Message<'a> {
    #[serde(borrow)]
    pub id: Raw<'a>,
    #[serde(borrow)]
    pub model: Raw<'a>,
    #[serde(borrow)]
    pub content: Raw<'a>,
    #[serde(borrow)]
    pub usage: Raw<'a>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct Usage {
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub cache_read_input_tokens: Option<u64>,
    pub cache_creation_input_tokens: Option<u64>,
    pub output_tokens_details: Option<UsageDetails>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct UsageDetails {
    pub thinking_tokens: Option<u64>,
}

/// One block of a message's content.
#[derive(Deserialize, Default)]
#[serde(default)]
pub struct Block<'a> {
    #[serde(rename = "type", borrow)]
    pub kind: Raw<'a>,
    #[serde(borrow)]
    pub text: Raw<'a>,
    #[serde(borrow)]
    pub id: Raw<'a>,
    #[serde(borrow)]
    pub name: Raw<'a>,
    #[serde(borrow)]
    pub input: Raw<'a>,
    #[serde(borrow)]
    pub tool_use_id: Raw<'a>,
    #[serde(borrow)]
    pub is_error: Raw<'a>,
    /// A `tool_result`'s own content: a string, or parts.
    #[serde(borrow)]
    pub content: Raw<'a>,
}

/// One part of a `tool_result`'s content. An image's `data` is megabytes of base64: it stays
/// where it is.
#[derive(Deserialize, Default)]
#[serde(default)]
pub struct Part<'a> {
    #[serde(rename = "type", borrow)]
    pub kind: Raw<'a>,
    #[serde(borrow)]
    pub text: Raw<'a>,
    #[serde(borrow)]
    pub source: Option<Source<'a>>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct Source<'a> {
    #[serde(rename = "type", borrow)]
    pub kind: Raw<'a>,
    #[serde(borrow)]
    pub media_type: Raw<'a>,
    #[serde(borrow)]
    pub data: Raw<'a>,
}

/// An `attachment` record's own object. A `file` one holds the file: only its name is read.
#[derive(Deserialize, Default)]
#[serde(default)]
pub struct Attachment<'a> {
    #[serde(rename = "type", borrow)]
    pub kind: Raw<'a>,
    #[serde(borrow)]
    pub files: Raw<'a>,
    #[serde(borrow)]
    pub filename: Raw<'a>,
    #[serde(borrow)]
    pub skills: Raw<'a>,
}

/// The string `raw` is, when it is one.
pub fn text(raw: Raw) -> Option<String> {
    let raw = raw?.get();
    if !raw.starts_with('"') {
        return None;
    }
    serde_json::from_str(raw).ok()
}

/// Whether `raw` is the string `want`, without reading it into one.
pub fn is(raw: Raw, want: &str) -> bool {
    raw.is_some_and(|r| {
        let r = r.get();
        r.len() == want.len() + 2 && r.starts_with('"') && r.ends_with('"') && &r[1..r.len() - 1] == want
    })
}

pub fn truthy(raw: Raw) -> bool {
    raw.is_some_and(|r| r.get() == "true")
}

/// A count: a whole number, or a fraction rounded to one.
pub fn number(raw: Raw) -> Option<u64> {
    let v: Value = serde_json::from_str(raw?.get()).ok()?;
    v.as_u64().or_else(|| v.as_f64().filter(|f| f.is_finite() && *f >= 0.0).map(|f| f.round() as u64))
}

pub fn parsed<'a, T: Deserialize<'a>>(raw: Raw<'a>) -> Option<T> {
    serde_json::from_str(raw?.get()).ok()
}

/// A message's content: a plain string, or its blocks.
pub fn content<'a>(raw: Raw<'a>) -> (Option<String>, Vec<Block<'a>>) {
    let Some(raw) = raw else { return (None, vec![]) };
    if raw.get().starts_with('"') {
        return (serde_json::from_str(raw.get()).ok(), vec![]);
    }
    (None, serde_json::from_str(raw.get()).unwrap_or_default())
}

/// A `tool_result`'s content as parts; a plain string is one text part's worth, returned apart.
pub fn parts<'a>(raw: Raw<'a>) -> (Option<String>, Vec<Part<'a>>) {
    let Some(raw) = raw else { return (None, vec![]) };
    if raw.get().starts_with('"') {
        return (serde_json::from_str(raw.get()).ok(), vec![]);
    }
    (None, serde_json::from_str(raw.get()).unwrap_or_default())
}

pub fn squeeze(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// `s`, at most `n` characters long, the last an ellipsis when it was cut.
pub fn clip(s: &str, n: usize) -> String {
    if s.chars().count() <= n {
        return s.to_string();
    }
    let mut out: String = s.chars().take(n - 1).collect();
    out.push('…');
    out
}

/// One line of at most `n` characters.
pub fn short(s: &str, n: usize) -> String {
    clip(&squeeze(s), n)
}

/// Wrappers Claude Code puts around what a person did not type as a prompt: a `/command`, a `!`
/// command and its output, a local command's output.
fn is_wrapper(text: &str) -> bool {
    ["<command-name>", "<command-message>", "<command-args>", "<bash-input>", "<bash-stdout>", "<bash-stderr>", "<local-command-"].iter().any(|w| text.starts_with(w))
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

/// The prompt a person typed, when this user line is one, by the rule `nexus_feed` reads a
/// parent's topic with. Newer Claude Code marks it (`origin.kind: human`); an older line has no
/// `origin`, and then anything opening on a tag (a reminder, a peer's message, a finished
/// child's notice) or a caveat is not one.
pub fn typed(line: &Line, text: &str) -> Option<String> {
    if truthy(line.is_meta) || truthy(line.is_compact_summary) || truthy(line.is_sidechain) {
        return None;
    }
    let origin: Option<Value> = parsed(line.origin);
    let marked = match origin.as_ref().and_then(|o| o.get("kind")).and_then(Value::as_str) {
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

/// `claude-memory` or `claude-md` when `path` is one of Claude Code's own memory files: a file
/// of a project's `memory/` under an account's `projects/`, or a `CLAUDE.md`.
pub fn memory_file(path: &str) -> Option<&'static str> {
    let p = path.replace('\\', "/");
    let segs: Vec<&str> = p.split('/').collect();
    let in_memory = (1..segs.len()).any(|i| {
        segs[i].starts_with(".claude") && segs.get(i + 1) == Some(&"projects") && segs.get(i + 2).is_some_and(|s| !s.is_empty()) && segs.get(i + 3) == Some(&"memory") && i + 4 < segs.len()
    });
    if in_memory {
        return Some("claude-memory");
    }
    (p.ends_with("/CLAUDE.md") || p.ends_with("/CLAUDE.local.md")).then_some("claude-md")
}

/// What a tool call is: one of `ToolCall::kind`'s words.
pub fn kind_of(name: &str) -> &'static str {
    match name {
        "Read" => "read",
        "Grep" | "Glob" | "LS" => "search-code",
        "Edit" | "NotebookEdit" | "MultiEdit" => "edit",
        "Write" => "write",
        "Bash" | "PowerShell" | "Monitor" | "BashOutput" | "KillShell" => "shell",
        "WebSearch" => "web-search",
        "WebFetch" => "web-fetch",
        "Artifact" => "artifact",
        "Agent" | "Task" | "Workflow" => "agent",
        "SendMessage" => "message",
        "Skill" => "skill",
        "AskUserQuestion" => "ask",
        "ToolSearch" | "TaskStop" | "TaskCreate" | "TaskGet" | "TaskList" | "TaskUpdate" | "TaskOutput" | "TodoWrite" | "EnterPlanMode" | "ExitPlanMode" | "EnterWorktree" | "ExitWorktree" | "ListAgents"
        | "CronCreate" | "CronDelete" | "CronList" | "ScheduleWakeup" => "meta",
        _ if name.starts_with("mcp__mnemo__") => "memory",
        _ if is_browser(name) => "browser",
        _ if name.starts_with("mcp__") => "mcp",
        _ => "other",
    }
}

/// Claude in Chrome, the desktop app's built-in browser, and this app's own pane tools that
/// read a page or take a picture.
fn is_browser(name: &str) -> bool {
    if ["mcp__claude-in-chrome__", "mcp__Claude_Browser__", "mcp__remote-devices__Claude_Browser__"].iter().any(|p| name.starts_with(p)) {
        return true;
    }
    name.strip_prefix("mcp__desktop__").is_some_and(|tool| tool.contains("browser") || tool.contains("snapshot"))
}

/// A tool call's input, by the keys its target is read from. Values stay `Value`: one tool's
/// string is another's object, and a mismatch must not lose the call.
#[derive(Deserialize, Default)]
#[serde(default)]
pub struct Input {
    pub command: Option<Value>,
    pub file_path: Option<Value>,
    pub pattern: Option<Value>,
    pub url: Option<Value>,
    pub query: Option<Value>,
    pub skill: Option<Value>,
    pub slug: Option<Value>,
    pub topic: Option<Value>,
    pub description: Option<Value>,
    pub prompt: Option<Value>,
    pub path: Option<Value>,
    pub notebook_path: Option<Value>,
    pub action: Option<Value>,
    pub message: Option<Value>,
    pub questions: Option<Value>,
}

fn said(v: &Option<Value>) -> Option<&str> {
    v.as_ref().and_then(Value::as_str).filter(|s| !s.trim().is_empty())
}

impl Input {
    /// The file the call is on, as the transcript wrote it.
    pub fn file(&self) -> Option<&str> {
        said(&self.file_path).or_else(|| said(&self.path)).or_else(|| said(&self.notebook_path))
    }

    pub fn skill(&self) -> Option<&str> {
        said(&self.skill)
    }

    /// The first question of an `AskUserQuestion`, and its options as `(label, description)`.
    pub fn question(&self) -> Option<(String, Vec<(String, String)>)> {
        self.asked().into_iter().next().map(|q| (q.question, q.options))
    }

    /// Every question of an `AskUserQuestion`, in the order its dialog asks them. One with no
    /// `question` text is left out.
    pub fn asked(&self) -> Vec<Asked> {
        let word = |o: &Value, key: &str| o.get(key).and_then(Value::as_str).unwrap_or_default().to_string();
        let Some(all) = self.questions.as_ref().and_then(Value::as_array) else { return Vec::new() };
        all.iter()
            .filter_map(|q| {
                let question = q.get("question")?.as_str()?.to_string();
                let options = q.get("options").and_then(Value::as_array).map(|all| all.iter().map(|o| (o.as_str().map(str::to_string).unwrap_or_else(|| word(o, "label")), word(o, "description"))).collect());
                Some(Asked { header: word(q, "header"), question, options: options.unwrap_or_default(), multi: q.get("multiSelect").and_then(Value::as_bool).unwrap_or(false) })
            })
            .collect()
    }

    /// What the call is about, in one line: the first of the keys `capture.py` tries that the
    /// input has. A path is the path the transcript wrote.
    pub fn target(&self, name: &str) -> String {
        const CHARS: usize = 160;
        if name == "AskUserQuestion" {
            return short(&self.question().map(|q| q.0).unwrap_or_default(), 200);
        }
        if name == "SendMessage" {
            if let Some(m) = said(&self.message) {
                return short(m, CHARS);
            }
        }
        let keys = [&self.command, &self.file_path, &self.pattern, &self.url, &self.query, &self.skill, &self.slug, &self.topic, &self.description, &self.prompt, &self.path, &self.notebook_path, &self.action];
        short(keys.into_iter().find_map(said).unwrap_or_default(), CHARS)
    }
}

/// One question of an `AskUserQuestion` call, as its input wrote it.
pub struct Asked {
    pub header: String,
    pub question: String,
    /// `(label, description)`.
    pub options: Vec<(String, String)>,
    /// It takes several answers.
    pub multi: bool,
}

/// The page a browser tool's result says it ran on, as `(title, url)`: the tab its
/// `Tab Context` names as executed on, else the first tab listed, else a page text's own
/// `Title:` and `URL:` lines.
pub fn page_of(text: &str) -> Option<(String, String)> {
    let tab = |from: &str| -> Option<(String, String)> {
        let rest = &from[from.find(": \"")? + 3..];
        let end = rest.find("\" (")?;
        let (title, rest) = (&rest[..end], &rest[end + 3..]);
        let url = match rest.strip_prefix('"') {
            Some(quoted) => &quoted[..quoted.find("\")")?],
            None => &rest[..rest.find(')')?],
        };
        Some((title.to_string(), url.to_string()))
    };
    let listed = |id: &str| text.match_indices(&format!("tabId {id}: \"")).next().and_then(|(i, _)| tab(&text[i..]));
    let executed = text.find("Executed on tabId: ").and_then(|i| {
        let id: String = text[i + "Executed on tabId: ".len()..].chars().take_while(char::is_ascii_digit).collect();
        (!id.is_empty()).then(|| listed(&id)).flatten()
    });
    let first = || {
        let mut from = 0;
        while let Some(i) = text[from..].find("tabId ") {
            let at = from + i;
            let digits = text[at + 6..].chars().take_while(char::is_ascii_digit).count();
            if digits > 0 && text[at + 6 + digits..].starts_with(": \"") {
                return tab(&text[at..]);
            }
            from = at + 6;
        }
        None
    };
    let headed = || {
        let line = |key: &str| text.lines().find_map(|l| l.strip_prefix(key)).map(|v| v.trim().to_string());
        Some((line("Title: ").unwrap_or_default(), line("URL: ")?))
    };
    executed.or_else(first).or_else(headed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn raw(v: Value) -> Box<RawValue> {
        RawValue::from_string(v.to_string()).unwrap()
    }

    #[test]
    fn a_field_is_read_as_what_it_is_or_as_nothing() {
        assert_eq!(text(Some(&raw(json!("a \"b\"")))).as_deref(), Some("a \"b\""));
        assert_eq!(text(Some(&raw(json!({ "a": 1 })))), None);
        assert_eq!(text(None), None);
        assert!(is(Some(&raw(json!("user"))), "user"));
        assert!(!is(Some(&raw(json!("users"))), "user") && !is(Some(&raw(json!(4))), "4") && !is(None, ""));
        assert!(truthy(Some(&raw(json!(true)))) && !truthy(Some(&raw(json!("true")))) && !truthy(None));
        assert_eq!(number(Some(&raw(json!(12)))), Some(12));
        assert_eq!(number(Some(&raw(json!(12.6)))), Some(13));
        assert_eq!(number(Some(&raw(json!(-1)))), None);
        assert_eq!(number(Some(&raw(json!("12")))), None);
    }

    #[test]
    fn a_line_with_a_field_in_another_shape_is_still_read() {
        let l: Line = serde_json::from_str(r#"{"type":"assistant","effort":{"level":"high"},"timestamp":17,"isSidechain":"no","message":{"id":["x"],"model":"claude-opus-5","usage":{"input_tokens":3}}}"#).unwrap();
        assert!(is(l.kind, "assistant"));
        assert_eq!((text(l.effort), text(l.timestamp), truthy(l.is_sidechain)), (None, None, false));
        let m = l.message.unwrap();
        assert_eq!(text(m.model).as_deref(), Some("claude-opus-5"));
        assert_eq!(parsed::<Usage>(m.usage).unwrap().input_tokens, Some(3));
        assert_eq!(text(m.id), None);
    }

    #[test]
    fn text_is_clipped_by_characters_and_squeezed_to_one_line() {
        assert_eq!(clip("añb", 3), "añb");
        assert_eq!(clip("añbc", 3), "añ…");
        assert_eq!(short("  a\n\n b\tc  ", 10), "a b c");
        assert_eq!(short(&"x ".repeat(200), 160).chars().count(), 160);
    }

    fn user(v: Value) -> String {
        let mut line = json!({ "type": "user", "message": { "content": "x" } });
        for (k, v) in v.as_object().unwrap() {
            line[k] = v.clone();
        }
        line.to_string()
    }

    #[test]
    fn a_typed_prompt_is_what_a_person_wrote() {
        let is_typed = |extra: Value, text: &str| {
            let raw = user(extra);
            typed(&serde_json::from_str::<Line>(&raw).unwrap(), text)
        };
        let human = json!({ "origin": { "kind": "human" } });
        assert_eq!(is_typed(json!({}), " land it ").as_deref(), Some("land it"));
        assert_eq!(is_typed(human.clone(), "<pasted>x</pasted> review").as_deref(), Some("<pasted>x</pasted> review"), "a marked prompt may open on a tag");
        assert_eq!(is_typed(json!({}), "<mnemo-child-finished id=\"a\">x</mnemo-child-finished>"), None);
        assert_eq!(is_typed(json!({}), "Caveat: lorem"), None);
        assert_eq!(is_typed(human.clone(), "<command-name>/clear</command-name>"), None);
        assert_eq!(is_typed(human.clone(), "<bash-input>ls</bash-input>"), None);
        assert_eq!(is_typed(human.clone(), "[Request interrupted by user]"), None);
        assert_eq!(is_typed(human.clone(), "<system-reminder>a</system-reminder>  "), None);
        assert_eq!(is_typed(human.clone(), "<system-reminder>a</system-reminder> go <system-reminder>b</system-reminder>").as_deref(), Some("go"));
        assert_eq!(is_typed(json!({ "origin": { "kind": "task-notification" } }), "done"), None);
        assert_eq!(is_typed(json!({ "origin": { "kind": "peer" } }), "a peer wrote this"), None);
        assert_eq!(is_typed(json!({ "isMeta": true }), "lorem"), None);
        assert_eq!(is_typed(json!({ "isCompactSummary": true }), "lorem"), None);
        assert_eq!(is_typed(json!({ "isSidechain": true }), "lorem"), None);
    }

    #[test]
    fn a_memory_file_is_under_a_projects_memory_or_a_claude_md() {
        assert_eq!(memory_file("/Users/you/.claude/projects/-Users-you-app/memory/MEMORY.md"), Some("claude-memory"));
        assert_eq!(memory_file("C:\\Users\\you\\.claude-side\\projects\\C--Users-you-app\\memory\\a\\b.md"), Some("claude-memory"));
        assert_eq!(memory_file("/Users/you/.claude/projects/-Users-you-app/memory"), None, "the folder is no file");
        assert_eq!(memory_file("/Users/you/.claude/projects/memory/x.md"), None);
        assert_eq!(memory_file("/Users/you/app/memory/x.md"), None);
        assert_eq!(memory_file("/Users/you/app/CLAUDE.md"), Some("claude-md"));
        assert_eq!(memory_file("C:\\app\\CLAUDE.local.md"), Some("claude-md"));
        assert_eq!(memory_file("/Users/you/app/NOT-CLAUDE.md"), None);
        assert_eq!(memory_file("CLAUDE.md"), None);
    }

    #[test]
    fn a_tool_has_a_kind() {
        let kinds = [
            ("Read", "read"),
            ("Glob", "search-code"),
            ("NotebookEdit", "edit"),
            ("Write", "write"),
            ("PowerShell", "shell"),
            ("WebSearch", "web-search"),
            ("WebFetch", "web-fetch"),
            ("Artifact", "artifact"),
            ("Workflow", "agent"),
            ("SendMessage", "message"),
            ("Skill", "skill"),
            ("AskUserQuestion", "ask"),
            ("ToolSearch", "meta"),
            ("mcp__mnemo__read_mnemo_rule", "memory"),
            ("mcp__claude-in-chrome__computer", "browser"),
            ("mcp__Claude_Browser__navigate", "browser"),
            ("mcp__remote-devices__Claude_Browser__navigate", "browser"),
            ("mcp__desktop__desktop_pane_snapshot", "browser"),
            ("mcp__desktop__desktop_terminal_read", "mcp"),
            ("mcp__github__get_issue", "mcp"),
            ("Mystery", "other"),
        ];
        for (tool, kind) in kinds {
            assert_eq!(kind_of(tool), kind, "{tool}");
        }
    }

    #[test]
    fn a_target_is_the_first_key_the_input_has_and_a_path_stays_whole() {
        let input = |v: Value| serde_json::from_value::<Input>(v).unwrap();
        assert_eq!(input(json!({ "file_path": "/Users/you/a/b.ts", "content": "x" })).target("Write"), "/Users/you/a/b.ts");
        assert_eq!(input(json!({ "command": "ls   C:\\Users\\you\\x\n  -la", "description": "list" })).target("Bash"), "ls C:\\Users\\you\\x -la");
        assert_eq!(input(json!({ "pattern": "fn main", "path": "/r" })).target("Grep"), "fn main");
        assert_eq!(input(json!({ "path": "/r", "action": "x" })).target("LS"), "/r");
        assert_eq!(input(json!({ "to": "a", "message": "hello\nthere" })).target("SendMessage"), "hello there");
        assert_eq!(input(json!({ "questions": [{ "question": "Which?", "options": [] }] })).target("AskUserQuestion"), "Which?");
        assert_eq!(input(json!({ "other": 3, "command": { "not": "a string" } })).target("Mystery"), "");
        assert_eq!(input(json!({ "command": "x".repeat(300) })).target("Bash").chars().count(), 160);
        let i = input(json!({ "notebook_path": "/n.ipynb" }));
        assert_eq!(i.file(), Some("/n.ipynb"));
        assert_eq!(input(json!({ "questions": [{ "question": "Q?", "options": [{ "label": "a", "description": "d" }, "plain"] }] })).question(), Some(("Q?".into(), vec![("a".into(), "d".into()), ("plain".into(), String::new())])));
    }

    #[test]
    fn a_browser_result_names_the_page_it_ran_on() {
        let two = "Clicked.\n\nTab Context:\n- Executed on tabId: 22\n- Available tabs:\n  • tabId 11: \"Docs\" (\"https://docs.example/a\")\n  • tabId 22: \"Shop (beta)\" (\"https://shop.example/cart?x=1\")";
        assert_eq!(page_of(two), Some(("Shop (beta)".into(), "https://shop.example/cart?x=1".into())));
        let listed = "{\"availableTabs\":[]}\n\nTab Context:\n- Available tabs:\n  • tabId 7: \"New Tab\" (\"chrome://newtab/\")";
        assert_eq!(page_of(listed), Some(("New Tab".into(), "chrome://newtab/".into())));
        assert_eq!(page_of("Title: A page\nURL: https://a.example/\nSource element: <main>"), Some(("A page".into(), "https://a.example/".into())));
        assert_eq!(page_of("tabId and nothing else"), None);
        assert_eq!(page_of("Waited for 3 seconds"), None);
    }
}

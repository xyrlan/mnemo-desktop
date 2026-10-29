//! James's brain (jarvis-brain): who answers his requests, and Claude when that is Claude.
//!
//! `jarvis_brain` reads the config's `brain` section on every call: none is `local`, the model
//! under llama-server (`jarvis_llm`); `{ "kind": "claude", "model": …, "effort": … }` is Claude
//! through Claude Code's CLI, on the maintainer's own subscription.
//!
//! With Claude there is one conversation for the app: a long-lived `claude -p` speaking
//! stream-json on its stdin and stdout. The first ask starts it and it lives across asks, so a
//! later turn takes about a second and remembers the earlier ones. It restarts when the system
//! prompt, the model, the effort or the account differ from what it runs with; `jarvis_brain_reset`
//! ends it. `jarvis_brain_ask` and `jarvis_brain_stream` share it. Asks run one at a time. An ask with no `result` within `ASK_TIMEOUT` ends it and fails;
//! a process that dies leaves its last stderr lines as the error, and the next ask starts afresh.
//! `jarvis_brain_stream` sends the reply in pieces as Claude writes it: `--include-partial-messages`
//! makes the CLI write each `text_delta` of the reply as a `stream_event` line before the turn's
//! `result` (`piece_of`), and whatever of the `result` the deltas did not cover goes last, so the
//! pieces joined are the `result` (`rest_of`).
//! It never outlives the app: it is tied to it the way llama-server is (`jarvis_llm::spawn_tied`),
//! and the app's exit ends it (`plugin`).
//!
//! Claude gets nothing but words: no tool (`--tools ""`), no MCP server (`--strict-mcp-config`), no
//! hooks, plugins, skills or CLAUDE.md (`--safe-mode`), and no session saved
//! (`--no-session-persistence`), so the conversation reaches neither `claude --resume` nor mnemo's
//! briefings. It runs in `~/.mnemo-desktop/jarvis-brain` (`-dev` for a debug build), never in a
//! project. `claude agents` lists it there as an interactive session; `is_brain_dir` is how the
//! mission poll, and with it `list_sessions` and the parents James follows, leaves it out.

use std::collections::VecDeque;
use std::ffi::OsString;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::mission::account_dirs::AccountEnv;

/// Who answers James's requests; `BrainConfig` in `src/jarvis/client.ts`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum BrainConfig {
    Local,
    Claude { model: String, effort: String },
}

pub const DEFAULT_MODEL: &str = "sonnet";
pub const DEFAULT_EFFORT: &str = "low";

/// How long one ask may wait for Claude's `result`.
pub const ASK_TIMEOUT: Duration = Duration::from_secs(120);

/// How many of the last stderr lines a dead process leaves as the error.
const STDERR_LINES: usize = 8;

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

// ---------------------------------------------------------------------------------------
// Config

/// The config's `brain` section as `BrainConfig`: none (`Null`) is `local`; `kind` is `local` or
/// `claude`; `model` and `effort` are taken as written, `sonnet` and `low` when absent. Anything
/// else, an unknown key included, is an error naming `jarvis.json`.
pub fn parse(section: &serde_json::Value) -> Result<BrainConfig, String> {
    use serde_json::Value;
    let obj = match section {
        Value::Null => return Ok(BrainConfig::Local),
        Value::Object(o) => o,
        other => return Err(format!("jarvis.json: brain must be an object like {{ \"kind\": \"claude\" }}, not {other}")),
    };
    if let Some(k) = obj.keys().find(|k| !["kind", "model", "effort"].contains(&k.as_str())) {
        return Err(format!("jarvis.json: brain.{k} is not a setting of the brain (kind, model, effort)"));
    }
    let name = |key: &str, default: &str| -> Result<String, String> {
        match obj.get(key) {
            None | Some(Value::Null) => Ok(default.to_string()),
            Some(Value::String(s)) if !s.trim().is_empty() => Ok(s.trim().to_string()),
            Some(other) => Err(format!("jarvis.json: brain.{key} must be a name like \"{default}\", not {other}")),
        }
    };
    let (model, effort) = (name("model", DEFAULT_MODEL)?, name("effort", DEFAULT_EFFORT)?);
    match obj.get("kind") {
        Some(Value::String(k)) if k == "local" => Ok(BrainConfig::Local),
        Some(Value::String(k)) if k == "claude" => Ok(BrainConfig::Claude { model, effort }),
        Some(other) => Err(format!("jarvis.json: brain.kind is \"local\" or \"claude\", not {other}")),
        None => Err("jarvis.json: brain names no kind (\"local\" or \"claude\")".to_string()),
    }
}

/// The config's brain, read now.
pub fn config() -> Result<BrainConfig, String> {
    parse(&crate::jarvis::section("brain")?)
}

// ---------------------------------------------------------------------------------------
// The process

/// Where Claude runs and its system prompt lives: the app's own dir, never a project.
pub fn brain_dir() -> PathBuf {
    brain_dir_in(&crate::app_dir::app_dir())
}

fn brain_dir_in(app_dir: &Path) -> PathBuf {
    app_dir.join("jarvis-brain")
}

/// Whether `cwd` is where a brain runs, the release build's or a debug build's, under `home`: a
/// `claude agents` row there is James's brain, not a session.
pub fn is_brain_dir(cwd: &str, home: &Path) -> bool {
    use crate::app_dir::{DEBUG, RELEASE};
    let norm = |p: &str| {
        let p = p.strip_prefix(r"\\?\").unwrap_or(p).replace('\\', "/");
        let p = p.trim_end_matches('/').to_string();
        if cfg!(windows) {
            p.to_lowercase()
        } else {
            p
        }
    };
    let cwd = norm(cwd);
    !cwd.is_empty() && [RELEASE, DEBUG].iter().any(|d| norm(&brain_dir_in(&home.join(d)).to_string_lossy()) == cwd)
}

/// What a conversation runs with: when any of it changes, the next ask starts a new one.
#[derive(Debug, Clone, PartialEq)]
pub struct Key {
    pub system: String,
    pub model: String,
    pub effort: String,
    pub account: AccountEnv,
}

/// `claude`'s arguments: one long-lived print session in stream-json both ways, with nothing but
/// words (see the module doc).
pub fn args(model: &str, effort: &str, system_file: &Path) -> Vec<OsString> {
    let mut args: Vec<OsString> = [
        "-p",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        // `--print` writes stream-json only with it.
        "--verbose",
        // The reply's deltas as `stream_event` lines, for `jarvis_brain_stream`.
        "--include-partial-messages",
        "--model",
        model,
        "--effort",
        effort,
        "--tools",
        "",
        "--strict-mcp-config",
        "--safe-mode",
        "--no-session-persistence",
        "--system-prompt-file",
    ]
    .into_iter()
    .map(OsString::from)
    .collect();
    args.push(system_file.into());
    args
}

/// Sets `cmd`'s environment: the account's dir set or removed as a pane's is, and no API key,
/// so it runs on the subscription.
pub fn environ(cmd: &mut Command, account: &AccountEnv) {
    account.apply(cmd);
    cmd.env_remove("ANTHROPIC_API_KEY");
}

/// The account Claude runs on: the active one when it is a Claude account, else the default.
fn account() -> AccountEnv {
    use crate::agent_kind::AgentKind;
    let active = crate::accounts::Place::real().for_new_pane();
    match active.kind {
        AgentKind::Claude => AccountEnv { config_dir: active.config_dir.map(|d| d.to_string_lossy().to_string()), kind: AgentKind::Claude },
        AgentKind::Grok => AccountEnv { config_dir: None, kind: AgentKind::Claude },
    }
}

/// `claude` as the app starts it for `key`: the system prompt written to `dir`, which is its cwd.
fn claude_in(dir: &Path, key: &Key) -> Result<Command, String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let system_file = dir.join("system.md");
    std::fs::write(&system_file, &key.system).map_err(|e| format!("{}: {e}", system_file.display()))?;
    let mut cmd = crate::proc::tool("claude", &crate::mission::login_path());
    cmd.args(args(&key.model, &key.effort, &system_file)).current_dir(dir);
    environ(&mut cmd, &key.account);
    Ok(cmd)
}

/// What the readers of a conversation's pipes report.
enum Event {
    Out(String),
    OutEnd,
    ErrEnd,
}

/// One running `claude`.
struct Conversation {
    key: Key,
    child: Mutex<Child>,
    stdin: Mutex<Option<ChildStdin>>,
    events: Mutex<Receiver<Event>>,
    stderr: Arc<Mutex<VecDeque<String>>>,
    /// Set once the app ended it, so an ask it cuts short says so rather than "it died".
    ended: AtomicBool,
    tie: Mutex<Option<crate::jarvis_llm::Tie>>,
}

impl Conversation {
    fn start(key: Key, cmd: Command) -> Result<Conversation, String> {
        let mut cmd = cmd;
        cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
        let (mut child, tie) = crate::jarvis_llm::spawn_tied(cmd, "claude")?;
        let (tx, rx) = std::sync::mpsc::channel();
        let stderr = Arc::new(Mutex::new(VecDeque::new()));
        let (stdout, err) = (child.stdout.take(), child.stderr.take());
        if let Some(out) = stdout {
            read_lines(out, tx.clone(), |l| Some(Event::Out(l)), Event::OutEnd, "jarvis-brain-out");
        }
        if let Some(err) = err {
            let tail = stderr.clone();
            let keep = move |line: String| {
                if !line.trim().is_empty() {
                    let mut t = lock(&tail);
                    t.push_back(line);
                    while t.len() > STDERR_LINES {
                        t.pop_front();
                    }
                }
                None
            };
            read_lines(err, tx, keep, Event::ErrEnd, "jarvis-brain-err");
        }
        let stdin = child.stdin.take();
        Ok(Conversation { key, child: Mutex::new(child), stdin: Mutex::new(stdin), events: Mutex::new(rx), stderr, ended: AtomicBool::new(false), tie: Mutex::new(Some(tie)) })
    }

    fn pid(&self) -> u32 {
        lock(&self.child).id()
    }

    /// Kills it and whatever it started (the job closes with the tie).
    fn end(&self) {
        self.ended.store(true, Ordering::SeqCst);
        lock(&self.stdin).take();
        {
            let mut child = lock(&self.child);
            let _ = child.kill();
            let _ = child.wait();
        }
        lock(&self.tie).take();
    }

    /// Why it stopped: its exit status and its last stderr lines, once stderr has closed (a
    /// moment at most).
    fn died(&self, events: &Receiver<Event>) -> String {
        let until = Instant::now() + Duration::from_secs(2);
        while let Some(left) = until.checked_duration_since(Instant::now()) {
            match events.recv_timeout(left) {
                Ok(Event::ErrEnd) | Err(_) => break,
                Ok(_) => {}
            }
        }
        let status = {
            let mut child = lock(&self.child);
            let until = Instant::now() + Duration::from_secs(2);
            loop {
                match child.try_wait() {
                    Ok(Some(s)) => break s.to_string(),
                    Ok(None) if Instant::now() < until => std::thread::sleep(Duration::from_millis(20)),
                    _ => break "still running".to_string(),
                }
            }
        };
        let tail: Vec<String> = lock(&self.stderr).iter().cloned().collect();
        if tail.is_empty() {
            format!("claude stopped ({status}) and said nothing on stderr")
        } else {
            format!("claude stopped ({status}):\n{}", tail.join("\n"))
        }
    }
}

/// Hands every line of `from` to `line`, and what it makes of one to `tx`, then `end`, on a
/// thread of its own.
fn read_lines(from: impl Read + Send + 'static, tx: Sender<Event>, line: impl Fn(String) -> Option<Event> + Send + 'static, end: Event, name: &str) {
    let spawned = std::thread::Builder::new().name(name.into()).spawn(move || {
        for l in BufReader::new(from).lines() {
            let Ok(l) = l else { break };
            if let Some(e) = line(l) {
                if tx.send(e).is_err() {
                    return;
                }
            }
        }
        let _ = tx.send(end);
    });
    if let Err(e) = spawned {
        log::warn!("jarvis: no reader for claude's {name}: {e}");
    }
}

/// What a stream-json line says of the turn: `Some` once it is the turn's `result`, its text, or
/// the error a `result` marked as one. Every other line (init, assistant messages, rate limits)
/// and anything that is not JSON is `None`.
pub fn result_of(line: &str) -> Option<Result<String, String>> {
    let v: serde_json::Value = serde_json::from_str(line.trim()).ok()?;
    if v.get("type").and_then(|t| t.as_str()) != Some("result") {
        return None;
    }
    let text = v.get("result").and_then(|r| r.as_str()).unwrap_or("").to_string();
    let failed = v.get("is_error").and_then(|e| e.as_bool()).unwrap_or(false) || v.get("subtype").and_then(|s| s.as_str()).is_some_and(|s| s.starts_with("error"));
    if !failed {
        return Some(Ok(text));
    }
    let errors: Vec<String> = v.get("errors").and_then(|e| e.as_array()).map(|a| a.iter().map(|e| e.as_str().map_or_else(|| e.to_string(), str::to_string)).collect()).unwrap_or_default();
    let why = if !text.trim().is_empty() {
        text
    } else if !errors.is_empty() {
        errors.join("; ")
    } else {
        v.get("subtype").and_then(|s| s.as_str()).unwrap_or("an error with no message").to_string()
    };
    Some(Err(format!("Claude: {why}")))
}

/// The reply's text a stream-json line adds, when it is a `text_delta` of a `stream_event`. A
/// thinking or tool-input delta, any other event, and every other line are `None`.
pub fn piece_of(line: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(line.trim()).ok()?;
    if v.get("type").and_then(|t| t.as_str()) != Some("stream_event") {
        return None;
    }
    let event = v.get("event")?;
    if event.get("type").and_then(|t| t.as_str()) != Some("content_block_delta") {
        return None;
    }
    let delta = event.get("delta")?;
    if delta.get("type").and_then(|t| t.as_str()) != Some("text_delta") {
        return None;
    }
    Some(delta.get("text")?.as_str()?.to_string())
}

/// What of `result` is still to be sent once `sent` was: `None` when `sent` is not how `result`
/// begins, so no last piece can make the pieces joined be the `result`.
pub fn rest_of<'a>(result: &'a str, sent: &str) -> Option<&'a str> {
    result.strip_prefix(sent)
}

/// A user message as stream-json takes it, one line.
fn user_line(text: &str) -> String {
    serde_json::json!({ "type": "user", "message": { "role": "user", "content": text } }).to_string()
}

/// The app's conversation with Claude, or a test's.
pub struct Brain {
    now: Mutex<Option<Arc<Conversation>>>,
    asking: Mutex<()>,
}

impl Brain {
    pub const fn new() -> Brain {
        Brain { now: Mutex::new(None), asking: Mutex::new(()) }
    }

    /// `text` as the next user message of the conversation under `key`, started with `start` when
    /// none runs, or when the one running has another key or has died. Resolves with the turn's
    /// result, waiting `timeout` at most.
    pub fn ask(&self, key: &Key, text: &str, start: &dyn Fn(&Key) -> Result<Command, String>, timeout: Duration) -> Result<String, String> {
        self.stream(key, text, start, timeout, &mut |_| {})
    }

    /// `ask`, with the reply also handed to `on` in pieces as Claude writes it. Resolved with a
    /// result, the pieces joined are that result: what of it the deltas did not cover goes last.
    pub fn stream(&self, key: &Key, text: &str, start: &dyn Fn(&Key) -> Result<Command, String>, timeout: Duration, on: &mut dyn FnMut(&str)) -> Result<String, String> {
        let _one = lock(&self.asking);
        let conv = self.conversation(key, start)?;
        let events = lock(&conv.events);
        let asked = Instant::now();
        let line = user_line(text);
        let wrote = match lock(&conv.stdin).as_mut() {
            Some(stdin) => writeln!(stdin, "{line}").and_then(|_| stdin.flush()).map_err(|e| e.to_string()),
            None => Err("its stdin is closed".to_string()),
        };
        if wrote.is_err() {
            let why = conv.died(&events);
            drop(events);
            self.forget(&conv);
            return Err(why);
        }
        let deadline = asked + timeout;
        let mut sent = String::new();
        let mut first: Option<Duration> = None;
        loop {
            let left = deadline.saturating_duration_since(Instant::now());
            match events.recv_timeout(left) {
                Ok(Event::Out(l)) => {
                    if let Some(piece) = piece_of(&l) {
                        if !piece.is_empty() {
                            first.get_or_insert_with(|| asked.elapsed());
                            sent.push_str(&piece);
                            on(&piece);
                        }
                    } else if let Some(got) = result_of(&l) {
                        if let Ok(reply) = &got {
                            match rest_of(reply, &sent) {
                                Some("") => {}
                                Some(rest) => on(rest),
                                None => log::warn!("jarvis: claude's result is not the {} bytes it streamed; the pieces differ from the reply", sent.len()),
                            }
                        }
                        match first {
                            Some(f) => log::info!("jarvis: claude answered in {:.1} s, its first piece in {:.1} s", asked.elapsed().as_secs_f32(), f.as_secs_f32()),
                            None => log::info!("jarvis: claude answered in {:.1} s", asked.elapsed().as_secs_f32()),
                        }
                        return got;
                    }
                }
                Ok(Event::ErrEnd) => {}
                Ok(Event::OutEnd) | Err(RecvTimeoutError::Disconnected) => {
                    let why = if conv.ended.load(Ordering::SeqCst) { "the conversation with Claude was ended before it answered".to_string() } else { conv.died(&events) };
                    drop(events);
                    self.forget(&conv);
                    return Err(why);
                }
                Err(RecvTimeoutError::Timeout) => {
                    drop(events);
                    self.forget(&conv);
                    return Err(format!("Claude gave no answer within {} s, so the conversation was ended", timeout.as_secs()));
                }
            }
        }
    }

    /// The conversation to ask: the running one when its key is `key` and it lives, else a new one.
    fn conversation(&self, key: &Key, start: &dyn Fn(&Key) -> Result<Command, String>) -> Result<Arc<Conversation>, String> {
        let mut now = lock(&self.now);
        if let Some(c) = now.as_ref() {
            if c.key == *key && !gone(c) {
                return Ok(c.clone());
            }
            if let Some(c) = now.take() {
                c.end();
            }
        }
        let c = Arc::new(Conversation::start(key.clone(), start(key)?)?);
        log::info!("jarvis: claude started ({} at {} effort)", key.model, key.effort);
        *now = Some(c.clone());
        Ok(c)
    }

    /// Ends `conv`, and drops it unless another has taken its place.
    fn forget(&self, conv: &Arc<Conversation>) {
        conv.end();
        let mut now = lock(&self.now);
        if now.as_ref().is_some_and(|c| Arc::ptr_eq(c, conv)) {
            now.take();
        }
    }

    /// Ends the conversation; the next ask starts a new one.
    pub fn reset(&self) {
        let taken = lock(&self.now).take();
        if let Some(c) = taken {
            c.end();
            log::info!("jarvis: claude's conversation ended");
        }
    }

    /// The running process, if one runs.
    pub fn pid(&self) -> Option<u32> {
        lock(&self.now).as_ref().filter(|c| !gone(c)).map(|c| c.pid())
    }
}

/// Whether `c`'s process has exited.
fn gone(c: &Conversation) -> bool {
    !matches!(lock(&c.child).try_wait(), Ok(None))
}

static BRAIN: Brain = Brain::new();

/// `text` asked of Claude under `system`, as the config's brain says.
pub fn ask(system: &str, text: &str) -> Result<String, String> {
    stream(system, text, &mut |_| {})
}

/// `ask`, with the reply also handed to `on` in pieces as Claude writes it (`Brain::stream`).
pub fn stream(system: &str, text: &str, on: &mut dyn FnMut(&str)) -> Result<String, String> {
    let (model, effort) = match config()? {
        BrainConfig::Claude { model, effort } => (model, effort),
        BrainConfig::Local => return Err(format!("the brain is local (no \"brain\" of kind \"claude\" in {}), so there is no Claude to ask", crate::jarvis::config_path().display())),
    };
    let key = Key { system: system.to_string(), model, effort, account: account() };
    let dir = brain_dir();
    BRAIN.stream(&key, text, &|k| claude_in(&dir, k), ASK_TIMEOUT, on)
}

pub fn reset() {
    BRAIN.reset();
}

// ---------------------------------------------------------------------------------------
// Commands

#[tauri::command]
pub async fn jarvis_brain() -> Result<BrainConfig, String> {
    tauri::async_runtime::spawn_blocking(config).await.map_err(|e| format!("jarvis: {e}"))?
}

#[tauri::command]
pub async fn jarvis_brain_ask(system: String, text: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || ask(&system, &text)).await.map_err(|e| format!("jarvis: {e}"))?
}

/// `jarvis_brain_ask`, with the reply also sent on `on` in pieces, in order, as Claude writes it;
/// joined, they are the reply it resolves with.
#[tauri::command]
pub async fn jarvis_brain_stream(system: String, text: String, on: tauri::ipc::Channel<String>) -> Result<String, String> {
    let mut send = move |piece: &str| {
        let _ = on.send(piece.to_string());
    };
    tauri::async_runtime::spawn_blocking(move || stream(&system, &text, &mut send)).await.map_err(|e| format!("jarvis: {e}"))?
}

#[tauri::command]
pub async fn jarvis_brain_reset() {
    let _ = tauri::async_runtime::spawn_blocking(reset).await;
}

/// Ends the conversation when the app exits normally; the tie covers the other ways out.
pub fn plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("jarvis-brain")
        .on_event(|_, event| {
            if let tauri::RunEvent::Exit = event {
                reset();
            }
        })
        .build()
}

#[cfg(test)]
mod tests;

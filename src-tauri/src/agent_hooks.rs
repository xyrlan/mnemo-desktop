//! Agent status from Claude Code's own hooks (spec, *Agent status: the app's own hooks*).
//!
//! ```text
//! claude ──hook, JSON on stdin──▶ mnemo-desktop-hook <Event> ──unix socket, one JSON line──▶ app
//!                                                               app ──`agent://event`──▶ webview (src/agents/)
//! ```
//!
//! The app writes its own entries into `~/.claude/settings.json` for the five events that
//! say where a session is: `SessionStart`, `UserPromptSubmit`, `Stop`, `Notification` (waiting
//! on you) and `SessionEnd`. mnemo's CLI keeps its own hooks in the same file, so an entry is
//! the app's only when its command runs this build's hook binary; nothing else is ever
//! rewritten, moved or removed.
//!
//! The binary (`src/bin/mnemo-desktop-hook.rs`) never slows Claude down: it prints nothing,
//! always exits 0, gives up after a second and a half, and says nothing when the app is
//! closed. This side parses what it forwards and hands it to the webview; `polling` (the
//! `claude agents --json` loop) stays the fallback and reconciles state at launch.
//!
//! A debug build (`tauri dev`) writes to the user's Claude settings only with
//! `MNEMO_DESKTOP_DEV_HOOKS=1`, and then as entries of its own (its binary lives in
//! `~/.mnemo-desktop-dev/bin`), which the installed app leaves alone and vice versa.

use std::path::{Path, PathBuf};

use serde::de::{Deserializer, MapAccess, Visitor};
use serde::ser::{SerializeMap, SerializeSeq, Serializer};
use serde::{Deserialize, Serialize};
use serde_json::value::RawValue;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::app_dir::{app_dir, home, NAME};

/// The hook binary, a sibling of the app's own executable.
pub const BIN_NAME: &str = "mnemo-desktop-hook";
/// Overrides the socket the binary sends to (tests, and a pane that must reach its own app).
pub const SOCKET_ENV: &str = "MNEMO_DESKTOP_HOOK_SOCKET";
/// Lets a debug build write its hooks into the user's Claude settings.
pub const DEV_ENV: &str = "MNEMO_DESKTOP_DEV_HOOKS";
/// What the webview listens to (`src/agents/events.ts`).
pub const EVENT: &str = "agent://event";
/// Claude Code's own cap on each hook run, in seconds; the binary stops well before it.
pub const TIMEOUT_SECS: u64 = 5;
/// Claude Code's event name → `AgentEvent.kind`.
pub const EVENTS: &[(&str, &str)] = &[
    ("SessionStart", "start"),
    ("UserPromptSubmit", "prompt"),
    ("Stop", "stop"),
    ("Notification", "notification"),
    ("SessionEnd", "end"),
];
/// A prompt is cut to this many characters for `message`.
pub const PROMPT_CHARS: usize = 200;
/// The longest line the socket reads from one hook run.
const MAX_LINE: u64 = 64 * 1024;
/// Written by `agent_hooks_uninstall`, so the app does not put them back at its next start.
const OFF_MARKER: &str = "agent-hooks-off";
const MAIN: &str = "main";

pub fn socket_path() -> PathBuf {
    app_dir().join("agent-hooks.sock")
}

/// Where the settings point: a symlink to the binary of whichever build of this app dir
/// started last, so the entries survive rebuilds, worktrees and moving the app.
pub fn stable_binary() -> PathBuf {
    app_dir().join("bin").join(BIN_NAME)
}

/// `$CLAUDE_CONFIG_DIR/settings.json`, else `~/.claude/settings.json`.
pub fn claude_settings() -> PathBuf {
    match std::env::var_os("CLAUDE_CONFIG_DIR").filter(|d| !d.is_empty()) {
        Some(dir) => PathBuf::from(dir).join("settings.json"),
        None => home().join(".claude").join("settings.json"),
    }
}

/// What marks a hook command as this build's: the path of its stable binary under its app
/// dir, whatever home it was written from. `/.mnemo-desktop/bin/…` is not a substring of
/// `/.mnemo-desktop-dev/bin/…`, so the two builds never take each other's entries.
pub fn owner_mark(app_dir_name: &str) -> String {
    format!("/{app_dir_name}/bin/{BIN_NAME}")
}

fn sh_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', r"'\''"))
}

/// The command for one event. The redirect and `|| true` keep the "always exits 0, silent"
/// promise even when the app was deleted and the link dangles.
pub fn hook_command(binary: &Path, event: &str) -> String {
    format!("{} {event} 2>/dev/null || true", sh_quote(&binary.display().to_string()))
}

fn hook_entry(binary: &Path, event: &str) -> Value {
    json!({ "type": "command", "command": hook_command(binary, event), "timeout": TIMEOUT_SECS })
}

fn owned(hook: &Value, mark: &str) -> bool {
    hook.get("command").and_then(Value::as_str).is_some_and(|c| c.replace('\\', "/").contains(mark))
}

fn known(event: &str) -> bool {
    EVENTS.iter().any(|(e, _)| *e == event)
}

/// A JSON object's members in the order they were written, each value as the text it was.
struct Members(Vec<(String, Box<RawValue>)>);

impl<'de> Deserialize<'de> for Members {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct V;
        impl<'de> Visitor<'de> for V {
            type Value = Members;
            fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                f.write_str("a JSON object")
            }
            fn visit_map<A: MapAccess<'de>>(self, mut m: A) -> Result<Members, A::Error> {
                let mut out = Vec::new();
                while let Some(entry) = m.next_entry::<String, Box<RawValue>>()? {
                    out.push(entry);
                }
                Ok(Members(out))
            }
        }
        d.deserialize_map(V)
    }
}

/// What is written back: what the app did not change as its original text, the rest
/// re-serialized. So a user's entries (and mnemo's) come back byte for byte, in their order.
enum Node {
    Raw(Box<RawValue>),
    Val(Value),
    Obj(Vec<(String, Node)>),
    Arr(Vec<Node>),
}

impl Serialize for Node {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        match self {
            Node::Raw(r) => r.serialize(s),
            Node::Val(v) => v.serialize(s),
            Node::Obj(members) => {
                let mut map = s.serialize_map(Some(members.len()))?;
                for (k, v) in members {
                    map.serialize_entry(k, v)?;
                }
                map.end()
            }
            Node::Arr(items) => {
                let mut seq = s.serialize_seq(Some(items.len()))?;
                for v in items {
                    seq.serialize_element(v)?;
                }
                seq.end()
            }
        }
    }
}

/// One `hooks.<Event>` as read: its groups with ours taken out, when it is a list.
struct Event {
    name: String,
    raw: Box<RawValue>,
    groups: Option<Vec<Node>>,
    touched: bool,
}

/// Adds (`install`) or removes this build's hooks in the text of a `settings.json`. The new
/// text when anything changed, `None` when nothing had to. Every entry the app did not write
/// is written back as it was read; settings it does not understand are refused, not rewritten.
pub fn apply(text: &str, binary: &Path, mark: &str, install: bool) -> Result<Option<String>, String> {
    let top = match text.trim() {
        "" => Vec::new(),
        t => serde_json::from_str::<Members>(t).map_err(|e| format!("settings.json is not a JSON object: {e}"))?.0,
    };
    // Claude Code reads the last of duplicate keys; so do we.
    let at = top.iter().rposition(|(k, _)| k == "hooks");
    let members = match at {
        Some(i) => serde_json::from_str::<Members>(top[i].1.get()).map_err(|_| "settings.json has a `hooks` that is not an object".to_string())?.0,
        None => Vec::new(),
    };

    let mut ours: Vec<(String, Value)> = Vec::new();
    let mut events = Vec::new();
    for (name, raw) in members {
        let groups = match serde_json::from_str::<Vec<Box<RawValue>>>(raw.get()) {
            Ok(g) => g,
            Err(_) if known(&name) => return Err(format!("settings.json has a `hooks.{name}` that is not a list")),
            // Not an event of ours, and not ours to judge.
            Err(_) => {
                events.push(Event { name, raw, groups: None, touched: false });
                continue;
            }
        };
        let mut kept = Vec::new();
        let mut touched = false;
        for g in groups {
            let mut v: Value = serde_json::from_str(g.get()).map_err(|e| e.to_string())?;
            let inner: Vec<Value> = v.get("hooks").and_then(Value::as_array).cloned().unwrap_or_default();
            let (mine, theirs): (Vec<Value>, Vec<Value>) = inner.into_iter().partition(|h| owned(h, mark));
            if mine.is_empty() {
                kept.push(Node::Raw(g));
                continue;
            }
            touched = true;
            ours.extend(mine.into_iter().map(|h| (name.clone(), h)));
            // A group that held only ours goes; one of the user's keeps the rest of it.
            if !theirs.is_empty() {
                v["hooks"] = Value::Array(theirs);
                kept.push(Node::Val(v));
            }
        }
        events.push(Event { name, raw, groups: Some(kept), touched });
    }

    let in_place = EVENTS.iter().all(|(e, _)| {
        let mine: Vec<_> = ours.iter().filter(|(ev, _)| ev == e).collect();
        mine.len() == 1 && mine[0].1 == hook_entry(binary, e)
    }) && ours.iter().all(|(ev, _)| known(ev));
    if (install && in_place) || (!install && ours.is_empty()) {
        return Ok(None);
    }

    let group = |event: &str| Node::Val(json!({ "hooks": [hook_entry(binary, event)] }));
    let mut added = Vec::new();
    let mut hooks = Vec::new();
    for ev in events {
        let Some(mut groups) = ev.groups else {
            hooks.push((ev.name, Node::Raw(ev.raw)));
            continue;
        };
        let add = install && known(&ev.name) && !added.contains(&ev.name);
        if add {
            groups.push(group(&ev.name));
            added.push(ev.name.clone());
        }
        if !ev.touched && !add {
            hooks.push((ev.name, Node::Raw(ev.raw)));
        } else if !groups.is_empty() {
            hooks.push((ev.name, Node::Arr(groups)));
        }
    }
    if install {
        for (e, _) in EVENTS.iter().filter(|(e, _)| !added.iter().any(|a| a == e)) {
            hooks.push((e.to_string(), Node::Arr(vec![group(e)])));
        }
    }

    let mut root: Vec<(String, Node)> = Vec::new();
    let mut hooks = Some(Node::Obj(hooks));
    for (i, (k, v)) in top.into_iter().enumerate() {
        match Some(i) == at {
            true => root.push((k, hooks.take().expect("one hooks key"))),
            false => root.push((k, Node::Raw(v))),
        }
    }
    if let Some(h) = hooks {
        root.push(("hooks".into(), h));
    }
    Ok(Some(serde_json::to_string_pretty(&Node::Obj(root)).map_err(|e| e.to_string())? + "\n"))
}

/// Reads, edits and (only when something changed) atomically rewrites `path`. A missing
/// file is an empty one; one that is not JSON is left alone and reported.
pub fn apply_at(path: &Path, binary: &Path, mark: &str, install: bool) -> Result<bool, String> {
    // A dotfiles setup keeps the file as a symlink: write through it, never over it.
    let path = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let text = match std::fs::read_to_string(&path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            if !install {
                return Ok(false);
            }
            String::new()
        }
        Err(e) => return Err(format!("{}: {e}", path.display())),
    };
    let Some(body) = apply(&text, binary, mark, install).map_err(|e| format!("{}: {e}; left untouched", path.display()))? else {
        return Ok(false);
    };
    let dir = path.parent().ok_or_else(|| format!("{} has no parent", path.display()))?;
    std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let tmp = dir.join(format!(".settings.json.{}.tmp", std::process::id()));
    std::fs::write(&tmp, body).map_err(|e| format!("{}: {e}", tmp.display()))?;
    if let Ok(meta) = std::fs::metadata(&path) {
        let _ = std::fs::set_permissions(&tmp, meta.permissions());
    }
    std::fs::rename(&tmp, &path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("{}: {e}", path.display())
    })?;
    Ok(true)
}

/// A release build always may; a debug build only when asked to.
pub fn writes_allowed(debug: bool, dev_env: Option<&str>) -> bool {
    !debug || dev_env == Some("1")
}

fn guard() -> Result<(), String> {
    let env = std::env::var(DEV_ENV).ok();
    if writes_allowed(cfg!(debug_assertions), env.as_deref()) {
        Ok(())
    } else {
        Err(format!("a debug build leaves ~/.claude/settings.json alone; set {DEV_ENV}=1 to install its hooks"))
    }
}

// ---------------------------------------------------------------------------------------
// What the binary forwards: `{"event", "at", "input"}`, `input` being the fields it kept
// from Claude Code's stdin JSON.

/// `AgentEvent` in `src/agents/events.ts`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentEvent {
    pub session_id: String,
    pub cwd: String,
    pub kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    pub at: u64,
}

fn clip(s: &str, chars: usize) -> String {
    let s = s.trim();
    match s.char_indices().nth(chars) {
        Some((i, _)) => format!("{}…", s[..i].trim_end()),
        None => s.to_string(),
    }
}

/// One forwarded line as an event, or `None` for anything that is not one of ours. `now`
/// stands in for a missing timestamp.
pub fn parse_line(line: &str, now: u64) -> Option<AgentEvent> {
    let v: Value = serde_json::from_str(line).ok()?;
    let input = v.get("input").filter(|i| i.is_object());
    let field = |k: &str| input.and_then(|i| i.get(k)).and_then(Value::as_str).filter(|s| !s.is_empty());
    let name = v.get("event").and_then(Value::as_str).filter(|s| !s.is_empty()).or_else(|| field("hook_event_name"))?;
    let kind = EVENTS.iter().find(|(e, _)| *e == name)?.1;
    let session_id = field("session_id")?.to_string();
    let message = match kind {
        "notification" => field("message").map(|m| clip(m, 1000)),
        "prompt" => field("prompt").map(|p| clip(p, PROMPT_CHARS)).filter(|p| !p.is_empty()),
        _ => None,
    };
    Some(AgentEvent {
        session_id,
        cwd: field("cwd").unwrap_or_default().to_string(),
        kind,
        message,
        at: v.get("at").and_then(Value::as_u64).unwrap_or(now),
    })
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Receives each event: the webview in the app, a channel in tests.
pub type Sink = std::sync::Arc<dyn Fn(AgentEvent) + Send + Sync>;

/// Binds `path`, replacing a socket left by an earlier (or still running) app: the app
/// started last hears the hooks, as `mcp::bind` does for its own socket.
#[cfg(unix)]
pub fn bind(path: &Path) -> Result<std::os::unix::net::UnixListener, String> {
    use std::os::unix::fs::PermissionsExt;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    }
    if std::fs::symlink_metadata(path).is_ok() {
        std::fs::remove_file(path).map_err(|e| format!("{}: {e}", path.display()))?;
    }
    let listener = std::os::unix::net::UnixListener::bind(path).map_err(|e| format!("{}: {e}", path.display()))?;
    // Other local users must not feed this user's agent state.
    let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    Ok(listener)
}

/// One line per connection; the hook never waits for an answer.
#[cfg(unix)]
pub fn serve(listener: std::os::unix::net::UnixListener, sink: Sink) {
    use std::io::{BufRead, BufReader, Read};
    for stream in listener.incoming() {
        let Ok(stream) = stream else { continue };
        let sink = sink.clone();
        std::thread::spawn(move || {
            let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(2)));
            let mut line = String::new();
            if BufReader::new(stream.take(MAX_LINE)).read_line(&mut line).is_ok() {
                if let Some(e) = parse_line(&line, now_ms()) {
                    sink(e);
                }
            }
        });
    }
}

// ---------------------------------------------------------------------------------------
// The app's side: the listener and the launch install, both from `.setup(…)`.

/// Called once from `.setup(…)`: the notification plugin, the socket, and (a release build,
/// unless the user uninstalled) the hooks.
pub fn start<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    app.plugin(tauri_plugin_notification::init()).map_err(|e| e.to_string())?;
    if std::env::var_os("MNEMO_DESKTOP_SMOKE").is_some() {
        return Ok(());
    }
    listen(app.clone());
    if guard().is_ok() && !app_dir().join(OFF_MARKER).exists() {
        std::thread::spawn(|| {
            if let Err(e) = install() {
                log::warn!("agent hooks: not installed: {e}");
            }
        });
    }
    Ok(())
}

#[cfg(unix)]
fn listen<R: Runtime>(app: AppHandle<R>) {
    let listener = match bind(&socket_path()) {
        Ok(l) => l,
        Err(e) => return log::warn!("agent hooks: not listening: {e}"),
    };
    let sink: Sink = std::sync::Arc::new(move |e: AgentEvent| {
        let _ = app.emit_to(MAIN, EVENT, e);
    });
    if let Err(e) = std::thread::Builder::new().name("agent-hooks".into()).spawn(move || serve(listener, sink)) {
        log::warn!("agent hooks: not listening: {e}");
    }
}

#[cfg(not(unix))]
fn listen<R: Runtime>(_app: AppHandle<R>) {
    log::warn!("agent hooks: not listening: the hook socket needs unix sockets");
}

#[cfg(unix)]
fn install() -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let built = exe.with_file_name(BIN_NAME);
    if !built.is_file() {
        return Err(format!("{} is missing (cargo build --bin {BIN_NAME})", built.display()));
    }
    let stable = stable_binary();
    crate::mcp::relink(&built, &stable)?;
    if apply_at(&claude_settings(), &stable, &owner_mark(NAME), true)? {
        log::info!("agent hooks: installed into {}", claude_settings().display());
    }
    Ok(())
}

#[cfg(not(unix))]
fn install() -> Result<(), String> {
    Err("agent hooks need unix sockets".into())
}

/// Writes (or refreshes) the app's hooks in the user's Claude settings, and lets the app
/// keep them there at each start.
#[tauri::command]
pub fn agent_hooks_install() -> Result<(), String> {
    guard()?;
    install()?;
    let _ = std::fs::remove_file(app_dir().join(OFF_MARKER));
    Ok(())
}

/// Removes the app's hooks, and only them, and keeps the app from putting them back.
#[tauri::command]
pub fn agent_hooks_uninstall() -> Result<(), String> {
    guard()?;
    apply_at(&claude_settings(), &stable_binary(), &owner_mark(NAME), false)?;
    let dir = app_dir();
    std::fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    std::fs::write(dir.join(OFF_MARKER), "").map_err(|e| e.to_string())
}

/// A native OS notification. When to send one is the caller's call.
#[tauri::command]
pub fn agent_notify<R: Runtime>(app: AppHandle<R>, title: String, body: String) -> Result<(), String> {
    let n = app
        .try_state::<tauri_plugin_notification::Notification<R>>()
        .ok_or("notifications are not set up")?;
    n.builder().title(title).body(body).show().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const BIN: &str = "/Users/me/.mnemo-desktop/bin/mnemo-desktop-hook";

    fn mark() -> String {
        owner_mark(crate::app_dir::RELEASE)
    }

    fn install(text: &str) -> Option<String> {
        apply(text, Path::new(BIN), &mark(), true).unwrap()
    }

    fn uninstall(text: &str) -> Option<String> {
        apply(text, Path::new(BIN), &mark(), false).unwrap()
    }

    fn parse(text: &str) -> Value {
        serde_json::from_str(text).unwrap()
    }

    fn keys(text: &str) -> Vec<String> {
        serde_json::from_str::<Members>(text).unwrap().0.into_iter().map(|(k, _)| k).collect()
    }

    /// mnemo's own hooks and a user's, as a real settings.json holds them: two-space pretty
    /// JSON in the order its writers chose, and one group the user wrote on a single line.
    const THEIRS: &str = r#"{
  "model": "opus",
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "python3 -m mnemo.hooks.session_start"
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Bash|Read|Edit|Write|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "python3 -m mnemo.hooks.pre_tool_use"
          }
        ]
      }
    ],
    "Stop": [
      {"hooks": [{"type": "command", "command": "say done"}]}
    ]
  },
  "permissions": {
    "allow": [
      "Bash(ls:*)"
    ]
  }
}
"#;

    #[test]
    fn install_adds_one_entry_per_event_after_theirs() {
        let v = parse(&install(THEIRS).unwrap());
        let theirs = parse(THEIRS);
        for (event, _) in EVENTS {
            let groups = v["hooks"][event].as_array().unwrap();
            let last = &groups.last().unwrap()["hooks"][0];
            assert_eq!(last["command"], format!("'{BIN}' {event} 2>/dev/null || true"));
            assert_eq!(last["timeout"], TIMEOUT_SECS);
        }
        assert_eq!(v["hooks"]["SessionStart"][0], theirs["hooks"]["SessionStart"][0]);
        assert_eq!(v["hooks"]["Stop"][0], theirs["hooks"]["Stop"][0]);
        assert_eq!(v["hooks"]["PreToolUse"], theirs["hooks"]["PreToolUse"]);
        assert_eq!((&v["model"], &v["permissions"]), (&theirs["model"], &theirs["permissions"]));
    }

    #[test]
    fn install_is_idempotent_and_uninstall_gives_back_their_file_byte_for_byte() {
        let once = install(THEIRS).unwrap();
        assert_eq!(install(&once), None);
        assert_eq!(uninstall(&once).unwrap(), THEIRS);
        assert_eq!(uninstall(THEIRS), None);
    }

    #[test]
    fn what_the_app_did_not_write_keeps_its_text_and_its_order() {
        let out = install(THEIRS).unwrap();
        assert!(out.contains(r#"{"hooks": [{"type": "command", "command": "say done"}]}"#));
        assert!(out.contains("\"allow\": [\n      \"Bash(ls:*)\"\n    ]"));
        assert_eq!(keys(&out), ["model", "hooks", "permissions"]);
        let hooks = serde_json::from_str::<Members>(&out).unwrap().0.into_iter().find(|(k, _)| k == "hooks").unwrap().1;
        assert_eq!(keys(hooks.get()), ["SessionStart", "PreToolUse", "Stop", "UserPromptSubmit", "Notification", "SessionEnd"]);
    }

    #[test]
    fn install_repairs_a_stale_or_moved_entry_of_ours_and_only_ours() {
        let mut v = parse(THEIRS);
        // An old install from another home, and one tucked into each of two user groups.
        v["hooks"]["Stop"].as_array_mut().unwrap().push(json!({ "hooks": [{ "type": "command", "command": "'/old/home/.mnemo-desktop/bin/mnemo-desktop-hook' Stop" }] }));
        v["hooks"]["Stop"][0]["hooks"].as_array_mut().unwrap().push(json!({ "type": "command", "command": format!("'{BIN}' Stop") }));
        v["hooks"]["PreToolUse"][0]["hooks"].as_array_mut().unwrap().push(json!({ "type": "command", "command": format!("'{BIN}' PreToolUse") }));
        let out = install(&v.to_string()).unwrap();
        let (v, theirs) = (parse(&out), parse(THEIRS));
        assert_eq!(v["hooks"]["Stop"].as_array().unwrap().len(), 2);
        assert_eq!(v["hooks"]["Stop"][0], theirs["hooks"]["Stop"][0]);
        assert_eq!(v["hooks"]["PreToolUse"], theirs["hooks"]["PreToolUse"]);
        assert_eq!(install(&out), None);
    }

    #[test]
    fn a_changed_binary_path_is_rewritten() {
        let old = apply(THEIRS, Path::new("/elsewhere/.mnemo-desktop/bin/mnemo-desktop-hook"), &mark(), true).unwrap().unwrap();
        let out = install(&old).unwrap();
        assert!(out.contains(BIN) && !out.contains("/elsewhere/"));
    }

    #[test]
    fn the_other_builds_entries_are_left_alone() {
        let dev = "'/Users/me/.mnemo-desktop-dev/bin/mnemo-desktop-hook' Stop 2>/dev/null || true";
        let text = json!({ "hooks": { "Stop": [{ "hooks": [{ "type": "command", "command": dev }] }] } }).to_string();
        let out = uninstall(&install(&text).unwrap()).unwrap();
        assert_eq!(parse(&out)["hooks"]["Stop"][0]["hooks"][0]["command"], dev);
        assert!(!owned(&json!({ "command": dev }), &mark()));
        assert!(owned(&json!({ "command": dev }), &owner_mark(crate::app_dir::DEBUG)));
    }

    #[test]
    fn empty_settings_gain_hooks_and_lose_them_again() {
        for empty in ["", "  \n", "{}"] {
            let out = install(empty).unwrap();
            assert_eq!(parse(&out)["hooks"].as_object().unwrap().len(), EVENTS.len());
            assert_eq!(parse(&uninstall(&out).unwrap()), json!({ "hooks": {} }));
        }
        // A user's empty group and a user's event we do not know are theirs: kept as they are.
        let text = r#"{"hooks": {"Stop": [{"hooks": []}], "Weird": 1}}"#;
        let back = uninstall(&install(text).unwrap()).unwrap();
        assert_eq!(parse(&back), parse(text));
    }

    #[test]
    fn settings_it_does_not_understand_are_refused() {
        let b = Path::new(BIN);
        for text in ["[]", "3", "{ // comment\n}", r#"{"hooks": []}"#, r#"{"hooks": {"Stop": {}}}"#] {
            assert!(apply(text, b, &mark(), true).is_err(), "{text}");
        }
    }

    #[test]
    fn the_command_is_quoted_and_cannot_fail() {
        assert_eq!(hook_command(Path::new("/a b/it's"), "Stop"), r"'/a b/it'\''s' Stop 2>/dev/null || true");
    }

    #[test]
    fn a_debug_build_writes_only_when_asked() {
        assert!(writes_allowed(false, None));
        assert!(!writes_allowed(true, None));
        assert!(!writes_allowed(true, Some("0")));
        assert!(writes_allowed(true, Some("1")));
    }

    #[cfg(unix)]
    #[test]
    fn the_file_is_rewritten_only_on_change_through_a_symlink_and_never_when_unparseable() {
        let dir = crate::testutil::temp_dir("hooks-file");
        let (real, link) = (dir.join("dotfiles-settings.json"), dir.join("settings.json"));
        std::fs::write(&real, THEIRS).unwrap();
        std::os::unix::fs::symlink(&real, &link).unwrap();
        let b = Path::new(BIN);
        assert!(apply_at(&link, b, &mark(), true).unwrap());
        assert!(std::fs::symlink_metadata(&link).unwrap().file_type().is_symlink());
        let after = std::fs::read_to_string(&real).unwrap();
        assert!(after.contains("mnemo.hooks.session_start") && after.contains(BIN));
        assert!(!apply_at(&link, b, &mark(), true).unwrap());
        assert!(apply_at(&link, b, &mark(), false).unwrap());
        assert_eq!(std::fs::read_to_string(&real).unwrap(), THEIRS);

        std::fs::write(&real, "{ // not json").unwrap();
        assert!(apply_at(&link, b, &mark(), true).unwrap_err().contains("left untouched"));
        assert_eq!(std::fs::read_to_string(&real).unwrap(), "{ // not json");

        let missing = dir.join("none/settings.json");
        assert!(!apply_at(&missing, b, &mark(), false).unwrap());
        assert!(!missing.exists());
        assert!(apply_at(&missing, b, &mark(), true).unwrap());
        let leftovers: Vec<_> = std::fs::read_dir(dir.join("none")).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(leftovers, ["settings.json"]);
        let _ = std::fs::remove_dir_all(dir);
    }

    fn line(event: &str, input: Value) -> String {
        json!({ "event": event, "at": 42, "input": input }).to_string()
    }

    #[test]
    fn each_event_maps_to_its_kind() {
        for (event, kind) in EVENTS {
            let e = parse_line(&line(event, json!({ "session_id": "s1", "cwd": "/r" })), 7).unwrap();
            assert_eq!((e.kind, e.session_id.as_str(), e.cwd.as_str(), e.at), (*kind, "s1", "/r", 42));
        }
    }

    #[test]
    fn notification_and_prompt_carry_a_message_and_nothing_else_does() {
        let n = parse_line(&line("Notification", json!({ "session_id": "s", "message": "Claude needs your permission to use Bash" })), 0).unwrap();
        assert_eq!(n.message.as_deref(), Some("Claude needs your permission to use Bash"));
        let long = "x".repeat(PROMPT_CHARS + 50);
        let p = parse_line(&line("UserPromptSubmit", json!({ "session_id": "s", "prompt": format!("  {long}  ") })), 0).unwrap();
        assert_eq!(p.message.unwrap(), format!("{}…", "x".repeat(PROMPT_CHARS)));
        let s = parse_line(&line("Stop", json!({ "session_id": "s", "message": "ignored", "prompt": "ignored" })), 0).unwrap();
        assert_eq!(s.message, None);
    }

    #[test]
    fn what_is_not_an_event_of_ours_is_dropped() {
        assert_eq!(parse_line("not json", 0), None);
        assert_eq!(parse_line(&line("PreToolUse", json!({ "session_id": "s" })), 0), None);
        assert_eq!(parse_line(&line("Stop", json!({ "cwd": "/r" })), 0), None);
        assert_eq!(parse_line(&line("Stop", json!("s")), 0), None);
        // The event name may come from Claude's own payload, and a missing time is now.
        let e = parse_line(&json!({ "input": { "hook_event_name": "SessionEnd", "session_id": "s" } }).to_string(), 9).unwrap();
        assert_eq!((e.kind, e.at, e.cwd.as_str()), ("end", 9, ""));
    }

    #[test]
    fn the_event_serializes_as_the_front_types_it() {
        let e = AgentEvent { session_id: "s".into(), cwd: "/r".into(), kind: "stop", message: None, at: 1 };
        assert_eq!(serde_json::to_value(&e).unwrap(), json!({ "sessionId": "s", "cwd": "/r", "kind": "stop", "at": 1 }));
    }

    #[test]
    fn the_hook_binary_spells_out_what_it_shares_with_the_app() {
        // It links nothing of the app, so it keeps its own copies of these.
        let bin = include_str!("bin/mnemo-desktop-hook.rs");
        for s in [crate::app_dir::DEBUG, crate::app_dir::RELEASE, SOCKET_ENV, "agent-hooks.sock"] {
            assert!(bin.contains(&format!("\"{s}\"")), "the hook binary lost {s}");
        }
        assert!(socket_path().ends_with("agent-hooks.sock"));
        assert!(stable_binary().ends_with(format!("{NAME}/bin/{BIN_NAME}")));
    }

    #[cfg(unix)]
    #[test]
    fn the_socket_hands_each_line_to_the_sink() {
        use std::io::Write;
        use std::os::unix::fs::PermissionsExt;
        // Short names: a socket path must fit in sun_path, and macOS's temp dir is long.
        let dir = crate::testutil::temp_dir("hs");
        let path = dir.join("h.sock");
        std::fs::write(&path, "stale").unwrap();
        let listener = bind(&path).unwrap();
        assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
        let (tx, rx) = std::sync::mpsc::channel();
        let tx = std::sync::Mutex::new(tx);
        std::thread::spawn(move || serve(listener, std::sync::Arc::new(move |e| tx.lock().unwrap().send(e).unwrap())));
        for l in ["garbage", &line("Stop", json!({ "session_id": "s2", "cwd": "/w" }))] {
            let mut s = std::os::unix::net::UnixStream::connect(&path).unwrap();
            writeln!(s, "{l}").unwrap();
        }
        let e = rx.recv_timeout(std::time::Duration::from_secs(5)).unwrap();
        assert_eq!((e.session_id.as_str(), e.kind), ("s2", "stop"));
        assert!(rx.recv_timeout(std::time::Duration::from_millis(200)).is_err());
        let _ = std::fs::remove_dir_all(dir);
    }
}

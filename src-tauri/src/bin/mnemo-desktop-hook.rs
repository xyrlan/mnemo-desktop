//! `mnemo-desktop-hook <Event>`: the Claude Code hook command the app writes into
//! `~/.claude/settings.json` for `SessionStart`, `UserPromptSubmit`, `Stop`, `Notification`
//! and `SessionEnd` (see `src/agent_hooks.rs`).
//!
//! It reads the event's JSON from stdin, keeps the few fields the app reads, and sends them
//! to the running app over `~/.mnemo-desktop/agent-hooks.sock` as one JSON line, without
//! waiting for an answer. Claude waits on every hook, so this one never costs it anything:
//! it prints nothing (a `SessionStart` or `UserPromptSubmit` hook's stdout would land in the
//! model's context), always exits 0 (a `Stop` hook's exit 2 would keep Claude going), gives
//! up after `DEADLINE` whatever it is stuck on, and is silent when the app is closed. Like
//! `mnemo-desktop-mcp` it links nothing of the app: std and serde_json only.

use std::io::Read;
use std::path::PathBuf;
use std::time::Duration;

use serde_json::{json, Map, Value};

/// Keep in step with `mnemo_desktop_lib::agent_hooks::SOCKET_ENV`.
const SOCKET_ENV: &str = "MNEMO_DESKTOP_HOOK_SOCKET";
/// Keep in step with `mnemo_desktop_lib::app_dir::NAME`: the settings name this build's own
/// binary, so the socket is this build's app dir's.
const APP_DIR: &str = if cfg!(debug_assertions) { ".mnemo-desktop-dev" } else { ".mnemo-desktop" };
const SOCKET: &str = "agent-hooks.sock";
/// The whole run, stdin included; Claude's own timeout for the hook is longer.
const DEADLINE: Duration = Duration::from_millis(1500);
const SEND_TIMEOUT: Duration = Duration::from_millis(500);
/// More stdin than any event we forward needs (a prompt can be a long paste).
const MAX_INPUT: u64 = 1024 * 1024;
/// A prompt is cut to this many characters on the way; the app shortens it again.
const MAX_PROMPT: usize = 1000;
/// The fields of Claude's payload the app reads.
const KEEP: &[&str] = &["session_id", "cwd", "hook_event_name", "message", "prompt"];

fn socket_path() -> PathBuf {
    socket_path_from(std::env::var_os(SOCKET_ENV), std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }))
}

fn socket_path_from(exported: Option<std::ffi::OsString>, home: Option<std::ffi::OsString>) -> PathBuf {
    match exported.filter(|p| !p.is_empty()) {
        Some(p) => PathBuf::from(p),
        None => home.map(PathBuf::from).unwrap_or_default().join(APP_DIR).join(SOCKET),
    }
}

/// The line sent to the app for `event` and Claude's raw stdin.
fn envelope(event: &str, stdin: &[u8], at: u64) -> String {
    let input = match serde_json::from_slice::<Value>(stdin) {
        Ok(Value::Object(all)) => {
            let mut kept = Map::new();
            for key in KEEP {
                if let Some(Value::String(s)) = all.get(*key) {
                    let s = match *key {
                        "prompt" => s.chars().take(MAX_PROMPT).collect(),
                        _ => s.clone(),
                    };
                    kept.insert((*key).to_string(), Value::String(s));
                }
            }
            Value::Object(kept)
        }
        _ => Value::Null,
    };
    json!({ "event": event, "at": at, "input": input }).to_string()
}

#[cfg(unix)]
fn send(line: &str) {
    use std::io::Write;
    // No listener: connect fails at once (the file is missing, or nobody accepts on it).
    let Ok(mut stream) = std::os::unix::net::UnixStream::connect(socket_path()) else { return };
    let _ = stream.set_write_timeout(Some(SEND_TIMEOUT));
    let _ = writeln!(stream, "{line}");
}

#[cfg(not(unix))]
fn send(_line: &str) {}

fn main() {
    std::thread::spawn(|| {
        std::thread::sleep(DEADLINE);
        std::process::exit(0);
    });
    let event = std::env::args().nth(1).unwrap_or_default();
    let mut stdin = Vec::new();
    let _ = std::io::stdin().take(MAX_INPUT).read_to_end(&mut stdin);
    let at = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
    send(&envelope(&event, &stdin, at));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_socket_is_the_exported_one_or_this_builds_app_dir() {
        assert_eq!(socket_path_from(Some("/x/h.sock".into()), Some("/home/u".into())), PathBuf::from("/x/h.sock"));
        assert_eq!(socket_path_from(Some("".into()), Some("/home/u".into())), PathBuf::from("/home/u/.mnemo-desktop-dev/agent-hooks.sock"));
    }

    #[test]
    fn only_the_fields_the_app_reads_travel_and_a_prompt_is_cut() {
        let stdin = json!({
            "session_id": "s", "cwd": "/r", "hook_event_name": "UserPromptSubmit",
            "transcript_path": "/t.jsonl", "prompt": "é".repeat(MAX_PROMPT + 10), "permission_mode": "default"
        });
        let v: Value = serde_json::from_str(&envelope("UserPromptSubmit", stdin.to_string().as_bytes(), 5)).unwrap();
        assert_eq!(v["event"], "UserPromptSubmit");
        assert_eq!(v["at"], 5);
        let input = v["input"].as_object().unwrap();
        let mut keys: Vec<_> = input.keys().map(String::as_str).collect();
        keys.sort_unstable();
        assert_eq!(keys, ["cwd", "hook_event_name", "prompt", "session_id"]);
        assert_eq!(input["prompt"].as_str().unwrap().chars().count(), MAX_PROMPT);
    }

    #[test]
    fn stdin_that_is_not_an_object_travels_as_null() {
        for raw in [&b""[..], b"not json", b"[1]"] {
            let v: Value = serde_json::from_str(&envelope("Stop", raw, 1)).unwrap();
            assert_eq!(v["input"], Value::Null);
        }
    }
}

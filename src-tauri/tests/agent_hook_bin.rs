//! The real `mnemo-desktop-hook` binary, run as Claude Code runs it, against the app's socket
//! (`src/agent_hooks.rs`): what it forwards, and that it never costs Claude anything.

#![cfg(unix)]

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use mnemo_desktop_lib::agent_hooks::{self, AgentEvent, SOCKET_ENV};

const BIN: &str = env!("CARGO_BIN_EXE_mnemo-desktop-hook");

fn scratch(tag: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
    // Short: a socket path must fit in ~104 bytes.
    let d = std::env::temp_dir().join(format!("mdh-{tag}-{nanos:x}"));
    std::fs::create_dir_all(&d).unwrap();
    d
}

/// Runs the hook for `event` with `stdin` (or with stdin left open when `None`) against
/// `socket`; its exit code, stdout, stderr and how long it took.
fn run(socket: &Path, event: &str, stdin: Option<&str>) -> (Option<i32>, Vec<u8>, Vec<u8>, Duration) {
    let start = Instant::now();
    let mut child = Command::new(BIN)
        .arg(event)
        .env(SOCKET_ENV, socket)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let mut pipe = child.stdin.take().unwrap();
    if let Some(s) = stdin {
        pipe.write_all(s.as_bytes()).unwrap();
        drop(pipe);
        let out = child.wait_with_output().unwrap();
        return (out.status.code(), out.stdout, out.stderr, start.elapsed());
    }
    let out = child.wait_with_output().unwrap();
    drop(pipe);
    (out.status.code(), out.stdout, out.stderr, start.elapsed())
}

#[test]
fn an_event_reaches_the_app_and_the_hook_prints_nothing() {
    let dir = scratch("ok");
    let socket = dir.join("h.sock");
    let listener = agent_hooks::bind(&socket).unwrap();
    let (tx, rx) = mpsc::channel::<AgentEvent>();
    let tx = std::sync::Mutex::new(tx);
    std::thread::spawn(move || agent_hooks::serve(listener, std::sync::Arc::new(move |e| tx.lock().unwrap().send(e).unwrap())));

    let before = agent_hooks::now_ms();
    let payload = r#"{"session_id":"abc","cwd":"/repo","hook_event_name":"Notification","message":"Claude is waiting for your input","transcript_path":"/t"}"#;
    let (code, out, err, _) = run(&socket, "Notification", Some(payload));
    assert_eq!(code, Some(0));
    assert!(out.is_empty() && err.is_empty(), "stdout {out:?} stderr {err:?}");
    let e = rx.recv_timeout(Duration::from_secs(5)).unwrap();
    assert_eq!((e.session_id.as_str(), e.cwd.as_str(), e.kind), ("abc", "/repo", "notification"));
    assert_eq!(e.message.as_deref(), Some("Claude is waiting for your input"));
    assert!(e.at >= before && e.at <= agent_hooks::now_ms());

    let (code, out, _, _) = run(&socket, "Stop", Some(r#"{"session_id":"abc","cwd":"/repo","stop_hook_active":false}"#));
    assert_eq!((code, out.len()), (Some(0), 0));
    assert_eq!(rx.recv_timeout(Duration::from_secs(5)).unwrap().kind, "stop");
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn with_the_app_closed_it_exits_0_at_once_and_silently() {
    let dir = scratch("closed");
    for socket in [dir.join("missing.sock"), {
        // A socket file nobody listens on any more, as a crashed app leaves it.
        let p = dir.join("dead.sock");
        drop(std::os::unix::net::UnixListener::bind(&p).unwrap());
        p
    }] {
        let (code, out, err, took) = run(&socket, "SessionStart", Some(r#"{"session_id":"s","cwd":"/r"}"#));
        assert_eq!(code, Some(0));
        assert!(out.is_empty() && err.is_empty());
        assert!(took < Duration::from_millis(1000), "took {took:?}");
    }
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn garbage_on_stdin_still_exits_0_silently() {
    let dir = scratch("junk");
    let (code, out, err, _) = run(&dir.join("none.sock"), "", Some("\u{0}not json"));
    assert_eq!(code, Some(0));
    assert!(out.is_empty() && err.is_empty());
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn a_stdin_that_never_closes_cannot_hold_claude_up() {
    let dir = scratch("stuck");
    let (code, out, _, took) = run(&dir.join("none.sock"), "Stop", None);
    assert_eq!(code, Some(0));
    assert!(out.is_empty());
    assert!(took < Duration::from_secs(4), "took {took:?}");
    let _ = std::fs::remove_dir_all(dir);
}

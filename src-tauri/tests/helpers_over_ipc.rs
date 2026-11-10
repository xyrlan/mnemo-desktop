//! The real helper binaries against the app's own sockets, as Claude Code runs them, on every
//! system: `mnemo-desktop-mcp` over stdio and as `call`, and on Windows `mnemo-desktop-hook`
//! (its macOS and Linux runs are in `agent_hook_bin.rs`). Two processes and the transport of
//! `src/ipc.rs` between them, which no unit test has: a helper is a program of its own that
//! includes that file by path.

use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;

use mnemo_desktop_lib::mcp;
use serde_json::{json, Value};

const MCP: &str = env!("CARGO_BIN_EXE_mnemo-desktop-mcp");

/// One test at a time. On Windows a process started while another test starts one inherits
/// that one's output pipes, and holds them open for as long as it runs: a hook that left in
/// ten milliseconds would look as if it had taken the second and a half of the hook started
/// beside it.
fn alone() -> std::sync::MutexGuard<'static, ()> {
    static ONE: std::sync::Mutex<()> = std::sync::Mutex::new(());
    ONE.lock().unwrap_or_else(|e| e.into_inner())
}

fn scratch(tag: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
    // Short: a Unix socket's path must fit in ~104 bytes.
    let d = std::env::temp_dir().join(format!("mdi-{tag}-{nanos:x}"));
    std::fs::create_dir_all(&d).unwrap();
    d
}

/// An app serving its MCP socket at `path`: every tool answers with its own name and arguments.
fn app(path: &Path) {
    let listener = mcp::bind(path).unwrap();
    let ask: mcp::Asker = std::sync::Arc::new(|method: &str, params: Value| match params.get("pane").and_then(Value::as_i64) {
        Some(-1) => Err("no session has pane -1".into()),
        _ => Ok(json!([{ "type": "text", "text": format!("{method} {params}") }])),
    });
    std::thread::spawn(move || mcp::serve(listener, ask));
}

/// `mnemo-desktop-mcp <args>` against the app at `socket`: exit code, stdout, stderr.
fn mcp_bin(socket: &Path, args: &[&str]) -> (Option<i32>, String, String) {
    let out = Command::new(MCP).args(args).env(mcp::SOCKET_ENV, socket).stdin(Stdio::null()).output().unwrap();
    (out.status.code(), String::from_utf8_lossy(&out.stdout).into_owned(), String::from_utf8_lossy(&out.stderr).into_owned())
}

/// The lines a child prints, each as it comes; a test waits for one with a limit.
fn lines_of(child: &mut Child) -> mpsc::Receiver<String> {
    let stdout = child.stdout.take().unwrap();
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if tx.send(line).is_err() {
                break;
            }
        }
    });
    rx
}

fn next(lines: &mpsc::Receiver<String>) -> Value {
    let line = lines.recv_timeout(Duration::from_secs(20)).expect("an answer from the server");
    serde_json::from_str(&line).unwrap_or_else(|e| panic!("{line:?}: {e}"))
}

#[test]
fn one_call_reaches_the_app_and_prints_its_answer() {
    let _alone = alone();
    let dir = scratch("call");
    let socket = dir.join("mcp.sock");
    app(&socket);
    let (code, out, err) = mcp_bin(&socket, &["call", "desktop_terminal_read", r#"{"pane":3,"lines":5}"#]);
    assert_eq!((code, err.as_str()), (Some(0), ""));
    assert_eq!(serde_json::from_str::<Value>(&out).unwrap(), json!(r#"desktop_terminal_read {"lines":5,"pane":3}"#));

    // What the app refuses comes back as the failure it is.
    let (code, out, err) = mcp_bin(&socket, &["call", "desktop_terminal_read", r#"{"pane":-1}"#]);
    assert_eq!((code, out.as_str()), (Some(1), ""));
    assert!(err.contains("no session has pane -1"), "{err}");
    let _ = std::fs::remove_dir_all(dir);
}

/// What a Claude Code session does with the server it started: initialize, list, call, again.
#[test]
fn a_session_lists_and_calls_the_tools_over_stdio() {
    let _alone = alone();
    let dir = scratch("stdio");
    let socket = dir.join("mcp.sock");
    app(&socket);
    let mut server = Command::new(MCP).env(mcp::SOCKET_ENV, &socket).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap();
    let mut stdin = server.stdin.take().unwrap();
    let lines = lines_of(&mut server);
    let mut send = |v: Value| writeln!(stdin, "{v}").unwrap();

    send(json!({ "jsonrpc": "2.0", "id": 0, "method": "initialize", "params": { "protocolVersion": "2025-06-18", "capabilities": {} } }));
    let hello = next(&lines);
    assert_eq!(hello["result"]["serverInfo"]["name"], "mnemo-desktop", "{hello}");
    send(json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }));

    send(json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list" }));
    let tools: Vec<String> = next(&lines)["result"]["tools"].as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap().to_owned()).collect();
    assert!(tools.contains(&"desktop_list_panes".to_owned()) && tools.contains(&"desktop_terminal_read".to_owned()), "{tools:?}");

    // Each call is a connection of its own to the app, one after the other.
    for pane in [1, 2, 3] {
        send(json!({ "jsonrpc": "2.0", "id": 10 + pane, "method": "tools/call", "params": { "name": "desktop_terminal_read", "arguments": { "pane": pane } } }));
        let answer = next(&lines);
        assert_eq!(answer["id"], 10 + pane);
        assert_eq!(answer["result"]["content"][0]["text"], format!(r#"desktop_terminal_read {{"pane":{pane}}}"#), "{answer}");
    }
    send(json!({ "jsonrpc": "2.0", "id": 20, "method": "tools/call", "params": { "name": "desktop_terminal_read", "arguments": { "pane": -1 } } }));
    let refused = next(&lines);
    assert_eq!((refused["result"]["isError"].as_bool(), refused["result"]["content"][0]["text"].as_str()), (Some(true), Some("no session has pane -1")));

    // Claude Code ends a server by closing its stdin.
    drop(stdin);
    let out = server.wait_with_output().unwrap();
    assert_eq!(out.status.code(), Some(0));
    assert_eq!(String::from_utf8_lossy(&out.stderr), "", "a server that works says nothing on stderr");
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn with_the_app_closed_a_call_says_so_and_a_session_still_starts() {
    let _alone = alone();
    let dir = scratch("closed");
    for socket in [dir.join("missing.sock"), {
        // A socket nobody listens on any more, as a crashed app leaves it.
        let p = dir.join("dead.sock");
        drop(mcp::bind(&p).unwrap());
        p
    }] {
        let (code, out, err) = mcp_bin(&socket, &["call", "desktop_list_panes"]);
        assert_eq!((code, out.as_str()), (Some(1), ""), "{err}");
        assert!(err.contains("the mnemo desktop app is not running"), "{err}");

        // Over stdio the server answers, and the tool's result is the reason.
        let mut server = Command::new(MCP).env(mcp::SOCKET_ENV, &socket).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().unwrap();
        let mut stdin = server.stdin.take().unwrap();
        let lines = lines_of(&mut server);
        writeln!(stdin, "{}", json!({ "id": 0, "method": "initialize" })).unwrap();
        assert!(next(&lines)["result"].is_object());
        writeln!(stdin, "{}", json!({ "id": 1, "method": "tools/call", "params": { "name": "desktop_list_panes" } })).unwrap();
        let answer = next(&lines);
        assert_eq!(answer["result"]["isError"], true, "{answer}");
        assert!(answer["result"]["content"][0]["text"].as_str().unwrap().contains("not running"), "{answer}");
        drop(stdin);
        assert_eq!(server.wait().unwrap().code(), Some(0));
    }
    let _ = std::fs::remove_dir_all(dir);
}

/// The stable path a registration names holds a copy on Windows (`mcp::relink`). A session
/// holds that copy open for as long as it runs, and the next build's start must still put its
/// own in place, without ending the session's server.
#[cfg(windows)]
#[test]
fn a_helper_a_session_is_running_is_replaced_and_runs_on() {
    let _alone = alone();
    let dir = scratch("running");
    let stable = dir.join("bin").join("mnemo-desktop-mcp.exe");
    let in_bin = || {
        let mut names: Vec<String> = std::fs::read_dir(dir.join("bin")).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        names.sort();
        names
    };
    mcp::relink(Path::new(MCP), &stable).unwrap();
    let mut server = Command::new(&stable).env(mcp::SOCKET_ENV, dir.join("none.sock")).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().unwrap();
    let mut stdin = server.stdin.take().unwrap();
    let lines = lines_of(&mut server);
    let mut ping = |id: u32| {
        writeln!(stdin, "{}", json!({ "id": id, "method": "ping" })).unwrap();
        assert_eq!(next(&lines), json!({ "jsonrpc": "2.0", "id": id, "result": {} }));
    };
    ping(1);

    // Another build: any other program will do for its bytes.
    let next_build = env!("CARGO_BIN_EXE_mnemo-desktop-hook");
    mcp::relink(Path::new(next_build), &stable).unwrap();
    assert_eq!(std::fs::read(&stable).unwrap(), std::fs::read(next_build).unwrap(), "the stable path runs the new build");
    ping(2);
    let aside: Vec<String> = in_bin().into_iter().filter(|n| n != "mnemo-desktop-mcp.exe").collect();
    assert!(aside.len() == 1 && aside[0].starts_with("mnemo-desktop-mcp.exe.old-"), "the running copy was moved aside: {aside:?}");

    // The session ends; a later start clears what it left.
    drop(ping);
    drop(stdin);
    assert_eq!(server.wait().unwrap().code(), Some(0));
    mcp::relink(Path::new(MCP), &stable).unwrap();
    assert_eq!(in_bin(), ["mnemo-desktop-mcp.exe"]);
    let _ = std::fs::remove_dir_all(dir);
}

/// `mnemo-desktop-hook` on Windows, as `agent_hook_bin.rs` runs it on macOS and Linux.
#[cfg(windows)]
mod hook {
    use super::*;
    use mnemo_desktop_lib::agent_hooks::{self, AgentEvent, SOCKET_ENV};
    use std::time::Instant;

    const BIN: &str = env!("CARGO_BIN_EXE_mnemo-desktop-hook");

    /// Runs the hook for `event` with `stdin` (or with stdin left open when `None`) against
    /// `socket`; its exit code, stdout, stderr and how long it took.
    fn run(socket: &Path, event: &str, stdin: Option<&str>) -> (Option<i32>, Vec<u8>, Vec<u8>, Duration) {
        let start = Instant::now();
        let mut child = Command::new(BIN).arg(event).env(SOCKET_ENV, socket).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap();
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

    /// An app hearing hooks at `socket`.
    fn hearing(socket: &Path) -> mpsc::Receiver<AgentEvent> {
        let listener = agent_hooks::bind(socket).unwrap();
        let (tx, rx) = mpsc::channel::<AgentEvent>();
        let tx = std::sync::Mutex::new(tx);
        std::thread::spawn(move || agent_hooks::serve(listener, std::sync::Arc::new(move |e| tx.lock().unwrap().send(e).unwrap())));
        rx
    }

    #[test]
    fn each_event_reaches_the_app_and_the_hook_prints_nothing() {
        let _alone = alone();
        let dir = scratch("hook");
        let socket = dir.join("h.sock");
        let heard = hearing(&socket);

        let before = agent_hooks::now_ms();
        let payload = r#"{"session_id":"abc","cwd":"C:\\repo","hook_event_name":"Notification","message":"Claude is waiting for your input","transcript_path":"C:\\t"}"#;
        let (code, out, err, _) = run(&socket, "Notification", Some(payload));
        assert_eq!(code, Some(0));
        assert!(out.is_empty() && err.is_empty(), "stdout {out:?} stderr {err:?}");
        let e = heard.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!((e.session_id.as_str(), e.cwd.as_str(), e.kind), ("abc", r"C:\repo", "notification"));
        assert_eq!(e.message.as_deref(), Some("Claude is waiting for your input"));
        assert!(e.at >= before && e.at <= agent_hooks::now_ms());

        // The five the app installs, each run as its entry in the settings runs it.
        for (event, kind) in agent_hooks::EVENTS {
            let payload = json!({ "session_id": "abc", "cwd": r"C:\repo", "hook_event_name": event }).to_string();
            let (code, out, _, _) = run(&socket, event, Some(&payload));
            assert_eq!((code, out.len()), (Some(0), 0), "{event}");
            assert_eq!(heard.recv_timeout(Duration::from_secs(5)).unwrap().kind, *kind, "{event}");
        }
        // A Claude Code that does not know an entry's `args` starts the binary with none: the
        // event is named by the payload.
        let (code, _, _, _) = run(&socket, "", Some(r#"{"session_id":"abc","hook_event_name":"Stop"}"#));
        assert_eq!(code, Some(0));
        assert_eq!(heard.recv_timeout(Duration::from_secs(5)).unwrap().kind, "stop");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn with_the_app_closed_it_exits_0_at_once_and_silently() {
        let _alone = alone();
        let dir = scratch("hclosed");
        for socket in [dir.join("missing.sock"), {
            // A socket nobody listens on any more, as a crashed app leaves it.
            let p = dir.join("dead.sock");
            drop(agent_hooks::bind(&p).unwrap());
            p
        }] {
            let (code, out, err, took) = run(&socket, "SessionStart", Some(r#"{"session_id":"s","cwd":"C:\\r"}"#));
            assert_eq!(code, Some(0));
            assert!(out.is_empty() && err.is_empty());
            // Its own deadline is 1.5 s: under that, it left because nothing answered.
            assert!(took < Duration::from_millis(1400), "took {took:?}");
        }
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn garbage_on_stdin_still_exits_0_silently() {
        let _alone = alone();
        let dir = scratch("hjunk");
        let (code, out, err, _) = run(&dir.join("none.sock"), "", Some("\u{0}not json"));
        assert_eq!(code, Some(0));
        assert!(out.is_empty() && err.is_empty());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_stdin_that_never_closes_cannot_hold_claude_up() {
        let _alone = alone();
        let dir = scratch("hstuck");
        let (code, out, _, took) = run(&dir.join("none.sock"), "Stop", None);
        assert_eq!(code, Some(0));
        assert!(out.is_empty());
        assert!(took < Duration::from_secs(4), "took {took:?}");
        let _ = std::fs::remove_dir_all(dir);
    }
}

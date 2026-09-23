//! `mnemo-desktop-mcp`: the desktop MCP server Claude Code starts over stdio
//! (`claude mcp add desktop -- ~/.mnemo-desktop/bin/mnemo-desktop-mcp`).
//!
//! It speaks MCP (newline-delimited JSON-RPC 2.0) on stdin/stdout and relays each tool
//! call to the running app over `~/.mnemo-desktop/mcp.sock`, one JSON line each way (see
//! `src/mcp.rs`). It links nothing of the app: a session starts it often, so it stays a
//! small std + serde_json program, and it keeps working (with a clear error) while the
//! app is closed.

use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::time::Duration;

use serde_json::{json, Value};

/// Keep in step with `mnemo_desktop_lib::mcp::{socket_path, SOCKET_ENV}`: the app exports this
/// into its panes, so a session reaches the app it runs in whichever build's binary it started.
const SOCKET_ENV: &str = "MNEMO_DESKTOP_MCP_SOCKET";
/// Keep in step with `mnemo_desktop_lib::app_dir::NAME`: the fallback for a session outside
/// any pane is the app dir of this binary's own build.
const APP_DIR: &str = if cfg!(debug_assertions) { ".mnemo-desktop-dev" } else { ".mnemo-desktop" };
/// Sent back when a client asks for a version this server has not seen.
const LATEST_PROTOCOL: &str = "2025-06-18";
const CALL_TIMEOUT: Duration = Duration::from_secs(30);

fn socket_path() -> PathBuf {
    socket_path_from(std::env::var_os(SOCKET_ENV), std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }))
}

fn socket_path_from(exported: Option<std::ffi::OsString>, home: Option<std::ffi::OsString>) -> PathBuf {
    match exported.filter(|p| !p.is_empty()) {
        Some(p) => PathBuf::from(p),
        None => home.map(PathBuf::from).unwrap_or_default().join(APP_DIR).join("mcp.sock"),
    }
}

fn tools() -> Value {
    let pane = json!({ "type": "integer", "description": "Pane id from desktop_list_panes (browser and other non-terminal panes have negative ids)." });
    json!([
        {
            "name": "desktop_list_panes",
            "description": "List the panes open in the mnemo desktop app: id, view (terminal, browser, editor…), title, cwd, url for browser panes, which tab (1-based) and whether it is the focused pane of the active tab. Start here to find the pane id the other desktop tools take.",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false },
            "annotations": { "readOnlyHint": true }
        },
        {
            "name": "desktop_terminal_read",
            "description": "Read the last lines of a terminal pane in the mnemo desktop app (scrollback included, soft-wrapped rows joined). Use it to see a dev server's log, a test run or another agent's session without asking the user to paste it.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "pane": pane,
                    "lines": { "type": "integer", "minimum": 1, "maximum": 5000, "default": 100, "description": "How many lines from the bottom." }
                },
                "required": ["pane"],
                "additionalProperties": false
            },
            "annotations": { "readOnlyHint": true }
        },
        {
            "name": "desktop_browser_read",
            "description": "Read the page open in a browser pane of the mnemo desktop app as text: title, current url, and the visible content as light markdown (headings, links with their urls, lists, form fields, code blocks). Sees what the user sees, logins included.",
            "inputSchema": { "type": "object", "properties": { "pane": pane }, "required": ["pane"], "additionalProperties": false },
            "annotations": { "readOnlyHint": true }
        },
        {
            "name": "desktop_pane_snapshot",
            "description": "Take a screenshot of a browser pane in the mnemo desktop app (browser panes only, including ones in a background tab). Use it when layout or visuals matter; desktop_browser_read is cheaper for text.",
            "inputSchema": { "type": "object", "properties": { "pane": pane }, "required": ["pane"], "additionalProperties": false },
            "annotations": { "readOnlyHint": true }
        }
    ])
}

/// Asks the app one question. `Ok` carries MCP content; `Err` a message for the model.
fn call_app(method: &str, params: Value) -> Result<Value, String> {
    #[cfg(unix)]
    {
        let path = socket_path();
        let stream = std::os::unix::net::UnixStream::connect(&path)
            .map_err(|e| format!("the mnemo desktop app is not running (or too old to serve MCP): {}: {e}", path.display()))?;
        stream.set_read_timeout(Some(CALL_TIMEOUT)).map_err(|e| e.to_string())?;
        let mut out = stream.try_clone().map_err(|e| e.to_string())?;
        writeln!(out, "{}", json!({ "id": 1, "method": method, "params": params })).map_err(|e| e.to_string())?;
        let mut line = String::new();
        BufReader::new(stream).read_line(&mut line).map_err(|e| format!("no answer from the app: {e}"))?;
        let reply: Value = serde_json::from_str(&line).map_err(|e| format!("bad answer from the app: {e}"))?;
        match (reply.get("content"), reply.get("error")) {
            (_, Some(e)) if !e.is_null() => Err(e.as_str().map(str::to_owned).unwrap_or_else(|| e.to_string())),
            (Some(c), _) => Ok(c.clone()),
            _ => Err("empty answer from the app".into()),
        }
    }
    #[cfg(not(unix))]
    {
        let _ = (method, params);
        Err("the desktop MCP needs unix sockets".into())
    }
}

/// The response to one JSON-RPC message, or `None` for notifications.
fn handle(msg: &Value, call: &dyn Fn(&str, Value) -> Result<Value, String>) -> Option<Value> {
    let id = msg.get("id").cloned();
    let method = msg.get("method").and_then(Value::as_str);
    let (Some(id), Some(method)) = (id, method) else {
        // Notifications (`notifications/initialized`, `notifications/cancelled`) and stray
        // responses need no answer.
        return None;
    };
    let params = msg.get("params").cloned().unwrap_or(Value::Null);
    let result = match method {
        "initialize" => Ok(json!({
            "protocolVersion": params.get("protocolVersion").and_then(Value::as_str).unwrap_or(LATEST_PROTOCOL),
            "capabilities": { "tools": {} },
            "serverInfo": { "name": "mnemo-desktop", "version": env!("CARGO_PKG_VERSION") },
            "instructions": "Reads the panes of the mnemo desktop app this session runs in: list them with desktop_list_panes, then read a terminal's output, a browser page's text, or a browser page's screenshot."
        })),
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({ "tools": tools() })),
        "tools/call" => {
            let name = params.get("name").and_then(Value::as_str).unwrap_or_default();
            let known = tools().as_array().is_some_and(|t| t.iter().any(|t| t["name"] == name));
            if !known {
                Err((-32602, format!("unknown tool {name:?}")))
            } else {
                let args = params.get("arguments").cloned().filter(Value::is_object).unwrap_or_else(|| json!({}));
                // Tool failures are results the model reads, not protocol errors.
                Ok(match call(name, args) {
                    Ok(content) => json!({ "content": content }),
                    Err(e) => json!({ "content": [{ "type": "text", "text": e }], "isError": true }),
                })
            }
        }
        _ => Err((-32601, format!("method not found: {method}"))),
    };
    Some(match result {
        Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
        Err((code, message)) => json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } }),
    })
}

fn main() {
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout().lock();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let reply = match serde_json::from_str::<Value>(&line) {
            Ok(msg) => handle(&msg, &call_app),
            Err(e) => Some(json!({ "jsonrpc": "2.0", "id": null, "error": { "code": -32700, "message": format!("parse error: {e}") } })),
        };
        if let Some(reply) = reply {
            if writeln!(stdout, "{reply}").and_then(|_| stdout.flush()).is_err() {
                break;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn app(method: &str, params: Value) -> Result<Value, String> {
        match params.get("pane").and_then(Value::as_i64) {
            Some(-1) => Err("pane -1 is a browser pane".into()),
            _ => Ok(json!([{ "type": "text", "text": format!("{method} {params}") }])),
        }
    }

    fn req(v: Value) -> Value {
        handle(&v, &app).expect("a response")
    }

    #[test]
    fn initialize_echoes_the_client_version_and_offers_tools() {
        let r = req(json!({ "jsonrpc": "2.0", "id": 0, "method": "initialize", "params": { "protocolVersion": "2025-03-26", "capabilities": {} } }));
        assert_eq!(r["id"], 0);
        assert_eq!(r["result"]["protocolVersion"], "2025-03-26");
        assert!(r["result"]["capabilities"]["tools"].is_object());
        assert_eq!(req(json!({ "id": 1, "method": "initialize" }))["result"]["protocolVersion"], LATEST_PROTOCOL);
    }

    #[test]
    fn notifications_get_no_answer() {
        assert!(handle(&json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }), &app).is_none());
    }

    #[test]
    fn lists_the_four_tools_with_schemas() {
        let r = req(json!({ "id": 2, "method": "tools/list" }));
        let names: Vec<_> = r["result"]["tools"].as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap().to_owned()).collect();
        assert_eq!(names, ["desktop_list_panes", "desktop_terminal_read", "desktop_browser_read", "desktop_pane_snapshot"]);
        for t in r["result"]["tools"].as_array().unwrap() {
            assert_eq!(t["inputSchema"]["type"], "object");
        }
        assert_eq!(r["result"]["tools"][1]["inputSchema"]["required"], json!(["pane"]));
    }

    #[test]
    fn tool_calls_relay_arguments_and_wrap_failures_as_results() {
        let r = req(json!({ "id": 3, "method": "tools/call", "params": { "name": "desktop_terminal_read", "arguments": { "pane": 2, "lines": 5 } } }));
        assert_eq!(r["result"]["content"][0]["text"], r#"desktop_terminal_read {"lines":5,"pane":2}"#);
        assert!(r["result"].get("isError").is_none());

        let r = req(json!({ "id": 4, "method": "tools/call", "params": { "name": "desktop_pane_snapshot", "arguments": { "pane": -1 } } }));
        assert_eq!(r["result"]["isError"], true);
        assert_eq!(r["result"]["content"][0]["text"], "pane -1 is a browser pane");

        let r = req(json!({ "id": 5, "method": "tools/call", "params": { "name": "desktop_list_panes" } }));
        assert_eq!(r["result"]["content"][0]["text"], "desktop_list_panes {}");
    }

    #[test]
    fn unknown_tools_and_methods_are_protocol_errors() {
        let r = req(json!({ "id": 6, "method": "tools/call", "params": { "name": "rm", "arguments": {} } }));
        assert_eq!(r["error"]["code"], -32602);
        let r = req(json!({ "id": 7, "method": "resources/list" }));
        assert_eq!(r["error"]["code"], -32601);
        assert_eq!(req(json!({ "id": "p", "method": "ping" }))["result"], json!({}));
    }

    #[test]
    fn the_socket_a_pane_exports_wins_over_the_build_default() {
        let home = Some("/home/u".into());
        assert_eq!(socket_path_from(Some("/tmp/dev/mcp.sock".into()), home.clone()), PathBuf::from("/tmp/dev/mcp.sock"));
        // Outside a pane: this build's own app dir (`cargo test` is a debug build, like `tauri dev`).
        assert_eq!(socket_path_from(None, home.clone()), PathBuf::from("/home/u/.mnemo-desktop-dev/mcp.sock"));
        assert_eq!(socket_path_from(Some("".into()), home), PathBuf::from("/home/u/.mnemo-desktop-dev/mcp.sock"));
    }

    #[cfg(unix)]
    #[test]
    fn a_closed_app_is_a_readable_error() {
        // A socket in a directory that does not exist, so nothing can be listening on it.
        let missing = std::env::temp_dir().join("mnemo-mcp-no-such-dir").join("app.sock");
        // SAFETY: tests in this binary do not read the environment concurrently with this one.
        unsafe { std::env::set_var(SOCKET_ENV, &missing) };
        let e = call_app("desktop_list_panes", json!({})).unwrap_err();
        assert!(e.contains("not running"), "{e}");
    }
}

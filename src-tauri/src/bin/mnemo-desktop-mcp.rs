//! `mnemo-desktop-mcp`: the desktop MCP server Claude Code starts over stdio
//! (`claude mcp add desktop -- ~/.mnemo-desktop/bin/mnemo-desktop-mcp`).
//!
//! It speaks MCP (newline-delimited JSON-RPC 2.0) on stdin/stdout and relays each tool
//! call to the running app over `~/.mnemo-desktop/mcp.sock`, one JSON line each way (see
//! `src/mcp.rs`). It links nothing of the app: a session starts it often, so it stays a
//! small std + serde_json program, and it keeps working (with a clear error) while the
//! app is closed.
//!
//! `mnemo-desktop-mcp call <tool> [<json-args>] [--out <file>]` makes one call without MCP,
//! so a session can look at (and, against a debug build, drive) a `pnpm tauri dev` instance
//! without registering it as a server: it prints the result as JSON and writes an image
//! result to `--out`. See `usage()`.

use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
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
    tools_for(cfg!(debug_assertions))
}

/// The tools this build offers: `desktop_app_drive` only in a debug build, the one kind of
/// app that serves it (`mnemo_desktop_lib::mcp::DEV_TOOLS`).
fn tools_for(debug: bool) -> Value {
    let pane = json!({ "type": "integer", "description": "Pane id from desktop_list_panes (browser and other non-terminal panes have negative ids)." });
    let mut list = json!([
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
        },
        {
            "name": "desktop_app_snapshot",
            "description": "Take a screenshot of the mnemo desktop app's own window: its main webview, everything but the pages inside browser panes (desktop_pane_snapshot takes those). Use it to see a UI change in the running app. A terminal drawn with WebGL can come out blank; desktop_terminal_read has its text.",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false },
            "annotations": { "readOnlyHint": true }
        }
    ]);
    if debug {
        list.as_array_mut().expect("a list").push(json!({
            "name": "desktop_app_drive",
            "description": "Drive the mnemo desktop app's own window (debug builds only): click an element, type text into a field, press keys, or evaluate JavaScript in the app's page. Answers {ok, result?, error?}: result says what the action landed on, or the script's value. Events are synthetic: text lands in the focused field, but a Tab does not move focus and an Enter does not submit, so click the control. Follow with desktop_app_snapshot to see the effect.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "action": { "type": "string", "enum": ["click", "type", "key", "eval"] },
                    "selector": { "type": "string", "description": "CSS selector. click: what to click (required). type, key: what to focus first; without it, the focused element." },
                    "text": { "type": "string", "description": "type: the text to insert at the caret." },
                    "keys": { "type": "string", "description": "key: chords joined by + and pressed in turn when separated by spaces, e.g. \"Meta+k\", \"Mod+Shift+d\", \"ArrowDown ArrowDown Enter\". Mod is Cmd on macOS and Ctrl elsewhere; Space is the space bar." },
                    "js": { "type": "string", "description": "eval: an expression or a function body (with return), awaited; its value comes back as JSON." }
                },
                "required": ["action"],
                "additionalProperties": false
            }
        }));
    }
    list
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
            "instructions": "Reads the panes of the mnemo desktop app this session runs in: list them with desktop_list_panes, then read a terminal's output, a browser page's text, or a browser page's screenshot. desktop_app_snapshot shows the app's own window."
        })),
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({ "tools": tools() })),
        "tools/call" => {
            let name = params.get("name").and_then(Value::as_str).unwrap_or_default();
            if !known(name) {
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

// ---------------------------------------------------------------------------------------
// CLI: one call, no MCP.

const BIN: &str = "mnemo-desktop-mcp";

fn usage() -> String {
    let names: Vec<String> = tools().as_array().into_iter().flatten().filter_map(|t| t["name"].as_str().map(str::to_owned)).collect();
    format!(
        r#"usage: {BIN} call <tool> [<json-args>] [--out <file>]

Makes one call to the running mnemo desktop app and prints the result as JSON: a text
result as its JSON value (or as a string), an image as {{"mime", "data"}}, or, with --out,
written to that file and printed as {{"mime", "out", "bytes"}}. Exits 1 when the call fails
or its result says {{"ok": false}}, 2 on a usage error.

The app is the one at ${SOCKET_ENV}, else this build's own ({socket}). A pane of the
app exports its own socket, so from a pane of the installed app, reach a `pnpm tauri dev`
instance with {SOCKET_ENV}=~/.mnemo-desktop-dev/mcp.sock.

tools: {tools}

examples:
  {BIN} call desktop_app_snapshot --out /tmp/app.png
  {BIN} call desktop_app_drive '{{"action":"key","keys":"Meta+k"}}'
  {BIN} call desktop_app_drive '{{"action":"eval","js":"document.title"}}'
"#,
        socket = socket_path_from(None, std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })).display(),
        tools = names.join(", "),
    )
}

fn known(tool: &str) -> bool {
    tools().as_array().is_some_and(|t| t.iter().any(|t| t["name"] == tool))
}

#[derive(Debug, PartialEq)]
struct Call {
    tool: String,
    args: Value,
    out: Option<PathBuf>,
}

/// `<tool> [<json-args>] [--out <file>]`, the words after `call`.
fn parse_call(words: &[String]) -> Result<Call, String> {
    let (mut rest, mut out) = (Vec::new(), None);
    let mut it = words.iter();
    while let Some(w) = it.next() {
        if w == "--out" {
            out = Some(PathBuf::from(it.next().ok_or("--out needs a file")?));
        } else if let Some(file) = w.strip_prefix("--out=") {
            out = Some(PathBuf::from(file));
        } else {
            rest.push(w.as_str());
        }
    }
    let (tool, args) = match rest.as_slice() {
        [] => return Err("which tool?".into()),
        [tool] => (*tool, json!({})),
        [tool, args] => (*tool, serde_json::from_str::<Value>(args).map_err(|e| format!("<json-args> is not JSON: {e}"))?),
        [_, _, extra, ..] => return Err(format!("unexpected argument {extra:?}")),
    };
    if !args.is_object() {
        return Err("<json-args> must be a JSON object".into());
    }
    if !known(tool) {
        let hint = if tool == "desktop_app_drive" { " (only a debug build has it: use target/debug/mnemo-desktop-mcp)" } else { "" };
        return Err(format!("unknown tool {tool:?}{hint}"));
    }
    Ok(Call { tool: tool.to_owned(), args, out })
}

type WriteFile<'a> = &'a mut dyn FnMut(&Path, &[u8]) -> Result<(), String>;

/// MCP content as the CLI prints it: one item alone, several as a list; text as the JSON it
/// holds when it holds some. With `out`, the first image goes to that file through `write`
/// and is printed as where it went.
fn render(content: &Value, out: Option<&Path>, write: WriteFile) -> Result<Value, String> {
    use base64::Engine;
    let items = content.as_array().cloned().unwrap_or_else(|| vec![content.clone()]);
    let mut out = out;
    let mut shown = Vec::with_capacity(items.len());
    for item in &items {
        shown.push(match item["type"].as_str() {
            Some("text") => {
                let text = item["text"].as_str().unwrap_or_default();
                serde_json::from_str::<Value>(text).unwrap_or_else(|_| Value::String(text.to_owned()))
            }
            Some("image") => {
                let (mime, data) = (item["mimeType"].as_str().unwrap_or_default(), item["data"].as_str().unwrap_or_default());
                match out.take() {
                    None => json!({ "mime": mime, "data": data }),
                    Some(path) => {
                        let bytes = base64::engine::general_purpose::STANDARD.decode(data).map_err(|e| format!("the image is not base64: {e}"))?;
                        write(path, &bytes)?;
                        json!({ "mime": mime, "out": path.display().to_string(), "bytes": bytes.len() })
                    }
                }
            }
            _ => item.clone(),
        });
    }
    Ok(if shown.len() == 1 { shown.remove(0) } else { Value::Array(shown) })
}

/// Runs `call …` against `call` and returns the exit code.
fn cli(words: &[String], call: &dyn Fn(&str, Value) -> Result<Value, String>, write: WriteFile, stdout: &mut dyn Write, stderr: &mut dyn Write) -> i32 {
    let c = match parse_call(words) {
        Ok(c) => c,
        Err(e) => {
            let _ = writeln!(stderr, "{BIN}: {e}\n\n{}", usage());
            return 2;
        }
    };
    let shown = call(&c.tool, c.args).and_then(|content| {
        if c.out.is_some() && !content.as_array().is_some_and(|a| a.iter().any(|i| i["type"] == "image")) {
            let _ = writeln!(stderr, "{BIN}: the result has no image; nothing written to {}", c.out.as_deref().unwrap_or(Path::new("")).display());
        }
        render(&content, c.out.as_deref(), write)
    });
    match shown {
        Err(e) => {
            let _ = writeln!(stderr, "{BIN}: {e}");
            1
        }
        Ok(shown) => {
            let _ = writeln!(stdout, "{}", serde_json::to_string_pretty(&shown).unwrap_or_default());
            if shown.get("ok") == Some(&Value::Bool(false)) {
                1
            } else {
                0
            }
        }
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        // No arguments: the MCP server Claude Code starts.
        None => {}
        Some("call") => {
            let mut write = |path: &Path, bytes: &[u8]| std::fs::write(path, bytes).map_err(|e| format!("{}: {e}", path.display()));
            let code = cli(&args[1..], &call_app, &mut write, &mut std::io::stdout(), &mut std::io::stderr());
            std::process::exit(code);
        }
        Some("-h" | "--help" | "help") => {
            print!("{}", usage());
            return;
        }
        Some(other) => {
            eprintln!("{BIN}: unknown command {other:?}\n\n{}", usage());
            std::process::exit(2);
        }
    }
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
    fn lists_the_tools_with_schemas() {
        let r = req(json!({ "id": 2, "method": "tools/list" }));
        let names: Vec<_> = r["result"]["tools"].as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap().to_owned()).collect();
        // `cargo test` is a debug build, like `tauri dev`.
        assert_eq!(names, ["desktop_list_panes", "desktop_terminal_read", "desktop_browser_read", "desktop_pane_snapshot", "desktop_app_snapshot", "desktop_app_drive"]);
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
    fn a_release_build_offers_no_drive() {
        let names = |debug| tools_for(debug).as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap().to_owned()).collect::<Vec<_>>();
        assert!(names(true).contains(&"desktop_app_drive".to_owned()));
        assert!(!names(false).contains(&"desktop_app_drive".to_owned()));
        assert!(names(false).contains(&"desktop_app_snapshot".to_owned()));
        let drive = tools_for(true).as_array().unwrap().iter().find(|t| t["name"] == "desktop_app_drive").cloned().unwrap();
        assert_eq!(drive["inputSchema"]["properties"]["action"]["enum"], json!(["click", "type", "key", "eval"]));
        assert_eq!(drive["inputSchema"]["required"], json!(["action"]));
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

    fn words(w: &[&str]) -> Vec<String> {
        w.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn call_reads_a_tool_its_args_and_an_out_file_anywhere() {
        let c = parse_call(&words(&["desktop_app_snapshot", "--out", "/tmp/a.png"])).unwrap();
        assert_eq!(c, Call { tool: "desktop_app_snapshot".into(), args: json!({}), out: Some("/tmp/a.png".into()) });
        let c = parse_call(&words(&["--out=/x.png", "desktop_app_drive", r#"{"action":"eval","js":"1"}"#])).unwrap();
        assert_eq!((c.args["js"].as_str(), c.out), (Some("1"), Some("/x.png".into())));

        let err = |w: &[&str]| parse_call(&words(w)).unwrap_err();
        assert_eq!(err(&[]), "which tool?");
        assert_eq!(err(&["desktop_app_snapshot", "--out"]), "--out needs a file");
        assert!(err(&["desktop_app_drive", "{nope"]).starts_with("<json-args> is not JSON"));
        assert_eq!(err(&["desktop_app_drive", "[1]"]), "<json-args> must be a JSON object");
        assert_eq!(err(&["desktop_list_panes", "{}", "more"]), r#"unexpected argument "more""#);
        assert_eq!(err(&["rm"]), r#"unknown tool "rm""#);
    }

    fn no_write(_: &Path, _: &[u8]) -> Result<(), String> {
        panic!("nothing should be written")
    }

    #[test]
    fn results_print_as_the_json_they_carry() {
        let r = render(&json!([{ "type": "text", "text": r#"{"ok":true,"result":3}"# }]), None, &mut no_write).unwrap();
        assert_eq!(r, json!({ "ok": true, "result": 3 }));
        let r = render(&json!([{ "type": "text", "text": "plain" }, { "type": "text", "text": "[1]" }]), None, &mut no_write).unwrap();
        assert_eq!(r, json!(["plain", [1]]));
        let r = render(&json!([{ "type": "image", "data": "iVBORw==", "mimeType": "image/png" }]), None, &mut no_write).unwrap();
        assert_eq!(r, json!({ "mime": "image/png", "data": "iVBORw==" }));
    }

    #[test]
    fn an_image_goes_to_the_out_file() {
        let mut wrote = Vec::new();
        let mut write = |p: &Path, b: &[u8]| {
            wrote.push((p.to_owned(), b.to_vec()));
            Ok(())
        };
        let content = json!([{ "type": "image", "data": "iVBORw==", "mimeType": "image/png" }, { "type": "image", "data": "AA==", "mimeType": "image/png" }]);
        let r = render(&content, Some(Path::new("/tmp/shot.png")), &mut write).unwrap();
        assert_eq!(r, json!([{ "mime": "image/png", "out": "/tmp/shot.png", "bytes": 4 }, { "mime": "image/png", "data": "AA==" }]));
        assert_eq!(wrote, [(PathBuf::from("/tmp/shot.png"), b"\x89PNG".to_vec())]);

        let bad = json!([{ "type": "image", "data": "@@", "mimeType": "image/png" }]);
        assert!(render(&bad, Some(Path::new("/x")), &mut |_: &Path, _: &[u8]| Ok(())).unwrap_err().contains("not base64"));
    }

    fn run(w: &[&str], call: &dyn Fn(&str, Value) -> Result<Value, String>) -> (i32, String, String) {
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let code = cli(&words(w), call, &mut |_: &Path, _: &[u8]| Ok(()), &mut out, &mut err);
        (code, String::from_utf8(out).unwrap(), String::from_utf8(err).unwrap())
    }

    #[test]
    fn the_exit_code_says_whether_it_worked() {
        let answer = |text: &'static str| move |_: &str, _: Value| Ok(json!([{ "type": "text", "text": text }]));
        let (code, out, _) = run(&["desktop_app_drive", r#"{"action":"eval","js":"1"}"#], &answer(r#"{"ok":true,"result":1}"#));
        assert_eq!((code, serde_json::from_str::<Value>(&out).unwrap()), (0, json!({ "ok": true, "result": 1 })));
        let (code, out, _) = run(&["desktop_app_drive", r#"{"action":"click"}"#], &answer(r#"{"ok":false,"error":"no"}"#));
        assert_eq!((code, serde_json::from_str::<Value>(&out).unwrap()["error"].as_str()), (1, Some("no")));

        let (code, out, err) = run(&["desktop_app_snapshot"], &|_: &str, _: Value| Err("the mnemo desktop app is not running".into()));
        assert_eq!((code, out.as_str()), (1, ""));
        assert!(err.contains("not running"), "{err}");

        let (code, _, err) = run(&["desktop_list_panes", "--out", "/tmp/x.png"], &answer("[]"));
        assert_eq!(code, 0);
        assert!(err.contains("no image"), "{err}");

        let (code, out, err) = run(&["nope"], &answer("{}"));
        assert_eq!((code, out.as_str()), (2, ""));
        assert!(err.contains("usage: mnemo-desktop-mcp call") && err.contains("desktop_app_drive"), "{err}");
    }
}

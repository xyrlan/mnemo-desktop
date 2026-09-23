//! Desktop MCP (issue #74): the app serves structured reads of its panes to the Claude Code
//! sessions it hosts.
//!
//! ```text
//! claude ──stdio JSON-RPC──▶ mnemo-desktop-mcp ──unix socket, one JSON line each way──▶ app
//!                                                   app ──`mcp://ask`──▶ webview (src/mcp/)
//!                                                   app ◀──`mcp_answer`── webview
//! ```
//!
//! The binary (`src/bin/mnemo-desktop-mcp.rs`) owns the MCP protocol; this side only
//! relays a tool name and its arguments to the webview, which knows the panes, and hands
//! back MCP `content`. The socket is bound when the webview first asks for its path, so
//! nothing is served before something can answer.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{LazyLock, Mutex, OnceLock};
use std::time::Duration;

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, Runtime};

/// The MCP server binary, a sibling of the app's own executable.
pub const BIN_NAME: &str = "mnemo-desktop-mcp";
/// The name sessions know the server by (`claude mcp add desktop …`).
pub const SERVER_NAME: &str = "desktop";
/// The tools the binary may relay; anything else is refused before it reaches the webview.
pub const TOOLS: &[&str] = &["desktop_list_panes", "desktop_terminal_read", "desktop_browser_read", "desktop_pane_snapshot"];
/// Overrides the socket path on both ends (tests, a second app instance).
pub const SOCKET_ENV: &str = "MNEMO_DESKTOP_MCP_SOCKET";

const MAIN: &str = "main";
const ANSWER_TIMEOUT: Duration = Duration::from_secs(20);
const PAGE_TIMEOUT: Duration = Duration::from_secs(10);

fn home() -> PathBuf {
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from).unwrap_or_else(std::env::temp_dir)
}

/// `~/.mnemo-desktop`, shared with settings and shell integration.
pub fn app_dir() -> PathBuf {
    home().join(".mnemo-desktop")
}

pub fn socket_path() -> PathBuf {
    std::env::var_os(SOCKET_ENV).map(PathBuf::from).unwrap_or_else(|| app_dir().join("mcp.sock"))
}

/// Where sessions are pointed at: a symlink to the binary of whichever app build started
/// last, so a registration survives rebuilds, worktrees and moving the app.
pub fn stable_binary() -> PathBuf {
    app_dir().join("bin").join(BIN_NAME)
}

// ---------------------------------------------------------------------------------------
// Socket protocol: `{"id", "method", "params"}` in, `{"id", "content"}` or `{"id", "error"}` out.

#[derive(Deserialize)]
pub struct Request {
    #[serde(default)]
    pub id: Value,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

/// One reply line for one request line. `ask` answers a known tool with MCP content.
pub fn answer_line(line: &str, ask: &dyn Fn(&str, Value) -> Result<Value, String>) -> String {
    let reply = match serde_json::from_str::<Request>(line) {
        Err(e) => json!({ "id": Value::Null, "error": format!("bad request: {e}") }),
        Ok(req) if !TOOLS.contains(&req.method.as_str()) => {
            json!({ "id": req.id, "error": format!("unknown tool {}", req.method) })
        }
        Ok(req) => {
            let params = if req.params.is_object() { req.params } else { json!({}) };
            match ask(&req.method, params) {
                Ok(content) => json!({ "id": req.id, "content": content }),
                Err(e) => json!({ "id": req.id, "error": e }),
            }
        }
    };
    reply.to_string()
}

/// Answers a tool call: the webview in the app, a fake in tests.
pub type Asker = std::sync::Arc<dyn Fn(&str, Value) -> Result<Value, String> + Send + Sync>;

#[cfg(unix)]
pub fn serve(listener: std::os::unix::net::UnixListener, ask: Asker) {
    use std::io::{BufRead, BufReader, Write};
    for stream in listener.incoming() {
        let Ok(stream) = stream else { continue };
        let ask = ask.clone();
        std::thread::spawn(move || {
            let Ok(mut out) = stream.try_clone() else { return };
            for line in BufReader::new(stream).lines() {
                let Ok(line) = line else { break };
                if line.trim().is_empty() {
                    continue;
                }
                let reply = answer_line(&line, &*ask);
                if writeln!(out, "{reply}").and_then(|_| out.flush()).is_err() {
                    break;
                }
            }
        });
    }
}

/// Binds `path`, replacing a socket left by an earlier (or still running) app: the app
/// started last serves, as it is the one the user is looking at.
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
    // Other local users must not read this user's terminals.
    let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    Ok(listener)
}

// ---------------------------------------------------------------------------------------
// Webview round-trip.

type Answer = Result<Value, String>;
static PENDING: LazyLock<Mutex<HashMap<u64, Sender<Answer>>>> = LazyLock::new(Default::default);
static NEXT: AtomicU64 = AtomicU64::new(1);

fn ask_webview<R: Runtime>(app: &AppHandle<R>, method: &str, params: Value) -> Answer {
    let ask = NEXT.fetch_add(1, Ordering::Relaxed);
    let (tx, rx) = mpsc::channel();
    PENDING.lock().unwrap().insert(ask, tx);
    let sent = app.emit_to(MAIN, "mcp://ask", json!({ "ask": ask, "method": method, "params": params }));
    let answer = match sent {
        Err(e) => Err(format!("the app window is not reachable: {e}")),
        Ok(()) => rx.recv_timeout(ANSWER_TIMEOUT).unwrap_or_else(|_| Err("the app window did not answer in time".into())),
    };
    PENDING.lock().unwrap().remove(&ask);
    answer
}

/// The webview's answer to `mcp://ask` number `ask`: MCP content, or an error message.
#[tauri::command]
pub fn mcp_answer(ask: u64, content: Option<Value>, error: Option<String>) {
    if let Some(tx) = PENDING.lock().unwrap().remove(&ask) {
        let _ = tx.send(match error {
            Some(e) => Err(e),
            None => Ok(content.unwrap_or_else(|| json!([]))),
        });
    }
}

static STARTED: OnceLock<Result<(), String>> = OnceLock::new();

/// Where the app serves the MCP binary. The first call binds the socket and refreshes the
/// session registration (`~/.mnemo-desktop/mcp.json`, the user-scope `claude mcp` entry).
#[tauri::command]
pub fn mcp_socket_path<R: Runtime>(app: AppHandle<R>) -> String {
    let path = socket_path();
    let started = STARTED.get_or_init(|| start(app, &path));
    if let Err(e) = started {
        log::warn!("mcp: not serving: {e}");
    }
    path.display().to_string()
}

#[cfg(unix)]
fn start<R: Runtime>(app: AppHandle<R>, path: &Path) -> Result<(), String> {
    let listener = bind(path)?;
    let asker = app.clone();
    let ask = std::sync::Arc::new(move |method: &str, params: Value| ask_webview(&asker, method, params));
    std::thread::Builder::new().name("mcp-socket".into()).spawn(move || serve(listener, ask)).map_err(|e| e.to_string())?;
    if std::env::var_os("MNEMO_DESKTOP_SMOKE").is_none() {
        std::thread::spawn(|| {
            if let Err(e) = install() {
                log::warn!("mcp: registration skipped: {e}");
            }
        });
    }
    Ok(())
}

#[cfg(not(unix))]
fn start<R: Runtime>(_app: AppHandle<R>, _path: &Path) -> Result<(), String> {
    Err("the desktop MCP needs unix sockets".into())
}

// ---------------------------------------------------------------------------------------
// Registration for Claude Code.

/// The `--mcp-config` file for sessions that should not touch the user's Claude config.
pub fn mcp_json(command: &Path) -> Value {
    json!({ "mcpServers": { SERVER_NAME: { "type": "stdio", "command": command.display().to_string(), "args": [] } } })
}

/// Whether `~/.claude.json` already has a user-scope server named `desktop` (whatever it
/// points at: a user who registered their own is left alone).
pub fn registered(claude_json: &str) -> bool {
    serde_json::from_str::<Value>(claude_json).is_ok_and(|v| v.pointer(&format!("/mcpServers/{SERVER_NAME}")).is_some())
}

fn sh_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', r"'\''"))
}

pub fn add_command(binary: &Path) -> String {
    format!("claude mcp add --scope user {SERVER_NAME} -- {}", sh_quote(&binary.display().to_string()))
}

#[cfg(unix)]
fn install() -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let built = exe.with_file_name(BIN_NAME);
    if !built.is_file() {
        return Err(format!("{} is missing (cargo build --bin {BIN_NAME})", built.display()));
    }
    let stable = stable_binary();
    relink(&built, &stable)?;

    let config = app_dir().join("mcp.json");
    let body = serde_json::to_string_pretty(&mcp_json(&stable)).map_err(|e| e.to_string())?;
    if std::fs::read_to_string(&config).ok().as_deref() != Some(body.as_str()) {
        std::fs::write(&config, body).map_err(|e| format!("{}: {e}", config.display()))?;
    }

    // `claude mcp add` is non-interactive, so the user scope gets the server, once: the marker
    // keeps a `claude mcp remove` from being undone at the next start. Through a login shell:
    // an app launched from Finder has a bare PATH.
    let marker = app_dir().join("mcp-registered");
    if marker.exists() {
        return Ok(());
    }
    let claude_json = std::fs::read_to_string(home().join(".claude.json")).unwrap_or_default();
    if registered(&claude_json) {
        let _ = std::fs::write(&marker, "");
        return Ok(());
    }
    let out = crate::proc::command(crate::pty::default_shell())
        .args(["-l", "-c", &add_command(&stable)])
        .stdin(std::process::Stdio::null())
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(format!("claude mcp add failed: {}", String::from_utf8_lossy(&out.stderr).trim()));
    }
    let _ = std::fs::write(&marker, "");
    log::info!("mcp: registered `{SERVER_NAME}` for Claude Code (user scope)");
    Ok(())
}

#[cfg(unix)]
pub fn relink(target: &Path, link: &Path) -> Result<(), String> {
    if std::fs::read_link(link).is_ok_and(|t| t == target) {
        return Ok(());
    }
    if let Some(dir) = link.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    }
    if std::fs::symlink_metadata(link).is_ok() {
        std::fs::remove_file(link).map_err(|e| format!("{}: {e}", link.display()))?;
    }
    std::os::unix::fs::symlink(target, link).map_err(|e| format!("{}: {e}", link.display()))
}

// ---------------------------------------------------------------------------------------
// Browser panes: the page's own reads, which only the child webview can make.

fn browser_webview<R: Runtime>(app: &AppHandle<R>, id: i64) -> Result<tauri::Webview<R>, String> {
    app.get_webview(&crate::browser::label_for(id)).ok_or_else(|| format!("browser pane {id} has no page open"))
}

async fn wait<T: Send + 'static>(rx: mpsc::Receiver<T>, what: &'static str) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(PAGE_TIMEOUT))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|_| format!("the page did not answer the {what} in time"))
}

/// Runs `script` in the pane's page and returns WebKit's JSON of its value ("" when the
/// script threw). The main webview already has full rights, so this widens nothing.
#[tauri::command]
pub async fn mcp_browser_eval<R: Runtime>(app: AppHandle<R>, id: i64, script: String) -> Result<String, String> {
    let (tx, rx) = mpsc::channel();
    browser_webview(&app, id)?
        .eval_with_callback(script, move |json| {
            let _ = tx.send(json);
        })
        .map_err(|e| e.to_string())?;
    wait(rx, "read").await
}

/// PNGs past this size are re-encoded as JPEG, which keeps a retina page under the size
/// a model accepts as an image.
pub const MAX_PNG: usize = 2_500_000;

/// What the pane's page shows, as `{ mime, data }` with base64 data.
#[tauri::command]
pub async fn mcp_browser_snapshot<R: Runtime>(app: AppHandle<R>, id: i64) -> Result<Value, String> {
    use base64::Engine;
    let webview = browser_webview(&app, id)?;
    let (mime, bytes) = snapshot(&webview).await?;
    Ok(json!({ "mime": mime, "data": base64::engine::general_purpose::STANDARD.encode(bytes) }))
}

#[cfg(target_os = "macos")]
async fn snapshot<R: Runtime>(webview: &tauri::Webview<R>) -> Result<(&'static str, Vec<u8>), String> {
    let (tx, rx) = mpsc::channel();
    webview
        .with_webview(move |platform| {
            let wk = platform.inner() as *mut objc2::runtime::AnyObject;
            // SAFETY: `inner` is the pane's live WKWebView and this closure runs on the main
            // thread, where WebKit calls the completion handler as well.
            unsafe { macos::take_snapshot(wk, tx) }
        })
        .map_err(|e| e.to_string())?;
    wait(rx, "snapshot").await?
}

#[cfg(not(target_os = "macos"))]
async fn snapshot<R: Runtime>(_webview: &tauri::Webview<R>) -> Result<(&'static str, Vec<u8>), String> {
    Err("pane snapshots are only implemented on macOS".into())
}

#[cfg(target_os = "macos")]
mod macos {
    use std::ffi::{c_char, c_void, CStr};
    use std::sync::mpsc::Sender;

    use block2::RcBlock;
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};

    type Shot = Result<(&'static str, Vec<u8>), String>;

    const NS_BITMAP_PNG: usize = 4;
    const NS_BITMAP_JPEG: usize = 3;

    pub unsafe fn take_snapshot(wk: *mut AnyObject, tx: Sender<Shot>) {
        if wk.is_null() {
            let _ = tx.send(Err("the page is gone".into()));
            return;
        }
        let handler = RcBlock::new(move |image: *mut AnyObject, error: *mut AnyObject| {
            let shot = if image.is_null() { Err(describe(error)) } else { encode(image) };
            let _ = tx.send(shot);
        });
        let config: *mut AnyObject = std::ptr::null_mut();
        let _: () = msg_send![wk, takeSnapshotWithConfiguration: config, completionHandler: &*handler];
    }

    unsafe fn describe(error: *mut AnyObject) -> String {
        if error.is_null() {
            return "the page could not be captured (is its tab on screen?)".into();
        }
        let text: *mut AnyObject = msg_send![error, localizedDescription];
        format!("the page could not be captured: {}", string(text))
    }

    unsafe fn string(ns: *mut AnyObject) -> String {
        if ns.is_null() {
            return String::new();
        }
        let utf8: *const c_char = msg_send![ns, UTF8String];
        if utf8.is_null() {
            String::new()
        } else {
            CStr::from_ptr(utf8).to_string_lossy().into_owned()
        }
    }

    unsafe fn bytes(data: *mut AnyObject) -> Vec<u8> {
        if data.is_null() {
            return Vec::new();
        }
        let len: usize = msg_send![data, length];
        let ptr: *const c_void = msg_send![data, bytes];
        if ptr.is_null() || len == 0 {
            Vec::new()
        } else {
            std::slice::from_raw_parts(ptr.cast::<u8>(), len).to_vec()
        }
    }

    unsafe fn encode(image: *mut AnyObject) -> Shot {
        let tiff: *mut AnyObject = msg_send![image, TIFFRepresentation];
        if tiff.is_null() {
            return Err("the captured image has no bitmap".into());
        }
        let rep: *mut AnyObject = msg_send![class!(NSBitmapImageRep), imageRepWithData: tiff];
        if rep.is_null() {
            return Err("the captured image has no bitmap".into());
        }
        let none: *mut AnyObject = msg_send![class!(NSDictionary), dictionary];
        let png = bytes(msg_send![rep, representationUsingType: NS_BITMAP_PNG, properties: none]);
        if !png.is_empty() && png.len() <= super::MAX_PNG {
            return Ok(("image/png", png));
        }
        let factor: *mut AnyObject = msg_send![class!(NSNumber), numberWithDouble: 0.75f64];
        let key: *mut AnyObject = msg_send![class!(NSString), stringWithUTF8String: c"NSImageCompressionFactor".as_ptr()];
        let props: *mut AnyObject = msg_send![class!(NSDictionary), dictionaryWithObject: factor, forKey: key];
        let jpeg = bytes(msg_send![rep, representationUsingType: NS_BITMAP_JPEG, properties: props]);
        if jpeg.is_empty() {
            Err("encoding the captured image failed".into())
        } else {
            Ok(("image/jpeg", jpeg))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn echo(method: &str, params: Value) -> Result<Value, String> {
        if params.get("fail").is_some() {
            return Err("nope".into());
        }
        Ok(json!([{ "type": "text", "text": format!("{method} {params}") }]))
    }

    fn parse(s: String) -> Value {
        serde_json::from_str(&s).unwrap()
    }

    #[test]
    fn known_tools_reach_the_webview() {
        let r = parse(answer_line(r#"{"id":3,"method":"desktop_terminal_read","params":{"pane":1}}"#, &echo));
        assert_eq!(r["id"], 3);
        assert_eq!(r["content"][0]["text"], r#"desktop_terminal_read {"pane":1}"#);
    }

    #[test]
    fn errors_and_unknown_tools_come_back_as_error() {
        let r = parse(answer_line(r#"{"id":"a","method":"desktop_browser_read","params":{"fail":1}}"#, &echo));
        assert_eq!(r, json!({ "id": "a", "error": "nope" }));
        let r = parse(answer_line(r#"{"id":4,"method":"pty_write","params":{}}"#, &echo));
        assert_eq!(r["error"], "unknown tool pty_write");
        let r = parse(answer_line("not json", &echo));
        assert!(r["error"].as_str().unwrap().starts_with("bad request"));
        assert_eq!(r["id"], Value::Null);
    }

    #[test]
    fn missing_or_odd_params_become_an_empty_object() {
        let r = parse(answer_line(r#"{"id":1,"method":"desktop_list_panes"}"#, &echo));
        assert_eq!(r["content"][0]["text"], "desktop_list_panes {}");
        let r = parse(answer_line(r#"{"id":1,"method":"desktop_list_panes","params":[1]}"#, &echo));
        assert_eq!(r["content"][0]["text"], "desktop_list_panes {}");
    }

    #[test]
    fn the_webview_answer_wakes_the_waiting_ask() {
        let (tx, rx) = mpsc::channel();
        PENDING.lock().unwrap().insert(9_999, tx);
        mcp_answer(9_999, Some(json!([{ "type": "text", "text": "hi" }])), None);
        assert_eq!(rx.recv().unwrap().unwrap()[0]["text"], "hi");
        assert!(!PENDING.lock().unwrap().contains_key(&9_999));
        // A late answer for a timed-out ask is dropped quietly.
        mcp_answer(9_999, None, Some("late".into()));
    }

    #[test]
    fn registration_detects_an_existing_desktop_server() {
        assert!(registered(r#"{"mcpServers":{"desktop":{"command":"/x"}}}"#));
        assert!(!registered(r#"{"mcpServers":{"mnemo":{}}}"#));
        assert!(!registered(r#"{"projects":{"/r":{"mcpServers":{"desktop":{}}}}}"#));
        assert!(!registered(""));
    }

    #[test]
    fn mcp_json_and_add_command_point_at_the_binary() {
        let bin = Path::new("/Users/me/.mnemo-desktop/bin/mnemo-desktop-mcp");
        assert_eq!(mcp_json(bin)["mcpServers"]["desktop"]["command"], bin.display().to_string());
        assert_eq!(add_command(bin), "claude mcp add --scope user desktop -- '/Users/me/.mnemo-desktop/bin/mnemo-desktop-mcp'");
        assert_eq!(add_command(Path::new("/a b/it's")), r"claude mcp add --scope user desktop -- '/a b/it'\''s'");
    }

    #[cfg(unix)]
    fn scratch(tag: &str) -> PathBuf {
        let d = crate::testutil::temp_dir(&format!("mcp-{tag}"));
        d
    }

    #[cfg(unix)]
    #[test]
    fn the_socket_answers_line_by_line_and_replaces_a_stale_one() {
        use std::io::{BufRead, BufReader, Write};
        use std::os::unix::fs::PermissionsExt;
        use std::os::unix::net::UnixStream;

        let dir = scratch("sock");
        let path = dir.join("mcp.sock");
        std::fs::write(&path, "stale").unwrap();
        let listener = bind(&path).unwrap();
        assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
        std::thread::spawn(move || serve(listener, std::sync::Arc::new(echo)));

        let stream = UnixStream::connect(&path).unwrap();
        let mut out = stream.try_clone().unwrap();
        let mut lines = BufReader::new(stream).lines();
        writeln!(out, r#"{{"id":1,"method":"desktop_list_panes"}}"#).unwrap();
        writeln!(out).unwrap();
        writeln!(out, r#"{{"id":2,"method":"nope"}}"#).unwrap();
        assert_eq!(parse(lines.next().unwrap().unwrap())["id"], 1);
        assert_eq!(parse(lines.next().unwrap().unwrap())["error"], "unknown tool nope");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[cfg(unix)]
    #[test]
    fn relink_points_the_stable_path_at_the_latest_build() {
        let dir = scratch("link");
        let (a, b, link) = (dir.join("a"), dir.join("b"), dir.join("bin/mnemo-desktop-mcp"));
        std::fs::write(&a, "").unwrap();
        std::fs::write(&b, "").unwrap();
        relink(&a, &link).unwrap();
        assert_eq!(std::fs::read_link(&link).unwrap(), a);
        relink(&a, &link).unwrap();
        relink(&b, &link).unwrap();
        assert_eq!(std::fs::read_link(&link).unwrap(), b);
        let _ = std::fs::remove_dir_all(dir);
    }
}

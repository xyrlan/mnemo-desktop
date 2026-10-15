//! Desktop MCP (issue #74): the app serves the Claude Code sessions it hosts structured reads of
//! the Nexus's sessions: the drawer's tabs, and the terminals the app runs with no view on screen
//! (spec `2026-10-15-nexus-app-design.md`, Q16).
//!
//! ```text
//! claude ──stdio JSON-RPC──▶ mnemo-desktop-mcp ──unix socket, one JSON line each way──▶ app
//!                                                   app ──`mcp://ask`──▶ webview (src/mcp/)
//!                                                   app ◀──`mcp_answer`── webview
//! ```
//!
//! The binary (`src/bin/mnemo-desktop-mcp.rs`) owns the MCP protocol; this side only
//! relays a tool name and its arguments to the webview, which knows the sessions, and hands
//! back MCP `content`. The socket is bound when the webview first asks for its path, so
//! nothing is served before something can answer.
//!
//! Eyes (spec 2026-09-24, *Eyes first*): `desktop_app_snapshot` is a picture of the app's own
//! main webview, taken here rather than by the webview, so a page that hangs can still be
//! seen. `desktop_app_drive` (click, type, keys, script) runs in the webview and is served by
//! a debug build only: a release app is full of terminals no session should type into.

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
/// `desktop_browser_read` and `desktop_pane_snapshot` went with the workbench's browser panes (Q16).
pub const TOOLS: &[&str] = &["desktop_list_panes", "desktop_terminal_read", APP_SNAPSHOT];
/// Tools only a debug build serves (`pnpm tauri dev`), on top of `TOOLS`.
pub const DEV_TOOLS: &[&str] = &[APP_DRIVE];
/// A picture of the app's main webview, answered here without asking the webview.
pub const APP_SNAPSHOT: &str = "desktop_app_snapshot";
pub const APP_DRIVE: &str = "desktop_app_drive";

/// Why no tool works on Windows. Keep in step with `UNAVAILABLE` in `src/bin/mnemo-desktop-mcp.rs`,
/// which lists the tools. Design Mode's snapshot does not go through the MCP and works there.
pub const UNAVAILABLE: &str =
    "The desktop MCP is not available on Windows: the app serves it over a Unix socket, and Windows has no server for it yet.";

/// Whether the desktop MCP can be served on `os` (`std::env::consts::OS`) at all.
pub fn available_on(os: &str) -> bool {
    os != "windows"
}

/// Whether this build serves `method`.
pub fn serves(method: &str) -> bool {
    serves_in(method, cfg!(debug_assertions))
}

pub fn serves_in(method: &str, debug: bool) -> bool {
    TOOLS.contains(&method) || (debug && DEV_TOOLS.contains(&method))
}
/// The socket the binary connects to; the app exports it into every pane (`pane_env`).
pub const SOCKET_ENV: &str = "MNEMO_DESKTOP_MCP_SOCKET";

const MAIN: &str = "main";
const ANSWER_TIMEOUT: Duration = Duration::from_secs(20);
const PAGE_TIMEOUT: Duration = Duration::from_secs(10);

use crate::app_dir::{app_dir, home};

/// Where this app serves: in its own app dir, so a debug build never takes the installed
/// app's socket. `SOCKET_ENV` is not read here: the app exports it into its panes (see
/// `pane_env`), so an app started from another app's pane would inherit that app's socket.
pub fn socket_path() -> PathBuf {
    app_dir().join("mcp.sock")
}

/// What a pane's environment carries so a session in it reaches this app, not another
/// instance: the binary Claude Code starts is found through the user's registration, which
/// may be another build's, and falls back to the release socket without it. Nothing where
/// no socket is ever served: the pane gets no `SOCKET_ENV` at all (`pty::command`).
pub fn pane_env() -> Option<(&'static str, PathBuf)> {
    available_on(std::env::consts::OS).then(|| (SOCKET_ENV, socket_path()))
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
        Ok(req) if !serves(&req.method) => {
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

/// What `mcp_socket_path` tells the webview: where the app serves, or, on a system where it
/// cannot (`available_on`), why, which the webview shows. `unavailable` is set at the first
/// start only (`unavailable_said`): the person is told once, not at every launch.
#[derive(serde::Serialize, Debug, PartialEq)]
pub struct Serving {
    pub socket: Option<String>,
    pub unavailable: Option<String>,
}

/// Where the app serves the MCP binary. The first call binds the socket and refreshes the
/// session registration (`~/.mnemo-desktop/mcp.json`, the user-scope `claude mcp` entry).
#[tauri::command]
pub fn mcp_socket_path<R: Runtime>(app: AppHandle<R>) -> Serving {
    if !available_on(std::env::consts::OS) {
        log::info!("mcp: not serving: {UNAVAILABLE}");
        return Serving { socket: None, unavailable: unavailable_said(&app_dir().join("mcp-unavailable-said")) };
    }
    let path = socket_path();
    let started = STARTED.get_or_init(|| start(app, &path));
    if let Err(e) = started {
        log::warn!("mcp: not serving: {e}");
    }
    Serving { socket: Some(path.display().to_string()), unavailable: None }
}

/// `UNAVAILABLE` the first time it is asked for, then `None`: `marker` remembers it was said.
/// A marker that cannot be written says it again next time rather than never.
pub fn unavailable_said(marker: &Path) -> Option<String> {
    if marker.exists() {
        return None;
    }
    if let Some(dir) = marker.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let _ = std::fs::write(marker, "");
    Some(UNAVAILABLE.into())
}

#[cfg(unix)]
fn start<R: Runtime>(app: AppHandle<R>, path: &Path) -> Result<(), String> {
    let listener = bind(path)?;
    let asker = app.clone();
    let ask = std::sync::Arc::new(move |method: &str, params: Value| match method {
        APP_SNAPSHOT => app_snapshot(&asker),
        _ => ask_webview(&asker, method, params),
    });
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
    Err(UNAVAILABLE.into())
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
// Browser panes: the page's own reads, which only the child webview can make. Design Mode makes
// them (`src/browser/design-live.ts`); no MCP tool does any more.

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

fn base64(bytes: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

/// What the pane's page shows, as `{ mime, data }` with base64 data.
#[tauri::command]
pub async fn mcp_browser_snapshot<R: Runtime>(app: AppHandle<R>, id: i64) -> Result<Value, String> {
    let webview = browser_webview(&app, id)?;
    let (mime, bytes) = snapshot(&webview).await?;
    Ok(json!({ "mime": mime, "data": base64(&bytes) }))
}

/// `desktop_app_snapshot`: the app's main webview as MCP image content. Browser panes are
/// webviews of their own laid over it, so they show as the space they leave. A WebGL canvas
/// without `preserveDrawingBuffer`
/// (xterm's renderer) has nothing to paint by the time WebKit draws the snapshot, and comes
/// out blank. Blocks: it runs on the socket's thread.
fn app_snapshot<R: Runtime>(app: &AppHandle<R>) -> Answer {
    let webview = app.get_webview(MAIN).ok_or("the app window is not open")?;
    let (mime, bytes) = tauri::async_runtime::block_on(snapshot(&webview))?;
    Ok(image_content(mime, &bytes))
}

pub fn image_content(mime: &str, bytes: &[u8]) -> Value {
    json!([{ "type": "image", "data": base64(bytes), "mimeType": mime }])
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

#[cfg(windows)]
async fn snapshot<R: Runtime>(webview: &tauri::Webview<R>) -> Result<(&'static str, Vec<u8>), String> {
    let (tx, rx) = mpsc::channel();
    webview
        .with_webview(move |platform| {
            // Runs on the main thread, where WebView2 calls the completion handler as well.
            webview2::take_snapshot(platform.controller(), tx)
        })
        .map_err(|e| e.to_string())?;
    wait(rx, "snapshot").await?
}

#[cfg(target_os = "linux")]
async fn snapshot<R: Runtime>(webview: &tauri::Webview<R>) -> Result<(&'static str, Vec<u8>), String> {
    let (tx, rx) = mpsc::channel();
    webview
        .with_webview(move |platform| {
            // Runs on GTK's main thread, whose loop calls WebKit's callback as well.
            webkitgtk::take_snapshot(&platform.inner(), tx)
        })
        .map_err(|e| e.to_string())?;
    wait(rx, "snapshot").await?
}

#[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
async fn snapshot<R: Runtime>(_webview: &tauri::Webview<R>) -> Result<(&'static str, Vec<u8>), String> {
    Err(format!("the app cannot take a picture of a page on {}", std::env::consts::OS))
}

/// `MNEMO_DESKTOP_SMOKE=snapshot`: the built app takes a picture of its own window through the
/// same `snapshot` Design Mode uses, and exits 0 when it is an image,
/// 1 otherwise. CI runs it on all three systems: the only real webview a test can capture there.
/// The process exits itself: `AppHandle::exit(1)` was seen to end it with 0 on macOS.
pub fn smoke_snapshot<R: Runtime>(app: AppHandle<R>) {
    std::thread::spawn(move || {
        let deadline = std::time::Instant::now() + Duration::from_secs(30);
        let mut last = String::from("the window never opened");
        while std::time::Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(500));
            let Some(webview) = app.get_webview(MAIN) else { continue };
            match tauri::async_runtime::block_on(snapshot(&webview)).and_then(|(mime, bytes)| image_size(mime, &bytes).map(|size| (mime, bytes.len(), size))) {
                Ok((mime, len, (w, h))) => {
                    let window = webview.window().inner_size().map(|s| format!("{}x{}", s.width, s.height)).unwrap_or_default();
                    eprintln!("smoke: snapshot ok: {mime}, {w}x{h}, {len} bytes (window {window})");
                    std::process::exit(0);
                }
                Err(e) => {
                    eprintln!("smoke: snapshot attempt: {e}");
                    last = e;
                }
            }
        }
        eprintln!("smoke: snapshot FAILED: {last}");
        std::process::exit(1);
    });
}

/// The pixel size a PNG or JPEG says it has; an error when it is neither or says nothing.
pub fn image_size(mime: &str, bytes: &[u8]) -> Result<(u32, u32), String> {
    let be16 = |b: &[u8]| u32::from(u16::from_be_bytes([b[0], b[1]]));
    let size = match mime {
        "image/png" if bytes.len() >= 24 && bytes.starts_with(b"\x89PNG\r\n\x1a\n") && &bytes[12..16] == b"IHDR" => {
            let be32 = |b: &[u8]| u32::from_be_bytes([b[0], b[1], b[2], b[3]]);
            Some((be32(&bytes[16..20]), be32(&bytes[20..24])))
        }
        // The first start-of-frame segment (SOF0..SOF15, less DHT, JPG and DAC) has the size.
        "image/jpeg" if bytes.starts_with(&[0xFF, 0xD8]) => {
            let mut i = 2;
            let mut found = None;
            while i + 9 <= bytes.len() && bytes[i] == 0xFF {
                let marker = bytes[i + 1];
                if (0xC0..=0xCF).contains(&marker) && ![0xC4, 0xC8, 0xCC].contains(&marker) {
                    found = Some((be16(&bytes[i + 7..]), be16(&bytes[i + 5..])));
                    break;
                }
                i += 2 + be16(&bytes[i + 2..]) as usize;
            }
            found
        }
        _ => None,
    };
    match size {
        Some((w, h)) if w > 0 && h > 0 => Ok((w, h)),
        _ => Err(format!("the snapshot is not a {mime} with a size ({} bytes)", bytes.len())),
    }
}

#[cfg(windows)]
mod webview2 {
    use std::sync::mpsc::Sender;

    use webview2_com::CapturePreviewCompletedHandler;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Controller, COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT, COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_JPEG,
        COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG,
    };
    use windows::Win32::System::Com::{IStream, STREAM_SEEK_END, STREAM_SEEK_SET};
    use windows::Win32::UI::Shell::SHCreateMemStream;

    type Shot = Result<(&'static str, Vec<u8>), String>;

    /// The page as WebView2 draws it, as a PNG, or a JPEG when the PNG is past `MAX_PNG`.
    pub fn take_snapshot(controller: ICoreWebView2Controller, tx: Sender<Shot>) {
        capture(controller, COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG, tx);
    }

    fn capture(controller: ICoreWebView2Controller, format: COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT, tx: Sender<Shot>) {
        let png = format == COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG;
        let mime = if png { "image/png" } else { "image/jpeg" };
        let started = (|| -> Result<(), String> {
            // SAFETY: COM calls on the webview's own (main) thread, where it was created.
            unsafe {
                let webview = controller.CoreWebView2().map_err(|e| format!("the page is gone: {}", e.message()))?;
                let stream = SHCreateMemStream(None).ok_or("no memory for the picture")?;
                let (out, done, again) = (stream.clone(), tx.clone(), controller.clone());
                let handler = CapturePreviewCompletedHandler::create(Box::new(move |result: windows::core::Result<()>| {
                    let shot = result.map_err(|e| format!("the page could not be captured: {}", e.message())).and_then(|()| read(&out));
                    match shot {
                        Ok(bytes) if png && bytes.len() > super::MAX_PNG => capture(again, COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_JPEG, done),
                        Ok(bytes) if bytes.is_empty() => {
                            let _ = done.send(Err("the page could not be captured: WebView2 gave an empty picture".into()));
                        }
                        Ok(bytes) => {
                            let _ = done.send(Ok((mime, bytes)));
                        }
                        Err(e) => {
                            let _ = done.send(Err(e));
                        }
                    }
                    Ok(())
                }));
                webview.CapturePreview(format, &stream, &handler).map_err(|e| format!("the page could not be captured: {}", e.message()))
            }
        })();
        if let Err(e) = started {
            let _ = tx.send(Err(e));
        }
    }

    unsafe fn read(stream: &IStream) -> Result<Vec<u8>, String> {
        let failed = |e: windows::core::Error| format!("reading the captured picture failed: {}", e.message());
        let mut len = 0u64;
        stream.Seek(0, STREAM_SEEK_END, Some(&mut len)).map_err(failed)?;
        stream.Seek(0, STREAM_SEEK_SET, None).map_err(failed)?;
        let mut bytes = vec![0u8; len as usize];
        let mut filled = 0usize;
        while filled < bytes.len() {
            let mut got = 0u32;
            let rest = (bytes.len() - filled).min(u32::MAX as usize) as u32;
            stream.Read(bytes[filled..].as_mut_ptr().cast(), rest, Some(&mut got)).ok().map_err(failed)?;
            if got == 0 {
                break;
            }
            filled += got as usize;
        }
        bytes.truncate(filled);
        Ok(bytes)
    }
}

#[cfg(target_os = "linux")]
mod webkitgtk {
    use std::sync::mpsc::Sender;

    use gdk::gdk_pixbuf::Pixbuf;
    use webkit2gtk::{SnapshotOptions, SnapshotRegion, WebView, WebViewExt};

    type Shot = Result<(&'static str, Vec<u8>), String>;

    /// What the page shows on screen, as a PNG, or a JPEG when the PNG is past `MAX_PNG`.
    pub fn take_snapshot(webview: &WebView, tx: Sender<Shot>) {
        webview.snapshot(SnapshotRegion::Visible, SnapshotOptions::NONE, None::<&webkit2gtk::gio::Cancellable>, move |result| {
            let shot = result.map_err(|e| format!("the page could not be captured: {e}")).and_then(encode);
            let _ = tx.send(shot);
        });
    }

    fn encode(surface: gdk::cairo::Surface) -> Shot {
        let image = gdk::cairo::ImageSurface::try_from(surface).map_err(|_| "the captured image has no bitmap".to_string())?;
        let pixbuf: Pixbuf = gdk::pixbuf_get_from_surface(&image, 0, 0, image.width(), image.height()).ok_or("the captured image has no bitmap")?;
        let png = pixbuf.save_to_bufferv("png", &[]).map_err(|e| format!("encoding the captured image failed: {e}"))?;
        if png.len() <= super::MAX_PNG {
            return Ok(("image/png", png));
        }
        let jpeg = pixbuf.save_to_bufferv("jpeg", &[("quality", "75")]).map_err(|e| format!("encoding the captured image failed: {e}"))?;
        Ok(("image/jpeg", jpeg))
    }
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
        let r = parse(answer_line(r#"{"id":"a","method":"desktop_terminal_read","params":{"fail":1}}"#, &echo));
        assert_eq!(r, json!({ "id": "a", "error": "nope" }));
        let r = parse(answer_line(r#"{"id":4,"method":"pty_write","params":{}}"#, &echo));
        assert_eq!(r["error"], "unknown tool pty_write");
        // Gone with the workbench's browser panes: refused before the webview hears of them.
        for gone in ["desktop_browser_read", "desktop_pane_snapshot"] {
            assert!(!serves_in(gone, true), "{gone}");
            let r = parse(answer_line(&json!({ "id": 5, "method": gone, "params": { "pane": -1 } }).to_string(), &echo));
            assert_eq!(r["error"], format!("unknown tool {gone}"));
        }
        let r = parse(answer_line("not json", &echo));
        assert!(r["error"].as_str().unwrap().starts_with("bad request"));
        assert_eq!(r["id"], Value::Null);
    }

    #[test]
    fn the_app_tools_are_served_and_driving_only_by_a_debug_build() {
        assert!(serves_in(APP_SNAPSHOT, false) && serves_in(APP_SNAPSHOT, true));
        assert!(serves_in(APP_DRIVE, true));
        assert!(!serves_in(APP_DRIVE, false), "a release build must never be driven");
        assert!(!serves_in("pty_write", true));
        // `cargo test` is a debug build, like `tauri dev`.
        let r = parse(answer_line(r#"{"id":1,"method":"desktop_app_drive","params":{"action":"eval","js":"1"}}"#, &echo));
        assert_eq!(r["content"][0]["text"], r#"desktop_app_drive {"action":"eval","js":"1"}"#);
    }

    #[test]
    fn a_system_that_cannot_serve_says_so_once_and_exports_no_socket() {
        assert_eq!(pane_env().is_some(), !cfg!(windows));
        assert!(available_on("macos") && available_on("linux") && !available_on("windows"));
        let marker = crate::testutil::temp_dir("mcp-unavailable").join("mcp-unavailable-said");
        assert_eq!(unavailable_said(&marker).as_deref(), Some(UNAVAILABLE));
        assert_eq!(unavailable_said(&marker), None, "said once");
        let _ = std::fs::remove_dir_all(marker.parent().unwrap());
    }

    #[test]
    fn a_snapshot_is_image_content() {
        let c = image_content("image/png", b"\x89PNG");
        assert_eq!(c, json!([{ "type": "image", "data": "iVBORw==", "mimeType": "image/png" }]));
    }

    #[test]
    fn the_smoke_reads_the_size_an_image_says_it_has() {
        let png = [&b"\x89PNG\r\n\x1a\n\0\0\0\x0dIHDR"[..], &640u32.to_be_bytes(), &480u32.to_be_bytes()].concat();
        assert_eq!(image_size("image/png", &png), Ok((640, 480)));
        // SOI, an APP0 of 4 bytes, then SOF0: length, precision, height 2, width 3.
        let jpeg = [0xFF, 0xD8, 0xFF, 0xE0, 0, 4, 0, 0, 0xFF, 0xC0, 0, 11, 8, 0, 2, 0, 3, 1, 0, 0, 0];
        assert_eq!(image_size("image/jpeg", &jpeg), Ok((3, 2)));
        assert!(image_size("image/png", &jpeg).is_err());
        assert!(image_size("image/png", &[&png[..16], &[0; 8]].concat()).is_err(), "no size");
        assert!(image_size("image/jpeg", b"").is_err());
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

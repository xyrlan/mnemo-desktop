//! Browser panes: one native child webview per pane, laid over the pane's rectangle
//! in the main window. An `<iframe>` cannot show most sites (X-Frame-Options), so the
//! page lives outside the DOM and the frontend keeps its bounds in sync.
//!
//! Coordinates are logical pixels relative to the main window's content area, which is
//! what `getBoundingClientRect` reports in the main webview.

use serde::Serialize;
use tauri::webview::{NewWindowResponse, PageLoadEvent};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Rect, Runtime, Url, Webview, WebviewBuilder, WebviewUrl, Window};

/// Pane ids are the store's synthetic (negative) ids.
pub type BrowserId = i64;

/// The main window, which both hosts the child webviews and receives their events.
const MAIN: &str = "main";

pub fn label_for(id: BrowserId) -> String {
    if id < 0 {
        format!("browser-n{}", id.unsigned_abs())
    } else {
        format!("browser-{id}")
    }
}

/// What a pane may be pointed at, by the user or `browser_create`: web pages only.
pub fn openable(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https") || url.as_str() == "about:blank"
}

/// What the page itself may navigate to. Subframes can also load `about:srcdoc`, `data:`
/// and `blob:`; everything else (`tauri:`, `file:`, custom protocols) is refused, as is
/// the app's own origin (`app`), where the IPC bridge trusts whatever loads.
pub fn navigable(url: &Url, app: Option<&Url>) -> bool {
    let scheme_ok = matches!(url.scheme(), "http" | "https" | "about" | "data" | "blob");
    // Opaque origins (`tauri://`) never compare equal; the scheme check covers those.
    scheme_ok && app.map_or(true, |a| a.origin() != url.origin())
}

pub fn parse(url: &str) -> Result<Url, String> {
    let parsed = Url::parse(url.trim()).map_err(|e| format!("invalid url {url:?}: {e}"))?;
    if openable(&parsed) {
        Ok(parsed)
    } else {
        Err(format!("refusing to open {url:?}: only http(s) urls are allowed"))
    }
}

/// A zero-area rectangle means "not on screen" (inactive tab, palette open).
pub fn visible(w: f64, h: f64) -> bool {
    w > 0.0 && h > 0.0
}

#[derive(Serialize, Clone)]
struct StatePayload {
    url: String,
    loading: bool,
}

#[derive(Serialize, Clone)]
struct TitlePayload {
    title: String,
}

fn find<R: Runtime>(app: &AppHandle<R>, id: BrowserId) -> Result<Webview<R>, String> {
    app.get_webview(&label_for(id)).ok_or_else(|| format!("no browser pane {id}"))
}

/// Where the main webview's CSS viewport starts inside the window's native content view.
/// On macOS the content view runs under the titlebar and WebKit insets the page below it,
/// while wry positions children against the whole view: without this, a child lands a
/// titlebar's height above the rectangle the frontend measured.
#[cfg(target_os = "macos")]
fn viewport_origin<R: Runtime>(window: &Window<R>) -> (f64, f64) {
    use objc2::encode::{Encode, Encoding};
    use objc2::msg_send;
    use objc2::runtime::AnyObject;

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct CGPoint(f64, f64);
    #[repr(C)]
    #[derive(Clone, Copy)]
    struct CGSize(f64, f64);
    #[repr(C)]
    #[derive(Clone, Copy)]
    struct CGRect(CGPoint, CGSize);
    unsafe impl Encode for CGPoint {
        const ENCODING: Encoding = Encoding::Struct("CGPoint", &[f64::ENCODING, f64::ENCODING]);
    }
    unsafe impl Encode for CGSize {
        const ENCODING: Encoding = Encoding::Struct("CGSize", &[f64::ENCODING, f64::ENCODING]);
    }
    unsafe impl Encode for CGRect {
        const ENCODING: Encoding = Encoding::Struct("CGRect", &[CGPoint::ENCODING, CGSize::ENCODING]);
    }

    let Ok(ns_window) = window.ns_window() else { return (0.0, 0.0) };
    let ns_window = ns_window as usize;
    let (tx, rx) = std::sync::mpsc::channel();
    // AppKit getters belong on the main thread; commands run on the async pool.
    let asked = window.run_on_main_thread(move || {
        let origin = unsafe {
            let win = ns_window as *mut AnyObject;
            let view: *mut AnyObject = msg_send![win, contentView];
            if view.is_null() {
                (0.0, 0.0)
            } else {
                let frame: CGRect = msg_send![view, frame];
                let layout: CGRect = msg_send![win, contentLayoutRect];
                (layout.0 .0, frame.1 .1 - (layout.0 .1 + layout.1 .1))
            }
        };
        let _ = tx.send(origin);
    });
    if asked.is_err() {
        return (0.0, 0.0);
    }
    rx.recv().unwrap_or((0.0, 0.0))
}

#[cfg(not(target_os = "macos"))]
fn viewport_origin<R: Runtime>(_window: &Window<R>) -> (f64, f64) {
    (0.0, 0.0)
}

fn place<R: Runtime>(webview: &Webview<R>, x: f64, y: f64, w: f64, h: f64) -> Result<(), String> {
    if !visible(w, h) {
        return webview.hide().map_err(|e| e.to_string());
    }
    let (dx, dy) = viewport_origin(&webview.window());
    webview
        .set_bounds(Rect { position: LogicalPosition::new(x + dx, y + dy).into(), size: LogicalSize::new(w, h).into() })
        .map_err(|e| e.to_string())?;
    webview.show().map_err(|e| e.to_string())
}

// Commands that build or look up webviews are `async` so they run off the main thread:
// `Window::add_child` blocks on the main thread and deadlocks on Windows otherwise.

#[tauri::command]
pub async fn browser_create<R: Runtime>(
    app: AppHandle<R>,
    id: BrowserId,
    url: String,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
) -> Result<(), String> {
    let target = parse(&url)?;
    // Idempotent: React StrictMode mounts twice, and a remount must not stack webviews.
    if let Ok(existing) = find(&app, id) {
        existing.navigate(target).map_err(|e| e.to_string())?;
        return place(&existing, x, y, w, h);
    }
    let window = app.get_window(MAIN).ok_or("main window is gone")?;
    let label = label_for(id);

    let app_url = app.get_webview(MAIN).and_then(|w| w.url().ok());
    let state_app = app.clone();
    let title_app = app.clone();
    let popup_app = app.clone();
    let popup_label = label.clone();
    let builder = WebviewBuilder::new(&label, WebviewUrl::External(target))
        .on_navigation(move |url| navigable(url, app_url.as_ref()))
        .on_page_load(move |_, payload| {
            let loading = matches!(payload.event(), PageLoadEvent::Started);
            let state = StatePayload { url: payload.url().to_string(), loading };
            let _ = state_app.emit_to(MAIN, &format!("browser://state/{id}"), state);
        })
        .on_document_title_changed(move |_, title| {
            let _ = title_app.emit_to(MAIN, &format!("browser://title/{id}"), TitlePayload { title });
        })
        // No tabs inside a pane: links that want a new window open in place.
        .on_new_window(move |url, _| {
            if openable(&url) {
                if let Some(webview) = popup_app.get_webview(&popup_label) {
                    let _ = webview.navigate(url);
                }
            }
            NewWindowResponse::Deny
        });

    let (dx, dy) = viewport_origin(&window);
    let size = if visible(w, h) { LogicalSize::new(w, h) } else { LogicalSize::new(1.0, 1.0) };
    let webview = window
        .add_child(builder, LogicalPosition::new(x + dx, y + dy), size)
        .map_err(|e| e.to_string())?;
    if !visible(w, h) {
        webview.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn browser_navigate<R: Runtime>(app: AppHandle<R>, id: BrowserId, url: String) -> Result<(), String> {
    find(&app, id)?.navigate(parse(&url)?).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn browser_set_bounds<R: Runtime>(
    app: AppHandle<R>,
    id: BrowserId,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
) -> Result<(), String> {
    place(&find(&app, id)?, x, y, w, h)
}

/// Closing an unknown pane is not an error: the pane may never have been created.
#[tauri::command]
pub async fn browser_destroy<R: Runtime>(app: AppHandle<R>, id: BrowserId) -> Result<(), String> {
    match find(&app, id) {
        Ok(webview) => webview.close().map_err(|e| e.to_string()),
        Err(_) => Ok(()),
    }
}

#[tauri::command]
pub async fn browser_back<R: Runtime>(app: AppHandle<R>, id: BrowserId) -> Result<(), String> {
    find(&app, id)?.eval("history.back()").map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn browser_forward<R: Runtime>(app: AppHandle<R>, id: BrowserId) -> Result<(), String> {
    find(&app, id)?.eval("history.forward()").map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn browser_reload<R: Runtime>(app: AppHandle<R>, id: BrowserId) -> Result<(), String> {
    find(&app, id)?.reload().map_err(|e| e.to_string())
}

/// The open PR for the branch checked out in `cwd`, via `gh pr view`. `None` when `gh` is
/// missing, unauthenticated, or the branch has no PR: the palette action skips silently.
/// Runs through a login shell because apps launched from Finder/Dock get a bare PATH.
#[tauri::command]
pub async fn browser_pr_url(cwd: Option<String>) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || pr_url(cwd)).await.ok().flatten()
}

fn pr_url(cwd: Option<String>) -> Option<String> {
    const GH: &str = "gh pr view --json url --jq .url";
    let mut cmd = if cfg!(windows) {
        let mut c = std::process::Command::new("gh");
        c.args(["pr", "view", "--json", "url", "--jq", ".url"]);
        c
    } else {
        let mut c = std::process::Command::new(crate::pty::default_shell());
        c.args(["-l", "-c", GH]);
        c
    };
    if let Some(dir) = cwd.filter(|d| std::path::Path::new(d).is_dir()) {
        cmd.current_dir(dir);
    }
    let out = cmd.stdin(std::process::Stdio::null()).output().ok()?;
    if !out.status.success() {
        return None;
    }
    last_url(&String::from_utf8_lossy(&out.stdout))
}

/// A login shell may print banners before `gh`'s output; take the last line that parses.
pub fn last_url(stdout: &str) -> Option<String> {
    stdout
        .lines()
        .rev()
        .map(str::trim)
        .find_map(|l| Url::parse(l).ok().filter(|u| matches!(u.scheme(), "http" | "https")))
        .map(String::from)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels_are_valid_and_distinct() {
        assert_eq!(label_for(-3), "browser-n3");
        assert_eq!(label_for(3), "browser-3");
        assert_ne!(label_for(-3), label_for(3));
        let ok = |s: &str| s.chars().all(|c| c.is_ascii_alphanumeric() || "-/:_".contains(c));
        assert!(ok(&label_for(i64::MIN)));
    }

    #[test]
    fn only_web_urls_are_openable() {
        assert!(parse("https://github.com/x/y/pull/1").is_ok());
        assert!(parse("  http://localhost:3000/ ").is_ok());
        assert!(parse("about:blank").is_ok());
        assert!(parse("tauri://localhost/").is_err());
        assert!(parse("file:///etc/passwd").is_err());
        assert!(parse("javascript:alert(1)").is_err());
        assert!(parse("github.com").is_err());
    }

    #[test]
    fn pages_cannot_navigate_onto_the_app() {
        let u = |s: &str| Url::parse(s).unwrap();
        let dev = u("http://localhost:1420/");
        assert!(navigable(&u("http://localhost:3000/"), Some(&dev)));
        assert!(navigable(&u("about:srcdoc"), Some(&dev)));
        assert!(!navigable(&u("http://localhost:1420/index.html"), Some(&dev)));
        assert!(!navigable(&u("http://tauri.localhost/"), Some(&u("http://tauri.localhost/"))));
        assert!(!navigable(&u("tauri://localhost/"), Some(&u("tauri://localhost/"))));
        assert!(!navigable(&u("file:///etc/passwd"), None));
        assert!(navigable(&u("https://github.com/"), None));
    }

    #[test]
    fn zero_area_is_hidden() {
        assert!(visible(10.0, 10.0));
        assert!(!visible(0.0, 10.0));
        assert!(!visible(10.0, 0.0));
    }

    #[test]
    fn pr_url_skips_shell_noise() {
        assert_eq!(
            last_url("Welcome!\nhttps://github.com/o/r/pull/4\n").as_deref(),
            Some("https://github.com/o/r/pull/4")
        );
        assert_eq!(last_url("no pull requests found for branch \"x\"\n"), None);
        assert_eq!(last_url(""), None);
    }
}

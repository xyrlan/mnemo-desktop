//! James's orb (#503, #506): a small floating window that shows him while a conversation is on,
//! without the panel. It is made the first time it is shown, and is transparent, frameless, on
//! top, out of the taskbar, never focused and clicked through, so typing goes on in whatever was
//! in front. It sits at the bottom centre of the monitor holding the window in front, above the
//! taskbar. Its page is `orb.html`, which loads none of the app; `src/jarvis/orb/control.ts` says
//! when it shows and what it draws.

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

/// The orb's window label (`capabilities/orb.json` grants it what it listens to).
pub const LABEL: &str = "orb";
/// Its page, an entry of its own beside `index.html` (`vite.config.ts`).
pub const PAGE: &str = "orb.html";

/// How the orb's window is made. Every field is a `WebviewWindowBuilder` option, applied in
/// `builder`; the test pins them, since the orb taking focus would steal keystrokes.
#[derive(Debug, Clone, PartialEq)]
pub struct Options {
    /// Width and height, in logical px.
    pub size: f64,
    pub focusable: bool,
    pub focused: bool,
    pub skip_taskbar: bool,
    pub always_on_top: bool,
    pub transparent: bool,
    pub decorations: bool,
    pub shadow: bool,
    pub resizable: bool,
    /// Shown by `show`, never on creation.
    pub visible: bool,
    /// Clicks go to the window beneath (`set_ignore_cursor_events`).
    pub click_through: bool,
}

pub const OPTIONS: Options = Options {
    size: 220.0,
    focusable: false,
    focused: false,
    skip_taskbar: true,
    always_on_top: true,
    transparent: true,
    decorations: false,
    shadow: false,
    resizable: false,
    visible: false,
    click_through: true,
};

/// The gap between the orb and the bottom of the work area (the taskbar's top), in logical px.
pub const MARGIN: f64 = 24.0;

/// A rectangle in physical px, as Win32 and Tauri's monitors give them.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

impl Rect {
    fn contains(&self, x: i32, y: i32) -> bool {
        x >= self.x && y >= self.y && x < self.x + self.width as i32 && y < self.y + self.height as i32
    }
}

/// Where the orb goes in `work` (a monitor's area without its taskbar), at `scale`: its top-left
/// corner and its side, in physical px, centred and `MARGIN` above the bottom.
pub fn place(work: Rect, scale: f64) -> (i32, i32, u32) {
    let side = (OPTIONS.size * scale).round() as u32;
    let margin = (MARGIN * scale).round() as i32;
    let x = work.x + (work.width as i32 - side as i32) / 2;
    let y = work.y + work.height as i32 - side as i32 - margin;
    (x, y.max(work.y), side)
}

/// The config's `voice.orb`: on unless it is `false`, so a config without it gets the orb.
pub fn enabled(voice: &serde_json::Value) -> bool {
    voice.get("orb") != Some(&serde_json::Value::Bool(false))
}

/// The orb's window builder, with `OPTIONS`. macOS gets no transparency: it needs Tauri's private
/// API, which this app does not turn on.
fn builder<'a>(app: &'a AppHandle) -> WebviewWindowBuilder<'a, tauri::Wry, AppHandle> {
    let o = &OPTIONS;
    let b = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App(PAGE.into()))
        .title("James")
        .inner_size(o.size, o.size)
        .focusable(o.focusable)
        .focused(o.focused)
        .skip_taskbar(o.skip_taskbar)
        .always_on_top(o.always_on_top)
        .decorations(o.decorations)
        .shadow(o.shadow)
        .resizable(o.resizable)
        .visible(o.visible);
    #[cfg(not(target_os = "macos"))]
    let b = b.transparent(o.transparent);
    b
}

/// The orb's window, made the first time.
fn window(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(w) = app.get_webview_window(LABEL) {
        return Ok(w);
    }
    let w = builder(app).build().map_err(|e| format!("the orb's window: {e}"))?;
    w.set_ignore_cursor_events(OPTIONS.click_through).map_err(|e| e.to_string())?;
    Ok(w)
}

/// The work area of the monitor holding the window in front, in physical px.
#[cfg(windows)]
fn front_work_area() -> Option<Rect> {
    use windows_sys::Win32::Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTOPRIMARY};
    use windows_sys::Win32::UI::WindowsAndMessaging::GetForegroundWindow;
    // SAFETY: plain Win32 queries; `info` is sized as the call requires.
    unsafe {
        let monitor = MonitorFromWindow(GetForegroundWindow(), MONITOR_DEFAULTTOPRIMARY);
        let mut info: MONITORINFO = std::mem::zeroed();
        info.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
        if GetMonitorInfoW(monitor, &mut info) == 0 {
            return None;
        }
        let r = info.rcWork;
        Some(Rect { x: r.left, y: r.top, width: (r.right - r.left) as u32, height: (r.bottom - r.top) as u32 })
    }
}

#[cfg(not(windows))]
fn front_work_area() -> Option<Rect> {
    None
}

/// The work area the orb goes in and that monitor's scale: the one in front on Windows, the
/// primary elsewhere.
fn target(w: &WebviewWindow) -> Result<(Rect, f64), String> {
    let monitors = w.available_monitors().map_err(|e| e.to_string())?;
    let rect = |m: &tauri::Monitor| {
        let a = m.work_area();
        Rect { x: a.position.x, y: a.position.y, width: a.size.width, height: a.size.height }
    };
    if let Some(work) = front_work_area() {
        let (cx, cy) = (work.x + work.width as i32 / 2, work.y + work.height as i32 / 2);
        let scale = monitors.iter().find(|m| rect(m).contains(cx, cy)).map_or(1.0, |m| m.scale_factor());
        return Ok((work, scale));
    }
    let m = w.primary_monitor().map_err(|e| e.to_string())?.or_else(|| monitors.into_iter().next());
    m.map(|m| (rect(&m), m.scale_factor())).ok_or_else(|| "no monitor to show the orb on".to_string())
}

/// Shows the window without activating it: Tauri's `show` activates a window it did not create
/// visible, and the orb must never take the keyboard from the window in front.
#[cfg(windows)]
fn show_quietly(w: &WebviewWindow) -> Result<(), String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_SHOWNOACTIVATE};
    let hwnd = w.hwnd().map_err(|e| e.to_string())?;
    // SAFETY: the handle is the orb's own, alive while `w` is.
    unsafe { ShowWindow(hwnd.0 as _, SW_SHOWNOACTIVATE) };
    Ok(())
}

#[cfg(windows)]
fn hide_quietly(w: &WebviewWindow) -> Result<(), String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_HIDE};
    let hwnd = w.hwnd().map_err(|e| e.to_string())?;
    // SAFETY: as in `show_quietly`.
    unsafe { ShowWindow(hwnd.0 as _, SW_HIDE) };
    Ok(())
}

#[cfg(not(windows))]
fn show_quietly(w: &WebviewWindow) -> Result<(), String> {
    w.show().map_err(|e| e.to_string())
}

#[cfg(not(windows))]
fn hide_quietly(w: &WebviewWindow) -> Result<(), String> {
    w.hide().map_err(|e| e.to_string())
}

/// `jarvis_orb(show: bool) -> Result<(), String>`: shows the orb, at the bottom centre of the
/// monitor in front, or hides it. With the config's `voice.orb` set to `false` it does nothing.
/// Async: a window made from a synchronous command deadlocks on Windows.
#[tauri::command]
pub async fn jarvis_orb(app: AppHandle, show: bool) -> Result<(), String> {
    if !show {
        return app.get_webview_window(LABEL).map_or(Ok(()), |w| hide_quietly(&w));
    }
    if !enabled(&crate::jarvis::section("voice")?) {
        return Ok(());
    }
    let w = window(&app)?;
    let (work, scale) = target(&w)?;
    let (x, y, side) = place(work, scale);
    w.set_size(tauri::PhysicalSize::new(side, side)).map_err(|e| e.to_string())?;
    w.set_position(tauri::PhysicalPosition::new(x, y)).map_err(|e| e.to_string())?;
    show_quietly(&w)?;
    // Hidden, a window can drop out of the topmost band; shown again, it goes back on top.
    w.set_always_on_top(OPTIONS.always_on_top).map_err(|e| e.to_string())
}

/// `jarvis_orb_enabled() -> Result<bool, String>`: the config's `voice.orb`, read now. The panel
/// opens for a take only when there is no orb to show it (`src/jarvis/view.tsx`).
#[tauri::command]
pub fn jarvis_orb_enabled() -> Result<bool, String> {
    Ok(enabled(&crate::jarvis::section("voice")?))
}

/// The main window went: the orb goes with it, or the app would go on running with only an
/// invisible window left.
pub fn main_closed(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.destroy();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn the_orb_never_takes_focus_or_clicks_and_stays_out_of_the_taskbar() {
        let o = &OPTIONS;
        assert!(!o.focusable && !o.focused, "the orb must never take the keyboard");
        assert!(o.click_through, "clicks go to the window beneath");
        assert!(o.skip_taskbar && o.always_on_top);
        assert!(o.transparent && !o.decorations && !o.shadow && !o.resizable);
        assert!(!o.visible, "it is shown by jarvis_orb, not on creation");
        assert_eq!(o.size, 220.0);
    }

    #[test]
    fn the_builder_applies_every_option() {
        // Each option of `OPTIONS` is read in `builder`: one left out would be a default, and
        // Tauri's defaults are the opposite of the orb's (focusable, framed, in the taskbar).
        let src = include_str!("jarvis_orb.rs");
        let body = &src[src.find("fn builder").unwrap()..src.find("/// The orb's window, made").unwrap()];
        for field in ["size", "focusable", "focused", "skip_taskbar", "always_on_top", "decorations", "shadow", "resizable", "visible", "transparent"] {
            assert!(body.contains(&format!("o.{field}")), "builder does not apply {field}");
        }
        let window = &src[src.find("fn window(").unwrap()..];
        assert!(window.contains("set_ignore_cursor_events(OPTIONS.click_through)"));
    }

    #[test]
    fn it_sits_at_the_bottom_centre_above_the_taskbar() {
        // 1920×1080 with a 48 px taskbar at the bottom.
        let work = Rect { x: 0, y: 0, width: 1920, height: 1032 };
        assert_eq!(place(work, 1.0), (850, 1032 - 220 - 24, 220));
        // At 150 %, everything scales.
        assert_eq!(place(work, 1.5), (795, 1032 - 330 - 36, 330));
        // A second monitor to the left, with its taskbar on top.
        let left = Rect { x: -2560, y: 40, width: 2560, height: 1400 };
        assert_eq!(place(left, 1.0), (-2560 + 1170, 40 + 1400 - 244, 220));
    }

    #[test]
    fn a_work_area_smaller_than_the_orb_keeps_it_on_screen() {
        let tiny = Rect { x: 0, y: 100, width: 200, height: 150 };
        let (_, y, _) = place(tiny, 1.0);
        assert_eq!(y, 100);
    }

    #[test]
    fn the_orb_is_on_unless_the_config_says_false() {
        assert!(enabled(&json!(null)));
        assert!(enabled(&json!({ "key": "F9" })));
        assert!(enabled(&json!({ "orb": true })));
        assert!(!enabled(&json!({ "orb": false })));
    }

    #[test]
    fn a_rect_contains_its_own_points_only() {
        let r = Rect { x: -100, y: 0, width: 100, height: 50 };
        assert!(r.contains(-100, 0) && r.contains(-1, 49));
        assert!(!r.contains(0, 0) && !r.contains(-50, 50));
    }
}

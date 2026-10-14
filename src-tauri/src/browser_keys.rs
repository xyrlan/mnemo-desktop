//! What a key does while a browser pane has focus, and in the app's own webview, on Windows.
//!
//! A browser pane is a child webview, and the app's keydown handler (`src/actions/keys.ts`)
//! lives in the main one, so it hears nothing while a page has focus. On macOS the native menu
//! carries the app's chords past the page (lib.rs); elsewhere there is no menu bar to put them
//! in. On Windows WebView2 offers the host every key pressed with Ctrl or Alt before the page
//! sees it (`AcceleratorKeyPressed`): a key that is one of the app's chords is taken from the
//! page there and sent to the app as the menu sends it, `app://action`.
//!
//! The chords are not kept here: the front end hands over `src/actions/chords.ts`'s table at
//! start (`browser_chords`), and this module only matches a pressed key against it.
//!
//! The main webview is the app, not a web page, so WebView2's browser keys are turned off
//! there: F5 and Ctrl+R reloaded the app, Ctrl+F and Ctrl+P opened Edge's find bar and print
//! dialog. The page still gets every key as a keydown, so the terminal and inputs keep theirs.

use serde::Deserialize;
use std::sync::Mutex;

/// One app chord, as `chordFor(id, 'other')` gives it, with its action id.
#[derive(Deserialize, Clone, Debug, PartialEq)]
pub struct Chord {
    pub id: String,
    #[serde(default)]
    pub ctrl: bool,
    #[serde(default)]
    pub alt: bool,
    #[serde(default)]
    pub shift: bool,
    #[serde(default)]
    pub meta: bool,
    /// `KeyboardEvent.key`, lower-cased.
    pub key: String,
    /// `KeyboardEvent.code`, when the chord also matches the physical key.
    #[serde(default)]
    pub code: Option<String>,
}

static CHORDS: Mutex<Vec<Chord>> = Mutex::new(Vec::new());

/// The app's chords, from the front end's table. Replaces what was there: a reload sends them again.
#[tauri::command]
pub fn browser_chords(chords: Vec<Chord>) {
    *CHORDS.lock().unwrap_or_else(|e| e.into_inner()) = chords;
}

/// A key pressed in a page: its Windows virtual-key code, the character the layout gives it
/// unshifted (`MapVirtualKey`), and the modifiers held.
#[derive(Clone, Copy, Debug, Default)]
pub struct Pressed {
    pub vk: u32,
    pub ch: Option<char>,
    pub ctrl: bool,
    pub alt: bool,
    pub shift: bool,
    pub meta: bool,
}

/// `KeyboardEvent.key` (lower-cased) and `.code` for a virtual key, for the keys a chord uses:
/// letters, the digit row, arrows and punctuation (named by the layout's character).
pub fn key_names(vk: u32, ch: Option<char>) -> (Option<String>, Option<String>) {
    match vk {
        0x41..=0x5A => {
            let c = char::from(vk as u8);
            (Some(c.to_ascii_lowercase().to_string()), Some(format!("Key{c}")))
        }
        0x30..=0x39 => {
            let c = char::from(vk as u8);
            (Some(c.to_string()), Some(format!("Digit{c}")))
        }
        0x25 => (Some("arrowleft".into()), Some("ArrowLeft".into())),
        0x26 => (Some("arrowup".into()), Some("ArrowUp".into())),
        0x27 => (Some("arrowright".into()), Some("ArrowRight".into())),
        0x28 => (Some("arrowdown".into()), Some("ArrowDown".into())),
        _ => (ch.filter(|c| !c.is_control()).map(|c| c.to_lowercase().to_string()), None),
    }
}

/// The action whose chord is `p`, matched as `src/actions/chords.ts` matches off a Mac: every
/// modifier as the chord has it, then the key or the physical key.
pub fn action_for(chords: &[Chord], p: &Pressed) -> Option<String> {
    let (key, code) = key_names(p.vk, p.ch);
    chords
        .iter()
        .find(|c| {
            c.ctrl == p.ctrl
                && c.alt == p.alt
                && c.shift == p.shift
                && c.meta == p.meta
                && (key.as_deref() == Some(c.key.as_str()) || (c.code.is_some() && c.code == code))
        })
        .map(|c| c.id.clone())
}

/// Sends the app's chords pressed in `webview` (a browser pane) to the app. Windows only:
/// macOS has its menu, and WebKitGTK offers no such hook.
#[cfg(windows)]
pub fn take_chords<R: tauri::Runtime>(webview: &tauri::Webview<R>) {
    use tauri::{Emitter, Manager};
    use webview2_com::AcceleratorKeyPressedEventHandler;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        COREWEBVIEW2_KEY_EVENT_KIND, COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN, COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN,
    };
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        GetKeyState, MapVirtualKeyW, MAPVK_VK_TO_CHAR, VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT,
    };

    let app = webview.app_handle().clone();
    let _ = webview.with_webview(move |platform| unsafe {
        let handler = AcceleratorKeyPressedEventHandler::create(Box::new(move |_, args| {
            let Some(args) = args else { return Ok(()) };
            let mut kind = COREWEBVIEW2_KEY_EVENT_KIND::default();
            args.KeyEventKind(&mut kind)?;
            // Alt held makes it a system key.
            if kind != COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN && kind != COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN {
                return Ok(());
            }
            let mut vk = 0u32;
            args.VirtualKey(&mut vk)?;
            let down = |k: u16| GetKeyState(i32::from(k)) < 0;
            // The low word is the character; the high bit marks a dead key.
            let ch = char::from_u32(MapVirtualKeyW(vk, MAPVK_VK_TO_CHAR) & 0xFFFF).filter(|c| *c != '\0');
            let pressed = Pressed {
                vk,
                ch,
                ctrl: down(VK_CONTROL),
                alt: down(VK_MENU),
                shift: down(VK_SHIFT),
                meta: down(VK_LWIN) || down(VK_RWIN),
            };
            let id = action_for(&CHORDS.lock().unwrap_or_else(|e| e.into_inner()), &pressed);
            if let Some(id) = id {
                args.SetHandled(true)?;
                let _ = app.emit_to("main", "app://action", serde_json::json!({ "id": id }));
                // The chord's action happens in the app, so the keys that follow go there too:
                // the palette it opened, not the page. Off this callback, which WebView2 is
                // still inside.
                if let Some(main) = app.get_webview("main") {
                    tauri::async_runtime::spawn(async move {
                        let _ = main.set_focus();
                    });
                }
            }
            Ok(())
        }));
        let mut token = 0i64;
        if let Err(e) = platform.controller().add_AcceleratorKeyPressed(&handler, &mut token) {
            log::warn!("browser pane chords: {e}");
        }
    });
}

#[cfg(not(windows))]
pub fn take_chords<R: tauri::Runtime>(_webview: &tauri::Webview<R>) {}

/// Turns WebView2's browser keys off in the app's own webview (see the module comment).
#[cfg(windows)]
pub fn no_browser_keys<R: tauri::Runtime>(webview: &tauri::Webview<R>) {
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
    use windows_core::Interface;

    let _ = webview.with_webview(|platform| unsafe {
        let off = platform
            .controller()
            .CoreWebView2()
            .and_then(|w| w.Settings())
            .and_then(|s| s.cast::<ICoreWebView2Settings3>())
            .and_then(|s| s.SetAreBrowserAcceleratorKeysEnabled(false));
        if let Err(e) = off {
            log::warn!("browser keys stay on in the app: {e}");
        }
    });
}

#[cfg(not(windows))]
pub fn no_browser_keys<R: tauri::Runtime>(_webview: &tauri::Webview<R>) {}

#[cfg(test)]
mod tests {
    use super::*;

    /// The table as `src/actions/chords.ts` sends it off a Mac (a sample of each shape).
    fn table() -> Vec<Chord> {
        serde_json::from_value(serde_json::json!([
            { "id": "palette.open", "ctrl": true, "shift": true, "key": "k" },
            { "id": "pane.split.col", "alt": true, "shift": true, "key": "d" },
            { "id": "tab.prev", "ctrl": true, "shift": true, "key": "[" },
            { "id": "focus.left", "alt": true, "shift": true, "key": "arrowleft" },
            { "id": "worktree.go.1", "ctrl": true, "shift": true, "key": "1", "code": "Digit1" },
            { "id": "tab.go.1", "alt": true, "key": "1", "code": "Digit1" },
        ]))
        .unwrap()
    }

    fn press(vk: u32, mods: &str) -> Pressed {
        Pressed {
            vk,
            ch: None,
            ctrl: mods.contains('c'),
            alt: mods.contains('a'),
            shift: mods.contains('s'),
            meta: mods.contains('m'),
        }
    }

    #[test]
    fn a_chord_pressed_in_a_page_names_its_action() {
        let t = table();
        assert_eq!(action_for(&t, &press(0x4B, "cs")).as_deref(), Some("palette.open"));
        assert_eq!(action_for(&t, &press(0x44, "as")).as_deref(), Some("pane.split.col"));
        assert_eq!(action_for(&t, &press(0x25, "as")).as_deref(), Some("focus.left"));
        assert_eq!(action_for(&t, &press(0x31, "cs")).as_deref(), Some("worktree.go.1"));
        assert_eq!(action_for(&t, &press(0x31, "a")).as_deref(), Some("tab.go.1"));
        // `[` is wherever the layout puts it: named by the character, not the key code.
        let bracket = Pressed { ch: Some('['), ..press(0xDB, "cs") };
        assert_eq!(action_for(&t, &bracket).as_deref(), Some("tab.prev"));
    }

    #[test]
    fn the_page_keeps_every_other_key() {
        let t = table();
        // The page's own Ctrl+K, a modifier short or one too many, AltGr (Ctrl+Alt), the Win key.
        for p in [press(0x4B, "c"), press(0x4B, "s"), press(0x4B, "cas"), press(0x44, "cas"), press(0x4B, "csm"), press(0x31, "ca")] {
            assert_eq!(action_for(&t, &p), None, "{p:?}");
        }
        assert_eq!(action_for(&[], &press(0x4B, "cs")), None);
    }

    #[test]
    fn keys_are_named_as_the_page_names_them() {
        assert_eq!(key_names(0x41, Some('A')), (Some("a".into()), Some("KeyA".into())));
        assert_eq!(key_names(0x39, Some('9')), (Some("9".into()), Some("Digit9".into())));
        assert_eq!(key_names(0x28, None), (Some("arrowdown".into()), Some("ArrowDown".into())));
        assert_eq!(key_names(0xDD, Some(']')), (Some("]".into()), None));
        assert_eq!(key_names(0x70, None), (None, None));
    }

    #[test]
    fn the_front_ends_table_replaces_the_last() {
        browser_chords(table());
        browser_chords(vec![table()[0].clone()]);
        assert_eq!(CHORDS.lock().unwrap().len(), 1);
    }
}

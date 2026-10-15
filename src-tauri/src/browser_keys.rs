//! The app's own webview is the app, not a web page, so WebView2's browser keys are turned off
//! there on Windows: F5 and Ctrl+R reloaded the app, Ctrl+F and Ctrl+P opened Edge's find bar and
//! print dialog. The page still gets every key as a keydown, so the terminal and inputs keep theirs.

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

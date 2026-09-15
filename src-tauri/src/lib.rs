pub mod commands;
pub mod pty;

// Feature modules register below. Each one owns its own block, separated by
// blank lines, so two branches adding a module never touch the same hunk.

// -- editor (src/fs.rs) --
pub mod fs;

// -- browser (src/browser.rs) --
pub mod browser;

// -- mission (src/mission.rs) --
pub mod mission;
pub mod mission_commands;

use commands::PtyState;
use tauri::Manager;

/// `MNEMO_DESKTOP_SMOKE=1`: spawn the default shell, send `exit`, and exit the app with 0
/// when the PTY reports the shell ended within 5 s, 1 otherwise. Used by CI.
fn run_smoke(app: &tauri::App) -> Result<(), String> {
    let state = app.state::<PtyState>();
    let (tx, rx) = std::sync::mpsc::channel();
    let id = state.0.spawn(
        pty::SpawnOptions { program: None, args: vec![], cwd: None, cols: 80, rows: 24, login: true },
        Box::new(move |e| {
            let _ = tx.send(e);
        }),
    )?;
    state.0.write(id, b"exit\n")?;
    let handle = app.handle().clone();
    std::thread::spawn(move || {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        let mut ok = false;
        while std::time::Instant::now() < deadline {
            if let Ok(pty::Event::Exit(_)) = rx.recv_timeout(std::time::Duration::from_millis(100)) {
                ok = true;
                break;
            }
        }
        eprintln!("smoke: shell round-trip {}", if ok { "ok" } else { "FAILED" });
        handle.exit(if ok { 0 } else { 1 });
    });
    Ok(())
}

pub fn run() {
    env_logger::init();
    tauri::Builder::default()
        .manage(PtyState(pty::PtyManager::new()))
        .invoke_handler(tauri::generate_handler![
            commands::pty_spawn,
            commands::pty_write,
            commands::pty_resize,
            commands::pty_kill,
            // Feature commands, one block each, blank-line separated (see the
            // module anchors at the top of this file).

            // -- editor commands --
            fs::fs_read,
            fs::fs_write,
            fs::fs_list,

            // -- browser commands --
            browser::browser_create,
            browser::browser_navigate,
            browser::browser_set_bounds,
            browser::browser_destroy,
            browser::browser_back,
            browser::browser_forward,
            browser::browser_reload,
            browser::browser_pr_url,

            // -- mission commands --
            mission_commands::mission_snapshot,
            mission_commands::mission_timeline,
            mission_commands::mission_reply,
            mission_commands::mission_mark_looked,
            mission_commands::mission_looked,
        ])
        .setup(|app| {
            if std::env::var_os("MNEMO_DESKTOP_SMOKE").is_some() {
                run_smoke(app)?;
            }

            // -- menu --
            // App chords as native menu accelerators, so they reach the app while a browser
            // pane's child webview has keyboard focus. Each item emits `app://action` with
            // its action id; `src/actions/keys.ts` runs it (and reads this table in its test,
            // so keep one `("id", "Title", "Accelerator")` tuple per line). macOS only: other
            // platforms would grow a visible menu bar, and keep the keydown handler.
            #[cfg(target_os = "macos")]
            {
                use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
                use tauri::Emitter;

                const TAB: &[(&str, &str, &str)] = &[
                    ("tab.new", "New Tab", "CmdOrCtrl+T"),
                    ("tab.prev", "Previous Tab", "CmdOrCtrl+Shift+["),
                    ("tab.next", "Next Tab", "CmdOrCtrl+Shift+]"),
                    ("tab.go.1", "Tab 1", "CmdOrCtrl+1"),
                    ("tab.go.2", "Tab 2", "CmdOrCtrl+2"),
                    ("tab.go.3", "Tab 3", "CmdOrCtrl+3"),
                    ("tab.go.4", "Tab 4", "CmdOrCtrl+4"),
                    ("tab.go.5", "Tab 5", "CmdOrCtrl+5"),
                    ("tab.go.6", "Tab 6", "CmdOrCtrl+6"),
                    ("tab.go.7", "Tab 7", "CmdOrCtrl+7"),
                    ("tab.go.8", "Tab 8", "CmdOrCtrl+8"),
                    ("tab.go.9", "Tab 9", "CmdOrCtrl+9"),
                ];
                const PANE: &[(&str, &str, &str)] = &[
                    ("pane.split.row", "Split Right", "CmdOrCtrl+D"),
                    ("pane.split.col", "Split Down", "CmdOrCtrl+Shift+D"),
                    ("pane.close", "Close Pane", "CmdOrCtrl+W"),
                    ("focus.left", "Focus Pane Left", "CmdOrCtrl+Alt+Left"),
                    ("focus.right", "Focus Pane Right", "CmdOrCtrl+Alt+Right"),
                    ("focus.up", "Focus Pane Up", "CmdOrCtrl+Alt+Up"),
                    ("focus.down", "Focus Pane Down", "CmdOrCtrl+Alt+Down"),
                ];
                const VIEW: &[(&str, &str, &str)] = &[
                    ("palette.open", "Command Palette", "CmdOrCtrl+K"),
                    ("mission.toggle-sidebar", "Toggle Mission Sidebar", "CmdOrCtrl+B"),
                ];
                const PREFIX: &str = "action:";

                let h = app.handle();
                let submenu = |title: &str, items: &[(&str, &str, &str)]| {
                    items.iter().try_fold(SubmenuBuilder::new(h, title), |b, (id, text, accel)| {
                        let item = MenuItemBuilder::with_id(format!("{PREFIX}{id}"), *text).accelerator(*accel).build(h)?;
                        Ok::<_, tauri::Error>(b.item(&item))
                    })
                };
                // Rebuilt rather than `Menu::default`, whose File > Close Window takes ⌘W.
                let name = h.package_info().name.clone();
                let app_menu = SubmenuBuilder::new(h, name)
                    .about(None)
                    .separator()
                    .services()
                    .separator()
                    .hide()
                    .hide_others()
                    .show_all()
                    .separator()
                    .quit()
                    .build()?;
                let edit = SubmenuBuilder::new(h, "Edit")
                    .undo()
                    .redo()
                    .separator()
                    .cut()
                    .copy()
                    .paste()
                    .select_all()
                    .build()?;
                let view = submenu("View", VIEW)?.separator().item(&PredefinedMenuItem::fullscreen(h, None)?).build()?;
                let window = SubmenuBuilder::new(h, "Window").minimize().maximize().build()?;
                let menu = MenuBuilder::new(h)
                    .items(&[&app_menu, &edit, &view, &submenu("Tab", TAB)?.build()?, &submenu("Pane", PANE)?.build()?, &window])
                    .build()?;
                app.set_menu(menu)?;
                app.on_menu_event(|app, event| {
                    if let Some(id) = event.id().as_ref().strip_prefix(PREFIX) {
                        let _ = app.emit_to("main", "app://action", serde_json::json!({ "id": id }));
                    }
                });
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                window.state::<PtyState>().0.kill_all();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running mnemo-desktop");
}

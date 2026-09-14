pub mod commands;
pub mod pty;

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
        ])
        .setup(|app| {
            if std::env::var_os("MNEMO_DESKTOP_SMOKE").is_some() {
                run_smoke(app)?;
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

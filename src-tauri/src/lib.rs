pub mod commands;
pub mod pty;

use commands::PtyState;
use tauri::Manager;

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
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                window.state::<PtyState>().0.kill_all();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running mnemo-desktop");
}

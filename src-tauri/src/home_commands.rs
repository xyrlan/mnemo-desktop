use crate::home::{self, HomeSnapshot};

#[tauri::command]
pub async fn home_snapshot(here: Vec<String>, pinned: Vec<String>, hidden: Vec<String>, extra_roots: Vec<String>) -> HomeSnapshot {
    tauri::async_runtime::spawn_blocking(move || home::collect_home(&here, &pinned, &hidden, &extra_roots))
        .await
        .unwrap_or_default()
}

#[tauri::command]
pub fn home_register_repo(path: String) -> Result<String, String> {
    home::register_repo(&path)
}

/// Runs git in an unresolved repo's path: the user selected it, so a macOS dialog may appear.
#[tauri::command]
pub async fn home_resolve_repo(root: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || home::resolve_repo(&root)).await.map_err(|e| e.to_string())?
}

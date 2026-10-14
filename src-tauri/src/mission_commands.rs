use crate::mission::{self, Snapshot, Timeline};
use std::collections::HashMap;

/// A poll that panicked is a snapshot that says so in `errors`, never one with nothing in it:
/// the fleet takes an empty, error-free snapshot to mean every session ended (#364).
#[tauri::command]
pub async fn mission_snapshot(focused_cwd: Option<String>, with_prs: bool) -> Snapshot {
    crate::crash::read("The sessions snapshot", move || mission::collect_snapshot(focused_cwd.as_deref(), with_prs))
        .await
        .unwrap_or_else(|e| Snapshot { errors: vec![e], ..Default::default() })
}

#[tauri::command]
pub fn mission_timeline(id: String, from_line: usize) -> Timeline {
    mission::read_timeline(&id, from_line)
}

#[tauri::command]
pub fn mission_reply(id: String, text: String) -> Result<(), String> {
    mission::reply(&id, &text)
}

#[tauri::command]
pub fn mission_mark_looked(id: String, timeline_len: usize) -> Result<(), String> {
    mission::mark_looked(&id, timeline_len)
}

#[tauri::command]
pub fn mission_looked() -> HashMap<String, usize> {
    mission::read_looked()
}

#[tauri::command]
pub async fn mission_translate(text: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || mission::translate(&text)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn mission_waiting_for(id: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || mission::waiting_for(&id)).await.map_err(|e| e.to_string())?
}

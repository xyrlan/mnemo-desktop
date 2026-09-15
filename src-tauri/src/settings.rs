//! `~/.mnemo-desktop/settings.json`: the few knobs the app has. Read whole, written whole.

use std::path::PathBuf;

fn path() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default().join(".mnemo-desktop").join("settings.json")
}

pub fn read() -> serde_json::Value {
    std::fs::read_to_string(path())
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_else(|| serde_json::json!({}))
}

pub fn write(v: &serde_json::Value) -> Result<(), String> {
    let p = path();
    if let Some(d) = p.parent() {
        std::fs::create_dir_all(d).map_err(|e| e.to_string())?;
    }
    let tmp = p.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_string_pretty(v).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &p).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn settings_read() -> serde_json::Value {
    read()
}

#[tauri::command]
pub fn settings_write(value: serde_json::Value) -> Result<(), String> {
    write(&value)
}

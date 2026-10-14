//! `~/.mnemo-desktop/settings.json`: the few knobs the app has. Read whole, written whole.

use std::path::PathBuf;

fn path() -> PathBuf {
    crate::app_dir::app_dir().join("settings.json")
}

/// The settings, `{}` on a first run. An error naming the file when it is there and cannot be read
/// as an object (`json_file::read`).
pub fn read() -> Result<serde_json::Value, String> {
    crate::json_file::read(&path())
}

pub fn write(v: &serde_json::Value) -> Result<(), String> {
    crate::json_file::write(&path(), v)
}

/// The saved projects (`Settings['projects']`): their folders, as the front wrote them. Anything
/// that is not a non-empty string is left out. None when the file cannot be read.
pub fn projects() -> Vec<String> {
    read().map(|v| projects_in(&v)).unwrap_or_default()
}

fn projects_in(v: &serde_json::Value) -> Vec<String> {
    v.get("projects")
        .and_then(|p| p.as_array())
        .map(|a| a.iter().filter_map(|p| p.as_str()).filter(|p| !p.is_empty()).map(String::from).collect())
        .unwrap_or_default()
}

#[tauri::command]
pub fn settings_read() -> Result<serde_json::Value, String> {
    read()
}

#[tauri::command]
pub fn settings_write(value: serde_json::Value) -> Result<(), String> {
    write(&value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn projects_keep_only_non_empty_strings() {
        let v = serde_json::json!({ "projects": ["/opt/src/a", "", 3, null, "/Volumes/w/b"] });
        assert_eq!(projects_in(&v), vec!["/opt/src/a", "/Volumes/w/b"]);
        assert!(projects_in(&serde_json::json!({})).is_empty());
        assert!(projects_in(&serde_json::json!({ "projects": "/opt/src/a" })).is_empty());
    }
}

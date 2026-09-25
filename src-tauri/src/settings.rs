//! `~/.mnemo-desktop/settings.json`: the few knobs the app has. Read whole, written whole.

use std::path::PathBuf;

fn path() -> PathBuf {
    crate::app_dir::app_dir().join("settings.json")
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

/// The saved projects (`Settings['projects']`): their folders, as the front wrote them. Anything
/// that is not a non-empty string is left out.
pub fn projects() -> Vec<String> {
    projects_in(&read())
}

fn projects_in(v: &serde_json::Value) -> Vec<String> {
    v.get("projects")
        .and_then(|p| p.as_array())
        .map(|a| a.iter().filter_map(|p| p.as_str()).filter(|p| !p.is_empty()).map(String::from).collect())
        .unwrap_or_default()
}

#[tauri::command]
pub fn settings_read() -> serde_json::Value {
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

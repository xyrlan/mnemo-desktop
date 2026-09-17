//! `~/.mnemo-desktop/workspace.json`: the tabs, their split trees and the panes in them, as the
//! front-end last saved them. The shape belongs to `src/layout/persist.ts`; this side only keeps
//! the file. Read whole, written whole, atomically (same as `settings.rs`).

use std::path::{Path, PathBuf};

fn path() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default().join(".mnemo-desktop").join("workspace.json")
}

/// The saved workspace, `{}` when there is none or it is not JSON.
pub fn read_at(p: &Path) -> serde_json::Value {
    std::fs::read_to_string(p)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_else(|| serde_json::json!({}))
}

/// Writes to a sibling temp file and renames it over the old one, so a crash mid-write never
/// leaves a half file that would lose the whole layout.
pub fn write_at(p: &Path, v: &serde_json::Value) -> Result<(), String> {
    if let Some(d) = p.parent() {
        std::fs::create_dir_all(d).map_err(|e| e.to_string())?;
    }
    let tmp = p.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_string_pretty(v).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, p).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn workspace_read() -> serde_json::Value {
    read_at(&path())
}

#[tauri::command]
pub fn workspace_write(value: serde_json::Value) -> Result<(), String> {
    write_at(&path(), &value)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dir(name: &str) -> PathBuf {
        let d = crate::testutil::temp_dir(&format!("workspace-{name}"));
        d
    }

    #[test]
    fn missing_or_junk_file_reads_as_empty_object() {
        let d = dir("junk");
        let p = d.join("workspace.json");
        assert_eq!(read_at(&p), serde_json::json!({}));
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(&p, "{ not json").unwrap();
        assert_eq!(read_at(&p), serde_json::json!({}));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn write_creates_the_folder_round_trips_and_leaves_no_temp_file() {
        let d = dir("roundtrip");
        let p = d.join("nested").join("workspace.json");
        let v = serde_json::json!({ "version": 1, "tabs": [{ "id": "tab-1", "root": { "kind": "leaf", "pane": 1 }, "focused": 1 }] });
        write_at(&p, &v).unwrap();
        assert_eq!(read_at(&p), v);
        let again = serde_json::json!({ "version": 1, "tabs": [] });
        write_at(&p, &again).unwrap();
        assert_eq!(read_at(&p), again);
        assert!(!p.with_extension("json.tmp").exists());
        let _ = std::fs::remove_dir_all(&d);
    }
}

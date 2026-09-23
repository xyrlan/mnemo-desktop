//! `~/.mnemo-desktop/workspace.json` (`-dev` for a debug build, see `app_dir`): the tabs, their split trees and the panes in them, as the
//! front-end last saved them. The shape belongs to `src/layout/persist.ts`; this side only keeps
//! the file. Read whole, written whole, atomically (same as `settings.rs`).

use std::path::{Path, PathBuf};

fn path() -> PathBuf {
    crate::app_dir::app_dir().join("workspace.json")
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

/// Which of `ids` a running `claude` process holds, from `claude agents --json`: a row with a pid.
/// Another app instance (a `tauri dev` beside the installed app, the app opened twice) may be
/// running them, and `claude --resume` would start a second copy of the session (#168).
pub fn live_among(agents_json: &str, ids: &[String]) -> Vec<String> {
    let live: std::collections::HashSet<String> = crate::chrome::parse_agent_pids(agents_json).into_values().map(|(s, _)| s).collect();
    ids.iter().filter(|id| live.contains(*id)).cloned().collect()
}

/// The saved sessions the restore must not resume. An error when `claude agents` cannot say:
/// the restore then resumes nothing rather than risk a copy.
#[tauri::command]
pub async fn workspace_live_sessions(ids: Vec<String>) -> Result<Vec<String>, String> {
    if ids.is_empty() {
        return Ok(vec![]);
    }
    tauri::async_runtime::spawn_blocking(move || crate::mission::run("claude", &["agents", "--json"], None).map(|j| live_among(&j, &ids)))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn workspace_write(value: serde_json::Value) -> Result<(), String> {
    write_at(&path(), &value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_session_with_a_process_is_live_and_a_finished_one_is_not() {
        let json = r#"[
            {"sessionId": "a", "pid": 11, "kind": "interactive", "status": "busy"},
            {"sessionId": "b", "kind": "background", "state": "done"},
            {"sessionId": "c", "pid": 12, "kind": "background", "state": "working"}
        ]"#;
        let ids = ["a", "b", "c", "d"].map(String::from);
        assert_eq!(live_among(json, &ids), ["a", "c"]);
        assert_eq!(live_among(json, &[]), Vec::<String>::new());
        assert_eq!(live_among("not json", &ids), Vec::<String>::new());
        // The captured listing: interactive sessions carry their pid.
        let real = include_str!("../fixtures/agents.json");
        let rows: Vec<serde_json::Value> = serde_json::from_str(real).unwrap();
        let with_pid = rows.iter().find(|r| r.get("pid").is_some()).unwrap()["sessionId"].as_str().unwrap().to_string();
        let without = rows.iter().find(|r| r.get("pid").is_none()).unwrap()["sessionId"].as_str().unwrap().to_string();
        assert_eq!(live_among(real, &[with_pid.clone(), without]), [with_pid]);
    }

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

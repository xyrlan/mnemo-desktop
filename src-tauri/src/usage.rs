//! `~/.mnemo-desktop/usage.jsonl`: how the conversation face is used (round 20, Q8 of its spec),
//! one JSON object per line, appended. The front-end decides what a row says (a face toggle, a
//! heartbeat of the focused pane's face); this side stamps `ts` (unix seconds) when the row has
//! none and appends. Nothing leaves the machine.

use std::io::Write;
use std::path::{Path, PathBuf};

fn path() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default().join(".mnemo-desktop").join("usage.jsonl")
}

/// Appends `row` to `p` as one line. A row that is not a JSON object is refused.
pub fn append_at(p: &Path, row: &serde_json::Value) -> Result<(), String> {
    let mut row = row.clone();
    let obj = row.as_object_mut().ok_or("usage: a row is a JSON object")?;
    if !obj.contains_key("ts") {
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default();
        obj.insert("ts".into(), now.as_secs().into());
    }
    if let Some(d) = p.parent() {
        std::fs::create_dir_all(d).map_err(|e| e.to_string())?;
    }
    let mut f = std::fs::OpenOptions::new().create(true).append(true).open(p).map_err(|e| e.to_string())?;
    // One write per row, newline included, so two appends never interleave mid-line.
    f.write_all(format!("{}\n", serde_json::to_string(&row).map_err(|e| e.to_string())?).as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn usage_log(row: serde_json::Value) -> Result<(), String> {
    append_at(&path(), &row)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::temp_dir;

    #[test]
    fn rows_append_one_per_line_with_a_timestamp() {
        let p = temp_dir("usage").join("sub").join("usage.jsonl");
        append_at(&p, &serde_json::json!({ "event": "face", "face": "conversation" })).unwrap();
        append_at(&p, &serde_json::json!({ "event": "beat", "ts": 5 })).unwrap();
        let text = std::fs::read_to_string(&p).unwrap();
        let rows: Vec<serde_json::Value> = text.lines().map(|l| serde_json::from_str(l).unwrap()).collect();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0]["face"], "conversation");
        assert!(rows[0]["ts"].as_u64().unwrap() > 1_700_000_000);
        assert_eq!(rows[1]["ts"], 5);
        assert!(text.ends_with('\n') && !text.contains('\r'));
    }

    #[test]
    fn a_row_that_is_not_an_object_is_refused() {
        let p = temp_dir("usage-bad").join("usage.jsonl");
        assert!(append_at(&p, &serde_json::json!(["face"])).is_err());
        assert!(!p.exists());
    }
}

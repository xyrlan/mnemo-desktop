//! One JSON object kept in one file of the app's own (`settings.json`, `workspace.json`): read
//! whole, written whole. A file that is there and cannot be read as an object is an error naming
//! it, never "nothing saved yet": answering `{}` for it had the front end load the defaults and
//! write them over the file at the next change (#336).

use std::path::Path;

/// The object in `p`. `{}` when there is no file, or an empty one: a first run. An error naming
/// the file when it is there and cannot be read, is not JSON, or is not an object.
pub fn read(p: &Path) -> Result<serde_json::Value, String> {
    let text = match std::fs::read_to_string(p) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(serde_json::json!({})),
        Err(e) => return Err(format!("{}: {e}", p.display())),
    };
    if text.trim().is_empty() {
        return Ok(serde_json::json!({}));
    }
    match serde_json::from_str::<serde_json::Value>(&text) {
        Ok(v) if v.is_object() => Ok(v),
        Ok(_) => Err(format!("{}: not a JSON object", p.display())),
        Err(e) => Err(format!("{}: {e}", p.display())),
    }
}

/// Writes to a sibling temp file and renames it over the old one, so a crash mid-write never
/// leaves a half file. Refuses when the file there now cannot be read (`read`): whatever is in
/// it is not something this app loaded, so it is not this app's to replace. A refused rename
/// (on Windows, a file another process holds open) leaves the old file and no temp file.
pub fn write(p: &Path, v: &serde_json::Value) -> Result<(), String> {
    read(p).map_err(|e| format!("{e} (left as it is, nothing written)"))?;
    if let Some(d) = p.parent() {
        std::fs::create_dir_all(d).map_err(|e| format!("{}: {e}", d.display()))?;
    }
    let text = serde_json::to_string_pretty(v).map_err(|e| e.to_string())?;
    let tmp = p.with_extension("json.tmp");
    let done = std::fs::write(&tmp, text).and_then(|()| std::fs::rename(&tmp, p));
    if done.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    done.map_err(|e| format!("{}: {e}", p.display()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn file(name: &str) -> std::path::PathBuf {
        crate::testutil::temp_dir(&format!("json-file-{name}")).join("settings.json")
    }

    fn done(p: &Path) {
        let _ = std::fs::remove_dir_all(p.parent().unwrap());
    }

    #[test]
    fn a_missing_or_empty_file_is_a_first_run() {
        let p = file("first-run");
        assert_eq!(read(&p), Ok(json!({})));
        std::fs::write(&p, " \n").unwrap();
        assert_eq!(read(&p), Ok(json!({})));
        write(&p, &json!({ "skipPermissions": false })).unwrap();
        assert_eq!(read(&p), Ok(json!({ "skipPermissions": false })));
        done(&p);
    }

    #[test]
    fn write_creates_the_folder_round_trips_and_leaves_no_temp_file() {
        let p = file("roundtrip").parent().unwrap().join("nested").join("workspace.json");
        let v = json!({ "version": 1, "tabs": [{ "id": "tab-1", "root": { "kind": "leaf", "pane": 1 }, "focused": 1 }] });
        write(&p, &v).unwrap();
        assert_eq!(read(&p), Ok(v));
        let again = json!({ "version": 1, "tabs": [] });
        write(&p, &again).unwrap();
        assert_eq!(read(&p), Ok(again));
        assert!(!p.with_extension("json.tmp").exists());
        done(p.parent().unwrap());
    }

    /// One stray comma from a hand edit, bytes that are not text, JSON that is not an object.
    #[test]
    fn a_file_that_does_not_parse_is_an_error_naming_it_and_is_never_written_over() {
        for (name, junk) in [("comma", &b"{ \"projects\": [\"/opt/src/a\"], }"[..]), ("bytes", &[0xff, 0xfe, 0x00][..]), ("list", &b"[1, 2]"[..])] {
            let p = file(name);
            std::fs::write(&p, junk).unwrap();
            let why = read(&p).unwrap_err();
            assert!(why.starts_with(&p.display().to_string()), "{why}");
            let refused = write(&p, &json!({ "projects": [] })).unwrap_err();
            assert!(refused.contains(&p.display().to_string()) && refused.contains("nothing written"), "{refused}");
            assert_eq!(std::fs::read(&p).unwrap(), junk);
            assert!(!p.with_extension("json.tmp").exists());
            done(&p);
        }
    }

    /// A read the OS refuses, on every platform: the path is a folder.
    #[test]
    fn a_file_that_is_there_and_cannot_be_read_is_an_error_and_stays() {
        let p = file("folder");
        std::fs::create_dir_all(p.join("kept")).unwrap();
        let why = read(&p).unwrap_err();
        assert!(why.starts_with(&p.display().to_string()), "{why}");
        assert!(write(&p, &json!({})).is_err());
        assert!(p.join("kept").is_dir());
        assert!(!p.with_extension("json.tmp").exists());
        done(&p);
    }

    /// Windows refuses a rename over a file another process holds open without sharing delete
    /// (an editor, a scanner). The save is an error, the old file is whole, no temp file is left.
    #[cfg(windows)]
    #[test]
    fn a_rename_refused_over_an_open_file_is_an_error_that_keeps_the_old_file() {
        use std::os::windows::fs::OpenOptionsExt;
        const FILE_SHARE_READ: u32 = 1;
        let p = file("held");
        write(&p, &json!({ "skipPermissions": false })).unwrap();
        let held = std::fs::OpenOptions::new().read(true).share_mode(FILE_SHARE_READ).open(&p).unwrap();
        let refused = write(&p, &json!({ "skipPermissions": true })).unwrap_err();
        assert!(refused.starts_with(&p.display().to_string()), "{refused}");
        assert_eq!(read(&p), Ok(json!({ "skipPermissions": false })));
        assert!(!p.with_extension("json.tmp").exists());
        drop(held);
        write(&p, &json!({ "skipPermissions": true })).unwrap();
        assert_eq!(read(&p), Ok(json!({ "skipPermissions": true })));
        done(&p);
    }
}

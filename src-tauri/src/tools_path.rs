//! `tools_add_to_path`: an explicit, user-triggered action (never run automatically) that puts
//! `crate::tools::extra_dirs()` on the user's own PATH, so a terminal opened outside this app
//! also finds `mnemo` and `claude`. User scope only — no administrator rights, and the
//! machine-wide PATH is never touched.
//!
//! macOS and Linux: written as one marked block in the rc file the user's interactive shell
//! reads (see `mission::login_path`'s doc comment on why that is `.zshrc` for zsh, not a
//! login-only file). Windows: merged into the user `Path` value under `HKCU\Environment`,
//! keeping every existing entry — including unexpanded `%VAR%` ones — byte for byte.
//!
//! The registry and rc-file I/O only runs on its own platform, but the string logic behind it
//! (`upsert_block`, `merge_windows_path`, `parse_reg_query`) is pure and platform-independent,
//! so the Windows behaviour has unit tests that run on every OS.

use std::path::{Path, PathBuf};

const BEGIN: &str = "# >>> mnemo-desktop: put mnemo and claude on PATH >>>";
const END: &str = "# <<< mnemo-desktop: put mnemo and claude on PATH <<<";

fn joined_dirs(dirs: &[PathBuf]) -> String {
    dirs.iter().map(|d| d.display().to_string()).collect::<Vec<_>>().join(", ")
}

// ------------------------------------------------------------------ unix --

fn export_line(dirs: &[PathBuf]) -> String {
    let joined = dirs.iter().map(|d| d.display().to_string()).collect::<Vec<_>>().join(":");
    format!("export PATH=\"{joined}:$PATH\"")
}

fn marked_block(dirs: &[PathBuf]) -> String {
    format!("{BEGIN}\n{}\n{END}", export_line(dirs))
}

/// Inserts or replaces the marked block in `existing`. `None` when `new_block` is already
/// there byte for byte — running the action twice adds nothing. Text outside the markers is
/// left untouched.
fn upsert_block(existing: &str, new_block: &str) -> Option<String> {
    match existing.find(BEGIN) {
        Some(start) => {
            let end = existing[start..].find(END).map(|i| start + i + END.len()).unwrap_or(existing.len());
            let mut after = end;
            if existing[after..].starts_with('\n') {
                after += 1;
            }
            if existing[start..end] == *new_block {
                return None;
            }
            let mut out = String::with_capacity(existing.len() + new_block.len());
            out.push_str(&existing[..start]);
            out.push_str(new_block);
            out.push('\n');
            out.push_str(&existing[after..]);
            Some(out)
        }
        None => {
            let mut out = existing.to_string();
            if !out.is_empty() && !out.ends_with('\n') {
                out.push('\n');
            }
            out.push_str(new_block);
            out.push('\n');
            Some(out)
        }
    }
}

fn rc_path(home: &Path, shell_name: &str) -> PathBuf {
    home.join(if shell_name == "zsh" { ".zshrc" } else { ".bashrc" })
}

fn add_to_path_unix_at(home: &Path, shell_name: &str, dirs: &[PathBuf]) -> Result<String, String> {
    if dirs.is_empty() {
        return Ok("Nothing to add: no tool directories to put on PATH.".into());
    }
    let rc = rc_path(home, shell_name);
    let existing = std::fs::read_to_string(&rc).unwrap_or_default();
    let block = marked_block(dirs);
    match upsert_block(&existing, &block) {
        None => Ok(format!("Already on PATH in {}; nothing to change.", rc.display())),
        Some(updated) => {
            if let Some(parent) = rc.parent() {
                std::fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
            }
            std::fs::write(&rc, updated).map_err(|e| format!("{}: {e}", rc.display()))?;
            Ok(format!("Added {} to PATH in {}. Open a new terminal to use it.", joined_dirs(dirs), rc.display()))
        }
    }
}

fn add_to_path_unix(dirs: &[PathBuf]) -> Result<String, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME is not set".to_string())?;
    let shell = crate::pty::default_shell();
    let shell_name = Path::new(&shell).file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
    add_to_path_unix_at(Path::new(&home), &shell_name, dirs)
}

// ------------------------------------------------------------------ windows --

/// Parses `reg query "HKCU\Environment" /v Path` output into (type, value), e.g.
/// `("REG_EXPAND_SZ", "C:\Users\a\.local\bin;%SystemRoot%")`. `None` if the value line is
/// missing, which `reg query` prints when the key exists but not that value.
fn parse_reg_query(output: &str) -> Option<(String, String)> {
    output.lines().find_map(|line| {
        let t = line.trim();
        let rest = t.strip_prefix("Path")?;
        if !rest.starts_with(char::is_whitespace) {
            return None;
        }
        let rest = rest.trim_start();
        let (ty, val) = rest.split_once(char::is_whitespace)?;
        Some((ty.trim().to_string(), val.trim().to_string()))
    })
}

/// `existing` and each dir compared as exact strings, so an unexpanded `%VAR%` entry is never
/// mistaken for the literal path it expands to, and every existing entry survives byte for
/// byte, in order. `None` when every dir is already present.
fn merge_windows_path(existing: &str, dirs: &[PathBuf]) -> Option<String> {
    let mut parts: Vec<String> = existing.split(';').filter(|s| !s.is_empty()).map(|s| s.to_string()).collect();
    let mut changed = false;
    for d in dirs {
        let d = d.to_string_lossy().to_string();
        if !parts.iter().any(|p| p == &d) {
            parts.push(d);
            changed = true;
        }
    }
    changed.then(|| parts.join(";"))
}

fn read_windows_user_path() -> Result<(String, String), String> {
    let out = crate::proc::command("reg")
        .args(["query", "HKCU\\Environment", "/v", "Path"])
        .output()
        .map_err(|e| format!("reg query: {e}"))?;
    if !out.status.success() {
        // No user Path value yet: start from empty, default to the expandable type so a
        // future %VAR% entry (ours or the user's) works as intended.
        return Ok(("REG_EXPAND_SZ".to_string(), String::new()));
    }
    let text = String::from_utf8_lossy(&out.stdout);
    parse_reg_query(&text).ok_or_else(|| format!("reg query: unexpected output: {text}"))
}

fn write_windows_user_path(reg_type: &str, value: &str) -> Result<(), String> {
    let out = crate::proc::command("reg")
        .args(["add", "HKCU\\Environment", "/v", "Path", "/t", reg_type, "/d", value, "/f"])
        .output()
        .map_err(|e| format!("reg add: {e}"))?;
    if !out.status.success() {
        return Err(format!("reg add: {}", String::from_utf8_lossy(&out.stderr).trim()));
    }
    Ok(())
}

fn add_to_path_windows(dirs: &[PathBuf]) -> Result<String, String> {
    if dirs.is_empty() {
        return Ok("Nothing to add: no tool directories to put on PATH.".into());
    }
    let (reg_type, existing) = read_windows_user_path()?;
    match merge_windows_path(&existing, dirs) {
        None => Ok("Already on your PATH (HKCU\\Environment); nothing to change.".into()),
        Some(updated) => {
            write_windows_user_path(&reg_type, &updated)?;
            Ok(format!("Added {} to your user PATH (HKCU\\Environment). New terminals will see it.", joined_dirs(dirs)))
        }
    }
}

// ------------------------------------------------------------------ command --

/// Puts every dir `crate::tools::extra_dirs()` names onto the user's own PATH. Never runs on
/// its own — only from a click. See the module doc comment for the per-platform mechanism.
#[tauri::command]
pub fn tools_add_to_path() -> Result<String, String> {
    let dirs = crate::tools::extra_dirs();
    if cfg!(windows) {
        add_to_path_windows(&dirs)
    } else {
        add_to_path_unix(&dirs)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dirs(paths: &[&str]) -> Vec<PathBuf> {
        paths.iter().map(PathBuf::from).collect()
    }

    #[test]
    fn export_line_joins_dirs_ahead_of_the_inherited_path() {
        assert_eq!(export_line(&dirs(&["/a", "/b"])), "export PATH=\"/a:/b:$PATH\"");
    }

    #[test]
    fn upsert_block_appends_when_no_marker_present() {
        let out = upsert_block("alias ll='ls -la'\n", &marked_block(&dirs(&["/a"]))).unwrap();
        assert!(out.starts_with("alias ll='ls -la'\n"));
        assert!(out.contains(BEGIN));
        assert!(out.contains(END));
        assert!(out.ends_with('\n'));
    }

    #[test]
    fn upsert_block_appends_to_empty_file_without_a_leading_blank_line() {
        let out = upsert_block("", &marked_block(&dirs(&["/a"]))).unwrap();
        assert_eq!(out, format!("{}\n", marked_block(&dirs(&["/a"]))));
    }

    #[test]
    fn upsert_block_is_none_when_the_same_block_is_already_there() {
        let block = marked_block(&dirs(&["/a", "/b"]));
        let existing = format!("before\n{block}\nafter\n");
        assert_eq!(upsert_block(&existing, &block), None);
    }

    #[test]
    fn upsert_block_replaces_a_stale_block_in_place_leaving_the_rest_untouched() {
        let old = marked_block(&dirs(&["/old"]));
        let new = marked_block(&dirs(&["/a", "/b"]));
        let existing = format!("before\n{old}\nafter\n");
        let updated = upsert_block(&existing, &new).unwrap();
        assert_eq!(updated, format!("before\n{new}\nafter\n"));
    }

    #[test]
    fn rc_path_picks_zshrc_for_zsh_and_bashrc_otherwise() {
        let home = Path::new("/home/u");
        assert_eq!(rc_path(home, "zsh"), home.join(".zshrc"));
        assert_eq!(rc_path(home, "bash"), home.join(".bashrc"));
        assert_eq!(rc_path(home, ""), home.join(".bashrc"));
    }

    #[test]
    fn add_to_path_unix_writes_the_block_then_reports_no_change_on_a_second_run() {
        let home = std::env::temp_dir().join(format!("mnemo-desktop-test-path-{}", std::process::id()));
        std::fs::create_dir_all(&home).unwrap();
        std::fs::write(home.join(".zshrc"), "# existing rc\n").unwrap();
        let d = dirs(&["/tools/mnemo"]);

        let first = add_to_path_unix_at(&home, "zsh", &d).unwrap();
        assert!(first.contains("Added"), "got: {first}");
        let contents = std::fs::read_to_string(home.join(".zshrc")).unwrap();
        assert!(contents.starts_with("# existing rc\n"));
        assert!(contents.contains("/tools/mnemo"));

        let second = add_to_path_unix_at(&home, "zsh", &d).unwrap();
        assert!(second.contains("Already"), "got: {second}");
        assert_eq!(std::fs::read_to_string(home.join(".zshrc")).unwrap(), contents);

        std::fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn add_to_path_unix_creates_a_missing_rc_file() {
        let home = std::env::temp_dir().join(format!("mnemo-desktop-test-path-new-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        std::fs::create_dir_all(&home).unwrap();

        let msg = add_to_path_unix_at(&home, "bash", &dirs(&["/tools/mnemo"])).unwrap();
        assert!(msg.contains(".bashrc"));
        assert!(std::fs::read_to_string(home.join(".bashrc")).unwrap().contains("/tools/mnemo"));

        std::fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn add_to_path_unix_with_no_dirs_reports_nothing_to_add() {
        let home = std::env::temp_dir().join(format!("mnemo-desktop-test-path-empty-{}", std::process::id()));
        std::fs::create_dir_all(&home).unwrap();
        let msg = add_to_path_unix_at(&home, "zsh", &[]).unwrap();
        assert!(msg.contains("Nothing to add"));
        assert!(!home.join(".zshrc").exists());
        std::fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn parse_reg_query_reads_the_type_and_value() {
        let out = "HKEY_CURRENT_USER\\Environment\r\n    Path    REG_EXPAND_SZ    C:\\Users\\a\\.local\\bin;%SystemRoot%\r\n\r\n";
        assert_eq!(parse_reg_query(out), Some(("REG_EXPAND_SZ".to_string(), "C:\\Users\\a\\.local\\bin;%SystemRoot%".to_string())));
    }

    #[test]
    fn parse_reg_query_is_none_without_a_path_line() {
        assert_eq!(parse_reg_query("HKEY_CURRENT_USER\\Environment\r\n\r\n"), None);
    }

    #[test]
    fn merge_windows_path_keeps_existing_entries_byte_for_byte_including_unexpanded_vars() {
        let existing = "C:\\a;%USERPROFILE%\\.local\\bin;C:\\b";
        let merged = merge_windows_path(existing, &dirs(&["C:\\new"])).unwrap();
        assert_eq!(merged, "C:\\a;%USERPROFILE%\\.local\\bin;C:\\b;C:\\new");
    }

    #[test]
    fn merge_windows_path_is_none_when_every_dir_is_already_present() {
        let existing = "C:\\a;C:\\new";
        assert_eq!(merge_windows_path(existing, &dirs(&["C:\\new"])), None);
    }

    #[test]
    fn merge_windows_path_does_not_confuse_an_unexpanded_var_with_its_literal_expansion() {
        // A dir the app wants that happens to equal what %USERPROFILE%\bin would expand to is
        // still appended: the comparison is against the stored string, not its meaning.
        let existing = "%USERPROFILE%\\bin";
        let merged = merge_windows_path(existing, &dirs(&["C:\\Users\\a\\bin"])).unwrap();
        assert_eq!(merged, "%USERPROFILE%\\bin;C:\\Users\\a\\bin");
    }

    #[test]
    fn merge_windows_path_handles_an_empty_existing_value() {
        let merged = merge_windows_path("", &dirs(&["C:\\new"])).unwrap();
        assert_eq!(merged, "C:\\new");
    }

    #[test]
    fn merge_windows_path_survives_a_value_over_1024_characters() {
        let long_existing = std::iter::repeat("C:\\some\\long\\segment").take(80).collect::<Vec<_>>().join(";");
        assert!(long_existing.len() > 1024);
        let merged = merge_windows_path(&long_existing, &dirs(&["C:\\new"])).unwrap();
        assert!(merged.starts_with(&long_existing));
        assert!(merged.ends_with(";C:\\new"));
    }
}

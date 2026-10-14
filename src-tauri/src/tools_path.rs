//! `tools_add_to_path`: an explicit, user-triggered action (never run automatically) that puts
//! `crate::tools::extra_dirs()` on the user's own PATH, so a terminal opened outside this app
//! also finds `mnemo` and `claude`. User scope only — no administrator rights, and the
//! machine-wide PATH is never touched.
//!
//! macOS and Linux: written as one marked block in the rc file the user's interactive shell
//! reads (see `mission::login_path`'s doc comment on why that is `.zshrc` for zsh, not a
//! login-only file). A file that is there and cannot be read as text is left alone. Windows:
//! appended to the user `Path` value under `HKCU\Environment`, read and written through the
//! registry API as the UTF-16 it is stored in, so every existing entry — unexpanded `%VAR%`
//! ones and ones outside ASCII included — stays unit for unit, under the name and type it had.
//! Only "there is no such value" reads as empty: any other failure to read stops the write (#335).
//!
//! The string logic (`upsert_block`, `merge_windows_path`, `path_units`) is pure and has tests
//! that run on every OS. The registry calls have tests that run on Windows only, against a
//! scratch key made for each test: no test reads or writes `HKCU\Environment`.

use std::path::{Path, PathBuf};

const BEGIN: &str = "# >>> mnemo-desktop: put mnemo and claude on PATH >>>";
const END: &str = "# <<< mnemo-desktop: put mnemo and claude on PATH <<<";

fn joined_dirs(dirs: &[PathBuf]) -> String {
    dirs.iter().map(|d| d.display().to_string()).collect::<Vec<_>>().join(", ")
}

// ------------------------------------------------------------------ unix --

/// The line that puts `dirs` ahead of the inherited PATH, in the shell's own syntax: fish reads
/// no `export NAME="…"` the way sh does.
fn export_line(shell_name: &str, dirs: &[PathBuf]) -> String {
    if shell_name == "fish" {
        let quoted = dirs.iter().map(|d| format!("\"{}\"", d.display())).collect::<Vec<_>>().join(" ");
        return format!("set -gx PATH {quoted} $PATH");
    }
    let joined = dirs.iter().map(|d| d.display().to_string()).collect::<Vec<_>>().join(":");
    format!("export PATH=\"{joined}:$PATH\"")
}

fn marked_block(shell_name: &str, dirs: &[PathBuf]) -> String {
    format!("{BEGIN}\n{}\n{END}", export_line(shell_name, dirs))
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

/// The file the shell reads at the start of an interactive session. fish keeps its own under
/// `$XDG_CONFIG_HOME` (`config_home`), or `~/.config` when that is unset.
fn rc_path(home: &Path, config_home: Option<&Path>, shell_name: &str) -> PathBuf {
    match shell_name {
        "zsh" => home.join(".zshrc"),
        "fish" => config_home.map(Path::to_path_buf).unwrap_or_else(|| home.join(".config")).join("fish").join("config.fish"),
        _ => home.join(".bashrc"),
    }
}

fn add_to_path_unix_at(rc: &Path, shell_name: &str, dirs: &[PathBuf]) -> Result<String, String> {
    if dirs.is_empty() {
        return Ok("Nothing to add: no tool directories to put on PATH.".into());
    }
    // Only a file that is not there reads as empty. One that is there and cannot be read as
    // text would otherwise be replaced whole by the block.
    let existing = match std::fs::read_to_string(rc) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) if e.kind() == std::io::ErrorKind::InvalidData => {
            return Err(format!(
                "{} is not UTF-8 text, so it was left as it is. Put {} on PATH in it yourself.",
                rc.display(),
                joined_dirs(dirs)
            ));
        }
        Err(e) => return Err(format!("Could not read {}: {e}. Nothing was changed.", rc.display())),
    };
    let block = marked_block(shell_name, dirs);
    match upsert_block(&existing, &block) {
        None => Ok(format!("Already on PATH in {}; nothing to change.", rc.display())),
        Some(updated) => {
            if let Some(parent) = rc.parent() {
                std::fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
            }
            std::fs::write(rc, updated).map_err(|e| format!("{}: {e}", rc.display()))?;
            Ok(format!("Added {} to PATH in {}. Open a new terminal to use it.", joined_dirs(dirs), rc.display()))
        }
    }
}

#[cfg_attr(windows, allow(dead_code))]
fn add_to_path_unix(dirs: &[PathBuf]) -> Result<String, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME is not set".to_string())?;
    let config_home = std::env::var_os("XDG_CONFIG_HOME").filter(|v| !v.is_empty()).map(PathBuf::from);
    let shell = crate::pty::default_shell();
    let shell_name = Path::new(&shell).file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
    let rc = rc_path(Path::new(&home), config_home.as_deref(), &shell_name);
    add_to_path_unix_at(&rc, &shell_name, dirs)
}

// ------------------------------------------------------------------ windows --

const SEMICOLON: u16 = b';' as u16;

#[cfg_attr(not(windows), allow(dead_code))]
fn wide_dir(dir: &Path) -> Vec<u16> {
    #[cfg(windows)]
    {
        std::os::windows::ffi::OsStrExt::encode_wide(dir.as_os_str()).collect()
    }
    #[cfg(not(windows))]
    {
        dir.to_string_lossy().encode_utf16().collect()
    }
}

/// A string value's data as the UTF-16 units it holds, without the NULs that end it. Refused
/// when it is not whole units, or has a NUL inside it: Windows reads such a value only up to
/// that NUL, so what the app appended after it would never be seen.
#[cfg_attr(not(windows), allow(dead_code))]
fn path_units(data: &[u8]) -> Result<Vec<u16>, String> {
    if data.len() % 2 != 0 {
        return Err(format!("it is {} bytes long, which is not whole UTF-16 characters", data.len()));
    }
    let mut units: Vec<u16> = data.chunks_exact(2).map(|b| u16::from_le_bytes([b[0], b[1]])).collect();
    while units.last() == Some(&0) {
        units.pop();
    }
    if units.contains(&0) {
        return Err("it has a NUL character inside it".into());
    }
    Ok(units)
}

/// `existing` with each of `dirs` it lacks appended. What is there is not rewritten, only
/// added to: every entry survives unit for unit, in order, empty ones and lone surrogates
/// included. Entries are compared as exact strings, so an unexpanded `%VAR%` entry is never
/// mistaken for the literal path it expands to. `None` when every dir is already present.
#[cfg_attr(not(windows), allow(dead_code))]
fn merge_windows_path(existing: &[u16], dirs: &[PathBuf]) -> Option<Vec<u16>> {
    let mut out = existing.to_vec();
    let mut changed = false;
    for d in dirs {
        let d = wide_dir(d);
        if out.split(|&u| u == SEMICOLON).any(|entry| entry == d) {
            continue;
        }
        if !out.is_empty() && out.last() != Some(&SEMICOLON) {
            out.push(SEMICOLON);
        }
        out.extend(d);
        changed = true;
    }
    changed.then_some(out)
}

#[cfg(windows)]
mod registry {
    //! advapi32 and user32, which every Windows links, called directly as `tools::registry`
    //! does: the app adds no crate for a handful of calls.

    use std::ffi::c_void;

    pub type Hkey = isize;
    pub const HKEY_CURRENT_USER: Hkey = 0x8000_0001u32 as i32 as isize;
    pub const KEY_QUERY_VALUE: u32 = 0x0001;
    pub const KEY_SET_VALUE: u32 = 0x0002;
    pub const REG_SZ: u32 = 1;
    pub const REG_EXPAND_SZ: u32 = 2;
    const ERROR_SUCCESS: i32 = 0;
    const ERROR_FILE_NOT_FOUND: i32 = 2;
    const ERROR_MORE_DATA: i32 = 234;
    const ERROR_NO_MORE_ITEMS: i32 = 259;
    /// A value name is at most 16 383 characters, and the buffer also holds its NUL.
    const NAME_BUF: usize = 16_384;

    const HWND_BROADCAST: isize = 0xffff;
    const WM_SETTINGCHANGE: u32 = 0x001A;
    const SMTO_ABORTIFHUNG: u32 = 0x0002;

    #[link(name = "advapi32")]
    extern "system" {
        fn RegOpenKeyExW(hkey: Hkey, sub_key: *const u16, options: u32, access: u32, result: *mut Hkey) -> i32;
        fn RegCloseKey(hkey: Hkey) -> i32;
        fn RegEnumValueW(
            hkey: Hkey,
            index: u32,
            name: *mut u16,
            name_len: *mut u32,
            reserved: *mut u32,
            kind: *mut u32,
            data: *mut u8,
            len: *mut u32,
        ) -> i32;
        fn RegQueryValueExW(hkey: Hkey, name: *const u16, reserved: *mut u32, kind: *mut u32, data: *mut u8, len: *mut u32) -> i32;
        fn RegSetValueExW(hkey: Hkey, name: *const u16, reserved: u32, kind: u32, data: *const u8, len: u32) -> i32;
    }

    #[link(name = "user32")]
    extern "system" {
        fn SendMessageTimeoutW(hwnd: isize, msg: u32, wparam: usize, lparam: *const c_void, flags: u32, timeout_ms: u32, result: *mut usize) -> isize;
    }

    pub fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain([0]).collect()
    }

    /// What Windows says about a registry call's return code.
    pub fn error(rc: i32) -> String {
        std::io::Error::from_raw_os_error(rc).to_string()
    }

    /// An open key, closed when dropped. A failed call hands back Windows' own error code.
    pub struct Key(Hkey);

    impl Key {
        pub fn open(root: Hkey, sub_key: &str, access: u32) -> Result<Key, i32> {
            let mut handle: Hkey = 0;
            let rc = unsafe { RegOpenKeyExW(root, wide(sub_key).as_ptr(), 0, access, &mut handle) };
            if rc == ERROR_SUCCESS {
                Ok(Key(handle))
            } else {
                Err(rc)
            }
        }

        #[cfg(test)]
        pub fn from_raw(handle: Hkey) -> Key {
            Key(handle)
        }

        /// The name, NUL-terminated and in the case it is stored under, of the value this key
        /// holds as `name` in any case: the registry matches names without regard to case, and
        /// the write goes back under the stored one. `None` when the key has no such value.
        pub fn stored_name(&self, name: &str) -> Result<Option<Vec<u16>>, i32> {
            let mut buf = vec![0u16; NAME_BUF];
            for index in 0.. {
                let mut len = buf.len() as u32;
                let rc = unsafe {
                    RegEnumValueW(
                        self.0,
                        index,
                        buf.as_mut_ptr(),
                        &mut len,
                        std::ptr::null_mut(),
                        std::ptr::null_mut(),
                        std::ptr::null_mut(),
                        std::ptr::null_mut(),
                    )
                };
                match rc {
                    ERROR_SUCCESS => {
                        let found = &buf[..len as usize];
                        if String::from_utf16_lossy(found).eq_ignore_ascii_case(name) {
                            return Ok(Some(found.iter().copied().chain([0]).collect()));
                        }
                    }
                    ERROR_NO_MORE_ITEMS => return Ok(None),
                    _ => return Err(rc),
                }
            }
            Ok(None)
        }

        /// The type and raw data of the value `name` (NUL-terminated). `None` only when there
        /// is no such value.
        pub fn read(&self, name: &[u16]) -> Result<Option<(u32, Vec<u8>)>, i32> {
            // The value can grow between the size query and the read; ask again when it did.
            for _ in 0..4 {
                let (mut kind, mut len) = (0u32, 0u32);
                let rc = unsafe { RegQueryValueExW(self.0, name.as_ptr(), std::ptr::null_mut(), &mut kind, std::ptr::null_mut(), &mut len) };
                match rc {
                    ERROR_SUCCESS if len == 0 => return Ok(Some((kind, Vec::new()))),
                    ERROR_SUCCESS => {}
                    ERROR_FILE_NOT_FOUND => return Ok(None),
                    _ => return Err(rc),
                }
                let mut data = vec![0u8; len as usize];
                let rc = unsafe { RegQueryValueExW(self.0, name.as_ptr(), std::ptr::null_mut(), &mut kind, data.as_mut_ptr(), &mut len) };
                match rc {
                    ERROR_SUCCESS => {
                        data.truncate(len as usize);
                        return Ok(Some((kind, data)));
                    }
                    ERROR_MORE_DATA => continue,
                    ERROR_FILE_NOT_FOUND => return Ok(None),
                    _ => return Err(rc),
                }
            }
            Err(ERROR_MORE_DATA)
        }

        pub fn write(&self, name: &[u16], kind: u32, data: &[u8]) -> Result<(), i32> {
            let rc = unsafe { RegSetValueExW(self.0, name.as_ptr(), 0, kind, data.as_ptr(), data.len() as u32) };
            if rc == ERROR_SUCCESS {
                Ok(())
            } else {
                Err(rc)
            }
        }
    }

    impl Drop for Key {
        fn drop(&mut self) {
            unsafe { RegCloseKey(self.0) };
        }
    }

    /// Tells every top-level window that the environment changed. Explorer reads the registry
    /// again when it hears this, so what it starts afterwards gets the new `Path`; without it
    /// nothing does until the next sign-in. `false` when the message could not be sent, or was
    /// still going round after five seconds: a window that does not answer holds it up, and
    /// the click should not wait on someone else's program.
    pub fn broadcast_environment_change() -> bool {
        let (done, heard) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let what = wide("Environment");
            let mut result = 0usize;
            let sent = unsafe { SendMessageTimeoutW(HWND_BROADCAST, WM_SETTINGCHANGE, 0, what.as_ptr().cast(), SMTO_ABORTIFHUNG, 1000, &mut result) };
            let _ = done.send(sent != 0);
        });
        heard.recv_timeout(std::time::Duration::from_secs(5)).unwrap_or(false)
    }
}

/// Appends `dirs` to the `Path` value of an open key, `shown` being how the message names it.
/// `Ok(false)` when they were all there already. The value keeps the name and type it is
/// stored under; when there is none it is made as `Path`, expandable, as Windows makes it.
#[cfg(windows)]
fn add_to_path_in_key(key: &registry::Key, shown: &str, dirs: &[PathBuf]) -> Result<bool, String> {
    use registry::{error, REG_EXPAND_SZ, REG_SZ};

    let unread = |rc: i32| format!("Could not read your user Path ({shown}): {}. Nothing was changed.", error(rc));
    let stored = match key.stored_name("Path").map_err(unread)? {
        Some(name) => key.read(&name).map_err(unread)?.map(|(kind, data)| (name, kind, data)),
        None => None,
    };
    let (name, kind, existing) = match stored {
        None => (registry::wide("Path"), REG_EXPAND_SZ, Vec::new()),
        Some((_, kind, _)) if kind != REG_SZ && kind != REG_EXPAND_SZ => {
            return Err(format!("Your user Path ({shown}) is stored as registry type {kind}, not as text. Nothing was changed."));
        }
        Some((name, kind, data)) => {
            let units = path_units(&data).map_err(|why| format!("Your user Path ({shown}) cannot be added to: {why}. Nothing was changed."))?;
            (name, kind, units)
        }
    };
    let Some(updated) = merge_windows_path(&existing, dirs) else {
        return Ok(false);
    };
    let data: Vec<u8> = updated.iter().chain([&0]).flat_map(|u| u.to_le_bytes()).collect();
    key.write(&name, kind, &data).map_err(|rc| format!("Could not write your user Path ({shown}): {}.", error(rc)))?;
    Ok(true)
}

#[cfg(windows)]
fn add_to_path_windows_at(sub_key: &str, dirs: &[PathBuf]) -> Result<bool, String> {
    use registry::{Key, HKEY_CURRENT_USER, KEY_QUERY_VALUE, KEY_SET_VALUE};

    let shown = format!("HKCU\\{sub_key}");
    let key = Key::open(HKEY_CURRENT_USER, sub_key, KEY_QUERY_VALUE | KEY_SET_VALUE)
        .map_err(|rc| format!("Could not open {shown}: {}. Nothing was changed.", registry::error(rc)))?;
    add_to_path_in_key(&key, &shown, dirs)
}

#[cfg(windows)]
fn add_to_path_windows(dirs: &[PathBuf]) -> Result<String, String> {
    if dirs.is_empty() {
        return Ok("Nothing to add: no tool directories to put on PATH.".into());
    }
    if !add_to_path_windows_at("Environment", dirs)? {
        return Ok("Already on your PATH (HKCU\\Environment); nothing to change.".into());
    }
    let after = if registry::broadcast_environment_change() {
        "A terminal opened from the Start menu or Explorer sees it from now on; a program that was already open has to be restarted before the terminals it starts do."
    } else {
        "Windows could not be told about the change: sign out and back in for new terminals to see it."
    };
    Ok(format!("Added {} to your user PATH (HKCU\\Environment). {after}", joined_dirs(dirs)))
}

// ------------------------------------------------------------------ command --

/// Puts every dir `crate::tools::extra_dirs()` names onto the user's own PATH. Never runs on
/// its own — only from a click. See the module doc comment for the per-platform mechanism.
#[tauri::command]
pub fn tools_add_to_path() -> Result<String, String> {
    let dirs = crate::tools::extra_dirs();
    #[cfg(windows)]
    {
        add_to_path_windows(&dirs)
    }
    #[cfg(not(windows))]
    {
        add_to_path_unix(&dirs)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dirs(paths: &[&str]) -> Vec<PathBuf> {
        paths.iter().map(PathBuf::from).collect()
    }

    fn w(s: &str) -> Vec<u16> {
        s.encode_utf16().collect()
    }

    fn temp_home(name: &str) -> PathBuf {
        let home = std::env::temp_dir().join(format!("mnemo-desktop-test-path-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        std::fs::create_dir_all(&home).unwrap();
        home
    }

    #[test]
    fn export_line_joins_dirs_ahead_of_the_inherited_path() {
        assert_eq!(export_line("zsh", &dirs(&["/a", "/b"])), "export PATH=\"/a:/b:$PATH\"");
    }

    #[test]
    fn export_line_for_fish_is_a_set_in_fishs_own_syntax() {
        assert_eq!(export_line("fish", &dirs(&["/a", "/b c"])), "set -gx PATH \"/a\" \"/b c\" $PATH");
    }

    #[test]
    fn upsert_block_appends_when_no_marker_present() {
        let out = upsert_block("alias ll='ls -la'\n", &marked_block("zsh", &dirs(&["/a"]))).unwrap();
        assert!(out.starts_with("alias ll='ls -la'\n"));
        assert!(out.contains(BEGIN));
        assert!(out.contains(END));
        assert!(out.ends_with('\n'));
    }

    #[test]
    fn upsert_block_appends_to_empty_file_without_a_leading_blank_line() {
        let out = upsert_block("", &marked_block("zsh", &dirs(&["/a"]))).unwrap();
        assert_eq!(out, format!("{}\n", marked_block("zsh", &dirs(&["/a"]))));
    }

    #[test]
    fn upsert_block_is_none_when_the_same_block_is_already_there() {
        let block = marked_block("zsh", &dirs(&["/a", "/b"]));
        let existing = format!("before\n{block}\nafter\n");
        assert_eq!(upsert_block(&existing, &block), None);
    }

    #[test]
    fn upsert_block_replaces_a_stale_block_in_place_leaving_the_rest_untouched() {
        let old = marked_block("zsh", &dirs(&["/old"]));
        let new = marked_block("zsh", &dirs(&["/a", "/b"]));
        let existing = format!("before\n{old}\nafter\n");
        let updated = upsert_block(&existing, &new).unwrap();
        assert_eq!(updated, format!("before\n{new}\nafter\n"));
    }

    #[test]
    fn rc_path_is_the_file_each_shell_reads() {
        let home = Path::new("/home/u");
        assert_eq!(rc_path(home, None, "zsh"), home.join(".zshrc"));
        assert_eq!(rc_path(home, None, "bash"), home.join(".bashrc"));
        assert_eq!(rc_path(home, None, ""), home.join(".bashrc"));
        assert_eq!(rc_path(home, None, "fish"), home.join(".config").join("fish").join("config.fish"));
        assert_eq!(rc_path(home, Some(Path::new("/xdg")), "fish"), Path::new("/xdg").join("fish").join("config.fish"));
        assert_eq!(rc_path(home, Some(Path::new("/xdg")), "zsh"), home.join(".zshrc"));
    }

    #[test]
    fn add_to_path_unix_writes_the_block_then_reports_no_change_on_a_second_run() {
        let home = temp_home("twice");
        let rc = home.join(".zshrc");
        std::fs::write(&rc, "# existing rc\n").unwrap();
        let d = dirs(&["/tools/mnemo"]);

        let first = add_to_path_unix_at(&rc, "zsh", &d).unwrap();
        assert!(first.contains("Added"), "got: {first}");
        let contents = std::fs::read_to_string(&rc).unwrap();
        assert!(contents.starts_with("# existing rc\n"));
        assert!(contents.contains("/tools/mnemo"));

        let second = add_to_path_unix_at(&rc, "zsh", &d).unwrap();
        assert!(second.contains("Already"), "got: {second}");
        assert_eq!(std::fs::read_to_string(&rc).unwrap(), contents);

        std::fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn add_to_path_unix_creates_a_missing_rc_file() {
        let home = temp_home("new");
        let rc = home.join(".bashrc");

        let msg = add_to_path_unix_at(&rc, "bash", &dirs(&["/tools/mnemo"])).unwrap();
        assert!(msg.contains(".bashrc"));
        assert!(std::fs::read_to_string(&rc).unwrap().contains("/tools/mnemo"));

        std::fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn add_to_path_unix_with_no_dirs_reports_nothing_to_add() {
        let home = temp_home("empty");
        let msg = add_to_path_unix_at(&home.join(".zshrc"), "zsh", &[]).unwrap();
        assert!(msg.contains("Nothing to add"));
        assert!(!home.join(".zshrc").exists());
        std::fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn an_rc_file_that_is_not_utf8_is_left_alone_and_the_refusal_names_it() {
        let home = temp_home("not-utf8");
        let rc = home.join(".zshrc");
        // Latin-1 `é`: a lone 0xE9 is not UTF-8.
        let latin1: &[u8] = b"export PATH=\"/home/jos\xe9/bin:$PATH\"\nalias ll='ls -la'\n";
        std::fs::write(&rc, latin1).unwrap();

        let refused = add_to_path_unix_at(&rc, "zsh", &dirs(&["/tools/mnemo"])).unwrap_err();
        assert!(refused.contains(&rc.display().to_string()), "got: {refused}");
        assert!(refused.contains("/tools/mnemo"), "got: {refused}");
        assert_eq!(std::fs::read(&rc).unwrap(), latin1);

        std::fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn an_rc_file_that_cannot_be_read_stops_the_write() {
        let home = temp_home("unreadable");
        // A directory where the file would be: reading it fails, and not with "not found".
        let rc = home.join(".zshrc");
        std::fs::create_dir_all(&rc).unwrap();

        let refused = add_to_path_unix_at(&rc, "zsh", &dirs(&["/tools/mnemo"])).unwrap_err();
        assert!(refused.contains(&rc.display().to_string()), "got: {refused}");
        assert!(rc.is_dir());

        std::fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn a_fish_user_gets_the_line_in_config_fish_and_is_told_so() {
        let home = temp_home("fish");
        let rc = rc_path(&home, None, "fish");

        let msg = add_to_path_unix_at(&rc, "fish", &dirs(&["/tools/mnemo"])).unwrap();
        assert!(msg.contains(&rc.display().to_string()), "got: {msg}");
        assert!(std::fs::read_to_string(&rc).unwrap().contains("set -gx PATH \"/tools/mnemo\" $PATH\n"));
        assert!(!home.join(".bashrc").exists());

        std::fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn path_units_reads_utf16_and_drops_the_nuls_that_end_it() {
        let data: Vec<u8> = w("C:\\Users\\José\\bin").iter().chain([&0, &0]).flat_map(|u| u.to_le_bytes()).collect();
        assert_eq!(path_units(&data), Ok(w("C:\\Users\\José\\bin")));
        assert_eq!(path_units(&[]), Ok(Vec::new()));
        assert_eq!(path_units(&[0, 0]), Ok(Vec::new()));
    }

    #[test]
    fn path_units_refuses_half_a_character_and_a_nul_inside() {
        assert!(path_units(&[b'C', 0, b':']).is_err());
        assert!(path_units(&[b'C', 0, 0, 0, b'D', 0]).is_err());
    }

    #[test]
    fn merge_windows_path_keeps_existing_entries_unit_for_unit_including_unexpanded_vars() {
        let existing = w("C:\\a;%USERPROFILE%\\.local\\bin;C:\\Users\\José\\b");
        let merged = merge_windows_path(&existing, &dirs(&["C:\\new"])).unwrap();
        assert_eq!(merged, w("C:\\a;%USERPROFILE%\\.local\\bin;C:\\Users\\José\\b;C:\\new"));
    }

    #[test]
    fn merge_windows_path_leaves_empty_entries_and_a_lone_surrogate_as_they_are() {
        let mut existing = w("C:\\a;;C:\\b\\");
        existing.push(0xD800);
        existing.extend(w(";"));
        let merged = merge_windows_path(&existing, &dirs(&["C:\\new", "C:\\more"])).unwrap();
        let mut expected = existing.clone();
        expected.extend(w("C:\\new;C:\\more"));
        assert_eq!(merged, expected);
    }

    #[test]
    fn merge_windows_path_is_none_when_every_dir_is_already_present() {
        assert_eq!(merge_windows_path(&w("C:\\a;C:\\new"), &dirs(&["C:\\new"])), None);
    }

    #[test]
    fn merge_windows_path_adds_only_the_dirs_that_are_missing() {
        let merged = merge_windows_path(&w("C:\\new;C:\\a"), &dirs(&["C:\\new", "C:\\more"])).unwrap();
        assert_eq!(merged, w("C:\\new;C:\\a;C:\\more"));
    }

    #[test]
    fn merge_windows_path_does_not_confuse_an_unexpanded_var_with_its_literal_expansion() {
        // A dir the app wants that happens to equal what %USERPROFILE%\bin would expand to is
        // still appended: the comparison is against the stored string, not its meaning.
        let merged = merge_windows_path(&w("%USERPROFILE%\\bin"), &dirs(&["C:\\Users\\a\\bin"])).unwrap();
        assert_eq!(merged, w("%USERPROFILE%\\bin;C:\\Users\\a\\bin"));
    }

    #[test]
    fn merge_windows_path_handles_an_empty_existing_value() {
        assert_eq!(merge_windows_path(&[], &dirs(&["C:\\new"])).unwrap(), w("C:\\new"));
    }

    #[test]
    fn merge_windows_path_survives_a_value_over_1024_characters() {
        let long_existing = w(&std::iter::repeat("C:\\some\\long\\segment").take(80).collect::<Vec<_>>().join(";"));
        assert!(long_existing.len() > 1024);
        let merged = merge_windows_path(&long_existing, &dirs(&["C:\\new"])).unwrap();
        assert!(merged.starts_with(&long_existing));
        assert!(merged.ends_with(&w(";C:\\new")));
    }

    /// The real registry, under a key made for one test and removed when it ends. Never
    /// `HKCU\Environment`: the code under test takes the key it works on.
    #[cfg(windows)]
    mod in_the_registry {
        use super::super::registry::{wide, Hkey, Key, HKEY_CURRENT_USER, KEY_QUERY_VALUE, KEY_SET_VALUE, REG_EXPAND_SZ, REG_SZ};
        use super::super::{add_to_path_in_key, add_to_path_windows_at, registry};
        use super::{dirs, w};

        const REG_DWORD: u32 = 4;
        const KEY_ALL_ACCESS: u32 = 0x000F_003F;

        #[link(name = "advapi32")]
        extern "system" {
            fn RegCreateKeyExW(
                hkey: Hkey,
                sub_key: *const u16,
                reserved: u32,
                class: *const u16,
                options: u32,
                access: u32,
                security: *const std::ffi::c_void,
                result: *mut Hkey,
                disposition: *mut u32,
            ) -> i32;
            fn RegDeleteTreeW(hkey: Hkey, sub_key: *const u16) -> i32;
        }

        struct Scratch {
            sub_key: String,
        }

        impl Scratch {
            /// A name no test shares, and not yet made: `made` makes it.
            fn named(test: &str) -> Scratch {
                let sub_key = format!("Software\\mnemo-desktop-test-{}-{test}", std::process::id());
                assert_ne!(sub_key, "Environment");
                unsafe { RegDeleteTreeW(HKEY_CURRENT_USER, wide(&sub_key).as_ptr()) };
                Scratch { sub_key }
            }

            fn made(test: &str) -> Scratch {
                let scratch = Scratch::named(test);
                let mut handle: Hkey = 0;
                let rc = unsafe {
                    RegCreateKeyExW(
                        HKEY_CURRENT_USER,
                        wide(&scratch.sub_key).as_ptr(),
                        0,
                        std::ptr::null(),
                        0,
                        KEY_ALL_ACCESS,
                        std::ptr::null(),
                        &mut handle,
                        std::ptr::null_mut(),
                    )
                };
                assert_eq!(rc, 0, "RegCreateKeyExW: {}", registry::error(rc));
                drop(Key::from_raw(handle));
                scratch
            }

            fn exists(&self) -> bool {
                Key::open(HKEY_CURRENT_USER, &self.sub_key, KEY_QUERY_VALUE).is_ok()
            }

            fn key(&self, access: u32) -> Key {
                Key::open(HKEY_CURRENT_USER, &self.sub_key, access).unwrap_or_else(|rc| panic!("open {}: {}", self.sub_key, registry::error(rc)))
            }

            /// Stores `text` under `name`, with the NUL that ends a string value.
            fn put(&self, name: &str, kind: u32, text: &str) {
                let data: Vec<u8> = text.encode_utf16().chain([0]).flat_map(|u| u.to_le_bytes()).collect();
                self.put_raw(name, kind, &data);
            }

            fn put_raw(&self, name: &str, kind: u32, data: &[u8]) {
                self.key(KEY_SET_VALUE).write(&wide(name), kind, data).unwrap_or_else(|rc| panic!("write: {}", registry::error(rc)));
            }

            /// The `Path` value as stored: the name in its own case, the type, the raw bytes.
            fn path(&self) -> Option<(String, u32, Vec<u8>)> {
                let key = self.key(KEY_QUERY_VALUE);
                let name = key.stored_name("Path").unwrap()?;
                let (kind, data) = key.read(&name).unwrap()?;
                Some((String::from_utf16(&name[..name.len() - 1]).unwrap(), kind, data))
            }
        }

        impl Drop for Scratch {
            fn drop(&mut self) {
                unsafe { RegDeleteTreeW(HKEY_CURRENT_USER, wide(&self.sub_key).as_ptr()) };
            }
        }

        /// `text` as a string value holds it: UTF-16, little-endian, one NUL at the end.
        fn stored(text: &str) -> Vec<u8> {
            w(text).iter().chain([&0]).flat_map(|u| u.to_le_bytes()).collect()
        }

        #[test]
        fn an_entry_outside_ascii_is_written_back_as_it_was() {
            let scratch = Scratch::made("non-ascii");
            let before = "C:\\Users\\José\\bin;%USERPROFILE%\\日本語;C:\\Program Files\\Ünïcödé 🙂\\bin";
            scratch.put("Path", REG_EXPAND_SZ, before);

            assert_eq!(add_to_path_windows_at(&scratch.sub_key, &dirs(&["C:\\new"])), Ok(true));
            assert_eq!(scratch.path(), Some(("Path".to_string(), REG_EXPAND_SZ, stored(&format!("{before};C:\\new")))));
        }

        #[test]
        fn a_value_named_in_capitals_keeps_its_name_and_its_type() {
            let scratch = Scratch::made("capitals");
            scratch.put("PATH", REG_SZ, "C:\\a;C:\\b");

            assert_eq!(add_to_path_windows_at(&scratch.sub_key, &dirs(&["C:\\new"])), Ok(true));
            assert_eq!(scratch.path(), Some(("PATH".to_string(), REG_SZ, stored("C:\\a;C:\\b;C:\\new"))));
        }

        #[test]
        fn an_empty_value_gets_the_dirs_and_keeps_its_type() {
            let scratch = Scratch::made("empty");
            scratch.put("Path", REG_SZ, "");

            assert_eq!(add_to_path_windows_at(&scratch.sub_key, &dirs(&["C:\\new", "C:\\more"])), Ok(true));
            assert_eq!(scratch.path(), Some(("Path".to_string(), REG_SZ, stored("C:\\new;C:\\more"))));
        }

        #[test]
        fn a_value_with_no_data_at_all_gets_the_dirs() {
            let scratch = Scratch::made("no-data");
            scratch.put_raw("Path", REG_EXPAND_SZ, &[]);

            assert_eq!(add_to_path_windows_at(&scratch.sub_key, &dirs(&["C:\\new"])), Ok(true));
            assert_eq!(scratch.path(), Some(("Path".to_string(), REG_EXPAND_SZ, stored("C:\\new"))));
        }

        #[test]
        fn a_missing_value_is_made_expandable() {
            let scratch = Scratch::made("missing");
            scratch.put("Other", REG_SZ, "kept");

            assert_eq!(add_to_path_windows_at(&scratch.sub_key, &dirs(&["C:\\new"])), Ok(true));
            assert_eq!(scratch.path(), Some(("Path".to_string(), REG_EXPAND_SZ, stored("C:\\new"))));
        }

        #[test]
        fn a_second_run_changes_nothing() {
            let scratch = Scratch::made("twice");
            scratch.put("Path", REG_EXPAND_SZ, "C:\\a");

            assert_eq!(add_to_path_windows_at(&scratch.sub_key, &dirs(&["C:\\new"])), Ok(true));
            let after = scratch.path();
            assert_eq!(add_to_path_windows_at(&scratch.sub_key, &dirs(&["C:\\new"])), Ok(false));
            assert_eq!(scratch.path(), after);
        }

        #[test]
        fn a_key_that_cannot_be_opened_is_not_read_as_an_empty_path() {
            let scratch = Scratch::named("no-key");

            let refused = add_to_path_windows_at(&scratch.sub_key, &dirs(&["C:\\new"])).unwrap_err();
            assert!(refused.contains(&scratch.sub_key), "got: {refused}");
            assert!(!scratch.exists(), "the key was made, with only the app's dirs in it");
        }

        #[test]
        fn a_value_that_is_not_text_is_left_alone() {
            let scratch = Scratch::made("not-text");
            scratch.put_raw("Path", REG_DWORD, &[1, 0, 0, 0]);

            let refused = add_to_path_windows_at(&scratch.sub_key, &dirs(&["C:\\new"])).unwrap_err();
            assert!(refused.contains("Nothing was changed"), "got: {refused}");
            assert_eq!(scratch.path(), Some(("Path".to_string(), REG_DWORD, vec![1, 0, 0, 0])));
        }

        #[test]
        fn a_key_that_refuses_the_read_stops_the_write() {
            let scratch = Scratch::made("no-read");
            scratch.put("Path", REG_EXPAND_SZ, "C:\\Users\\José\\bin");
            // Open for writing only: Windows refuses the read with "access is denied", and the
            // write that would have followed is one this handle allows.
            let write_only = scratch.key(KEY_SET_VALUE);

            let refused = add_to_path_in_key(&write_only, "the scratch key", &dirs(&["C:\\new"])).unwrap_err();
            assert!(refused.contains("Could not read"), "got: {refused}");
            assert_eq!(scratch.path(), Some(("Path".to_string(), REG_EXPAND_SZ, stored("C:\\Users\\José\\bin"))));
        }

        /// The broadcast touches no key: it only has to go out without bringing the process down.
        #[test]
        fn the_environment_broadcast_returns() {
            let _ = registry::broadcast_environment_change();
        }
    }
}

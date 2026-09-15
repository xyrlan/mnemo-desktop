//! File commands for the editor pane. Every path is resolved (symlinks included)
//! and refused unless it lands inside the user's home directory.

use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
pub struct Entry {
    pub name: String,
    pub is_dir: bool,
}

/// Files above this size are refused by `fs_read`; Monaco is not a log viewer.
const MAX_READ_BYTES: u64 = 10 * 1024 * 1024;

fn home() -> Result<PathBuf, String> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .ok_or_else(|| "cannot determine home directory".to_string())
}

/// Resolves `path` and returns it if it lies inside `home`. A path that does not
/// exist yet (a new file) is checked through its parent, which must exist.
pub fn guard(path: &str, home: &Path) -> Result<PathBuf, String> {
    let raw = Path::new(path);
    if !raw.is_absolute() {
        return Err(format!("path must be absolute: {path}"));
    }
    let home = home.canonicalize().map_err(|e| format!("home directory: {e}"))?;
    let resolved = match raw.canonicalize() {
        Ok(p) => p,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            let (parent, name) = match (raw.parent(), raw.file_name()) {
                (Some(p), Some(n)) => (p, n),
                _ => return Err(format!("{path}: {e}")),
            };
            parent.canonicalize().map_err(|e| format!("{path}: {e}"))?.join(name)
        }
        Err(e) => return Err(format!("{path}: {e}")),
    };
    if !resolved.starts_with(&home) {
        return Err(format!("refusing path outside the home directory: {path}"));
    }
    Ok(resolved)
}

pub fn read_in(path: &str, home: &Path) -> Result<String, String> {
    let p = guard(path, home)?;
    let meta = std::fs::metadata(&p).map_err(|e| format!("{path}: {e}"))?;
    if meta.is_dir() {
        return Err(format!("{path} is a directory"));
    }
    if meta.len() > MAX_READ_BYTES {
        return Err(format!("{path} is too large to open ({} MB)", meta.len() / (1024 * 1024)));
    }
    let bytes = std::fs::read(&p).map_err(|e| format!("{path}: {e}"))?;
    String::from_utf8(bytes).map_err(|_| format!("{path} is not a UTF-8 text file"))
}

pub fn write_in(path: &str, contents: &str, home: &Path) -> Result<(), String> {
    let p = guard(path, home)?;
    if p.is_dir() {
        return Err(format!("{path} is a directory"));
    }
    std::fs::write(&p, contents).map_err(|e| format!("{path}: {e}"))
}

/// Directories first, then files, each group sorted case-insensitively.
pub fn list_in(dir: &str, home: &Path) -> Result<Vec<Entry>, String> {
    let p = guard(dir, home)?;
    let mut entries = std::fs::read_dir(&p)
        .map_err(|e| format!("{dir}: {e}"))?
        .filter_map(|e| e.ok())
        .map(|e| {
            // Follow symlinks so a linked directory expands like a real one.
            let is_dir = std::fs::metadata(e.path()).map(|m| m.is_dir()).unwrap_or(false);
            Entry { name: e.file_name().to_string_lossy().into_owned(), is_dir }
        })
        .collect::<Vec<_>>();
    entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(entries)
}

#[tauri::command]
pub async fn fs_read(path: String) -> Result<String, String> {
    read_in(&path, &home()?)
}

#[tauri::command]
pub async fn fs_write(path: String, contents: String) -> Result<(), String> {
    write_in(&path, &contents, &home()?)
}

#[tauri::command]
pub async fn fs_list(dir: String) -> Result<Vec<Entry>, String> {
    list_in(&dir, &home()?)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fresh directory standing in for $HOME, plus a sibling outside it.
    struct Sandbox {
        root: PathBuf,
        home: PathBuf,
        outside: PathBuf,
    }

    impl Sandbox {
        fn new(tag: &str) -> Self {
            // Canonical, so the guard tests exercise escapes rather than the /var -> /private/var link.
            let root = std::env::temp_dir().canonicalize().unwrap().join(format!("mnemo-fs-{tag}-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&root);
            let home = root.join("home");
            let outside = root.join("outside");
            std::fs::create_dir_all(&home).unwrap();
            std::fs::create_dir_all(&outside).unwrap();
            Sandbox { root, home, outside }
        }
        fn in_home(&self, rel: &str) -> String {
            self.home.join(rel).to_string_lossy().into_owned()
        }
    }

    impl Drop for Sandbox {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn read_write_round_trip() {
        let s = Sandbox::new("rw");
        let f = s.in_home("a.txt");
        write_in(&f, "hello\nworld", &s.home).unwrap();
        assert_eq!(read_in(&f, &s.home).unwrap(), "hello\nworld");
        write_in(&f, "changed", &s.home).unwrap();
        assert_eq!(std::fs::read_to_string(&f).unwrap(), "changed");
    }

    #[test]
    fn write_creates_new_file_in_existing_dir_only() {
        let s = Sandbox::new("new");
        write_in(&s.in_home("fresh.rs"), "fn main() {}", &s.home).unwrap();
        assert!(s.home.join("fresh.rs").is_file());
        assert!(write_in(&s.in_home("missing/dir/x.rs"), "", &s.home).is_err());
    }

    #[test]
    fn list_sorts_dirs_first_case_insensitive() {
        let s = Sandbox::new("list");
        std::fs::create_dir(s.home.join("src")).unwrap();
        std::fs::create_dir(s.home.join("Docs")).unwrap();
        std::fs::write(s.home.join("b.txt"), "").unwrap();
        std::fs::write(s.home.join("A.txt"), "").unwrap();
        let got = list_in(&s.home.to_string_lossy(), &s.home).unwrap();
        let names: Vec<_> = got.iter().map(|e| (e.name.as_str(), e.is_dir)).collect();
        assert_eq!(names, vec![("Docs", true), ("src", true), ("A.txt", false), ("b.txt", false)]);
    }

    #[test]
    fn guard_refuses_paths_outside_home() {
        let s = Sandbox::new("guard");
        let out = s.outside.join("secret.txt");
        std::fs::write(&out, "nope").unwrap();
        let out = out.to_string_lossy().into_owned();
        assert!(read_in(&out, &s.home).unwrap_err().contains("outside the home"));
        assert!(write_in(&out, "x", &s.home).is_err());
        assert_eq!(std::fs::read_to_string(&out).unwrap(), "nope");
        assert!(list_in(&s.outside.to_string_lossy(), &s.home).is_err());
        // A new file outside home is refused too, not just existing ones.
        assert!(write_in(&s.outside.join("new.txt").to_string_lossy(), "x", &s.home).is_err());
        assert!(!s.outside.join("new.txt").exists());
    }

    #[test]
    fn guard_refuses_dotdot_escape() {
        let s = Sandbox::new("dotdot");
        std::fs::write(s.outside.join("secret.txt"), "nope").unwrap();
        let sneaky = s.in_home("../outside/secret.txt");
        assert!(read_in(&sneaky, &s.home).is_err());
        assert!(write_in(&s.in_home("../outside/new.txt"), "x", &s.home).is_err());
    }

    #[test]
    fn guard_refuses_sibling_with_home_as_prefix() {
        let s = Sandbox::new("prefix");
        let twin = s.root.join("home-evil");
        std::fs::create_dir(&twin).unwrap();
        std::fs::write(twin.join("f"), "x").unwrap();
        assert!(read_in(&twin.join("f").to_string_lossy(), &s.home).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn guard_refuses_symlink_escaping_home() {
        let s = Sandbox::new("link");
        std::fs::write(s.outside.join("secret.txt"), "nope").unwrap();
        std::os::unix::fs::symlink(&s.outside, s.home.join("link")).unwrap();
        assert!(read_in(&s.in_home("link/secret.txt"), &s.home).is_err());
        assert!(write_in(&s.in_home("link/new.txt"), "x", &s.home).is_err());
        assert!(list_in(&s.in_home("link"), &s.home).is_err());
    }

    #[test]
    fn guard_refuses_relative_paths() {
        let s = Sandbox::new("rel");
        assert!(read_in("a.txt", &s.home).unwrap_err().contains("absolute"));
    }

    #[test]
    fn read_rejects_binary_and_directories() {
        let s = Sandbox::new("bin");
        std::fs::write(s.home.join("x.bin"), [0xff, 0xfe, 0x00, 0x80]).unwrap();
        assert!(read_in(&s.in_home("x.bin"), &s.home).unwrap_err().contains("UTF-8"));
        assert!(read_in(&s.home.to_string_lossy(), &s.home).unwrap_err().contains("directory"));
    }

    #[cfg(unix)]
    #[test]
    fn write_to_read_only_file_errors() {
        use std::os::unix::fs::PermissionsExt;
        let s = Sandbox::new("ro");
        let f = s.home.join("ro.txt");
        std::fs::write(&f, "keep").unwrap();
        std::fs::set_permissions(&f, std::fs::Permissions::from_mode(0o444)).unwrap();
        let err = write_in(&f.to_string_lossy(), "x", &s.home);
        std::fs::set_permissions(&f, std::fs::Permissions::from_mode(0o644)).unwrap();
        assert!(err.is_err());
        assert_eq!(std::fs::read_to_string(&f).unwrap(), "keep");
    }
}

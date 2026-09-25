//! File commands for the editor pane. Every path is resolved (symlinks included) and refused
//! unless it lands inside the user's home directory, inside a saved project's folder, or inside
//! one of that project's worktrees as git lists them — a project outside `$HOME` (`/Volumes/…`,
//! `/opt/src/…`) keeps its worktrees beside it. A project or worktree that is `/`, a system
//! folder, or a folder that holds the home directory widens nothing.

use serde::Serialize;
use std::path::{Component, Path, PathBuf};

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

/// Where the file commands may reach: the home directory and the saved projects.
pub struct Scope {
    pub home: PathBuf,
    pub projects: Vec<String>,
}

impl Scope {
    /// The home directory alone.
    pub fn home(home: &Path) -> Self {
        Scope { home: home.to_path_buf(), projects: Vec::new() }
    }

    /// The user's home directory and the projects saved in settings.
    pub fn current() -> Result<Self, String> {
        Ok(Scope { home: home()?, projects: crate::settings::projects() })
    }
}

/// Folders nothing is ever opened inside, as path segments from the root.
const SYSTEM_TREES: &[&[&str]] = &[
    &["System"],
    &["Library"],
    &["bin"],
    &["sbin"],
    &["etc"],
    &["dev"],
    &["proc"],
    &["sys"],
    &["boot"],
    &["lib"],
    &["lib32"],
    &["lib64"],
    &["private", "etc"],
    &["usr", "bin"],
    &["usr", "sbin"],
    &["usr", "lib"],
    &["usr", "libexec"],
    &["usr", "share"],
    &["Windows"],
    &["Program Files"],
    &["Program Files (x86)"],
    &["ProgramData"],
];

/// Folders that hold other people's or other volumes' files: fine below, never as a whole.
const SYSTEM_FOLDERS: &[&[&str]] = &[
    &["usr"],
    &["usr", "local"],
    &["var"],
    &["private"],
    &["private", "var"],
    &["private", "tmp"],
    &["tmp"],
    &["opt"],
    &["srv"],
    &["root"],
    &["home"],
    &["Users"],
    &["Volumes"],
    &["mnt"],
    &["media"],
    &["Applications"],
];

/// Whether `root` (canonical) is too wide to open: a filesystem root, a system folder or one
/// inside it, or a folder the home directory sits in.
fn too_wide(root: &Path, home: &Path) -> bool {
    let parts: Vec<String> = root
        .components()
        .filter_map(|c| match c {
            Component::Normal(s) => Some(s.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect();
    let is = |segs: &[&str]| parts.len() == segs.len() && parts.iter().zip(segs).all(|(a, b)| a.eq_ignore_ascii_case(b));
    let under = |segs: &[&str]| parts.len() >= segs.len() && parts.iter().zip(segs).all(|(a, b)| a.eq_ignore_ascii_case(b));
    parts.is_empty()
        || SYSTEM_TREES.iter().any(|t| under(t))
        || SYSTEM_FOLDERS.iter().any(|f| is(f))
        || (home.starts_with(root) && home != root)
}

/// The folders of every worktree of the repo `dir` is in, as `git worktree list` reports them;
/// nothing when `dir` is not in a repo.
fn worktrees(dir: &Path) -> Vec<PathBuf> {
    let out = match crate::proc::command("git").arg("-C").arg(dir).args(["worktree", "list", "--porcelain"]).output() {
        Ok(o) if o.status.success() => o.stdout,
        _ => return Vec::new(),
    };
    let text = String::from_utf8_lossy(&out).replace("\r\n", "\n");
    text.split("\n\n")
        // A bare repo's own entry is no place to work.
        .filter(|block| !block.lines().any(|l| l == "bare"))
        .filter_map(|block| block.lines().find_map(|l| l.strip_prefix("worktree ")).map(PathBuf::from))
        .collect()
}

impl Scope {
    /// Whether `resolved` (canonical) lies in the scope. The home directory and the project
    /// folders are checked first; git is asked for worktrees only when neither holds the path.
    fn allows(&self, resolved: &Path, home: &Path) -> bool {
        if resolved.starts_with(home) {
            return true;
        }
        let inside = |root: &Path| match root.canonicalize() {
            Ok(root) => !too_wide(&root, home) && resolved.starts_with(&root),
            Err(_) => false,
        };
        let projects: Vec<&Path> = self.projects.iter().map(Path::new).filter(|p| p.is_absolute()).collect();
        if projects.iter().any(|p| inside(p)) {
            return true;
        }
        projects.iter().filter(|p| p.is_dir()).any(|p| worktrees(p).iter().any(|w| inside(w)))
    }
}

/// Resolves `path` and returns it if it lies in `scope`. A path that does not exist yet (a new
/// file) is checked through its parent, which must exist.
pub fn guard(path: &str, scope: &Scope) -> Result<PathBuf, String> {
    let raw = Path::new(path);
    if !raw.is_absolute() {
        return Err(format!("path must be absolute: {path}"));
    }
    let home = scope.home.canonicalize().map_err(|e| format!("home directory: {e}"))?;
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
    if !scope.allows(&resolved, &home) {
        return Err(format!("refusing path outside the home directory and the saved projects: {path}"));
    }
    Ok(resolved)
}

pub fn read_in(path: &str, scope: &Scope) -> Result<String, String> {
    let p = guard(path, scope)?;
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

pub fn write_in(path: &str, contents: &str, scope: &Scope) -> Result<(), String> {
    let p = guard(path, scope)?;
    if p.is_dir() {
        return Err(format!("{path} is a directory"));
    }
    std::fs::write(&p, contents).map_err(|e| format!("{path}: {e}"))
}

/// Directories first, then files, each group sorted case-insensitively.
pub fn list_in(dir: &str, scope: &Scope) -> Result<Vec<Entry>, String> {
    let p = guard(dir, scope)?;
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
    read_in(&path, &Scope::current()?)
}

#[tauri::command]
pub async fn fs_write(path: String, contents: String) -> Result<(), String> {
    write_in(&path, &contents, &Scope::current()?)
}

#[tauri::command]
pub async fn fs_list(dir: String) -> Result<Vec<Entry>, String> {
    list_in(&dir, &Scope::current()?)
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
            let root = crate::testutil::temp_dir(&format!("fs-{tag}")).canonicalize().unwrap();
            let home = root.join("home");
            let outside = root.join("outside");
            std::fs::create_dir_all(&home).unwrap();
            std::fs::create_dir_all(&outside).unwrap();
            Sandbox { root, home, outside }
        }
        fn scope(&self) -> Scope {
            Scope::home(&self.home)
        }
        /// The home directory plus `projects`, as saved in settings.
        fn with(&self, projects: &[&Path]) -> Scope {
            Scope { home: self.home.clone(), projects: projects.iter().map(|p| p.to_string_lossy().into_owned()).collect() }
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
        write_in(&f, "hello\nworld", &s.scope()).unwrap();
        assert_eq!(read_in(&f, &s.scope()).unwrap(), "hello\nworld");
        write_in(&f, "changed", &s.scope()).unwrap();
        assert_eq!(std::fs::read_to_string(&f).unwrap(), "changed");
    }

    #[test]
    fn write_creates_new_file_in_existing_dir_only() {
        let s = Sandbox::new("new");
        write_in(&s.in_home("fresh.rs"), "fn main() {}", &s.scope()).unwrap();
        assert!(s.home.join("fresh.rs").is_file());
        assert!(write_in(&s.in_home("missing/dir/x.rs"), "", &s.scope()).is_err());
    }

    #[test]
    fn list_sorts_dirs_first_case_insensitive() {
        let s = Sandbox::new("list");
        std::fs::create_dir(s.home.join("src")).unwrap();
        std::fs::create_dir(s.home.join("Docs")).unwrap();
        std::fs::write(s.home.join("b.txt"), "").unwrap();
        std::fs::write(s.home.join("A.txt"), "").unwrap();
        let got = list_in(&s.home.to_string_lossy(), &s.scope()).unwrap();
        let names: Vec<_> = got.iter().map(|e| (e.name.as_str(), e.is_dir)).collect();
        assert_eq!(names, vec![("Docs", true), ("src", true), ("A.txt", false), ("b.txt", false)]);
    }

    #[test]
    fn guard_refuses_paths_outside_home() {
        let s = Sandbox::new("guard");
        let out = s.outside.join("secret.txt");
        std::fs::write(&out, "nope").unwrap();
        let out = out.to_string_lossy().into_owned();
        assert!(read_in(&out, &s.scope()).unwrap_err().contains("outside the home"));
        assert!(write_in(&out, "x", &s.scope()).is_err());
        assert_eq!(std::fs::read_to_string(&out).unwrap(), "nope");
        assert!(list_in(&s.outside.to_string_lossy(), &s.scope()).is_err());
        // A new file outside home is refused too, not just existing ones.
        assert!(write_in(&s.outside.join("new.txt").to_string_lossy(), "x", &s.scope()).is_err());
        assert!(!s.outside.join("new.txt").exists());
    }

    #[test]
    fn guard_refuses_dotdot_escape() {
        let s = Sandbox::new("dotdot");
        std::fs::write(s.outside.join("secret.txt"), "nope").unwrap();
        let sneaky = s.in_home("../outside/secret.txt");
        assert!(read_in(&sneaky, &s.scope()).is_err());
        assert!(write_in(&s.in_home("../outside/new.txt"), "x", &s.scope()).is_err());
    }

    #[test]
    fn guard_refuses_sibling_with_home_as_prefix() {
        let s = Sandbox::new("prefix");
        let twin = s.root.join("home-evil");
        std::fs::create_dir(&twin).unwrap();
        std::fs::write(twin.join("f"), "x").unwrap();
        assert!(read_in(&twin.join("f").to_string_lossy(), &s.scope()).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn guard_refuses_symlink_escaping_home() {
        let s = Sandbox::new("link");
        std::fs::write(s.outside.join("secret.txt"), "nope").unwrap();
        std::os::unix::fs::symlink(&s.outside, s.home.join("link")).unwrap();
        assert!(read_in(&s.in_home("link/secret.txt"), &s.scope()).is_err());
        assert!(write_in(&s.in_home("link/new.txt"), "x", &s.scope()).is_err());
        assert!(list_in(&s.in_home("link"), &s.scope()).is_err());
    }

    #[test]
    fn guard_refuses_relative_paths() {
        let s = Sandbox::new("rel");
        assert!(read_in("a.txt", &s.scope()).unwrap_err().contains("absolute"));
    }

    #[test]
    fn read_rejects_binary_and_directories() {
        let s = Sandbox::new("bin");
        std::fs::write(s.home.join("x.bin"), [0xff, 0xfe, 0x00, 0x80]).unwrap();
        assert!(read_in(&s.in_home("x.bin"), &s.scope()).unwrap_err().contains("UTF-8"));
        assert!(read_in(&s.home.to_string_lossy(), &s.scope()).unwrap_err().contains("directory"));
    }

    #[cfg(unix)]
    #[test]
    fn write_to_read_only_file_errors() {
        use std::os::unix::fs::PermissionsExt;
        let s = Sandbox::new("ro");
        let f = s.home.join("ro.txt");
        std::fs::write(&f, "keep").unwrap();
        std::fs::set_permissions(&f, std::fs::Permissions::from_mode(0o444)).unwrap();
        let err = write_in(&f.to_string_lossy(), "x", &s.scope());
        std::fs::set_permissions(&f, std::fs::Permissions::from_mode(0o644)).unwrap();
        assert!(err.is_err());
        assert_eq!(std::fs::read_to_string(&f).unwrap(), "keep");
    }

    fn git(dir: &Path, args: &[&str]) {
        let out = crate::proc::command("git").arg("-C").arg(dir).args(args).output().unwrap();
        assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
    }

    fn at(p: &Path) -> String {
        p.to_string_lossy().into_owned()
    }

    #[test]
    fn a_saved_project_outside_home_opens() {
        let s = Sandbox::new("project");
        let proj = s.outside.join("proj");
        std::fs::create_dir_all(proj.join("src")).unwrap();
        std::fs::write(proj.join("src/a.rs"), "fn a() {}").unwrap();
        let scope = s.with(&[&proj]);
        assert_eq!(read_in(&at(&proj.join("src/a.rs")), &scope).unwrap(), "fn a() {}");
        write_in(&at(&proj.join("src/b.rs")), "fn b() {}", &scope).unwrap();
        let names: Vec<_> = list_in(&at(&proj.join("src")), &scope).unwrap().into_iter().map(|e| e.name).collect();
        assert_eq!(names, vec!["a.rs", "b.rs"]);
        // Home still opens beside it.
        write_in(&s.in_home("h.txt"), "h", &scope).unwrap();
        // Its neighbours do not, nor a way out of it.
        std::fs::write(s.outside.join("secret.txt"), "nope").unwrap();
        assert!(read_in(&at(&s.outside.join("secret.txt")), &scope).unwrap_err().contains("outside the home directory"));
        assert!(list_in(&at(&s.outside), &scope).is_err());
        assert!(read_in(&format!("{}/../secret.txt", at(&proj)), &scope).is_err());
        std::fs::create_dir(s.outside.join("proj-evil")).unwrap();
        assert!(list_in(&at(&s.outside.join("proj-evil")), &scope).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_out_of_a_project_is_refused() {
        let s = Sandbox::new("project-link");
        let proj = s.outside.join("proj");
        let other = s.outside.join("other");
        std::fs::create_dir_all(&proj).unwrap();
        std::fs::create_dir_all(&other).unwrap();
        std::fs::write(other.join("secret.txt"), "nope").unwrap();
        std::os::unix::fs::symlink(&other, proj.join("link")).unwrap();
        let scope = s.with(&[&proj]);
        assert!(read_in(&at(&proj.join("link/secret.txt")), &scope).is_err());
        assert!(write_in(&at(&proj.join("link/new.txt")), "x", &scope).is_err());
    }

    #[test]
    fn a_projects_worktrees_open_beside_it() {
        let s = Sandbox::new("worktrees");
        let proj = s.outside.join("repo");
        std::fs::create_dir_all(&proj).unwrap();
        git(&proj, &["init", "-q"]);
        std::fs::write(proj.join("a.txt"), "a").unwrap();
        git(&proj, &["add", "a.txt"]);
        git(&proj, &["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "a"]);
        let wt = s.outside.join("repo-wt-one");
        git(&proj, &["worktree", "add", "-q", "-b", "one", &at(&wt)]);
        let scope = s.with(&[&proj]);
        assert_eq!(read_in(&at(&wt.join("a.txt")), &scope).unwrap(), "a");
        write_in(&at(&wt.join("b.txt")), "b", &scope).unwrap();
        assert_eq!(list_in(&at(&wt), &scope).unwrap().len(), 3); // .git, a.txt, b.txt
        // A folder named like a worktree that git does not list stays shut.
        let fake = s.outside.join("repo-wt-two");
        std::fs::create_dir(&fake).unwrap();
        assert!(list_in(&at(&fake), &scope).is_err());
        // Without the project saved, the worktree is outside like anything else.
        assert!(read_in(&at(&wt.join("a.txt")), &s.scope()).is_err());
    }

    #[test]
    fn a_project_too_wide_widens_nothing() {
        let s = Sandbox::new("wide");
        std::fs::write(s.outside.join("secret.txt"), "nope").unwrap();
        let secret = at(&s.outside.join("secret.txt"));
        // `/`, and a folder the home directory sits in.
        assert!(read_in(&secret, &s.with(&[Path::new("/")])).is_err());
        assert!(read_in(&secret, &s.with(&[&s.root])).is_err());
        // Relative and missing projects are ignored rather than resolved against anything.
        assert!(read_in(&secret, &s.with(&[Path::new("outside"), &s.root.join("gone")])).is_err());
        assert!(read_in(&secret, &s.with(&[&s.outside])).is_ok());
    }

    #[test]
    fn roots_system_folders_and_homes_parents_are_too_wide() {
        let home = Path::new("/Users/me");
        for p in ["/", "/etc", "/private/etc/ssh", "/System/Library", "/usr", "/usr/bin", "/usr/lib/x", "/Volumes", "/opt", "/Users", "/home", "/var"] {
            assert!(too_wide(Path::new(p), home), "{p}");
        }
        for p in ["/opt/src/repo", "/Volumes/work/repo", "/usr/local/src/repo", "/Users/me/code", "/srv/git/repo"] {
            assert!(!too_wide(Path::new(p), home), "{p}");
        }
    }
}

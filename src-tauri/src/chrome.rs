//! Pane chrome: what the header bar above a pane shows about its cwd (repo, branch).
//! Every bar polls, so answers are cached per cwd for a few seconds and a directory
//! outside any repo costs one `git` spawn per TTL, not one per render.

use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use crate::mission::{repo_root, run};

const TTL: Duration = Duration::from_secs(5);

/// A value per key that is recomputed once it is older than `ttl`. Misses (`None`)
/// are cached too: that is the common case for a shell sitting in `~`.
pub struct Cache<T> {
    ttl: Duration,
    entries: Mutex<HashMap<String, (Instant, T)>>,
}

impl<T: Clone> Cache<T> {
    pub fn new(ttl: Duration) -> Self {
        Self { ttl, entries: Mutex::new(HashMap::new()) }
    }

    pub fn get_or(&self, key: &str, now: Instant, compute: impl FnOnce() -> T) -> T {
        if let Some((at, v)) = self.entries.lock().unwrap().get(key) {
            if now.saturating_duration_since(*at) < self.ttl {
                return v.clone();
            }
        }
        // Computed outside the lock: a slow `git` in one pane must not stall the others.
        let v = compute();
        let mut entries = self.entries.lock().unwrap();
        entries.retain(|_, (at, _)| now.saturating_duration_since(*at) < self.ttl);
        entries.insert(key.to_string(), (now, v.clone()));
        v
    }
}

/// The branch checked out in `cwd` (a worktree reports its own), the short commit when
/// HEAD is detached, None outside a repo.
pub fn branch_of(cwd: &str) -> Option<String> {
    let dir = Some(Path::new(cwd));
    if !Path::new(cwd).is_dir() {
        return None;
    }
    let name = match run("git", &["rev-parse", "--abbrev-ref", "HEAD"], dir) {
        Ok(out) => out.trim().to_string(),
        // An unborn branch (no commit yet) has no HEAD to parse but still has a name.
        Err(_) => run("git", &["symbolic-ref", "--quiet", "--short", "HEAD"], dir).ok()?.trim().to_string(),
    };
    match name.as_str() {
        "" => None,
        "HEAD" => run("git", &["rev-parse", "--short", "HEAD"], dir).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()),
        _ => Some(name),
    }
}

/// The name of the repository `cwd` belongs to: the main checkout's folder, so a worktree
/// beside it shows the repo rather than the worktree folder.
pub fn repo_of(cwd: &str) -> Option<String> {
    if !Path::new(cwd).is_dir() {
        return None;
    }
    let root = repo_root(cwd)?;
    Path::new(&root).file_name().map(|n| n.to_string_lossy().trim_end_matches(".git").to_string()).filter(|n| !n.is_empty())
}

fn branches() -> &'static Cache<Option<String>> {
    static C: std::sync::OnceLock<Cache<Option<String>>> = std::sync::OnceLock::new();
    C.get_or_init(|| Cache::new(TTL))
}

fn repos() -> &'static Cache<Option<String>> {
    static C: std::sync::OnceLock<Cache<Option<String>>> = std::sync::OnceLock::new();
    C.get_or_init(|| Cache::new(TTL))
}

#[tauri::command]
pub async fn chrome_branch(cwd: String) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || branches().get_or(&cwd, Instant::now(), || branch_of(&cwd))).await.ok().flatten()
}

#[tauri::command]
pub async fn chrome_repo(cwd: String) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || repos().get_or(&cwd, Instant::now(), || repo_of(&cwd))).await.ok().flatten()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;
    use std::process::Command;

    #[test]
    fn cache_reuses_within_the_ttl_and_recomputes_after() {
        let c = Cache::new(Duration::from_secs(5));
        let calls = Cell::new(0);
        let t0 = Instant::now();
        let f = || {
            calls.set(calls.get() + 1);
            calls.get()
        };
        assert_eq!(c.get_or("/a", t0, f), 1);
        assert_eq!(c.get_or("/a", t0 + Duration::from_secs(4), f), 1);
        assert_eq!(c.get_or("/b", t0 + Duration::from_secs(4), f), 2);
        assert_eq!(c.get_or("/a", t0 + Duration::from_secs(6), f), 3);
    }

    #[test]
    fn cache_keeps_misses() {
        let c: Cache<Option<String>> = Cache::new(Duration::from_secs(5));
        let t0 = Instant::now();
        assert_eq!(c.get_or("/x", t0, || None), None);
        assert_eq!(c.get_or("/x", t0, || Some("computed".into())), None);
    }

    #[test]
    fn branch_and_repo_of_checkouts_worktrees_and_plain_dirs() {
        let tmp = std::env::temp_dir().join(format!("mnemo-desktop-chrome-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        let main = tmp.join("proj");
        let plain = tmp.join("plain");
        std::fs::create_dir_all(&main).unwrap();
        std::fs::create_dir_all(&plain).unwrap();
        let git = |args: &[&str], cwd: &Path| {
            let out = Command::new("git").args(args).current_dir(cwd).output().unwrap();
            assert!(out.status.success(), "git {:?}: {}", args, String::from_utf8_lossy(&out.stderr));
            String::from_utf8_lossy(&out.stdout).trim().to_string()
        };
        let s = |p: &Path| p.to_str().unwrap().to_string();
        git(&["init", "-q", "-b", "main"], &main);
        // Unborn: no commit yet, the branch still has a name.
        assert_eq!(branch_of(&s(&main)).as_deref(), Some("main"));

        git(&["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"], &main);
        std::fs::create_dir_all(main.join("src/deep")).unwrap();
        assert_eq!(branch_of(&s(&main.join("src/deep"))).as_deref(), Some("main"));
        assert_eq!(repo_of(&s(&main.join("src/deep"))).as_deref(), Some("proj"));

        let wt = tmp.join("proj-wt-chrome");
        git(&["worktree", "add", "-q", "-b", "feat/round5/chrome", &s(&wt)], &main);
        assert_eq!(branch_of(&s(&wt)).as_deref(), Some("feat/round5/chrome"));
        assert_eq!(repo_of(&s(&wt)).as_deref(), Some("proj"));

        let sha = git(&["rev-parse", "--short", "HEAD"], &main);
        git(&["checkout", "-q", "--detach"], &main);
        assert_eq!(branch_of(&s(&main)), Some(sha));

        assert_eq!(branch_of(&s(&plain)), None);
        assert_eq!(repo_of(&s(&plain)), None);
        assert_eq!(branch_of(&s(&tmp.join("missing"))), None);
        let _ = std::fs::remove_dir_all(&tmp);
    }
}

//! Answers the app asks other programs for again and again, kept (#368).
//!
//! The mission poll (every 3 s), each terminal pane (every 5 s) and Home asked `claude agents`
//! on their own, and every poll asked `git` for each cwd's repo root and each repo's worktrees
//! afresh. These keep one answer and say when it may be handed out again:
//!
//! - `Shared`: one answer per key, asked by one caller at a time. A caller that finds another
//!   asking waits for that answer instead of starting its own, and an answer young enough for
//!   the caller is handed out without asking.
//! - `Roots`: a dir's repo root, kept while the `.git` that git would find from it is the one
//!   it found last time.
//! - `Worktrees`: a repo's worktree list, kept while the files `git worktree list` reads are as
//!   they were.
//!
//! Each takes the asking as a closure, so the counts in `spawn_tests` drive the same code.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Instant;

fn locked<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// Past this many kept answers the oldest go: cwds of finished jobs pile up over days.
const MAX_KEPT: usize = 2048;

type Slot<T> = Arc<Mutex<Option<(Instant, T)>>>;

/// One answer per key, asked by one caller at a time.
pub struct Shared<T> {
    slots: Mutex<HashMap<String, Slot<T>>>,
}

impl<T: Clone> Default for Shared<T> {
    fn default() -> Self {
        Self { slots: Mutex::new(HashMap::new()) }
    }
}

impl<T: Clone> Shared<T> {
    /// `key`'s answer when it was asked at or after `not_before`; else a new one from `ask`,
    /// stamped with `now()` as the asking starts. Only callers of the same key wait on each other.
    pub fn get(&self, key: &str, not_before: Instant, now: impl FnOnce() -> Instant, ask: impl FnOnce() -> T) -> T {
        let slot = locked(&self.slots).entry(key.to_string()).or_default().clone();
        let mut held = locked(&slot);
        if let Some((at, v)) = &*held {
            if *at >= not_before {
                return v.clone();
            }
        }
        let at = now();
        let v = ask();
        *held = Some((at, v.clone()));
        v
    }

    /// The last answer for `key` and when it was asked, however old, asking nothing.
    pub fn last(&self, key: &str) -> Option<(Instant, T)> {
        let slot = locked(&self.slots).get(key)?.clone();
        let held = locked(&slot);
        held.clone()
    }
}

/// What git finds from a dir: the nearest `.git` at or above it. A `.git` dir is told by
/// whether it holds a `HEAD` (git passes over one that does not); a `.git` file (a worktree, a
/// submodule) by what it points at.
#[derive(Debug, Clone, PartialEq)]
pub enum Marker {
    None,
    Dir(PathBuf, bool),
    File(PathBuf, Vec<u8>),
}

/// The `Marker` for `dir`, read with a `stat` per level and no process. git's own discovery
/// stats the same paths, so this touches nothing git would not.
pub fn marker_of(dir: &Path) -> Marker {
    for d in dir.ancestors() {
        let g = d.join(".git");
        match std::fs::metadata(&g) {
            Ok(m) if m.is_dir() => {
                let head = g.join("HEAD").is_file();
                return Marker::Dir(g, head);
            }
            Ok(m) if m.is_file() => {
                let to = std::fs::read(&g).unwrap_or_default();
                return Marker::File(g, to);
            }
            _ => {}
        }
    }
    Marker::None
}

/// A dir's repo root, kept against its `Marker`.
#[derive(Default)]
pub struct Roots {
    kept: Mutex<HashMap<String, (Marker, Option<String>)>>,
}

impl Roots {
    /// `cwd`'s repo root: the kept one while `cwd`'s marker is unchanged, else `ask`'s.
    /// A dir that is not there has none, as git run in it had none. git's failure beside a
    /// `.git` may pass (a permission, `safe.directory`), so it is not kept and is asked again;
    /// with no `.git` anywhere above, "no repo" is kept until one appears.
    pub fn get(&self, cwd: &str, ask: impl FnOnce() -> Result<String, String>) -> Option<String> {
        let dir = Path::new(cwd);
        if cwd.is_empty() || !dir.is_dir() {
            return None;
        }
        let marker = marker_of(dir);
        if let Some((m, root)) = locked(&self.kept).get(cwd) {
            if *m == marker {
                return root.clone();
            }
        }
        let got = ask();
        if got.is_ok() || marker == Marker::None {
            let mut kept = locked(&self.kept);
            if kept.len() >= MAX_KEPT {
                kept.clear();
            }
            kept.insert(cwd.to_string(), (marker, got.clone().ok()));
        }
        got.ok()
    }
}

/// What `git worktree list --porcelain` in `root` reads, as bytes: the main checkout's `HEAD`,
/// and for each linked worktree its name, `HEAD`, `gitdir` and whether that worktree is still
/// there. None when `root/.git` is not a plain repo dir: such a repo is asked every time.
pub fn worktrees_print(root: &Path) -> Option<Vec<u8>> {
    let common = root.join(".git");
    if !common.is_dir() {
        return None;
    }
    let mut out = std::fs::read(common.join("HEAD")).ok()?;
    let mut names: Vec<PathBuf> = match std::fs::read_dir(common.join("worktrees")) {
        Ok(rd) => rd.flatten().map(|e| e.path()).collect(),
        Err(_) => vec![],
    };
    names.sort();
    for wt in names {
        let gitdir = std::fs::read(wt.join("gitdir")).unwrap_or_default();
        let there = Path::new(String::from_utf8_lossy(&gitdir).trim()).exists();
        out.push(0);
        out.extend(wt.file_name().map(|n| n.to_string_lossy().as_bytes().to_vec()).unwrap_or_default());
        out.push(0);
        out.extend(std::fs::read(wt.join("HEAD")).unwrap_or_default());
        out.push(0);
        out.extend(gitdir);
        out.push(there as u8);
    }
    Some(out)
}

/// A repo's worktree path → branch map, kept against `worktrees_print`.
#[derive(Default)]
pub struct Worktrees {
    kept: Mutex<HashMap<String, (Vec<u8>, HashMap<String, String>)>>,
}

impl Worktrees {
    /// `root`'s worktree branches: the kept ones while nothing they come from changed, else
    /// `ask`'s. A failed ask is empty, as before, and not kept.
    pub fn get(&self, root: &str, ask: impl FnOnce() -> Result<HashMap<String, String>, String>) -> HashMap<String, String> {
        let Some(print) = worktrees_print(Path::new(root)) else { return ask().unwrap_or_default() };
        if let Some((p, map)) = locked(&self.kept).get(root) {
            if *p == print {
                return map.clone();
            }
        }
        match ask() {
            Ok(map) => {
                let mut kept = locked(&self.kept);
                if kept.len() >= MAX_KEPT {
                    kept.clear();
                }
                kept.insert(root.to_string(), (print, map.clone()));
                map
            }
            Err(_) => HashMap::new(),
        }
    }
}

/// The app's one `claude agents --json --all` answer per account (`mission::agents_since`).
pub fn agents() -> &'static Shared<Result<String, String>> {
    static S: std::sync::OnceLock<Shared<Result<String, String>>> = std::sync::OnceLock::new();
    S.get_or_init(Default::default)
}

pub fn roots() -> &'static Roots {
    static R: std::sync::OnceLock<Roots> = std::sync::OnceLock::new();
    R.get_or_init(Default::default)
}

pub fn worktrees() -> &'static Worktrees {
    static W: std::sync::OnceLock<Worktrees> = std::sync::OnceLock::new();
    W.get_or_init(Default::default)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::Duration;

    #[test]
    fn callers_that_ask_together_share_one_ask() {
        let s: Shared<u32> = Shared::default();
        let asks = AtomicUsize::new(0);
        let t0 = Instant::now();
        std::thread::scope(|sc| {
            for _ in 0..8 {
                sc.spawn(|| {
                    let v = s.get("acct", t0, Instant::now, || {
                        asks.fetch_add(1, Ordering::SeqCst);
                        std::thread::sleep(Duration::from_millis(100));
                        7
                    });
                    assert_eq!(v, 7);
                });
            }
        });
        assert_eq!(asks.load(Ordering::SeqCst), 1, "eight callers at once started one ask");
    }

    #[test]
    fn an_answer_is_handed_out_while_young_enough_and_asked_again_after() {
        let s: Shared<u32> = Shared::default();
        let t0 = Instant::now();
        let n = AtomicUsize::new(0);
        let ask = || n.fetch_add(1, Ordering::SeqCst) as u32;
        assert_eq!(s.get("a", t0, || t0, ask), 0);
        assert_eq!(s.get("a", t0, || t0, ask), 0, "asked at not_before: still good");
        assert_eq!(s.get("b", t0, || t0, ask), 1, "another key asks its own");
        assert_eq!(s.get("a", t0 + Duration::from_secs(1), || t0 + Duration::from_secs(1), ask), 2);
        assert_eq!(s.last("a").map(|(at, v)| (at, v)), Some((t0 + Duration::from_secs(1), 2)));
        assert!(s.last("none").is_none());
    }

    fn git(args: &[&str], cwd: &Path) {
        let out = crate::proc::command("git").args(args).current_dir(cwd).output().unwrap();
        assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
    }

    fn s(p: &Path) -> String {
        p.to_string_lossy().to_string()
    }

    #[test]
    fn a_dirs_root_is_asked_once_until_its_git_changes() {
        let tmp = crate::testutil::temp_dir("asked-roots");
        let main = tmp.join("proj");
        let deep = main.join("src").join("deep");
        let plain = tmp.join("plain");
        std::fs::create_dir_all(&deep).unwrap();
        std::fs::create_dir_all(&plain).unwrap();
        let roots = Roots::default();
        let asks = AtomicUsize::new(0);
        let ask = |cwd: &Path| {
            asks.fetch_add(1, Ordering::SeqCst);
            crate::mission::git_root(&s(cwd))
        };
        let get = |cwd: &Path| roots.get(&s(cwd), || ask(cwd));

        // `tmp` itself may sit inside a repo on some machine; what is asserted is what git says.
        let before = crate::mission::git_root(&s(&deep)).ok();
        assert_eq!(get(&deep), before);
        let n = asks.load(Ordering::SeqCst);
        assert_eq!(get(&deep), before);
        if before.is_none() {
            assert_eq!(asks.load(Ordering::SeqCst), n, "no repo, no .git above: not asked again");
        }

        git(&["init", "-q", "-b", "main"], &main);
        git(&["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"], &main);
        let n = asks.load(Ordering::SeqCst);
        let root = get(&deep).expect("a repo now");
        assert_eq!(asks.load(Ordering::SeqCst), n + 1, "`git init` made a .git: asked again");
        assert_eq!(Some(root.clone()), crate::mission::git_root(&s(&deep)).ok());
        for _ in 0..5 {
            assert_eq!(get(&deep).as_deref(), Some(root.as_str()));
            assert_eq!(get(&main).as_deref(), Some(root.as_str()));
        }
        assert_eq!(asks.load(Ordering::SeqCst), n + 2, "each dir asked once, then kept");

        let wt = tmp.join("proj-wt");
        git(&["worktree", "add", "-q", "-b", "feat/x", &s(&wt)], &main);
        let n = asks.load(Ordering::SeqCst);
        assert_eq!(get(&wt).as_deref(), Some(root.as_str()), "a worktree's root is the main checkout");
        assert_eq!(get(&wt).as_deref(), Some(root.as_str()));
        assert_eq!(asks.load(Ordering::SeqCst), n + 1);

        git(&["worktree", "remove", &s(&wt)], &main);
        let n = asks.load(Ordering::SeqCst);
        assert_eq!(get(&wt), None, "a removed worktree has no root, and git is not run in it");
        assert_eq!(asks.load(Ordering::SeqCst), n);

        std::fs::remove_dir_all(main.join(".git")).unwrap();
        assert_eq!(get(&deep), crate::mission::git_root(&s(&deep)).ok(), "the .git went: asked again, answered as git answers");
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn a_failure_beside_a_git_is_asked_again() {
        let tmp = crate::testutil::temp_dir("asked-fail");
        std::fs::create_dir_all(tmp.join(".git")).unwrap();
        let roots = Roots::default();
        let asks = AtomicUsize::new(0);
        for _ in 0..3 {
            assert_eq!(
                roots.get(&s(&tmp), || {
                    asks.fetch_add(1, Ordering::SeqCst);
                    Err("fatal".into())
                }),
                None
            );
        }
        assert_eq!(asks.load(Ordering::SeqCst), 3);
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn a_repos_worktrees_are_asked_once_until_one_is_added_switched_or_removed() {
        let tmp = crate::testutil::temp_dir("asked-wt");
        let main = tmp.join("proj");
        std::fs::create_dir_all(&main).unwrap();
        git(&["init", "-q", "-b", "main"], &main);
        git(&["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"], &main);
        let root = crate::mission::git_root(&s(&main)).unwrap();
        let wts = Worktrees::default();
        let asks = AtomicUsize::new(0);
        let get = || {
            wts.get(&root, || {
                asks.fetch_add(1, Ordering::SeqCst);
                crate::mission::ask_worktree_branches(&root)
            })
        };
        let direct = || crate::mission::ask_worktree_branches(&root).unwrap();

        assert_eq!(get(), direct());
        assert_eq!(get(), direct());
        assert_eq!(asks.load(Ordering::SeqCst), 1);

        let wt = tmp.join("proj-wt");
        git(&["worktree", "add", "-q", "-b", "feat/a/b", &s(&wt)], &main);
        assert_eq!(get(), direct(), "a worktree added");
        assert!(get().values().any(|b| b == "feat/a/b"));
        assert_eq!(asks.load(Ordering::SeqCst), 2);

        git(&["checkout", "-q", "-b", "feat/a/c"], &wt);
        assert_eq!(get(), direct(), "a worktree switched branch");
        assert!(get().values().any(|b| b == "feat/a/c"));
        git(&["checkout", "-q", "-b", "other"], &main);
        assert_eq!(get(), direct(), "the main checkout switched branch");
        assert_eq!(asks.load(Ordering::SeqCst), 4);

        git(&["worktree", "remove", &s(&wt)], &main);
        assert_eq!(get(), direct(), "a worktree removed");
        assert!(!get().values().any(|b| b == "feat/a/c"));
        assert_eq!(asks.load(Ordering::SeqCst), 5);
        let _ = std::fs::remove_dir_all(&tmp);
    }
}

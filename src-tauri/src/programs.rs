//! Which programs run inside a folder: those whose working directory is in it. Cleaning up asks
//! before it removes a worktree, since a shell, an editor or a dev server sitting in a tree is
//! someone at work there.
//!
//! Read from the kernel (macOS) or `/proc` (Linux), no process spawned. Elsewhere nothing is
//! known and the answer is empty: Windows refuses to delete a folder a process sits in, so git's
//! removal fails there and says so.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

/// One process and where it runs.
#[derive(Debug, Clone, PartialEq)]
pub struct Program {
    pub pid: u32,
    pub name: String,
    pub cwd: PathBuf,
}

impl Program {
    /// `node (4123)`.
    pub fn label(&self) -> String {
        format!("{} ({})", self.name, self.pid)
    }
}

/// Every process whose working directory can be read: the user's own.
#[cfg(target_os = "macos")]
pub fn all() -> Vec<Program> {
    use std::ffi::OsStr;
    use std::os::unix::ffi::OsStrExt;
    // SAFETY: a null buffer asks only for the count.
    let n = unsafe { libc::proc_listallpids(std::ptr::null_mut(), 0) };
    if n <= 0 {
        return vec![];
    }
    // Room for processes started since the count.
    let mut pids = vec![0 as libc::c_int; n as usize + 64];
    let bytes = (pids.len() * std::mem::size_of::<libc::c_int>()) as libc::c_int;
    // SAFETY: `pids` holds `bytes` bytes; the call writes at most that many and returns a count.
    let got = unsafe { libc::proc_listallpids(pids.as_mut_ptr() as *mut libc::c_void, bytes) };
    if got <= 0 {
        return vec![];
    }
    pids.truncate(got as usize);
    pids.into_iter()
        .filter(|&pid| pid > 0)
        .filter_map(|pid| {
            let mut info: libc::proc_vnodepathinfo = unsafe { std::mem::zeroed() };
            let size = std::mem::size_of::<libc::proc_vnodepathinfo>() as libc::c_int;
            // SAFETY: `info` is a plain C struct of exactly `size` bytes that the call fills.
            let got = unsafe { libc::proc_pidinfo(pid, libc::PROC_PIDVNODEPATHINFO, 0, &mut info as *mut _ as *mut libc::c_void, size) };
            if got != size {
                return None;
            }
            // `vip_path` is a `char[MAXPATHLEN]` spelled as 32 rows of 32.
            let raw = &info.pvi_cdir.vip_path;
            // SAFETY: the rows are contiguous: 1024 initialised bytes.
            let raw = unsafe { std::slice::from_raw_parts(raw.as_ptr() as *const u8, std::mem::size_of_val(raw)) };
            let end = raw.iter().position(|&b| b == 0).unwrap_or(raw.len());
            if end == 0 {
                return None;
            }
            let mut name = [0u8; 256];
            // SAFETY: `name` holds 256 bytes; the call writes at most that many and returns the length.
            let len = unsafe { libc::proc_name(pid, name.as_mut_ptr() as *mut libc::c_void, name.len() as u32) };
            Some(Program {
                pid: pid as u32,
                name: String::from_utf8_lossy(&name[..len.max(0) as usize]).into_owned(),
                cwd: PathBuf::from(OsStr::from_bytes(&raw[..end])),
            })
        })
        .collect()
}

#[cfg(target_os = "linux")]
pub fn all() -> Vec<Program> {
    let Ok(dir) = std::fs::read_dir("/proc") else { return vec![] };
    dir.flatten()
        .filter_map(|e| {
            let pid = e.file_name().to_str()?.parse().ok()?;
            let cwd = std::fs::read_link(e.path().join("cwd")).ok()?;
            let name = std::fs::read_to_string(e.path().join("comm")).ok()?.trim().to_string();
            Some(Program { pid, name, cwd })
        })
        .collect()
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
pub fn all() -> Vec<Program> {
    vec![]
}

/// How far up a process's parents `inside` looks for one it spares.
const MAX_DEPTH: usize = 64;

/// Whether `pid` is one of `roots` or runs below one, walking up through `parent` (None: gone,
/// or not known).
pub fn under_any(pid: u32, roots: &HashSet<u32>, parent: impl Fn(u32) -> Option<u32>) -> bool {
    let mut at = pid;
    for _ in 0..MAX_DEPTH {
        if roots.contains(&at) {
            return true;
        }
        match parent(at) {
            Some(up) if up > 1 && up != at => at = up,
            _ => return false,
        }
    }
    false
}

/// Of `programs`, those whose working directory is `tree` or a folder in it, less `roots` and
/// everything that runs below them.
pub fn inside<'a>(programs: &'a [Program], tree: &Path, roots: &HashSet<u32>, parent: impl Fn(u32) -> Option<u32>) -> Vec<&'a Program> {
    let tree = tree.canonicalize().unwrap_or_else(|_| tree.to_path_buf());
    programs.iter().filter(|p| p.cwd.starts_with(&tree) && !under_any(p.pid, roots, &parent)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::temp_dir;
    use std::collections::HashMap;

    #[test]
    fn under_any_walks_up_to_a_root() {
        let parents = HashMap::from([(30, 20), (20, 10), (10, 1), (40, 1)]);
        let parent = |p: u32| parents.get(&p).copied();
        let roots = HashSet::from([20]);
        assert!(under_any(20, &roots, parent));
        assert!(under_any(30, &roots, parent));
        assert!(!under_any(10, &roots, parent));
        assert!(!under_any(40, &roots, parent));
        // Gone: under nothing.
        assert!(!under_any(99, &roots, parent));
    }

    #[test]
    fn inside_is_the_tree_and_its_folders_not_a_sibling_with_a_longer_name() {
        let tree = temp_dir("programs-inside").canonicalize().unwrap().join("repo-wt-a");
        std::fs::create_dir_all(tree.join("src")).unwrap();
        let at = |pid: u32, cwd: PathBuf| Program { pid, name: format!("p{pid}"), cwd };
        let programs = [
            at(1001, tree.clone()),
            at(1002, tree.join("src")),
            at(1003, tree.with_file_name("repo-wt-ab")),
            at(1004, tree.parent().unwrap().to_path_buf()),
        ];
        let none = |_: u32| None;
        let found: Vec<u32> = inside(&programs, &tree, &HashSet::new(), none).iter().map(|p| p.pid).collect();
        assert_eq!(found, [1001, 1002]);
        let found: Vec<u32> = inside(&programs, &tree, &HashSet::from([1002]), none).iter().map(|p| p.pid).collect();
        assert_eq!(found, [1001]);
        assert_eq!(programs[0].label(), "p1001 (1001)");
    }

    /// A real process sitting in a folder is found there, by pid, name and folder; one that runs
    /// below a spared pid is not.
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[test]
    fn a_process_sitting_in_a_folder_is_found_there() {
        let dir = temp_dir("programs-real").canonicalize().unwrap().join("tree");
        std::fs::create_dir_all(dir.join("deep")).unwrap();
        // `; :` keeps sh from exec'ing sleep: sleep runs as sh's child.
        let mut sh = crate::proc::command("sh").args(["-c", "sleep 30; :"]).current_dir(dir.join("deep")).spawn().unwrap();
        let sh_pid = sh.id();
        let mut found = vec![];
        for _ in 0..100 {
            found = inside(&all(), &dir, &HashSet::new(), crate::chrome::parent_of).into_iter().cloned().collect::<Vec<_>>();
            if found.iter().any(|p| p.name == "sleep") {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        let sh_kill = |sh: &mut std::process::Child| {
            let _ = crate::proc::command("pkill").args(["-P", &sh.id().to_string()]).status();
            let _ = sh.kill();
            let _ = sh.wait();
        };
        let me = found.iter().find(|p| p.pid == sh_pid).cloned();
        let sleep = found.iter().find(|p| p.name == "sleep").cloned();
        let spared = inside(&all(), &dir, &HashSet::from([sh_pid]), crate::chrome::parent_of).len();
        sh_kill(&mut sh);
        let me = me.expect("sh is found in the tree");
        assert_eq!(me.cwd, dir.join("deep"));
        assert!(sleep.is_some(), "sleep is found in the tree: {found:?}");
        assert_eq!(spared, 0);
        assert!(inside(&all(), &dir.with_file_name("elsewhere"), &HashSet::new(), crate::chrome::parent_of).is_empty());
    }
}

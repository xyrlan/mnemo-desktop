//! The system's process table, read from the system: which processes run under another, who a
//! process's parent is, whether a pid is alive.
//!
//! No program is started to ask. The app used to run `pgrep -P`, which Windows does not have, so
//! there every walk came back empty and read as "nothing runs here" (#330); everywhere else it was
//! a process per level of the tree, per pane, per poll.

use std::collections::HashMap;

/// The live processes at one moment: pid → parent pid, and where the system says so, when each
/// was created.
#[derive(Debug, Clone, Default)]
pub struct Table {
    parents: HashMap<u32, u32>,
    /// Windows only, in 100 ns ticks; a process whose time could not be read has none.
    created: HashMap<u32, u64>,
}

impl Table {
    /// The parent of `pid`, None when it was not running, or when the pid its row names is now a
    /// process created after it: Windows gives a dead parent's pid to new processes, and who
    /// started this one can then no longer be told. A parent that has ended and whose pid nobody
    /// holds is still named, as before.
    pub fn parent(&self, pid: u32) -> Option<u32> {
        let ppid = *self.parents.get(&pid)?;
        (!self.parents.contains_key(&ppid) || self.started(pid, ppid)).then_some(ppid)
    }

    /// Every pid whose parent is one of `parents`, as `pgrep -P a,b,c` answered. A parent that is
    /// not running has no children: Windows leaves a dead parent's pid on what it started, where
    /// macOS and Linux hand an orphan to another process at once. Without this a pane whose shell
    /// had just ended still read as running whatever outlived it by a moment. Nor is a process
    /// the child of one created after it, which is that dead parent's pid given to a new process.
    pub fn children(&self, parents: &[u32]) -> Vec<u32> {
        self.parents
            .iter()
            .filter(|(pid, ppid)| pid != ppid && parents.contains(ppid) && self.parents.contains_key(ppid) && self.started(**pid, **ppid))
            .map(|(pid, _)| *pid)
            .collect()
    }

    /// Whether the live process `ppid` can have started `pid`: not when it was created after it.
    /// Where either time is unknown (every row off Windows) the row's word is taken.
    fn started(&self, pid: u32, ppid: u32) -> bool {
        match (self.created.get(&pid), self.created.get(&ppid)) {
            (Some(child), Some(parent)) => parent <= child,
            _ => true,
        }
    }
}

/// Every live process and its parent. An error is "the table could not be read", which says
/// nothing about any process: a caller must not take it for an empty table.
#[cfg(target_os = "macos")]
pub fn table() -> Result<Table, String> {
    let failed = || format!("the process table could not be read: proc_listallpids: {}", std::io::Error::last_os_error());
    // SAFETY: with no buffer the call only counts.
    let count = unsafe { libc::proc_listallpids(std::ptr::null_mut(), 0) };
    if count <= 0 {
        return Err(failed());
    }
    // Processes start between the two calls: room for more than were counted.
    let mut pids = vec![0 as libc::pid_t; count as usize + 64];
    let bytes = (pids.len() * std::mem::size_of::<libc::pid_t>()) as libc::c_int;
    // SAFETY: `pids` is `bytes` long and the call writes whole pids into it.
    let got = unsafe { libc::proc_listallpids(pids.as_mut_ptr().cast(), bytes) };
    if got <= 0 {
        return Err(failed());
    }
    pids.truncate(got as usize);
    let parents = pids.into_iter().filter_map(|p| Some((u32::try_from(p).ok()?, listed_parent(p)?))).collect();
    Ok(Table { parents, created: HashMap::new() })
}

/// A row of the table: the parent of any user's process, as `pgrep` listed them (`parent_of`
/// reads more about a process, and is refused that for another user's: a `sudo` in the way hid
/// what ran below it). A zombie answers nothing here.
#[cfg(target_os = "macos")]
fn listed_parent(pid: libc::pid_t) -> Option<u32> {
    let mut info: libc::proc_bsdshortinfo = unsafe { std::mem::zeroed() };
    let size = std::mem::size_of::<libc::proc_bsdshortinfo>() as libc::c_int;
    // SAFETY: `info` is a plain C struct of exactly `size` bytes that the call fills.
    let n = unsafe { libc::proc_pidinfo(pid, libc::PROC_PIDT_SHORTBSDINFO, 0, &mut info as *mut _ as *mut libc::c_void, size) };
    (n == size && info.pbsi_status != libc::SZOMB).then_some(info.pbsi_ppid)
}

#[cfg(target_os = "linux")]
pub fn table() -> Result<Table, String> {
    let entries = std::fs::read_dir("/proc").map_err(|e| format!("the process table could not be read: /proc: {e}"))?;
    let pids = entries.flatten().filter_map(|e| e.file_name().to_str()?.parse::<u32>().ok());
    Ok(Table { parents: pids.filter_map(|p| Some((p, parent_of(p)?))).collect(), created: HashMap::new() })
}

/// One snapshot of the system (`CreateToolhelp32Snapshot`). A parent that has exited keeps its
/// pid in its children's rows, and Windows may give that pid to a new process: a row's parent is
/// the pid that started it, not proof that the process with that pid now did: each row's creation
/// time is read too, and `Table` takes a parent created after its child for a stranger.
#[cfg(windows)]
pub fn table() -> Result<Table, String> {
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS};

    let failed = |call: &str| format!("the process table could not be read: {call}: {}", std::io::Error::last_os_error());
    // SAFETY: no pointers go in; the handle is closed below.
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snapshot == INVALID_HANDLE_VALUE {
        return Err(failed("CreateToolhelp32Snapshot"));
    }
    // SAFETY: a plain C struct, valid zeroed; `dwSize` tells the calls how much they may fill.
    let mut entry: PROCESSENTRY32W = unsafe { std::mem::zeroed() };
    entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
    let mut rows = HashMap::new();
    // SAFETY: `snapshot` is open and `entry` is a PROCESSENTRY32W with its size set.
    if unsafe { Process32FirstW(snapshot, &mut entry) } == 0 {
        let e = failed("Process32FirstW");
        // SAFETY: `snapshot` is open and not used again.
        unsafe { CloseHandle(snapshot) };
        return Err(e);
    }
    loop {
        rows.insert(entry.th32ProcessID, entry.th32ParentProcessID);
        // SAFETY: as for Process32FirstW.
        if unsafe { Process32NextW(snapshot, &mut entry) } == 0 {
            break;
        }
    }
    // SAFETY: `snapshot` is open and not used again.
    unsafe { CloseHandle(snapshot) };
    // A pid opened after the snapshot may already be another process: one created since is not
    // the row's, and its time is not taken.
    let taken = filetime_now();
    let created = rows.keys().filter_map(|&pid| Some((pid, created_at(pid).filter(|&t| t <= taken)?))).collect();
    Ok(Table { parents: rows, created })
}

/// When `pid` was created, in 100 ns ticks since 1601 (a FILETIME). None when it cannot be opened
/// (the idle and system processes, a protected one, one gone since).
#[cfg(windows)]
fn created_at(pid: u32) -> Option<u64> {
    use windows_sys::Win32::Foundation::{CloseHandle, FILETIME};
    use windows_sys::Win32::System::Threading::{GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};

    // SAFETY: no pointers go in; the handle is closed below.
    let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    if process.is_null() {
        return None;
    }
    let zero = FILETIME { dwLowDateTime: 0, dwHighDateTime: 0 };
    let (mut created, mut exited, mut kernel, mut user) = (zero, zero, zero, zero);
    // SAFETY: `process` is open with the right to ask, and the four FILETIMEs outlive the call.
    let asked = unsafe { GetProcessTimes(process, &mut created, &mut exited, &mut kernel, &mut user) };
    // SAFETY: `process` is open and not used again.
    unsafe { CloseHandle(process) };
    let ticks = (u64::from(created.dwHighDateTime) << 32) | u64::from(created.dwLowDateTime);
    (asked != 0 && ticks != 0).then_some(ticks)
}

/// Now, as a FILETIME counts.
#[cfg(windows)]
fn filetime_now() -> u64 {
    const UNIX_EPOCH_IN_FILETIME_SECS: u64 = 11_644_473_600;
    let since = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default();
    (since.as_secs() + UNIX_EPOCH_IN_FILETIME_SECS) * 10_000_000 + u64::from(since.subsec_nanos()) / 100
}

#[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
pub fn table() -> Result<Table, String> {
    Err("the process table is not read on this system".into())
}

/// The parent of a live process, None once it has exited (a zombie counts as exited). Asked of
/// the kernel, no process spawned.
#[cfg(target_os = "macos")]
pub fn parent_of(pid: u32) -> Option<u32> {
    let mut info: libc::proc_bsdinfo = unsafe { std::mem::zeroed() };
    let size = std::mem::size_of::<libc::proc_bsdinfo>() as libc::c_int;
    // SAFETY: `info` is a plain C struct of exactly `size` bytes that the call fills.
    let n = unsafe { libc::proc_pidinfo(pid as libc::c_int, libc::PROC_PIDTBSDINFO, 0, &mut info as *mut _ as *mut libc::c_void, size) };
    (n == size && info.pbi_status != libc::SZOMB).then_some(info.pbi_ppid)
}

#[cfg(target_os = "linux")]
pub fn parent_of(pid: u32) -> Option<u32> {
    let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    // `pid (comm) state ppid …`: the name may hold spaces and parentheses.
    let mut rest = stat[stat.rfind(')')? + 1..].split_whitespace();
    let state = rest.next()?;
    if state == "Z" || state == "X" {
        return None;
    }
    rest.next()?.parse().ok()
}

/// Whether the terminal process `pid` runs on has `pid`'s own process group in the foreground: a
/// shell at its prompt, whatever it left running in the background (powerlevel10k's `gitstatusd`,
/// a job started with `&`). False while a program the shell started has the terminal. None for a
/// process with no terminal, one that has exited, or where the system does not say.
#[cfg(target_os = "macos")]
pub fn foreground(pid: u32) -> Option<bool> {
    let mut info: libc::proc_bsdinfo = unsafe { std::mem::zeroed() };
    let size = std::mem::size_of::<libc::proc_bsdinfo>() as libc::c_int;
    // SAFETY: `info` is a plain C struct of exactly `size` bytes that the call fills.
    let n = unsafe { libc::proc_pidinfo(pid as libc::c_int, libc::PROC_PIDTBSDINFO, 0, &mut info as *mut _ as *mut libc::c_void, size) };
    // With no controlling terminal the kernel leaves `e_tpgid` 0.
    (n == size && info.pbi_status != libc::SZOMB && info.e_tpgid != 0).then_some(info.e_tpgid == info.pbi_pgid)
}

#[cfg(target_os = "linux")]
pub fn foreground(pid: u32) -> Option<bool> {
    let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    // `pid (comm) state ppid pgrp session tty_nr tpgid …`; `tpgid` is -1 with no terminal.
    let rest: Vec<&str> = stat[stat.rfind(')')? + 1..].split_whitespace().take(6).collect();
    let [state, _, pgrp, _, tty, tpgid] = rest[..] else { return None };
    let (pgrp, tpgid) = (pgrp.parse::<i64>().ok()?, tpgid.parse::<i64>().ok()?);
    (state != "Z" && state != "X" && tty != "0" && tpgid > 0).then_some(tpgid == pgrp)
}

/// Windows has no foreground process group to ask.
#[cfg(not(any(target_os = "macos", target_os = "linux")))]
pub fn foreground(_pid: u32) -> Option<bool> {
    None
}

/// Elsewhere a process's parent is a row of the whole table: a snapshot per question. Ask
/// `parents` once when there are several.
#[cfg(not(any(target_os = "macos", target_os = "linux")))]
pub fn parent_of(pid: u32) -> Option<u32> {
    table().ok()?.parent(pid)
}

/// `parent_of` for a run of questions asked together: the kernel each time where that is cheap.
#[cfg(any(target_os = "macos", target_os = "linux"))]
pub fn parents() -> impl Fn(u32) -> Option<u32> {
    parent_of
}

/// `parent_of` for a run of questions asked together: one snapshot answers them all. When it
/// could not be taken no process has a parent, as `parent_of` says of one it cannot see.
#[cfg(not(any(target_os = "macos", target_os = "linux")))]
pub fn parents() -> impl Fn(u32) -> Option<u32> {
    let table = table().ok();
    move |pid| table.as_ref()?.parent(pid)
}

/// Whether `pid` is a running process.
#[cfg(unix)]
pub fn alive(pid: u32) -> bool {
    let Ok(pid) = i32::try_from(pid) else { return false };
    if pid <= 0 {
        return false;
    }
    // Signal 0 asks without signalling; EPERM is a process that exists and is not ours.
    // SAFETY: kill with signal 0 has no effect on the target.
    unsafe { libc::kill(pid, 0) == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM) }
}

/// Whether `pid` is a running process. One that has exited can still be opened while anything
/// holds a handle to it, so its exit code is what says; a refusal is a process that exists and is
/// not ours.
#[cfg(windows)]
pub fn alive(pid: u32) -> bool {
    use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, ERROR_ACCESS_DENIED, STILL_ACTIVE};
    use windows_sys::Win32::System::Threading::{GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};

    if pid == 0 {
        return false;
    }
    // SAFETY: no pointers go in; the handle is closed below.
    let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    if process.is_null() {
        // SAFETY: reads the calling thread's last error.
        return unsafe { GetLastError() } == ERROR_ACCESS_DENIED;
    }
    let mut code = 0u32;
    // SAFETY: `process` is open with the right to ask, and `code` outlives the call.
    let asked = unsafe { GetExitCodeProcess(process, &mut code) };
    // SAFETY: `process` is open and not used again.
    unsafe { CloseHandle(process) };
    asked != 0 && code == STILL_ACTIVE as u32
}

#[cfg(not(any(unix, windows)))]
pub fn alive(pid: u32) -> bool {
    pid > 0
}

#[cfg(test)]
pub(crate) mod testing {
    use std::process::{Child, Stdio};
    use std::time::{Duration, Instant};

    /// Windows PowerShell, by its path: it needs no network and no console to sleep.
    #[cfg(windows)]
    fn powershell() -> String {
        format!(r"{}\System32\WindowsPowerShell\v1.0\powershell.exe", std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into()))
    }

    #[cfg(windows)]
    const SLEEP: [&str; 6] = ["-NoProfile", "-NonInteractive", "-Command", "Start-Sleep", "-Seconds", "30"];

    /// A program that stays up for half a minute and starts nothing.
    pub fn sleeper() -> Child {
        #[cfg(windows)]
        let mut cmd = {
            let mut c = crate::proc::command(powershell());
            c.args(SLEEP);
            c
        };
        #[cfg(not(windows))]
        let mut cmd = {
            let mut c = crate::proc::command("sleep");
            c.arg("30");
            c
        };
        cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn().unwrap()
    }

    /// A shell that runs one such program and waits for it, as a pane's shell runs `claude`.
    pub fn shell() -> Child {
        #[cfg(windows)]
        let mut cmd = {
            let mut c = crate::proc::command("cmd");
            c.args(["/C", &format!("{} {}", powershell(), SLEEP.join(" "))]);
            c
        };
        #[cfg(not(windows))]
        let mut cmd = {
            let mut c = crate::proc::command("sh");
            c.args(["-c", "sleep 30; true"]);
            c
        };
        cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn().unwrap()
    }

    /// What `shell` has started, once it has started something and is still running it a moment
    /// later. On Windows that can be more than the program: a console program with no console to
    /// inherit is given a `conhost.exe`.
    pub fn started_by(shell: u32) -> Vec<u32> {
        let deadline = Instant::now() + Duration::from_secs(20);
        let children = || super::table().unwrap().children(&[shell]);
        loop {
            if !children().is_empty() {
                std::thread::sleep(Duration::from_millis(300));
                let found = children();
                if !found.is_empty() && super::alive(shell) {
                    return found;
                }
            }
            assert!(Instant::now() < deadline, "{shell} runs nothing (alive: {})", super::alive(shell));
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    /// Waits for `gone` to say so: a process told to end takes a moment to leave the table.
    pub fn eventually(what: &str, gone: impl Fn() -> bool) {
        let deadline = Instant::now() + Duration::from_secs(10);
        while !gone() {
            assert!(Instant::now() < deadline, "{what}");
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    /// Ends `child` and whatever it started.
    pub fn end(mut child: Child) {
        #[cfg(windows)]
        let _ = crate::proc::command("taskkill").args(["/F", "/T", "/PID", &child.id().to_string()]).stdout(Stdio::null()).stderr(Stdio::null()).status();
        #[cfg(not(windows))]
        for pid in super::table().map(|t| t.children(&[child.id()])).unwrap_or_default() {
            let _ = crate::proc::command("kill").arg(pid.to_string()).status();
        }
        let _ = child.kill();
        let _ = child.wait();
    }
}

#[cfg(test)]
mod tests {
    use super::testing::*;
    use super::*;

    /// A table built by hand: (pid, parent) rows, and the creation times known of some.
    fn rows(parents: &[(u32, u32)], created: &[(u32, u64)]) -> Table {
        Table { parents: parents.iter().copied().collect(), created: created.iter().copied().collect() }
    }

    /// On every system CI builds for, Windows among them: nothing here is behind `cfg(unix)`.
    #[test]
    fn a_real_child_is_found_under_its_parent_and_forgotten_once_it_exits() {
        let me = std::process::id();
        let mut child = sleeper();
        let pid = child.id();

        let table = table().unwrap();
        assert!(table.children(&[me]).contains(&pid), "{pid} is not among the children of {me}: {:?}", table.children(&[me]));
        assert_eq!(table.parent(pid), Some(me));
        assert_eq!(parent_of(pid), Some(me));
        assert_eq!(parents()(pid), Some(me));
        assert!(alive(pid));
        assert!(alive(me));
        assert!(table.parent(me).is_some(), "this test's own process is in the table");
        // Another user's processes are rows too: the first one of the system is never ours.
        #[cfg(unix)]
        assert!(!table.children(&[1]).is_empty(), "nothing under pid 1");

        child.kill().unwrap();
        // Reaped, it is gone; before that a zombie counts as gone too.
        child.wait().unwrap();
        // `child` is held to the end: Windows keeps an exited process, and its pid, for as long as
        // a handle to it is open, as a shell holds the program it ran. Exited is still not alive,
        // and no other process can have been given the pid meanwhile.
        assert!(!alive(pid), "an exited process that is still held open is not alive");
        eventually("an exited process still has a parent", || parent_of(pid).is_none() && parents()(pid).is_none());
        let after = super::table().unwrap();
        assert_eq!(after.parent(pid), None);
        assert!(!after.children(&[me]).contains(&pid));
        drop(child);
    }

    #[test]
    fn children_are_asked_of_several_parents_at_once() {
        let (a, b) = (shell(), shell());
        started_by(a.id());
        started_by(b.id());
        let table = table().unwrap();
        let sorted = |mut pids: Vec<u32>| {
            pids.sort();
            pids
        };
        let (under_a, under_b) = (sorted(table.children(&[a.id()])), sorted(table.children(&[b.id()])));
        assert!(!under_a.is_empty() && !under_b.is_empty(), "{under_a:?} {under_b:?}");
        assert!(under_a.iter().all(|p| !under_b.contains(p)), "{under_a:?} {under_b:?}");
        assert_eq!(sorted(table.children(&[a.id(), b.id()])), sorted([under_a.clone(), under_b].concat()));
        assert!(table.children(&[]).is_empty());
        // Two levels up from what a shell started is this test.
        for pid in under_a {
            assert_eq!(table.parent(pid), Some(a.id()));
            assert_eq!(table.parent(pid).and_then(|shell| table.parent(shell)), Some(std::process::id()));
        }
        end(a);
        end(b);
    }

    /// What Windows shows for a moment after a shell is ended: the shell gone from the table,
    /// and what it started still there, still naming it as the parent.
    #[test]
    fn what_a_dead_parent_started_is_not_its_child() {
        let table = rows(&[(100, 1), (200, 100), (300, 77), (301, 77)], &[]);
        assert_eq!(table.children(&[100]), [200]);
        assert_eq!(table.parent(77), None, "77 has ended");
        assert_eq!(table.children(&[77]), Vec::<u32>::new());
        assert_eq!(table.children(&[77, 100]), [200]);
        // The orphans are still running, and still say who started them.
        assert_eq!(table.parent(300), Some(77));
    }

    #[test]
    fn a_process_is_not_its_own_child() {
        // Windows lists the idle process as pid 0 with parent 0.
        let table = rows(&[(0, 0), (4, 0), (88, 4)], &[]);
        assert_eq!(table.children(&[0]), [4]);
        assert_eq!(table.children(&[4]), [88]);
    }

    /// Windows after a shell (77) has ended and its pid has been given to a new process: what the
    /// shell left running still names 77, and is not the new process's.
    #[test]
    fn a_process_is_not_the_child_of_one_created_after_it() {
        // 77 is the new process, created at 50; 300 and 301 were started by the old 77, before it.
        // 302 the new 77 did start. 400 has no time read, 401 is under a parent with none.
        let table = rows(
            &[(1, 0), (77, 1), (300, 77), (301, 77), (302, 77), (400, 77), (500, 1), (401, 500)],
            &[(1, 1), (77, 50), (300, 10), (301, 49), (302, 60), (401, 5)],
        );
        let sorted = |mut pids: Vec<u32>| {
            pids.sort();
            pids
        };
        assert_eq!(sorted(table.children(&[77])), [302, 400], "where a time is missing the row is taken at its word");
        assert_eq!(table.parent(300), None, "who started 300 can no longer be told");
        assert_eq!(table.parent(301), None);
        assert_eq!(table.parent(302), Some(77));
        assert_eq!(table.parent(400), Some(77));
        assert_eq!(table.children(&[500]), [401]);
        assert_eq!(table.parent(401), Some(500));
        assert_eq!(table.parent(77), Some(1));
        // Created in the same tick as its parent is still its child: the clock is coarse.
        let same = rows(&[(10, 1), (11, 10)], &[(10, 7), (11, 7)]);
        assert_eq!(same.children(&[10]), [11]);
        assert_eq!(same.parent(11), Some(10));
    }

    /// Real processes, the parent ending first: a shell is killed and what it ran outlives it. On
    /// Windows that orphan still names the shell's pid; a process created after it is then given
    /// that pid (here: a real later process's row moved onto it, as no test can make Windows
    /// reuse a pid on demand), and the orphan is not counted as its child. Nothing here is
    /// `cfg(unix)`, so CI's Windows job runs it, and there the creation times are real.
    #[test]
    fn what_outlives_its_shell_is_not_the_child_of_a_later_process_given_the_shells_pid() {
        let mut sh = shell();
        let dead = sh.id();
        let orphans = started_by(dead);
        // The shell alone, not what it started. `sh` stays held, so Windows cannot really give
        // its pid to anything while this runs.
        sh.kill().unwrap();
        sh.wait().unwrap();
        eventually("the killed shell is still in the table", || table().unwrap().parent(dead).is_none());
        let later = sleeper();

        let mut real = table().unwrap();
        // A `conhost.exe` may leave with the shell; the program it ran does not.
        let orphans: Vec<u32> = orphans.into_iter().filter(|o| real.parents.contains_key(o)).collect();
        assert!(!orphans.is_empty(), "nothing outlived the shell");
        assert!(real.children(&[dead]).is_empty(), "a dead parent has no children");
        #[cfg(windows)]
        {
            let me = std::process::id();
            assert!(orphans.iter().all(|&o| real.parents.get(&o) == Some(&dead)), "Windows leaves the dead shell's pid on {orphans:?}");
            for pid in orphans.iter().chain([&later.id(), &me]) {
                assert!(real.created.contains_key(pid), "no creation time read for {pid}");
            }
            assert!(orphans.iter().all(|o| real.created[o] <= real.created[&later.id()]));
            assert!(real.created[&me] <= real.created[&later.id()]);
        }

        // The later process takes the dead shell's pid, with its own parent and creation time.
        let parent = real.parents.remove(&later.id()).unwrap();
        real.parents.insert(dead, parent);
        if let Some(t) = real.created.remove(&later.id()) {
            real.created.insert(dead, t);
        }
        assert!(real.children(&[dead]).iter().all(|p| !orphans.contains(p)), "{:?} counted under the new {dead}", real.children(&[dead]));
        assert!(orphans.iter().all(|&o| real.parent(o) != Some(dead)));
        assert_eq!(real.parent(dead), Some(std::process::id()), "the new process's own parent stands");

        for pid in orphans {
            #[cfg(windows)]
            let _ = crate::proc::command("taskkill").args(["/F", "/PID", &pid.to_string()]).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).status();
            #[cfg(not(windows))]
            let _ = crate::proc::command("kill").arg(pid.to_string()).status();
        }
        end(later);
    }
}

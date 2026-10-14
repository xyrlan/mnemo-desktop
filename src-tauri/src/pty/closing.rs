//! What closing the window would end. Where a daemon holds the terminals they run on, and
//! nothing is asked; where the app holds them itself (Windows, or no daemon to be had) they end
//! with it, so the window asks first when one of them is running something (#338).

use super::wire::PtyInfo;

/// A terminal whose shell is running something.
#[derive(Debug, PartialEq)]
pub struct Busy {
    /// The folder the terminal is in.
    pub cwd: String,
    /// What its shell started and is still running, by name.
    pub programs: Vec<String>,
}

/// Of `terminals`, those whose shell has a child (`children` of its pid, as `procs::Table`
/// answers), each child by the name `name` gives it. A shell at its prompt has none, and
/// closing it loses nothing.
pub fn busy(terminals: &[PtyInfo], children: impl Fn(u32) -> Vec<u32>, name: impl Fn(u32) -> Option<String>) -> Vec<Busy> {
    terminals
        .iter()
        .filter(|t| t.alive && t.pid > 0)
        .filter_map(|t| {
            let mut below = children(t.pid);
            below.sort_unstable();
            let programs: Vec<String> = below.into_iter().map(|pid| name(pid).unwrap_or_else(|| format!("process {pid}"))).collect();
            (!programs.is_empty()).then(|| Busy { cwd: t.cwd.clone(), programs })
        })
        .collect()
}

/// What to ask before the window closes over `busy`; `None` when nothing would be lost.
pub fn question(busy: &[Busy]) -> Option<String> {
    if busy.is_empty() {
        return None;
    }
    let what = if busy.len() == 1 { "what is running in this terminal".to_string() } else { format!("what is running in these {} terminals", busy.len()) };
    let mut text = format!("Closing mnemo ends {what}:\n");
    for b in busy {
        text.push_str(&format!("\n{}  in  {}", b.programs.join(", "), b.cwd));
    }
    text.push_str("\n\nTerminals do not keep running here while mnemo is closed. Their tabs come back on new shells.");
    Some(text)
}

/// The name of the program process `pid` runs; `None` once it is gone, or where the system
/// does not say.
#[cfg(target_os = "macos")]
pub fn name_of(pid: u32) -> Option<String> {
    let mut buf = [0u8; 256];
    // SAFETY: the call writes at most `buf.len()` bytes into `buf` and answers how many.
    let n = unsafe { libc::proc_name(pid as libc::c_int, buf.as_mut_ptr().cast(), buf.len() as u32) };
    (n > 0).then(|| String::from_utf8_lossy(&buf[..n as usize]).into_owned())
}

#[cfg(target_os = "linux")]
pub fn name_of(pid: u32) -> Option<String> {
    let name = std::fs::read_to_string(format!("/proc/{pid}/comm")).ok()?;
    Some(name.trim_end().to_string()).filter(|n| !n.is_empty())
}

/// The file its image was started from, without the folder or `.exe`.
#[cfg(windows)]
pub fn name_of(pid: u32) -> Option<String> {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION};
    let mut buf = [0u16; 1024];
    let mut len = buf.len() as u32;
    // SAFETY: the handle is checked and closed once; the call writes at most `len` units into `buf`.
    let ok = unsafe {
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if process.is_null() {
            return None;
        }
        let ok = QueryFullProcessImageNameW(process, 0, buf.as_mut_ptr(), &mut len);
        CloseHandle(process);
        ok
    };
    if ok == 0 {
        return None;
    }
    let path = String::from_utf16_lossy(&buf[..len as usize]);
    let file = path.rsplit('\\').next().unwrap_or(&path);
    let stem = if file.to_ascii_lowercase().ends_with(".exe") { &file[..file.len() - 4] } else { file };
    Some(stem.to_string()).filter(|n| !n.is_empty())
}

#[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
pub fn name_of(_pid: u32) -> Option<String> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn terminal(id: u32, pid: u32, cwd: &str, alive: bool) -> PtyInfo {
        PtyInfo { id, cwd: cwd.into(), pid, alive }
    }

    /// pid, parent, name.
    const ROWS: [(u32, u32, &str); 8] =
        [(1, 0, "init"), (100, 1, "zsh"), (101, 100, "claude"), (102, 101, "node"), (103, 100, "vite"), (200, 1, "zsh"), (300, 1, "zsh"), (301, 300, "sleep")];

    fn children(parent: u32) -> Vec<u32> {
        ROWS.iter().filter(|r| r.1 == parent).map(|r| r.0).collect()
    }

    fn name(pid: u32) -> Option<String> {
        ROWS.iter().find(|r| r.0 == pid).map(|r| r.2.to_string())
    }

    #[test]
    fn a_terminal_is_busy_when_its_shell_has_a_child() {
        let terminals = [terminal(1, 100, "/work/app", true), terminal(2, 200, "/work/idle", true), terminal(3, 300, "/work/ended", false)];
        // The shell's own children, not theirs: `node` under `claude` is `claude`'s business.
        assert_eq!(busy(&terminals, children, name), vec![Busy { cwd: "/work/app".into(), programs: vec!["claude".into(), "vite".into()] }]);
        // A child the system will not name is still something running.
        assert_eq!(busy(&terminals, children, |_| None)[0].programs, vec!["process 101".to_string(), "process 103".to_string()]);
        assert!(busy(&terminals, |_| Vec::new(), name).is_empty());
    }

    #[test]
    fn the_question_names_what_ends_and_is_not_asked_over_idle_shells() {
        assert_eq!(question(&[]), None);
        let one = question(&[Busy { cwd: "/work/app".into(), programs: vec!["claude".into(), "vite".into()] }]).unwrap();
        assert!(one.contains("this terminal") && one.contains("claude, vite  in  /work/app"), "{one}");
        let two = question(&[Busy { cwd: "/a".into(), programs: vec!["claude".into()] }, Busy { cwd: "/b".into(), programs: vec!["node".into()] }]).unwrap();
        assert!(two.contains("these 2 terminals") && two.contains("claude  in  /a") && two.contains("node  in  /b"), "{two}");
    }

    /// Asked of the real system: this test's own process has a name.
    #[test]
    fn the_system_names_this_process() {
        let name = name_of(std::process::id()).expect("a name");
        assert!(name.starts_with("mnemo_desktop"), "{name}");
    }
}

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

/// A running process: its pid, its parent's and its name.
pub type Process = (u32, u32, String);

/// Of `terminals`, those whose shell has a child among `processes`. A shell at its prompt has
/// none, and closing it loses nothing.
pub fn busy(terminals: &[PtyInfo], processes: &[Process]) -> Vec<Busy> {
    terminals
        .iter()
        .filter(|t| t.alive && t.pid > 0)
        .filter_map(|t| {
            let programs: Vec<String> = processes.iter().filter(|(pid, parent, _)| *parent == t.pid && *pid != t.pid).map(|(_, _, name)| name.clone()).collect();
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

/// Every running process. Empty when the system cannot say: then nothing is asked, as before.
#[cfg(unix)]
pub fn processes() -> Vec<Process> {
    let out = crate::proc::command("ps").args(["-axo", "pid=,ppid=,comm="]).output();
    out.map(|o| parse_ps(&String::from_utf8_lossy(&o.stdout))).unwrap_or_default()
}

/// `ps -o pid=,ppid=,comm=`: the name is the program's path on macOS, and may hold spaces.
#[cfg(unix)]
fn parse_ps(text: &str) -> Vec<Process> {
    text.lines()
        .filter_map(|line| {
            let line = line.trim_start();
            let (pid, rest) = line.split_once(char::is_whitespace)?;
            let (parent, name) = rest.trim_start().split_once(char::is_whitespace)?;
            let name = name.trim();
            let name = name.rsplit('/').next().unwrap_or(name).trim_start_matches('-');
            Some((pid.parse().ok()?, parent.parse().ok()?, name.to_string()))
        })
        .collect()
}

#[cfg(windows)]
pub fn processes() -> Vec<Process> {
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS};
    let mut all = Vec::new();
    // SAFETY: `entry` is a plain C struct whose size field is set as the calls require, and the
    // snapshot handle is closed once.
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snapshot == INVALID_HANDLE_VALUE {
            return all;
        }
        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut more = Process32FirstW(snapshot, &mut entry);
        while more != 0 {
            let len = entry.szExeFile.iter().position(|c| *c == 0).unwrap_or(entry.szExeFile.len());
            let name = String::from_utf16_lossy(&entry.szExeFile[..len]);
            let name = if name.to_ascii_lowercase().ends_with(".exe") { name[..name.len() - 4].to_string() } else { name };
            all.push((entry.th32ProcessID, entry.th32ParentProcessID, name));
            more = Process32NextW(snapshot, &mut entry);
        }
        CloseHandle(snapshot);
    }
    all
}

#[cfg(test)]
mod tests {
    use super::*;

    fn terminal(id: u32, pid: u32, cwd: &str, alive: bool) -> PtyInfo {
        PtyInfo { id, cwd: cwd.into(), pid, alive }
    }

    fn table() -> Vec<Process> {
        vec![
            (1, 0, "init".into()),
            (100, 1, "zsh".into()),
            (101, 100, "claude".into()),
            (102, 101, "node".into()),
            (103, 100, "vite".into()),
            (200, 1, "zsh".into()),
            (300, 1, "zsh".into()),
            (301, 300, "sleep".into()),
        ]
    }

    #[test]
    fn a_terminal_is_busy_when_its_shell_has_a_child() {
        let terminals = [terminal(1, 100, "/work/app", true), terminal(2, 200, "/work/idle", true), terminal(3, 300, "/work/ended", false)];
        // The shell's own children, not theirs: `node` under `claude` is `claude`'s business.
        assert_eq!(busy(&terminals, &table()), vec![Busy { cwd: "/work/app".into(), programs: vec!["claude".into(), "vite".into()] }]);
        assert!(busy(&terminals, &[]).is_empty(), "a system that cannot list its processes asks nothing");
    }

    #[test]
    fn the_question_names_what_ends_and_is_not_asked_over_idle_shells() {
        assert_eq!(question(&[]), None);
        let one = question(&[Busy { cwd: "/work/app".into(), programs: vec!["claude".into(), "vite".into()] }]).unwrap();
        assert!(one.contains("this terminal") && one.contains("claude, vite  in  /work/app"), "{one}");
        let two = question(&[Busy { cwd: "/a".into(), programs: vec!["claude".into()] }, Busy { cwd: "/b".into(), programs: vec!["node".into()] }]).unwrap();
        assert!(two.contains("these 2 terminals") && two.contains("claude  in  /a") && two.contains("node  in  /b"), "{two}");
    }

    #[cfg(unix)]
    #[test]
    fn ps_rows_keep_the_program_name() {
        let rows = parse_ps("    1     0 /sbin/launchd\n  812   640 -zsh\n 9001   812 /Applications/Some App.app/Contents/MacOS/Some App\n garbage\n");
        assert_eq!(rows, vec![(1, 0, "launchd".to_string()), (812, 640, "zsh".to_string()), (9001, 812, "Some App".to_string())]);
    }

    /// The real table: this test's own process is in it, under its parent.
    #[test]
    fn the_system_lists_this_process() {
        let me = std::process::id();
        assert!(processes().iter().any(|(pid, parent, name)| *pid == me && *parent > 0 && !name.is_empty()));
    }
}

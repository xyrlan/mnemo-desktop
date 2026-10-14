//! A release build on Windows is a GUI-subsystem program (`windows_subsystem = "windows"`):
//! started from a terminal it gets no console and no stdout, so `mnemo-desktop --version`
//! printed nothing there (#364). `attach_parent` gives it the terminal's console to print to.

/// Before printing from a GUI-subsystem program: when stdout goes nowhere, attach to the
/// console of the process that started it and point stdout and stderr at it. A stdout that
/// already goes somewhere (a pipe, a file, a console) is left alone. Whether it attached;
/// always `false` off Windows, where a terminal's stdout is always there.
#[cfg(windows)]
pub fn attach_parent() -> bool {
    use std::os::windows::io::IntoRawHandle;
    use windows_sys::Win32::Foundation::INVALID_HANDLE_VALUE;
    use windows_sys::Win32::Storage::FileSystem::{GetFileType, FILE_TYPE_DISK, FILE_TYPE_PIPE};
    use windows_sys::Win32::System::Console::{
        AttachConsole, GetConsoleMode, GetStdHandle, SetStdHandle, ATTACH_PARENT_PROCESS, STD_ERROR_HANDLE, STD_OUTPUT_HANDLE,
    };
    // SAFETY: plain Win32 calls on handles this process owns; the console's handle is kept open
    // for the life of the process, as a standard handle is.
    unsafe {
        let out = GetStdHandle(STD_OUTPUT_HANDLE);
        if !out.is_null() && out != INVALID_HANDLE_VALUE {
            let kind = GetFileType(out);
            let mut mode = 0;
            if kind == FILE_TYPE_DISK || kind == FILE_TYPE_PIPE || GetConsoleMode(out, &mut mode) != 0 {
                return false;
            }
        }
        if AttachConsole(ATTACH_PARENT_PROCESS) == 0 {
            return false;
        }
        let Ok(con) = std::fs::OpenOptions::new().read(true).write(true).open("CONOUT$") else {
            return false;
        };
        let con = con.into_raw_handle();
        SetStdHandle(STD_OUTPUT_HANDLE, con);
        SetStdHandle(STD_ERROR_HANDLE, con);
        true
    }
}

#[cfg(not(windows))]
pub fn attach_parent() -> bool {
    false
}

/// A terminal that starts a program with no stdout, and reads its own screen afterwards: the
/// same place a person at `cmd` or PowerShell would see `--version`'s line. Three copies of this
/// test binary: the test, a "terminal" with a console of its own (`CREATE_NEW_CONSOLE`), and a
/// program that drops its console and stdout, as a GUI-subsystem one starts, then prints.
#[cfg(all(test, windows))]
mod tests {
    use std::os::windows::process::CommandExt;
    use std::process::{Command, Stdio};
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::System::Console::{
        FreeConsole, GetConsoleScreenBufferInfo, ReadConsoleOutputCharacterW, SetStdHandle, CONSOLE_SCREEN_BUFFER_INFO, COORD,
        STD_ERROR_HANDLE, STD_OUTPUT_HANDLE,
    };
    use windows_sys::Win32::System::Threading::CREATE_NEW_CONSOLE;

    const ROLE: &str = "MNEMO_TEST_CONSOLE_ROLE";
    const NAME: &str = "console::tests::a_program_with_no_stdout_prints_into_the_terminal_that_started_it";
    const LINE: &str = "mnemo-desktop 0.0.0-console-probe";

    fn me(role: &str) -> Command {
        // `CREATE_NO_WINDOW` for the program; the terminal replaces it with `CREATE_NEW_CONSOLE`.
        let mut c = crate::proc::command(std::env::current_exe().unwrap());
        c.args(["--exact", NAME, "--nocapture", "--test-threads=1", "--quiet"]).env(ROLE, role);
        c
    }

    /// Everything on this process's console screen.
    fn screen() -> String {
        let file = std::fs::OpenOptions::new().read(true).write(true).open("CONOUT$").expect("the terminal has a console");
        let con = file.as_raw_handle();
        // SAFETY: reads this process's own console buffer into a buffer of the size it reports.
        unsafe {
            let mut info: CONSOLE_SCREEN_BUFFER_INFO = std::mem::zeroed();
            assert!(GetConsoleScreenBufferInfo(con, &mut info) != 0);
            let len = info.dwSize.X as u32 * info.dwSize.Y as u32;
            let mut buf = vec![0u16; len as usize];
            let mut read = 0;
            assert!(ReadConsoleOutputCharacterW(con, buf.as_mut_ptr(), len, COORD { X: 0, Y: 0 }, &mut read) != 0);
            String::from_utf16_lossy(&buf[..read as usize])
        }
    }

    #[test]
    fn a_program_with_no_stdout_prints_into_the_terminal_that_started_it() {
        match std::env::var(ROLE).as_deref() {
            Ok("program") => {
                // SAFETY: drops this process's console and stdout, as a GUI-subsystem start has none.
                unsafe {
                    FreeConsole();
                    SetStdHandle(STD_OUTPUT_HANDLE, std::ptr::null_mut());
                    SetStdHandle(STD_ERROR_HANDLE, std::ptr::null_mut());
                }
                assert!(super::attach_parent(), "did not attach to the terminal's console");
                println!("{LINE}");
            }
            Ok("terminal") => {
                let ran = me("program").stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).status().unwrap();
                let seen = screen();
                if !ran.success() || !seen.contains(LINE) {
                    // The test reads why from this file: the terminal's own stdout is a console.
                    let report = std::env::var_os("MNEMO_TEST_CONSOLE_REPORT").unwrap();
                    std::fs::write(report, format!("program: {ran}\nscreen: {}", seen.trim_end())).unwrap();
                    std::process::exit(1);
                }
            }
            _ => {
                let report = crate::testutil::temp_dir("console").join("report.txt");
                let ran = me("terminal").env("MNEMO_TEST_CONSOLE_REPORT", &report).creation_flags(CREATE_NEW_CONSOLE).status().unwrap();
                assert!(ran.success(), "{}", std::fs::read_to_string(&report).unwrap_or_default());
            }
        }
    }

    #[test]
    fn a_stdout_that_goes_somewhere_is_left_alone() {
        // This test's stdout is the pipe or console `cargo test` gave it.
        assert!(!super::attach_parent());
    }
}

//! The one way this app starts a process.
//!
//! On Windows a GUI app that starts a console program (`git`, `gh`, `mnemo`, `claude`, `cmd`)
//! gets a new console window for it: it flashes on screen and takes focus from the app. The
//! app polls those programs, so on Windows the flashing never stopped. `CREATE_NO_WINDOW`
//! runs the child with a console that is never shown, and whatever the child starts in turn
//! inherits that hidden console instead of opening its own. It changes nothing for a GUI
//! program (a browser), and nothing at all off Windows.
//!
//! Every `Command` in `src/` comes from here; the test below fails on a `Command::new`
//! anywhere else, so a new call site cannot bring the flashing back.

use std::ffi::OsStr;
use std::process::Command;

/// `CREATE_NO_WINDOW`, from `winbase.h`.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// `Command::new(program)`, with no console window on Windows.
pub fn command(program: impl AsRef<OsStr>) -> Command {
    #[allow(unused_mut)]
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    fn rust_files(dir: &Path, out: &mut Vec<PathBuf>) {
        for entry in std::fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                rust_files(&path, out);
            } else if path.extension().map_or(false, |e| e == "rs") {
                out.push(path);
            }
        }
    }

    #[test]
    fn every_process_is_started_through_command() {
        let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut files = Vec::new();
        rust_files(&src, &mut files);
        let offenders: Vec<String> = files
            .iter()
            .filter(|f| f.file_name().map_or(true, |n| n != "proc.rs"))
            .flat_map(|f| {
                let text = std::fs::read_to_string(f).unwrap();
                let rel = f.strip_prefix(&src).unwrap().display().to_string();
                text.lines()
                    .enumerate()
                    .filter(|(_, l)| l.contains("Command::new("))
                    .map(|(i, _)| format!("{rel}:{}", i + 1))
                    .collect::<Vec<_>>()
            })
            .collect();
        assert!(
            offenders.is_empty(),
            "start processes with crate::proc::command, or Windows opens a console window for each: {offenders:?}"
        );
    }

    #[test]
    fn the_command_runs_the_program_it_names() {
        let out = super::command("git").arg("--version").output().unwrap();
        assert!(out.status.success());
        assert!(String::from_utf8_lossy(&out.stdout).starts_with("git version"));
    }
}

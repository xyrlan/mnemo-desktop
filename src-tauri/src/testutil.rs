//! Helpers shared by unit tests. `cargo test` runs every test as a thread of one
//! process, so anything keyed on the process id is shared by all of them.

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

/// A fresh, empty directory that no other test (in this run or another) gets.
pub fn temp_dir(tag: &str) -> PathBuf {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let n = NEXT.fetch_add(1, Ordering::Relaxed);
    // Hex keeps Unix socket paths inside the ~104-byte sun_path limit.
    let d = std::env::temp_dir().join(format!("mnemo-test-{tag}-{nanos:x}-{n}"));
    std::fs::create_dir_all(&d).unwrap();
    d
}

/// A stand-in for a program called `name`, in `dir`, and its path: `sh`, a `/bin/sh` script with
/// no `#!` line, or on Windows `cmd`, the lines of a batch file `name.cmd`. A test that starts a
/// program by its path runs on every OS with one: Windows' real `mnemo` is an `.exe`, which no
/// test can write, and a batch file is what `std::process::Command` runs in its place.
pub fn stand_in(dir: &std::path::Path, name: &str, sh: &str, cmd: &str) -> PathBuf {
    #[cfg(windows)]
    {
        let _ = sh;
        let path = dir.join(format!("{name}.cmd"));
        std::fs::write(&path, format!("@echo off\r\n{}\r\n", cmd.trim_end().replace('\n', "\r\n"))).unwrap();
        path
    }
    #[cfg(unix)]
    {
        let _ = cmd;
        let path = dir.join(name);
        write_script(&path, &format!("#!/bin/sh\n{sh}"));
        path
    }
}

/// `dir` as a program started in it names its folder: macOS reaches a temp dir through a link
/// (`/var` → `/private/var`), and `pwd -P` says where it leads. Windows' `%CD%` says the path it
/// was given, with no `\\?\` in front of it as `canonicalize` puts there.
pub fn dir_as_named(dir: &std::path::Path) -> PathBuf {
    if cfg!(windows) {
        dir.to_path_buf()
    } else {
        dir.canonicalize().unwrap()
    }
}

/// Writes an executable shell script and returns once it can be exec'd.
///
/// On Linux a thread forking a child while our write fd is open leaks that fd into
/// the child until it execs; exec'ing the script meanwhile fails with ETXTBSY. Once a
/// probe exec succeeds no writer is left and none can appear, so real runs are safe.
/// `body` must start with a `#!` line; the probe line goes right after it.
#[cfg(unix)]
pub fn write_script(path: &std::path::Path, body: &str) {
    use std::os::unix::fs::PermissionsExt;
    let (shebang, rest) = body.split_once('\n').expect("script needs a #! line");
    assert!(shebang.starts_with("#!"), "script needs a #! line");
    std::fs::write(path, format!("{shebang}\n[ -n \"$MNEMO_TEST_PROBE\" ] && exit 0\n{rest}")).unwrap();
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
    for _ in 0..100 {
        match crate::proc::command(path).env("MNEMO_TEST_PROBE", "1").output() {
            Err(e) if e.raw_os_error() == Some(ETXTBSY) => std::thread::sleep(std::time::Duration::from_millis(20)),
            r => {
                assert!(r.unwrap().status.success(), "probe of {} failed", path.display());
                return;
            }
        }
    }
    panic!("{}: exec kept failing with ETXTBSY", path.display());
}

/// errno "Text file busy", the same on Linux and macOS.
#[cfg(unix)]
const ETXTBSY: i32 = 26;

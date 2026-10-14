//! One app per state dir (#366). A second launch on the same `app_dir` would restore the same
//! `workspace.json` with new shells beside the first, and whichever wrote last would win. So
//! the first launch holds a lock on `instance.lock` in the dir and listens on a loopback port it
//! writes to `instance.port`; a later launch that finds the lock taken asks that port to bring
//! the running window forward, and exits before it opens one.
//!
//! Keyed by the state dir and not by the bundle identifier (which `tauri-plugin-single-instance`
//! uses): a `pnpm tauri dev` build keeps its own dir (`app_dir`, #168) and an instance started
//! with a throwaway `HOME` has another, and both must keep running beside the installed app.
//!
//! The lock is the system's (`flock`, `LockFileEx`), so it goes with the process however that
//! ends: a crash leaves no stale claim behind. Both the file and the socket are opened
//! close-on-exec / non-inheritable (std's default), so shells and the terminal daemon the app
//! starts never carry the lock past it.

use std::fs::{File, OpenOptions};
use std::io::{self, Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::path::Path;
use std::time::{Duration, Instant};

pub const LOCK: &str = "instance.lock";
pub const PORT: &str = "instance.port";

const ASK: &[u8] = b"mnemo-desktop: come forward\n";
const ANSWER: &[u8] = b"mnemo-desktop: here\n";

/// What a launch found in its state dir.
pub enum Claim {
    /// No other instance: this one runs, and serves later launches with `Primary::serve`.
    First(Primary),
    /// An instance was running and was asked to come forward: this one exits.
    HandedOff,
    /// An instance holds the dir but did not answer within the wait: this one says so and
    /// exits, rather than run a second app on the same state.
    Silent,
}

/// The running instance's hold on its dir: the lock, and the port later launches knock on.
pub struct Primary {
    lock: File,
    listener: TcpListener,
}

/// Claims `dir` for this process, or hands off to the instance that holds it. `wait` bounds how
/// long a launch keeps trying when the holder does not answer yet: one that is still starting
/// (no port written) or quitting (an app being replaced by `pnpm run install-app`), whose lock
/// is then free on a later try. An `Err` is a dir or socket that could not be used at all.
pub fn claim(dir: &Path, wait: Duration) -> io::Result<Claim> {
    std::fs::create_dir_all(dir)?;
    let deadline = Instant::now() + wait;
    loop {
        let lock = OpenOptions::new().create(true).truncate(false).read(true).write(true).open(dir.join(LOCK))?;
        if try_lock(&lock)? {
            let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
            // Into place by a rename, so a launch reading it never sees half a number.
            let tmp = dir.join(format!("{PORT}.{}", std::process::id()));
            std::fs::write(&tmp, listener.local_addr()?.port().to_string())?;
            std::fs::rename(&tmp, dir.join(PORT))?;
            return Ok(Claim::First(Primary { lock, listener }));
        }
        drop(lock);
        if hand_off(dir).is_ok() {
            return Ok(Claim::HandedOff);
        }
        if Instant::now() >= deadline {
            return Ok(Claim::Silent);
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

impl Primary {
    /// Answers later launches for the rest of the process, calling `show` for each. The lock
    /// moves into the thread with the listener and is held until the process ends.
    pub fn serve(self, show: impl Fn() + Send + 'static) {
        std::thread::Builder::new()
            .name("single-instance".into())
            .spawn(move || {
                let Primary { lock: _lock, listener } = self;
                for stream in listener.incoming().flatten() {
                    // Answered first: `show` goes through the event loop, and the launch
                    // waiting on the answer should not wait on that.
                    if answer(stream).is_ok() {
                        show();
                    }
                }
            })
            .expect("spawn the single-instance thread");
    }
}

/// Reads one knock; answers it when it is a mnemo launch's.
fn answer(mut stream: TcpStream) -> io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(2)))?;
    let mut got = [0u8; ASK.len()];
    stream.read_exact(&mut got)?;
    if got != ASK {
        return Err(io::Error::other("not a mnemo launch"));
    }
    stream.write_all(ANSWER)
}

/// Knocks on the port the holder of `dir` wrote, and waits for its answer.
fn hand_off(dir: &Path) -> io::Result<()> {
    let port: u16 = std::fs::read_to_string(dir.join(PORT))?.trim().parse().map_err(io::Error::other)?;
    // Windows lets only the process the person just started take the foreground; this one
    // passes that on to the instance it hands off to, or the window only flashes in the taskbar.
    #[cfg(windows)]
    // SAFETY: no pointers; it only widens who may set the foreground window.
    unsafe {
        windows_sys::Win32::UI::WindowsAndMessaging::AllowSetForegroundWindow(windows_sys::Win32::UI::WindowsAndMessaging::ASFW_ANY);
    }
    let mut stream = TcpStream::connect_timeout(&SocketAddr::from((Ipv4Addr::LOCALHOST, port)), Duration::from_secs(1))?;
    stream.set_read_timeout(Some(Duration::from_secs(2)))?;
    stream.write_all(ASK)?;
    let mut got = [0u8; ANSWER.len()];
    stream.read_exact(&mut got)?;
    if got == ANSWER {
        Ok(())
    } else {
        Err(io::Error::other("the port answered as something other than mnemo"))
    }
}

/// An exclusive lock on `file`, without waiting: false when another holds it.
#[cfg(unix)]
fn try_lock(file: &File) -> io::Result<bool> {
    use std::os::unix::io::AsRawFd;
    // SAFETY: a valid descriptor owned by `file`.
    if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } == 0 {
        return Ok(true);
    }
    let e = io::Error::last_os_error();
    if e.kind() == io::ErrorKind::WouldBlock {
        Ok(false)
    } else {
        Err(e)
    }
}

#[cfg(windows)]
fn try_lock(file: &File) -> io::Result<bool> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Foundation::{ERROR_IO_PENDING, ERROR_LOCK_VIOLATION};
    use windows_sys::Win32::Storage::FileSystem::{LockFileEx, LOCKFILE_EXCLUSIVE_LOCK, LOCKFILE_FAIL_IMMEDIATELY};
    // SAFETY: a valid handle owned by `file`, and a zeroed OVERLAPPED (offset 0) that outlives
    // the call, which does not wait.
    let ok = unsafe {
        let mut overlapped: windows_sys::Win32::System::IO::OVERLAPPED = std::mem::zeroed();
        LockFileEx(file.as_raw_handle(), LOCKFILE_EXCLUSIVE_LOCK | LOCKFILE_FAIL_IMMEDIATELY, 0, 1, 0, &mut overlapped)
    };
    if ok != 0 {
        return Ok(true);
    }
    let e = io::Error::last_os_error();
    match e.raw_os_error().map(|c| c as u32) {
        Some(ERROR_LOCK_VIOLATION | ERROR_IO_PENDING) => Ok(false),
        _ => Err(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    fn scratch(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("mnemo-single-instance-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    fn first(dir: &Path) -> Primary {
        match claim(dir, Duration::from_secs(5)).expect("claim") {
            Claim::First(p) => p,
            _ => panic!("nothing held {} yet", dir.display()),
        }
    }

    #[test]
    fn a_second_launch_on_the_same_dir_brings_the_first_forward_and_does_not_run() {
        let dir = scratch("handoff");
        let (tx, rx) = mpsc::channel();
        first(&dir).serve(move || {
            let _ = tx.send(());
        });
        assert!(matches!(claim(&dir, Duration::from_secs(5)).expect("second claim"), Claim::HandedOff));
        rx.recv_timeout(Duration::from_secs(5)).expect("the first instance was asked to show its window");
        // And again: the first keeps answering.
        assert!(matches!(claim(&dir, Duration::from_secs(5)).expect("third claim"), Claim::HandedOff));
        rx.recv_timeout(Duration::from_secs(5)).expect("shown again");
    }

    #[test]
    fn launches_on_different_dirs_both_run() {
        // A debug build (`~/.mnemo-desktop-dev`) beside the installed app (`~/.mnemo-desktop`).
        let (a, b) = (scratch("dir-a"), scratch("dir-b"));
        let _a = first(&a);
        let _b = first(&b);
    }

    #[test]
    fn the_dir_is_free_again_once_the_holder_is_gone() {
        let dir = scratch("released");
        drop(first(&dir));
        let _again = first(&dir);
    }

    #[test]
    fn a_holder_that_never_answers_is_said_rather_than_waited_on_forever() {
        let dir = scratch("silent");
        // Holds the lock but serves nobody: its port takes the knock and never answers.
        let _silent = first(&dir);
        assert!(matches!(claim(&dir, Duration::from_millis(300)).expect("claim"), Claim::Silent));
    }

    #[test]
    fn a_launch_waits_for_an_instance_that_is_quitting() {
        // `install-app` quits the old app and starts the new one; the old one's lock may
        // outlive its answers for a moment.
        let dir = scratch("quitting");
        let old = first(&dir);
        let quitting = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(400));
            drop(old);
        });
        assert!(matches!(claim(&dir, Duration::from_secs(5)).expect("claim"), Claim::First(_)));
        quitting.join().unwrap();
    }

    #[test]
    fn something_else_on_the_port_is_not_taken_for_mnemo() {
        let dir = scratch("stranger");
        let _held = first(&dir);
        // A stale port file pointing at a program that answers something else.
        let stranger = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        std::fs::write(dir.join(PORT), stranger.local_addr().unwrap().port().to_string()).unwrap();
        std::thread::spawn(move || {
            for mut s in stranger.incoming().flatten() {
                let _ = s.write_all(b"HTTP/1.1 400 Bad Request\r\n\r\n");
            }
        });
        assert!(hand_off(&dir).is_err());
    }
}

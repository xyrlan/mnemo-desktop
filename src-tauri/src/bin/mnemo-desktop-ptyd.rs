//! `mnemo-desktop-ptyd --socket <path>`: the daemon that holds the app's terminals, so that
//! quitting or reloading the app leaves every shell — and the `claude` in it — running, and the
//! next launch attaches each pane to its shell again, screen and scrollback included (see
//! `src/pty.rs`).
//!
//! The app starts it when nothing answers on the socket in its app dir. It leaves the app's
//! session, so neither a quit nor a Ctrl-C in the terminal that ran `tauri dev` reaches it; it
//! ends when no terminal is left running and no app has been connected for `IDLE`, when an app
//! asks it to (`Shutdown`, from an app of another protocol version), or when its socket is
//! removed from under it (its app dir was deleted).
//!
//! Like the other helpers it links nothing of the app: `src/pty/{wire,screen,host,server}.rs`
//! are included by path.

#[cfg(unix)]
#[allow(dead_code)]
#[path = "../pty/wire.rs"]
mod wire;

#[cfg(unix)]
#[allow(dead_code)]
#[path = "../pty/screen.rs"]
mod screen;

#[cfg(unix)]
#[allow(dead_code)]
#[path = "../pty/host.rs"]
mod host;

#[cfg(unix)]
#[path = "../pty/server.rs"]
mod server;

#[cfg(unix)]
fn main() {
    daemon::main()
}

#[cfg(not(unix))]
fn main() {
    eprintln!("mnemo-desktop-ptyd: terminals outlive the app only on macOS and Linux");
    std::process::exit(1);
}

#[cfg(unix)]
mod daemon {
    use super::host::Host;
    use super::server::Server;
    use std::os::unix::fs::MetadataExt;
    use std::os::unix::io::AsRawFd;
    use std::os::unix::net::{UnixListener, UnixStream};
    use std::path::{Path, PathBuf};
    use std::sync::Arc;
    use std::time::Duration;

    /// How long the daemon waits, with no terminal running and no app connected, before it ends.
    const IDLE: Duration = Duration::from_secs(5);
    const TICK: Duration = Duration::from_millis(500);

    pub fn main() {
        env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).format_timestamp_millis().init();
        let Some(socket) = socket_arg(std::env::args().skip(1)) else {
            eprintln!("usage: mnemo-desktop-ptyd --socket <path>");
            std::process::exit(2);
        };
        // Out of the app's session and process group: signals meant for the app stay there.
        unsafe { libc::setsid() };

        let _lock = match take_lock(&socket) {
            Ok(Some(f)) => f,
            Ok(None) => {
                log::info!("another daemon holds {}, leaving it be", socket.display());
                return;
            }
            Err(e) => fail(&format!("lock beside {}: {e}", socket.display())),
        };
        if UnixStream::connect(&socket).is_ok() {
            log::info!("a daemon already answers on {}", socket.display());
            return;
        }
        let _ = std::fs::remove_file(&socket);
        // Only this user may connect: whoever can, can type into every shell.
        let old = unsafe { libc::umask(0o077) };
        let listener = UnixListener::bind(&socket);
        unsafe { libc::umask(old) };
        let listener = listener.unwrap_or_else(|e| fail(&format!("bind {}: {e}", socket.display())));
        let inode = std::fs::metadata(&socket).map(|m| m.ino()).unwrap_or(0);
        log::info!("pid {} serving {} (protocol {})", std::process::id(), socket.display(), super::wire::VERSION);

        let host = Arc::new(Host::new(first_id()));
        let gone = socket.clone();
        let server = Server::new(Arc::clone(&host), move || {
            let _ = std::fs::remove_file(&gone);
            std::process::exit(0);
        });
        let accepting = Arc::clone(&server);
        std::thread::spawn(move || accepting.accept(listener));

        loop {
            std::thread::sleep(TICK);
            if std::fs::metadata(&socket).map(|m| m.ino()).ok() != Some(inode) {
                log::info!("{} is gone: ending every terminal", socket.display());
                host.kill_all();
                std::process::exit(0);
            }
            if host.running() == 0 && server.clients() == 0 && server.quiet_for() >= IDLE {
                log::info!("no terminal and no app: leaving");
                let _ = std::fs::remove_file(&socket);
                std::process::exit(0);
            }
        }
    }

    fn fail(msg: &str) -> ! {
        log::error!("{msg}");
        std::process::exit(1)
    }

    pub(super) fn socket_arg(mut args: impl Iterator<Item = String>) -> Option<PathBuf> {
        while let Some(a) = args.next() {
            if a == "--socket" {
                return args.next().filter(|p| !p.is_empty()).map(PathBuf::from);
            }
        }
        None
    }

    /// An exclusive lock on `<socket>.lock`, held for the daemon's life, so two daemons started
    /// at once never both take the socket. `None`: another daemon has it.
    fn take_lock(socket: &Path) -> std::io::Result<Option<std::fs::File>> {
        let mut name = socket.as_os_str().to_owned();
        name.push(".lock");
        let f = std::fs::OpenOptions::new().create(true).truncate(false).write(true).open(PathBuf::from(name))?;
        if unsafe { libc::flock(f.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } == 0 {
            return Ok(Some(f));
        }
        let e = std::io::Error::last_os_error();
        if e.raw_os_error() == Some(libc::EWOULDBLOCK) {
            Ok(None)
        } else {
            Err(e)
        }
    }

    /// Ids of this daemon start in a block of their own (by the second it started): a pane the
    /// app still holds from a daemon that died never names a terminal of this one.
    pub(super) fn first_id() -> u32 {
        let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        ((secs % 400_000) as u32) * 10_000 + 1
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::daemon::{first_id, socket_arg};
    use std::path::PathBuf;

    #[test]
    fn the_socket_comes_from_its_flag() {
        let args = |a: &[&str]| a.iter().map(|s| s.to_string()).collect::<Vec<_>>().into_iter();
        assert_eq!(socket_arg(args(&["--socket", "/x/ptyd.sock"])), Some(PathBuf::from("/x/ptyd.sock")));
        assert_eq!(socket_arg(args(&["-v", "--socket", "/y"])), Some(PathBuf::from("/y")));
        assert_eq!(socket_arg(args(&["--socket"])), None);
        assert_eq!(socket_arg(args(&["--socket", ""])), None);
        assert_eq!(socket_arg(args(&[])), None);
    }

    #[test]
    fn ids_start_in_a_block_that_fits_a_pane_id() {
        let first = first_id();
        assert_eq!(first % 10_000, 1);
        assert!(first.checked_add(9_999).is_some());
    }
}

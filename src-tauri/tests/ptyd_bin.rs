//! The real `mnemo-desktop-ptyd`, started by the app's own client (`src/pty.rs`) as the app
//! starts it: shells outlive the app that started them, the next app attaches to them, and the
//! daemon leaves when nothing is left for it to hold.

#![cfg(unix)]

use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use mnemo_desktop_lib::pty::{Event, PaneId, PtyManager, SpawnOptions};

const BIN: &str = env!("CARGO_BIN_EXE_mnemo-desktop-ptyd");

fn scratch(tag: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
    // Short: a socket path must fit in ~104 bytes.
    let d = std::env::temp_dir().join(format!("mdp-{tag}-{nanos:x}"));
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn app(socket: &Path) -> PtyManager {
    PtyManager::with_daemon(socket.to_path_buf(), PathBuf::from(BIN), None)
}

fn recorder() -> (Box<dyn Fn(Event) + Send + Sync>, mpsc::Receiver<Event>) {
    let (tx, rx) = mpsc::channel();
    (
        Box::new(move |e| {
            let _ = tx.send(e);
        }),
        rx,
    )
}

fn sh(m: &PtyManager, script: &str) -> (PaneId, mpsc::Receiver<Event>) {
    let (sink, rx) = recorder();
    let opts = SpawnOptions { program: Some("/bin/sh".into()), args: vec!["-c".into(), script.into()], cwd: Some("/".into()), cols: 80, rows: 24, login: false };
    (m.spawn(opts, sink).expect("spawn"), rx)
}

fn until(rx: &mpsc::Receiver<Event>, want: &str) -> String {
    let mut out = Vec::new();
    let deadline = Instant::now() + Duration::from_secs(10);
    while Instant::now() < deadline && !String::from_utf8_lossy(&out).contains(want) {
        if let Ok(Event::Output(b)) = rx.recv_timeout(Duration::from_millis(50)) {
            out.extend(b);
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn eventually(what: &str, secs: u64, mut f: impl FnMut() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(secs);
    while !f() {
        assert!(Instant::now() < deadline, "timed out waiting for {what}");
        std::thread::sleep(Duration::from_millis(50));
    }
}

fn ps(field: &str, pid: u32) -> Option<String> {
    let out = std::process::Command::new("ps").args(["-o", &format!("{field}="), "-p", &pid.to_string()]).output().ok()?;
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (!s.is_empty()).then_some(s)
}

fn running(pid: u32) -> bool {
    ps("pid", pid).is_some()
}

#[test]
fn shells_outlive_the_app_and_the_daemon_leaves_once_idle() {
    let socket = scratch("keep").join("ptyd.sock");
    let first = app(&socket);
    let (id, rx) = sh(&first, "echo ready; sleep 300 & echo bg:$!; echo go; while read x; do echo got:$x; done");
    let out = until(&rx, "go\r\n");
    assert!(out.contains("ready"), "{out:?}");
    let bg: u32 = out.split("bg:").nth(1).and_then(|r| r.lines().next()).unwrap().trim().parse().unwrap();

    // The daemon: private socket, out of our session, parent of the shell.
    let mode = std::fs::metadata(&socket).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode & 0o077, 0, "group and others may not connect: {mode:o}");
    let shell = first.pid(id).expect("a running shell");
    let daemon: u32 = ps("ppid", shell).unwrap().parse().unwrap();
    assert_ne!(daemon, std::process::id());
    assert_eq!(ps("pgid", daemon).as_deref(), Some(daemon.to_string().as_str()), "it leads its own group and session");

    // The app quits.
    drop(first);
    std::thread::sleep(Duration::from_millis(300));
    assert!(running(shell) && running(bg), "the shell and what it started keep running");

    // The next one attaches and finds the screen as it was.
    let second = app(&socket);
    let info = second.list().unwrap();
    assert_eq!(info.len(), 1);
    assert!(info[0].alive && info[0].id == id && info[0].pid == shell && info[0].cwd == "/");
    let (sink, rx2) = recorder();
    let snapshot = String::from_utf8(second.attach(id, sink).unwrap()).unwrap();
    assert!(snapshot.contains("ready") && snapshot.contains(&format!("bg:{bg}")), "{snapshot:?}");
    second.write(id, b"again\n").unwrap();
    assert!(until(&rx2, "got:again").contains("got:again"));

    // Nothing left to hold and nobody connected: it goes, and takes its socket.
    second.kill(id);
    let _ = std::process::Command::new("kill").arg(bg.to_string()).status();
    eventually("the shell to end", 10, || second.list().map(|l| l.is_empty()).unwrap_or(false));
    drop(second);
    eventually("the daemon to leave", 15, || !running(daemon));
    assert!(!socket.exists());
}

#[test]
fn a_daemon_whose_socket_is_removed_ends_its_shells() {
    let dir = scratch("gone");
    let socket = dir.join("ptyd.sock");
    let m = app(&socket);
    let (id, rx) = sh(&m, "echo up; while read x; do :; done");
    assert!(until(&rx, "up").contains("up"));
    let shell = m.pid(id).unwrap();
    let daemon: u32 = ps("ppid", shell).unwrap().parse().unwrap();
    drop(m);
    // A throwaway app dir, deleted: nothing may be left running for it.
    std::fs::remove_dir_all(&dir).unwrap();
    eventually("the daemon to leave", 10, || !running(daemon));
    eventually("its shell to end", 10, || !running(shell));
}

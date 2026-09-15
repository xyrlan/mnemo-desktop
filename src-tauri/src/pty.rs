//! PTY ownership. No Tauri types here so `cargo test` covers it directly.

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

pub type PaneId = u32;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Event {
    Output(Vec<u8>),
    Exit(Option<i32>),
}

pub type Sink = Box<dyn Fn(Event) + Send + Sync + 'static>;

pub struct SpawnOptions {
    /// `None` = the user's default shell.
    pub program: Option<String>,
    pub args: Vec<String>,
    pub cwd: Option<String>,
    pub cols: u16,
    pub rows: u16,
    /// Add `-l` on POSIX so the login profile loads.
    pub login: bool,
}

struct Handle {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

#[derive(Default)]
pub struct PtyManager {
    next: AtomicU32,
    handles: Arc<Mutex<HashMap<PaneId, Handle>>>,
}

pub fn default_shell() -> String {
    if cfg!(windows) {
        std::env::var("COMSPEC").unwrap_or_else(|_| "powershell.exe".into())
    } else {
        std::env::var("SHELL").unwrap_or_else(|_| {
            if cfg!(target_os = "macos") {
                "/bin/zsh".into()
            } else {
                "/bin/bash".into()
            }
        })
    }
}

impl PtyManager {
    pub fn new() -> Self {
        Self { next: AtomicU32::new(1), handles: Default::default() }
    }

    pub fn spawn(&self, opts: SpawnOptions, sink: Sink) -> Result<PaneId, String> {
        let system = native_pty_system();
        let pair = system
            .openpty(PtySize { rows: opts.rows, cols: opts.cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| format!("openpty: {e}"))?;

        let program = opts.program.unwrap_or_else(default_shell);
        let mut cmd = CommandBuilder::new(&program);
        if opts.login && !cfg!(windows) {
            cmd.arg("-l");
        }
        for a in &opts.args {
            cmd.arg(a);
        }
        if let Some(cwd) = &opts.cwd {
            cmd.cwd(cwd);
        }
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd.env("MNEMO_DESKTOP", "1");

        let child = pair.slave.spawn_command(cmd).map_err(|e| format!("spawn {program}: {e}"))?;
        drop(pair.slave);

        let mut reader = pair.master.try_clone_reader().map_err(|e| format!("reader: {e}"))?;
        let writer = pair.master.take_writer().map_err(|e| format!("writer: {e}"))?;

        let id = self.next.fetch_add(1, Ordering::SeqCst);
        let handles = Arc::clone(&self.handles);
        let sink: Arc<Sink> = Arc::new(sink);

        handles.lock().unwrap().insert(id, Handle { master: pair.master, writer, child });

        thread::Builder::new()
            .name(format!("pty-reader-{id}"))
            .spawn(move || {
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    let mut buf = [0u8; 8192];
                    loop {
                        match reader.read(&mut buf) {
                            Ok(0) => break,
                            Ok(n) => sink(Event::Output(buf[..n].to_vec())),
                            Err(_) => break,
                        }
                    }
                }));
                if result.is_err() {
                    log::error!("pty reader {id} panicked");
                }
                let code = {
                    let mut map = handles.lock().unwrap();
                    map.remove(&id)
                        .and_then(|mut h| h.child.wait().ok())
                        .map(|s| s.exit_code() as i32)
                };
                sink(Event::Exit(code));
            })
            .map_err(|e| format!("thread: {e}"))?;

        Ok(id)
    }

    pub fn write(&self, id: PaneId, data: &[u8]) -> Result<(), String> {
        let mut map = self.handles.lock().unwrap();
        let h = map.get_mut(&id).ok_or_else(|| format!("pane {id} not found"))?;
        h.writer.write_all(data).map_err(|e| format!("write: {e}"))
    }

    pub fn resize(&self, id: PaneId, cols: u16, rows: u16) -> Result<(), String> {
        let map = self.handles.lock().unwrap();
        let h = map.get(&id).ok_or_else(|| format!("pane {id} not found"))?;
        h.master
            .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| format!("resize: {e}"))
    }

    /// Idempotent. Unknown ids are a no-op. The reader thread emits `Exit` when the PTY closes.
    pub fn kill(&self, id: PaneId) {
        let mut map = self.handles.lock().unwrap();
        if let Some(h) = map.get_mut(&id) {
            let _ = h.child.kill();
        }
    }

    pub fn kill_all(&self) {
        let ids: Vec<PaneId> = self.handles.lock().unwrap().keys().copied().collect();
        for id in ids {
            self.kill(id);
        }
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;

    fn sh(manager: &PtyManager, script: &str) -> (PaneId, mpsc::Receiver<Event>) {
        let (tx, rx) = mpsc::channel();
        let id = manager
            .spawn(
                SpawnOptions {
                    program: Some("/bin/sh".into()),
                    args: vec!["-c".into(), script.into()],
                    cwd: None,
                    cols: 80,
                    rows: 24,
                    login: false,
                },
                Box::new(move |e| {
                    let _ = tx.send(e);
                }),
            )
            .expect("spawn");
        (id, rx)
    }

    fn collect(rx: &mpsc::Receiver<Event>) -> (Vec<u8>, Option<Option<i32>>) {
        let mut out = Vec::new();
        let mut exit = None;
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while std::time::Instant::now() < deadline {
            match rx.recv_timeout(Duration::from_millis(100)) {
                Ok(Event::Output(b)) => out.extend(b),
                Ok(Event::Exit(code)) => {
                    exit = Some(code);
                    break;
                }
                Err(mpsc::RecvTimeoutError::Timeout) => continue,
                Err(_) => break,
            }
        }
        (out, exit)
    }

    #[test]
    fn spawn_streams_output_then_exit() {
        let m = PtyManager::new();
        let (_id, rx) = sh(&m, "printf hi");
        let (out, exit) = collect(&rx);
        assert!(String::from_utf8_lossy(&out).contains("hi"), "got {:?}", out);
        assert_eq!(exit, Some(Some(0)));
    }

    #[test]
    fn exit_code_is_reported() {
        let m = PtyManager::new();
        let (_id, rx) = sh(&m, "exit 3");
        let (_out, exit) = collect(&rx);
        assert_eq!(exit, Some(Some(3)));
    }

    #[test]
    fn ids_are_unique_and_increasing() {
        let m = PtyManager::new();
        let (a, _ra) = sh(&m, "true");
        let (b, _rb) = sh(&m, "true");
        assert!(b > a);
    }

    #[test]
    fn env_is_set_for_the_child() {
        let m = PtyManager::new();
        let (_id, rx) = sh(&m, "printf \"%s|%s\" \"$MNEMO_DESKTOP\" \"$TERM\"");
        let (out, _) = collect(&rx);
        assert!(String::from_utf8_lossy(&out).contains("1|xterm-256color"), "got {:?}", out);
    }

    #[test]
    fn resize_live_pty_ok() {
        let m = PtyManager::new();
        let (id, rx) = sh(&m, "sleep 2");
        m.resize(id, 120, 40).expect("resize");
        m.kill(id);
        let (_, exit) = collect(&rx);
        assert!(exit.is_some(), "kill must end the reader with an Exit event");
    }

    #[test]
    fn kill_is_idempotent_and_unknown_is_noop() {
        let m = PtyManager::new();
        let (id, rx) = sh(&m, "true");
        let _ = collect(&rx);
        m.kill(id);
        m.kill(id);
        m.kill(999_999);
    }

    #[test]
    fn write_reaches_the_child() {
        let m = PtyManager::new();
        let (id, rx) = sh(&m, "read x; printf \"got:%s\" \"$x\"");
        m.write(id, b"abc\n").expect("write");
        let (out, exit) = collect(&rx);
        assert!(String::from_utf8_lossy(&out).contains("got:abc"), "got {:?}", out);
        assert_eq!(exit, Some(Some(0)));
    }

    #[test]
    fn write_after_exit_is_error() {
        let m = PtyManager::new();
        let (id, rx) = sh(&m, "true");
        let _ = collect(&rx);
        assert!(m.write(id, b"x").is_err());
    }

    #[test]
    fn cwd_is_honoured() {
        let m = PtyManager::new();
        let (tx, rx) = mpsc::channel();
        m.spawn(
            SpawnOptions {
                program: Some("/bin/sh".into()),
                args: vec!["-c".into(), "pwd".into()],
                cwd: Some("/tmp".into()),
                cols: 80,
                rows: 24,
                login: false,
            },
            Box::new(move |e| {
                let _ = tx.send(e);
            }),
        )
        .unwrap();
        let (out, _) = collect(&rx);
        let s = String::from_utf8_lossy(&out);
        assert!(s.contains("/tmp"), "got {s:?}");
    }
}

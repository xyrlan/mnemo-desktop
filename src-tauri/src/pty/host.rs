//! The terminals themselves: each a PTY, the program in it and its screen (`screen.rs`), with
//! at most one subscriber receiving what it prints. The daemon runs one host for every app that
//! connects; the app runs one in-process when there is no daemon.
//!
//! A terminal whose program ended stays listed (not alive) until it is killed, so an app that
//! was away when it ended learns so; one killed is forgotten as soon as its program is gone.
//!
//! Shared by the app and the daemon binary, which includes this file by path: it names nothing
//! outside `std` and its crates.

use super::screen::Screen;
use super::wire::{Event, PaneId, PtyInfo};
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{mpsc, Arc, Mutex, MutexGuard};
use std::thread;

/// Where a terminal's output goes. `owner` names the connection (0 in-process); `send` answers
/// false once nobody is listening, and is then dropped.
pub struct Subscriber {
    // Read by the daemon (server.rs) when a connection closes.
    #[cfg_attr(not(test), allow(dead_code))]
    pub owner: u64,
    pub send: Box<dyn Fn(PaneId, Event) -> bool + Send + Sync>,
}

/// A lock that outlives a panic elsewhere: one broken terminal must not take the rest down.
fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

struct Session {
    pid: Option<u32>,
    /// The folder it started in.
    cwd: String,
    master: Mutex<Box<dyn MasterPty + Send>>,
    /// To the thread that writes into the PTY: a program that stops reading blocks that
    /// thread, not whoever typed.
    input: mpsc::Sender<Vec<u8>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    state: Mutex<State>,
}

struct State {
    screen: Screen,
    sub: Option<Subscriber>,
    /// Set once the program has ended, with its exit code when it had one.
    exit: Option<Option<i32>>,
    killed: bool,
}

type Table = Arc<Mutex<HashMap<PaneId, Arc<Session>>>>;

pub struct Host {
    next: AtomicU32,
    sessions: Table,
}

impl Default for Host {
    fn default() -> Self {
        Self::new(1)
    }
}

impl Host {
    /// Ids start at `first`: a daemon picks one no earlier daemon used, so an id a pane still
    /// holds never names another daemon's terminal.
    pub fn new(first: PaneId) -> Self {
        Self { next: AtomicU32::new(first.max(1)), sessions: Default::default() }
    }

    fn get(&self, id: PaneId) -> Option<Arc<Session>> {
        lock(&self.sessions).get(&id).cloned()
    }

    /// Starts `cmd` in a new PTY with `sub` subscribed. `announce` gets the id before anything
    /// the program prints reaches `sub`.
    pub fn spawn(&self, cmd: CommandBuilder, rows: u16, cols: u16, sub: Subscriber, announce: impl FnOnce(PaneId)) -> Result<PaneId, String> {
        let pair = native_pty_system()
            .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| format!("openpty: {e}"))?;
        let program = cmd.get_argv().first().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
        let cwd = cmd.get_cwd().map(|c| c.to_string_lossy().into_owned()).unwrap_or_default();
        let mut child = pair.slave.spawn_command(cmd).map_err(|e| format!("spawn {program}: {e}"))?;
        drop(pair.slave);
        let (reader, writer) = match (pair.master.try_clone_reader(), pair.master.take_writer()) {
            (Ok(r), Ok(w)) => (r, w),
            (Err(e), _) | (_, Err(e)) => {
                let _ = child.kill();
                return Err(format!("pty: {e}"));
            }
        };

        let id = self.next.fetch_add(1, Ordering::SeqCst);
        let (input, typed) = mpsc::channel::<Vec<u8>>();
        let session = Arc::new(Session {
            pid: child.process_id(),
            cwd,
            master: Mutex::new(pair.master),
            input,
            killer: Mutex::new(child.clone_killer()),
            state: Mutex::new(State { screen: Screen::new(rows, cols), sub: Some(sub), exit: None, killed: false }),
        });
        // Held until announced: the reader waits on it before its first output goes anywhere.
        let held = lock(&session.state);
        lock(&self.sessions).insert(id, Arc::clone(&session));

        let started = thread::Builder::new().name(format!("pty-writer-{id}")).spawn(move || {
            let mut writer = writer;
            for bytes in typed {
                if writer.write_all(&bytes).and_then(|_| writer.flush()).is_err() {
                    break;
                }
            }
        });
        let started = started.and_then(|_| {
            let (session, table) = (Arc::clone(&session), Arc::clone(&self.sessions));
            thread::Builder::new().name(format!("pty-reader-{id}")).spawn(move || pump(id, reader, child, session, table))
        });
        if let Err(e) = started {
            drop(held);
            lock(&self.sessions).remove(&id);
            let _ = lock(&session.killer).kill();
            return Err(format!("thread: {e}"));
        }
        announce(id);
        drop(held);
        Ok(id)
    }

    /// Makes `sub` the one subscriber of `id`, replacing any other. `announce` gets the snapshot
    /// (`Screen::snapshot`) before anything printed after it reaches `sub`. A terminal whose
    /// program ended cannot be attached: the pane starts a new one.
    pub fn attach(&self, id: PaneId, sub: Subscriber, announce: impl FnOnce(&[u8])) -> Result<(), String> {
        let s = self.get(id).ok_or_else(|| format!("pane {id} not found"))?;
        let mut st = lock(&s.state);
        if st.killed || st.exit.is_some() {
            return Err(format!("pane {id} has exited"));
        }
        let snapshot = st.screen.snapshot();
        st.sub = Some(sub);
        announce(&snapshot);
        Ok(())
    }

    pub fn write(&self, id: PaneId, data: &[u8]) -> Result<(), String> {
        let s = self.get(id).ok_or_else(|| format!("pane {id} not found"))?;
        if lock(&s.state).exit.is_some() {
            return Err(format!("pane {id} has exited"));
        }
        s.input.send(data.to_vec()).map_err(|_| format!("pane {id} has exited"))
    }

    pub fn resize(&self, id: PaneId, cols: u16, rows: u16) -> Result<(), String> {
        let s = self.get(id).ok_or_else(|| format!("pane {id} not found"))?;
        lock(&s.master)
            .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| format!("resize: {e}"))?;
        lock(&s.state).screen.resize(rows, cols);
        Ok(())
    }

    /// The pid of the program `id` runs; `None` once it has ended, or for an unknown id.
    pub fn pid(&self, id: PaneId) -> Option<u32> {
        let s = self.get(id)?;
        let alive = lock(&s.state).exit.is_none();
        s.pid.filter(|_| alive)
    }

    /// Idempotent; an unknown id is a no-op. The subscriber still gets `Exit` when the PTY
    /// closes.
    pub fn kill(&self, id: PaneId) {
        let Some(s) = self.get(id) else { return };
        let ended = {
            let mut st = lock(&s.state);
            st.killed = true;
            st.exit.is_some()
        };
        if ended {
            lock(&self.sessions).remove(&id);
        } else {
            let _ = lock(&s.killer).kill();
        }
    }

    pub fn kill_all(&self) {
        let ids: Vec<PaneId> = lock(&self.sessions).keys().copied().collect();
        for id in ids {
            self.kill(id);
        }
    }

    /// Every terminal not killed, by id.
    pub fn list(&self) -> Vec<PtyInfo> {
        let all: Vec<(PaneId, Arc<Session>)> = lock(&self.sessions).iter().map(|(id, s)| (*id, Arc::clone(s))).collect();
        let mut out: Vec<PtyInfo> = all
            .into_iter()
            .filter_map(|(id, s)| {
                let st = lock(&s.state);
                (!st.killed).then(|| PtyInfo {
                    id,
                    cwd: st.screen.cwd().map_or_else(|| s.cwd.clone(), str::to_string),
                    pid: s.pid.unwrap_or(0),
                    alive: st.exit.is_none(),
                })
            })
            .collect();
        out.sort_by_key(|i| i.id);
        out
    }

    /// Terminals whose program still runs, killed or not. The daemon ends when none is left.
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn running(&self) -> usize {
        let all: Vec<Arc<Session>> = lock(&self.sessions).values().cloned().collect();
        all.iter().filter(|s| lock(&s.state).exit.is_none()).count()
    }

    /// Whether anyone gets `id`'s output.
    #[cfg(test)]
    pub fn subscribed(&self, id: PaneId) -> bool {
        self.get(id).is_some_and(|s| lock(&s.state).sub.is_some())
    }

    /// Unsubscribes `owner` from every terminal: its connection closed (server.rs).
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn detach(&self, owner: u64) {
        let all: Vec<Arc<Session>> = lock(&self.sessions).values().cloned().collect();
        for s in all {
            let mut st = lock(&s.state);
            if st.sub.as_ref().is_some_and(|sub| sub.owner == owner) {
                st.sub = None;
            }
        }
    }
}

/// Reads what the program prints into its screen and to its subscriber until the PTY closes,
/// then reports the exit.
fn pump(id: PaneId, mut reader: Box<dyn Read + Send>, mut child: Box<dyn portable_pty::Child + Send + Sync>, session: Arc<Session>, table: Table) {
    let read = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let mut buf = vec![0u8; 64 * 1024];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let mut st = lock(&session.state);
                    st.screen.feed(&buf[..n]);
                    // Sent under the lock: an attach lands wholly before or after this chunk,
                    // so the chunk is in its snapshot or reaches it, never both.
                    let gone = st.sub.as_ref().is_some_and(|sub| !(sub.send)(id, Event::Output(buf[..n].to_vec())));
                    if gone {
                        st.sub = None;
                    }
                }
            }
        }
    }));
    if read.is_err() {
        log::error!("pty reader {id} panicked");
    }
    let code = child.wait().ok().map(|s| s.exit_code() as i32);
    let killed = {
        let mut st = lock(&session.state);
        st.exit = Some(code);
        if let Some(sub) = st.sub.take() {
            (sub.send)(id, Event::Exit(code));
        }
        st.killed
    };
    if killed {
        lock(&table).remove(&id);
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    fn sh(script: &str) -> CommandBuilder {
        let mut cmd = CommandBuilder::new("/bin/sh");
        cmd.args(["-c", script]);
        cmd.cwd("/");
        cmd
    }

    fn recorder(owner: u64) -> (Subscriber, mpsc::Receiver<Event>) {
        let (tx, rx) = mpsc::channel();
        (Subscriber { owner, send: Box::new(move |_, e| tx.send(e).is_ok()) }, rx)
    }

    /// Output until `until` shows up (or the terminal exits), within 5 s.
    fn read_until(rx: &mpsc::Receiver<Event>, until: &str) -> (String, Option<Option<i32>>) {
        let mut out = Vec::new();
        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline {
            match rx.recv_timeout(Duration::from_millis(50)) {
                Ok(Event::Output(b)) => {
                    out.extend(b);
                    if String::from_utf8_lossy(&out).contains(until) {
                        break;
                    }
                }
                Ok(Event::Exit(code)) => return (String::from_utf8_lossy(&out).into_owned(), Some(code)),
                Err(_) => {}
            }
        }
        (String::from_utf8_lossy(&out).into_owned(), None)
    }

    fn wait_for(what: &str, mut f: impl FnMut() -> bool) {
        let deadline = Instant::now() + Duration::from_secs(5);
        while !f() {
            assert!(Instant::now() < deadline, "timed out waiting for {what}");
            thread::sleep(Duration::from_millis(20));
        }
    }

    #[test]
    fn the_id_is_announced_before_any_output_and_ids_start_where_asked() {
        let host = Host::new(500);
        let (sub, rx) = recorder(0);
        let (tx, announced) = mpsc::channel();
        let id = host.spawn(sh("printf hi"), 24, 80, sub, move |id| tx.send(id).unwrap()).unwrap();
        assert_eq!(id, 500);
        assert_eq!(announced.try_recv(), Ok(500), "announced before spawn returned");
        let (out, exit) = read_until(&rx, "never");
        assert!(out.contains("hi"), "{out:?}");
        assert_eq!(exit, Some(Some(0)));
    }

    #[test]
    fn a_second_attach_takes_the_output_and_gets_the_screen_so_far() {
        let host = Host::default();
        let (first, rx1) = recorder(1);
        let id = host.spawn(sh("printf before; read x; printf after:$x; read y"), 24, 80, first, |_| {}).unwrap();
        assert!(read_until(&rx1, "before").0.contains("before"));

        let (second, rx2) = recorder(2);
        let mut snapshot = Vec::new();
        host.attach(id, second, |s| snapshot = s.to_vec()).unwrap();
        assert!(String::from_utf8_lossy(&snapshot).contains("before"), "{:?}", String::from_utf8_lossy(&snapshot));

        host.write(id, b"z\n").unwrap();
        assert!(read_until(&rx2, "after:z").0.contains("after:z"));
        // The first subscriber got nothing after the attach.
        assert!(rx1.try_iter().all(|e| !matches!(e, Event::Output(b) if String::from_utf8_lossy(&b).contains("after"))));
        host.kill(id);
    }

    #[test]
    fn an_ended_terminal_stays_listed_until_killed_and_cannot_be_attached() {
        let host = Host::default();
        let (sub, rx) = recorder(0);
        let id = host.spawn(sh("exit 3"), 24, 80, sub, |_| {}).unwrap();
        assert_eq!(read_until(&rx, "never").1, Some(Some(3)));
        assert_eq!(host.list(), vec![PtyInfo { id, cwd: "/".into(), pid: host.list()[0].pid, alive: false }]);
        assert!(host.list()[0].pid > 0, "an ended terminal keeps the pid it had");
        assert_eq!(host.pid(id), None);
        assert!(host.write(id, b"x").is_err());
        let (again, _) = recorder(1);
        assert!(host.attach(id, again, |_| {}).is_err());
        host.kill(id);
        assert!(host.list().is_empty());
        assert!(lock(&host.sessions).is_empty(), "forgotten, not just hidden");
        host.kill(id);
    }

    #[test]
    fn a_killed_terminal_is_forgotten_once_its_program_is_gone() {
        let host = Host::default();
        let (sub, rx) = recorder(0);
        let id = host.spawn(sh("sleep 30"), 24, 80, sub, |_| {}).unwrap();
        assert!(host.pid(id).is_some());
        assert_eq!(host.running(), 1);
        host.kill(id);
        assert!(host.list().is_empty(), "killed is not listed even before it is gone");
        assert!(read_until(&rx, "never").1.is_some(), "the subscriber still hears the exit");
        wait_for("the table to forget it", || lock(&host.sessions).is_empty());
        assert_eq!(host.running(), 0);
    }

    #[test]
    fn a_dropped_subscriber_is_forgotten_and_the_screen_keeps_filling() {
        let host = Host::default();
        let (tx, rx) = mpsc::channel::<Event>();
        drop(rx);
        let sub = Subscriber { owner: 0, send: Box::new(move |_, e| tx.send(e).is_ok()) };
        let id = host.spawn(sh("printf gone-by; read x"), 24, 80, sub, |_| {}).unwrap();
        wait_for("the output", || {
            let s = host.get(id).unwrap();
            let st = lock(&s.state);
            st.sub.is_none()
        });
        let (sub, _rx) = recorder(1);
        let mut snap = Vec::new();
        host.attach(id, sub, |s| snap = s.to_vec()).unwrap();
        assert!(String::from_utf8_lossy(&snap).contains("gone-by"));
        host.kill(id);
    }

    #[test]
    fn detach_unsubscribes_only_that_owner_and_the_folder_follows_osc7() {
        let host = Host::default();
        let (a, _ra) = recorder(1);
        let (b, _rb) = recorder(2);
        let x = host.spawn(sh("printf '\\033]7;file://h/tmp/some%%20where\\007'; read x"), 24, 80, a, |_| {}).unwrap();
        let y = host.spawn(sh("read x"), 24, 80, b, |_| {}).unwrap();
        wait_for("OSC 7", || host.list().iter().any(|i| i.id == x && i.cwd == "/tmp/some where"));
        host.detach(1);
        assert!(!host.subscribed(x) && host.subscribed(y));
        assert_eq!(host.list().iter().find(|i| i.id == y).unwrap().cwd, "/");
        host.kill_all();
        wait_for("all gone", || host.running() == 0);
    }

    #[test]
    fn resize_reaches_the_program_and_the_snapshot() {
        let host = Host::default();
        let (sub, rx) = recorder(0);
        let id = host.spawn(sh("read x; stty size"), 24, 80, sub, |_| {}).unwrap();
        host.resize(id, 100, 30).unwrap();
        let (sub2, rx2) = recorder(1);
        let mut snap = Vec::new();
        host.attach(id, sub2, |s| snap = s.to_vec()).unwrap();
        assert!(snap.starts_with(b"\x1b[8;30;100t"));
        host.write(id, b"\n").unwrap();
        assert!(read_until(&rx2, "30 100").0.contains("30 100"));
        drop(rx);
        assert!(host.resize(999, 1, 1).is_err());
    }
}

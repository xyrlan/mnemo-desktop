//! The app's side of `ptyd.sock` (`wire.rs`): one connection to the daemon, starting the daemon
//! when none answers, and replacing one of another version. A reader thread hands each
//! terminal's output to its sink in the order the daemon sent it; a request waits for its reply.

use super::wire::{frame, read_frame, Event, Message, Op, PaneId, Request, VERSION};
use super::Sink;
use serde_json::Value;
use std::collections::HashMap;
use std::io::{BufReader, Write};
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Arc, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};

/// A daemon that takes longer than this to answer is taken for stuck.
const ANSWER: Duration = Duration::from_secs(10);
/// How long a daemon just started has to take its socket.
const START: Duration = Duration::from_secs(5);

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

type Answer = Result<(Value, Vec<u8>), String>;

#[derive(Default)]
struct Book {
    next_req: u64,
    waiting: HashMap<u64, mpsc::Sender<Answer>>,
    /// Sinks to put in place when a request's reply arrives, keyed by request: the id comes
    /// with the reply of a spawn, and is known up front for an attach.
    install: HashMap<u64, (Option<PaneId>, Arc<Sink>)>,
    sinks: HashMap<PaneId, Arc<Sink>>,
    closed: bool,
}

pub struct Conn {
    out: Mutex<UnixStream>,
    book: Arc<Mutex<Book>>,
}

/// Why a connection could not be used.
pub enum Refused {
    /// Nothing answers on the socket.
    Absent(String),
    /// A daemon of another version answers.
    Version(Conn, u32),
}

impl Conn {
    /// Connects and greets. A daemon of another version is handed back, to be shut down.
    pub fn open(socket: &Path) -> Result<Conn, Refused> {
        let stream = UnixStream::connect(socket).map_err(|e| Refused::Absent(format!("{}: {e}", socket.display())))?;
        let _ = stream.set_write_timeout(Some(ANSWER));
        let input = stream.try_clone().map_err(|e| Refused::Absent(e.to_string()))?;
        let conn = Conn { out: Mutex::new(stream), book: Default::default() };
        let book = Arc::clone(&conn.book);
        thread::Builder::new()
            .name("ptyd-client".into())
            .spawn(move || read_all(input, book))
            .map_err(|e| Refused::Absent(e.to_string()))?;
        let hello = conn.call(Op::Hello { version: VERSION }, &[], None).map_err(Refused::Absent)?;
        match hello.0.get("version").and_then(Value::as_u64) {
            Some(v) if v == u64::from(VERSION) => Ok(conn),
            v => Err(Refused::Version(conn, v.unwrap_or(0) as u32)),
        }
    }

    pub fn is_open(&self) -> bool {
        !lock(&self.book).closed
    }

    /// Sends `op` and waits for its reply: its answer, and its payload. `install` puts a sink in
    /// place for the terminal the reply names, before any output that follows it.
    pub fn call(&self, op: Op, payload: &[u8], install: Option<(Option<PaneId>, Arc<Sink>)>) -> Answer {
        let (tx, rx) = mpsc::channel();
        let req = {
            let mut book = lock(&self.book);
            if book.closed {
                return Err("the terminal daemon went away".into());
            }
            book.next_req += 1;
            let req = book.next_req;
            book.waiting.insert(req, tx);
            if let Some(i) = install {
                book.install.insert(req, i);
            }
            req
        };
        let forget = || {
            let mut book = lock(&self.book);
            book.waiting.remove(&req);
            book.install.remove(&req);
        };
        if let Err(e) = self.send_frame(&Request { req, op }, payload) {
            forget();
            return Err(e);
        }
        match rx.recv_timeout(ANSWER) {
            Ok(answer) => answer,
            Err(_) => {
                forget();
                Err("the terminal daemon did not answer".into())
            }
        }
    }

    /// Sends `op` with no reply to wait for (typing).
    pub fn tell(&self, op: Op, payload: &[u8]) -> Result<(), String> {
        if !self.is_open() {
            return Err("the terminal daemon went away".into());
        }
        self.send_frame(&Request { req: 0, op }, payload)
    }

    fn send_frame(&self, req: &Request, payload: &[u8]) -> Result<(), String> {
        let f = frame(req, payload).map_err(|e| e.to_string())?;
        lock(&self.out).write_all(&f).map_err(|e| format!("terminal daemon: {e}"))
    }
}

impl Drop for Conn {
    /// Leaving is not the daemon going away: the terminals keep running, so no sink hears an
    /// exit. The reader holds its own handle on the socket; shutting it down ends the reader.
    fn drop(&mut self) {
        let sinks = std::mem::take(&mut lock(&self.book).sinks);
        drop(sinks);
        let _ = lock(&self.out).shutdown(std::net::Shutdown::Both);
    }
}

/// Routes every frame the daemon sends until it closes; then every waiting request fails and
/// every terminal ends (the daemon took them with it).
fn read_all(stream: UnixStream, book: Arc<Mutex<Book>>) {
    let mut input = BufReader::new(stream);
    while let Ok(Some((head, payload))) = read_frame(&mut input) {
        let Ok(msg) = serde_json::from_slice::<Message>(&head) else {
            log::warn!("pty daemon: unreadable message");
            continue;
        };
        match msg {
            Message::Reply { req, ok, err } => {
                let mut b = lock(&book);
                let answer = match err {
                    Some(e) => Err(e),
                    None => Ok(ok.unwrap_or(Value::Null)),
                };
                if let (Some((known, sink)), Ok(v)) = (b.install.remove(&req), &answer) {
                    let id = known.or_else(|| v.get("id").and_then(Value::as_u64).map(|id| id as PaneId));
                    if let Some(id) = id {
                        b.sinks.insert(id, sink);
                    }
                }
                if let Some(tx) = b.waiting.remove(&req) {
                    let _ = tx.send(answer.map(|v| (v, payload)));
                }
            }
            Message::Output { id } => {
                let sink = lock(&book).sinks.get(&id).cloned();
                if let Some(sink) = sink {
                    sink(Event::Output(payload));
                }
            }
            Message::Exit { id, code } => {
                let sink = lock(&book).sinks.remove(&id);
                if let Some(sink) = sink {
                    sink(Event::Exit(code));
                }
            }
        }
    }
    let sinks: Vec<Arc<Sink>> = {
        let mut b = lock(&book);
        b.closed = true;
        for (_, tx) in b.waiting.drain() {
            let _ = tx.send(Err("the terminal daemon went away".into()));
        }
        b.install.clear();
        b.sinks.drain().map(|(_, s)| s).collect()
    };
    for sink in sinks {
        sink(Event::Exit(None));
    }
}

/// The daemon at `socket`, started from `bin` when none answers there.
pub struct Remote {
    socket: PathBuf,
    bin: PathBuf,
    conn: Mutex<Option<Arc<Conn>>>,
}

impl Remote {
    pub fn new(socket: PathBuf, bin: PathBuf) -> Self {
        Self { socket, bin, conn: Mutex::new(None) }
    }

    /// The open connection, else a new one: to the daemon that answers, or to one started now.
    pub fn conn(&self) -> Result<Arc<Conn>, String> {
        let mut slot = lock(&self.conn);
        if let Some(c) = slot.as_ref().filter(|c| c.is_open()) {
            return Ok(Arc::clone(c));
        }
        let conn = Arc::new(self.connect()?);
        *slot = Some(Arc::clone(&conn));
        Ok(conn)
    }

    fn connect(&self) -> Result<Conn, String> {
        match Conn::open(&self.socket) {
            Ok(c) => return Ok(c),
            Err(Refused::Version(old, v)) => {
                // Its terminals are lost either way: this app cannot speak to it.
                log::warn!("pty daemon speaks version {v}, not {VERSION}: replacing it");
                let _ = old.tell(Op::Shutdown, &[]);
                let deadline = Instant::now() + START;
                while UnixStream::connect(&self.socket).is_ok() && Instant::now() < deadline {
                    thread::sleep(Duration::from_millis(20));
                }
            }
            Err(Refused::Absent(_)) => {}
        }
        start(&self.bin, &self.socket)?;
        let deadline = Instant::now() + START;
        loop {
            match Conn::open(&self.socket) {
                Ok(c) => return Ok(c),
                Err(Refused::Version(_, v)) => return Err(format!("the terminal daemon speaks version {v}, not {VERSION}")),
                Err(Refused::Absent(e)) if Instant::now() >= deadline => return Err(format!("the terminal daemon did not start: {e}")),
                Err(Refused::Absent(_)) => thread::sleep(Duration::from_millis(20)),
            }
        }
    }
}

/// Starts the daemon, detached: it leaves the app's session itself, and outlives the app.
/// What it logs goes to `ptyd.log` beside its socket.
fn start(bin: &Path, socket: &Path) -> Result<(), String> {
    use std::process::Stdio;
    let log = std::fs::File::create(socket.with_file_name("ptyd.log")).map_or_else(|_| Stdio::null(), Stdio::from);
    let mut child = crate::proc::command(bin)
        .arg("--socket")
        .arg(socket)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(log)
        .spawn()
        .map_err(|e| format!("start {}: {e}", bin.display()))?;
    // Reaped if it ends while the app runs, rather than left a zombie.
    let _ = thread::Builder::new().name("ptyd-reaper".into()).spawn(move || child.wait());
    Ok(())
}

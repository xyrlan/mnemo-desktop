//! The daemon's side of `ptyd.sock` (`wire.rs`): one thread per connected app reading its
//! requests, one writing what the host sends it. An app that goes away leaves its terminals
//! running and unsubscribed; the next one attaches to them.
//!
//! Shared by the daemon binary, which includes this file by path, and the app's tests: it names
//! nothing outside `std` and its crates.

use super::host::{Host, Subscriber};
use super::wire::{frame, read_frame, Event, Message, Op, Request, VERSION};
use portable_pty::CommandBuilder;
use serde_json::{json, Value};
use std::ffi::OsString;
use std::io::{BufReader, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::Instant;

pub struct Server {
    pub host: Arc<Host>,
    next_owner: AtomicU64,
    clients: AtomicUsize,
    /// When a client last came or went.
    changed: Mutex<Instant>,
    /// What `Shutdown` does once every terminal is killed: the daemon exits.
    on_shutdown: Box<dyn Fn() + Send + Sync>,
}

impl Server {
    pub fn new(host: Arc<Host>, on_shutdown: impl Fn() + Send + Sync + 'static) -> Arc<Self> {
        Arc::new(Self {
            host,
            next_owner: AtomicU64::new(1),
            clients: AtomicUsize::new(0),
            changed: Mutex::new(Instant::now()),
            on_shutdown: Box::new(on_shutdown),
        })
    }

    pub fn clients(&self) -> usize {
        self.clients.load(Ordering::SeqCst)
    }

    /// How long no client has come or gone.
    pub fn quiet_for(&self) -> std::time::Duration {
        self.changed.lock().unwrap_or_else(|e| e.into_inner()).elapsed()
    }

    fn touch(&self) {
        *self.changed.lock().unwrap_or_else(|e| e.into_inner()) = Instant::now();
    }

    pub fn accept(self: &Arc<Self>, listener: UnixListener) {
        for stream in listener.incoming() {
            match stream {
                Ok(s) => {
                    let me = Arc::clone(self);
                    // Counted before the thread starts, so the idle check never sees a
                    // connection that is still starting as none.
                    me.clients.fetch_add(1, Ordering::SeqCst);
                    me.touch();
                    if let Err(e) = thread::Builder::new().name("ptyd-conn".into()).spawn(move || me.serve(s)) {
                        log::warn!("ptyd: cannot serve a connection: {e}");
                        self.clients.fetch_sub(1, Ordering::SeqCst);
                    }
                }
                Err(e) => log::warn!("ptyd: accept: {e}"),
            }
        }
    }

    fn serve(self: Arc<Self>, stream: UnixStream) {
        let owner = self.next_owner.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = mpsc::channel::<Vec<u8>>();
        if let Ok(mut out) = stream.try_clone() {
            let _ = thread::Builder::new().name("ptyd-out".into()).spawn(move || {
                for f in rx {
                    if out.write_all(&f).is_err() {
                        let _ = out.shutdown(std::net::Shutdown::Both);
                        break;
                    }
                }
            });
            let mut input = BufReader::new(stream);
            while let Ok(Some((head, payload))) = read_frame(&mut input) {
                match serde_json::from_slice::<Request>(&head) {
                    Ok(req) => self.handle(owner, &tx, req, payload),
                    Err(e) => {
                        log::warn!("ptyd: bad request, closing: {e}");
                        break;
                    }
                }
            }
        }
        self.host.detach(owner);
        self.clients.fetch_sub(1, Ordering::SeqCst);
        self.touch();
    }

    fn handle(&self, owner: u64, tx: &mpsc::Sender<Vec<u8>>, Request { req, op }: Request, payload: Vec<u8>) {
        let send = |msg: &Message, payload: &[u8]| {
            if let Ok(f) = frame(msg, payload) {
                let _ = tx.send(f);
            }
        };
        let reply = |result: Result<Value, String>| send(&Message::reply(req, result), &[]);
        match op {
            Op::Hello { .. } => reply(Ok(json!({ "version": VERSION, "pid": std::process::id() }))),
            Op::Spawn { spec } => {
                let mut cmd = CommandBuilder::from_argv(spec.argv.iter().map(OsString::from).collect());
                cmd.env_clear();
                for (k, v) in &spec.env {
                    cmd.env(k, v);
                }
                if let Some(cwd) = &spec.cwd {
                    cmd.cwd(cwd);
                }
                let r = self.host.spawn(cmd, spec.rows, spec.cols, subscriber(owner, tx.clone()), |id| reply(Ok(json!({ "id": id }))));
                if let Err(e) = r {
                    reply(Err(e));
                }
            }
            Op::Attach { id } => {
                let r = self.host.attach(id, subscriber(owner, tx.clone()), |snapshot| send(&Message::reply(req, Ok(Value::Null)), snapshot));
                if let Err(e) = r {
                    reply(Err(e));
                }
            }
            Op::Write { id } => {
                let _ = self.host.write(id, &payload);
            }
            Op::Resize { id, cols, rows } => reply(self.host.resize(id, cols, rows).map(|_| Value::Null)),
            Op::Kill { id } => {
                self.host.kill(id);
                reply(Ok(Value::Null));
            }
            Op::List => reply(serde_json::to_value(self.host.list()).map_err(|e| e.to_string())),
            Op::Shutdown => {
                log::info!("ptyd: shutdown asked for");
                self.host.kill_all();
                reply(Ok(Value::Null));
                (self.on_shutdown)();
            }
        }
    }
}

/// Output of a terminal as frames on this connection's queue.
fn subscriber(owner: u64, tx: mpsc::Sender<Vec<u8>>) -> Subscriber {
    Subscriber {
        owner,
        send: Box::new(move |id, e| {
            let f = match e {
                Event::Output(bytes) => frame(&Message::Output { id }, &bytes),
                Event::Exit(code) => frame(&Message::Exit { id, code }, &[]),
            };
            f.map_or(true, |f| tx.send(f).is_ok())
        }),
    }
}

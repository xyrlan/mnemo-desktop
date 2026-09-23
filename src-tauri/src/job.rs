//! A process run headless for an action the user already confirmed (the cockpit's `merge` and
//! `land`), its output streamed to the front line by line instead of into a terminal pane.
//!
//! `argv` is a list and is never handed to a shell: the caller builds `["gh", "pr", "merge", …]`
//! and there is nothing to quote. Every line of stdout and stderr is emitted as `job-line`, and
//! `job-exit` once when the process is gone. The two streams are read by two threads, so their
//! interleaving is whatever the scheduler made it; nothing here claims an order between them.
//!
//! One job per id: a second `job_run` while the first is alive is refused, never queued — a
//! double-fired merge is the thing the front's armed confirmation exists to prevent.

use std::collections::HashSet;
use std::io::{BufRead, BufReader, Read};
use std::process::Stdio;
use std::sync::{Arc, Mutex, OnceLock};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::mission::login_path;

pub const LINE_EVENT: &str = "job-line";
pub const EXIT_EVENT: &str = "job-exit";

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct JobLine {
    pub id: String,
    /// `out` or `err`.
    pub stream: &'static str,
    pub line: String,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct JobExit {
    pub id: String,
    /// The exit status; `None` when a signal ended the process and there is none.
    pub code: Option<i32>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum JobEvent {
    Line(JobLine),
    Exit(JobExit),
}

fn live() -> &'static Mutex<HashSet<String>> {
    static LIVE: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    LIVE.get_or_init(Default::default)
}

/// Reads `from` to its end, one event per line. Bytes that are not UTF-8 are replaced, not
/// dropped, and a last line without a newline still counts.
fn pump(id: String, stream: &'static str, from: impl Read, sink: Arc<dyn Fn(JobEvent) + Send + Sync>) {
    let mut reader = BufReader::new(from);
    let mut buf = Vec::new();
    loop {
        buf.clear();
        match reader.read_until(b'\n', &mut buf) {
            Ok(0) | Err(_) => return,
            Ok(_) => {
                let text = String::from_utf8_lossy(&buf);
                let line = text.trim_end_matches(['\n', '\r']).to_string();
                sink(JobEvent::Line(JobLine { id: id.clone(), stream, line }));
            }
        }
    }
}

/// Starts `argv` in `cwd` and returns once it is running; `sink` hears every line and then the
/// exit, from background threads. Refused: an empty `argv`, an id already running, and a
/// program that cannot be started (the error says which) — those emit nothing.
pub fn run(id: &str, cwd: &str, argv: &[String], sink: Arc<dyn Fn(JobEvent) + Send + Sync>) -> Result<(), String> {
    let (program, args) = argv.split_first().ok_or("job: empty argv")?;
    if !live().lock().unwrap().insert(id.to_string()) {
        return Err(format!("job {id} is already running"));
    }
    let spawned = crate::proc::command(program)
        .args(args)
        .current_dir(cwd)
        // Apps started from Finder or the Dock get a bare PATH, without Homebrew's `gh` or `mnemo`.
        .env("PATH", login_path())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn();
    let mut child = match spawned {
        Ok(c) => c,
        Err(e) => {
            live().lock().unwrap().remove(id);
            return Err(if e.kind() == std::io::ErrorKind::NotFound { format!("{program} not found in PATH") } else { format!("{program}: {e}") });
        }
    };
    let readers = [
        child.stdout.take().map(|o| {
            let (id, sink) = (id.to_string(), sink.clone());
            std::thread::spawn(move || pump(id, "out", o, sink))
        }),
        child.stderr.take().map(|e| {
            let (id, sink) = (id.to_string(), sink.clone());
            std::thread::spawn(move || pump(id, "err", e, sink))
        }),
    ];
    let id = id.to_string();
    std::thread::spawn(move || {
        // Every line before the exit: the readers end when the pipes close, which is when the
        // process (and anything it left holding them) is done writing.
        for r in readers.into_iter().flatten() {
            let _ = r.join();
        }
        let code = child.wait().ok().and_then(|s| s.code());
        // Free the id before saying so, so a retry fired on `job-exit` is not refused.
        live().lock().unwrap().remove(&id);
        sink(JobEvent::Exit(JobExit { id, code }));
    });
    Ok(())
}

/// Runs `argv` in `cwd` headless and streams it as `job-line` / `job-exit` events for `id`.
#[tauri::command]
pub fn job_run(app: AppHandle, id: String, cwd: String, argv: Vec<String>) -> Result<(), String> {
    run(
        &id,
        &cwd,
        &argv,
        Arc::new(move |e| {
            let _ = match e {
                JobEvent::Line(l) => app.emit(LINE_EVENT, l),
                JobEvent::Exit(x) => app.emit(EXIT_EVENT, x),
            };
        }),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;

    fn argv(a: &[&str]) -> Vec<String> {
        a.iter().map(|s| s.to_string()).collect()
    }

    /// Runs to the exit and returns every event, in the order the sink heard them.
    fn collect(id: &str, a: &[&str]) -> Vec<JobEvent> {
        let (tx, rx) = mpsc::channel();
        let tx = Mutex::new(tx);
        run(id, "/", &argv(a), Arc::new(move |e| tx.lock().unwrap().send(e).unwrap())).unwrap();
        let mut out = Vec::new();
        loop {
            let e = rx.recv_timeout(Duration::from_secs(10)).expect("the job ends");
            let done = matches!(e, JobEvent::Exit(_));
            out.push(e);
            if done {
                return out;
            }
        }
    }

    fn lines(events: &[JobEvent], stream: &str) -> Vec<String> {
        events
            .iter()
            .filter_map(|e| match e {
                JobEvent::Line(l) if l.stream == stream => Some(l.line.clone()),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn both_streams_are_read_and_the_exit_comes_last_with_its_code() {
        // `sh` is the program here, not a wrapper: argv goes to it as a list like any other.
        let e = collect("t-both", &["sh", "-c", "echo one; echo two >&2; printf 'three'; exit 3"]);
        assert_eq!(lines(&e, "out"), ["one", "three"]);
        assert_eq!(lines(&e, "err"), ["two"]);
        assert_eq!(e.last(), Some(&JobEvent::Exit(JobExit { id: "t-both".into(), code: Some(3) })));
        assert_eq!(e.iter().filter(|e| matches!(e, JobEvent::Exit(_))).count(), 1);
    }

    #[test]
    fn argv_is_never_a_shell_string() {
        // A shell would expand `$HOME` and split on the space; a list passes the word through.
        let e = collect("t-argv", &["echo", "$HOME a;b"]);
        assert_eq!(lines(&e, "out"), ["$HOME a;b"]);
    }

    #[test]
    fn a_live_id_is_refused_and_freed_once_it_exits() {
        let (tx, rx) = mpsc::channel();
        let tx = Mutex::new(tx);
        let sink: Arc<dyn Fn(JobEvent) + Send + Sync> = Arc::new(move |e| {
            if matches!(e, JobEvent::Exit(_)) {
                tx.lock().unwrap().send(()).unwrap();
            }
        });
        run("t-live", "/", &argv(&["sleep", "0.3"]), sink.clone()).unwrap();
        let again = run("t-live", "/", &argv(&["true"]), sink.clone());
        assert_eq!(again, Err("job t-live is already running".into()));
        rx.recv_timeout(Duration::from_secs(10)).unwrap();
        // Only the first one ran: one exit, and the id takes a new job now.
        assert!(rx.recv_timeout(Duration::from_millis(200)).is_err());
        run("t-live", "/", &argv(&["true"]), sink).unwrap();
        rx.recv_timeout(Duration::from_secs(10)).unwrap();
    }

    #[test]
    fn a_program_that_does_not_start_is_an_error_and_holds_no_id() {
        let sink: Arc<dyn Fn(JobEvent) + Send + Sync> = Arc::new(|_| panic!("nothing is emitted"));
        assert_eq!(run("t-missing", "/", &argv(&["mnemo-no-such-program"]), sink.clone()), Err("mnemo-no-such-program not found in PATH".into()));
        assert!(!live().lock().unwrap().contains("t-missing"));
        assert_eq!(run("t-empty", "/", &[], sink), Err("job: empty argv".into()));
    }
}

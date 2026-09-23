//! The conversation face's tailer (round 20): streams a Claude Code transcript
//! (`~/.claude/projects/<escaped cwd>/<session>.jsonl`, found with `mission::transcript_path`) to the
//! front-end as raw lines. It never parses a record: the shape belongs to `src/conversation/parse.ts`,
//! so a Claude Code format change is fixed in one TypeScript module.
//!
//! Each follow is one thread, kept in a static registry here (no `.manage`): it sends the tail, then
//! wakes on a `notify` watch of the transcript's directory or a 1 s fallback poll and sends the
//! complete lines past its offset. It ends on `conversation_unfollow` or when a send fails, and its
//! watch goes with it. Contract: docs/contracts/round20.md.

use serde::Serialize;
use std::collections::HashMap;
use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};
use std::thread::JoinHandle;
use std::time::Duration;
use tauri::ipc::Channel;

/// One message on a follow's Channel; mirrors `FollowEvent` in `src/conversation/types.ts`.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum FollowEvent {
    /// Complete lines (no trailing newline) spanning bytes `start..end` of the file.
    Lines { start: u64, end: u64, lines: Vec<String> },
    /// The file shrank or was replaced: the front-end drops what it has; lines restart at 0.
    Reset,
    /// No transcript for this session yet; the follow keeps looking.
    Missing,
}

/// Earlier lines for "load earlier"; mirrors `Chunk` in `src/conversation/types.ts`.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Chunk {
    pub start: u64,
    pub end: u64,
    pub lines: Vec<String>,
}

/// How often a follow looks again when nothing woke it: the missing file, and the fallback for a
/// watch that coalesced or missed a write (FSEvents coalesces; Windows differs).
const POLL: Duration = Duration::from_secs(1);
/// Lines landing this close together travel in one event.
const BATCH: Duration = Duration::from_millis(50);
/// The most one event (or one `Chunk`) carries: a burst is split, a tail is cut short. A single
/// line longer than this still goes, alone.
const MAX_EVENT: u64 = 4 << 20;
/// Backward scans read this much at a time.
const BLOCK: u64 = 64 << 10;

/// Starts following `session_id`'s transcript: the last `tail` complete lines first, then each
/// line appended. Returns the follow's id for `conversation_unfollow`.
///
/// The first `Lines` holds at most ~4 MB, so it can hold fewer than `tail` lines (inline images);
/// its `start` says where `conversation_earlier` picks up. After a `Reset` lines restart at 0. A
/// transcript that goes away sends `Reset` then `Missing`, and the follow looks for it again.
#[tauri::command(async)]
pub fn conversation_follow(session_id: String, cwd: String, tail: usize, on_event: Channel<FollowEvent>) -> Result<u32, String> {
    check_session_id(&session_id)?;
    start(move || crate::mission::transcript_path(&cwd, &session_id), tail, move |e| on_event.send(e).is_ok())
}

/// Stops a follow; an unknown id is ignored.
#[tauri::command]
pub fn conversation_unfollow(id: u32) {
    // Its thread ends at its next wake, which `stop` sends; nothing waits for it here.
    drop(stop(id));
}

/// The `count` complete lines that end right before byte `before`.
///
/// `before` is a line boundary the front-end got from a `Lines` or a `Chunk`; one that is not is
/// taken back to the boundary under it. Holds at most ~4 MB (always at least one line), so it can
/// hold fewer than `count`: `start == 0` alone means the top of the file.
#[tauri::command(async)]
pub fn conversation_earlier(session_id: String, cwd: String, before: u64, count: usize) -> Result<Chunk, String> {
    check_session_id(&session_id)?;
    let path = crate::mission::transcript_path(&cwd, &session_id).ok_or_else(|| format!("conversation: no transcript for session {session_id}"))?;
    earlier(&path, before, count).map_err(|e| format!("conversation: {}: {e}", path.display()))
}

/// A session id names a file under `~/.claude/projects`; one that could climb out of it is refused.
fn check_session_id(id: &str) -> Result<(), String> {
    if !id.is_empty() && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') {
        Ok(())
    } else {
        Err(format!("conversation: not a session id: {id:?}"))
    }
}

fn earlier(path: &Path, before: u64, count: usize) -> io::Result<Chunk> {
    let mut f = File::open(path)?;
    let len = f.metadata()?.len();
    let end = boundary_before(&mut f, before.min(len))?;
    let start = start_of_lines(&mut f, end, count)?;
    let lines = split_lines(&read_range(&mut f, start, end)?);
    Ok(Chunk { start, end, lines })
}

// -- the registry --

/// A running follow: its thread ends once `stop` is set and `wake` reaches it.
struct Follow {
    stop: Arc<AtomicBool>,
    wake: Sender<()>,
    thread: Option<JoinHandle<()>>,
}

fn follows() -> MutexGuard<'static, HashMap<u32, Follow>> {
    static FOLLOWS: OnceLock<Mutex<HashMap<u32, Follow>>> = OnceLock::new();
    FOLLOWS.get_or_init(Default::default).lock().unwrap_or_else(|e| e.into_inner())
}

/// Spawns a follow of the file `find` returns (it is asked again while there is none), sending
/// each event to `sink`; a `false` from `sink` (the webview is gone) ends the follow.
fn start<F, S>(find: F, tail: usize, sink: S) -> Result<u32, String>
where
    F: FnMut() -> Option<PathBuf> + Send + 'static,
    S: FnMut(FollowEvent) -> bool + Send + 'static,
{
    static NEXT: AtomicU32 = AtomicU32::new(1);
    let id = NEXT.fetch_add(1, Ordering::Relaxed);
    let stop = Arc::new(AtomicBool::new(false));
    let (wake, woken) = mpsc::channel();
    let tailer = Tailer { find, sink, tail, stop: stop.clone(), wake: wake.clone(), woken };
    // Held across the spawn, so a follow that ends at once removes an entry that is already there.
    let mut all = follows();
    let thread = std::thread::Builder::new()
        .name(format!("conversation-{id}"))
        .spawn(move || {
            tailer.run();
            follows().remove(&id);
        })
        .map_err(|e| format!("conversation: cannot start a follow: {e}"))?;
    all.insert(id, Follow { stop, wake, thread: Some(thread) });
    Ok(id)
}

/// Ends follow `id`, returning its thread (already ending) for a caller that wants to wait.
fn stop(id: u32) -> Option<JoinHandle<()>> {
    let mut f = follows().remove(&id)?;
    f.stop.store(true, Ordering::SeqCst);
    let _ = f.wake.send(());
    f.thread.take()
}

// -- one follow --

struct Tailer<F, S> {
    find: F,
    sink: S,
    tail: usize,
    stop: Arc<AtomicBool>,
    /// Handed to the watch; also keeps `woken` from ever disconnecting.
    wake: Sender<()>,
    woken: Receiver<()>,
}

/// Where a follow is in its file: the end of the last complete line sent, and which file that was.
#[derive(Default)]
struct Cursor {
    offset: u64,
    file: Option<FileId>,
}

/// What a read of the file asks the follow to do next.
enum Flow {
    Go,
    /// Stopped, or the sink failed.
    Stop,
    /// The file is not there any more.
    Gone,
}

impl<F, S> Tailer<F, S>
where
    F: FnMut() -> Option<PathBuf>,
    S: FnMut(FollowEvent) -> bool,
{
    fn run(mut self) {
        loop {
            let Some(path) = self.look() else { return };
            // Watched before the first read, so a line written in between still wakes us.
            let _watch = watch(&path, self.wake.clone());
            let mut cursor = Cursor::default();
            let mut flow = self.first(&path, &mut cursor);
            loop {
                match flow {
                    Flow::Go => {}
                    Flow::Stop => return,
                    Flow::Gone => break,
                }
                if !self.wait_for_lines() {
                    return;
                }
                flow = self.catch_up(&path, &mut cursor);
            }
            if !self.send(FollowEvent::Reset) {
                return;
            }
        }
    }

    fn stopped(&self) -> bool {
        self.stop.load(Ordering::SeqCst)
    }

    fn send(&mut self, e: FollowEvent) -> bool {
        !self.stopped() && (self.sink)(e)
    }

    /// The transcript's path once it exists, saying `Missing` once while it does not. `None`: stop.
    fn look(&mut self) -> Option<PathBuf> {
        let mut said = false;
        loop {
            if self.stopped() {
                return None;
            }
            if let Some(p) = (self.find)() {
                return Some(p);
            }
            if !said && !self.send(FollowEvent::Missing) {
                return None;
            }
            said = true;
            let _ = self.woken.recv_timeout(POLL);
        }
    }

    /// Waits for a wake (or the fallback poll), then lets a burst land. `false`: stopped.
    fn wait_for_lines(&self) -> bool {
        if self.woken.recv_timeout(POLL).is_ok() && !self.stopped() {
            std::thread::sleep(BATCH);
            while self.woken.try_recv().is_ok() {}
        }
        !self.stopped()
    }

    /// The first send: the last `tail` complete lines, as one event.
    fn first(&mut self, path: &Path, cursor: &mut Cursor) -> Flow {
        let read = (|| {
            let mut f = File::open(path)?;
            let meta = f.metadata()?;
            let end = boundary_before(&mut f, meta.len())?;
            let start = start_of_lines(&mut f, end, self.tail)?;
            let lines = split_lines(&read_range(&mut f, start, end)?);
            Ok::<_, io::Error>((file_id(&meta), start, end, lines))
        })();
        match read {
            Ok((file, start, end, lines)) => {
                *cursor = Cursor { offset: end, file };
                if self.send(FollowEvent::Lines { start, end, lines }) {
                    Flow::Go
                } else {
                    Flow::Stop
                }
            }
            Err(e) => self.failed(e, path),
        }
    }

    /// Sends every complete line past the cursor, after a `Reset` when the file shrank or was
    /// replaced.
    fn catch_up(&mut self, path: &Path, cursor: &mut Cursor) -> Flow {
        let read = (|| {
            let mut f = File::open(path)?;
            let meta = f.metadata()?;
            let len = meta.len();
            let file = file_id(&meta);
            let replaced = cursor.file.is_some() && file != cursor.file;
            // Rewritten in place past our offset: the byte before it is no longer a newline.
            let rewritten = cursor.offset > 0 && len >= cursor.offset && read_range(&mut f, cursor.offset - 1, cursor.offset)? != b"\n";
            if replaced || len < cursor.offset || rewritten {
                if !self.send(FollowEvent::Reset) {
                    return Ok(Flow::Stop);
                }
                cursor.offset = 0;
            }
            cursor.file = file;
            self.forward(&mut f, cursor, len)
        })();
        read.unwrap_or_else(|e| self.failed(e, path))
    }

    /// Sends the complete lines in `cursor.offset..len`, ~4 MB an event at most.
    fn forward(&mut self, f: &mut File, cursor: &mut Cursor, len: u64) -> io::Result<Flow> {
        while cursor.offset < len {
            let mut buf = Vec::new();
            let mut to = cursor.offset;
            let cut = loop {
                let next = len.min(to + MAX_EVENT);
                if next == to {
                    // Only a partial line is left: it waits for its newline.
                    return Ok(Flow::Go);
                }
                buf.extend_from_slice(&read_range(f, to, next)?);
                to = next;
                if let Some(i) = buf.iter().rposition(|&b| b == b'\n') {
                    break i + 1;
                }
            };
            let start = cursor.offset;
            let end = start + cut as u64;
            if !self.send(FollowEvent::Lines { start, end, lines: split_lines(&buf[..cut]) }) {
                return Ok(Flow::Stop);
            }
            cursor.offset = end;
        }
        Ok(Flow::Go)
    }

    /// A read failed: a missing file ends this watch; anything else is tried again next wake.
    fn failed(&self, e: io::Error, path: &Path) -> Flow {
        if e.kind() == io::ErrorKind::NotFound {
            Flow::Gone
        } else {
            log::debug!("conversation: {}: {e}", path.display());
            Flow::Go
        }
    }
}

/// Wakes the follow when something happens to `path` in its directory. `None` (no watch) leaves the
/// fallback poll alone to find new lines.
fn watch(path: &Path, wake: Sender<()>) -> Option<notify::RecommendedWatcher> {
    use notify::event::{AccessKind, AccessMode, EventKind};
    use notify::Watcher;
    let name = path.file_name()?.to_owned();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let ours = match &res {
            // Our own opens and reads are not news; a close after writing is.
            Ok(ev) if matches!(ev.kind, EventKind::Access(a) if a != AccessKind::Close(AccessMode::Write)) => false,
            Ok(ev) => ev.paths.is_empty() || ev.paths.iter().any(|p| p.file_name() == Some(name.as_os_str())),
            Err(_) => true,
        };
        if ours {
            let _ = wake.send(());
        }
    })
    .ok()?;
    watcher.watch(path.parent()?, notify::RecursiveMode::NonRecursive).ok()?;
    Some(watcher)
}

// -- reading lines --

/// Which file a path pointed at, to notice it being replaced.
type FileId = (u64, u64);

#[cfg(unix)]
fn file_id(meta: &std::fs::Metadata) -> Option<FileId> {
    use std::os::unix::fs::MetadataExt;
    Some((meta.dev(), meta.ino()))
}

#[cfg(not(unix))]
fn file_id(meta: &std::fs::Metadata) -> Option<FileId> {
    let born = meta.created().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?;
    Some((born.as_secs(), born.subsec_nanos().into()))
}

fn read_range(f: &mut File, from: u64, to: u64) -> io::Result<Vec<u8>> {
    let mut buf = vec![0; (to - from) as usize];
    f.seek(SeekFrom::Start(from))?;
    f.read_exact(&mut buf)?;
    Ok(buf)
}

/// The end of the last complete line at or before `pos` (0 when there is none).
fn boundary_before(f: &mut File, pos: u64) -> io::Result<u64> {
    let mut to = pos;
    while to > 0 {
        let from = to.saturating_sub(BLOCK);
        if let Some(i) = read_range(f, from, to)?.iter().rposition(|&b| b == b'\n') {
            return Ok(from + i as u64 + 1);
        }
        to = from;
    }
    Ok(0)
}

/// Where the last `count` complete lines ending at `end` (a line boundary) start, reading back
/// from `end` in blocks. Stops early rather than take more than `MAX_EVENT` bytes, but never with
/// fewer than one line.
fn start_of_lines(f: &mut File, end: u64, count: usize) -> io::Result<u64> {
    if count == 0 || end == 0 {
        return Ok(end);
    }
    let mut start = end;
    let mut found = 0;
    // `end - 1` is the last line's own newline.
    let mut to = end - 1;
    while to > 0 {
        let from = to.saturating_sub(BLOCK);
        let block = read_range(f, from, to)?;
        for i in (0..block.len()).rev() {
            if block[i] != b'\n' {
                continue;
            }
            let line_start = from + i as u64 + 1;
            if found > 0 && end - line_start > MAX_EVENT {
                return Ok(start);
            }
            found += 1;
            start = line_start;
            if found == count {
                return Ok(start);
            }
        }
        to = from;
    }
    // The first line of the file is the one more line.
    Ok(if found > 0 && end > MAX_EVENT { start } else { 0 })
}

/// Complete lines (`bytes` ends with a newline, or is empty), without their `\n` or `\r\n`.
fn split_lines(bytes: &[u8]) -> Vec<String> {
    let Some(body) = bytes.strip_suffix(b"\n") else { return Vec::new() };
    body.split(|&b| b == b'\n').map(|l| String::from_utf8_lossy(l.strip_suffix(b"\r").unwrap_or(l)).into_owned()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::temp_dir;
    use std::io::Write;
    use std::time::Instant;

    const WAIT: Duration = Duration::from_secs(5);

    #[test]
    fn follow_event_serialises_as_the_front_end_reads_it() {
        let lines = serde_json::to_value(FollowEvent::Lines { start: 0, end: 3, lines: vec!["{}".into()] }).unwrap();
        assert_eq!(lines, serde_json::json!({ "kind": "lines", "start": 0, "end": 3, "lines": ["{}"] }));
        assert_eq!(serde_json::to_value(FollowEvent::Reset).unwrap(), serde_json::json!({ "kind": "reset" }));
        assert_eq!(serde_json::to_value(FollowEvent::Missing).unwrap(), serde_json::json!({ "kind": "missing" }));
    }

    /// Follows `path` as the command would, with the events on a channel. The channel closes when
    /// the follow's thread is gone (the thread owns the sender).
    fn follow(path: &Path, tail: usize) -> (u32, Receiver<FollowEvent>) {
        let (tx, rx) = mpsc::channel();
        let p = path.to_path_buf();
        let id = start(move || p.is_file().then(|| p.clone()), tail, move |e| tx.send(e).is_ok()).unwrap();
        (id, rx)
    }

    fn next(rx: &Receiver<FollowEvent>) -> FollowEvent {
        rx.recv_timeout(WAIT).expect("an event")
    }

    fn lines_of(e: FollowEvent) -> (u64, u64, Vec<String>) {
        match e {
            FollowEvent::Lines { start, end, lines } => (start, end, lines),
            other => panic!("expected lines, got {other:?}"),
        }
    }

    /// True once the follow's thread has let go of its sink, whatever it sent before.
    fn ended(rx: &Receiver<FollowEvent>) -> bool {
        let until = Instant::now() + WAIT;
        while Instant::now() < until {
            if let Err(mpsc::RecvTimeoutError::Disconnected) = rx.recv_timeout(Duration::from_millis(100)) {
                return true;
            }
        }
        false
    }

    fn append(path: &Path, bytes: &[u8]) {
        let mut f = std::fs::OpenOptions::new().append(true).create(true).open(path).unwrap();
        f.write_all(bytes).unwrap();
    }

    fn numbered(n: usize) -> String {
        (0..n).map(|i| format!("{{\"n\":{i}}}\n")).collect()
    }

    /// Where line `i` of `text` starts.
    fn offset_of(text: &str, i: usize) -> u64 {
        text.split_inclusive('\n').take(i).map(|l| l.len() as u64).sum()
    }

    #[test]
    fn the_first_send_is_the_last_n_of_m_lines() {
        let path = temp_dir("conv-tail").join("s.jsonl");
        let text = numbered(10);
        std::fs::write(&path, format!("{text}{{\"partial")).unwrap();
        let (id, rx) = follow(&path, 3);
        let (start, end, lines) = lines_of(next(&rx));
        assert_eq!(lines, ["{\"n\":7}", "{\"n\":8}", "{\"n\":9}"]);
        assert_eq!((start, end), (offset_of(&text, 7), text.len() as u64));
        drop(stop(id));
    }

    #[test]
    fn a_tail_past_the_top_starts_at_zero_and_a_zero_tail_sends_only_offsets() {
        let path = temp_dir("conv-tail-top").join("s.jsonl");
        std::fs::write(&path, "a\r\nb\n").unwrap();
        let (id, rx) = follow(&path, 50);
        assert_eq!(lines_of(next(&rx)), (0, 5, vec!["a".into(), "b".into()]));
        drop(stop(id));
        let (id, rx) = follow(&path, 0);
        assert_eq!(lines_of(next(&rx)), (5, 5, vec![]));
        drop(stop(id));
    }

    #[test]
    fn a_partial_line_waits_for_its_newline() {
        let path = temp_dir("conv-partial").join("s.jsonl");
        std::fs::write(&path, "one\n").unwrap();
        let (id, rx) = follow(&path, 10);
        assert_eq!(lines_of(next(&rx)).2, ["one"]);
        append(&path, b"{\"half\":");
        assert!(rx.recv_timeout(Duration::from_millis(1500)).is_err(), "a partial line was sent");
        append(&path, b"true}\r\n");
        assert_eq!(lines_of(next(&rx)), (4, 19, vec!["{\"half\":true}".into()]));
        drop(stop(id));
    }

    #[test]
    fn lines_written_together_travel_in_one_event() {
        let path = temp_dir("conv-batch").join("s.jsonl");
        std::fs::write(&path, "").unwrap();
        let (id, rx) = follow(&path, 10);
        assert_eq!(lines_of(next(&rx)), (0, 0, vec![]));
        // 30 ms from first to last: each write wakes the follow, and the window gathers them.
        for (i, l) in ["a\n", "b\n", "c\n"].iter().enumerate() {
            if i > 0 {
                std::thread::sleep(Duration::from_millis(15));
            }
            append(&path, l.as_bytes());
        }
        assert_eq!(lines_of(next(&rx)), (0, 6, vec!["a".into(), "b".into(), "c".into()]));
        drop(stop(id));
    }

    #[test]
    fn the_watch_brings_a_line_well_before_the_fallback_poll() {
        let path = temp_dir("conv-watch").join("s.jsonl");
        std::fs::write(&path, "").unwrap();
        let (id, rx) = follow(&path, 10);
        lines_of(next(&rx));
        // Each append follows a send at once, when the 1 s poll has just started over.
        for i in 0..5 {
            let sent = Instant::now();
            append(&path, format!("{i}\n").as_bytes());
            assert_eq!(lines_of(next(&rx)).2, [i.to_string()]);
            assert!(sent.elapsed() < Duration::from_millis(500), "line {i} took {:?}", sent.elapsed());
        }
        drop(stop(id));
    }

    #[test]
    fn a_burst_is_split_into_events_of_at_most_about_4_mb() {
        let path = temp_dir("conv-burst").join("s.jsonl");
        std::fs::write(&path, "").unwrap();
        let (id, rx) = follow(&path, 10);
        lines_of(next(&rx));
        let line = format!("{}\n", "x".repeat(1 << 20));
        append(&path, line.repeat(10).as_bytes());
        let (mut got, mut at, mut events) = (0, 0, 0);
        while got < 10 {
            let (start, end, lines) = lines_of(next(&rx));
            assert_eq!(start, at, "events are contiguous");
            assert!(end - start <= MAX_EVENT, "an event of {} bytes", end - start);
            assert!(lines.iter().all(|l| l.len() == 1 << 20));
            (got, at, events) = (got + lines.len(), end, events + 1);
        }
        assert_eq!(got, 10);
        assert!(events >= 3, "10 MB came in {events} events");
        drop(stop(id));
    }

    #[test]
    fn a_shrink_sends_reset_then_lines_from_zero() {
        let path = temp_dir("conv-shrink").join("s.jsonl");
        std::fs::write(&path, numbered(3)).unwrap();
        let (id, rx) = follow(&path, 10);
        assert_eq!(lines_of(next(&rx)).2.len(), 3);
        std::fs::OpenOptions::new().write(true).truncate(true).open(&path).unwrap().write_all(b"new\n").unwrap();
        assert_eq!(next(&rx), FollowEvent::Reset);
        assert_eq!(lines_of(next(&rx)), (0, 4, vec!["new".into()]));
        drop(stop(id));
    }

    #[test]
    fn a_replaced_file_sends_reset_then_lines_from_zero() {
        let dir = temp_dir("conv-replace");
        let path = dir.join("s.jsonl");
        std::fs::write(&path, "old\n").unwrap();
        let (id, rx) = follow(&path, 10);
        assert_eq!(lines_of(next(&rx)).2, ["old"]);
        // Longer than before, with a newline where the old one ended: only its identity tells.
        std::fs::write(dir.join("next"), "new\nlines\n").unwrap();
        std::fs::rename(dir.join("next"), &path).unwrap();
        assert_eq!(next(&rx), FollowEvent::Reset);
        assert_eq!(lines_of(next(&rx)), (0, 10, vec!["new".into(), "lines".into()]));
        drop(stop(id));
    }

    #[test]
    fn a_file_rewritten_in_place_past_the_offset_sends_reset() {
        let path = temp_dir("conv-rewrite").join("s.jsonl");
        std::fs::write(&path, "ab\n").unwrap();
        let (id, rx) = follow(&path, 10);
        assert_eq!(lines_of(next(&rx)).2, ["ab"]);
        // Same file, grown, but byte 2 is no longer the newline we stopped after.
        std::fs::OpenOptions::new().write(true).truncate(true).open(&path).unwrap().write_all(b"abcd\n").unwrap();
        assert_eq!(next(&rx), FollowEvent::Reset);
        assert_eq!(lines_of(next(&rx)).2, ["abcd"]);
        drop(stop(id));
    }

    #[test]
    fn a_missing_file_says_so_once_then_is_followed_when_it_appears() {
        let path = temp_dir("conv-missing").join("s.jsonl");
        let (id, rx) = follow(&path, 10);
        assert_eq!(next(&rx), FollowEvent::Missing);
        assert!(rx.recv_timeout(Duration::from_millis(1500)).is_err(), "missing was said twice");
        std::fs::write(&path, "a\nb\n").unwrap();
        assert_eq!(lines_of(next(&rx)), (0, 4, vec!["a".into(), "b".into()]));
        append(&path, b"c\n");
        assert_eq!(lines_of(next(&rx)), (4, 6, vec!["c".into()]));
        drop(stop(id));
    }

    #[test]
    fn a_file_that_goes_away_resets_and_is_looked_for_again() {
        let path = temp_dir("conv-gone").join("s.jsonl");
        std::fs::write(&path, "a\n").unwrap();
        let (id, rx) = follow(&path, 10);
        lines_of(next(&rx));
        std::fs::remove_file(&path).unwrap();
        assert_eq!(next(&rx), FollowEvent::Reset);
        assert_eq!(next(&rx), FollowEvent::Missing);
        std::fs::write(&path, "b\n").unwrap();
        assert_eq!(lines_of(next(&rx)), (0, 2, vec!["b".into()]));
        drop(stop(id));
    }

    #[test]
    fn earlier_walks_back_to_the_top() {
        let path = temp_dir("conv-earlier").join("s.jsonl");
        let text = numbered(10);
        std::fs::write(&path, &text).unwrap();
        let c = earlier(&path, offset_of(&text, 5), 3).unwrap();
        assert_eq!((c.start, c.end), (offset_of(&text, 2), offset_of(&text, 5)));
        assert_eq!(c.lines, ["{\"n\":2}", "{\"n\":3}", "{\"n\":4}"]);
        let c = earlier(&path, c.start, 3).unwrap();
        assert_eq!((c.start, c.end, c.lines.len()), (0, offset_of(&text, 2), 2));
        let c = earlier(&path, 0, 3).unwrap();
        assert_eq!((c.start, c.end, c.lines), (0, 0, vec![]));
    }

    #[test]
    fn earlier_takes_a_mid_line_or_past_the_end_before_back_to_a_boundary() {
        let path = temp_dir("conv-earlier-snap").join("s.jsonl");
        let text = numbered(4);
        std::fs::write(&path, format!("{text}{{\"partial")).unwrap();
        let c = earlier(&path, offset_of(&text, 2) + 3, 1).unwrap();
        assert_eq!((c.start, c.end), (offset_of(&text, 1), offset_of(&text, 2)));
        let c = earlier(&path, 1 << 40, 2).unwrap();
        assert_eq!((c.end, c.lines.len()), (text.len() as u64, 2));
    }

    #[test]
    fn one_megabyte_lines_are_tailed_fetched_and_followed_whole() {
        let path = temp_dir("conv-big").join("s.jsonl");
        let big = |c: char| format!("{{\"image\":\"{}\"}}", c.to_string().repeat(1 << 20));
        std::fs::write(&path, format!("small\n{}\n{}\n", big('a'), big('b'))).unwrap();
        let (id, rx) = follow(&path, 5);
        let (start, end, lines) = lines_of(next(&rx));
        assert_eq!((start, lines.len()), (0, 3));
        assert_eq!(lines[1], big('a'));
        let c = earlier(&path, end, 1).unwrap();
        assert_eq!(c.lines, [big('b')]);
        let half = big('c');
        let (one, two) = half.as_bytes().split_at(half.len() / 2);
        append(&path, one);
        std::thread::sleep(Duration::from_millis(300));
        append(&path, two);
        append(&path, b"\n");
        assert_eq!(lines_of(next(&rx)), (end, end + half.len() as u64 + 1, vec![half]));
        drop(stop(id));
    }

    #[test]
    fn a_tail_or_a_chunk_stops_short_of_4_mb_but_keeps_one_line() {
        let path = temp_dir("conv-cap").join("s.jsonl");
        let line = "y".repeat(1 << 20);
        std::fs::write(&path, format!("{line}\n").repeat(6)).unwrap();
        let (id, rx) = follow(&path, 200);
        let (start, end, lines) = lines_of(next(&rx));
        assert_eq!(lines.len(), 3, "three 1 MB lines fit in 4 MB");
        assert_eq!(end - start, 3 * (line.len() as u64 + 1));
        drop(stop(id));
        let c = earlier(&path, start, 200).unwrap();
        assert_eq!((c.lines.len(), c.start), (3, 0));
        // A single line bigger than the cap still comes back.
        let huge = temp_dir("conv-cap-huge").join("s.jsonl");
        std::fs::write(&huge, format!("{}\n", "z".repeat(5 << 20))).unwrap();
        let c = earlier(&huge, 1 << 40, 10).unwrap();
        assert_eq!((c.start, c.lines.len()), (0, 1));
    }

    #[test]
    fn many_follows_at_once_each_get_their_own_lines_and_all_end() {
        let dir = temp_dir("conv-many");
        let follows: Vec<_> = (0..16)
            .map(|i| {
                let path = dir.join(format!("s{i}.jsonl"));
                std::fs::write(&path, format!("start {i}\n")).unwrap();
                let (id, rx) = follow(&path, 1);
                assert_eq!(lines_of(next(&rx)).2, [format!("start {i}")]);
                (path, id, rx)
            })
            .collect();
        for (i, (path, _, _)) in follows.iter().enumerate() {
            append(path, format!("line {i}\n").as_bytes());
        }
        for (i, (_, _, rx)) in follows.iter().enumerate() {
            assert_eq!(lines_of(next(rx)).2, [format!("line {i}")]);
        }
        for (_, id, _) in &follows {
            drop(stop(*id));
        }
        assert!(follows.iter().all(|(_, _, rx)| ended(rx)), "a follow's thread outlived it");
    }

    #[test]
    fn unfollow_ends_the_thread_and_its_watch() {
        let path = temp_dir("conv-unfollow").join("s.jsonl");
        std::fs::write(&path, "a\n").unwrap();
        let (id, rx) = follow(&path, 10);
        lines_of(next(&rx));
        let thread = stop(id).expect("a running follow");
        let until = Instant::now() + WAIT;
        while !thread.is_finished() {
            assert!(Instant::now() < until, "the thread outlived its follow");
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(ended(&rx));
        assert!(!follows().contains_key(&id));
        conversation_unfollow(id);
        conversation_unfollow(u32::MAX);
    }

    #[test]
    fn unfollow_ends_a_follow_still_looking_for_its_file() {
        let path = temp_dir("conv-unfollow-missing").join("s.jsonl");
        let (id, rx) = follow(&path, 10);
        assert_eq!(next(&rx), FollowEvent::Missing);
        conversation_unfollow(id);
        assert!(ended(&rx));
    }

    #[test]
    fn a_failed_send_ends_the_follow() {
        let path = temp_dir("conv-sendfail").join("s.jsonl");
        std::fs::write(&path, "a\n").unwrap();
        // The first event goes through; every later send fails, as when the webview is gone.
        let (tx, rx) = mpsc::channel();
        let p = path.clone();
        let mut sent = 0;
        let id = start(
            move || p.is_file().then(|| p.clone()),
            10,
            move |e| {
                sent += 1;
                sent < 2 && tx.send(e).is_ok()
            },
        )
        .unwrap();
        lines_of(next(&rx));
        append(&path, b"b\n");
        assert!(ended(&rx), "the follow kept running after its webview went");
        let until = Instant::now() + WAIT;
        while follows().contains_key(&id) {
            assert!(Instant::now() < until, "the ended follow stayed registered");
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    #[test]
    fn a_tauri_channel_that_fails_ends_the_follow() {
        let path = temp_dir("conv-channel").join("s.jsonl");
        std::fs::write(&path, "a\n").unwrap();
        let calls = Arc::new(AtomicU32::new(0));
        let seen = calls.clone();
        let channel: Channel<FollowEvent> = Channel::new(move |_| {
            seen.fetch_add(1, Ordering::SeqCst);
            Err(tauri::Error::WebviewNotFound)
        });
        let p = path.clone();
        let id = start(move || p.is_file().then(|| p.clone()), 10, move |e| channel.send(e).is_ok()).unwrap();
        let until = Instant::now() + WAIT;
        while follows().contains_key(&id) {
            assert!(Instant::now() < until, "a failing Channel did not end the follow");
            std::thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn a_session_id_that_could_leave_the_projects_dir_is_refused() {
        assert!(check_session_id("0f8e3c1a-7b2d-4e5f-9a6b-1c2d3e4f5a6b").is_ok());
        for bad in ["", "../x", "a/b", "a\\b", "..", "a b"] {
            assert!(check_session_id(bad).is_err(), "{bad:?} was accepted");
        }
        assert!(conversation_earlier("../../etc/passwd".into(), "/".into(), 0, 1).is_err());
    }

    /// Follows the newest real transcript (or `CONVERSATION_TRANSCRIPT`) for 2 s and prints what
    /// it saw. Run with `--ignored --nocapture`.
    #[test]
    #[ignore]
    fn follows_the_newest_real_transcript() {
        let projects = std::env::var_os("HOME").map(PathBuf::from).unwrap().join(".claude").join("projects");
        let newest = std::env::var_os("CONVERSATION_TRANSCRIPT").map(PathBuf::from).unwrap_or_else(|| newest_under(&projects));
        let size = std::fs::metadata(&newest).unwrap().len();
        let began = Instant::now();
        let (id, rx) = follow(&newest, 200);
        let mut first = None;
        let (mut events, mut lines, mut bytes) = (0, 0, 0);
        while began.elapsed() < Duration::from_secs(2) {
            if let Ok(FollowEvent::Lines { start, end, lines: l }) = rx.recv_timeout(Duration::from_millis(100)) {
                first.get_or_insert(began.elapsed());
                (events, lines, bytes) = (events + 1, lines + l.len(), bytes + end - start);
            }
        }
        drop(stop(id));
        println!("{}: {size} bytes; {events} events, {lines} lines, {bytes} bytes in 2 s; first event after {first:?}", newest.display());
        assert!(first.is_some(), "no lines from {}", newest.display());
    }

    fn newest_under(projects: &Path) -> PathBuf {
        std::fs::read_dir(projects)
            .unwrap()
            .flatten()
            .filter_map(|d| std::fs::read_dir(d.path()).ok())
            .flat_map(|d| d.flatten())
            .filter(|e| e.path().extension().is_some_and(|x| x == "jsonl"))
            .filter_map(|e| Some((e.metadata().ok()?.modified().ok()?, e.path())))
            .max()
            .expect("a transcript under ~/.claude/projects")
            .1
    }
}

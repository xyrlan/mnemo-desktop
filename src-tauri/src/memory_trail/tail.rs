//! A log and its `.1` rotation, read from where the last read stopped.
//!
//! mnemo appends a line per event and, when a log passes its size cap, renames it to `<log>.1`
//! and starts a new one (`core/log_utils.py`); the learned ledger is rewritten in place instead,
//! keeping its newest half. So a poll has three cases:
//!
//! - nothing was written: both files have the length and mtime they had. No file is opened.
//! - the log grew: the bytes past the last complete line read are read, and no others.
//! - the log is another file: when `.1` is the file the live slot was reading, the slot moves
//!   there with what it holds and reads on (the lines written between the last poll and the
//!   rotation); anything else is read again from its start.
//!
//! "The same file" is told by content, not by an id of the file: the first bytes read from it
//! and the last ones before the offset must still be where they were. Windows keeps a renamed
//! file's times (NTFS tunnelling), and an inode says nothing about a file rewritten in place.
//! A file is only opened when its length or mtime changed, so one replaced by another of the
//! same length inside one tick of the clock goes unnoticed until its next line is written.
//!
//! What a file's lines add up to is kept per file (`Slot::sum`), so the rows of a rotation
//! mnemo dropped leave with it and a long-running app answers what a fresh one would.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::time::SystemTime;

/// How many of a file's first bytes name it.
const HEAD_BYTES: usize = 4096;
/// How many of the bytes before the offset must still be there to read on from it.
const ANCHOR_BYTES: usize = 64;
/// Bytes read at a time. Small under test, so the suite's logs span several.
const CHUNK: usize = if cfg!(test) { 1 << 12 } else { 1 << 20 };

/// What reading cost: files opened, and bytes of log read (not the few that tell a file apart).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Io {
    pub opens: u64,
    pub bytes: u64,
}

/// A file's length and mtime. A missing file has none of either.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct Stat {
    len: u64,
    mtime: Option<SystemTime>,
}

impl Stat {
    fn of(meta: std::io::Result<std::fs::Metadata>) -> Stat {
        meta.ok().filter(|m| m.is_file()).map(|m| Stat { len: m.len(), mtime: m.modified().ok() }).unwrap_or_default()
    }
}

fn open(path: &Path, io: &mut Io) -> Option<(File, Stat)> {
    let file = File::open(path).ok()?;
    io.opens += 1;
    let meta = file.metadata().ok().filter(|m| m.is_file())?;
    Some((file, Stat::of(Ok(meta))))
}

fn bytes_at(file: &mut File, at: u64, n: usize) -> Option<Vec<u8>> {
    let mut buf = vec![0; n];
    file.seek(SeekFrom::Start(at)).ok()?;
    file.read_exact(&mut buf).ok()?;
    Some(buf)
}

/// Where reading one file stopped.
#[derive(Debug, Default)]
struct Tail {
    /// The file as it was when last read to its end.
    seen: Stat,
    /// Bytes read: through the last complete line.
    offset: u64,
    /// The first `HEAD_BYTES` of those, and the last `ANCHOR_BYTES`.
    head: Vec<u8>,
    anchor: Vec<u8>,
}

impl Tail {
    /// Whether `file` is the one read so far, with everything read still in place. A file
    /// shorter than the offset has no such bytes; a tail that read nothing continues nothing.
    fn continues(&self, file: &mut File) -> bool {
        self.offset > 0
            && bytes_at(file, 0, self.head.len()).is_some_and(|b| b == self.head)
            && bytes_at(file, self.offset - self.anchor.len() as u64, self.anchor.len()).is_some_and(|b| b == self.anchor)
    }

    /// Hands `line` each complete line past the offset. A last line with no end yet waits for it.
    fn read(&mut self, file: &mut File, stat: Stat, io: &mut Io, mut line: impl FnMut(&[u8])) {
        if file.seek(SeekFrom::Start(self.offset)).is_err() {
            return;
        }
        let mut at = self.offset;
        let mut buf = vec![0; CHUNK.min(stat.len.saturating_sub(at) as usize)];
        let mut carry: Vec<u8> = Vec::new();
        while at < stat.len {
            let want = buf.len().min((stat.len - at) as usize);
            let n = match file.read(&mut buf[..want]) {
                Ok(n) if n > 0 => n,
                // Cut short under the read: `seen` stays as it was, so the next poll looks again.
                _ => return,
            };
            io.bytes += n as u64;
            at += n as u64;
            carry.extend_from_slice(&buf[..n]);
            let Some(end) = carry.iter().rposition(|b| *b == b'\n') else { continue };
            carry[..end].split(|b| *b == b'\n').for_each(&mut line);
            let done = &carry[..=end];
            let room = HEAD_BYTES.saturating_sub(self.head.len());
            self.head.extend_from_slice(&done[..done.len().min(room)]);
            self.anchor.extend_from_slice(done);
            self.anchor.drain(..self.anchor.len().saturating_sub(ANCHOR_BYTES));
            self.offset += done.len() as u64;
            carry.drain(..=end);
        }
        self.seen = stat;
    }
}

/// One file: where reading it stopped, and what its lines add up to.
#[derive(Debug, Default)]
pub struct Slot<S> {
    tail: Tail,
    pub sum: S,
}

impl<S: Default> Slot<S> {
    /// Reads on in `file` when it is the file read so far, else reads it from its start.
    fn follow(&mut self, file: Option<(File, Stat)>, io: &mut Io, line: &impl Fn(&mut S, &[u8])) {
        let Some((mut file, stat)) = file else {
            *self = Self::default();
            return;
        };
        if !self.tail.continues(&mut file) {
            *self = Self::default();
        }
        let sum = &mut self.sum;
        self.tail.read(&mut file, stat, io, |l| line(sum, l));
    }
}

/// A log and its rotation. `S` is what one file's lines add up to.
#[derive(Debug, Default)]
pub struct Log<S> {
    pub rotated: Slot<S>,
    pub live: Slot<S>,
}

impl<S: Default> Log<S> {
    /// Brings both slots up to what is on disk, handing `line` each new line with the sum of
    /// the file it is in. A log that never rotates has no `rotated`. Whether anything changed.
    pub fn poll(&mut self, rotated: Option<&Path>, live: &Path, io: &mut Io, line: impl Fn(&mut S, &[u8])) -> bool {
        let stat = |p: &Path| Stat::of(std::fs::metadata(p));
        let (rotated_now, live_now) = (rotated.map(stat).unwrap_or_default(), stat(live));
        if self.rotated.tail.seen == rotated_now && self.live.tail.seen == live_now {
            return false;
        }
        if self.rotated.tail.seen != rotated_now {
            let mut file = rotated.and_then(|p| open(p, io));
            // A rotation: `.1` is the file the live slot was reading.
            if file.as_mut().is_some_and(|(f, _)| self.live.tail.continues(f)) {
                self.rotated = std::mem::take(&mut self.live);
            }
            self.rotated.follow(file, io, &line);
        }
        if self.live.tail.seen != live_now {
            self.live.follow(open(live, io), io, &line);
        }
        true
    }

    /// The two files' sums, the older file first.
    pub fn sums(&self) -> [&S; 2] {
        [&self.rotated.sum, &self.live.sum]
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::temp_dir;
    use std::path::PathBuf;

    /// A log whose sum is its lines, as text.
    type Lines = Log<Vec<String>>;

    fn keep(sum: &mut Vec<String>, line: &[u8]) {
        sum.push(String::from_utf8_lossy(line).into_owned());
    }

    fn paths(tag: &str) -> (PathBuf, PathBuf) {
        let dir = temp_dir(tag);
        (dir.join("log.jsonl.1"), dir.join("log.jsonl"))
    }

    fn append(path: &Path, text: &str) {
        use std::io::Write;
        std::fs::OpenOptions::new().create(true).append(true).open(path).unwrap().write_all(text.as_bytes()).unwrap();
    }

    fn all(log: &Lines) -> Vec<&str> {
        log.sums().into_iter().flatten().map(String::as_str).collect()
    }

    #[test]
    fn a_poll_with_nothing_new_opens_no_file() {
        let (rot, live) = paths("tail-idle");
        append(&rot, "old\n");
        append(&live, "a\nb\n");
        let (mut log, mut io) = (Lines::default(), Io::default());
        assert!(log.poll(Some(&rot), &live, &mut io, keep));
        assert_eq!(all(&log), ["old", "a", "b"]);
        assert_eq!(io, Io { opens: 2, bytes: 8 });
        assert!(!log.poll(Some(&rot), &live, &mut io, keep));
        assert_eq!(io, Io { opens: 2, bytes: 8 });
    }

    #[test]
    fn only_what_was_appended_is_read() {
        let (rot, live) = paths("tail-append");
        let big: String = (0..20_000).map(|i| format!("line {i}\n")).collect();
        append(&live, &big);
        let (mut log, mut io) = (Lines::default(), Io::default());
        log.poll(Some(&rot), &live, &mut io, keep);
        assert_eq!(io.bytes, big.len() as u64);
        append(&live, "new one\nnew two\n");
        assert!(log.poll(Some(&rot), &live, &mut io, keep));
        assert_eq!(io.bytes, big.len() as u64 + 16);
        // Every line whole and once, across the chunks it was read in.
        let want: Vec<String> = (0..20_000).map(|i| format!("line {i}")).chain(["new one".to_string(), "new two".to_string()]).collect();
        assert!(big.len() > 10 * CHUNK && log.live.sum == want);
    }

    #[test]
    fn a_line_with_no_end_waits_for_it() {
        let (rot, live) = paths("tail-torn");
        append(&live, "whole\nhal");
        let (mut log, mut io) = (Lines::default(), Io::default());
        log.poll(Some(&rot), &live, &mut io, keep);
        assert_eq!(all(&log), ["whole"]);
        append(&live, "f\r\nnext\r\n");
        log.poll(Some(&rot), &live, &mut io, keep);
        assert_eq!(all(&log), ["whole", "half\r", "next\r"]);
        // The line that had no end is read again with it, and nothing before it is.
        assert_eq!(io.bytes, 9 + 12);
    }

    #[test]
    fn a_rotation_moves_the_live_slot_and_reads_only_what_it_missed() {
        let (rot, live) = paths("tail-rotate");
        append(&rot, "ancient\n");
        append(&live, "a\nb\n");
        let (mut log, mut io) = (Lines::default(), Io::default());
        log.poll(Some(&rot), &live, &mut io, keep);
        // mnemo wrote `c`, then rotated on the next append and wrote `d` to a new log.
        append(&live, "c\n");
        std::fs::rename(&live, &rot).unwrap();
        append(&live, "d\n");
        let before = io.bytes;
        assert!(log.poll(Some(&rot), &live, &mut io, keep));
        // `ancient` left with the file mnemo dropped; `a` and `b` were not read again.
        assert_eq!(log.rotated.sum, ["a", "b", "c"]);
        assert_eq!(log.live.sum, ["d"]);
        assert_eq!(io.bytes - before, 4);
    }

    #[test]
    fn a_rotation_seen_before_the_new_log_exists() {
        let (rot, live) = paths("tail-rotate-gap");
        append(&live, "a\n");
        let (mut log, mut io) = (Lines::default(), Io::default());
        log.poll(Some(&rot), &live, &mut io, keep);
        std::fs::rename(&live, &rot).unwrap();
        log.poll(Some(&rot), &live, &mut io, keep);
        assert_eq!((all(&log), io.bytes), (vec!["a"], 2));
        // Touched, not written: it is looked at, found to be the file read, and not read again.
        let later = SystemTime::now() + std::time::Duration::from_secs(5);
        File::options().write(true).open(&rot).unwrap().set_modified(later).unwrap();
        assert!(log.poll(Some(&rot), &live, &mut io, keep));
        assert_eq!((all(&log), io), (vec!["a"], Io { opens: 3, bytes: 2 }));
        append(&live, "b\n");
        log.poll(Some(&rot), &live, &mut io, keep);
        assert_eq!(all(&log), ["a", "b"]);
    }

    #[test]
    fn two_rotations_between_polls_read_both_files_again() {
        let (rot, live) = paths("tail-rotate-twice");
        append(&live, "a\n");
        let (mut log, mut io) = (Lines::default(), Io::default());
        log.poll(Some(&rot), &live, &mut io, keep);
        std::fs::rename(&live, &rot).unwrap();
        append(&live, "bb\n");
        std::fs::rename(&live, &rot).unwrap();
        append(&live, "ccc\n");
        log.poll(Some(&rot), &live, &mut io, keep);
        assert_eq!(all(&log), ["bb", "ccc"]);
    }

    #[test]
    fn a_log_rewritten_in_place_is_read_again() {
        let (_, live) = paths("tail-rewrite");
        append(&live, "one\ntwo\nthree\nfour\n");
        let (mut log, mut io) = (Lines::default(), Io::default());
        log.poll(None, &live, &mut io, keep);
        // The learned ledger's rotation: its newest half, and then a new line.
        std::fs::write(&live, "three\nfour\nfive\nsix!\n").unwrap();
        log.poll(None, &live, &mut io, keep);
        assert_eq!(all(&log), ["three", "four", "five", "six!"]);
    }

    #[test]
    fn a_rewrite_that_keeps_the_first_lines_is_still_another_file() {
        let (_, live) = paths("tail-rewrite-tail");
        let head: String = (0..600).map(|i| format!("row {i:04}\n")).collect();
        append(&live, &format!("{head}last was this\n"));
        let (mut log, mut io) = (Lines::default(), Io::default());
        log.poll(None, &live, &mut io, keep);
        // Longer, the same first 4096 bytes, and another line where reading stopped.
        std::fs::write(&live, format!("{head}last is that\nand more\n")).unwrap();
        log.poll(None, &live, &mut io, keep);
        assert_eq!(log.live.sum.len(), 602);
        assert_eq!(log.live.sum[600..], ["last is that", "and more"]);
    }

    #[test]
    fn a_rewrite_that_keeps_the_last_lines_is_still_another_file() {
        let (_, live) = paths("tail-rewrite-head");
        let rest: String = (0..20).map(|i| format!("row {i:04}\n")).collect();
        append(&live, &format!("first was this\n{rest}"));
        let (mut log, mut io) = (Lines::default(), Io::default());
        log.poll(None, &live, &mut io, keep);
        // Another first line of the same length, the same bytes before the offset, and more.
        std::fs::write(&live, format!("first is that!\n{rest}and more\n")).unwrap();
        log.poll(None, &live, &mut io, keep);
        assert_eq!((log.live.sum.len(), log.live.sum[0].as_str(), log.live.sum[21].as_str()), (22, "first is that!", "and more"));
    }

    #[test]
    fn a_truncated_log_and_a_deleted_one() {
        let (rot, live) = paths("tail-gone");
        append(&rot, "old\n");
        append(&live, "a\nb\n");
        let (mut log, mut io) = (Lines::default(), Io::default());
        log.poll(Some(&rot), &live, &mut io, keep);
        // The rotation gone, the log as it was: its rows leave, and the log is not opened.
        std::fs::remove_file(&rot).unwrap();
        assert!(log.poll(Some(&rot), &live, &mut io, keep));
        assert_eq!((all(&log), io.opens), (vec!["a", "b"], 2));
        std::fs::write(&live, "a\n").unwrap();
        assert!(log.poll(Some(&rot), &live, &mut io, keep));
        assert_eq!(all(&log), ["a"]);
        std::fs::remove_file(&live).unwrap();
        assert!(log.poll(Some(&rot), &live, &mut io, keep));
        assert!(all(&log).is_empty());
        assert!(!log.poll(Some(&rot), &live, &mut io, keep));
    }

    #[test]
    fn a_line_longer_than_a_chunk_is_read_whole() {
        let (_, live) = paths("tail-long");
        let long = "x".repeat(CHUNK + 10);
        append(&live, &format!("{long}\nshort\n"));
        let (mut log, mut io) = (Lines::default(), Io::default());
        log.poll(None, &live, &mut io, keep);
        assert_eq!(log.live.sum.len(), 2);
        assert_eq!((log.live.sum[0].len(), log.live.sum[1].as_str()), (CHUNK + 10, "short"));
    }
}

//! A file read from where the last read stopped, as `nexus_feed::transcript::Reader` reads a
//! transcript: an unchanged file costs one `stat`, a longer one the bytes appended to it.

use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::time::SystemTime;

/// Bytes read at a time. A line longer than this is read whole before it is handed over.
const CHUNK: usize = 8 << 20;

/// What takes a file's lines in.
pub trait Sink {
    /// The file is shorter than it was: it was written anew, so what was read of it is void.
    fn restart(&mut self);
    /// One complete line without its newline, and the byte of the file it starts at.
    fn line(&mut self, offset: u64, line: &str);
}

#[derive(Debug, Default)]
pub struct Tail {
    /// Where the first line not handed over yet starts.
    offset: u64,
    len: u64,
    mtime: Option<SystemTime>,
}

impl Tail {
    /// Hand `sink` the complete lines appended to `path` since the last call. `Ok(false)` when
    /// it was handed nothing. An unchanged size and mtime reads nothing; a file that shrank is
    /// read again from the start; a trailing line still being written waits for its newline.
    pub fn refresh(&mut self, path: &Path, sink: &mut impl Sink) -> Result<bool, String> {
        self.refresh_to(path, u64::MAX, sink)
    }

    /// `refresh`, with a file longer than `end` taken to end there: the file as it stood when
    /// it was that long.
    pub fn refresh_to(&mut self, path: &Path, end: u64, sink: &mut impl Sink) -> Result<bool, String> {
        let meta = std::fs::metadata(path).map_err(|e| format!("{}: {e}", path.display()))?;
        let (len, mtime) = (meta.len().min(end), meta.modified().ok());
        if len == self.len && mtime == self.mtime {
            return Ok(false);
        }
        let mut changed = false;
        if len < self.len {
            *self = Tail::default();
            sink.restart();
            changed = true;
        }
        let mut f = std::fs::File::open(path).map_err(|e| format!("{}: {e}", path.display()))?;
        f.seek(SeekFrom::Start(self.offset)).map_err(|e| e.to_string())?;
        let mut left = len - self.offset;
        let mut pending: Vec<u8> = Vec::new();
        let mut buf = vec![0u8; CHUNK.min(left as usize)];
        while left > 0 {
            let want = (CHUNK as u64).min(left) as usize;
            let n = f.read(&mut buf[..want]).map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            left -= n as u64;
            pending.extend_from_slice(&buf[..n]);
            let Some(last) = pending.iter().rposition(|b| *b == b'\n') else { continue };
            let mut start = 0usize;
            for piece in pending[..last].split(|b| *b == b'\n') {
                let at = self.offset + start as u64;
                start += piece.len() + 1;
                let piece = piece.strip_suffix(b"\r").unwrap_or(piece);
                if !piece.is_empty() {
                    sink.line(at, &String::from_utf8_lossy(piece));
                    changed = true;
                }
            }
            self.offset += last as u64 + 1;
            pending.drain(..=last);
        }
        self.len = len;
        self.mtime = mtime;
        Ok(changed)
    }

    /// How far into the file the lines handed over reach.
    #[cfg(test)]
    pub fn offset(&self) -> u64 {
        self.offset
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Default)]
    struct Lines {
        got: Vec<(u64, String)>,
        restarts: usize,
    }

    impl Sink for Lines {
        fn restart(&mut self) {
            self.got.clear();
            self.restarts += 1;
        }
        fn line(&mut self, offset: u64, line: &str) {
            self.got.push((offset, line.to_string()));
        }
    }

    fn append(path: &Path, text: &str) {
        use std::io::Write;
        std::fs::OpenOptions::new().append(true).create(true).open(path).and_then(|mut f| f.write_all(text.as_bytes())).unwrap();
    }

    #[test]
    fn a_line_is_handed_over_once_with_the_byte_it_starts_at() {
        let dir = crate::testutil::temp_dir("insight-tail");
        let path = dir.join("t.jsonl");
        append(&path, "one\ntwo\r\n\nfour");
        let (mut tail, mut lines) = (Tail::default(), Lines::default());
        assert_eq!(tail.refresh(&path, &mut lines), Ok(true));
        assert_eq!(lines.got, [(0, "one".to_string()), (4, "two".to_string())], "a blank line is none, a line without its newline waits");
        assert_eq!(tail.offset(), 10);

        // Nothing appended: nothing handed over, and nothing read.
        assert_eq!(tail.refresh(&path, &mut lines), Ok(false));
        assert_eq!(lines.got.len(), 2);

        append(&path, " and the rest\nfive\n");
        assert_eq!(tail.refresh(&path, &mut lines), Ok(true));
        assert_eq!(lines.got[2..], [(10, "four and the rest".to_string()), (28, "five".to_string())]);
        assert_eq!(lines.restarts, 0);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_file_written_anew_shorter_is_read_from_its_start() {
        let dir = crate::testutil::temp_dir("insight-tail-anew");
        let path = dir.join("t.jsonl");
        append(&path, "a long first line\nand a second\n");
        let (mut tail, mut lines) = (Tail::default(), Lines::default());
        tail.refresh(&path, &mut lines).unwrap();
        std::fs::write(&path, "short\n").unwrap();
        assert_eq!(tail.refresh(&path, &mut lines), Ok(true));
        assert_eq!((lines.restarts, lines.got.clone()), (1, vec![(0, "short".to_string())]));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_line_longer_than_a_chunk_is_handed_over_whole() {
        let dir = crate::testutil::temp_dir("insight-tail-long");
        let path = dir.join("t.jsonl");
        let long = "z".repeat(CHUNK + 10);
        append(&path, &format!("a\n{long}\nb\n"));
        let (mut tail, mut lines) = (Tail::default(), Lines::default());
        tail.refresh(&path, &mut lines).unwrap();
        let got: Vec<(u64, usize)> = lines.got.iter().map(|(at, l)| (*at, l.len())).collect();
        assert_eq!(got, [(0, 1), (2, CHUNK + 10), (CHUNK as u64 + 13, 1)]);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_file_read_to_a_byte_reads_the_rest_later() {
        let dir = crate::testutil::temp_dir("insight-tail-to");
        let path = dir.join("t.jsonl");
        append(&path, "one\ntwo\nthree\n");
        let (mut tail, mut lines) = (Tail::default(), Lines::default());
        tail.refresh_to(&path, 6, &mut lines).unwrap();
        assert_eq!(lines.got, [(0, "one".to_string())]);
        tail.refresh(&path, &mut lines).unwrap();
        assert_eq!(lines.got.len(), 3);
        assert_eq!(lines.restarts, 0);
        assert!(Tail::default().refresh(&dir.join("absent.jsonl"), &mut lines).is_err());
        let _ = std::fs::remove_dir_all(dir);
    }
}

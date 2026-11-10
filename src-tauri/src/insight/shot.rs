//! A screenshot a session's browser tools took, found again in its transcript.
//!
//! The feed lists a screenshot by an id and leaves its megabyte of base64 where it is. The id
//! says where that is: the byte the transcript line starts at, which block of the line's
//! content the tool result is, and which part of that result the picture is. Reading one costs
//! a seek and that one line.

use std::io::{BufRead, Read, Seek, SeekFrom};
use std::path::Path;

use super::line::{self, is, text, Line};

/// A line longer than this is not a line this reads.
const LINE_MAX: u64 = 256 << 20;

pub fn id(offset: u64, block: usize, part: usize) -> String {
    format!("{offset:x}.{block}.{part}")
}

fn parse(id: &str) -> Option<(u64, usize, usize)> {
    let mut parts = id.split('.');
    let found = (u64::from_str_radix(parts.next()?, 16).ok()?, parts.next()?.parse().ok()?, parts.next()?.parse().ok()?);
    parts.next().is_none().then_some(found)
}

/// The picture `id` names in the transcript at `path`, as the base64 the transcript holds.
pub fn read(path: &Path, id: &str) -> Result<String, String> {
    let none = || format!("no screenshot {id}");
    let (offset, block, part) = parse(id).ok_or_else(none)?;
    let mut f = std::fs::File::open(path).map_err(|e| e.to_string())?;
    // From anywhere but the start of a line, what is left of the line is no record.
    f.seek(SeekFrom::Start(offset)).map_err(|e| e.to_string())?;
    let mut raw = Vec::new();
    std::io::BufReader::with_capacity(1 << 20, f).take(LINE_MAX).read_until(b'\n', &mut raw).map_err(|e| e.to_string())?;
    let raw = std::str::from_utf8(&raw).map_err(|_| none())?;
    let l: Line = serde_json::from_str(raw.trim_end()).map_err(|_| none())?;
    let (_, blocks) = line::content(l.message.as_ref().and_then(|m| m.content));
    let result = blocks.get(block).filter(|b| is(b.kind, "tool_result")).ok_or_else(none)?;
    let (_, parts) = line::parts(result.content);
    let source = parts.get(part).filter(|p| is(p.kind, "image")).and_then(|p| p.source.as_ref()).ok_or_else(none)?;
    text(source.data).ok_or_else(none)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn an_id_says_where_the_picture_is() {
        assert_eq!(id(0x1f3a, 2, 11), "1f3a.2.11");
        assert_eq!(parse("1f3a.2.11"), Some((0x1f3a, 2, 11)));
        for bad in ["", "1f3a", "1f3a.2", "1f3a.2.11.0", "zz.2.1", "1f3a.-2.1", "1f3a.2.x", "../../x"] {
            assert_eq!(parse(bad), None, "{bad}");
        }
    }

    #[test]
    fn a_picture_is_read_from_the_line_its_id_names() {
        let dir = crate::testutil::temp_dir("insight-shot");
        let path = dir.join("s.jsonl");
        let first = json!({ "type": "assistant", "message": { "content": [{ "type": "text", "text": "looking" }] } }).to_string();
        let shots = json!({ "type": "user", "message": { "content": [
            { "type": "text", "text": "aside" },
            { "type": "tool_result", "tool_use_id": "t1", "content": [
                { "type": "text", "text": "Captured" },
                { "type": "image", "source": { "type": "base64", "media_type": "image/jpeg", "data": "QUJD" } },
                { "type": "image", "source": { "type": "base64", "media_type": "image/png", "data": "REVG" } },
                { "type": "image", "source": { "type": "url", "url": "https://x.example/a.png" } },
                { "type": "document", "source": { "type": "base64", "media_type": "application/pdf", "data": "UERG" } },
            ] },
            { "type": "other", "content": [{ "type": "image", "source": { "type": "base64", "media_type": "image/png", "data": "R0hJ" } }] },
        ] } })
        .to_string();
        std::fs::write(&path, format!("{first}\n{shots}\n")).unwrap();
        let at = first.len() as u64 + 1;

        assert_eq!(read(&path, &id(at, 1, 1)).as_deref(), Ok("QUJD"));
        assert_eq!(read(&path, &id(at, 1, 2)).as_deref(), Ok("REVG"));
        assert!(read(&path, &id(at, 1, 0)).is_err(), "a text part is no picture");
        assert!(read(&path, &id(at, 1, 3)).is_err(), "nor is a picture held elsewhere");
        assert!(read(&path, &id(at, 1, 4)).is_err(), "nor a document");
        assert!(read(&path, &id(at, 1, 5)).is_err());
        assert!(read(&path, &id(at, 2, 0)).is_err(), "only a tool result holds a screenshot");
        assert!(read(&path, &id(at, 0, 1)).is_err(), "a text block is no tool result");
        assert!(read(&path, &id(at + 9, 1, 1)).is_err(), "the middle of a line is not a line");
        assert!(read(&path, &id(0, 1, 1)).is_err(), "another line has no picture there");
        assert!(read(&path, &id(1 << 40, 1, 1)).is_err());
        assert!(read(&path, "nonsense").is_err());
        assert!(read(&dir.join("absent.jsonl"), &id(at, 1, 1)).is_err());
        let _ = std::fs::remove_dir_all(dir);
    }
}

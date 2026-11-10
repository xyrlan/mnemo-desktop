//! The insight's counters, read from the real transcripts of the machine this runs on.
//!
//! `tools/insight/check.mjs` runs this, counts the same bytes of the same files its own way,
//! and compares; it is what says in a pull request what was measured. By hand:
//!
//! ```sh
//! MNEMO_INSIGHT_PROBE_OUT=/tmp/insight.json cargo test --lib insight::probe -- --ignored --nocapture
//! ```
//!
//! `MNEMO_INSIGHT_PROBE_N` is how many transcripts, newest first (400). What it writes names
//! real sessions and paths: it stays on the machine.
//!
//! Besides writing what it read, it fails when a transcript read in three goes differs from
//! the same transcript read in one, when a screenshot it listed cannot be read back, or when a
//! session asked for by its id, as the front asks, has no answer.

use std::path::{Path, PathBuf};
use std::time::Instant;

use serde_json::{json, Value};

use super::session::Session;
use super::subagents::Subagents;
use super::tail::{Sink, Tail};
use super::{shot, Insight, InsightAsk, State};

/// A session read line by line, noting at each compaction what the context was said to be just
/// before it: `(preTokens, the last main call's size)`, as `measure_context.py` pairs them.
#[derive(Default)]
struct Reading {
    session: Session,
    measured: Vec<(u64, u64)>,
    /// `(compactions, main-chain messages)` when the last compaction was read.
    seen: (usize, u64),
}

impl Sink for Reading {
    fn restart(&mut self) {
        *self = Reading::default();
    }

    fn line(&mut self, offset: u64, raw: &str) {
        let before = self.session.context();
        self.session.line(offset, raw);
        let (compactions, pre) = self.session.compacted();
        if compactions == self.seen.0 {
            return;
        }
        // Only a compaction with a call since the one before has a call to hold against it.
        let main = self.session.messages().0;
        if let (Some(before), true, true) = (before, pre > 0, main != self.seen.1) {
            self.measured.push((pre, before));
        }
        self.seen = (compactions, main);
    }
}

/// Every account's transcripts, newest first.
fn transcripts() -> Vec<PathBuf> {
    let mut seen = std::collections::HashSet::new();
    let mut found: Vec<(std::time::SystemTime, PathBuf)> = Vec::new();
    for account in crate::mission::account_dirs::accounts().iter() {
        let projects = account.projects_dir();
        if !seen.insert(projects.canonicalize().unwrap_or_else(|_| projects.clone())) {
            continue;
        }
        for project in std::fs::read_dir(&projects).into_iter().flatten().flatten() {
            for file in std::fs::read_dir(project.path()).into_iter().flatten().flatten() {
                let path = file.path();
                if path.extension().is_some_and(|e| e == "jsonl") {
                    if let Ok(mtime) = file.metadata().and_then(|m| m.modified()) {
                        found.push((mtime, path));
                    }
                }
            }
        }
    }
    found.sort_by(|a, b| b.0.cmp(&a.0));
    found.into_iter().map(|(_, path)| path).collect()
}

/// Whether `data` opens as the picture `media_type` says it is.
fn is_picture(data: &str, media_type: &str) -> bool {
    use base64::Engine;
    let head: String = data.chars().take(16).collect();
    let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(head) else { return false };
    match media_type {
        "image/png" => bytes.starts_with(&[0x89, b'P', b'N', b'G']),
        "image/jpeg" => bytes.starts_with(&[0xff, 0xd8]),
        "image/webp" => bytes.starts_with(b"RIFF") && bytes[8..].starts_with(b"WEBP"),
        "image/gif" => bytes.starts_with(b"GIF8"),
        _ => !bytes.is_empty(),
    }
}

fn read(path: &Path, to: u64, cuts: &[u64]) -> (Reading, u64) {
    let (mut tail, mut reading) = (Tail::default(), Reading::default());
    for end in cuts.iter().chain([&to]) {
        tail.refresh_to(path, *end, &mut reading).unwrap();
    }
    (reading, tail.offset())
}

#[test]
#[ignore = "reads this machine's real transcripts; tools/insight/check.mjs runs it"]
fn real_transcripts() {
    let out = std::env::var_os("MNEMO_INSIGHT_PROBE_OUT").expect("MNEMO_INSIGHT_PROBE_OUT names the file to write");
    let n = std::env::var("MNEMO_INSIGHT_PROBE_N").ok().and_then(|n| n.parse().ok()).unwrap_or(400);
    let paths: Vec<PathBuf> = transcripts().into_iter().take(n).collect();
    let now = super::now_ms();

    let (mut rows, mut split, mut unreadable) = (Vec::new(), Vec::new(), Vec::new());
    let (mut bytes, mut read_ms) = (0u64, 0f64);
    for path in &paths {
        // The file as it is this moment: a live session's grows while this runs.
        let Ok(end) = std::fs::metadata(path).map(|m| m.len()) else { continue };
        let started = Instant::now();
        let (whole, offset) = read(path, end, &[]);
        let ms = started.elapsed().as_secs_f64() * 1000.0;
        bytes += offset;
        read_ms += ms;

        let mut subagents = Subagents::default();
        subagents.refresh(path, now);
        let build = |r: &Reading| r.session.insight(subagents.tokens(|key| r.session.counted(key)));
        let insight: Insight = build(&whole);

        // The same bytes in three goes, cut wherever a third and two thirds fall.
        let (parts, _) = read(path, end, &[end / 3, end / 3 * 2]);
        if build(&parts) != insight || parts.measured != whole.measured {
            split.push(path.display().to_string());
        }

        let mut shots_read = 0;
        for s in &insight.web.shots {
            match shot::read(path, &s.id) {
                Ok(data) if is_picture(&data, &s.media_type) => shots_read += 1,
                _ => unreadable.push(format!("{} {}", path.display(), s.id)),
            }
        }

        let (main, side) = whole.session.messages();
        rows.push(json!({
            "path": path,
            "bytes": offset,
            "ms": ms,
            "messages": { "main": main, "sidechain": side },
            "subagentFiles": subagents.read_to().into_iter().map(|(path, bytes)| json!({ "path": path, "bytes": bytes })).collect::<Vec<Value>>(),
            "measured": whole.measured,
            "shotsRead": shots_read,
            "insight": insight,
        }));
    }

    // The command's own way in, asked as the front asks: twenty sessions by their ids, found on
    // this machine's accounts, every three seconds. The first call reads them; the rest find
    // only what the live ones among them wrote meanwhile, which is what a poll costs.
    let asks: Vec<InsightAsk> = paths.iter().take(20).filter_map(|p| Some(InsightAsk { key: p.to_string_lossy().into_owned(), session_id: p.file_stem()?.to_str()?.to_string(), cwd: String::new(), account: "default".into() })).collect();
    let (mut state, deps) = (State::default(), super::live_deps());
    let first = state.answer(&asks, now, &deps);
    let unanswered: Vec<&str> = asks.iter().filter(|a| !first.contains_key(&a.key)).map(|a| a.key.as_str()).collect();
    let started = Instant::now();
    const POLLS: u64 = 50;
    for poll in 1..=POLLS {
        state.answer(&asks, now + poll * 3_000, &deps);
    }
    let poll_ms = started.elapsed().as_secs_f64() * 1000.0 / POLLS as f64;

    let report = json!({
        "transcripts": rows,
        "bytes": bytes,
        "readMs": read_ms,
        "debug": cfg!(debug_assertions),
        "poll": { "sessions": asks.len(), "ms": poll_ms },
        "splitDiffers": split,
        "shotsUnreadable": unreadable,
        "unanswered": unanswered,
    });
    std::fs::write(&out, serde_json::to_string(&report).unwrap()).unwrap();
    eprintln!("{} transcripts, {:.1} MB in {:.1} s; a poll of the {} newest sessions: {:.3} ms", paths.len(), bytes as f64 / 1e6, read_ms / 1000.0, asks.len(), poll_ms);
    assert!(split.is_empty(), "read in three goes, these differ from one go: {split:?}");
    assert!(unreadable.is_empty(), "listed screenshots that cannot be read back: {unreadable:?}");
    assert!(unanswered.is_empty(), "asked by session id, these had no answer: {unanswered:?}");
}

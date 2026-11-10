//! mnemo's five logs, a line at a time: what one file's lines add up to, per session and for
//! the vault.
//!
//! A line is read field by field out of whatever JSON it holds. One that is not an object, or
//! has no time, or lacks what makes it a row of its log, adds nothing; a field of another shape
//! than mnemo writes today is left out and the rest of the row stays. So a log from a newer
//! mnemo, a torn append, or the run of NUL bytes a crash left behind, costs its own line only.

use std::collections::{HashMap, VecDeque};

use serde_json::{Map, Value};

use super::{BriefingRead, Friction, LearnedRule, PulseEvent, RuleRead};
use crate::memory_feed::time_ms;
use crate::vault::rule_slug;

/// A session's newest prompts where mnemo stayed silent, at most.
pub const MAX_CONSIDERED: usize = 40;
/// The candidates of one such prompt, at most: mnemo logs its best three.
pub const MAX_CANDIDATES: usize = 3;
/// A correction's quote and its rule, at most: the ledger does not bound them.
pub const TEXT_CHARS: usize = 1000;

/// What one file's lines add up to. `offset_ms` reads a time written without a zone.
pub trait Sum: Default {
    fn line(&mut self, line: &[u8], offset_ms: i64);
}

type Row = Map<String, Value>;

/// mnemo reads its logs with undecodable bytes replaced, and so does this.
fn row(line: &[u8]) -> Option<Row> {
    match serde_json::from_str(&String::from_utf8_lossy(line)).ok()? {
        Value::Object(row) => Some(row),
        _ => None,
    }
}

fn text<'a>(row: &'a Row, key: &str) -> Option<&'a str> {
    row.get(key)?.as_str().filter(|s| !s.is_empty())
}

fn owned(row: &Row, key: &str) -> Option<String> {
    text(row, key).map(str::to_string)
}

fn at(row: &Row, key: &str, offset_ms: i64) -> Option<u64> {
    time_ms(text(row, key)?, offset_ms)
}

fn list(v: Option<&Value>) -> &[Value] {
    match v.and_then(Value::as_array) {
        Some(items) => items,
        None => &[],
    }
}

/// `[[id, number], …]`, as the reflex log writes its candidates and the judge's scores.
fn pairs(v: Option<&Value>) -> Vec<(&str, f64)> {
    list(v).iter().filter_map(|p| Some((p.get(0)?.as_str()?, p.get(1)?.as_f64()?))).collect()
}

fn clip(s: &str) -> String {
    match s.char_indices().nth(TEXT_CHARS - 1) {
        Some((cut, _)) if s[cut..].chars().nth(1).is_some() => format!("{}…", &s[..cut]),
        _ => s.to_string(),
    }
}

fn event(at: u64, kind: &str, id: &str, row: &Row) -> PulseEvent {
    PulseEvent { at, kind: kind.into(), slug: rule_slug(id).into(), session_id: owned(row, "session_id"), project: owned(row, "project") }
}

// -------------------------------------------------------------- reflex --

/// A rule as a reflex row names it: the id as logged, which may carry its project
/// (`<project>__<slug>`).
#[derive(Debug, Clone, PartialEq)]
pub struct Fire {
    pub at: u64,
    pub project: String,
    pub id: String,
    pub score: Option<f64>,
    pub judge: Option<f64>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Held {
    pub at: u64,
    pub project: String,
    pub reason: String,
    /// Id, retrieval score, the judge's.
    pub candidates: Vec<(String, f64, Option<f64>)>,
}

#[derive(Debug, Default)]
pub struct SessionReflex {
    pub prompts: u64,
    pub injected: Vec<Fire>,
    /// The newest `MAX_CONSIDERED`.
    pub held: VecDeque<Held>,
}

/// `reflex-log.jsonl`: one row per prompt mnemo looked at.
#[derive(Debug, Default)]
pub struct Reflex {
    pub sessions: HashMap<String, SessionReflex>,
    pub prompts: u64,
    pub outcomes: HashMap<String, u64>,
    /// The newest row's `thresholds.doc_count`.
    pub rules: Option<u64>,
    pub events: Vec<PulseEvent>,
}

impl Sum for Reflex {
    fn line(&mut self, line: &[u8], offset_ms: i64) {
        let Some(row) = row(line) else { return };
        let Some(at) = at(&row, "ts", offset_ms) else { return };
        // A rule's place in `emitted` is its place in `scores`.
        let emitted = list(row.get("emitted")).iter().enumerate();
        let emitted: Vec<(usize, &str)> = emitted.filter_map(|(i, v)| Some((i, v.as_str().filter(|id| !rule_slug(id).is_empty())?))).collect();
        // mnemo writes one or the other: a row with neither is not a prompt it looked at.
        let outcome = match (emitted.is_empty(), text(&row, "silence_reason")) {
            (false, _) => "emitted",
            (true, Some(reason)) => reason,
            (true, None) => return,
        };
        self.prompts += 1;
        *self.outcomes.entry(outcome.to_string()).or_default() += 1;
        if let Some(n) = row.get("thresholds").and_then(|t| t.get("doc_count")).and_then(Value::as_u64) {
            self.rules = Some(n);
        }
        self.events.extend(emitted.iter().map(|(_, id)| event(at, "injected", id, &row)));

        let Some(session) = text(&row, "session_id") else { return };
        let session = self.sessions.entry(session.to_string()).or_default();
        session.prompts += 1;
        let project = text(&row, "project").unwrap_or_default();
        let candidates = pairs(row.get("candidates"));
        let judged = pairs(row.get("judge").and_then(|j| j.get("scores")));
        let judge = |id: &str| judged.iter().find(|(j, _)| *j == id).map(|(_, n)| *n);
        if emitted.is_empty() {
            if candidates.is_empty() {
                return;
            }
            let candidates = candidates.iter().take(MAX_CANDIDATES).map(|(id, score)| (id.to_string(), *score, judge(id))).collect();
            session.held.push_back(Held { at, project: project.into(), reason: outcome.into(), candidates });
            if session.held.len() > MAX_CONSIDERED {
                session.held.pop_front();
            }
            return;
        }
        let scores = list(row.get("scores"));
        for (i, id) in emitted {
            let score = candidates.iter().find(|(c, _)| *c == id).map(|(_, n)| *n).or_else(|| scores.get(i)?.as_f64());
            session.injected.push(Fire { at, project: project.into(), id: id.into(), score, judge: judge(id) });
        }
    }
}

// -------------------------------------------------------------- access --

/// `mcp-access-log.jsonl`: the calls a session made to mnemo's MCP server, among mnemo's own
/// events (`session_start.inject`, `llm.call`), which are named with a dot and are no read.
#[derive(Debug, Default)]
pub struct Access {
    pub reads: HashMap<String, Vec<RuleRead>>,
    pub events: Vec<PulseEvent>,
}

impl Sum for Access {
    fn line(&mut self, line: &[u8], offset_ms: i64) {
        let Some(row) = row(line) else { return };
        let (Some(at), Some(tool)) = (at(&row, "timestamp", offset_ms), text(&row, "tool")) else { return };
        if tool.contains('.') {
            return;
        }
        let hits: Vec<String> = list(row.get("hit_slugs")).iter().filter_map(Value::as_str).map(|id| rule_slug(id).to_string()).filter(|s| !s.is_empty()).collect();
        // A listing is a search; the rule a session then read is what it took from the vault.
        if tool == "read_mnemo_rule" {
            self.events.extend(hits.iter().map(|slug| event(at, "read", slug, &row)));
        }
        let Some(session) = text(&row, "session_id") else { return };
        let arg = |key: &str| row.get("args")?.get(key)?.as_str().filter(|s| !s.is_empty()).map(str::to_string);
        let read = RuleRead { at, tool: tool.into(), slug: arg("slug"), topic: arg("topic"), query: arg("query"), hits, ms: row.get("elapsed_ms").and_then(Value::as_f64) };
        self.reads.entry(session.to_string()).or_default().push(read);
    }
}

// ----------------------------------------------------------- briefings --

/// `briefing-log.jsonl`: one row per briefing handed to a session, by the session that read it
/// (`reader_session_id`; `session_id` there is the session that wrote the briefing).
#[derive(Debug, Default)]
pub struct Briefings {
    pub read: HashMap<String, Vec<BriefingRead>>,
}

impl Sum for Briefings {
    fn line(&mut self, line: &[u8], offset_ms: i64) {
        let Some(row) = row(line) else { return };
        let (Some(at), Some(reader), Some(path)) = (at(&row, "timestamp", offset_ms), text(&row, "reader_session_id"), owned(&row, "path")) else { return };
        let (project, entries) = (owned(&row, "project").unwrap_or_default(), row.get("entries").and_then(Value::as_u64));
        let read = BriefingRead { at, project, date: owned(&row, "date"), path, source: owned(&row, "source"), entries };
        self.read.entry(reader.to_string()).or_default().push(read);
    }
}

// ----------------------------------------------------------- frictions --

/// `friction-ledger.jsonl`: the corrections mnemo wrote down, by the session they were given in.
#[derive(Debug, Default)]
pub struct Frictions {
    pub given: HashMap<String, Vec<Friction>>,
}

/// mnemo's `corrections.is_shell_turn`: a `!` command or its output is the maintainer acting,
/// not correcting. Rows quoting one are on disk from before mnemo refused them, and every
/// reader of the ledger skips them.
fn is_shell_turn(quote: &str) -> bool {
    let quote = quote.trim_start();
    ["<bash-input>", "<bash-stdout>", "<bash-stderr>"].iter().any(|tag| quote.get(..tag.len()).is_some_and(|q| q.eq_ignore_ascii_case(tag)))
}

impl Sum for Frictions {
    fn line(&mut self, line: &[u8], offset_ms: i64) {
        let Some(row) = row(line) else { return };
        let (Some(at), Some(session), Some(quote)) = (at(&row, "ts", offset_ms), text(&row, "session_id"), text(&row, "quote")) else { return };
        if is_shell_turn(quote) {
            return;
        }
        let friction = Friction { at, quote: clip(quote), rule: clip(text(&row, "rule_text").unwrap_or_default()), origin: owned(&row, "origin") };
        self.given.entry(session.to_string()).or_default().push(friction);
    }
}

// ------------------------------------------------------------- learned --

/// `learned.jsonl`: one row per page extraction promoted. Its times carry no zone, and `seq`
/// orders a batch that shares one.
#[derive(Debug, Default)]
pub struct Learned {
    pub rules: Vec<(u64, LearnedRule)>,
    pub events: Vec<PulseEvent>,
}

impl Sum for Learned {
    fn line(&mut self, line: &[u8], offset_ms: i64) {
        let Some(row) = row(line) else { return };
        let (Some(at), Some(slug)) = (at(&row, "ts", offset_ms), owned(&row, "slug")) else { return };
        let projects: Vec<String> = list(row.get("projects")).iter().filter_map(Value::as_str).filter(|p| !p.is_empty()).map(str::to_string).collect();
        self.events.push(PulseEvent { at, kind: "learned".into(), slug: slug.clone(), session_id: None, project: projects.first().cloned() });
        let name = owned(&row, "name").unwrap_or_else(|| slug.clone());
        self.rules.push((row.get("seq").and_then(Value::as_u64).unwrap_or(0), LearnedRule { at, slug, name, projects }));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ms(s: &str) -> u64 {
        crate::mission::iso_ms(s).unwrap()
    }

    fn sum<S: Sum>(lines: &[&str]) -> S {
        let mut sum = S::default();
        lines.iter().for_each(|l| sum.line(l.as_bytes(), 0));
        sum
    }

    // ---- reflex

    const EMITTED: &str = r#"{"session_id": "s1", "project": "app", "prompt_hash": "sha256:1", "emitted": ["app__alpha", "beta"], "scores": [5.5, 4.25], "silence_reason": null, "format": "full", "candidates": [["app__alpha", 5.5], ["gamma", 4.5], ["beta", 4.25]], "thresholds": {"doc_count": 4160}, "judge": {"status": "ok", "scores": [["app__alpha", 0.9], ["beta", 0.6], ["gamma", 0.1]]}, "ts": "2026-11-10T03:00:00Z"}"#;
    const SILENT: &str = r#"{"session_id": "s1", "project": "app", "prompt_tokens": 125, "emitted": [], "scores": [], "silence_reason": "judge_none_relevant", "candidates": [["app__alpha", 3.5], ["delta", 3.0], ["eps", 2.5], ["zeta", 2.0]], "thresholds": {"doc_count": 4161}, "judge": {"status": "ok", "scores": [["delta", 0.25]]}, "ts": "2026-11-10T03:01:00Z"}"#;
    const SHORT: &str = r#"{"session_id": "s1", "project": "app", "prompt_tokens": 1, "emitted": [], "scores": [], "silence_reason": "below_min_tokens", "ts": "2026-11-10T03:02:00Z"}"#;

    #[test]
    fn an_emitted_row_is_its_rules_with_their_scores() {
        let r: Reflex = sum(&[EMITTED]);
        let s = &r.sessions["s1"];
        let at = ms("2026-11-10T03:00:00Z");
        assert_eq!(s.prompts, 1);
        assert_eq!(s.injected, vec![
            Fire { at, project: "app".into(), id: "app__alpha".into(), score: Some(5.5), judge: Some(0.9) },
            Fire { at, project: "app".into(), id: "beta".into(), score: Some(4.25), judge: Some(0.6) },
        ]);
        assert!(s.held.is_empty());
        assert_eq!((r.prompts, r.rules), (1, Some(4160)));
        assert_eq!(r.outcomes, HashMap::from([("emitted".to_string(), 1)]));
        let alpha = PulseEvent { at, kind: "injected".into(), slug: "alpha".into(), session_id: Some("s1".into()), project: Some("app".into()) };
        assert_eq!(r.events, vec![alpha.clone(), PulseEvent { slug: "beta".into(), ..alpha }]);
    }

    #[test]
    fn the_newest_row_that_counts_the_rules_says_how_many() {
        assert_eq!(sum::<Reflex>(&[EMITTED, SILENT, SHORT]).rules, Some(4161));
        assert_eq!(sum::<Reflex>(&[SILENT, EMITTED, SHORT]).rules, Some(4160));
    }

    #[test]
    fn a_rule_no_candidate_names_takes_its_score_from_its_place() {
        let row = r#"{"session_id": "s", "emitted": ["one", "two"], "scores": [1.5, 2.5], "candidates": [["one", 9.0]], "ts": "2026-11-10T03:00:00Z"}"#;
        let r: Reflex = sum(&[row]);
        let got: Vec<_> = r.sessions["s"].injected.iter().map(|f| (f.id.as_str(), f.score, f.judge)).collect();
        assert_eq!(got, vec![("one", Some(9.0), None), ("two", Some(2.5), None)]);
    }

    #[test]
    fn a_silent_row_with_candidates_is_held_with_its_reason() {
        let r: Reflex = sum(&[SILENT, SHORT]);
        let s = &r.sessions["s1"];
        assert_eq!((s.prompts, s.injected.len()), (2, 0));
        // The best `MAX_CANDIDATES`; a row with no candidate holds nothing back.
        let candidates = vec![("app__alpha".into(), 3.5, None), ("delta".into(), 3.0, Some(0.25)), ("eps".into(), 2.5, None)];
        let held = Held { at: ms("2026-11-10T03:01:00Z"), project: "app".into(), reason: "judge_none_relevant".into(), candidates };
        assert_eq!(s.held, VecDeque::from([held]));
        assert_eq!(r.outcomes, HashMap::from([("judge_none_relevant".to_string(), 1), ("below_min_tokens".to_string(), 1)]));
        assert_eq!((r.prompts, r.rules), (2, Some(4161)));
        assert!(r.events.is_empty());
    }

    #[test]
    fn a_session_holds_its_newest_silences_only() {
        let rows: Vec<String> = (0..MAX_CONSIDERED + 5).map(|i| format!(r#"{{"session_id": "s", "emitted": [], "silence_reason": "deduped", "candidates": [["r{i}", 1.0]], "ts": "2026-11-10T03:{:02}:00Z"}}"#, i)).collect();
        let r: Reflex = sum(&rows.iter().map(String::as_str).collect::<Vec<_>>());
        let s = &r.sessions["s"];
        assert_eq!((s.prompts, s.held.len()), (MAX_CONSIDERED as u64 + 5, MAX_CONSIDERED));
        assert_eq!((s.held[0].candidates[0].0.as_str(), s.held[MAX_CONSIDERED - 1].candidates[0].0.as_str()), ("r5", "r44"));
    }

    #[test]
    fn reflex_rows_mnemo_did_not_write_this_way() {
        let r: Reflex = sum(&[
            "not json",
            "\0\0\0\0",
            "[1, 2]",
            // No time; a time that is none; neither rules nor a reason.
            r#"{"session_id": "s", "emitted": ["a"]}"#,
            r#"{"session_id": "s", "emitted": ["a"], "ts": "yesterday"}"#,
            r#"{"session_id": "s", "emitted": [], "silence_reason": null, "ts": "2026-11-10T03:00:00Z"}"#,
        ]);
        assert_eq!((r.prompts, r.sessions.len(), r.events.len()), (0, 0, 0));

        // Fields of another shape are left out, and the row still counts.
        let r: Reflex = sum(&[
            concat!(r#"{"session_id": "s", "project": 7, "emitted": ["a", 3, "x__"], "scores": "high", "candidates": {"a": 1}, "#, r#""judge": [], "thresholds": [], "ts": "2026-11-10T03:00:00Z"}"#, "\r"),
            r#"{"emitted": [], "silence_reason": "deduped", "candidates": [["a"], "b", ["c", 2.0]], "ts": "2026-11-10T03:00:01Z"}"#,
            r#"{"session_id": "t", "emitted": [], "silence_reason": "deduped", "candidates": [["a"], "b", ["c", 2.0]], "ts": "2026-11-10T03:00:02Z"}"#,
        ]);
        assert_eq!((r.prompts, r.rules), (3, None));
        assert_eq!(r.sessions["s"].injected, vec![Fire { at: ms("2026-11-10T03:00:00Z"), project: String::new(), id: "a".into(), score: None, judge: None }]);
        assert_eq!(r.events.len(), 1);
        assert_eq!((r.events[0].slug.as_str(), &r.events[0].project), ("a", &None));
        // A row with no session is the vault's alone.
        assert_eq!(r.outcomes, HashMap::from([("emitted".to_string(), 1), ("deduped".to_string(), 2)]));
        assert_eq!(r.sessions["t"].held[0].candidates, vec![("c".to_string(), 2.0, None)]);
    }

    // ---- access

    #[test]
    fn a_session_s_reads_are_its_own_calls() {
        let a: Access = sum(&[
            r#"{"timestamp": "2026-11-10T03:06:40Z", "tool": "list_rules_by_topic", "args": {"topic": "windows", "query": "named pipe", "scope": "project"}, "project": "app", "session_id": "s1", "result_count": 2, "hit_slugs": ["app__alpha", "beta"], "elapsed_ms": 4313.76}"#,
            r#"{"timestamp": "2026-11-10T03:06:44Z", "tool": "read_mnemo_rule", "args": {"slug": "app__alpha", "scope": "project"}, "project": "app", "session_id": "s1", "result_count": 1, "hit_slugs": ["app__alpha"], "elapsed_ms": 23}"#,
            r#"{"timestamp": "2026-11-10T03:06:45Z", "tool": "get_mnemo_topics", "args": {"scope": "project"}, "project": "app", "session_id": "s1", "result_count": 30}"#,
            r#"{"timestamp": "2026-11-10T03:06:10Z", "tool": "session_start.inject", "envelope_bytes": 5423, "project": "app", "session_id": "s1", "result_count": 1}"#,
            r#"{"timestamp": "2026-11-10T02:29:29Z", "tool": "llm.call", "purpose": "briefing", "project": "app", "elapsed_ms": 22601.9, "result_count": 1}"#,
            r#"{"timestamp": "2026-11-10T03:07:00Z", "tool": "read_mnemo_rule", "args": {"slug": "No such rule"}, "project": "app", "session_id": "s2", "result_count": 0, "hit_slugs": []}"#,
            r#"{"timestamp": "2026-11-10T03:08:00Z", "tool": "read_mnemo_rule", "args": "beta", "project": "web", "hit_slugs": ["beta"]}"#,
            r#"{"tool": "read_mnemo_rule", "session_id": "s1", "hit_slugs": ["no-time"]}"#,
            "\0\0\0",
        ]);
        let none = || RuleRead::default();
        assert_eq!(a.reads["s1"], vec![
            RuleRead {
                at: ms("2026-11-10T03:06:40Z"),
                tool: "list_rules_by_topic".into(),
                topic: Some("windows".into()),
                query: Some("named pipe".into()),
                hits: vec!["alpha".into(), "beta".into()],
                ms: Some(4313.76),
                ..none()
            },
            RuleRead { at: ms("2026-11-10T03:06:44Z"), tool: "read_mnemo_rule".into(), slug: Some("app__alpha".into()), hits: vec!["alpha".into()], ms: Some(23.0), ..none() },
            RuleRead { at: ms("2026-11-10T03:06:45Z"), tool: "get_mnemo_topics".into(), ..none() },
        ]);
        assert_eq!(a.reads["s2"], vec![RuleRead { at: ms("2026-11-10T03:07:00Z"), tool: "read_mnemo_rule".into(), slug: Some("No such rule".into()), ..none() }]);
        assert_eq!(a.reads.len(), 2);
        // The vault's events are the rules read: a listing, and a read that hit nothing, are none.
        let got: Vec<_> = a.events.iter().map(|e| (e.kind.as_str(), e.slug.as_str(), e.session_id.as_deref(), e.project.as_deref())).collect();
        assert_eq!(got, vec![("read", "alpha", Some("s1"), Some("app")), ("read", "beta", None, Some("web"))]);
    }

    // ---- briefings

    #[test]
    fn a_briefing_belongs_to_the_session_that_read_it() {
        let b: Briefings = sum(&[
            r#"{"timestamp": "2026-11-10T03:06:10Z", "project": "app", "path": "bots/app/briefings/sessions/w1.md", "session_id": "w1", "date": "2026-10-24", "body_bytes": 5142, "reader_session_id": "s1", "source": "startup", "mode": "index", "entries": 10, "index_bytes": 4887}"#,
            r#"{"timestamp": "2026-11-10T03:06:10Z", "path": "bots/app/briefings/sessions/w2.md", "session_id": "w2", "date": "", "reader_session_id": "s1", "source": null, "entries": null}"#,
            r#"{"timestamp": "2026-11-10T03:06:10Z", "project": "app", "path": "bots/app/briefings/sessions/w3.md", "session_id": "s1", "reader_session_id": null}"#,
            r#"{"timestamp": "2026-11-10T03:06:10Z", "project": "app", "session_id": "w4", "reader_session_id": "s1"}"#,
            r#"{"project": "app", "path": "p.md", "reader_session_id": "s1"}"#,
        ]);
        let at = ms("2026-11-10T03:06:10Z");
        assert_eq!(b.read["s1"], vec![
            BriefingRead { at, project: "app".into(), date: Some("2026-10-24".into()), path: "bots/app/briefings/sessions/w1.md".into(), source: Some("startup".into()), entries: Some(10) },
            BriefingRead { at, path: "bots/app/briefings/sessions/w2.md".into(), ..Default::default() },
        ]);
        assert_eq!(b.read.len(), 1);
    }

    // ---- frictions

    #[test]
    fn a_friction_is_a_correction_not_a_shell_turn() {
        let long = "é".repeat(TEXT_CHARS + 1);
        let exact = "é".repeat(TEXT_CHARS);
        let f: Frictions = sum(&[
            r#"{"id": "f-1", "ts": "2026-11-09T23:10:29Z", "session_id": "s1", "project": "app", "quote": "Reply with the word OK", "rule_text": "Reply with only OK", "origin": "user", "turn_index": 0}"#,
            r#"{"ts": "2026-11-09T23:11:00Z", "session_id": "s1", "quote": "  <Bash-Input>gh pr merge 1 --admin</bash-input>", "rule_text": "x"}"#,
            r#"{"ts": "2026-11-09T23:11:01Z", "session_id": "s1", "quote": "<bash-stdout>ok</bash-stdout>", "rule_text": "x"}"#,
            r#"{"ts": "2026-11-09T23:12:00Z", "session_id": "s1", "quote": "", "rule_text": "no quote"}"#,
            r#"{"ts": "2026-11-09T23:12:00Z", "quote": "no session", "rule_text": "x"}"#,
            &format!(r#"{{"ts": "2026-11-09T23:13:00Z", "session_id": "s1", "quote": "{long}", "rule_text": "{exact}", "origin": 3}}"#),
        ]);
        let got = &f.given["s1"];
        assert_eq!(got[0], Friction { at: ms("2026-11-09T23:10:29Z"), quote: "Reply with the word OK".into(), rule: "Reply with only OK".into(), origin: Some("user".into()) });
        assert_eq!(got.len(), 2);
        assert_eq!((got[1].quote.chars().count(), got[1].quote.chars().last()), (TEXT_CHARS, Some('…')));
        assert_eq!((&got[1].rule, &got[1].origin), (&exact, &None));
        assert_eq!(f.given.len(), 1);
    }

    // ------------------------------------------------------------- learned

    #[test]
    fn a_learned_row_s_time_is_local() {
        let mut l = Learned::default();
        for line in [
            r#"{"seq": 7, "ts": "2026-10-18T23:41:32", "run_id": "r", "slug": "windows-fixes", "type": "reference", "name": "Windows fixes", "projects": ["app", "web"], "confidence": "inferred", "quote": null}"#,
            r#"{"ts": "2026-10-18T23:41:33", "slug": "bare", "projects": "app"}"#,
            r#"{"seq": 9, "ts": "2026-10-18T23:41:34", "name": "No slug", "projects": ["app"]}"#,
            r#"{"seq": 10, "slug": "no-time", "projects": ["app"]}"#,
        ] {
            l.line(line.as_bytes(), -3 * 3_600_000);
        }
        let at = ms("2026-10-19T02:41:32Z");
        assert_eq!(l.rules, vec![
            (7, LearnedRule { at, slug: "windows-fixes".into(), name: "Windows fixes".into(), projects: vec!["app".into(), "web".into()] }),
            (0, LearnedRule { at: at + 1000, slug: "bare".into(), name: "bare".into(), projects: vec![] }),
        ]);
        assert_eq!(l.events, vec![
            PulseEvent { at, kind: "learned".into(), slug: "windows-fixes".into(), session_id: None, project: Some("app".into()) },
            PulseEvent { at: at + 1000, kind: "learned".into(), slug: "bare".into(), session_id: None, project: None },
        ]);
    }
}

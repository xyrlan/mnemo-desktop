//! The vault's logs as last read, and the answers put together from them.
//!
//! `Store` holds one `Log` per log under the vault's `.mnemo/`. Each answer first polls the
//! five (a `stat` per file when nothing was written, `tail.rs`), then reads the sums: a
//! session's trail is a lookup by its id in each, the pulse a pass over the vault's counters.
//! Nothing is kept of an answer, so one is always what the files say now.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use super::logs::{Access, Briefings, Frictions, Learned, Reflex, Sum, MAX_CONSIDERED};
use super::tail::{Io, Log};
use super::{Candidate, Considered, Injected, LearnedRule, PulseEvent, Trail, VaultPulse};
use crate::memory_feed::rule_name;
use crate::vault::rule_slug;

/// The pulse's newest learned rules, and its newest events, at most.
pub const MAX_LEARNED: usize = 40;
pub const MAX_RECENT: usize = 200;
/// How long a rule's name is kept before its page is read again.
pub const NAME_TTL: Duration = Duration::from_secs(300);
/// Names kept, at most, before the stale ones are dropped.
const MAX_NAMES: usize = 8192;

const REFLEX: &str = "reflex-log.jsonl";
const ACCESS: &str = "mcp-access-log.jsonl";
const BRIEFINGS: &str = "briefing-log.jsonl";
const FRICTIONS: &str = "friction-ledger.jsonl";
/// Rewritten in place when it grows (mnemo's `learned.MAX_BYTES`), so there is no `.1`.
const LEARNED: &str = "learned.jsonl";

/// A rule's name by the project and id a log row gave: `rule_name` opens up to thirteen files
/// to find one, and a trail names the same few rules on every poll.
#[derive(Debug, Default)]
struct Names {
    found: HashMap<(String, String), (Option<String>, Instant)>,
}

impl Names {
    fn of(&mut self, root: &Path, project: &str, id: &str, now: Instant) -> Option<String> {
        let key = (project.to_string(), id.to_string());
        if let Some((name, read)) = self.found.get(&key) {
            if now.saturating_duration_since(*read) < NAME_TTL {
                return name.clone();
            }
        }
        let name = rule_name(root, project, id);
        self.found.insert(key, (name.clone(), now));
        name
    }

    fn prune(&mut self, now: Instant) {
        if self.found.len() > MAX_NAMES {
            self.found.retain(|_, (_, read)| now.saturating_duration_since(*read) < NAME_TTL);
        }
    }
}

#[derive(Debug)]
pub struct Store {
    root: PathBuf,
    /// This machine's offset from UTC, for the times the learned ledger writes without a zone.
    offset_ms: i64,
    reflex: Log<Reflex>,
    access: Log<Access>,
    briefings: Log<Briefings>,
    frictions: Log<Frictions>,
    learned: Log<Learned>,
    names: Names,
    /// What every poll so far cost.
    pub io: Io,
}

fn poll<S: Sum>(log: &mut Log<S>, dir: &Path, name: &str, rotates: bool, io: &mut Io, offset_ms: i64) {
    let rotated = rotates.then(|| dir.join(format!("{name}.1")));
    log.poll(rotated.as_deref(), &dir.join(name), io, |sum, line| sum.line(line, offset_ms));
}

impl Store {
    pub fn new(root: PathBuf, offset_ms: i64) -> Store {
        Store {
            root,
            offset_ms,
            reflex: Log::default(),
            access: Log::default(),
            briefings: Log::default(),
            frictions: Log::default(),
            learned: Log::default(),
            names: Names::default(),
            io: Io::default(),
        }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    fn refresh(&mut self) {
        let dir = self.root.join(".mnemo");
        let (io, offset) = (&mut self.io, self.offset_ms);
        poll(&mut self.reflex, &dir, REFLEX, true, io, offset);
        poll(&mut self.access, &dir, ACCESS, true, io, offset);
        poll(&mut self.briefings, &dir, BRIEFINGS, true, io, offset);
        poll(&mut self.frictions, &dir, FRICTIONS, true, io, offset);
        poll(&mut self.learned, &dir, LEARNED, false, io, offset);
    }

    /// Each of `ids`' trails from the logs as they are now. `now` ages the names kept.
    pub fn trails(&mut self, ids: &[String], now: Instant) -> HashMap<String, Trail> {
        self.refresh();
        let trails = ids.iter().map(|id| (id.clone(), self.trail(id, now))).collect();
        self.names.prune(now);
        trails
    }

    fn trail(&mut self, id: &str, now: Instant) -> Trail {
        let Store { root, reflex, access, briefings, frictions, names, .. } = self;
        let mut name = |project: &str, rule: &str| names.of(root, project, rule, now);
        let mut trail = Trail::default();
        let mut held = Vec::new();
        for session in reflex.sums().iter().filter_map(|sum| sum.sessions.get(id)) {
            trail.prompts += session.prompts;
            held.extend(&session.held);
            for fire in &session.injected {
                trail.injected.push(Injected { at: fire.at, slug: rule_slug(&fire.id).into(), name: name(&fire.project, &fire.id), score: fire.score, judge: fire.judge });
            }
        }
        // Stable sorts: rows of one second stay in the order mnemo wrote them.
        held.sort_by_key(|h| h.at);
        for h in &held[held.len().saturating_sub(MAX_CONSIDERED)..] {
            let named = |(rule, score, judge): &(String, f64, Option<f64>)| Candidate { slug: rule_slug(rule).into(), name: name(&h.project, rule), score: *score, judge: *judge };
            trail.considered.push(Considered { at: h.at, reason: h.reason.clone(), candidates: h.candidates.iter().map(named).collect() });
        }
        trail.read.extend(access.sums().iter().filter_map(|sum| sum.reads.get(id)).flatten().cloned());
        trail.briefings.extend(briefings.sums().iter().filter_map(|sum| sum.read.get(id)).flatten().cloned());
        trail.frictions.extend(frictions.sums().iter().filter_map(|sum| sum.given.get(id)).flatten().cloned());
        trail.injected.sort_by_key(|x| x.at);
        trail.read.sort_by_key(|x| x.at);
        trail.briefings.sort_by_key(|x| x.at);
        trail.frictions.sort_by_key(|x| x.at);
        trail
    }

    /// The vault as a whole. `recent` is the newest `MAX_RECENT` events at or after `since`.
    pub fn pulse(&mut self, since: Option<u64>) -> VaultPulse {
        self.refresh();
        let mut pulse = VaultPulse::default();
        for sum in self.reflex.sums() {
            pulse.prompts += sum.prompts;
            pulse.rules = sum.rules.or(pulse.rules);
            for (outcome, n) in &sum.outcomes {
                *pulse.outcomes.entry(outcome.clone()).or_default() += n;
            }
        }

        // Newest first by time, then `seq`, then place in the file; one row per rule.
        let mut learned: Vec<&(u64, LearnedRule)> = self.learned.sums().into_iter().flat_map(|sum| &sum.rules).collect();
        learned.sort_by_key(|(seq, rule)| (rule.at, *seq));
        let mut seen = HashSet::new();
        pulse.learned = learned.iter().rev().filter(|(_, rule)| seen.insert(&rule.slug)).take(MAX_LEARNED).map(|(_, rule)| rule.clone()).collect();
        pulse.learned.reverse();

        let since = since.unwrap_or(0);
        let (injected, read, learned) = (self.reflex.sums().map(|s| &s.events), self.access.sums().map(|s| &s.events), self.learned.sums().map(|s| &s.events));
        let mut recent: Vec<&PulseEvent> = injected.into_iter().chain(read).chain(learned).flatten().filter(|e| e.at >= since).collect();
        recent.sort_by_key(|e| e.at);
        pulse.recent = recent[recent.len().saturating_sub(MAX_RECENT)..].iter().map(|e| (*e).clone()).collect();
        pulse
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::temp_dir;

    fn ms(s: &str) -> u64 {
        crate::mission::iso_ms(s).unwrap()
    }

    fn append(root: &Path, rel: &str, text: &str) {
        use std::io::Write;
        let path = root.join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::OpenOptions::new().create(true).append(true).open(path).unwrap().write_all(text.as_bytes()).unwrap();
    }

    fn ids(ids: &[&str]) -> Vec<String> {
        ids.iter().map(|s| s.to_string()).collect()
    }

    fn emitted(session: &str, rule: &str, ts: &str) -> String {
        format!(r#"{{"session_id": "{session}", "project": "app", "emitted": ["{rule}"], "scores": [5.5], "silence_reason": null, "candidates": [["{rule}", 5.5]], "thresholds": {{"doc_count": 12}}, "judge": {{"scores": [["{rule}", 0.75]]}}, "ts": "{ts}"}}"#) + "\n"
    }

    fn silent(session: &str, rule: &str, ts: &str) -> String {
        format!(r#"{{"session_id": "{session}", "project": "app", "emitted": [], "silence_reason": "judge_none_relevant", "candidates": [["{rule}", 3.5]], "ts": "{ts}"}}"#) + "\n"
    }

    fn read(session: &str, rule: &str, ts: &str) -> String {
        format!(r#"{{"timestamp": "{ts}", "tool": "read_mnemo_rule", "args": {{"slug": "{rule}"}}, "project": "app", "session_id": "{session}", "hit_slugs": ["{rule}"], "elapsed_ms": 2.5}}"#) + "\n"
    }

    /// A vault with every log, a rotation of two, and two sessions.
    fn vault(tag: &str) -> PathBuf {
        let root = temp_dir(tag);
        append(&root, "bots/app/memory/alpha.md", "---\nname: Alpha rule\n---\nbody\n");
        append(&root, "shared/feedback/beta.md", "---\nname: Beta rule\n---\n");
        append(&root, ".mnemo/reflex-log.jsonl.1", &(emitted("s1", "app__alpha", "2026-11-09T10:00:00Z") + &silent("s2", "beta", "2026-11-09T10:01:00Z")));
        append(&root, ".mnemo/reflex-log.jsonl", &(silent("s1", "beta", "2026-11-10T10:00:00Z") + &emitted("s1", "gamma", "2026-11-10T10:05:00Z")));
        append(&root, ".mnemo/mcp-access-log.jsonl.1", &read("s1", "beta", "2026-11-09T10:02:00Z"));
        append(&root, ".mnemo/mcp-access-log.jsonl", &read("s2", "alpha", "2026-11-10T10:06:00Z"));
        append(&root, ".mnemo/briefing-log.jsonl", "{\"timestamp\": \"2026-11-09T09:59:00Z\", \"project\": \"app\", \"path\": \"bots/app/briefings/sessions/w.md\", \"date\": \"2026-11-08\", \"reader_session_id\": \"s1\", \"source\": \"startup\", \"entries\": 1}\r\n");
        append(&root, ".mnemo/friction-ledger.jsonl", "{\"ts\": \"2026-11-10T10:07:00Z\", \"session_id\": \"s1\", \"quote\": \"No, in English\", \"rule_text\": \"Answer in English\", \"origin\": \"user\"}\n");
        append(&root, ".mnemo/learned.jsonl", "{\"seq\": 1, \"ts\": \"2026-11-08T07:00:00\", \"slug\": \"alpha\", \"name\": \"Alpha rule\", \"projects\": [\"app\"]}\n");
        // mnemo rewrites this ledger in place: a `.1` beside it is not its rotation.
        append(&root, ".mnemo/learned.jsonl.1", "{\"seq\": 9, \"ts\": \"2026-11-09T07:00:00\", \"slug\": \"stale\", \"name\": \"Stale\", \"projects\": [\"app\"]}\n");
        root
    }

    #[test]
    fn a_trail_is_everything_the_logs_join_to_the_session() {
        let mut store = Store::new(vault("trail-whole"), 0);
        let got = store.trails(&ids(&["s1", "nobody"]), Instant::now());
        assert_eq!(got.len(), 2);
        assert_eq!(got["nobody"], Trail::default());
        let t = &got["s1"];
        assert_eq!(t.prompts, 3);
        // Across the rotation, oldest first, named from the rule's page.
        assert_eq!(t.injected, vec![
            Injected { at: ms("2026-11-09T10:00:00Z"), slug: "alpha".into(), name: Some("Alpha rule".into()), score: Some(5.5), judge: Some(0.75) },
            Injected { at: ms("2026-11-10T10:05:00Z"), slug: "gamma".into(), name: None, score: Some(5.5), judge: Some(0.75) },
        ]);
        let beta = Candidate { slug: "beta".into(), name: Some("Beta rule".into()), score: 3.5, judge: None };
        assert_eq!(t.considered, vec![Considered { at: ms("2026-11-10T10:00:00Z"), reason: "judge_none_relevant".into(), candidates: vec![beta] }]);
        assert_eq!(t.read.iter().map(|r| (r.at, r.hits.clone())).collect::<Vec<_>>(), vec![(ms("2026-11-09T10:02:00Z"), vec!["beta".to_string()])]);
        assert_eq!(t.briefings.iter().map(|b| (b.path.as_str(), b.entries)).collect::<Vec<_>>(), vec![("bots/app/briefings/sessions/w.md", Some(1))]);
        assert_eq!(t.frictions.iter().map(|f| f.rule.as_str()).collect::<Vec<_>>(), vec!["Answer in English"]);
    }

    #[test]
    fn a_trail_keeps_the_newest_silences_across_the_rotation() {
        let root = temp_dir("trail-considered");
        let row = |i: usize| silent("s", &format!("r{i}"), &format!("2026-11-10T10:{i:02}:00Z"));
        append(&root, ".mnemo/reflex-log.jsonl.1", &(0..30).map(row).collect::<String>());
        append(&root, ".mnemo/reflex-log.jsonl", &(30..50).map(row).collect::<String>());
        let t = store_of(&root).trails(&ids(&["s"]), Instant::now()).remove("s").unwrap();
        assert_eq!((t.prompts, t.considered.len()), (50, MAX_CONSIDERED));
        assert_eq!((t.considered[0].candidates[0].slug.as_str(), t.considered[MAX_CONSIDERED - 1].candidates[0].slug.as_str()), ("r10", "r49"));
    }

    fn store_of(root: &Path) -> Store {
        Store::new(root.to_path_buf(), 0)
    }

    #[test]
    fn rows_out_of_time_order_are_put_in_it() {
        let root = temp_dir("trail-order");
        // A clock set back: in each log the later row is the older one.
        let (late, early) = ("2026-11-10T10:05:00Z", "2026-11-10T10:00:00Z");
        append(&root, ".mnemo/reflex-log.jsonl", &[emitted("s", "late", late), silent("s", "late", late), emitted("s", "early", early), silent("s", "early", early)].concat());
        append(&root, ".mnemo/mcp-access-log.jsonl", &(read("s", "late", late) + &read("s", "early", early)));
        for (name, at) in [("late", late), ("early", early)] {
            append(&root, ".mnemo/briefing-log.jsonl", &format!("{{\"timestamp\": \"{at}\", \"project\": \"app\", \"path\": \"{name}.md\", \"reader_session_id\": \"s\"}}\n"));
            append(&root, ".mnemo/friction-ledger.jsonl", &format!("{{\"ts\": \"{at}\", \"session_id\": \"s\", \"quote\": \"{name}\", \"rule_text\": \"{name}\"}}\n"));
        }
        let t = store_of(&root).trails(&ids(&["s"]), Instant::now()).remove("s").unwrap();
        let want = vec!["early", "late"];
        assert_eq!(t.injected.iter().map(|x| x.slug.as_str()).collect::<Vec<_>>(), want);
        assert_eq!(t.considered.iter().map(|x| x.candidates[0].slug.as_str()).collect::<Vec<_>>(), want);
        assert_eq!(t.read.iter().map(|x| x.hits[0].as_str()).collect::<Vec<_>>(), want);
        assert_eq!(t.briefings.iter().map(|x| x.path.as_str()).collect::<Vec<_>>(), vec!["early.md", "late.md"]);
        assert_eq!(t.frictions.iter().map(|x| x.quote.as_str()).collect::<Vec<_>>(), want);
    }

    #[test]
    fn the_pulse_counts_the_rules_as_the_newest_row_that_says() {
        let root = temp_dir("pulse-rules");
        let counted = |n: u64, ts: &str| emitted("s", "a", ts).replace("\"doc_count\": 12", &format!("\"doc_count\": {n}"));
        append(&root, ".mnemo/reflex-log.jsonl.1", &counted(11, "2026-11-09T10:00:00Z"));
        append(&root, ".mnemo/reflex-log.jsonl", &silent("s", "a", "2026-11-10T10:00:00Z"));
        assert_eq!(store_of(&root).pulse(None).rules, Some(11));
        append(&root, ".mnemo/reflex-log.jsonl", &counted(13, "2026-11-10T10:01:00Z"));
        assert_eq!(store_of(&root).pulse(None).rules, Some(13));
    }

    #[test]
    fn asking_again_with_nothing_new_reads_nothing() {
        let root = vault("trail-idle");
        let mut store = store_of(&root);
        let now = Instant::now();
        let first = store.trails(&ids(&["s1", "s2"]), now);
        let pulse = store.pulse(None);
        let cost = store.io;
        assert!(cost.opens >= 7 && cost.bytes > 1000, "{cost:?}");
        for _ in 0..3 {
            assert_eq!(store.trails(&ids(&["s1", "s2"]), now), first);
            assert_eq!(store.pulse(None), pulse);
        }
        assert_eq!(store.io, cost);
    }

    #[test]
    fn a_new_row_reaches_the_next_answer_and_only_it_is_read() {
        let root = vault("trail-append");
        let mut store = store_of(&root);
        let now = Instant::now();
        store.trails(&ids(&["s1"]), now);
        let before = store.io;
        let row = emitted("s1", "beta", "2026-11-10T11:00:00Z");
        append(&root, ".mnemo/reflex-log.jsonl", &row);
        let t = store.trails(&ids(&["s1"]), now).remove("s1").unwrap();
        assert_eq!((t.prompts, t.injected.len()), (4, 3));
        assert_eq!((t.injected[2].slug.as_str(), t.injected[2].name.as_deref()), ("beta", Some("Beta rule")));
        assert_eq!(store.io, Io { opens: before.opens + 1, bytes: before.bytes + row.len() as u64 });
    }

    #[test]
    fn a_rotation_drops_what_mnemo_dropped_and_keeps_the_rest() {
        let root = vault("trail-rotate");
        let mut store = store_of(&root);
        let now = Instant::now();
        assert_eq!(store.trails(&ids(&["s1"]), now)["s1"].prompts, 3);
        // mnemo renames the live log over `.1` and starts a new one.
        let dir = root.join(".mnemo");
        std::fs::rename(dir.join(REFLEX), dir.join(format!("{REFLEX}.1"))).unwrap();
        append(&root, ".mnemo/reflex-log.jsonl", &emitted("s1", "beta", "2026-11-10T12:00:00Z"));
        let t = store.trails(&ids(&["s1"]), now).remove("s1").unwrap();
        assert_eq!(t.prompts, 3);
        assert_eq!(t.injected.iter().map(|i| i.slug.as_str()).collect::<Vec<_>>(), vec!["gamma", "beta"]);
        // And it is what a store that starts now reads.
        assert_eq!(store_of(&root).trails(&ids(&["s1"]), now)["s1"], t);
        assert_eq!(store.pulse(None), store_of(&root).pulse(None));
    }

    #[test]
    fn a_name_is_read_from_its_page_again_when_it_has_aged() {
        let root = vault("trail-names");
        let mut store = store_of(&root);
        let start = Instant::now();
        let name = |store: &mut Store, at: Instant| store.trails(&ids(&["s1"]), at).remove("s1").unwrap().injected[0].name.clone();
        assert_eq!(name(&mut store, start).as_deref(), Some("Alpha rule"));
        std::fs::write(root.join("bots/app/memory/alpha.md"), "---\nname: Alpha, renamed\n---\n").unwrap();
        assert_eq!(name(&mut store, start + NAME_TTL - Duration::from_secs(1)).as_deref(), Some("Alpha rule"));
        assert_eq!(name(&mut store, start + NAME_TTL).as_deref(), Some("Alpha, renamed"));
    }

    #[test]
    fn the_pulse_is_the_vault_as_a_whole() {
        let mut store = store_of(&vault("pulse-whole"));
        let p = store.pulse(None);
        assert_eq!((p.rules, p.prompts), (Some(12), 4));
        assert_eq!(p.outcomes, HashMap::from([("emitted".to_string(), 2), ("judge_none_relevant".to_string(), 2)]));
        assert_eq!(p.learned, vec![LearnedRule { at: ms("2026-11-08T07:00:00Z"), slug: "alpha".into(), name: "Alpha rule".into(), projects: vec!["app".into()] }]);
        let recent: Vec<_> = p.recent.iter().map(|e| (e.kind.as_str(), e.slug.as_str(), e.session_id.as_deref())).collect();
        assert_eq!(recent, vec![("learned", "alpha", None), ("injected", "alpha", Some("s1")), ("read", "beta", Some("s1")), ("injected", "gamma", Some("s1")), ("read", "alpha", Some("s2"))]);
        assert!(p.recent.windows(2).all(|w| w[0].at <= w[1].at));

        // `since` keeps the events at or after it.
        let since = ms("2026-11-10T10:05:00Z");
        let later: Vec<_> = store.pulse(Some(since)).recent.iter().map(|e| e.slug.clone()).collect();
        assert_eq!(later, vec!["gamma", "alpha"]);
        assert!(store.pulse(Some(since + 60_001)).recent.is_empty());
    }

    #[test]
    fn the_pulse_reads_the_learned_ledger_s_local_times() {
        let mut store = Store::new(vault("pulse-offset"), -3 * 3_600_000);
        assert_eq!(store.pulse(None).learned[0].at, ms("2026-11-08T10:00:00Z"));
    }

    #[test]
    fn the_pulse_keeps_the_newest_of_each_list() {
        let root = temp_dir("pulse-caps");
        let reflex: String = (0..MAX_RECENT + 20).map(|i| emitted("s", &format!("r{i}"), &format!("2026-11-10T{:02}:{:02}:00Z", i / 60, i % 60))).collect();
        append(&root, ".mnemo/reflex-log.jsonl", &reflex);
        // One batch shares a time and `seq` orders it; a rule learned again is listed once, as last learned.
        let learned: String = (0..MAX_LEARNED + 5).map(|i| format!("{{\"seq\": {}, \"ts\": \"2026-11-01T00:00:00\", \"slug\": \"l{i}\", \"name\": \"L{i}\", \"projects\": []}}\n", 100 - i)).collect();
        append(&root, ".mnemo/learned.jsonl", &(learned + "{\"seq\": 200, \"ts\": \"2026-11-02T00:00:00\", \"slug\": \"l30\", \"name\": \"L30 again\", \"projects\": []}\n"));
        let p = store_of(&root).pulse(None);
        assert_eq!(p.recent.len(), MAX_RECENT);
        assert_eq!((p.recent[0].slug.as_str(), p.recent[MAX_RECENT - 1].slug.as_str()), ("r20", "r219"));
        assert_eq!(p.learned.len(), MAX_LEARNED);
        let names: Vec<_> = p.learned.iter().map(|l| l.name.as_str()).collect();
        // Oldest first: the highest `seq` is the newest of the batch, and `l30` moved to the end.
        assert_eq!((names[0], names[MAX_LEARNED - 2], names[MAX_LEARNED - 1]), ("L39", "L0", "L30 again"));
        assert!(!names.contains(&"L30"));
    }

    /// A real vault, read whole and then asked again: what every session's trail adds up to
    /// (to hold against a count of the same files made another way), and what the first read
    /// and an idle poll cost. Not part of the suite, since it needs a vault: the one at
    /// `MNEMO_TRAIL_VAULT`, else this machine's.
    /// `cargo test --lib memory_trail::store::tests::a_real_vault -- --ignored --nocapture`
    #[test]
    #[ignore = "reads a real vault"]
    fn a_real_vault() {
        let root = std::env::var_os("MNEMO_TRAIL_VAULT").map(PathBuf::from).or_else(crate::vault::vault_root).expect("a vault");
        let mut store = store_of(&root);
        let start = Instant::now();
        let pulse = store.pulse(None);
        let first = start.elapsed();
        let cost = store.io;
        println!("first read: {} files, {} bytes, {first:?}", cost.opens, cost.bytes);
        assert_eq!(pulse.outcomes.values().sum::<u64>(), pulse.prompts);
        let mut outcomes: Vec<_> = pulse.outcomes.iter().collect();
        outcomes.sort();
        println!("rules {:?}, prompts {}, outcomes {outcomes:?}", pulse.rules, pulse.prompts);
        let (injected, read, learned) = (store.reflex.sums().map(|s| s.events.len()), store.access.sums().map(|s| s.events.len()), store.learned.sums().map(|s| s.events.len()));
        let events = [injected, read, learned].map(|[rotated, live]| rotated + live);
        println!("events: injected {}, read {}, learned {}; shown: learned {}, recent {}", events[0], events[1], events[2], pulse.learned.len(), pulse.recent.len());

        let mut all: HashSet<String> = HashSet::new();
        store.reflex.sums().iter().for_each(|s| all.extend(s.sessions.keys().cloned()));
        store.access.sums().iter().for_each(|s| all.extend(s.reads.keys().cloned()));
        store.briefings.sums().iter().for_each(|s| all.extend(s.read.keys().cloned()));
        store.frictions.sums().iter().for_each(|s| all.extend(s.given.keys().cloned()));
        let all: Vec<String> = all.into_iter().collect();
        let start = Instant::now();
        let trails = store.trails(&all, Instant::now());
        let named = start.elapsed();
        let count = |of: fn(&Trail) -> usize| trails.values().map(of).sum::<usize>();
        println!(
            "{} sessions: prompts {}, injected {} ({} named), considered {} (candidates {}), read {} (hits {}), briefings {}, frictions {}; rules named in {named:?}",
            all.len(),
            count(|t| t.prompts as usize),
            count(|t| t.injected.len()),
            count(|t| t.injected.iter().filter(|i| i.name.is_some()).count()),
            count(|t| t.considered.len()),
            count(|t| t.considered.iter().map(|c| c.candidates.len()).sum()),
            count(|t| t.read.len()),
            count(|t| t.read.iter().map(|r| r.hits.len()).sum()),
            count(|t| t.briefings.len()),
            count(|t| t.frictions.len()),
        );

        // What a screen of sessions asks for: the twenty of the newest events.
        let mut shown: Vec<String> = Vec::new();
        for id in pulse.recent.iter().rev().filter_map(|e| e.session_id.clone()) {
            if !shown.contains(&id) && shown.len() < 20 {
                shown.push(id);
            }
        }
        let cost = store.io;
        let start = Instant::now();
        for _ in 0..100 {
            store.trails(&shown, Instant::now());
            store.pulse(None);
        }
        println!("an idle poll of {} trails and the pulse: {:?}", shown.len(), start.elapsed() / 100);
        // A vault in use is written to under the test; a copy of one is not.
        if std::env::var_os("MNEMO_TRAIL_VAULT").is_some() {
            assert_eq!(store.io, cost, "an idle poll read something");
        }
    }

    #[test]
    fn a_vault_with_no_logs_answers_empty() {
        let mut store = store_of(&temp_dir("trail-empty"));
        assert_eq!(store.trails(&ids(&["s1"]), Instant::now()), HashMap::from([("s1".to_string(), Trail::default())]));
        assert_eq!(store.pulse(Some(5)), VaultPulse::default());
        assert_eq!(store.io, Io::default());
    }
}

//! What mnemo gave each session, and what it held back, read from the vault's logs
//! (`docs/superpowers/specs/2026-11-10-recreation-core.md`, "Memory trail").
//!
//! `memory_feed` answers per project, for one session at a time, with the rules that fired.
//! This module answers per session, for many at once, with everything mnemo's logs join to a
//! session id: the rules it injected and how sure it was, the prompts where it found candidates
//! and stayed silent and why, the rules the session asked for itself, the briefings it was
//! handed, and the corrections it wrote down. `vault_pulse` is the same logs for the vault as
//! a whole.
//!
//! The types below are the contract: they serialise as `src/insight/types.ts` reads them.
//!
//! Both commands are asked every few seconds, so the logs are read from where the last answer
//! stopped: `tail.rs` follows a log and its `.1` rotation, `logs.rs` says what a line adds, and
//! `store.rs` keeps the sums and puts an answer together. A poll with nothing new costs a
//! `stat` per file.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Instant;

use serde::{Deserialize, Serialize};

mod logs;
mod store;
mod tail;

use store::Store;

/// A rule mnemo put into one of the session's prompts. `score`: the retrieval score.
/// `judge`: the relevance the judge gave it, 0 to 1. `name`: the rule page's own name.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Injected {
    pub at: u64,
    pub slug: String,
    pub name: Option<String>,
    pub score: Option<f64>,
    pub judge: Option<f64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub slug: String,
    pub name: Option<String>,
    pub score: f64,
    pub judge: Option<f64>,
}

/// A prompt where mnemo found candidates and said nothing. `reason` is the log's own
/// `silence_reason`: `judge_none_relevant`, `notice_below_bar`, `deduped`, and so on.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Considered {
    pub at: u64,
    pub reason: String,
    pub candidates: Vec<Candidate>,
}

/// A read the session itself made over mnemo's MCP server.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RuleRead {
    pub at: u64,
    pub tool: String,
    pub slug: Option<String>,
    pub topic: Option<String>,
    pub query: Option<String>,
    pub hits: Vec<String>,
    pub ms: Option<f64>,
}

/// A session briefing mnemo handed the session when it started.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BriefingRead {
    pub at: u64,
    pub project: String,
    pub date: Option<String>,
    pub path: String,
    pub source: Option<String>,
    pub entries: Option<u64>,
}

/// A correction the maintainer gave in the session that mnemo wrote down as a candidate rule.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Friction {
    pub at: u64,
    pub quote: String,
    pub rule: String,
    pub origin: Option<String>,
}

/// `prompts`: how many of the session's prompts mnemo looked at. Lists are oldest first;
/// `considered` keeps the newest few dozen.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Trail {
    pub prompts: u64,
    pub injected: Vec<Injected>,
    pub considered: Vec<Considered>,
    pub read: Vec<RuleRead>,
    pub briefings: Vec<BriefingRead>,
    pub frictions: Vec<Friction>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LearnedRule {
    pub at: u64,
    pub slug: String,
    pub name: String,
    pub projects: Vec<String>,
}

/// One event of the vault as a whole, newest last. `kind`: `injected`, `read`, `learned`.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PulseEvent {
    pub at: u64,
    pub kind: String,
    pub slug: String,
    pub session_id: Option<String>,
    pub project: Option<String>,
}

/// The vault as a whole. `rules`: how many rule documents retrieval searches. `outcomes`: the
/// prompts mnemo looked at, by what came of each (`emitted`, or a silence reason).
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VaultPulse {
    pub rules: Option<u64>,
    pub prompts: u64,
    pub outcomes: HashMap<String, u64>,
    pub learned: Vec<LearnedRule>,
    pub recent: Vec<PulseEvent>,
}

// ------------------------------------------------------------------ io --

/// The vault's logs as last read: one store for the app's life, since the app has no way to
/// move a vault once found.
static STORE: Mutex<Option<Store>> = Mutex::new(None);

/// The store over `root` in `held`: the one there when it is that vault's, else a new one.
fn store_in(held: &mut Option<Store>, root: PathBuf, offset_ms: impl FnOnce() -> i64) -> &mut Store {
    if !matches!(held, Some(store) if store.root() == root) {
        *held = Some(Store::new(root, offset_ms()));
    }
    held.as_mut().expect("just made")
}

/// `ask`'s answer from the store in `held` over the vault at `root`. None when there is no vault.
fn with_store<T>(held: &Mutex<Option<Store>>, root: Option<PathBuf>, offset_ms: impl FnOnce() -> i64, ask: impl FnOnce(&mut Store) -> T) -> Option<T> {
    let root = root?;
    // A read that panicked may have left half a file's rows: start over rather than answer it.
    let mut store = held.lock().unwrap_or_else(|poisoned| {
        held.clear_poison();
        let mut store = poisoned.into_inner();
        *store = None;
        store
    });
    Some(ask(store_in(&mut store, root, offset_ms)))
}

fn no_trails(ids: &[String]) -> HashMap<String, Trail> {
    ids.iter().map(|id| (id.clone(), Trail::default())).collect()
}

fn trails_in(held: &Mutex<Option<Store>>, root: Option<PathBuf>, offset_ms: impl FnOnce() -> i64, ids: &[String]) -> HashMap<String, Trail> {
    with_store(held, root, offset_ms, |store| store.trails(ids, Instant::now())).unwrap_or_else(|| no_trails(ids))
}

/// This machine's offset from UTC, read once: the learned ledger's times carry no zone. When it
/// cannot be read, the times are read as UTC. Read as `memory_feed` reads it, so one row has
/// one time in both.
fn local_offset_ms() -> i64 {
    static OFFSET: std::sync::OnceLock<i64> = std::sync::OnceLock::new();
    *OFFSET.get_or_init(|| read_offset_ms().unwrap_or(0))
}

#[cfg(not(windows))]
fn read_offset_ms() -> Option<i64> {
    crate::proc::command("date").arg("+%z").output().ok().and_then(|o| crate::memory_feed::parse_offset(&String::from_utf8_lossy(&o.stdout)))
}

/// Windows' bias counts minutes west, summer time's added while it is in force.
#[cfg(windows)]
fn read_offset_ms() -> Option<i64> {
    use windows_sys::Win32::System::Time::{GetTimeZoneInformation, TIME_ZONE_INFORMATION};
    // SAFETY: a plain C struct of integers, filled in by the call.
    let mut tz: TIME_ZONE_INFORMATION = unsafe { std::mem::zeroed() };
    // `winnt.h`'s `TIME_ZONE_ID_UNKNOWN`, `_STANDARD` and `_DAYLIGHT`.
    let bias = match unsafe { GetTimeZoneInformation(&mut tz) } {
        0 => tz.Bias,
        1 => tz.Bias + tz.StandardBias,
        2 => tz.Bias + tz.DaylightBias,
        _ => return None,
    };
    Some(-i64::from(bias) * 60_000)
}

// ------------------------------------------------------------ commands --

/// Each session's trail, keyed by session id. A session mnemo's logs do not name has an empty
/// trail, and so has every session when there is no vault.
#[tauri::command]
pub async fn memory_trail(session_ids: Vec<String>) -> HashMap<String, Trail> {
    let ids = session_ids.clone();
    let read = tauri::async_runtime::spawn_blocking(move || trails_in(&STORE, crate::vault::vault_root(), local_offset_ms, &ids)).await;
    read.unwrap_or_else(|_| no_trails(&session_ids))
}

/// The vault's pulse. `recent` is the newest events at or after `since` (epoch ms), at most
/// `store::MAX_RECENT` of them: asking with the newest `at` already held misses none, and
/// hands the events of that same millisecond again.
#[tauri::command]
pub async fn vault_pulse(since: Option<u64>) -> VaultPulse {
    let read = tauri::async_runtime::spawn_blocking(move || with_store(&STORE, crate::vault::vault_root(), local_offset_ms, |store| store.pulse(since))).await;
    read.ok().flatten().unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::temp_dir;

    #[test]
    fn a_vault_has_one_store_for_as_long_as_it_is_the_vault() {
        let (a, b) = (temp_dir("trail-store-a"), temp_dir("trail-store-b"));
        std::fs::create_dir_all(a.join(".mnemo")).unwrap();
        std::fs::write(a.join(".mnemo/reflex-log.jsonl"), "{\"session_id\": \"s\", \"emitted\": [\"x\"], \"ts\": \"2026-11-10T03:00:00Z\"}\n").unwrap();
        let mut held = None;
        let ids = ["s".to_string()];
        assert_eq!(store_in(&mut held, a.clone(), || 0).trails(&ids, Instant::now())["s"].prompts, 1);
        let read = held.as_ref().unwrap().io;
        assert_eq!(read.opens, 1);
        // Asked again, the same store answers, and the offset is not read a second time.
        let again = store_in(&mut held, a.clone(), || panic!("the offset is read once per store"));
        assert_eq!(again.trails(&ids, Instant::now())["s"].prompts, 1);
        assert_eq!(again.io, read);
        // Another vault is another store.
        let other = store_in(&mut held, b.clone(), || 0);
        assert_eq!((other.root(), other.io.opens), (b.as_path(), 0));
        assert_eq!(other.trails(&ids, Instant::now())["s"], Trail::default());
    }

    #[test]
    fn with_no_vault_every_session_has_an_empty_trail() {
        let held = Mutex::new(None);
        let ids = ["a".to_string(), "b".to_string()];
        let none = || panic!("no vault, no offset to read");
        assert_eq!(trails_in(&held, None, none, &ids), HashMap::from([("a".to_string(), Trail::default()), ("b".to_string(), Trail::default())]));
        assert_eq!(with_store(&held, None, none, |store| store.pulse(None)), None);
        assert!(held.lock().unwrap().is_none());
    }

    #[test]
    fn a_store_a_panic_left_behind_is_not_answered_from() {
        let root = temp_dir("trail-poison");
        std::fs::create_dir_all(root.join(".mnemo")).unwrap();
        std::fs::write(root.join(".mnemo/learned.jsonl"), "{\"seq\": 1, \"ts\": \"2026-11-08T07:00:00\", \"slug\": \"x\", \"projects\": []}\n").unwrap();
        let learned_at = |held: &Mutex<Option<Store>>, offset: i64| with_store(held, Some(root.clone()), || offset, |store| store.pulse(None)).unwrap().learned[0].at;
        let held = Mutex::new(None);
        let utc = learned_at(&held, 0);
        // The store is kept, so a second offset is not asked for.
        assert_eq!(learned_at(&held, 3_600_000), utc);
        let panicked = std::thread::scope(|s| {
            s.spawn(|| {
                let _store = held.lock().unwrap();
                panic!("mid-read");
            })
            .join()
        });
        assert!(panicked.is_err() && held.is_poisoned());
        // After the panic it is made again, which this one shows by reading another offset.
        assert_eq!(learned_at(&held, 3_600_000), utc - 3_600_000);
        assert!(!held.is_poisoned());
        assert_eq!(trails_in(&held, Some(root.clone()), || 0, &["s".to_string()])["s"], Trail::default());
    }

    #[test]
    fn this_machine_s_offset_is_read() {
        let off = read_offset_ms().expect("an offset");
        assert!(off.abs() <= 14 * 3_600_000 && off % (15 * 60_000) == 0, "{off}");
    }

    /// The offset is `memory_feed`'s code over again, which that module tests by setting the
    /// machine's zone on CI. Here it is held against what .NET says of the zone the machine is
    /// in: on a machine away from UTC, that is its sign and size.
    #[cfg(windows)]
    #[test]
    fn windows_reads_the_offset_the_system_reports() {
        let ask = "[int64][TimeZoneInfo]::Local.GetUtcOffset([DateTime]::Now).TotalMilliseconds";
        let out = crate::proc::command("powershell").args(["-NoProfile", "-NonInteractive", "-Command", ask]).output().expect("powershell");
        let said: i64 = String::from_utf8_lossy(&out.stdout).trim().parse().expect("an offset from powershell");
        assert_eq!(read_offset_ms(), Some(said));
    }

    #[test]
    fn it_serializes_as_the_front_reads_it() {
        let trail = Trail {
            prompts: 2,
            injected: vec![Injected { at: 1, slug: "a".into(), name: None, score: Some(1.5), judge: None }],
            considered: vec![Considered { at: 2, reason: "deduped".into(), candidates: vec![Candidate { slug: "b".into(), name: Some("B".into()), score: 2.5, judge: Some(0.5) }] }],
            read: vec![RuleRead { at: 3, tool: "read_mnemo_rule".into(), slug: Some("a".into()), hits: vec!["a".into()], ..Default::default() }],
            briefings: vec![BriefingRead { at: 4, project: "app".into(), path: "p.md".into(), ..Default::default() }],
            frictions: vec![Friction { at: 5, quote: "q".into(), rule: "r".into(), origin: None }],
        };
        let v = serde_json::to_value(HashMap::from([("s".to_string(), trail)])).unwrap();
        assert_eq!(v["s"]["prompts"], 2);
        assert_eq!(v["s"]["injected"][0], serde_json::json!({"at": 1, "slug": "a", "name": null, "score": 1.5, "judge": null}));
        assert_eq!(v["s"]["considered"][0]["candidates"][0], serde_json::json!({"slug": "b", "name": "B", "score": 2.5, "judge": 0.5}));
        assert_eq!(v["s"]["read"][0], serde_json::json!({"at": 3, "tool": "read_mnemo_rule", "slug": "a", "topic": null, "query": null, "hits": ["a"], "ms": null}));
        assert_eq!(v["s"]["briefings"][0], serde_json::json!({"at": 4, "project": "app", "date": null, "path": "p.md", "source": null, "entries": null}));
        assert_eq!(v["s"]["frictions"][0], serde_json::json!({"at": 5, "quote": "q", "rule": "r", "origin": null}));

        let pulse = VaultPulse {
            rules: Some(9),
            prompts: 3,
            outcomes: HashMap::from([("emitted".to_string(), 3)]),
            learned: vec![LearnedRule { at: 6, slug: "l".into(), name: "L".into(), projects: vec!["app".into()] }],
            recent: vec![PulseEvent { at: 7, kind: "read".into(), slug: "a".into(), session_id: Some("s".into()), project: None }],
        };
        let learned = serde_json::json!([{"at": 6, "slug": "l", "name": "L", "projects": ["app"]}]);
        let recent = serde_json::json!([{"at": 7, "kind": "read", "slug": "a", "sessionId": "s", "project": null}]);
        assert_eq!(serde_json::to_value(pulse).unwrap(), serde_json::json!({"rules": 9, "prompts": 3, "outcomes": {"emitted": 3}, "learned": learned, "recent": recent}));
    }
}

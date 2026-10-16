//! Nexus v2's feed (`docs/superpowers/specs/2026-10-15-nexus-v2-design.md`, "What each figure is
//! computed from"): what the snapshot does not carry, read from each session's transcript and job,
//! plus each PR's real fate and the fleet's rate. Its types serialise as `src/nexus/ship-types.ts`
//! reads them.
//!
//! The view asks every 3 s while it is shown, so every read is kept between calls: each
//! transcript is read from where the last call stopped (`transcript::Reader`), a job's contract
//! once, and each PR's fate as often as `prs::Fates` allows.

mod contract;
mod prs;
mod transcript;

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{mpsc, Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use prs::Fates;
use transcript::Reader;

/// One session to read. `key`: a child's `id`, a parent's `session_id`. `account`: the account id
/// the session runs on. `job_id`: a child's short id (its `jobs/<id>/`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FeedAsk {
    pub key: String,
    pub session_id: String,
    pub cwd: String,
    pub account: String,
    pub job_id: Option<String>,
    pub pr_url: Option<String>,
}

/// The last tool call; `running` while its result has not arrived. Times are epoch ms.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Activity {
    pub tool: String,
    pub target: String,
    pub at: u64,
    pub running: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Said {
    pub text: String,
    pub at: u64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ContractRef {
    pub feature: String,
    pub piece: String,
    pub consumes: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Ask {
    pub question: String,
    pub options: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionFeed {
    pub activity: Option<Activity>,
    pub said: Option<Said>,
    /// input + cache_read + cache_creation tokens of the last API call.
    pub context: Option<u64>,
    pub model: Option<String>,
    pub topic: Option<String>,
    /// What the session is called: the name a person gave it, else Claude Code's latest AI title.
    pub title: Option<String>,
    pub contract: Option<ContractRef>,
    pub ask: Option<Ask>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CheckRun {
    pub name: String,
    pub started_at: Option<u64>,
    pub completed_at: Option<u64>,
    pub conclusion: Option<String>,
}

/// `state`: OPEN | MERGED | CLOSED.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PrFate {
    pub state: String,
    pub merged_at: Option<u64>,
    pub closed_at: Option<u64>,
    pub checks: Vec<CheckRun>,
}

/// Over the last 5 minutes, across every session asked about.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FleetRate {
    pub calls_per_min: f64,
    pub out_per_min: f64,
    pub in_per_min: f64,
    pub cache_share: f64,
}

/// `sessions` keyed by `FeedAsk::key`, `prs` by PR url; `at` is epoch ms.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Feed {
    pub sessions: HashMap<String, SessionFeed>,
    pub prs: HashMap<String, PrFate>,
    pub rate: Option<FleetRate>,
    pub at: u64,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// A transcript not found is looked for again after this long: the lookup lists every
/// account's project dirs.
const MISS_EVERY_MS: u64 = 30_000;
/// What no ask has named for this long is forgotten.
const FORGET_MS: u64 = 10 * 60_000;
/// Transcripts read at once, at most.
const READ_THREADS: usize = 8;

/// Everything the feed reads from outside, so tests can answer for it.
pub struct Deps {
    /// An ask → its session's transcript (a Grok session's `chat_history.jsonl`), on any account.
    pub transcript: Box<dyn Fn(&FeedAsk) -> Option<PathBuf> + Send + Sync>,
    /// `(account id, job id)` → that job's `state.json`.
    pub job_state: Box<dyn Fn(&str, &str) -> Option<String> + Send + Sync>,
    /// A PR url → `gh pr view --json prs::VIEW_FIELDS`.
    pub gh: Arc<dyn Fn(&str) -> Result<String, String> + Send + Sync>,
    /// How long a call waits for the `gh` it started; a slower answer reaches a later call.
    pub gh_wait: Duration,
    /// Written as `~` in what the feed says.
    pub home: String,
}

struct Found {
    path: Option<PathBuf>,
    looked: u64,
    used: u64,
}

/// What the feed keeps between calls.
#[derive(Default)]
pub struct State {
    /// By transcript path, with the last call that read it.
    readers: HashMap<PathBuf, (Reader, u64)>,
    /// By `(cwd, session id)`.
    found: HashMap<(String, String), Found>,
    /// By job id; a job's intent never changes.
    contracts: HashMap<String, Option<ContractRef>>,
    fates: Arc<Mutex<Fates>>,
}

impl State {
    pub fn feed(&mut self, asks: &[FeedAsk], now: u64, deps: &Deps) -> Feed {
        let mut urls: Vec<&str> = asks.iter().filter_map(|a| a.pr_url.as_deref()).filter(|u| prs::is_pr_url(u)).collect();
        urls.sort_unstable();
        urls.dedup();
        let (asked, answers) = self.ask_gh(&urls, now, deps);

        let paths: Vec<Option<PathBuf>> = asks.iter().map(|a| self.path(a, now, deps)).collect();
        let failed = self.read(&paths, now, &deps.home);

        let mut feed = Feed { at: now, ..Feed::default() };
        let mut counted = HashSet::new();
        let mut rate = None::<(f64, f64, f64, f64)>;
        for (ask, path) in asks.iter().zip(&paths) {
            let Some(path) = path.as_ref().filter(|p| !failed.contains(*p)) else { continue };
            let Some((reader, _)) = self.readers.get(path) else { continue };
            let mut session = reader.session(ask.job_id.is_none());
            if counted.insert(path.clone()) {
                let r = rate.get_or_insert((0.0, 0.0, 0.0, 0.0));
                for c in reader.recent(now) {
                    r.0 += c.calls as f64;
                    r.1 += c.output as f64;
                    r.2 += (c.input + c.cache_read + c.cache_creation) as f64;
                    r.3 += c.cache_read as f64;
                }
            }
            if let Some(job) = ask.job_id.as_deref() {
                session.contract = self.contract(&ask.account, job, deps);
            }
            feed.sessions.insert(ask.key.clone(), session);
        }
        let minutes = (transcript::RATE_WINDOW_MS / 60_000) as f64;
        feed.rate = rate.map(|(calls, out, input, read)| FleetRate {
            calls_per_min: calls / minutes,
            out_per_min: out / minutes,
            in_per_min: input / minutes,
            cache_share: if input > 0.0 { read / input } else { 0.0 },
        });

        let deadline = Instant::now() + deps.gh_wait;
        for _ in 0..asked {
            if answers.recv_timeout(deadline.saturating_duration_since(Instant::now())).is_err() {
                break;
            }
        }
        let fates = self.fates.lock().unwrap_or_else(|e| e.into_inner());
        feed.prs = urls.iter().filter_map(|u| Some((u.to_string(), fates.fate(u)?.clone()))).collect();

        self.readers.retain(|_, (_, used)| *used + FORGET_MS > now);
        self.found.retain(|_, f| f.used + FORGET_MS > now);
        feed
    }

    /// Start a `gh` for every PR due, each on its own thread; returns how many started and where
    /// each says it is done.
    fn ask_gh(&self, urls: &[&str], now: u64, deps: &Deps) -> (usize, mpsc::Receiver<()>) {
        let (tx, rx) = mpsc::channel();
        let mut fates = self.fates.lock().unwrap_or_else(|e| e.into_inner());
        fates.keep_only(urls);
        let mut asked = 0;
        let due: Vec<&str> = urls.iter().copied().filter(|u| fates.due(u, now)).collect();
        for url in due {
            fates.asking(url, now);
            asked += 1;
            let (url, gh, fates, tx) = (url.to_string(), deps.gh.clone(), self.fates.clone(), tx.clone());
            std::thread::spawn(move || {
                let fate = gh(&url).ok().and_then(|out| prs::parse_fate(&out));
                fates.lock().unwrap_or_else(|e| e.into_inner()).answered(&url, fate);
                let _ = tx.send(());
            });
        }
        (asked, rx)
    }

    /// The ask's transcript, looked up again only when the one found is gone, or after
    /// `MISS_EVERY_MS` for one not found.
    fn path(&mut self, ask: &FeedAsk, now: u64, deps: &Deps) -> Option<PathBuf> {
        let key = (ask.cwd.clone(), ask.session_id.clone());
        let f = self.found.entry(key).or_insert(Found { path: None, looked: 0, used: now });
        f.used = now;
        let fresh = match &f.path {
            Some(p) => p.is_file(),
            None => f.looked != 0 && now < f.looked + MISS_EVERY_MS,
        };
        if !fresh {
            f.path = (deps.transcript)(ask);
            f.looked = now.max(1);
        }
        f.path.clone()
    }

    /// Bring every reader up to its file's end, several at once; returns the paths that failed.
    fn read(&mut self, paths: &[Option<PathBuf>], now: u64, home: &str) -> HashSet<PathBuf> {
        let unique: HashSet<&PathBuf> = paths.iter().flatten().collect();
        let mut work: Vec<(PathBuf, Reader, bool)> =
            unique.into_iter().map(|p| (p.clone(), self.readers.remove(p).map(|(r, _)| r).unwrap_or_default(), true)).collect();
        let per = work.len().div_ceil(READ_THREADS).max(1);
        std::thread::scope(|s| {
            for chunk in work.chunks_mut(per) {
                s.spawn(move || {
                    for (path, reader, ok) in chunk {
                        *ok = reader.refresh(path, now, home).is_ok();
                    }
                });
            }
        });
        let mut failed = HashSet::new();
        for (path, reader, ok) in work {
            if ok {
                self.readers.insert(path, (reader, now));
            } else {
                failed.insert(path);
            }
        }
        failed
    }

    fn contract(&mut self, account: &str, job: &str, deps: &Deps) -> Option<ContractRef> {
        if let Some(c) = self.contracts.get(job) {
            return c.clone();
        }
        if !contract::is_job_id(job) {
            return None;
        }
        let intent = contract::intent_of(&(deps.job_state)(account, job)?)?;
        let c = contract::contract_of(&intent);
        self.contracts.insert(job.to_string(), c.clone());
        c
    }
}

fn live_deps() -> Deps {
    Deps {
        transcript: Box::new(|ask| transcript_of(ask, &crate::mission::account_dirs::accounts())),
        job_state: Box::new(|account, job| {
            let accounts = crate::mission::account_dirs::accounts();
            let read = |a: &crate::mission::account_dirs::Account| std::fs::read_to_string(a.jobs_dir().join(job).join("state.json")).ok();
            accounts.get(account).and_then(read).or_else(|| accounts.owning_job(job).and_then(read))
        }),
        gh: Arc::new(|url| crate::checks::run("gh", &["pr", "view", url, "--json", prs::VIEW_FIELDS], &std::env::temp_dir())),
        gh_wait: Duration::from_millis(1500),
        home: crate::app_dir::home().to_string_lossy().into_owned(),
    }
}

/// Where an ask's session writes: in its account's Grok home when the account is a Grok one, else
/// a Claude transcript on any account, else (an account this app no longer lists) any Grok home.
fn transcript_of(ask: &FeedAsk, accounts: &crate::mission::account_dirs::Accounts) -> Option<PathBuf> {
    use crate::agent_kind::AgentKind;
    use crate::conversation::grok;
    match accounts.get(&ask.account) {
        Some(a) if a.kind == AgentKind::Grok => grok::grok_history_path(&a.config_dir, &ask.session_id),
        Some(_) => crate::mission::transcript_path(&ask.cwd, &ask.session_id),
        None => crate::mission::transcript_path(&ask.cwd, &ask.session_id).or_else(|| grok::find_history(None, &ask.session_id)),
    }
}

fn state() -> &'static Mutex<State> {
    static STATE: OnceLock<Mutex<State>> = OnceLock::new();
    STATE.get_or_init(Default::default)
}

/// What the snapshot does not carry, for every session asked about. A session whose transcript
/// cannot be found is absent from `sessions`; a PR `gh` has not answered yet, from `prs`.
#[tauri::command]
pub async fn nexus_feed(asks: Vec<FeedAsk>) -> Feed {
    tauri::async_runtime::spawn_blocking(move || state().lock().unwrap_or_else(|e| e.into_inner()).feed(&asks, now_ms(), &live_deps()))
        .await
        .unwrap_or_else(|_| Feed { at: now_ms(), ..Feed::default() })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn serialises_as_ship_types_ts_reads_it() {
        let mut f = Feed { at: 5, ..Feed::default() };
        f.sessions.insert(
            "a1".into(),
            SessionFeed {
                activity: Some(Activity { tool: "Bash".into(), target: "pnpm test".into(), at: 1, running: true }),
                said: Some(Said { text: "done".into(), at: 2 }),
                context: Some(149_000),
                model: Some("claude-opus".into()),
                topic: None,
                title: Some("Second version of the checkout".into()),
                contract: Some(ContractRef { feature: "nexus".into(), piece: "scene".into(), consumes: vec!["ship".into()] }),
                ask: Some(Ask { question: "Which?".into(), options: vec!["a".into(), "b".into()] }),
            },
        );
        f.prs.insert(
            "https://github.com/o/r/pull/1".into(),
            PrFate { state: "MERGED".into(), merged_at: Some(9), closed_at: Some(9), checks: vec![CheckRun { name: "test".into(), started_at: Some(3), completed_at: Some(4), conclusion: Some("SUCCESS".into()) }] },
        );
        f.rate = Some(FleetRate { calls_per_min: 4.0, out_per_min: 2000.0, in_per_min: 90000.0, cache_share: 0.9 });
        let v = serde_json::to_value(&f).unwrap();
        assert_eq!(v["sessions"]["a1"]["activity"], json!({ "tool": "Bash", "target": "pnpm test", "at": 1, "running": true }));
        assert_eq!(v["sessions"]["a1"]["title"], json!("Second version of the checkout"));
        assert_eq!(v["sessions"]["a1"]["contract"]["consumes"], json!(["ship"]));
        assert_eq!(v["sessions"]["a1"]["ask"]["options"], json!(["a", "b"]));
        assert_eq!(v["prs"]["https://github.com/o/r/pull/1"]["mergedAt"], json!(9));
        assert_eq!(v["prs"]["https://github.com/o/r/pull/1"]["checks"][0]["completedAt"], json!(4));
        assert_eq!(v["rate"]["callsPerMin"], json!(4.0));
        assert_eq!(v["rate"]["cacheShare"], json!(0.9));
    }

    #[test]
    fn reads_the_asks_the_front_sends() {
        let a: FeedAsk = serde_json::from_value(json!({ "key": "a1", "sessionId": "s", "cwd": "/r", "account": "default", "jobId": "a1", "prUrl": null })).unwrap();
        assert_eq!(a.session_id, "s");
        assert_eq!(a.job_id.as_deref(), Some("a1"));
    }

    // ------------------------------------------------------------ one call --

    use std::sync::atomic::{AtomicUsize, Ordering};

    const NOW: u64 = 1_792_065_600_000; // 2026-10-15T12:00:00Z

    fn line(v: serde_json::Value) -> String {
        v.to_string() + "\n"
    }

    fn call_line(at: &str, msg: &str, tool: &str, out: u64, read: u64) -> String {
        line(json!({ "type": "assistant", "timestamp": at, "message": { "id": msg, "model": "claude-sonnet-5", "content": [{ "type": "tool_use", "id": format!("t-{msg}"), "name": tool, "input": { "command": "pnpm test" } }],
            "usage": { "input_tokens": 10, "output_tokens": out, "cache_read_input_tokens": read, "cache_creation_input_tokens": 0 } } }))
    }

    struct Fixture {
        dir: PathBuf,
        gh_calls: Arc<AtomicUsize>,
        transcript_calls: Arc<AtomicUsize>,
    }

    impl Fixture {
        fn new(tag: &str) -> Fixture {
            Fixture { dir: crate::testutil::temp_dir(tag), gh_calls: Arc::default(), transcript_calls: Arc::default() }
        }

        fn write(&self, session: &str, text: &str) {
            std::fs::write(self.dir.join(format!("{session}.jsonl")), text).unwrap();
        }

        /// `answers` by PR url, in turn; past the end, the last one again.
        fn deps(&self, answers: HashMap<&'static str, Vec<Result<&'static str, &'static str>>>, delay: Duration, wait: Duration) -> Deps {
            let (dir, jobs, calls, looks) = (self.dir.clone(), self.dir.join("jobs"), self.gh_calls.clone(), self.transcript_calls.clone());
            let answers = Arc::new(Mutex::new(answers.into_iter().map(|(k, v)| (k.to_string(), v)).collect::<HashMap<_, _>>()));
            Deps {
                transcript: Box::new(move |ask| {
                    let sid = ask.session_id.as_str();
                    looks.fetch_add(1, Ordering::SeqCst);
                    Some(dir.join(format!("{sid}.jsonl"))).filter(|p| p.is_file())
                }),
                job_state: Box::new(move |_account, job| std::fs::read_to_string(jobs.join(job).join("state.json")).ok()),
                gh: Arc::new(move |url| {
                    calls.fetch_add(1, Ordering::SeqCst);
                    std::thread::sleep(delay);
                    let mut a = answers.lock().unwrap();
                    let list = a.get_mut(url).ok_or("no such PR")?;
                    let r = if list.len() > 1 { list.remove(0) } else { list[0] };
                    r.map(str::to_string).map_err(str::to_string)
                }),
                gh_wait: wait,
                home: "/Users/you".into(),
            }
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }

    fn parent(sid: &str) -> FeedAsk {
        FeedAsk { key: sid.into(), session_id: sid.into(), cwd: "/r".into(), account: "default".into(), job_id: None, pr_url: None }
    }

    fn child(key: &str, sid: &str, pr: Option<&str>) -> FeedAsk {
        FeedAsk { key: key.into(), session_id: sid.into(), cwd: "/r-wt-c-x".into(), account: "default".into(), job_id: Some(key.into()), pr_url: pr.map(str::to_string) }
    }

    const OPEN: &str = r#"{"state":"OPEN","mergedAt":null,"closedAt":null,"statusCheckRollup":[]}"#;
    const MERGED: &str = r#"{"state":"MERGED","mergedAt":"2026-10-15T11:59:00Z","closedAt":"2026-10-15T11:59:00Z","statusCheckRollup":[]}"#;
    const PR: &str = "https://github.com/o/r/pull/7";

    #[test]
    fn a_parent_gets_its_topic_and_a_child_its_contract() {
        let fx = Fixture::new("nexus-feed-sessions");
        fx.write("p1", &(line(json!({ "type": "user", "timestamp": "2026-10-15T11:58:00.000Z", "origin": { "kind": "human" }, "message": { "content": "ship the feed" } }))
            + &call_line("2026-10-15T11:58:30.000Z", "m1", "Bash", 5, 0)));
        fx.write("c1", &(line(json!({ "type": "user", "timestamp": "2026-10-15T11:57:00.000Z", "message": { "content": "You are building one piece of the feature \"nexus-v2\": scene" } }))
            + &call_line("2026-10-15T11:59:00.000Z", "m2", "Read", 5, 0)));
        std::fs::create_dir_all(fx.dir.join("jobs/c1")).unwrap();
        std::fs::write(fx.dir.join("jobs/c1/state.json"), r#"{"intent":"You are building one piece of the feature \"nexus-v2\": scene\nIt reads `Ship` from the piece `ship`."}"#).unwrap();

        let mut s = State::default();
        let f = s.feed(&[parent("p1"), child("c1", "c1", None), parent("gone")], NOW, &fx.deps(HashMap::new(), Duration::ZERO, Duration::ZERO));
        assert_eq!(f.at, NOW);
        assert_eq!(f.sessions["p1"].topic.as_deref(), Some("ship the feed"));
        assert_eq!(f.sessions["p1"].contract, None);
        assert_eq!(f.sessions["c1"].topic, None);
        assert_eq!(f.sessions["c1"].contract, Some(ContractRef { feature: "nexus-v2".into(), piece: "scene".into(), consumes: vec!["ship".into()] }));
        assert_eq!(f.sessions["c1"].model.as_deref(), Some("claude-sonnet-5"));
        assert!(!f.sessions.contains_key("gone"), "a session without a transcript is absent, not an error");
        assert!(f.prs.is_empty());
    }

    #[test]
    fn a_missing_transcript_is_looked_for_again_only_after_a_while() {
        let fx = Fixture::new("nexus-feed-miss");
        let deps = fx.deps(HashMap::new(), Duration::ZERO, Duration::ZERO);
        let mut s = State::default();
        s.feed(&[parent("late")], NOW, &deps);
        s.feed(&[parent("late")], NOW + 3_000, &deps);
        assert_eq!(fx.transcript_calls.load(Ordering::SeqCst), 1);
        fx.write("late", &call_line("2026-10-15T12:00:20.000Z", "m1", "Bash", 1, 0));
        let f = s.feed(&[parent("late")], NOW + MISS_EVERY_MS, &deps);
        assert_eq!(fx.transcript_calls.load(Ordering::SeqCst), 2);
        assert!(f.sessions.contains_key("late"));
        // Found: never looked up again while the file is there.
        s.feed(&[parent("late")], NOW + 2 * MISS_EVERY_MS, &deps);
        assert_eq!(fx.transcript_calls.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn the_rate_is_every_call_of_the_last_five_minutes_across_sessions() {
        let fx = Fixture::new("nexus-feed-rate");
        fx.write("a", &(call_line("2026-10-15T11:50:00.000Z", "old", "Bash", 999, 999) + &call_line("2026-10-15T11:58:00.000Z", "m1", "Bash", 100, 290)));
        fx.write("b", &(call_line("2026-10-15T11:59:00.000Z", "m2", "Bash", 400, 0) + &call_line("2026-10-15T11:59:01.000Z", "m2", "Bash", 400, 0)));
        let mut s = State::default();
        // The same session asked twice (a piece and its child) counts once.
        let asks = [parent("a"), child("b", "b", None), child("b2", "b", None)];
        let f = s.feed(&asks, NOW, &fx.deps(HashMap::new(), Duration::ZERO, Duration::ZERO));
        let r = f.rate.unwrap();
        assert_eq!(r.calls_per_min, 2.0 / 5.0);
        assert_eq!(r.out_per_min, 500.0 / 5.0);
        assert_eq!(r.in_per_min, 310.0 / 5.0);
        assert!((r.cache_share - 290.0 / 310.0).abs() < 1e-9);
        assert_eq!(s.feed(&[parent("nobody")], NOW, &fx.deps(HashMap::new(), Duration::ZERO, Duration::ZERO)).rate, None);
    }

    #[test]
    fn a_merged_pr_is_asked_once_and_an_open_one_once_a_minute() {
        let fx = Fixture::new("nexus-feed-prs");
        fx.write("c", &call_line("2026-10-15T11:59:00.000Z", "m1", "Bash", 1, 0));
        let other = "https://github.com/o/r/pull/8";
        let deps = fx.deps(HashMap::from([(PR, vec![Ok(OPEN), Ok(OPEN), Ok(MERGED)]), (other, vec![Ok(MERGED)])]), Duration::ZERO, Duration::from_secs(5));
        let asks = [child("c", "c", Some(PR)), child("d", "d", Some(other)), child("e", "e", Some("--flag"))];
        let mut s = State::default();
        let f = s.feed(&asks, NOW, &deps);
        assert_eq!(f.prs[PR].state, "OPEN");
        assert_eq!(f.prs[other].merged_at, crate::mission::stamp_ms("2026-10-15T11:59:00Z"));
        assert_eq!(f.prs.len(), 2, "a url that is not one never reaches gh");
        assert_eq!(fx.gh_calls.load(Ordering::SeqCst), 2);

        s.feed(&asks, NOW + 3_000, &deps);
        assert_eq!(fx.gh_calls.load(Ordering::SeqCst), 2, "nothing is due 3 s later");
        s.feed(&asks, NOW + 60_000, &deps);
        assert_eq!(fx.gh_calls.load(Ordering::SeqCst), 3, "the open one is asked again after a minute");
        let f = s.feed(&asks, NOW + 120_000, &deps);
        assert_eq!(f.prs[PR].state, "MERGED");
        for t in [180_000, 240_000, 600_000] {
            s.feed(&asks, NOW + t, &deps);
        }
        assert_eq!(fx.gh_calls.load(Ordering::SeqCst), 4, "merged is final");
    }

    #[test]
    fn a_failed_gh_keeps_the_previous_answer() {
        let fx = Fixture::new("nexus-feed-gh-fails");
        let deps = fx.deps(HashMap::from([(PR, vec![Ok(OPEN), Err("HTTP 502")])]), Duration::ZERO, Duration::from_secs(5));
        let asks = [child("c", "c", Some(PR))];
        let mut s = State::default();
        assert_eq!(s.feed(&asks, NOW, &deps).prs[PR].state, "OPEN");
        assert_eq!(s.feed(&asks, NOW + 60_000, &deps).prs[PR].state, "OPEN");
        assert_eq!(fx.gh_calls.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn a_slow_gh_answers_a_later_call() {
        let fx = Fixture::new("nexus-feed-gh-slow");
        let deps = fx.deps(HashMap::from([(PR, vec![Ok(MERGED)])]), Duration::from_millis(300), Duration::from_millis(20));
        let asks = [child("c", "c", Some(PR))];
        let mut s = State::default();
        let started = Instant::now();
        assert!(s.feed(&asks, NOW, &deps).prs.is_empty());
        assert!(started.elapsed() < Duration::from_millis(250), "the call does not wait for gh past gh_wait");
        std::thread::sleep(Duration::from_millis(400));
        assert_eq!(s.feed(&asks, NOW + 3_000, &deps).prs[PR].state, "MERGED");
        assert_eq!(fx.gh_calls.load(Ordering::SeqCst), 1, "not asked again while it was being asked");
    }

    #[test]
    fn what_no_ask_names_is_forgotten() {
        let fx = Fixture::new("nexus-feed-forget");
        fx.write("a", &call_line("2026-10-15T11:59:00.000Z", "m1", "Bash", 1, 0));
        let deps = fx.deps(HashMap::new(), Duration::ZERO, Duration::ZERO);
        let mut s = State::default();
        s.feed(&[parent("a")], NOW, &deps);
        assert_eq!(s.readers.len(), 1);
        s.feed(&[], NOW + FORGET_MS, &deps);
        assert!(s.readers.is_empty() && s.found.is_empty());
    }

    #[test]
    fn a_grok_account_s_ask_reads_its_history_in_that_account_s_home() {
        let user = crate::testutil::temp_dir("nexus-feed-grok-home");
        let side = user.join(".grok-side");
        let sid = "01a1451e-2815-7532-b1a2-9c82363c4949";
        let dir = side.join("sessions").join("%2Fr").join(sid);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("chat_history.jsonl"), "{\"type\":\"system\",\"content\":\"\"}\n").unwrap();
        let file = json!({ "accounts": [{ "id": "side", "configDir": side.to_string_lossy(), "kind": "grok" }] });
        let accounts = crate::mission::account_dirs::Accounts::parse(&file.to_string(), &user);
        let ask = FeedAsk { account: "side".into(), ..parent(sid) };
        assert_eq!(transcript_of(&ask, &accounts), Some(dir.join("chat_history.jsonl")));
        assert_eq!(transcript_of(&FeedAsk { session_id: "01a1451e-0000-7000-8000-000000000000".into(), ..ask }, &accounts), None);
    }
}

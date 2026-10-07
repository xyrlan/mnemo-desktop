//! One Claude account's plan usage: what `/usage` shows, from the endpoint behind it
//! (`docs/superpowers/specs/2026-10-07-claude-accounts-design.md`, decision 6 and Facts).
//!
//! The account is named by its config dir and whether it is the default account, because the
//! two keep their login under different names. The login is read, never written: refreshing an
//! OAuth token rotates the refresh token, and the copy Claude Code holds would stop working. So
//! an expired token is not fetched with; the answer is the last good reading.
//!
//! The last good reading of each account is kept under the app dir (`plan-usage/`). A failed
//! fetch answers with it and says why in `stale`. A window whose reset has passed reads 0%.
//! Never more than one fetch a minute per account, whatever the caller asks.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use serde::{Deserialize, Serialize};

const ENDPOINT: &str = "https://api.anthropic.com/api/oauth/usage";
const BETA: &str = "oauth-2025-04-20";
/// A kept reading younger than this answers `refresh: false`, and no account is fetched more often.
const MIN_GAP_MS: u64 = 60_000;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlanLimit {
    pub kind: String,
    pub group: String,
    pub model: Option<String>,
    pub percent: f64,
    pub severity: String,
    pub resets_at: Option<String>,
    pub active: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlanUsage {
    pub limits: Vec<PlanLimit>,
    pub plan: Option<String>,
    /// When the reading was fetched, unix ms.
    pub fetched_at: u64,
    /// Why this is an old reading, in a sentence; null for a fresh one.
    pub stale: Option<String>,
}

// ------------------------------------------------------------------ credentials --

/// What the login gives a fetch.
#[derive(Debug, PartialEq)]
pub struct Login {
    pub token: String,
    pub plan: Option<String>,
    /// unix ms; None when the credentials do not say.
    pub expires_at: Option<u64>,
}

/// Parses Claude Code's credentials JSON (Keychain secret or `.credentials.json`).
pub fn parse_login(json: &str) -> Result<Login, String> {
    let v: serde_json::Value =
        serde_json::from_str(json.trim()).map_err(|_| "The account's login could not be read (it is not JSON).".to_string())?;
    let o = &v["claudeAiOauth"];
    let token = o["accessToken"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or("The account is not logged in to Claude with a subscription (no OAuth token).")?;
    Ok(Login {
        token: token.to_string(),
        plan: o["subscriptionType"].as_str().filter(|s| !s.is_empty()).map(str::to_string),
        expires_at: o["expiresAt"].as_u64(),
    })
}

/// Reads an account's credentials JSON. Read-only by construction: nothing here writes one.
pub trait CredentialStore {
    fn read(&self, config_dir: &Path, is_default: bool) -> Result<String, String>;
}

/// `<config dir>/.credentials.json`: where Claude Code keeps the login on Linux and Windows.
pub fn read_credentials_file(config_dir: &Path) -> Result<String, String> {
    let p = config_dir.join(".credentials.json");
    std::fs::read_to_string(&p).map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => "The account is not logged in yet (no credentials in its folder).".to_string(),
        _ => format!("The account's login could not be read ({e})."),
    })
}

/// The Keychain service Claude Code keeps an account's login under, on macOS. The default
/// account's is confirmed. A non-default config dir uses another name, which has to be read
/// from the installed `claude` before it goes here: never guessed.
pub fn keychain_service(_config_dir: &Path, is_default: bool) -> Option<String> {
    if is_default {
        Some("Claude Code-credentials".to_string())
    } else {
        None
    }
}

/// The machine's own store: the Keychain on macOS, `.credentials.json` elsewhere.
pub struct SystemStore;

impl CredentialStore for SystemStore {
    #[cfg(target_os = "macos")]
    fn read(&self, config_dir: &Path, is_default: bool) -> Result<String, String> {
        let service = keychain_service(config_dir, is_default)
            .ok_or("The app does not know yet where Claude Code keeps this account's login in the Keychain.")?;
        let out = crate::proc::command("/usr/bin/security")
            .args(["find-generic-password", "-s", &service, "-w"])
            .output()
            .map_err(|e| format!("The Keychain could not be asked for the account's login ({e})."))?;
        if out.status.success() {
            return String::from_utf8(out.stdout).map_err(|_| "The account's login in the Keychain is not text.".to_string());
        }
        // 44: no such item. Anything else is the Keychain refusing (the maintainer said no, or
        // it is locked).
        Err(match out.status.code() {
            Some(44) => "The account is not logged in yet (no login in the Keychain).".to_string(),
            _ => "The Keychain did not give the app the account's login (refused or locked).".to_string(),
        })
    }

    #[cfg(not(target_os = "macos"))]
    fn read(&self, config_dir: &Path, _is_default: bool) -> Result<String, String> {
        read_credentials_file(config_dir)
    }
}

// --------------------------------------------------------------------- endpoint --

/// Turns the endpoint's answer into limits. A kind this does not know passes through like the
/// others.
pub fn parse_limits(body: &serde_json::Value) -> Result<Vec<PlanLimit>, String> {
    let rows = body["limits"].as_array().ok_or("The usage endpoint answered without a list of limits.")?;
    let text = |v: &serde_json::Value| v.as_str().map(str::to_string);
    Ok(rows
        .iter()
        .filter_map(|r| {
            Some(PlanLimit {
                kind: text(&r["kind"])?,
                group: text(&r["group"]).unwrap_or_default(),
                model: text(&r["scope"]["model"]["display_name"]),
                percent: r["percent"].as_f64().unwrap_or(0.0),
                severity: text(&r["severity"]).unwrap_or_default(),
                resets_at: text(&r["resets_at"]),
                active: r["is_active"].as_bool().unwrap_or(false),
            })
        })
        .collect())
}

/// Asks the endpoint with `token`; the answer's JSON, or a sentence saying why not.
pub type Fetch<'a> = &'a dyn Fn(&str) -> Result<serde_json::Value, String>;

pub fn fetch_endpoint(token: &str) -> Result<serde_json::Value, String> {
    let agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(20)))
        .build()
        .new_agent();
    let response = agent
        .get(ENDPOINT)
        .header("Authorization", format!("Bearer {token}"))
        .header("anthropic-beta", BETA)
        .call()
        .map_err(|e| match e {
            ureq::Error::StatusCode(401 | 403) => {
                "The usage endpoint refused the account's token. It renews the next time Claude Code runs on this account.".to_string()
            }
            ureq::Error::StatusCode(429) => "The usage endpoint asked to wait (rate limit).".to_string(),
            ureq::Error::StatusCode(code) => format!("The usage endpoint answered {code}."),
            e => format!("The usage endpoint could not be reached ({e})."),
        })?;
    let text = response
        .into_body()
        .read_to_string()
        .map_err(|e| format!("The usage endpoint's answer could not be read ({e})."))?;
    serde_json::from_str(&text).map_err(|e| format!("The usage endpoint's answer could not be read ({e})."))
}

// ----------------------------------------------------------------------- time --

pub fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// `2026-10-08T01:10:00.506670+00:00` (or `…Z`) as unix ms. None for anything else.
pub fn parse_rfc3339_ms(s: &str) -> Option<u64> {
    let b = s.as_bytes();
    let num = |r: std::ops::Range<usize>| -> Option<i64> { s.get(r)?.parse().ok() };
    if b.len() < 20 || b[4] != b'-' || b[7] != b'-' || !matches!(b[10], b'T' | b't' | b' ') || b[13] != b':' || b[16] != b':' {
        return None;
    }
    let (y, mo, d, h, mi, sec) = (num(0..4)?, num(5..7)?, num(8..10)?, num(11..13)?, num(14..16)?, num(17..19)?);
    let mut i = 19;
    let mut frac_ms = 0i64;
    if b.get(i) == Some(&b'.') {
        let start = i + 1;
        i = start;
        while b.get(i).is_some_and(u8::is_ascii_digit) {
            i += 1;
        }
        let digits = s.get(start..i)?;
        let first3: String = digits.chars().chain("000".chars()).take(3).collect();
        frac_ms = first3.parse().ok()?;
    }
    let offset_s = match b.get(i)? {
        b'Z' | b'z' if i + 1 == b.len() => 0,
        sign @ (b'+' | b'-') if i + 6 == b.len() && b[i + 3] == b':' => {
            let off = num(i + 1..i + 3)? * 3600 + num(i + 4..i + 6)? * 60;
            if *sign == b'+' {
                off
            } else {
                -off
            }
        }
        _ => return None,
    };
    // Days from civil (Howard Hinnant).
    let y2 = if mo <= 2 { y - 1 } else { y };
    let era = y2.div_euclid(400);
    let yoe = y2 - era * 400;
    let mp = (mo + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    let secs = days * 86_400 + h * 3600 + mi * 60 + sec - offset_s;
    u64::try_from(secs * 1000 + frac_ms).ok()
}

/// A window whose reset has passed reads 0%: the usage in it is gone.
pub fn settle(mut u: PlanUsage, now: u64) -> PlanUsage {
    for l in &mut u.limits {
        if l.resets_at.as_deref().and_then(parse_rfc3339_ms).is_some_and(|t| t <= now) {
            l.percent = 0.0;
            l.severity = "normal".to_string();
        }
    }
    u
}

// ---------------------------------------------------------------- kept readings --

/// The kept reading's file for an account: one per config dir, so two accounts never write the
/// same file.
fn kept_path(store: &Path, config_dir: &str) -> PathBuf {
    use sha2::{Digest, Sha256};
    let hash = Sha256::digest(config_dir.as_bytes());
    let name: String = hash.iter().take(8).map(|b| format!("{b:02x}")).collect();
    store.join(format!("{name}.json"))
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Kept {
    config_dir: String,
    usage: PlanUsage,
}

fn load(store: &Path, config_dir: &str) -> Option<PlanUsage> {
    let text = std::fs::read_to_string(kept_path(store, config_dir)).ok()?;
    let kept: Kept = serde_json::from_str(&text).ok()?;
    (kept.config_dir == config_dir).then_some(kept.usage)
}

fn save(store: &Path, config_dir: &str, usage: &PlanUsage) -> Result<(), String> {
    std::fs::create_dir_all(store).map_err(|e| e.to_string())?;
    let p = kept_path(store, config_dir);
    let tmp = p.with_extension(format!("json.{}.tmp", std::process::id()));
    let kept = Kept { config_dir: config_dir.to_string(), usage: PlanUsage { stale: None, ..usage.clone() } };
    std::fs::write(&tmp, serde_json::to_vec_pretty(&kept).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &p).map_err(|e| e.to_string())
}

// ----------------------------------------------------------------------- answer --

/// What this process remembers of an account's last fetch.
#[derive(Default)]
pub struct Attempt {
    at: Option<u64>,
    /// Why the last fetch failed; None after a good one.
    error: Option<String>,
}

/// One lock per account: a second call waits for the fetch in flight and answers from it.
#[derive(Default)]
pub struct Attempts(Mutex<HashMap<String, Arc<Mutex<Attempt>>>>);

impl Attempts {
    fn of(&self, config_dir: &str) -> Arc<Mutex<Attempt>> {
        let mut map = self.0.lock().unwrap_or_else(|e| e.into_inner());
        map.entry(config_dir.to_string()).or_default().clone()
    }
}

/// Everything `plan_usage` needs from outside, so the tests can stand in for each.
pub struct Sources<'a> {
    pub store: &'a Path,
    pub attempts: &'a Attempts,
    pub credentials: &'a dyn CredentialStore,
    pub fetch: Fetch<'a>,
    pub now: u64,
}

pub fn answer(src: &Sources, config_dir: &str, is_default: bool, refresh: bool) -> Result<PlanUsage, String> {
    let now = src.now;
    let slot = src.attempts.of(config_dir);
    let mut attempt = slot.lock().unwrap_or_else(|e| e.into_inner());
    let kept = load(src.store, config_dir);
    let young = |at: u64| now.saturating_sub(at) < MIN_GAP_MS;

    let fresh_kept = kept.as_ref().is_some_and(|k| young(k.fetched_at));
    if fresh_kept && !refresh {
        return Ok(settle(PlanUsage { stale: attempt.error.clone(), ..kept.unwrap() }, now));
    }
    if fresh_kept || attempt.at.is_some_and(young) {
        let why = attempt.error.clone();
        return match kept {
            Some(k) => Ok(settle(PlanUsage { stale: why, ..k }, now)),
            None => Err(why.unwrap_or_else(|| "The account's usage was asked less than a minute ago. Try again in a minute.".into())),
        };
    }

    attempt.at = Some(now);
    let got = fetch_once(src, config_dir, is_default);
    match got {
        Ok(usage) => {
            attempt.error = None;
            if let Err(e) = save(src.store, config_dir, &usage) {
                log::warn!("plan usage: could not keep the reading of {config_dir}: {e}");
            }
            Ok(settle(usage, now))
        }
        Err(why) => {
            attempt.error = Some(why.clone());
            match kept {
                Some(k) => Ok(settle(PlanUsage { stale: Some(why), ..k }, now)),
                None => Err(why),
            }
        }
    }
}

fn fetch_once(src: &Sources, config_dir: &str, is_default: bool) -> Result<PlanUsage, String> {
    let login = parse_login(&src.credentials.read(Path::new(config_dir), is_default)?)?;
    if login.expires_at.is_some_and(|t| t <= src.now) {
        return Err("The account's token has expired. It renews the next time Claude Code runs on this account.".into());
    }
    let body = (src.fetch)(&login.token)?;
    Ok(PlanUsage { limits: parse_limits(&body)?, plan: login.plan, fetched_at: src.now, stale: None })
}

// --------------------------------------------------------------------- command --

fn attempts() -> &'static Attempts {
    static A: OnceLock<Attempts> = OnceLock::new();
    A.get_or_init(Attempts::default)
}

#[tauri::command]
pub async fn plan_usage(config_dir: String, is_default: bool, refresh: bool) -> Result<PlanUsage, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let store = crate::app_dir::app_dir().join("plan-usage");
        let src = Sources { store: &store, attempts: attempts(), credentials: &SystemStore, fetch: &fetch_endpoint, now: now_ms() };
        answer(&src, &config_dir, is_default, refresh)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::temp_dir;
    use std::cell::{Cell, RefCell};

    /// The default account's answer read 2026-10-07 (spec, Facts), trimmed the same way.
    fn sample() -> serde_json::Value {
        serde_json::json!({
          "five_hour": { "utilization": 34.0, "resets_at": "2026-10-08T01:10:00.506670+00:00" },
          "seven_day": { "utilization": 36.0, "resets_at": "2026-10-13T16:00:00.506727+00:00" },
          "limits": [
            { "kind": "session", "group": "session", "percent": 34, "severity": "normal",
              "resets_at": "2026-10-08T01:10:00.506670+00:00", "scope": null, "is_active": false },
            { "kind": "weekly_all", "group": "weekly", "percent": 36, "severity": "normal",
              "resets_at": "2026-10-13T16:00:00.506727+00:00", "scope": null, "is_active": true },
            { "kind": "weekly_scoped", "group": "weekly", "percent": 0, "severity": "normal",
              "resets_at": "2026-10-13T16:00:00.507030+00:00",
              "scope": { "model": { "id": null, "display_name": "Fable" }, "surface": null },
              "is_active": false }
          ],
          "extra_usage": { "is_enabled": false },
          "some_code_name": null
        })
    }

    const CREDS: &str = r#"{"claudeAiOauth":{"accessToken":"tok-a","refreshToken":"r","expiresAt":99999999999999,"subscriptionType":"max"}}"#;
    /// 2026-10-07T23:00:00Z.
    const NOW: u64 = 1_791_414_000_000;

    /// A credential store that only answers reads, and counts them.
    struct Fake {
        json: Result<String, String>,
        reads: Cell<u32>,
        asked: RefCell<Vec<(PathBuf, bool)>>,
    }
    impl Fake {
        fn new(json: Result<&str, &str>) -> Fake {
            Fake { json: json.map(str::to_string).map_err(str::to_string), reads: Cell::new(0), asked: RefCell::new(vec![]) }
        }
    }
    impl CredentialStore for Fake {
        fn read(&self, config_dir: &Path, is_default: bool) -> Result<String, String> {
            self.reads.set(self.reads.get() + 1);
            self.asked.borrow_mut().push((config_dir.to_path_buf(), is_default));
            self.json.clone()
        }
    }

    struct World {
        store: PathBuf,
        attempts: Attempts,
        creds: Fake,
        fetches: Cell<u32>,
        tokens: RefCell<Vec<String>>,
        answer: RefCell<Result<serde_json::Value, String>>,
    }
    impl World {
        fn new() -> World {
            World {
                store: temp_dir("plan-usage"),
                attempts: Attempts::default(),
                creds: Fake::new(Ok(CREDS)),
                fetches: Cell::new(0),
                tokens: RefCell::new(vec![]),
                answer: RefCell::new(Ok(sample())),
            }
        }
        fn ask(&self, dir: &str, is_default: bool, refresh: bool, now: u64) -> Result<PlanUsage, String> {
            let fetch = |token: &str| {
                self.fetches.set(self.fetches.get() + 1);
                self.tokens.borrow_mut().push(token.to_string());
                self.answer.borrow().clone()
            };
            let src = Sources { store: &self.store, attempts: &self.attempts, credentials: &self.creds, fetch: &fetch, now };
            answer(&src, dir, is_default, refresh)
        }
    }

    #[test]
    fn limits_come_from_the_limits_list() {
        let l = parse_limits(&sample()).unwrap();
        assert_eq!(l.len(), 3);
        assert_eq!(
            l[0],
            PlanLimit {
                kind: "session".into(),
                group: "session".into(),
                model: None,
                percent: 34.0,
                severity: "normal".into(),
                resets_at: Some("2026-10-08T01:10:00.506670+00:00".into()),
                active: false,
            }
        );
        assert!(l[1].active);
        assert_eq!(l[2].model.as_deref(), Some("Fable"));
        assert_eq!(l[2].kind, "weekly_scoped");
    }

    #[test]
    fn a_kind_it_does_not_know_passes_through() {
        let body = serde_json::json!({ "limits": [
            { "kind": "monthly_opus", "group": "monthly", "percent": 81.5, "severity": "warning",
              "resets_at": null, "scope": { "model": { "display_name": "Opus" } }, "is_active": true, "new_field": 1 }
        ]});
        let l = parse_limits(&body).unwrap();
        assert_eq!(l[0].kind, "monthly_opus");
        assert_eq!(l[0].group, "monthly");
        assert_eq!(l[0].percent, 81.5);
        assert_eq!(l[0].severity, "warning");
        assert_eq!(l[0].resets_at, None);
        assert_eq!(l[0].model.as_deref(), Some("Opus"));
    }

    #[test]
    fn an_answer_without_limits_is_a_failure() {
        assert!(parse_limits(&serde_json::json!({ "five_hour": {} })).is_err());
    }

    #[test]
    fn serializes_to_the_contract_shape() {
        let w = World::new();
        let u = w.ask("/h/.claude", true, false, NOW).unwrap();
        let v = serde_json::to_value(&u).unwrap();
        assert_eq!(v["plan"], "max");
        assert_eq!(v["fetchedAt"], NOW);
        assert_eq!(v["stale"], serde_json::Value::Null);
        let l = &v["limits"][2];
        for k in ["kind", "group", "model", "percent", "severity", "resetsAt", "active"] {
            assert!(l.get(k).is_some(), "limit lacks {k}");
        }
        assert_eq!(l["model"], "Fable");
        assert_eq!(v["limits"][1]["active"], true);
    }

    #[test]
    fn the_login_gives_the_token_and_the_plan() {
        let l = parse_login(CREDS).unwrap();
        assert_eq!(l.token, "tok-a");
        assert_eq!(l.plan.as_deref(), Some("max"));
        let l = parse_login(r#"{"claudeAiOauth":{"accessToken":"t"}}"#).unwrap();
        assert_eq!(l.plan, None);
        assert!(parse_login("{}").is_err());
        assert!(parse_login("not json").is_err());
    }

    #[test]
    fn fetches_with_the_accounts_own_token_and_names_the_account() {
        let w = World::new();
        w.ask("/h/.claude-work", false, false, NOW).unwrap();
        assert_eq!(*w.tokens.borrow(), vec!["tok-a".to_string()]);
        assert_eq!(*w.creds.asked.borrow(), vec![(PathBuf::from("/h/.claude-work"), false)]);
    }

    #[test]
    fn a_young_reading_answers_without_a_fetch() {
        let w = World::new();
        w.ask("/h/.claude", true, false, NOW).unwrap();
        let u = w.ask("/h/.claude", true, false, NOW + 30_000).unwrap();
        assert_eq!(w.fetches.get(), 1);
        assert_eq!(u.fetched_at, NOW);
        assert_eq!(u.stale, None);
        w.ask("/h/.claude", true, false, NOW + 61_000).unwrap();
        assert_eq!(w.fetches.get(), 2);
    }

    #[test]
    fn refresh_never_fetches_more_than_once_a_minute() {
        let w = World::new();
        w.ask("/h/.claude", true, true, NOW).unwrap();
        w.ask("/h/.claude", true, true, NOW + 10_000).unwrap();
        w.ask("/h/.claude", true, true, NOW + 59_000).unwrap();
        assert_eq!(w.fetches.get(), 1);
        w.ask("/h/.claude", true, true, NOW + 60_000).unwrap();
        assert_eq!(w.fetches.get(), 2);
    }

    #[test]
    fn a_failed_fetch_also_waits_a_minute() {
        let w = World::new();
        *w.answer.borrow_mut() = Err("The usage endpoint could not be reached (dns).".into());
        let e = w.ask("/h/.claude", true, true, NOW).unwrap_err();
        assert!(e.contains("could not be reached"));
        // Asked again at once: no second fetch, and the same reason.
        assert_eq!(w.ask("/h/.claude", true, true, NOW + 5_000).unwrap_err(), e);
        assert_eq!(w.fetches.get(), 1);
    }

    #[test]
    fn accounts_are_throttled_and_kept_apart() {
        let w = World::new();
        w.ask("/h/.claude", true, true, NOW).unwrap();
        w.ask("/h/.claude-work", false, true, NOW).unwrap();
        assert_eq!(w.fetches.get(), 2);
        assert_ne!(kept_path(&w.store, "/h/.claude"), kept_path(&w.store, "/h/.claude-work"));
        *w.answer.borrow_mut() = Err("down".into());
        let u = w.ask("/h/.claude-work", false, true, NOW + 120_000).unwrap();
        assert_eq!(u.stale.as_deref(), Some("down"));
        assert_eq!(w.ask("/h/.claude", true, false, NOW + 30_000).unwrap().stale, None);
    }

    #[test]
    fn a_failure_answers_the_kept_reading_and_says_why() {
        let w = World::new();
        w.ask("/h/.claude", true, false, NOW).unwrap();
        *w.answer.borrow_mut() = Err("The usage endpoint refused the account's token.".into());
        let later = NOW + 3_600_000;
        let u = w.ask("/h/.claude", true, true, later).unwrap();
        assert_eq!(u.fetched_at, NOW);
        assert_eq!(u.stale.as_deref(), Some("The usage endpoint refused the account's token."));
        assert_eq!(u.limits.len(), 3);
        assert_eq!(u.plan.as_deref(), Some("max"));
        // Within the minute, the same reason, no fetch.
        assert_eq!(w.ask("/h/.claude", true, false, later + 1_000).unwrap().stale, u.stale);
        assert_eq!(w.fetches.get(), 2);
    }

    #[test]
    fn the_kept_reading_survives_a_restart() {
        let w = World::new();
        w.ask("/h/.claude", true, false, NOW).unwrap();
        let restarted = World { store: w.store.clone(), ..World::new() };
        *restarted.answer.borrow_mut() = Err("offline".into());
        let u = restarted.ask("/h/.claude", true, false, NOW + 600_000).unwrap();
        assert_eq!(u.fetched_at, NOW);
        assert_eq!(u.stale.as_deref(), Some("offline"));
        // Answered from disk when young, without a fetch.
        let again = World { store: w.store.clone(), ..World::new() };
        again.ask("/h/.claude", true, false, NOW + 10_000).unwrap();
        assert_eq!(again.fetches.get(), 0);
    }

    #[test]
    fn a_refused_credential_answers_the_kept_reading() {
        let mut w = World::new();
        w.ask("/h/.claude", true, false, NOW).unwrap();
        w.creds = Fake::new(Err("The Keychain did not give the app the account's login (refused or locked)."));
        let u = w.ask("/h/.claude", true, true, NOW + 120_000).unwrap();
        assert!(u.stale.unwrap().contains("Keychain"));
        assert_eq!(w.fetches.get(), 1);
    }

    #[test]
    fn an_expired_token_is_not_used_nor_refreshed() {
        let mut w = World::new();
        w.creds = Fake::new(Ok(r#"{"claudeAiOauth":{"accessToken":"old","refreshToken":"r","expiresAt":1000}}"#));
        let e = w.ask("/h/.claude", true, true, NOW).unwrap_err();
        assert!(e.contains("expired"), "{e}");
        assert_eq!(w.fetches.get(), 0);
    }

    #[test]
    fn no_reading_at_all_throws() {
        let mut w = World::new();
        w.creds = Fake::new(Err("The account is not logged in yet (no credentials in its folder)."));
        assert!(w.ask("/h/.claude-new", false, false, NOW).unwrap_err().contains("not logged in"));
    }

    #[test]
    fn a_window_whose_reset_passed_reads_zero() {
        let w = World::new();
        w.ask("/h/.claude", true, false, NOW).unwrap();
        *w.answer.borrow_mut() = Err("offline".into());
        // 2026-10-08T02:00Z: the session window (01:10) has reset, the weekly ones have not.
        let u = w.ask("/h/.claude", true, true, parse_rfc3339_ms("2026-10-08T02:00:00Z").unwrap()).unwrap();
        assert_eq!(u.limits[0].percent, 0.0);
        assert_eq!(u.limits[0].severity, "normal");
        assert_eq!(u.limits[1].percent, 36.0);
        // The kept reading on disk is the reading as fetched.
        assert_eq!(load(&w.store, "/h/.claude").unwrap().limits[0].percent, 34.0);
    }

    #[test]
    fn rfc3339_times_parse() {
        assert_eq!(parse_rfc3339_ms("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(parse_rfc3339_ms("2026-10-07T23:00:00Z"), Some(NOW));
        assert_eq!(parse_rfc3339_ms("2026-10-08T01:10:00.506670+00:00"), Some(NOW + 2 * 3_600_000 + 600_000 + 506));
        assert_eq!(parse_rfc3339_ms("2026-10-07T20:00:00-03:00"), Some(NOW));
        assert_eq!(parse_rfc3339_ms("2024-02-29T12:00:00.5Z"), Some(1_709_208_000_500));
        assert_eq!(parse_rfc3339_ms("2026-10-07"), None);
        assert_eq!(parse_rfc3339_ms("garbage-garbage-garbage"), None);
    }

    #[test]
    fn the_credentials_file_is_read_and_its_absence_said() {
        let d = temp_dir("plan-usage-creds");
        assert!(read_credentials_file(&d).unwrap_err().contains("not logged in"));
        std::fs::write(d.join(".credentials.json"), CREDS).unwrap();
        assert_eq!(parse_login(&read_credentials_file(&d).unwrap()).unwrap().token, "tok-a");
    }

    #[test]
    fn the_default_accounts_keychain_name_is_known_and_no_other_is_guessed() {
        assert_eq!(keychain_service(Path::new("/h/.claude"), true).as_deref(), Some("Claude Code-credentials"));
        assert_eq!(keychain_service(Path::new("/h/.claude-work"), false), None);
    }
}

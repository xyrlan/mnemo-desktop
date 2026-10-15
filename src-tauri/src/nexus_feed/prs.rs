//! Each PR's real fate, from `gh pr view <url> --json state,mergedAt,closedAt,statusCheckRollup`.
//! MERGED and CLOSED are final, so they are asked once. An open PR is asked again at most once a
//! minute, and a failed `gh` keeps the answer before it.

use std::collections::HashMap;

use super::{CheckRun, PrFate};
use crate::mission::stamp_ms;

pub const VIEW_FIELDS: &str = "state,mergedAt,closedAt,statusCheckRollup";
/// An open PR is asked again after this long, at the soonest.
pub const OPEN_EVERY_MS: u64 = 60_000;

/// GitHub's times, with the zero time it gives a check that has not started or finished
/// (`0001-01-01T00:00:00Z`) read as none.
fn time(v: Option<&serde_json::Value>) -> Option<u64> {
    v?.as_str().filter(|s| !s.is_empty()).and_then(stamp_ms).filter(|ms| *ms > 0)
}

/// One entry of the rollup. A check run carries its own times and conclusion. A commit status
/// (`StatusContext`) has a `state` and one time: once its state is final, it finished then.
fn check(c: &serde_json::Value) -> CheckRun {
    let s = |k: &str| c.get(k).and_then(|x| x.as_str()).filter(|x| !x.is_empty()).map(str::to_string);
    let started_at = time(c.get("startedAt"));
    if c.get("__typename").and_then(|t| t.as_str()) == Some("StatusContext") || c.get("context").is_some() {
        let state = s("state");
        let done = state.as_deref().is_some_and(|x| !matches!(x, "PENDING" | "EXPECTED"));
        return CheckRun {
            name: s("context").unwrap_or_default(),
            started_at,
            completed_at: if done { started_at } else { None },
            conclusion: if done { state } else { None },
        };
    }
    CheckRun { name: s("name").unwrap_or_default(), started_at, completed_at: time(c.get("completedAt")), conclusion: s("conclusion") }
}

pub fn parse_fate(json: &str) -> Option<PrFate> {
    let v: serde_json::Value = serde_json::from_str(json).ok()?;
    let state = v.get("state")?.as_str()?.to_string();
    let checks = v.get("statusCheckRollup").and_then(|r| r.as_array()).map(|r| r.iter().map(check).collect()).unwrap_or_default();
    Some(PrFate { state, merged_at: time(v.get("mergedAt")), closed_at: time(v.get("closedAt")), checks })
}

/// Only a web URL goes to `gh`: anything else could be read as a flag.
pub fn is_pr_url(url: &str) -> bool {
    url.starts_with("https://") || url.starts_with("http://")
}

#[derive(Debug, Default)]
struct Known {
    fate: Option<PrFate>,
    /// When `gh` was last asked, epoch ms.
    asked: u64,
    asking: bool,
}

/// What `gh` has said of each PR, kept across polls.
#[derive(Debug, Default)]
pub struct Fates {
    known: HashMap<String, Known>,
}

impl Fates {
    /// Whether `url` is to be asked now.
    pub fn due(&self, url: &str, now: u64) -> bool {
        match self.known.get(url) {
            None => true,
            Some(k) if k.asking => false,
            Some(Known { fate: Some(f), .. }) if f.state != "OPEN" => false,
            Some(k) => now >= k.asked + OPEN_EVERY_MS,
        }
    }

    pub fn asking(&mut self, url: &str, now: u64) {
        let k = self.known.entry(url.to_string()).or_default();
        k.asked = now;
        k.asking = true;
    }

    /// What `gh` answered; None, a failure, keeps the previous fate.
    pub fn answered(&mut self, url: &str, fate: Option<PrFate>) {
        let k = self.known.entry(url.to_string()).or_default();
        k.asking = false;
        if fate.is_some() {
            k.fate = fate;
        }
    }

    pub fn fate(&self, url: &str) -> Option<&PrFate> {
        self.known.get(url)?.fate.as_ref()
    }

    /// Forget the PRs no ask names any more.
    pub fn keep_only(&mut self, urls: &[&str]) {
        self.known.retain(|u, k| k.asking || urls.contains(&u.as_str()));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const VIEW: &str = r#"{"closedAt":"2026-10-15T13:44:13Z","mergedAt":"2026-10-15T13:44:13Z","state":"MERGED","statusCheckRollup":[
        {"__typename":"CheckRun","completedAt":"2026-10-15T13:30:05Z","conclusion":"SUCCESS","detailsUrl":"https://example.com/1","name":"test (ubuntu-latest)","startedAt":"2026-10-15T13:20:00Z","status":"COMPLETED","workflowName":"CI"},
        {"__typename":"CheckRun","completedAt":"0001-01-01T00:00:00Z","conclusion":"","name":"test (windows-latest)","startedAt":"2026-10-15T13:20:01Z","status":"IN_PROGRESS","workflowName":"CI"},
        {"__typename":"CheckRun","completedAt":"0001-01-01T00:00:00Z","conclusion":"","name":"queued","startedAt":"0001-01-01T00:00:00Z","status":"QUEUED"},
        {"__typename":"StatusContext","context":"ci/lorem","startedAt":"2026-10-15T13:21:00Z","state":"FAILURE","targetUrl":""},
        {"__typename":"StatusContext","context":"ci/ipsum","startedAt":"2026-10-15T13:22:00Z","state":"PENDING","targetUrl":""}]}"#;

    #[test]
    fn a_fate_carries_its_times_and_every_check_of_the_last_run() {
        let f = parse_fate(VIEW).unwrap();
        let ms = |s: &str| stamp_ms(s).unwrap();
        assert_eq!(f.state, "MERGED");
        assert_eq!(f.merged_at, Some(ms("2026-10-15T13:44:13Z")));
        assert_eq!(f.closed_at, f.merged_at);
        assert_eq!(
            f.checks,
            vec![
                CheckRun { name: "test (ubuntu-latest)".into(), started_at: Some(ms("2026-10-15T13:20:00Z")), completed_at: Some(ms("2026-10-15T13:30:05Z")), conclusion: Some("SUCCESS".into()) },
                CheckRun { name: "test (windows-latest)".into(), started_at: Some(ms("2026-10-15T13:20:01Z")), completed_at: None, conclusion: None },
                CheckRun { name: "queued".into(), started_at: None, completed_at: None, conclusion: None },
                CheckRun { name: "ci/lorem".into(), started_at: Some(ms("2026-10-15T13:21:00Z")), completed_at: Some(ms("2026-10-15T13:21:00Z")), conclusion: Some("FAILURE".into()) },
                CheckRun { name: "ci/ipsum".into(), started_at: Some(ms("2026-10-15T13:22:00Z")), completed_at: None, conclusion: None },
            ]
        );
    }

    #[test]
    fn an_open_pr_without_checks() {
        let f = parse_fate(r#"{"closedAt":null,"mergedAt":null,"state":"OPEN","statusCheckRollup":[]}"#).unwrap();
        assert_eq!(f, PrFate { state: "OPEN".into(), merged_at: None, closed_at: None, checks: vec![] });
        assert_eq!(parse_fate("gh: not found"), None);
        assert_eq!(parse_fate("{}"), None);
    }

    fn fate(state: &str) -> Option<PrFate> {
        Some(PrFate { state: state.into(), ..PrFate::default() })
    }

    #[test]
    fn a_final_fate_is_asked_once_and_an_open_one_once_a_minute() {
        let mut f = Fates::default();
        assert!(f.due("u", 0));
        f.asking("u", 0);
        assert!(!f.due("u", 1), "not twice at once");
        f.answered("u", fate("OPEN"));
        assert!(!f.due("u", OPEN_EVERY_MS - 1));
        assert!(f.due("u", OPEN_EVERY_MS));
        f.asking("u", OPEN_EVERY_MS);
        f.answered("u", fate("MERGED"));
        assert!(!f.due("u", u64::MAX));
    }

    #[test]
    fn a_failed_gh_keeps_the_previous_answer_and_waits_a_minute() {
        let mut f = Fates::default();
        f.asking("u", 0);
        f.answered("u", fate("OPEN"));
        f.asking("u", OPEN_EVERY_MS);
        f.answered("u", None);
        assert_eq!(f.fate("u").map(|x| x.state.as_str()), Some("OPEN"));
        assert!(!f.due("u", OPEN_EVERY_MS + 1));
        // Never answered: asked again a minute later, and absent meanwhile.
        f.asking("v", 0);
        f.answered("v", None);
        assert!(f.fate("v").is_none());
        assert!(!f.due("v", 1));
        assert!(f.due("v", OPEN_EVERY_MS));
    }

    #[test]
    fn only_web_urls_reach_gh() {
        assert!(is_pr_url("https://github.com/o/r/pull/1"));
        assert!(!is_pr_url("--repo=x"));
    }
}

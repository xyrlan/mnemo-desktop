//! A Grok account's plan usage: its credit usage, from `mnemo grok billing --home <dir> --json`
//! (`docs/superpowers/specs/2026-10-16-grok-accounts-design.md`, decision 9).
//!
//! Measured 2026-10-16 on grok 1.0.60, a free xAI account (`_x.ai/billing` through mnemo):
//! `{"config": {"creditUsagePercent": 66.0, "currentPeriod": {"type": "USAGE_PERIOD_TYPE_WEEKLY",
//! "start": …, "end": "2026-10-23T11:55:37.040+00:00"}, "billingPeriodEnd": …, …},
//! "subscription_tier": "Free"}`. A home with no login exits 1 with a sentence on stderr.
//!
//! It is one limit, `credits`: the percent used, resetting when the period ends. The kept reading,
//! the one-a-minute gap and the stale answer are Claude's (`answer_with`).

use std::io::Read;
use std::path::Path;
use std::process::Stdio;
use std::time::{Duration, Instant};

use super::{answer_with, Attempts, PlanLimit, PlanUsage};

const TIMEOUT: Duration = Duration::from_secs(30);

pub fn answer(
    store: &Path,
    attempts: &Attempts,
    billing: &dyn Fn(&str) -> Result<String, String>,
    now: u64,
    config_dir: &str,
    refresh: bool,
) -> Result<PlanUsage, String> {
    answer_with(store, attempts, now, config_dir, refresh, || parse(&billing(config_dir)?, now))
}

/// `mnemo grok billing`'s JSON as a `PlanUsage`. A percent it does not give is a failure, not an
/// empty bar; the tier and the period's end stay null when absent.
pub fn parse(text: &str, now: u64) -> Result<PlanUsage, String> {
    let v: serde_json::Value = serde_json::from_str(text).map_err(|e| format!("Grok's billing was not JSON: {e}"))?;
    let config = &v["config"];
    let percent = config["creditUsagePercent"].as_f64().ok_or("Grok gave no credit usage for this account.")?;
    let ends = config["currentPeriod"]["end"].as_str().or_else(|| config["billingPeriodEnd"].as_str());
    let percent = percent.clamp(0.0, 100.0);
    let severity = if percent >= 100.0 {
        "critical"
    } else if percent >= 80.0 {
        "warning"
    } else {
        "normal"
    };
    Ok(PlanUsage {
        limits: vec![PlanLimit {
            kind: "credits".into(),
            group: "credits".into(),
            model: None,
            percent,
            severity: severity.into(),
            resets_at: ends.map(str::to_string),
            active: true,
        }],
        plan: v["subscription_tier"].as_str().map(str::to_string),
        fetched_at: now,
        stale: None,
    })
}

/// Runs `mnemo grok billing --home <dir> --json`; stdout on success, mnemo's own sentence if not.
pub fn mnemo_billing(home: &str) -> Result<String, String> {
    let mut child = crate::proc::tool("mnemo", &crate::tools::pane_path())
        .args(["grok", "billing", "--home", home, "--json"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Could not run mnemo to read the account's Grok credits: {e}"))?;
    let (mut out, mut err) = (child.stdout.take().unwrap(), child.stderr.take().unwrap());
    let reader = std::thread::spawn(move || {
        let (mut o, mut e) = (String::new(), String::new());
        let _ = out.read_to_string(&mut o);
        let _ = err.read_to_string(&mut e);
        (o, e)
    });
    let started = Instant::now();
    let status = loop {
        match child.try_wait().map_err(|e| e.to_string())? {
            Some(s) => break s,
            None if started.elapsed() > TIMEOUT => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("Grok's billing did not answer in 30 seconds.".into());
            }
            None => std::thread::sleep(Duration::from_millis(50)),
        }
    };
    let (o, e) = reader.join().map_err(|_| "reading mnemo's output failed".to_string())?;
    if status.success() {
        Ok(o)
    } else {
        let why = e.trim();
        Err(if why.is_empty() { format!("mnemo grok billing failed ({status}).") } else { why.to_string() })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::temp_dir;
    use std::cell::Cell;

    /// The free account's answer, 2026-10-16.
    const FREE: &str = r#"{"config":{"creditUsagePercent":66.0,"currentPeriod":{"type":"USAGE_PERIOD_TYPE_WEEKLY","start":"2026-10-16T11:55:37.040+00:00","end":"2026-10-23T11:55:37.040+00:00"},"prepaidBalance":{"val":0},"isUnifiedBillingUser":true,"billingPeriodStart":"2026-10-16T11:55:37.040+00:00","billingPeriodEnd":"2026-10-23T11:55:37.040+00:00"},"subscription_tier":"Free"}"#;
    /// 2026-10-16T12:00:00Z.
    const NOW: u64 = 1_792_152_000_000;

    #[test]
    fn credit_percent_is_a_limit_the_period_end_its_reset_and_the_tier_the_plan() {
        let u = parse(FREE, NOW).unwrap();
        assert_eq!(u.plan.as_deref(), Some("Free"));
        assert_eq!(u.stale, None);
        assert_eq!(u.fetched_at, NOW);
        assert_eq!(
            u.limits,
            vec![PlanLimit {
                kind: "credits".into(),
                group: "credits".into(),
                model: None,
                percent: 66.0,
                severity: "normal".into(),
                resets_at: Some("2026-10-23T11:55:37.040+00:00".into()),
                active: true,
            }]
        );
    }

    #[test]
    fn what_grok_does_not_give_stays_null_and_no_percent_is_a_failure() {
        let u = parse(r#"{"config":{"creditUsagePercent":90}}"#, NOW).unwrap();
        assert_eq!((u.plan, u.limits[0].resets_at.clone(), u.limits[0].severity.as_str()), (None, None, "warning"));
        assert!(parse(r#"{"config":{},"subscription_tier":"Free"}"#, NOW).unwrap_err().contains("no credit usage"));
        assert!(parse("nope", NOW).is_err());
    }

    #[test]
    fn a_failure_answers_the_last_good_reading_with_why_and_no_reading_is_an_error() {
        let store = temp_dir("plan-usage-grok");
        let attempts = Attempts::default();
        let reply: Cell<Result<&str, &str>> = Cell::new(Ok(FREE));
        let billing = |_: &str| reply.get().map(str::to_string).map_err(str::to_string);
        let ask = |now: u64| answer(&store, &attempts, &billing, now, "/h/.grok-a", true);

        reply.set(Err("Grok home has no login"));
        assert_eq!(ask(NOW).unwrap_err(), "Grok home has no login");

        reply.set(Ok(FREE));
        let good = ask(NOW + 120_000).unwrap();
        assert_eq!(good.stale, None);
        assert_eq!(good.limits[0].percent, 66.0);

        reply.set(Err("Grok home has no login"));
        let old = ask(NOW + 300_000).unwrap();
        assert_eq!(old.stale.as_deref(), Some("Grok home has no login"));
        assert_eq!(old.limits[0].percent, 66.0);
        assert_eq!(old.plan.as_deref(), Some("Free"));
    }
}

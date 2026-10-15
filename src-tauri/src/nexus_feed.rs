//! Nexus v2's feed (`docs/superpowers/specs/2026-10-15-nexus-v2-design.md`, "What each figure is
//! computed from"): what the snapshot does not carry, read from each session's transcript and job,
//! plus each PR's real fate and the fleet's rate. Its types serialise as `src/nexus/ship-types.ts`
//! reads them. The body is a stub until the round's `feed` piece lands.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

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

/// Stub: an empty feed, stamped now.
#[tauri::command]
pub async fn nexus_feed(asks: Vec<FeedAsk>) -> Feed {
    let _ = asks;
    Feed { at: now_ms(), ..Feed::default() }
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
}

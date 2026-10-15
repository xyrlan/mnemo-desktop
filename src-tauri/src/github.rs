//! GitHub issues as `gh issue list --json` gives them, for Home's lens (`home/lens.rs`, which runs
//! `gh`). Parsing is pure and covered on a fixture captured from `gh` (`fixtures/github/`).

use serde::Serialize;

/// A contract piece whose section names the issue ("Issue #45.").
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct IssuePiece {
    pub contract_path: String,
    pub piece: String,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Issue {
    pub number: u64,
    pub title: String,
    pub labels: Vec<String>,
    pub assignees: Vec<String>,
    pub state: String,
    pub url: String,
    pub updated_at: String,
    pub milestone: Option<String>,
    /// PRs that close the issue (`Closes #n` in their body, or linked by hand).
    pub prs: Vec<u64>,
    /// Contract pieces naming the issue; `parse_issues` leaves it empty.
    pub pieces: Vec<IssuePiece>,
}

/// `gh issue list --json …`. Rows without a number or title are skipped.
pub fn parse_issues(json: &str) -> Result<Vec<Issue>, String> {
    let rows: Vec<serde_json::Value> = serde_json::from_str(json).map_err(|e| format!("issues json: {e}"))?;
    let names = |v: Option<&serde_json::Value>, key: &str| -> Vec<String> {
        v.and_then(|x| x.as_array())
            .map(|a| a.iter().filter_map(|x| x.get(key)?.as_str().map(str::to_string)).collect())
            .unwrap_or_default()
    };
    Ok(rows
        .iter()
        .filter_map(|r| {
            Some(Issue {
                number: r.get("number")?.as_u64()?,
                title: r.get("title")?.as_str()?.to_string(),
                labels: names(r.get("labels"), "name"),
                assignees: names(r.get("assignees"), "login"),
                state: r.get("state").and_then(|x| x.as_str()).unwrap_or("OPEN").to_string(),
                url: r.get("url").and_then(|x| x.as_str()).unwrap_or_default().to_string(),
                updated_at: r.get("updatedAt").and_then(|x| x.as_str()).unwrap_or_default().to_string(),
                milestone: r.get("milestone").and_then(|m| m.get("title")).and_then(|x| x.as_str()).map(str::to_string),
                prs: r
                    .get("closedByPullRequestsReferences")
                    .and_then(|x| x.as_array())
                    .map(|a| a.iter().filter_map(|p| p.get("number")?.as_u64()).collect())
                    .unwrap_or_default(),
                pieces: vec![],
            })
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    const ISSUES: &str = include_str!("../fixtures/github/issues.json");

    #[test]
    fn issues_parse_labels_assignees_milestone_and_closing_prs() {
        let is = parse_issues(ISSUES).unwrap();
        assert_eq!(is.len(), 3);
        assert_eq!(is[0].number, 35);
        assert_eq!(is[0].labels, vec!["ui", "round5"]);
        assert_eq!(is[0].assignees, vec!["xyrlan"]);
        assert_eq!(is[0].milestone.as_deref(), Some("v0.2"));
        assert_eq!(is[0].prs, vec![52]);
        assert_eq!(is[0].updated_at, "2026-09-15T11:00:00Z");
        assert_eq!(is[1].milestone, None);
        assert!(is[1].prs.is_empty());
        assert!(parse_issues("nope").is_err());
        // An old gh without closedByPullRequestsReferences.
        let old = parse_issues(r#"[{"number":1,"title":"t","labels":[],"assignees":[],"state":"OPEN","url":"u","updatedAt":"x","milestone":null}]"#).unwrap();
        assert!(old[0].prs.is_empty());
    }
}

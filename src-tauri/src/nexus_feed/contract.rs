//! A contract piece's place in its round, from the child's full dispatch intent: the snapshot
//! carries only its first line. `mnemo dispatch` words it as *"one piece of the feature "X":
//! piece"*, and names each piece it writes against as *"from the piece `y`"*.

use super::ContractRef;

/// The intent in a job's `state.json`; None when the file says none.
pub fn intent_of(state_json: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(state_json).ok()?;
    v.get("intent")?.as_str().map(str::to_string)
}

pub fn contract_of(intent: &str) -> Option<ContractRef> {
    const OPEN: &str = "one piece of the feature \"";
    let rest = &intent[intent.find(OPEN)? + OPEN.len()..];
    let (feature, rest) = rest.split_once('"')?;
    let piece = rest.strip_prefix(':')?.split_whitespace().next()?.trim_end_matches(['.', ',', ';']);
    if feature.is_empty() || piece.is_empty() {
        return None;
    }
    let mut consumes: Vec<String> = intent
        .split("from the piece `")
        .skip(1)
        .filter_map(|s| s.split_once('`').map(|(name, _)| name.trim().to_string()))
        .filter(|name| !name.is_empty() && name != piece)
        .collect();
    consumes.sort();
    consumes.dedup();
    Some(ContractRef { feature: feature.to_string(), piece: piece.to_string(), consumes })
}

/// A job id is a folder name under `jobs/`, never a path.
pub fn is_job_id(id: &str) -> bool {
    !id.is_empty() && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_piece_names_its_feature_and_what_it_writes_against() {
        let intent = "You are building one piece of the feature \"nexus-v2\": scene\n\nThe decomposition was reviewed.\n\
            It writes against `buildShip` from the piece `ship`, and against `Feed` from the piece `feed`, and\n\
            `logEvents` from the piece `ship` again.";
        assert_eq!(
            contract_of(intent),
            Some(ContractRef { feature: "nexus-v2".into(), piece: "scene".into(), consumes: vec!["feed".into(), "ship".into()] })
        );
    }

    #[test]
    fn a_piece_that_consumes_nothing_has_an_empty_list() {
        let c = contract_of("You are building one piece of the feature \"nexus-v2\": feed\n\n**Files you may change**").unwrap();
        assert_eq!((c.feature.as_str(), c.piece.as_str(), c.consumes.len()), ("nexus-v2", "feed", 0));
    }

    #[test]
    fn an_issue_child_has_no_contract() {
        assert_eq!(contract_of("Fix issue #412 in this repo: a draft PR's flag"), None);
        assert_eq!(contract_of("one piece of the feature \"\": x"), None);
        assert_eq!(contract_of("one piece of the feature \"open"), None);
    }

    #[test]
    fn the_intent_comes_from_state_json() {
        assert_eq!(intent_of(r#"{"state":"working","intent":"a\nb"}"#).as_deref(), Some("a\nb"));
        assert_eq!(intent_of(r#"{"state":"working"}"#), None);
        assert_eq!(intent_of("not json"), None);
    }

    #[test]
    fn a_job_id_is_a_plain_name() {
        assert!(is_job_id("a1b2c3d4"));
        assert!(!is_job_id("../x"));
        assert!(!is_job_id(""));
        assert!(!is_job_id("a/b"));
    }
}

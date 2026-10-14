//! Whether GitHub has a newer mnemo-desktop than the one running (#366). There is no updater
//! (that needs a signing key); the app only says, quietly and once per version, that a newer
//! release is out and where. The palette's about line keeps saying it after that.
//!
//! `releases/latest` answers the newest published release: never a draft (the release workflow
//! makes drafts until someone publishes them) nor one marked as a prerelease.

use std::path::Path;
use std::time::Duration;

const LATEST: &str = "https://api.github.com/repos/xyrlan/mnemo-desktop/releases/latest";
/// The newest version the app has already told about, in the app dir.
pub const TOLD: &str = "newer-release-told";

#[derive(Debug, PartialEq, serde::Serialize)]
pub struct NewerRelease {
    /// `0.5.4`, without the tag's `v`.
    pub version: String,
    /// The release's page.
    pub url: String,
    /// Already told about in an earlier run: show it where the version is, don't announce it.
    pub told: bool,
}

/// `v0.5.10` or `0.5.10` as numbers; `None` for anything else, a prerelease suffix included.
fn parse(version: &str) -> Option<(u64, u64, u64)> {
    let mut parts = version.trim().trim_start_matches('v').split('.');
    let mut next = || parts.next()?.parse::<u64>().ok();
    let v = (next()?, next()?, next()?);
    parts.next().is_none().then_some(v)
}

/// Whether `tag` is a later version than `current`. A version either side cannot read is not
/// newer: the app says nothing rather than something wrong.
pub fn newer(tag: &str, current: &str) -> bool {
    matches!((parse(tag), parse(current)), (Some(t), Some(c)) if t > c)
}

/// The newer release in a `releases/latest` answer, if it is one. `told` is the version an
/// earlier run already announced.
pub fn pick(json: &str, current: &str, told: Option<&str>) -> Result<Option<NewerRelease>, String> {
    let v: serde_json::Value = serde_json::from_str(json).map_err(|e| format!("GitHub sent a release the app cannot read ({e})."))?;
    if v["draft"].as_bool() == Some(true) || v["prerelease"].as_bool() == Some(true) {
        return Ok(None);
    }
    let tag = v["tag_name"].as_str().ok_or("GitHub sent a release without a tag.")?;
    if !newer(tag, current) {
        return Ok(None);
    }
    let version = tag.trim().trim_start_matches('v').to_string();
    let url = v["html_url"].as_str().filter(|u| u.starts_with("https://")).ok_or("GitHub sent a release without a page.")?.to_string();
    let told = told.is_some_and(|t| t.trim() == version);
    Ok(Some(NewerRelease { version, url, told }))
}

/// `pick` against the told-file in `dir`, and the file updated so the next run does not
/// announce the same version again.
pub fn check(json: &str, current: &str, dir: &Path) -> Result<Option<NewerRelease>, String> {
    let told = std::fs::read_to_string(dir.join(TOLD)).ok();
    let found = pick(json, current, told.as_deref())?;
    if let Some(r) = found.as_ref().filter(|r| !r.told) {
        // Best effort: a dir that cannot be written only means the next run says it again.
        let _ = std::fs::create_dir_all(dir).and_then(|_| std::fs::write(dir.join(TOLD), &r.version));
    }
    Ok(found)
}

fn fetch() -> Result<String, String> {
    let agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(20)))
        .build()
        .new_agent();
    let response = agent.get(LATEST).header("Accept", "application/vnd.github+json").call().map_err(|e| match e {
        ureq::Error::StatusCode(code) => format!("GitHub answered {code} for the latest release."),
        e => format!("Could not reach GitHub for the latest release ({e})."),
    })?;
    response.into_body().with_config().limit(1 << 20).read_to_string().map_err(|e| format!("The latest release could not be read ({e})."))
}

/// The release newer than this build, if GitHub has one. An error is for the log: being
/// offline is not something to tell anyone about.
#[tauri::command]
pub async fn app_newer_release() -> Result<Option<NewerRelease>, String> {
    tauri::async_runtime::spawn_blocking(|| check(&fetch()?, crate::build_info::VERSION, &crate::app_dir::app_dir()))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions_compare_as_numbers_not_text() {
        assert!(newer("v0.5.4", "0.5.3"));
        assert!(newer("v0.5.10", "0.5.9"));
        assert!(newer("v0.10.0", "0.9.9"));
        assert!(newer("1.0.0", "0.99.99"));
        assert!(!newer("v0.5.3", "0.5.3"));
        assert!(!newer("v0.5.2", "0.5.3"));
        assert!(!newer("v0.4.10", "0.5.0"));
    }

    #[test]
    fn a_version_either_side_cannot_read_is_not_newer() {
        assert!(!newer("v0.6.0-rc.1", "0.5.3"));
        assert!(!newer("nightly", "0.5.3"));
        assert!(!newer("v0.6", "0.5.3"));
        assert!(!newer("v0.6.0.1", "0.5.3"));
        assert!(!newer("v0.6.0", "unknown"));
    }

    fn release(tag: &str) -> String {
        // Trimmed from the real `releases/latest` for v0.5.3.
        serde_json::json!({
            "html_url": format!("https://github.com/xyrlan/mnemo-desktop/releases/tag/{tag}"),
            "tag_name": tag,
            "draft": false,
            "prerelease": false,
        })
        .to_string()
    }

    #[test]
    fn a_newer_release_is_picked_with_its_page() {
        assert_eq!(
            pick(&release("v0.5.4"), "0.5.3", None).unwrap(),
            Some(NewerRelease { version: "0.5.4".into(), url: "https://github.com/xyrlan/mnemo-desktop/releases/tag/v0.5.4".into(), told: false })
        );
        assert_eq!(pick(&release("v0.5.3"), "0.5.3", None).unwrap(), None);
    }

    #[test]
    fn a_version_already_told_is_still_newer_but_not_announced() {
        assert!(pick(&release("v0.5.4"), "0.5.3", Some("0.5.4\n")).unwrap().unwrap().told);
        // A later one than what was told is announced again.
        assert!(!pick(&release("v0.5.5"), "0.5.3", Some("0.5.4")).unwrap().unwrap().told);
    }

    #[test]
    fn drafts_prereleases_and_odd_answers_say_nothing() {
        let mut draft: serde_json::Value = serde_json::from_str(&release("v0.6.0")).unwrap();
        draft["draft"] = true.into();
        assert_eq!(pick(&draft.to_string(), "0.5.3", None).unwrap(), None);
        let mut pre: serde_json::Value = serde_json::from_str(&release("v0.6.0")).unwrap();
        pre["prerelease"] = true.into();
        assert_eq!(pick(&pre.to_string(), "0.5.3", None).unwrap(), None);
        assert!(pick("{\"message\":\"Not Found\"}", "0.5.3", None).is_err());
        assert!(pick("not json", "0.5.3", None).is_err());
        let mut no_page: serde_json::Value = serde_json::from_str(&release("v0.6.0")).unwrap();
        no_page["html_url"] = "javascript:alert(1)".into();
        assert!(pick(&no_page.to_string(), "0.5.3", None).is_err());
    }

    #[test]
    fn a_version_is_announced_once_across_runs() {
        let dir = std::env::temp_dir().join(format!("mnemo-newer-release-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        assert!(!check(&release("v0.5.4"), "0.5.3", &dir).unwrap().unwrap().told);
        assert!(check(&release("v0.5.4"), "0.5.3", &dir).unwrap().unwrap().told);
        assert!(!check(&release("v0.5.5"), "0.5.3", &dir).unwrap().unwrap().told);
        // Once the app is updated, nothing is newer.
        assert_eq!(check(&release("v0.5.5"), "0.5.5", &dir).unwrap(), None);
        let _ = std::fs::remove_dir_all(&dir);
    }
}

//! Which commit this bundle is. `build.rs` stamps the short sha and the build time in;
//! `mnemo-desktop --version`, the palette's about line and `scripts/install-app.mjs` read
//! them back, so an app running an old merge says so instead of looking like a missing feature.

/// The short sha `build.rs` stamped, or `unknown` when it was built outside a git checkout.
pub const SHA: &str = env!("MNEMO_BUILD_SHA");
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

fn built_epoch() -> i64 {
    env!("MNEMO_BUILD_EPOCH").parse().unwrap_or(0)
}

/// Days since 1970-01-01 as (year, month, day). Hinnant's `civil_from_days`; std has no
/// calendar and a date crate is not worth pulling in for one line of the about box.
fn civil(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11], March-based
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (yoe + era * 400 + i64::from(m <= 2), m, d)
}

/// `2026-09-15 13:49 UTC`, or `unknown` for an unstamped build. UTC, and labelled as such:
/// the line is read next to a merge time, so it has to be unambiguous rather than local.
fn fmt(epoch: i64) -> String {
    if epoch <= 0 {
        return "unknown".into();
    }
    let (y, m, d) = civil(epoch.div_euclid(86_400));
    let secs = epoch.rem_euclid(86_400);
    format!("{y:04}-{m:02}-{d:02} {:02}:{:02} UTC", secs / 3600, secs % 3600 / 60)
}

/// When this binary was built, as `fmt` writes it.
pub fn built_at() -> String {
    fmt(built_epoch())
}

/// What `mnemo-desktop --version` prints.
pub fn version_line() -> String {
    format!("mnemo-desktop {VERSION} ({SHA}, built {})", built_at())
}

#[derive(serde::Serialize)]
pub struct BuildInfo {
    pub version: &'static str,
    pub sha: &'static str,
    pub built_at: String,
}

#[tauri::command]
pub fn app_build_info() -> BuildInfo {
    BuildInfo { version: VERSION, sha: SHA, built_at: built_at() }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn civil_dates_round_trip_known_days() {
        assert_eq!(civil(0), (1970, 1, 1));
        assert_eq!(civil(59), (1970, 3, 1));
        assert_eq!(civil(-1), (1969, 12, 31));
        // 2024-02-29: a leap day, and 2000-02-29: the century that is one.
        assert_eq!(civil(19_782), (2024, 2, 29));
        assert_eq!(civil(11_016), (2000, 2, 29));
        assert_eq!(civil(20_711), (2026, 9, 15));
    }

    #[test]
    fn built_at_formats_utc_and_says_unknown_for_an_unstamped_build() {
        // 2026-09-15T13:49:07Z
        assert_eq!(fmt(20_711 * 86_400 + 13 * 3600 + 49 * 60 + 7), "2026-09-15 13:49 UTC");
        assert_eq!(fmt(0), "unknown");
    }

    #[test]
    fn the_version_line_carries_the_sha() {
        let line = version_line();
        assert!(line.starts_with(&format!("mnemo-desktop {VERSION} ({SHA},")), "{line}");
        assert!(line.contains(&built_at()), "{line}");
    }
}

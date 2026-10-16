//! Where a Grok Build session keeps the conversation its model saw (spec
//! `2026-10-16-grok-accounts-design.md`, decision 8).
//!
//! A Grok home (`~/.grok`, or `~/.grok-<slug>` for another account) keeps each session in
//! `<home>/sessions/<dir>/<session id>/chat_history.jsonl`. `<dir>` is the session's cwd
//! URL-encoded, or, when that is longer than 255 bytes, `<slug>-<hash>` with the cwd in a `.cwd`
//! file beside it (mnemo's `core/grok/paths.py`, read from Grok's `xai-grok-config/src/paths.rs`).
//! A session id is found under whichever `<dir>` holds it, so neither form is computed here.

use std::path::{Path, PathBuf};

use crate::agent_kind::AgentKind;

/// The file a session's conversation is in, one JSON record per line.
pub const CHAT_HISTORY: &str = "chat_history.jsonl";
/// Token totals per session and per turn, which `chat_history.jsonl` does not carry.
pub const USAGE: &str = "usage.json";

/// `<home>/sessions/<dir>/<session_id>/chat_history.jsonl` when it exists, under whichever cwd's
/// `<dir>` holds the session. `None` for an id that could leave its directory.
pub fn grok_history_path(home: &Path, session_id: &str) -> Option<PathBuf> {
    if !is_session_id(session_id) {
        return None;
    }
    std::fs::read_dir(home.join("sessions")).ok()?.flatten().map(|e| e.path().join(session_id).join(CHAT_HISTORY)).find(|p| p.is_file())
}

/// The Grok homes a session with no home named may be in: every Grok account's, then the default
/// `~/.grok`, each once.
pub fn grok_homes() -> Vec<PathBuf> {
    let mut homes = crate::mission::account_dirs::accounts().grok_homes();
    let default = crate::app_dir::home().join(AgentKind::Grok.default_dir_name());
    if !homes.contains(&default) {
        homes.push(default);
    }
    homes
}

/// `session_id`'s history in `home`, or in any of [`grok_homes`] when none is named.
pub fn find_history(home: Option<&Path>, session_id: &str) -> Option<PathBuf> {
    match home {
        Some(home) => grok_history_path(home, session_id),
        None => grok_homes().iter().find_map(|h| grok_history_path(h, session_id)),
    }
}

/// A name that stays one path component: no separator, no `..`.
fn is_session_id(id: &str) -> bool {
    !id.is_empty() && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::temp_dir;

    const ID: &str = "01a1451e-2815-7532-b1a2-9c82363c4949";

    fn session(home: &Path, dir: &str, id: &str) -> PathBuf {
        let d = home.join("sessions").join(dir).join(id);
        std::fs::create_dir_all(&d).unwrap();
        let p = d.join(CHAT_HISTORY);
        std::fs::write(&p, "{\"type\":\"system\",\"content\":\"\"}\n").unwrap();
        p
    }

    #[test]
    fn a_history_is_found_by_id_under_its_encoded_cwd() {
        let home = temp_dir("grok-history");
        session(&home, "%2FUsers%2Fyou%2Fother", "01a1451e-0000-7000-8000-000000000000");
        let want = session(&home, "%2FUsers%2Fyou%2Fproj", ID);
        // What Grok keeps beside the cwd dirs is not a session.
        std::fs::write(home.join("sessions").join("session_search.sqlite"), "").unwrap();
        assert_eq!(grok_history_path(&home, ID), Some(want));
    }

    #[test]
    fn a_long_cwd_s_hashed_dir_is_found_the_same_way() {
        let home = temp_dir("grok-history-long");
        let dir = "users-you-a-very-long-path-a1b2c3d4e5f60718";
        std::fs::create_dir_all(home.join("sessions").join(dir)).unwrap();
        std::fs::write(home.join("sessions").join(dir).join(".cwd"), "/Users/you/a/very/long/path").unwrap();
        let want = session(&home, dir, ID);
        assert_eq!(grok_history_path(&home, ID), Some(want));
    }

    #[test]
    fn a_session_dir_without_its_history_yet_is_not_found() {
        let home = temp_dir("grok-history-none");
        std::fs::create_dir_all(home.join("sessions").join("%2Fx").join(ID)).unwrap();
        assert_eq!(grok_history_path(&home, ID), None);
        assert_eq!(grok_history_path(&temp_dir("grok-history-empty"), ID), None, "a home with no sessions dir");
    }

    #[test]
    fn an_id_that_could_climb_out_is_refused() {
        let home = temp_dir("grok-history-climb");
        session(&home, "%2Fx", "s");
        for bad in ["", "..", "../s", "s/..", "a b"] {
            assert_eq!(grok_history_path(&home, bad), None, "{bad:?}");
        }
    }

    #[test]
    fn a_named_home_is_the_only_one_searched() {
        let (a, b) = (temp_dir("grok-home-a"), temp_dir("grok-home-b"));
        let want = session(&b, "%2Fx", ID);
        assert_eq!(find_history(Some(&a), ID), None);
        assert_eq!(find_history(Some(&b), ID), Some(want));
    }
}

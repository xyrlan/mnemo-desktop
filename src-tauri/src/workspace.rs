//! `~/.mnemo-desktop/workspace.json` (`-dev` for a debug build, see `app_dir`): the tabs, their split trees and the panes in them, as the
//! front-end last saved them. The shape belongs to `src/layout/persist.ts`; this side only keeps
//! the file. Read whole, written whole, atomically (`json_file`, same as `settings.rs`).

use std::path::PathBuf;

fn path() -> PathBuf {
    crate::app_dir::app_dir().join("workspace.json")
}

/// The saved workspace, `{}` when there is none. An error naming the file when it is there and
/// cannot be read as an object: the front end then restores nothing and saves nothing over it.
#[tauri::command]
pub fn workspace_read() -> Result<serde_json::Value, String> {
    crate::json_file::read(&path())
}

/// Which of `ids` a running `claude` process holds, from every account's `claude agents --json`: a
/// row with a pid. Another app instance (a `tauri dev` beside the installed app, the app opened
/// twice) may be running them, and `claude --resume` would start a second copy of the session (#168).
pub fn live_among<'a>(answers: impl IntoIterator<Item = &'a str>, ids: &[String]) -> Vec<String> {
    let live: std::collections::HashSet<String> =
        answers.into_iter().flat_map(|j| crate::chrome::parse_agent_pids(j).into_values()).map(|(s, _)| s).collect();
    ids.iter().filter(|id| live.contains(*id)).cloned().collect()
}

/// The saved sessions that are Grok sessions: those whose history one of the Grok accounts keeps.
/// Resuming one is never a copy: `grok --leader -r` makes the pane one more client of the session
/// its leader holds (spec decision 4), so no Grok session is ever held back, and none needs
/// `claude agents` to vouch for it. None without a Grok account.
pub fn grok_among(accounts: &crate::mission::account_dirs::Accounts, ids: &[String]) -> std::collections::HashSet<String> {
    let homes: Vec<_> = crate::mission::grok::accounts_of(accounts).map(|a| a.config_dir.clone()).collect();
    ids.iter().filter(|id| homes.iter().any(|h| crate::mission::grok::history_path(h, id).is_some())).cloned().collect()
}

/// The saved sessions the restore must not resume. An error when any account's `claude agents`
/// cannot say: the restore then resumes nothing rather than risk a copy. A Grok session is never
/// held back (`grok_among`), and when the saved ones are all Grok's, `claude` is not asked.
#[tauri::command]
pub async fn workspace_live_sessions(ids: Vec<String>) -> Result<Vec<String>, String> {
    if ids.is_empty() {
        return Ok(vec![]);
    }
    tauri::async_runtime::spawn_blocking(move || {
        let grok = grok_among(&crate::mission::account_dirs::accounts(), &ids);
        let ids: Vec<String> = ids.into_iter().filter(|id| !grok.contains(id)).collect();
        if ids.is_empty() {
            return Ok(vec![]);
        }
        // Asked after the restore began: a session resumed a moment ago must be seen.
        let answers = crate::chrome::ask_agents(std::time::Instant::now()).into_iter().collect::<Result<Vec<_>, _>>()?;
        Ok(live_among(answers.iter().map(String::as_str), &ids))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn workspace_write(value: serde_json::Value) -> Result<(), String> {
    crate::json_file::write(&path(), &value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_saved_grok_session_is_told_by_the_home_that_keeps_it() {
        let home = crate::testutil::temp_dir("ws-grok");
        let g = home.join(".grok");
        let dir = g.join("sessions").join("%2Fr").join("01a1451f-bfc0-7481-afec-c2286636bc5d");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("chat_history.jsonl"), "").unwrap();
        let ids = ["01a1451f-bfc0-7481-afec-c2286636bc5d", "a43d3832-e7a9-49b7-9496-2d86aeac8aad"].map(String::from);
        let text = serde_json::json!({ "accounts": [{ "id": "g", "configDir": g, "kind": "grok" }] }).to_string();
        let with = crate::mission::account_dirs::Accounts::parse(&text, &home);
        assert_eq!(grok_among(&with, &ids), std::collections::HashSet::from([ids[0].clone()]));
        assert!(grok_among(&crate::mission::account_dirs::Accounts::single(&home), &ids).is_empty(), "only Claude accounts: as before");
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn a_session_with_a_process_is_live_and_a_finished_one_is_not() {
        let json = r#"[
            {"sessionId": "a", "pid": 11, "kind": "interactive", "status": "busy"},
            {"sessionId": "b", "kind": "background", "state": "done"},
            {"sessionId": "c", "pid": 12, "kind": "background", "state": "working"}
        ]"#;
        let ids = ["a", "b", "c", "d"].map(String::from);
        assert_eq!(live_among([json], &ids), ["a", "c"]);
        assert_eq!(live_among([json], &[]), Vec::<String>::new());
        assert_eq!(live_among(["not json"], &ids), Vec::<String>::new());
        // Another account's answer: a session live there is not resumed here either.
        let other = r#"[{"sessionId": "d", "pid": 13, "kind": "interactive"}]"#;
        assert_eq!(live_among([json, other], &ids), ["a", "c", "d"]);
        // The captured listing: interactive sessions carry their pid.
        let real = include_str!("../fixtures/agents.json");
        let rows: Vec<serde_json::Value> = serde_json::from_str(real).unwrap();
        let with_pid = rows.iter().find(|r| r.get("pid").is_some()).unwrap()["sessionId"].as_str().unwrap().to_string();
        let without = rows.iter().find(|r| r.get("pid").is_none()).unwrap()["sessionId"].as_str().unwrap().to_string();
        assert_eq!(live_among([real], &[with_pid.clone(), without]), [with_pid]);
    }
}

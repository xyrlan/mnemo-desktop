//! The Claude Code accounts a background session can run on, as the cockpit and Home need them:
//! where each one keeps its daemon (`jobs/`, `daemon/roster.json`) and what a command needs in
//! its environment to reach a session there (spec `2026-10-07-claude-accounts-design.md`,
//! decisions 1 and 5).
//!
//! The list is `accounts.json` in the app's dir, read directly. `accounts.rs` owns that file and
//! writes it; nothing here writes it or calls into it. No file, or one that does not parse, is the
//! one default account.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// The default account's id when `accounts.json` names none.
pub const DEFAULT_ID: &str = "default";

/// The variable Claude Code reads its config dir from.
pub const CONFIG_DIR_VAR: &str = "CLAUDE_CONFIG_DIR";

#[derive(Debug, Clone, PartialEq)]
pub struct Account {
    pub id: String,
    /// `~/.claude` for the default account; its own dir for every other.
    pub config_dir: PathBuf,
    pub is_default: bool,
}

/// What a command must run with to reach a session on its account, whatever account the pane it
/// is typed into was spawned on. `config_dir` None is the default account: `CLAUDE_CONFIG_DIR`
/// unset, never set to `~/.claude`, which Claude Code reads as another account (decision 1).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AccountEnv {
    pub config_dir: Option<String>,
}

impl Account {
    pub fn jobs_dir(&self) -> PathBuf {
        self.config_dir.join("jobs")
    }

    pub fn roster_path(&self) -> PathBuf {
        self.config_dir.join("daemon").join("roster.json")
    }

    pub fn projects_dir(&self) -> PathBuf {
        self.config_dir.join("projects")
    }

    pub fn env(&self) -> AccountEnv {
        AccountEnv { config_dir: (!self.is_default).then(|| self.config_dir.to_string_lossy().to_string()) }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Accounts(pub Vec<Account>);

impl Accounts {
    /// Only the default account, at `<home>/.claude`.
    pub fn single(home: &Path) -> Accounts {
        Accounts(vec![Account { id: DEFAULT_ID.into(), config_dir: home.join(".claude"), is_default: true }])
    }

    /// `accounts.json`'s accounts, the default first. The default account's dir is always
    /// `<home>/.claude` whatever the file says. An entry without an id or an absolute dir, a
    /// repeated id, or a second entry at the default's dir is skipped.
    pub fn parse(json: &str, home: &Path) -> Accounts {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Entry {
            #[serde(default)]
            id: String,
            #[serde(default)]
            config_dir: String,
            #[serde(default)]
            is_default: bool,
        }
        #[derive(Deserialize)]
        struct File {
            #[serde(default)]
            accounts: Vec<Entry>,
        }
        let mut out = Accounts::single(home);
        let Ok(file) = serde_json::from_str::<File>(json) else { return out };
        if let Some(d) = file.accounts.iter().find(|e| e.is_default && !e.id.is_empty()) {
            out.0[0].id = d.id.clone();
        }
        for e in file.accounts.into_iter().filter(|e| !e.is_default) {
            let dir = PathBuf::from(&e.config_dir);
            if e.id.is_empty() || !dir.is_absolute() || out.0.iter().any(|a| a.id == e.id || a.config_dir == dir) {
                continue;
            }
            out.0.push(Account { id: e.id, config_dir: dir, is_default: false });
        }
        out
    }

    pub fn default_account(&self) -> &Account {
        &self.0[0]
    }

    pub fn get(&self, id: &str) -> Option<&Account> {
        self.0.iter().find(|a| a.id == id)
    }

    pub fn iter(&self) -> impl Iterator<Item = &Account> {
        self.0.iter()
    }

    /// The env a command needs to reach a session on `account`. None while there is only the
    /// default account: no pane runs on another, so the command is typed as it always was.
    pub fn route(&self, account: &Account) -> Option<AccountEnv> {
        (self.0.len() > 1).then(|| account.env())
    }

    /// Sets `cmd`'s environment for `account`, the way `route` says a typed command gets it.
    pub fn apply(&self, account: &Account, cmd: &mut std::process::Command) {
        if let Some(env) = self.route(account) {
            match env.config_dir {
                Some(d) => cmd.env(CONFIG_DIR_VAR, d),
                None => cmd.env_remove(CONFIG_DIR_VAR),
            };
        }
    }

    /// The account whose `jobs/` holds `short`, the default first.
    pub fn owning_job(&self, short: &str) -> Option<&Account> {
        if short.is_empty() || short.contains(['/', '\\']) || short.starts_with('.') {
            return None;
        }
        self.0.iter().find(|a| a.jobs_dir().join(short).is_dir())
    }

    /// Accounts in the order to look for `short`'s session: the one whose `jobs/` holds it first.
    pub fn looking_for(&self, short: &str) -> Vec<&Account> {
        let owner = self.owning_job(short);
        owner.into_iter().chain(self.0.iter().filter(|a| Some(*a) != owner)).collect()
    }

    /// Whether `path` is inside one of the accounts' config dirs.
    pub fn contains(&self, path: &Path) -> bool {
        self.0.iter().any(|a| path.starts_with(&a.config_dir))
    }
}

pub fn accounts_path() -> PathBuf {
    crate::app_dir::app_dir().join("accounts.json")
}

/// The accounts as `accounts.json` says now.
pub fn accounts() -> Accounts {
    let home = crate::app_dir::home();
    match std::fs::read_to_string(accounts_path()) {
        Ok(text) => Accounts::parse(&text, &home),
        Err(_) => Accounts::single(&home),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FILE: &str = r#"{
      "active": "work",
      "accounts": [
        { "id": "personal", "label": "Personal", "configDir": "/Users/x/.claude", "isDefault": true },
        { "id": "work", "label": "Work", "configDir": "/Users/x/.claude-work", "isDefault": false }
      ]
    }"#;

    #[test]
    fn no_file_or_a_broken_one_is_the_default_account_alone() {
        let home = Path::new("/Users/x");
        for text in ["", "{", "[]", r#"{"accounts": 3}"#] {
            let a = Accounts::parse(text, home);
            assert_eq!(a.0.len(), 1, "{text}");
            assert_eq!(a.default_account().id, DEFAULT_ID);
            assert_eq!(a.default_account().config_dir, PathBuf::from("/Users/x/.claude"));
        }
    }

    #[test]
    fn the_file_names_the_default_account_and_lists_the_others_after_it() {
        let a = Accounts::parse(FILE, Path::new("/Users/x"));
        assert_eq!(a.0.iter().map(|a| a.id.as_str()).collect::<Vec<_>>(), ["personal", "work"]);
        assert!(a.0[0].is_default && !a.0[1].is_default);
        assert_eq!(a.get("work").unwrap().jobs_dir(), PathBuf::from("/Users/x/.claude-work/jobs"));
        assert_eq!(a.get("work").unwrap().roster_path(), PathBuf::from("/Users/x/.claude-work/daemon/roster.json"));
    }

    #[test]
    fn the_default_account_is_home_claude_whatever_the_file_says() {
        let a = Accounts::parse(r#"{"accounts":[{"id":"d","configDir":"/elsewhere","isDefault":true}]}"#, Path::new("/Users/x"));
        assert_eq!(a.default_account().config_dir, PathBuf::from("/Users/x/.claude"));
        assert_eq!(a.default_account().id, "d");
    }

    #[test]
    fn entries_that_cannot_be_reached_are_skipped() {
        let text = r#"{"accounts":[
          {"id":"","configDir":"/Users/x/.claude-a"},
          {"id":"rel","configDir":".claude-rel"},
          {"id":"w","configDir":"/Users/x/.claude-w"},
          {"id":"w","configDir":"/Users/x/.claude-w2"},
          {"id":"again","configDir":"/Users/x/.claude"}
        ]}"#;
        let a = Accounts::parse(text, Path::new("/Users/x"));
        assert_eq!(a.0.iter().map(|a| a.id.as_str()).collect::<Vec<_>>(), [DEFAULT_ID, "w"]);
    }

    #[test]
    fn one_account_routes_nothing_and_several_route_every_one() {
        let one = Accounts::single(Path::new("/Users/x"));
        assert_eq!(one.route(one.default_account()), None);
        let two = Accounts::parse(FILE, Path::new("/Users/x"));
        assert_eq!(two.route(two.default_account()), Some(AccountEnv { config_dir: None }));
        assert_eq!(two.route(two.get("work").unwrap()), Some(AccountEnv { config_dir: Some("/Users/x/.claude-work".into()) }));
    }

    #[test]
    fn apply_unsets_the_variable_for_the_default_account_and_sets_it_for_another() {
        let two = Accounts::parse(FILE, Path::new("/Users/x"));
        let envs = |a: &Account| {
            let mut c = crate::proc::command("true");
            c.env(CONFIG_DIR_VAR, "/from/the/pane");
            two.apply(a, &mut c);
            c.get_envs().find(|(k, _)| *k == CONFIG_DIR_VAR).map(|(_, v)| v.map(|v| v.to_string_lossy().to_string()))
        };
        assert_eq!(envs(two.default_account()), Some(None));
        assert_eq!(envs(two.get("work").unwrap()), Some(Some("/Users/x/.claude-work".into())));

        let one = Accounts::single(Path::new("/Users/x"));
        let mut c = crate::proc::command("true");
        one.apply(one.default_account(), &mut c);
        assert_eq!(c.get_envs().count(), 0);
    }

    #[test]
    fn a_job_is_found_in_the_account_whose_jobs_dir_holds_it() {
        let home = crate::testutil::temp_dir("acct-jobs");
        let work = home.join(".claude-work");
        std::fs::create_dir_all(work.join("jobs").join("b0b0b0b0")).unwrap();
        std::fs::create_dir_all(home.join(".claude").join("jobs").join("a1a1a1a1")).unwrap();
        let text = format!(r#"{{"accounts":[{{"id":"work","configDir":"{}"}}]}}"#, work.display());
        let a = Accounts::parse(&text, &home);
        assert_eq!(a.owning_job("b0b0b0b0").map(|a| a.id.as_str()), Some("work"));
        assert_eq!(a.owning_job("a1a1a1a1").map(|a| a.id.as_str()), Some(DEFAULT_ID));
        assert_eq!(a.owning_job("nope"), None);
        assert_eq!(a.owning_job("../jobs"), None);
        assert_eq!(a.looking_for("b0b0b0b0").iter().map(|a| a.id.as_str()).collect::<Vec<_>>(), ["work", DEFAULT_ID]);
        assert_eq!(a.looking_for("nope").iter().map(|a| a.id.as_str()).collect::<Vec<_>>(), [DEFAULT_ID, "work"]);
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn contains_is_by_path_component_so_a_sibling_dir_is_not_inside() {
        let a = Accounts::parse(FILE, Path::new("/Users/x"));
        assert!(a.contains(Path::new("/Users/x/.claude/jobs/e3/tmp/repo")));
        assert!(a.contains(Path::new("/Users/x/.claude-work/jobs/e3/tmp/repo")));
        assert!(!a.contains(Path::new("/Users/x/.claude-other/repo")));
        assert!(!a.contains(Path::new("/Users/x/github/mnemo")));
    }
}

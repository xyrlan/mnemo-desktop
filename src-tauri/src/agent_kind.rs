//! Which agent CLI an account runs: Claude Code or Grok Build (spec
//! `2026-10-16-grok-accounts-design.md`, decision 1).
//!
//! The kind of the selected account is the app's one signal for which CLI a new pane starts and
//! which one mnemo dispatches children on. Everything the app types or spawns asks the account's
//! kind rather than naming `claude`. The app exports [`AGENT_ENV`] into every pane and job so mnemo
//! reads the same answer (`mnemo.core.agent_cli`).

use serde::{Deserialize, Serialize};

/// The variable the app exports with the selected account's kind; mnemo reads it.
pub const AGENT_ENV: &str = "MNEMO_AGENT";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentKind {
    /// Every account before the Grok round, so an `accounts.json` without `kind` reads as this.
    #[default]
    Claude,
    Grok,
}

impl AgentKind {
    /// The word mnemo and the wire use: `claude`, `grok`.
    pub fn as_str(self) -> &'static str {
        match self {
            AgentKind::Claude => "claude",
            AgentKind::Grok => "grok",
        }
    }

    /// The CLI's executable name.
    pub fn binary(self) -> &'static str {
        self.as_str()
    }

    /// The variable that selects one of this CLI's accounts.
    pub fn home_var(self) -> &'static str {
        match self {
            AgentKind::Claude => "CLAUDE_CONFIG_DIR",
            AgentKind::Grok => "GROK_HOME",
        }
    }

    /// The dir under the user's home the CLI uses when [`AgentKind::home_var`] is unset.
    pub fn default_dir_name(self) -> &'static str {
        match self {
            AgentKind::Claude => ".claude",
            AgentKind::Grok => ".grok",
        }
    }

    /// What the app names every other account's dir: `<prefix><slug>` under the user's home.
    pub fn account_dir_prefix(self) -> &'static str {
        match self {
            AgentKind::Claude => ".claude-",
            AgentKind::Grok => ".grok-",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_missing_kind_reads_as_claude() {
        #[derive(Deserialize)]
        struct Row {
            #[serde(default)]
            kind: AgentKind,
        }
        let row: Row = serde_json::from_str("{}").unwrap();
        assert_eq!(row.kind, AgentKind::Claude);
    }

    #[test]
    fn the_wire_word_is_lowercase() {
        assert_eq!(serde_json::to_string(&AgentKind::Grok).unwrap(), "\"grok\"");
        assert_eq!(serde_json::from_str::<AgentKind>("\"claude\"").unwrap(), AgentKind::Claude);
    }

    #[test]
    fn each_kind_names_its_own_cli_and_dirs() {
        assert_eq!(AgentKind::Grok.binary(), "grok");
        assert_eq!(AgentKind::Grok.home_var(), "GROK_HOME");
        assert_eq!(AgentKind::Grok.default_dir_name(), ".grok");
        assert_eq!(AgentKind::Grok.account_dir_prefix(), ".grok-");
        assert_eq!(AgentKind::Claude.home_var(), "CLAUDE_CONFIG_DIR");
        assert_eq!(AGENT_ENV, "MNEMO_AGENT");
    }
}

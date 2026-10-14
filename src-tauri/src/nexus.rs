//! The Nexus's own data (spec `docs/superpowers/specs/2026-10-14-nexus-design.md`): each project's
//! live page count, which sizes its territory's archive, and the universal count for the core.
//! Read from the vault, no `mnemo` subprocess.

use std::collections::BTreeMap;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::vault::{live_pages, vault_root, LivePage};

/// Mirrors `ArchiveCounts` in `src/nexus/types.ts`.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct ArchiveCounts {
    /// Live pages per project, keyed by the name the vault's logs use for it.
    pub projects: BTreeMap<String, u64>,
    /// Live pages every project shares.
    pub universal: u64,
}

/// `pages` counted per agent: `shared` is the universal count, every other agent a project.
/// The agent is the vault's `bots/<project>` folder, the name the pulse's rows carry.
pub fn counts_of(pages: &[LivePage]) -> ArchiveCounts {
    let mut out = ArchiveCounts::default();
    for p in pages {
        match p.agent.as_str() {
            "shared" => out.universal += 1,
            agent => *out.projects.entry(agent.to_string()).or_default() += 1,
        }
    }
    out
}

/// The counts of the vault at `root`: the pages `vault_level` counts (noise agents, staged and
/// retired pages left out), so an archive and the sidebar square agree.
pub fn archives_at(root: &Path) -> ArchiveCounts {
    counts_of(&live_pages(root))
}

/// No vault is no pages anywhere.
#[tauri::command]
pub async fn nexus_archives() -> ArchiveCounts {
    tauri::async_runtime::spawn_blocking(|| vault_root().map(|r| archives_at(&r)).unwrap_or_default()).await.unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::Page;

    const FIXTURE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/fixtures/vault");

    #[test]
    fn serialises_as_types_ts_reads_it() {
        let mut c = ArchiveCounts::default();
        c.projects.insert("mnemo".into(), 3);
        c.universal = 2;
        assert_eq!(serde_json::to_value(&c).unwrap(), serde_json::json!({"projects": {"mnemo": 3}, "universal": 2}));
    }

    #[test]
    fn counts_pages_per_agent_with_shared_as_universal() {
        let page = |agent: &str| LivePage { agent: agent.into(), page: Page::default() };
        let c = counts_of(&[page("shared"), page("mnemo"), page("mnemo-desktop"), page("mnemo"), page("shared"), page("shared")]);
        assert_eq!(c.universal, 3);
        assert_eq!(c.projects, BTreeMap::from([("mnemo".into(), 2), ("mnemo-desktop".into(), 1)]));
        assert_eq!(counts_of(&[]), ArchiveCounts::default());
    }

    #[test]
    fn fixture_vault_counts_live_pages_and_leaves_noise_staged_and_index_files_out() {
        // mnemo-desktop: two pages beside a MEMORY.md, two staged in `_inbox`, a briefing outside
        // `memory/`. shared: three, with six staged. A pytest agent is noise.
        let c = archives_at(Path::new(FIXTURE));
        assert_eq!(c, ArchiveCounts { projects: BTreeMap::from([("mnemo-desktop".into(), 2)]), universal: 3 });
    }

    #[test]
    fn no_vault_folder_is_no_pages() {
        let c = archives_at(Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/fixtures/no-such-vault")));
        assert_eq!(c, ArchiveCounts::default());
    }
}

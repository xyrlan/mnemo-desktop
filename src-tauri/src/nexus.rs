//! The Nexus's own data (spec `docs/superpowers/specs/2026-10-14-nexus-design.md`): each project's
//! live page count, which sizes its territory's archive, and the universal count for the core.
//! Read from the vault, no `mnemo` subprocess.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// Mirrors `ArchiveCounts` in `src/nexus/types.ts`.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct ArchiveCounts {
    /// Live pages per project, keyed by the name the vault's logs use for it.
    pub projects: BTreeMap<String, u64>,
    /// Live pages every project shares.
    pub universal: u64,
}

/// Stub until the `memory` piece lands: no pages anywhere.
#[tauri::command]
pub fn nexus_archives() -> ArchiveCounts {
    ArchiveCounts::default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serialises_as_types_ts_reads_it() {
        let mut c = ArchiveCounts::default();
        c.projects.insert("mnemo".into(), 3);
        c.universal = 2;
        assert_eq!(serde_json::to_value(&c).unwrap(), serde_json::json!({"projects": {"mnemo": 3}, "universal": 2}));
    }
}

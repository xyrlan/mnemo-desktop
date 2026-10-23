//! Jarvis's seam (#503): its config file and the projects it knows. Every Jarvis piece reads its
//! own section of `jarvis.json` through `section`, and resolves a project the model named through
//! `projects` and `find`. Nothing here runs a tool.
//!
//! `~/.mnemo-desktop/jarvis.json` is edited by hand (#505, decision 7); `docs/jarvis.example.json`
//! shows its shape. A missing file is an empty config, so Jarvis works with none.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// A project Jarvis may act on: mnemo's name for it (the folder under `<vault>/bots/`), what the
/// maintainer also calls it, and the repository's root.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct JarvisProject {
    pub name: String,
    pub aliases: Vec<String>,
    pub root: String,
}

pub fn config_path() -> PathBuf {
    crate::app_dir::app_dir().join("jarvis.json")
}

/// The whole config, `{}` when there is none, an error naming the file when it cannot be read.
pub fn config() -> Result<serde_json::Value, String> {
    crate::json_file::read(&config_path())
}

/// One top-level section of the config (`"projects"`, `"host"`, `"apps"`, `"voice"`…), `Null`
/// when it is absent.
pub fn section(key: &str) -> Result<serde_json::Value, String> {
    Ok(config()?.get(key).cloned().unwrap_or(serde_json::Value::Null))
}

/// The projects Jarvis knows, by name. See `resolve`.
pub fn projects() -> Vec<JarvisProject> {
    let home = crate::app_dir::home();
    let bots = crate::vault::vault_root().map(|v| dirs_in(&v.join("bots"))).unwrap_or_default();
    let mut folders = crate::settings::projects();
    if let Ok(text) = std::fs::read_to_string(home.join(".claude").join("history.jsonl")) {
        folders.extend(crate::home::parse_history(&text).into_iter().map(|r| r.project));
    }
    let config = section("projects").unwrap_or(serde_json::Value::Null);
    resolve(&bots, &folders, &config, &home, &|p: &Path| p.join(".git").exists())
}

/// The project `name` names, by its name or one of its aliases, ignoring case and spaces at the
/// ends.
pub fn find<'a>(projects: &'a [JarvisProject], name: &str) -> Option<&'a JarvisProject> {
    let n = name.trim().to_lowercase();
    projects.iter().find(|p| p.name.to_lowercase() == n || p.aliases.iter().any(|a| a.trim().to_lowercase() == n))
}

/// The projects out of mnemo's `bots` names, the `folders` the app has seen (saved projects and
/// session cwds) and the config's `projects` section:
/// - a bot is a project when a folder with its name is a repository (`is_repo`), compared without
///   case; a dispatch worktree's bot (`x-wt-…`) never is;
/// - `projects.<name>.root` sets or overrides the root (`~` is the home dir), and makes a project
///   of a name mnemo has no bot for;
/// - `projects.<name>.aliases` are what the maintainer also calls it. An alias wins over a name
///   that only discovery found: with `mnemo-src` aliased `mnemo`, a bot `mnemo` (the vault, say)
///   is not a project, so "mnemo" means what the maintainer means by it.
///
/// Sorted by name.
pub fn resolve(bots: &[String], folders: &[String], config: &serde_json::Value, home: &Path, is_repo: &dyn Fn(&Path) -> bool) -> Vec<JarvisProject> {
    let mut by_base: HashMap<String, String> = HashMap::new();
    for f in folders {
        let base = basename(f).to_lowercase();
        if base.is_empty() || by_base.contains_key(&base) || crate::home::is_dispatch_child(f) {
            continue;
        }
        if is_repo(Path::new(f)) {
            by_base.insert(base, f.trim_end_matches(['/', '\\']).to_string());
        }
    }
    let mut out: HashMap<String, JarvisProject> = HashMap::new();
    for b in bots.iter().filter(|b| !crate::home::is_dispatch_child(b)) {
        if let Some(root) = by_base.get(&b.to_lowercase()) {
            out.insert(b.clone(), JarvisProject { name: b.clone(), aliases: vec![], root: root.clone() });
        }
    }
    for (name, entry) in config.as_object().into_iter().flatten() {
        let root = entry.get("root").and_then(|r| r.as_str()).map(|r| expand(r, home));
        let aliases: Vec<String> = entry
            .get("aliases")
            .and_then(|a| a.as_array())
            .map(|a| a.iter().filter_map(|s| s.as_str()).map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect())
            .unwrap_or_default();
        match (out.get_mut(name), root) {
            (Some(p), root) => {
                if let Some(r) = root {
                    p.root = r;
                }
                p.aliases = aliases;
            }
            (None, Some(root)) => {
                out.insert(name.clone(), JarvisProject { name: name.clone(), aliases, root });
            }
            (None, None) => {}
        }
    }
    let configured = |n: &String| config.get(n).is_some();
    let claimed: Vec<String> = out.values().filter(|p| configured(&p.name)).flat_map(|p| p.aliases.iter().map(|a| a.to_lowercase())).collect();
    out.retain(|n, _| configured(n) || !claimed.contains(&n.to_lowercase()));
    let mut v: Vec<JarvisProject> = out.into_values().collect();
    v.sort_by(|a, b| a.name.cmp(&b.name));
    v
}

fn dirs_in(dir: &Path) -> Vec<String> {
    std::fs::read_dir(dir)
        .map(|rd| rd.filter_map(|e| e.ok()).filter(|e| e.path().is_dir()).map(|e| e.file_name().to_string_lossy().to_string()).collect())
        .unwrap_or_default()
}

fn basename(p: &str) -> &str {
    let t = p.trim_end_matches(['/', '\\']);
    t.rsplit(['/', '\\']).next().unwrap_or(t)
}

/// `~/x` or `~\x` under `home`; anything else as written.
fn expand(p: &str, home: &Path) -> String {
    match p.strip_prefix("~/").or_else(|| p.strip_prefix("~\\")) {
        Some(rest) => home.join(rest).to_string_lossy().to_string(),
        None if p == "~" => home.to_string_lossy().to_string(),
        None => p.to_string(),
    }
}

#[tauri::command]
pub async fn jarvis_projects() -> Result<Vec<JarvisProject>, String> {
    tauri::async_runtime::spawn_blocking(projects).await.map_err(|e| e.to_string())
}

/// Jarvis's own conversation log (#503, decision 8): local, and never fed to mnemo.
pub fn log_path() -> PathBuf {
    crate::app_dir::app_dir().join("jarvis-log.jsonl")
}

/// Past this size the log moves to `<name>.1`, replacing the one before, and starts again.
const LOG_MAX_BYTES: u64 = 5 * 1024 * 1024;

/// Appends `row` as one JSON line to `path`.
pub fn append_to(path: &Path, row: &serde_json::Value) -> Result<(), String> {
    use std::io::Write;
    if std::fs::metadata(path).map(|m| m.len() >= LOG_MAX_BYTES).unwrap_or(false) {
        let mut old = path.as_os_str().to_owned();
        old.push(".1");
        std::fs::rename(path, PathBuf::from(old)).map_err(|e| format!("{}: {e}", path.display()))?;
    }
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    }
    let mut f = std::fs::OpenOptions::new().create(true).append(true).open(path).map_err(|e| format!("{}: {e}", path.display()))?;
    writeln!(f, "{row}").map_err(|e| format!("{}: {e}", path.display()))
}

#[tauri::command]
pub fn jarvis_log_append(row: serde_json::Value) -> Result<(), String> {
    append_to(&log_path(), &row)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|x| x.to_string()).collect()
    }

    fn repos(dir: &Path, names: &[&str]) -> Vec<String> {
        names
            .iter()
            .map(|n| {
                let d = dir.join(n);
                std::fs::create_dir_all(d.join(".git")).unwrap();
                d.to_string_lossy().to_string()
            })
            .collect()
    }

    fn is_repo(p: &Path) -> bool {
        p.join(".git").exists()
    }

    #[test]
    fn a_bot_is_a_project_when_a_repository_has_its_name() {
        let dir = crate::testutil::temp_dir("jarvis-bots");
        let mut folders = repos(&dir, &["Alpha", "beta"]);
        folders.push(dir.join("gamma").to_string_lossy().to_string()); // not a repository
        let got = resolve(&s(&["alpha", "beta", "gamma", "delta"]), &folders, &json!({}), &dir, &is_repo);
        assert_eq!(got.iter().map(|p| p.name.as_str()).collect::<Vec<_>>(), ["alpha", "beta"]);
        assert_eq!(Path::new(&got[0].root), dir.join("Alpha"));
    }

    #[test]
    fn a_dispatch_worktree_is_never_a_project() {
        let dir = crate::testutil::temp_dir("jarvis-wt");
        let folders = repos(&dir, &["app", "app-wt-12"]);
        let got = resolve(&s(&["app", "app-wt-12"]), &folders, &json!({}), &dir, &is_repo);
        assert_eq!(got.len(), 1);
        assert_eq!(Path::new(&got[0].root), dir.join("app"));
    }

    #[test]
    fn the_config_sets_aliases_and_roots_and_adds_projects() {
        let dir = crate::testutil::temp_dir("jarvis-config");
        let folders = repos(&dir, &["app", "elsewhere"]);
        let config = json!({
            "app": { "aliases": ["o app", " ", "desktop "] },
            "tool": { "root": "~/elsewhere", "aliases": ["a ferramenta"] },
            "ghost": { "aliases": ["nada"] }
        });
        let got = resolve(&s(&["app"]), &folders, &config, &dir, &is_repo);
        assert_eq!(got.len(), 2, "ghost has neither a bot with a repository nor a root");
        assert_eq!(got[0].aliases, ["o app", "desktop"]);
        assert_eq!(got[1].name, "tool");
        assert_eq!(Path::new(&got[1].root), dir.join("elsewhere"));
    }

    #[test]
    fn a_configured_alias_wins_over_a_name_only_discovery_found() {
        let dir = crate::testutil::temp_dir("jarvis-alias");
        let folders = repos(&dir, &["mnemo", "cli"]);
        let bots = s(&["mnemo", "cli"]);
        let got = resolve(&bots, &folders, &json!({ "cli": { "aliases": ["MNEMO"] } }), &dir, &is_repo);
        assert_eq!(got.iter().map(|p| p.name.as_str()).collect::<Vec<_>>(), ["cli"]);
        assert_eq!(find(&got, "mnemo").map(|p| p.name.as_str()), Some("cli"));
        let both = json!({ "cli": { "aliases": ["mnemo"] }, "mnemo": { "aliases": ["o vault"] } });
        assert_eq!(resolve(&bots, &folders, &both, &dir, &is_repo).len(), 2, "a project the config names is kept");
    }

    #[test]
    fn the_log_appends_one_line_per_row_and_rolls_over_when_full() {
        let dir = crate::testutil::temp_dir("jarvis-log");
        let path = dir.join("sub").join("jarvis-log.jsonl");
        append_to(&path, &json!({ "said": "oi" })).unwrap();
        append_to(&path, &json!({ "said": "tchau\nlinha" })).unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        assert_eq!(text.lines().count(), 2);
        assert_eq!(serde_json::from_str::<serde_json::Value>(text.lines().nth(1).unwrap()).unwrap()["said"], "tchau\nlinha");
        std::fs::write(&path, vec![b'x'; LOG_MAX_BYTES as usize]).unwrap();
        append_to(&path, &json!({ "said": "de novo" })).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap().lines().count(), 1);
        assert_eq!(std::fs::metadata(dir.join("sub").join("jarvis-log.jsonl.1")).unwrap().len(), LOG_MAX_BYTES);
    }

    #[test]
    fn find_takes_a_name_or_an_alias_without_case() {
        let ps = vec![
            JarvisProject { name: "mnemo-src".into(), aliases: s(&["a cli do mnemo"]), root: "r1".into() },
            JarvisProject { name: "app".into(), aliases: vec![], root: "r2".into() },
        ];
        assert_eq!(find(&ps, " Mnemo-Src ").map(|p| p.root.as_str()), Some("r1"));
        assert_eq!(find(&ps, "A CLI do mnemo").map(|p| p.root.as_str()), Some("r1"));
        assert!(find(&ps, "mnemo").is_none());
    }
}

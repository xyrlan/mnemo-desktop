# Home Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Home view, shown when no tab is active, that lists repositories and their past Claude Code sessions from `~/.claude/history.jsonl`, and can open a folder, clone with `gh`, start a session, or resume one without ever forking a live session.

**Architecture:** Rust `home.rs` parses history + `claude agents --json --all` into a `HomeSnapshot` (pure parse/join functions, unit-tested on fixtures; one `collect_home` that runs the commands). Frontend `src/home/` follows the `types/client/store/app-store/view` pattern with pure decision functions tested in isolation. The layout store gains `sessionId` on panes, a `showHome()` action and stops auto-spawning a shell.

**Tech Stack:** Tauri 2 (Rust, `tauri-plugin-dialog`), React 18, zustand vanilla stores, vitest + jsdom, cargo test.

**Spec:** `docs/superpowers/specs/2026-09-15-home-screen-design.md`

**Git note for this machine:** `/usr/bin/git` is blocked by the Xcode licence; use `/Library/Developer/CommandLineTools/usr/bin/git` (below written as `git`) and prepend that dir to `PATH` before `gh`.

---

## File structure

| File | Responsibility |
|---|---|
| `src-tauri/src/home.rs` | Types, `parse_history`, `sessions_from_history`, `group_repos`, `classify_live`, `collect_home`, `register_repo` |
| `src-tauri/src/home_commands.rs` | Tauri commands `home_snapshot`, `home_register_repo` |
| `src-tauri/fixtures/history.jsonl` | 9 real-shaped history rows incl. one corrupt line |
| `src-tauri/src/lib.rs` | module + command registration, dialog plugin, menu entry |
| `src-tauri/Cargo.toml`, `package.json`, `src-tauri/capabilities/default.json` | dialog plugin |
| `src/settings/store.ts` | `homePinned`, `homeHidden`, `cloneBase` |
| `src/layout/store.ts` | `Pane.sessionId`, `showHome()`, `openCommandTab()`, no auto `newTab` |
| `src/home/types.ts` | TS mirror of the Rust types + `sortRepos`, `visibleRepos`, `whatClickDoes`, `cloneDest`, `paneForSession` |
| `src/home/client.ts` | `HomeClient` interface + Tauri impl (incl. `pickFolder` via plugin-dialog) |
| `src/home/store.ts` | zustand store: snapshot, selected repo, filter, clone spec, actions |
| `src/home/app-store.ts` | live store wiring |
| `src/home/Home.tsx`, `src/home/home.css` | the view |
| `src/App.tsx` | render Home when `activeTab === ''`, ⌂ button, no boot `newTab` |
| `src/actions/registry.ts`, `src/actions/keys.ts` | `home.show` (⌘⇧H) |
| `src/terminal/cmd-view.tsx` | delegate to `openCommandTab` (keeps `terminal-cmd` view working) |

---

### Task 1: Rust — history parsing and session titles

**Files:**
- Create: `src-tauri/src/home.rs`
- Create: `src-tauri/fixtures/history.jsonl`
- Modify: `src-tauri/src/lib.rs` (module anchor)

- [ ] **Step 1: Fixture**

`src-tauri/fixtures/history.jsonl` (LF endings; `.gitattributes` already marks fixtures `-text`):

```
{"display":"/clear","pastedContents":{},"timestamp":1789300000000,"project":"/Users/me/github/mnemo","sessionId":"aaaa-1"}
{"display":"fix the flaky test in pty.rs please","pastedContents":{},"timestamp":1789300001000,"project":"/Users/me/github/mnemo","sessionId":"aaaa-1"}
{"display":"and add a regression test","pastedContents":{},"timestamp":1789300002000,"project":"/Users/me/github/mnemo","sessionId":"aaaa-1"}
this line is not json
{"display":"qual comando para gerar uma ssh256","pastedContents":{},"timestamp":1789200000000,"project":"/Users/me","sessionId":"bbbb-2"}
{"display":"/voice","pastedContents":{},"timestamp":1789310000000,"project":"/Users/me/github/mnemo-wt-233","sessionId":"cccc-3"}
{"display":"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx","pastedContents":{},"timestamp":1789310001000,"project":"/Users/me/github/mnemo-wt-233","sessionId":"cccc-3"}
{"display":"/help","pastedContents":{},"timestamp":1789320000000,"project":"/Users/me/github/other","sessionId":"dddd-4"}
{"display":"port the sidebar","pastedContents":{},"timestamp":1789330000000,"project":"/Users/me/github/other","sessionId":"eeee-5"}
```

- [ ] **Step 2: Failing tests** — bottom of the new `src-tauri/src/home.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    const HISTORY: &str = include_str!("../fixtures/history.jsonl");

    #[test]
    fn parse_history_skips_bad_lines() {
        let rows = parse_history(HISTORY);
        assert_eq!(rows.len(), 8);
        assert_eq!(rows[0].session_id, "aaaa-1");
        assert_eq!(rows[0].project, "/Users/me/github/mnemo");
    }

    #[test]
    fn title_is_first_non_slash_prompt_cut_to_80() {
        let s = sessions_from_history(&parse_history(HISTORY));
        assert_eq!(s["aaaa-1"].title, "fix the flaky test in pty.rs please");
        assert_eq!(s["aaaa-1"].last_at, 1789300002000);
        assert_eq!(s["aaaa-1"].cwd, "/Users/me/github/mnemo");
        assert_eq!(s["cccc-3"].title.len(), 80);
        // Only slash prompts: fall back to the slash command itself.
        assert_eq!(s["dddd-4"].title, "/help");
    }
}
```

- [ ] **Step 3: Run** `cargo test --manifest-path src-tauri/Cargo.toml home::` → FAIL (module missing).

- [ ] **Step 4: Implement** — top of `src-tauri/src/home.rs`:

```rust
//! Home screen data: repositories and past Claude Code sessions, from
//! `~/.claude/history.jsonl` joined with `claude agents --json --all`.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq)]
pub struct HistoryRow {
    pub project: String,
    pub session_id: String,
    pub display: String,
    pub ts: u64,
}

/// One session as history knows it, before live/transcript joins.
#[derive(Debug, Clone, PartialEq)]
pub struct KnownSession {
    pub id: String,
    pub cwd: String,
    pub title: String,
    pub first_at: u64,
    pub last_at: u64,
}

pub const TITLE_MAX: usize = 80;

/// Every well-formed line of `history.jsonl`, in file order. Bad lines are skipped.
pub fn parse_history(text: &str) -> Vec<HistoryRow> {
    text.lines()
        .filter_map(|l| serde_json::from_str::<serde_json::Value>(l).ok())
        .filter_map(|v| {
            Some(HistoryRow {
                project: v.get("project")?.as_str()?.to_string(),
                session_id: v.get("sessionId")?.as_str()?.to_string(),
                display: v.get("display").and_then(|d| d.as_str()).unwrap_or("").to_string(),
                ts: v.get("timestamp").and_then(|t| t.as_u64()).unwrap_or(0),
            })
        })
        .collect()
}

fn cut(s: &str, max: usize) -> String {
    s.chars().take(max).collect()
}

/// Sessions keyed by id. Title = first prompt that is not a slash command (else the
/// first prompt), cut to `TITLE_MAX` chars; `cwd` = the project of the first row.
pub fn sessions_from_history(rows: &[HistoryRow]) -> HashMap<String, KnownSession> {
    let mut out: HashMap<String, KnownSession> = HashMap::new();
    for r in rows {
        let line = r.display.trim().lines().next().unwrap_or("").trim().to_string();
        let e = out.entry(r.session_id.clone()).or_insert_with(|| KnownSession {
            id: r.session_id.clone(),
            cwd: r.project.clone(),
            title: String::new(),
            first_at: r.ts,
            last_at: r.ts,
        });
        e.last_at = e.last_at.max(r.ts);
        e.first_at = e.first_at.min(r.ts);
        let is_slash = line.starts_with('/');
        if e.title.is_empty() || (e.title.starts_with('/') && !is_slash && !line.is_empty()) {
            if !line.is_empty() {
                e.title = cut(&line, TITLE_MAX);
            }
        }
    }
    out
}
```

Add to `src-tauri/src/lib.rs` after the `// -- cockpit: no Rust --` line:

```rust
// -- home (src/home.rs) --
pub mod home;
```

- [ ] **Step 5: Run** the two tests → PASS.

- [ ] **Step 6: Commit** `git add src-tauri/src/home.rs src-tauri/fixtures/history.jsonl src-tauri/src/lib.rs && git commit -m "feat(home): parse history.jsonl into titled sessions"`

---

### Task 2: Rust — grouping into repos, live classification, snapshot types

**Files:**
- Modify: `src-tauri/src/home.rs`

- [ ] **Step 1: Failing tests** — append inside `mod tests`:

```rust
    fn fake_root(p: &str) -> Option<String> {
        match p {
            "/Users/me/github/mnemo" | "/Users/me/github/mnemo-wt-233" => Some("/Users/me/github/mnemo".into()),
            "/Users/me/github/other" => Some("/Users/me/github/other".into()),
            _ => None,
        }
    }

    #[test]
    fn group_repos_collapses_worktrees_and_drops_non_git() {
        let sessions = sessions_from_history(&parse_history(HISTORY));
        let repos = group_repos(sessions.into_values().collect(), &fake_root, &["/Users/me/github/other".to_string()], &[]);
        let names: Vec<&str> = repos.iter().map(|r| r.name.as_str()).collect();
        // pinned first, then newest activity
        assert_eq!(names, vec!["other", "mnemo"]);
        let mnemo = &repos[1];
        assert_eq!(mnemo.sessions.len(), 2);
        assert_eq!(mnemo.sessions[0].id, "cccc-3"); // newest first
        assert_eq!(mnemo.sessions[0].cwd, "/Users/me/github/mnemo-wt-233");
        assert_eq!(mnemo.last_at, 1789310001000);
        assert!(repos[0].pinned && !repos[1].pinned);
    }

    #[test]
    fn hidden_repos_are_flagged_not_dropped() {
        let sessions = sessions_from_history(&parse_history(HISTORY));
        let repos = group_repos(sessions.into_values().collect(), &fake_root, &[], &["/Users/me/github/mnemo".to_string()]);
        assert!(repos.iter().find(|r| r.name == "mnemo").unwrap().hidden);
    }

    #[test]
    fn live_classification() {
        let agents = r#"[
          {"id":"a","cwd":"/x","kind":"interactive","pid":10,"sessionId":"aaaa-1","name":"pty flake"},
          {"id":"c","cwd":"/x","kind":"background","sessionId":"cccc-3","name":"bg one","state":"working"},
          {"id":"e","cwd":"/x","kind":"interactive","pid":11,"sessionId":"eeee-5"}
        ]"#;
        let live = parse_live(agents).unwrap();
        let here = vec!["eeee-5".to_string()];
        assert_eq!(classify_live(&live, "aaaa-1", &here), Some(Live::Elsewhere));
        assert_eq!(classify_live(&live, "cccc-3", &here), Some(Live::Bg));
        assert_eq!(classify_live(&live, "eeee-5", &here), Some(Live::Here));
        assert_eq!(classify_live(&live, "zzzz", &here), None);
        assert_eq!(live["aaaa-1"].name.as_deref(), Some("pty flake"));
    }

    #[test]
    fn clone_base_is_most_common_parent() {
        let roots = ["/a/gh/one", "/a/gh/two", "/b/three"].map(String::from);
        assert_eq!(clone_base(&roots, "/home/x"), "/a/gh");
        assert_eq!(clone_base(&[], "/home/x"), "/home/x/github");
    }
```

- [ ] **Step 2: Run** → FAIL (missing symbols).

- [ ] **Step 3: Implement** — add above `mod tests`:

```rust
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Live {
    Here,
    Bg,
    Elsewhere,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HomeSession {
    pub id: String,
    pub title: String,
    pub cwd: String,
    pub last_at: u64,
    pub transcript: bool,
    pub live: Option<Live>,
    /// "interactive" | "background", from `claude agents`; "interactive" when unknown.
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HomeRepo {
    pub root: String,
    pub name: String,
    pub last_at: u64,
    pub pinned: bool,
    pub hidden: bool,
    pub sessions: Vec<HomeSession>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct HomeSnapshot {
    pub repos: Vec<HomeRepo>,
    pub clone_base: String,
    pub errors: Vec<String>,
}

pub const SESSIONS_PER_REPO: usize = 50;

/// A row of `claude agents --json --all` that matters to Home.
#[derive(Debug, Clone, PartialEq)]
pub struct LiveRow {
    pub kind: String,
    pub name: Option<String>,
    pub cwd: String,
}

pub fn parse_live(json: &str) -> Result<HashMap<String, LiveRow>, String> {
    let rows: Vec<serde_json::Value> = serde_json::from_str(json).map_err(|e| format!("agents json: {e}"))?;
    Ok(rows
        .iter()
        .filter_map(|r| {
            let id = r.get("sessionId")?.as_str()?.to_string();
            // Finished background jobs are history, not live.
            let state = r.get("state").and_then(|s| s.as_str()).unwrap_or("");
            if matches!(state, "done" | "stopped" | "failed") {
                return None;
            }
            Some((
                id,
                LiveRow {
                    kind: r.get("kind").and_then(|k| k.as_str()).unwrap_or("interactive").to_string(),
                    name: r.get("name").and_then(|n| n.as_str()).map(str::to_string),
                    cwd: r.get("cwd").and_then(|c| c.as_str()).unwrap_or("").to_string(),
                },
            ))
        })
        .collect())
}

pub fn classify_live(live: &HashMap<String, LiveRow>, id: &str, here: &[String]) -> Option<Live> {
    let row = live.get(id)?;
    if here.iter().any(|h| h == id) {
        return Some(Live::Here);
    }
    if row.kind == "background" {
        return Some(Live::Bg);
    }
    Some(Live::Elsewhere)
}

fn basename(p: &str) -> String {
    Path::new(p).file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| p.to_string())
}

/// Group sessions by repo root (`root_of(cwd)`), dropping sessions whose cwd is not a git
/// checkout. Sessions newest first (max `SESSIONS_PER_REPO`); repos pinned first, then
/// by last activity. Hidden repos stay in the list with `hidden: true` so the view can
/// offer "mostrar".
pub fn group_repos(
    sessions: Vec<KnownSession>,
    root_of: &dyn Fn(&str) -> Option<String>,
    pinned: &[String],
    hidden: &[String],
) -> Vec<HomeRepo> {
    let mut by_root: HashMap<String, Vec<KnownSession>> = HashMap::new();
    let mut cache: HashMap<String, Option<String>> = HashMap::new();
    for s in sessions {
        let root = cache.entry(s.cwd.clone()).or_insert_with(|| root_of(&s.cwd)).clone();
        if let Some(root) = root {
            by_root.entry(root).or_default().push(s);
        }
    }
    let mut repos: Vec<HomeRepo> = by_root
        .into_iter()
        .map(|(root, mut ss)| {
            ss.sort_by(|a, b| b.last_at.cmp(&a.last_at));
            ss.truncate(SESSIONS_PER_REPO);
            HomeRepo {
                name: basename(&root),
                last_at: ss.iter().map(|s| s.last_at).max().unwrap_or(0),
                pinned: pinned.contains(&root),
                hidden: hidden.contains(&root),
                sessions: ss
                    .into_iter()
                    .map(|s| HomeSession {
                        id: s.id,
                        title: s.title,
                        cwd: s.cwd,
                        last_at: s.last_at,
                        transcript: false,
                        live: None,
                        kind: "interactive".into(),
                    })
                    .collect(),
                root,
            }
        })
        .collect();
    repos.sort_by(|a, b| b.pinned.cmp(&a.pinned).then(b.last_at.cmp(&a.last_at)));
    repos
}

/// Where clones go by default: the parent directory most repos share, else `<home>/github`.
pub fn clone_base(roots: &[String], home: &str) -> String {
    let mut counts: HashMap<String, usize> = HashMap::new();
    for r in roots {
        if let Some(p) = Path::new(r).parent() {
            *counts.entry(p.to_string_lossy().to_string()).or_default() += 1;
        }
    }
    counts
        .into_iter()
        .max_by(|a, b| a.1.cmp(&b.1).then(b.0.cmp(&a.0)))
        .map(|(p, _)| p)
        .unwrap_or_else(|| format!("{home}/github"))
}
```

- [ ] **Step 4: Run** `cargo test --manifest-path src-tauri/Cargo.toml home::` → 6 PASS.

- [ ] **Step 5: Commit** `git commit -am "feat(home): group sessions into repos, classify live rows"`

---

### Task 3: Rust — `collect_home`, `register_repo`, Tauri commands

**Files:**
- Modify: `src-tauri/src/home.rs`
- Create: `src-tauri/src/home_commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/mission.rs` (make `run` pub(crate))

- [ ] **Step 1: Failing test** — append inside `mod tests`:

```rust
    #[test]
    fn join_marks_transcript_and_live_and_names() {
        let sessions = sessions_from_history(&parse_history(HISTORY));
        let mut repos = group_repos(sessions.into_values().collect(), &fake_root, &[], &[]);
        let live = parse_live(r#"[{"id":"a","cwd":"/x","kind":"interactive","pid":10,"sessionId":"aaaa-1","name":"pty flake"}]"#).unwrap();
        join_live(&mut repos, &live, &[], &|_cwd, id| id == "aaaa-1");
        let mnemo = repos.iter().find(|r| r.name == "mnemo").unwrap();
        let a = mnemo.sessions.iter().find(|s| s.id == "aaaa-1").unwrap();
        assert_eq!(a.title, "pty flake");
        assert!(a.transcript);
        assert_eq!(a.live, Some(Live::Elsewhere));
        let c = mnemo.sessions.iter().find(|s| s.id == "cccc-3").unwrap();
        assert!(!c.transcript);
        assert_eq!(c.live, None);
    }
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** — in `home.rs`:

```rust
/// Fill `live`, `kind`, `transcript`, and prefer the agent's `name` as title.
pub fn join_live(
    repos: &mut [HomeRepo],
    live: &HashMap<String, LiveRow>,
    here: &[String],
    has_transcript: &dyn Fn(&str, &str) -> bool,
) {
    for r in repos.iter_mut() {
        for s in r.sessions.iter_mut() {
            s.transcript = has_transcript(&s.cwd, &s.id);
            s.live = classify_live(live, &s.id, here);
            if let Some(row) = live.get(&s.id) {
                s.kind = row.kind.clone();
                if let Some(n) = row.name.as_ref().filter(|n| !n.is_empty()) {
                    s.title = cut(n, TITLE_MAX);
                }
            }
        }
    }
}

fn home_dir() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default()
}

fn history_path() -> PathBuf {
    home_dir().join(".claude").join("history.jsonl")
}

/// The whole Home snapshot. `here` = session ids the desktop itself is running;
/// `extra_roots` = repos the user opened/cloned that may have no history yet.
pub fn collect_home(here: &[String], pinned: &[String], hidden: &[String], extra_roots: &[String]) -> HomeSnapshot {
    let mut errors = Vec::new();
    let text = std::fs::read_to_string(history_path()).unwrap_or_default();
    let sessions = sessions_from_history(&parse_history(&text));
    let mut repos = group_repos(sessions.into_values().collect(), &crate::mission::repo_root, pinned, hidden);
    for root in extra_roots {
        if !repos.iter().any(|r| &r.root == root) {
            repos.push(HomeRepo {
                root: root.clone(),
                name: basename(root),
                last_at: 0,
                pinned: pinned.contains(root),
                hidden: hidden.contains(root),
                sessions: vec![],
            });
        }
    }
    repos.sort_by(|a, b| b.pinned.cmp(&a.pinned).then(b.last_at.cmp(&a.last_at)));
    let live = match crate::mission::run("claude", &["agents", "--json", "--all"], None).and_then(|j| parse_live(&j)) {
        Ok(l) => l,
        Err(e) => {
            errors.push(e);
            HashMap::new()
        }
    };
    join_live(&mut repos, &live, here, &|cwd, id| crate::mission::transcript_path(cwd, id).is_some());
    let roots: Vec<String> = repos.iter().map(|r| r.root.clone()).collect();
    HomeSnapshot { repos, clone_base: clone_base(&roots, &home_dir().to_string_lossy()), errors }
}

/// A folder the user picked: its main-checkout root, or an error when it is not a git repo.
pub fn register_repo(path: &str) -> Result<String, String> {
    crate::mission::repo_root(path).ok_or_else(|| "não é um repositório git".to_string())
}
```

In `src-tauri/src/mission.rs` change `fn run(` to `pub(crate) fn run(`.

`src-tauri/src/home_commands.rs`:

```rust
use crate::home::{self, HomeSnapshot};

#[tauri::command]
pub async fn home_snapshot(here: Vec<String>, pinned: Vec<String>, hidden: Vec<String>, extra_roots: Vec<String>) -> HomeSnapshot {
    tauri::async_runtime::spawn_blocking(move || home::collect_home(&here, &pinned, &hidden, &extra_roots))
        .await
        .unwrap_or_default()
}

#[tauri::command]
pub fn home_register_repo(path: String) -> Result<String, String> {
    home::register_repo(&path)
}
```

`lib.rs`: under the home anchor add `pub mod home_commands;`; in `generate_handler!` add a block:

```rust
            // -- home commands --
            home_commands::home_snapshot,
            home_commands::home_register_repo,
```

- [ ] **Step 4: Run** `cargo test --manifest-path src-tauri/Cargo.toml` → all PASS (whole crate).

- [ ] **Step 5: Commit** `git add -A src-tauri/src && git commit -m "feat(home): collect_home snapshot and Tauri commands"`

---

### Task 4: Dialog plugin

**Files:**
- Modify: `src-tauri/Cargo.toml`, `package.json`, `src-tauri/capabilities/default.json`, `src-tauri/src/lib.rs`

- [ ] **Step 1:** `cd src-tauri && cargo add tauri-plugin-dialog@2 && cd .. && pnpm add @tauri-apps/plugin-dialog@^2`
- [ ] **Step 2:** `capabilities/default.json` permissions → `["core:default", "dialog:allow-open"]`
- [ ] **Step 3:** `lib.rs`, in `run()` after `tauri::Builder::default()` add `.plugin(tauri_plugin_dialog::init())`
- [ ] **Step 4:** `cargo check --manifest-path src-tauri/Cargo.toml && pnpm build` → both OK.
- [ ] **Step 5: Commit** `git add -A && git commit -m "build: tauri-plugin-dialog for the folder picker"`

---

### Task 5: Settings keys

**Files:**
- Modify: `src/settings/store.ts`, `src/settings/store.test.ts`

- [ ] **Step 1: Failing test** — append to `src/settings/store.test.ts` (follow the file's existing fake-client helper; if it has none, use this one):

```ts
test('home keys round-trip and reject junk', async () => {
  let written: unknown = null
  const s = createSettingsStore({
    read: async () => ({ homePinned: ['/a'], homeHidden: 'nope' as unknown as string[], cloneBase: '/gh' }),
    write: async (v) => { written = v },
  })
  await s.getState().load()
  expect(s.getState().homePinned).toEqual(['/a'])
  expect(s.getState().homeHidden).toEqual([])
  expect(s.getState().cloneBase).toBe('/gh')
  await s.getState().set('homeHidden', ['/b'])
  expect((written as { homeHidden: string[] }).homeHidden).toEqual(['/b'])
})
```

- [ ] **Step 2: Run** `pnpm vitest run src/settings` → FAIL.
- [ ] **Step 3: Implement** in `src/settings/store.ts`:

```ts
export type Settings = {
  outgoing: 'en' | 'as-typed'
  replyLanguage: 'pt' | 'en' | 'unchanged'
  sidebarScope: 'repo' | 'all'
  /** Home screen: repo roots pinned to the top / hidden, and where `gh repo clone` lands. */
  homePinned: string[]
  homeHidden: string[]
  cloneBase: string | null
}

export const DEFAULTS: Settings = { outgoing: 'en', replyLanguage: 'unchanged', sidebarScope: 'repo', homePinned: [], homeHidden: [], cloneBase: null }
```

In `set`, write the whole object: replace the explicit `client.write({...})` with

```ts
      const { outgoing, replyLanguage, sidebarScope, homePinned, homeHidden, cloneBase } = get()
      try { await client.write({ outgoing, replyLanguage, sidebarScope, homePinned, homeHidden, cloneBase }) } catch { /* keep the in-memory value */ }
```

In `pick` add:

```ts
  const strs = (x: unknown): string[] | null => (Array.isArray(x) && x.every((s) => typeof s === 'string') ? x : null)
  const p = strs(v.homePinned); if (p) out.homePinned = p
  const h = strs(v.homeHidden); if (h) out.homeHidden = h
  if (typeof v.cloneBase === 'string' && v.cloneBase) out.cloneBase = v.cloneBase
```

- [ ] **Step 4: Run** `pnpm vitest run src/settings` → PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(settings): homePinned, homeHidden, cloneBase"`

---

### Task 6: Layout store — `sessionId`, `showHome`, `openCommandTab`, no auto shell

**Files:**
- Modify: `src/layout/store.ts`, `src/layout/store.test.ts`
- Modify: `src/terminal/cmd-view.tsx`

- [ ] **Step 1: Failing tests** — append to `src/layout/store.test.ts` (reuse its existing fake `PtyClient` factory; the tests below assume a helper `mk()` returning `{ store, pty }` where `pty.writes: [id, data][]` records writes — add such a helper if the file lacks one):

```ts
test('closing the last tab leaves no tab and activeTab empty (Home shows)', async () => {
  const { store } = mk()
  await store.getState().newTab()
  await store.getState().closeTab(store.getState().activeTab)
  expect(store.getState().tabs).toEqual([])
  expect(store.getState().activeTab).toBe('')
})

test('showHome keeps tabs but clears activeTab; goToTab restores', async () => {
  const { store } = mk()
  await store.getState().newTab()
  store.getState().showHome()
  expect(store.getState().activeTab).toBe('')
  expect(store.getState().tabs).toHaveLength(1)
  store.getState().goToTab(0)
  expect(store.getState().activeTab).toBe(store.getState().tabs[0].id)
})

test('openCommandTab spawns in cwd, tags the pane with the session and types the command', async () => {
  vi.useFakeTimers()
  const { store, pty } = mk()
  await store.getState().openCommandTab('/repo', 'claude --resume abc', 'abc')
  const id = store.getState().tabs[0].focused
  expect(store.getState().panes[id].cwd).toBe('/repo')
  expect(store.getState().panes[id].sessionId).toBe('abc')
  vi.advanceTimersByTime(700)
  expect(pty.writes).toContainEqual([id, 'claude --resume abc\n'])
  vi.useRealTimers()
})
```

- [ ] **Step 2: Run** `pnpm vitest run src/layout/store` → FAIL.
- [ ] **Step 3: Implement** in `src/layout/store.ts`:

`Pane` gains `sessionId?: string`. `Actions` gains:

```ts
  /** Show Home without closing anything: clears `activeTab`; any tab click restores. */
  showHome(): void
  /** New terminal tab in `cwd` that types `cmd` once the shell prompt is up; `sessionId`
   *  marks the pane as running that Claude session so Home can focus it instead of forking. */
  openCommandTab(cwd: string | undefined, cmd: string, sessionId?: string): Promise<void>
```

Implement next to `newTab`:

```ts
      showHome() {
        set({ activeTab: '' })
      },

      async openCommandTab(cwd, cmd, sessionId) {
        const pane = await spawnPane(cwd)
        const tab: Tab = { id: `tab-${pane}`, root: leaf(pane), focused: pane }
        set((s) => ({
          tabs: [...s.tabs, tab],
          activeTab: tab.id,
          panes: { ...s.panes, [pane]: { ...s.panes[pane], id: pane, sessionId } },
        }))
        if (pane > 0) setTimeout(() => void pty.write(pane, cmd + '\n'), PROMPT_DELAY_MS)
      },
```

Add `export const PROMPT_DELAY_MS = 700` near `DEFAULT_COLS`. Delete the two lines `if (get().tabs.length === 0) await get().newTab()` in `closePane` and `closeTab`.

`src/terminal/cmd-view.tsx`: replace the effect body with

```ts
    const s = store.getState()
    const cwd = s.panes[p.id]?.cwd
    void s.openCommandTab(cwd, cmd, typeof p.props.sessionId === 'string' ? p.props.sessionId : undefined)
    s.focusPane(p.id)
    void s.closePane()
```

- [ ] **Step 4: Run** `pnpm vitest run src/layout src/terminal src/mission` → PASS (Sidebar tests that relied on auto-spawn, if any, get an explicit `await appStore.getState().newTab()` in their setup).
- [ ] **Step 5: Commit** `git commit -am "feat(layout): sessionId on panes, showHome, openCommandTab; no auto shell"`

---

### Task 7: Home types + pure decisions

**Files:**
- Create: `src/home/types.ts`, `src/home/types.test.ts`

- [ ] **Step 1: Failing tests** `src/home/types.test.ts`:

```ts
import { cloneDest, paneForSession, visibleRepos, whatClickDoes, type HomeRepo, type HomeSession } from './types'

const sess = (o: Partial<HomeSession> & { id: string }): HomeSession =>
  ({ title: 't', cwd: '/r', last_at: 0, transcript: true, live: null, kind: 'interactive', ...o })
const repo = (o: Partial<HomeRepo> & { root: string }): HomeRepo =>
  ({ name: o.root.split('/').pop()!, last_at: 0, pinned: false, hidden: false, sessions: [], ...o })

test('visibleRepos drops hidden unless showHidden, filters by name/path', () => {
  const rs = [repo({ root: '/a/mnemo' }), repo({ root: '/a/secret', hidden: true }), repo({ root: '/b/desk' })]
  expect(visibleRepos(rs, '', false).map((r) => r.name)).toEqual(['mnemo', 'desk'])
  expect(visibleRepos(rs, '', true).map((r) => r.name)).toEqual(['mnemo', 'secret', 'desk'])
  expect(visibleRepos(rs, '/b', false).map((r) => r.name)).toEqual(['desk'])
  expect(visibleRepos(rs, 'MNE', false).map((r) => r.name)).toEqual(['mnemo'])
})

test('whatClickDoes covers the five states', () => {
  const panes = { 7: { id: 7, view: 'terminal', sessionId: 'x' } }
  expect(whatClickDoes(sess({ id: 'x', live: 'here' }), panes)).toEqual({ kind: 'focus', pane: 7 })
  expect(whatClickDoes(sess({ id: 'y', live: 'here' }), panes)).toEqual({ kind: 'nothing', why: 'aberta em outro terminal' })
  expect(whatClickDoes(sess({ id: 'b', live: 'bg' }), panes)).toEqual({ kind: 'command', cmd: 'claude attach b', sessionId: 'b' })
  expect(whatClickDoes(sess({ id: 'e', live: 'elsewhere' }), panes)).toEqual({ kind: 'nothing', why: 'aberta em outro terminal' })
  expect(whatClickDoes(sess({ id: 'd' }), panes)).toEqual({ kind: 'command', cmd: 'claude --resume d', sessionId: 'd' })
  expect(whatClickDoes(sess({ id: 'g', transcript: false }), panes)).toEqual({ kind: 'nothing', why: 'transcript não encontrado' })
})

test('paneForSession finds the pane running a session', () => {
  expect(paneForSession({ 3: { id: 3, view: 'terminal' }, 9: { id: 9, view: 'terminal', sessionId: 's' } }, 's')).toBe(9)
  expect(paneForSession({}, 's')).toBeNull()
})

test('cloneDest derives the folder name from owner/repo, URL, or .git URL', () => {
  expect(cloneDest('/gh', 'xyrlan/mnemo')).toBe('/gh/mnemo')
  expect(cloneDest('/gh', 'https://github.com/xyrlan/mnemo-desktop')).toBe('/gh/mnemo-desktop')
  expect(cloneDest('/gh', 'git@github.com:xyrlan/mnemo.git')).toBe('/gh/mnemo')
  expect(cloneDest('/gh', '  ')).toBeNull()
})
```

- [ ] **Step 2: Run** `pnpm vitest run src/home` → FAIL.
- [ ] **Step 3: Implement** `src/home/types.ts`:

```ts
/** Mirrors `src-tauri/src/home.rs`. */
export type Live = 'here' | 'bg' | 'elsewhere'
export type HomeSession = { id: string; title: string; cwd: string; last_at: number; transcript: boolean; live: Live | null; kind: string }
export type HomeRepo = { root: string; name: string; last_at: number; pinned: boolean; hidden: boolean; sessions: HomeSession[] }
export type HomeSnapshot = { repos: HomeRepo[]; clone_base: string; errors: string[] }

export const EMPTY: HomeSnapshot = { repos: [], clone_base: '', errors: [] }

type PaneLike = { id: number; sessionId?: string }

export function paneForSession(panes: Record<number, PaneLike>, sessionId: string): number | null {
  for (const p of Object.values(panes)) if (p.sessionId === sessionId) return p.id
  return null
}

export type Click =
  | { kind: 'focus'; pane: number }
  | { kind: 'command'; cmd: string; sessionId: string }
  | { kind: 'nothing'; why: string }

export const ELSEWHERE = 'aberta em outro terminal'
export const NO_TRANSCRIPT = 'transcript não encontrado'

/** Never fork: a live session is focused or attached, only a dead one is resumed. */
export function whatClickDoes(s: HomeSession, panes: Record<number, PaneLike>): Click {
  if (s.live === 'here') {
    const pane = paneForSession(panes, s.id)
    return pane === null ? { kind: 'nothing', why: ELSEWHERE } : { kind: 'focus', pane }
  }
  if (s.live === 'bg') return { kind: 'command', cmd: `claude attach ${s.id}`, sessionId: s.id }
  if (s.live === 'elsewhere') return { kind: 'nothing', why: ELSEWHERE }
  if (!s.transcript) return { kind: 'nothing', why: NO_TRANSCRIPT }
  return { kind: 'command', cmd: `claude --resume ${s.id}`, sessionId: s.id }
}

export function visibleRepos(repos: HomeRepo[], filter: string, showHidden: boolean): HomeRepo[] {
  const q = filter.trim().toLowerCase()
  return repos.filter((r) => (showHidden || !r.hidden) && (!q || r.name.toLowerCase().includes(q) || r.root.toLowerCase().includes(q)))
}

/** `<base>/<name>` for `owner/repo`, an https URL, or an ssh URL; null when blank. */
export function cloneDest(base: string, spec: string): string | null {
  const s = spec.trim()
  if (!s) return null
  const name = s.replace(/\/+$/, '').split(/[/:]/).pop()?.replace(/\.git$/, '')
  return name ? `${base.replace(/\/+$/, '')}/${name}` : null
}

export function relTime(ms: number, now = Date.now()): string {
  if (!ms) return ''
  const d = Math.max(0, now - ms)
  const m = Math.round(d / 60000)
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 48) return `${h}h`
  return `${Math.round(h / 24)}d`
}
```

- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `git add src/home && git commit -m "feat(home): types and pure click/visibility/clone decisions"`

---

### Task 8: Home client + store

**Files:**
- Create: `src/home/client.ts`, `src/home/store.ts`, `src/home/store.test.ts`, `src/home/app-store.ts`

- [ ] **Step 1: Failing tests** `src/home/store.test.ts`:

```ts
import { createHomeStore } from './store'
import type { HomeClient } from './client'
import type { HomeSnapshot } from './types'

const snap: HomeSnapshot = {
  repos: [
    { root: '/gh/a', name: 'a', last_at: 2, pinned: false, hidden: false, sessions: [{ id: 's1', title: 'one', cwd: '/gh/a', last_at: 2, transcript: true, live: null, kind: 'interactive' }] },
    { root: '/gh/b', name: 'b', last_at: 1, pinned: false, hidden: false, sessions: [] },
  ],
  clone_base: '/gh',
  errors: [],
}

function mk(over: Partial<HomeClient> = {}) {
  const calls: string[] = []
  const client: HomeClient = {
    snapshot: async () => snap,
    registerRepo: async (p) => p,
    pickFolder: async () => '/gh/picked',
    ...over,
  }
  const settings = { homePinned: [] as string[], homeHidden: [] as string[], cloneBase: null as string | null }
  const setSetting = async (k: 'homePinned' | 'homeHidden', v: string[]) => { settings[k] = v; calls.push(`${k}=${v.join(',')}`) }
  const layout = {
    panes: {} as Record<number, { id: number; sessionId?: string }>,
    commands: [] as string[],
    focused: [] as number[],
    openCommandTab: async (cwd: string | undefined, cmd: string) => { layout.commands.push(`${cwd}:${cmd}`) },
    newTab: async (cwd?: string) => { layout.commands.push(`${cwd}:shell`) },
    focusPane: (id: number) => { layout.focused.push(id) },
  }
  const store = createHomeStore(client, () => settings, setSetting, layout)
  return { store, calls, layout }
}

test('load selects the first repo and keeps selection across reloads', async () => {
  const { store } = mk()
  await store.getState().load()
  expect(store.getState().selected).toBe('/gh/a')
  store.getState().select('/gh/b')
  await store.getState().load()
  expect(store.getState().selected).toBe('/gh/b')
})

test('pin and hide toggle the settings arrays', async () => {
  const { store, calls } = mk()
  await store.getState().load()
  await store.getState().togglePin('/gh/a')
  await store.getState().toggleHidden('/gh/a')
  expect(calls).toEqual(['homePinned=/gh/a', 'homeHidden=/gh/a'])
  await store.getState().togglePin('/gh/a')
  expect(calls.at(-1)).toBe('homePinned=')
})

test('openSession resumes a dead session in the repo root; newSession and shell open tabs', async () => {
  const { store, layout } = mk()
  await store.getState().load()
  store.getState().openSession(snap.repos[0], snap.repos[0].sessions[0])
  store.getState().newSession('/gh/b')
  store.getState().shell('/gh/b')
  expect(layout.commands).toEqual(['/gh/a:claude --resume s1', '/gh/b:claude', '/gh/b:shell'])
})

test('openSession with a live-here session focuses its pane', async () => {
  const { store, layout } = mk()
  layout.panes[4] = { id: 4, sessionId: 's1' }
  await store.getState().load()
  store.getState().openSession(snap.repos[0], { ...snap.repos[0].sessions[0], live: 'here' })
  expect(layout.focused).toEqual([4])
  expect(layout.commands).toEqual([])
})

test('clone types gh into a tab under clone_base and remembers the dest as an extra root', async () => {
  const { store, layout } = mk()
  await store.getState().load()
  store.getState().setCloneSpec('xyrlan/mnemo')
  await store.getState().clone()
  expect(layout.commands).toEqual(['/gh:gh repo clone xyrlan/mnemo /gh/mnemo'])
  expect(store.getState().extraRoots).toEqual(['/gh/mnemo'])
  expect(store.getState().cloneSpec).toBe('')
})

test('openFolder registers the picked dir and refreshes; non-git surfaces the error', async () => {
  const { store } = mk({ registerRepo: async () => { throw 'não é um repositório git' } })
  await store.getState().load()
  await store.getState().openFolder()
  expect(store.getState().notice).toBe('não é um repositório git')
  const ok = mk()
  await ok.store.getState().load()
  await ok.store.getState().openFolder()
  expect(ok.store.getState().extraRoots).toEqual(['/gh/picked'])
  expect(ok.store.getState().selected).toBe('/gh/picked')
})
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**

`src/home/client.ts`:

```ts
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import type { HomeSnapshot } from './types'

export interface HomeClient {
  snapshot(args: { here: string[]; pinned: string[]; hidden: string[]; extraRoots: string[] }): Promise<HomeSnapshot>
  /** Main-checkout root of a folder, or rejects with "não é um repositório git". */
  registerRepo(path: string): Promise<string>
  /** Native directory picker; null when cancelled. */
  pickFolder(): Promise<string | null>
}

export const tauriHome: HomeClient = {
  snapshot: (a) => invoke('home_snapshot', a),
  registerRepo: (path) => invoke('home_register_repo', { path }),
  pickFolder: async () => {
    const r = await open({ directory: true, multiple: false })
    return typeof r === 'string' ? r : null
  },
}
```

`src/home/store.ts`:

```ts
import { createStore as createZustand, type StoreApi } from 'zustand/vanilla'
import type { HomeClient } from './client'
import { cloneDest, EMPTY, whatClickDoes, type HomeRepo, type HomeSession, type HomeSnapshot } from './types'

export type HomeSettings = { homePinned: string[]; homeHidden: string[]; cloneBase: string | null }
export type SetSetting = (key: 'homePinned' | 'homeHidden', value: string[]) => Promise<void>
/** The slice of the layout store Home drives. Injected so tests never touch Tauri. */
export type LayoutLike = {
  panes: Record<number, { id: number; sessionId?: string }>
  openCommandTab(cwd: string | undefined, cmd: string, sessionId?: string): Promise<void>
  newTab(cwd?: string): Promise<void>
  focusPane(id: number): void
}

export type HomeState = {
  snapshot: HomeSnapshot
  loading: boolean
  selected: string | null
  filter: string
  showHidden: boolean
  cloneSpec: string
  /** Roots opened or cloned this run that history does not know yet. */
  extraRoots: string[]
  notice: string | null
}
export type HomeActions = {
  load(): Promise<void>
  select(root: string): void
  setFilter(q: string): void
  setShowHidden(v: boolean): void
  setCloneSpec(s: string): void
  togglePin(root: string): Promise<void>
  toggleHidden(root: string): Promise<void>
  openSession(repo: HomeRepo, s: HomeSession): void
  newSession(root: string): void
  shell(root: string): void
  openFolder(): Promise<void>
  clone(): Promise<void>
  dismiss(): void
}
export type HomeStore = StoreApi<HomeState & HomeActions>

const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

export function createHomeStore(client: HomeClient, settings: () => HomeSettings, setSetting: SetSetting, layout: LayoutLike): HomeStore {
  return createZustand<HomeState & HomeActions>((set, get) => ({
    snapshot: EMPTY,
    loading: false,
    selected: null,
    filter: '',
    showHidden: false,
    cloneSpec: '',
    extraRoots: [],
    notice: null,

    async load() {
      set({ loading: true })
      const s = settings()
      const here = Object.values(layout.panes).map((p) => p.sessionId).filter((x): x is string => !!x)
      try {
        const snapshot = await client.snapshot({ here, pinned: s.homePinned, hidden: s.homeHidden, extraRoots: get().extraRoots })
        const selected = get().selected
        const keep = selected && snapshot.repos.some((r) => r.root === selected)
        set({ snapshot, loading: false, selected: keep ? selected : snapshot.repos.find((r) => !r.hidden)?.root ?? null })
      } catch (e) {
        set({ loading: false, notice: String(e) })
      }
    },
    select: (root) => set({ selected: root }),
    setFilter: (filter) => set({ filter }),
    setShowHidden: (showHidden) => set({ showHidden }),
    setCloneSpec: (cloneSpec) => set({ cloneSpec }),
    async togglePin(root) {
      await setSetting('homePinned', toggle(settings().homePinned, root))
      await get().load()
    },
    async toggleHidden(root) {
      await setSetting('homeHidden', toggle(settings().homeHidden, root))
      await get().load()
    },
    openSession(repo, s) {
      const c = whatClickDoes(s, layout.panes)
      if (c.kind === 'focus') layout.focusPane(c.pane)
      else if (c.kind === 'command') void layout.openCommandTab(repo.root, c.cmd, c.sessionId)
      else set({ notice: c.why })
    },
    newSession: (root) => void layout.openCommandTab(root, 'claude'),
    shell: (root) => void layout.newTab(root),
    async openFolder() {
      const picked = await client.pickFolder()
      if (!picked) return
      try {
        const root = await client.registerRepo(picked)
        set((st) => ({ extraRoots: st.extraRoots.includes(root) ? st.extraRoots : [...st.extraRoots, root], selected: root }))
        await get().load()
      } catch (e) {
        set({ notice: String(e) })
      }
    },
    async clone() {
      const base = settings().cloneBase ?? get().snapshot.clone_base
      const dest = cloneDest(base, get().cloneSpec)
      if (!dest) return
      const spec = get().cloneSpec.trim()
      await layout.openCommandTab(base, `gh repo clone ${spec} ${dest}`)
      set((st) => ({ extraRoots: [...st.extraRoots, dest], cloneSpec: '' }))
    },
    dismiss: () => set({ notice: null }),
  }))
}
```

`src/home/app-store.ts`:

```ts
import { useStore } from 'zustand'
import { createHomeStore, type HomeActions, type HomeState } from './store'
import { tauriHome } from './client'
import { settingsStore } from '../settings/app-store'
import { store as layout } from '../layout/app-store'

export const homeStore = createHomeStore(
  tauriHome,
  () => {
    const s = settingsStore.getState()
    return { homePinned: s.homePinned, homeHidden: s.homeHidden, cloneBase: s.cloneBase }
  },
  (k, v) => settingsStore.getState().set(k, v),
  {
    get panes() { return layout.getState().panes },
    openCommandTab: (cwd, cmd, sid) => layout.getState().openCommandTab(cwd, cmd, sid),
    newTab: (cwd) => layout.getState().newTab(cwd),
    focusPane: (id) => layout.getState().focusPane(id),
  },
)
export const useHome = <T,>(sel: (s: HomeState & HomeActions) => T) => useStore(homeStore, sel)
```

- [ ] **Step 4: Run** `pnpm vitest run src/home` → PASS.
- [ ] **Step 5: Commit** `git add src/home && git commit -m "feat(home): client and store"`

---

### Task 9: Home view, CSS, App integration, action + shortcut + menu

**Files:**
- Create: `src/home/Home.tsx`, `src/home/home.css`, `src/home/Home.test.tsx`
- Modify: `src/App.tsx`, `src/actions/registry.ts`, `src/actions/keys.ts` (+ its test), `src-tauri/src/lib.rs` (VIEW menu), `src/theme.css`

- [ ] **Step 1: Failing view test** `src/home/Home.test.tsx`:

```tsx
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => ({ repos: [], clone_base: '/gh', errors: [] })) }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(async () => null) }))

import Home from './Home'
import { homeStore } from './app-store'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })

test('renders repos and sessions from the store, live badge and disabled row', async () => {
  homeStore.setState({
    snapshot: {
      repos: [{ root: '/gh/a', name: 'a', last_at: Date.now(), pinned: true, hidden: false, sessions: [
        { id: 's1', title: 'fix pty', cwd: '/gh/a', last_at: Date.now(), transcript: true, live: 'elsewhere', kind: 'interactive' },
        { id: 's2', title: 'gone', cwd: '/gh/a', last_at: 1, transcript: false, live: null, kind: 'interactive' },
      ] }],
      clone_base: '/gh', errors: [],
    },
    selected: '/gh/a',
  })
  await act(async () => root.render(<Home />))
  expect(host.querySelector('.hm-repo.hm-selected .hm-repo-name')?.textContent).toBe('a')
  const rows = host.querySelectorAll('.hm-session')
  expect(rows).toHaveLength(2)
  expect(rows[0].querySelector('.hm-live')?.textContent).toBe('em outro terminal')
  expect((rows[1] as HTMLButtonElement).disabled).toBe(true)
})

test('empty history shows the two entry buttons', async () => {
  homeStore.setState({ snapshot: { repos: [], clone_base: '/gh', errors: [] }, selected: null })
  await act(async () => root.render(<Home />))
  expect(host.querySelector('.hm-empty')).not.toBeNull()
  expect(host.querySelectorAll('.hm-empty button')).toHaveLength(2)
})
```

- [ ] **Step 2: Run** `pnpm vitest run src/home/Home` → FAIL.
- [ ] **Step 3: Implement** `src/home/Home.tsx`:

```tsx
import { useEffect } from 'react'
import { homeStore, useHome } from './app-store'
import { relTime, visibleRepos, whatClickDoes, type HomeRepo, type HomeSession } from './types'
import { store as layout, useApp } from '../layout/app-store'
import './home.css'

const short = (p: string) => p.replace(/^\/Users\/[^/]+/, '~')

function Entry() {
  const spec = useHome((s) => s.cloneSpec)
  const h = homeStore.getState()
  return (
    <div className="hm-entry">
      <button className="hm-btn" onClick={() => void h.openFolder()}>Abrir pasta…</button>
      <form className="hm-clone" onSubmit={(e) => { e.preventDefault(); void h.clone() }}>
        <input placeholder="owner/repo ou URL" value={spec} onChange={(e) => h.setCloneSpec(e.target.value)} />
        <button className="hm-btn" type="submit" disabled={!spec.trim()}>Clonar</button>
      </form>
    </div>
  )
}

function RepoRow({ r, selected }: { r: HomeRepo; selected: boolean }) {
  const live = r.sessions.some((s) => s.live)
  return (
    <button className={`hm-repo${selected ? ' hm-selected' : ''}${r.hidden ? ' hm-hidden' : ''}`} onClick={() => homeStore.getState().select(r.root)} title={r.root}>
      <span className="hm-repo-name">{r.pinned ? '★ ' : ''}{r.name}</span>
      <span className="hm-repo-path">{short(r.root)}</span>
      <span className="hm-repo-when">{live && <span className="hm-dot" />}{relTime(r.last_at)}</span>
    </button>
  )
}

function SessionRow({ repo, s }: { repo: HomeRepo; s: HomeSession }) {
  const panes = useApp((st) => st.panes)
  const click = whatClickDoes(s, panes)
  const badge = s.live === 'here' ? 'aqui' : s.live === 'bg' ? 'background' : s.live === 'elsewhere' ? 'em outro terminal' : null
  return (
    <button className="hm-session" disabled={click.kind === 'nothing'} title={click.kind === 'nothing' ? click.why : s.id} onClick={() => homeStore.getState().openSession(repo, s)}>
      {badge && <span className={`hm-live hm-live-${s.live}`}>{badge}</span>}
      <span className="hm-session-title">{s.title || s.id.slice(0, 8)}</span>
      <span className="hm-session-meta">
        {s.cwd !== repo.root && <span className="hm-session-cwd">{short(s.cwd)}</span>}
        {relTime(s.last_at)}
      </span>
    </button>
  )
}

export default function Home() {
  const snap = useHome((s) => s.snapshot)
  const selected = useHome((s) => s.selected)
  const filter = useHome((s) => s.filter)
  const showHidden = useHome((s) => s.showHidden)
  const notice = useHome((s) => s.notice)
  const tabs = useApp((s) => s.tabs)
  const h = homeStore.getState()

  useEffect(() => { void homeStore.getState().load() }, [])

  const repos = visibleRepos(snap.repos, filter, showHidden)
  const repo = snap.repos.find((r) => r.root === selected) ?? null
  const hiddenCount = snap.repos.filter((r) => r.hidden).length

  if (snap.repos.length === 0) {
    return (
      <div className="hm hm-empty">
        <p>Nenhum repositório ainda. Abra uma pasta ou clone um do GitHub.</p>
        <Entry />
        {notice && <div className="hm-notice" onClick={h.dismiss}>{notice}</div>}
      </div>
    )
  }

  return (
    <div className="hm">
      <header className="hm-head">
        <span className="hm-title">mnemo</span>
        {tabs.length > 0 && <button className="hm-btn hm-back" onClick={() => layout.getState().goToTab(0)}>← voltar</button>}
        <Entry />
      </header>
      <div className="hm-body">
        <aside className="hm-left">
          <input className="hm-filter" placeholder="filtrar…" value={filter} onChange={(e) => h.setFilter(e.target.value)} />
          {repos.map((r) => <RepoRow key={r.root} r={r} selected={r.root === selected} />)}
          {hiddenCount > 0 && (
            <button className="hm-link" onClick={() => h.setShowHidden(!showHidden)}>
              {showHidden ? 'ocultar escondidos' : `${hiddenCount} escondido${hiddenCount > 1 ? 's' : ''}`}
            </button>
          )}
        </aside>
        <main className="hm-right">
          {repo && (
            <>
              <div className="hm-repo-head">
                <h2>{repo.name}</h2>
                <span className="hm-repo-path">{short(repo.root)}</span>
                <span className="hm-actions">
                  <button className="hm-btn hm-primary" onClick={() => h.newSession(repo.root)}>Nova sessão</button>
                  <button className="hm-btn" onClick={() => h.shell(repo.root)}>Shell</button>
                  <button className="hm-btn" onClick={() => void h.togglePin(repo.root)}>{repo.pinned ? 'Desafixar' : 'Fixar'}</button>
                  <button className="hm-btn" onClick={() => void h.toggleHidden(repo.root)}>{repo.hidden ? 'Mostrar' : 'Esconder'}</button>
                </span>
              </div>
              {repo.sessions.length === 0 ? (
                <p className="hm-muted">Nenhuma sessão ainda.</p>
              ) : (
                repo.sessions.map((s) => <SessionRow key={s.id} repo={repo} s={s} />)
              )}
            </>
          )}
        </main>
      </div>
      {snap.errors.length > 0 && <div className="hm-errors">{snap.errors.join(' · ')}</div>}
      {notice && <div className="hm-notice" onClick={h.dismiss}>{notice}</div>}
    </div>
  )
}
```

`src/home/home.css`:

```css
.hm { position: absolute; inset: 0; display: flex; flex-direction: column; background: var(--bg); overflow: hidden; }
.hm-head { display: flex; align-items: center; gap: 16px; padding: 14px 20px; border-bottom: 1px solid var(--border); }
.hm-title { font-weight: 700; color: var(--accent); letter-spacing: .04em; }
.hm-entry { margin-left: auto; display: flex; gap: 8px; align-items: center; }
.hm-clone { display: flex; gap: 6px; }
.hm-clone input, .hm-filter { background: var(--bg-elev); color: var(--fg); border: 1px solid var(--border); padding: 5px 8px; font: inherit; border-radius: 4px; min-width: 240px; }
.hm-btn, .hm-link { background: var(--bg-elev); color: var(--fg); border: 1px solid var(--border); padding: 5px 10px; font: inherit; border-radius: 4px; cursor: pointer; }
.hm-btn:hover { border-color: var(--accent); }
.hm-btn:disabled { opacity: .4; cursor: default; }
.hm-primary { background: var(--accent); color: var(--bg); border-color: var(--accent); font-weight: 700; }
.hm-link { border: 0; background: transparent; color: var(--fg-muted); text-align: left; }
.hm-body { flex: 1; min-height: 0; display: flex; }
.hm-left { width: 320px; border-right: 1px solid var(--border); overflow: auto; padding: 10px; display: flex; flex-direction: column; gap: 2px; }
.hm-filter { min-width: 0; margin-bottom: 8px; }
.hm-repo { display: grid; grid-template-columns: 1fr auto; gap: 0 8px; text-align: left; background: transparent; border: 0; color: var(--fg); padding: 6px 8px; border-radius: 4px; font: inherit; cursor: pointer; }
.hm-repo:hover { background: var(--bg-elev); }
.hm-repo.hm-selected { background: var(--bg-elev); outline: 1px solid var(--border-focus); }
.hm-repo.hm-hidden { opacity: .5; }
.hm-repo-name { font-weight: 700; }
.hm-repo-path { grid-column: 1; color: var(--fg-muted); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hm-repo-when { grid-column: 2; grid-row: 1 / span 2; color: var(--fg-muted); font-size: 11px; display: flex; align-items: center; gap: 6px; }
.hm-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--ansi-green); }
.hm-right { flex: 1; min-width: 0; overflow: auto; padding: 16px 24px; display: flex; flex-direction: column; gap: 4px; }
.hm-repo-head { display: flex; align-items: baseline; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }
.hm-repo-head h2 { margin: 0; font-size: 16px; }
.hm-actions { margin-left: auto; display: flex; gap: 6px; }
.hm-session { display: flex; align-items: center; gap: 10px; text-align: left; background: transparent; border: 1px solid transparent; color: var(--fg); padding: 7px 10px; border-radius: 4px; font: inherit; cursor: pointer; }
.hm-session:hover:not(:disabled) { background: var(--bg-elev); border-color: var(--border); }
.hm-session:disabled { opacity: .45; cursor: default; }
.hm-session-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hm-session-meta { color: var(--fg-muted); font-size: 11px; display: flex; gap: 10px; white-space: nowrap; }
.hm-live { font-size: 10px; padding: 1px 6px; border-radius: 3px; border: 1px solid var(--border); color: var(--fg-muted); white-space: nowrap; }
.hm-live-here { color: var(--ansi-green); border-color: var(--ansi-green); }
.hm-live-bg { color: var(--ansi-cyan); border-color: var(--ansi-cyan); }
.hm-muted { color: var(--fg-muted); }
.hm-empty { align-items: center; justify-content: center; gap: 16px; color: var(--fg-muted); }
.hm-empty .hm-entry { margin: 0; }
.hm-errors { padding: 6px 20px; color: var(--fg-muted); font-size: 11px; border-top: 1px solid var(--border); }
.hm-notice { position: absolute; bottom: 16px; left: 50%; transform: translateX(-50%); background: var(--bg-elev); border: 1px solid var(--ansi-yellow); color: var(--fg); padding: 8px 14px; border-radius: 4px; cursor: pointer; }
```

`src/App.tsx`:
- add `import Home from './home/Home'`
- delete the boot block `if (!booted && ...) { booted = true; void store.getState().newTab() }` and the `booted` let; the effect keeps `return installKeys()`.
- in `.tabbar`, before the tabs map: `<div className={`tab-home${activeTab === '' ? ' active' : ''}`} title="Home (⌘⇧H)" onMouseDown={() => store.getState().showHome()}>⌂</div>`
- in `.workspace`, after the tabs map: `{activeTab === '' && <Home />}`

`src/theme.css` add: `.tab-home { padding: 0 12px; display: flex; align-items: center; color: var(--fg-muted); border-right: 1px solid var(--border); cursor: default; } .tab-home.active { color: var(--fg); background: var(--bg); }`

`src/actions/registry.ts` add: `register({ id: 'home.show', title: 'Home', shortcut: '⌘⇧H', run: () => s().showHome() })`

`src/actions/keys.ts`, in the `e.shiftKey` map add `h: 'home.show'`; in `keys.test.ts` add an assertion `expect(actionForKey(key('h', { shiftKey: true }), 'mac')).toBe('home.show')` using that file's key helper.

`src-tauri/src/lib.rs` VIEW table add `("home.show", "Home", "CmdOrCtrl+Shift+H"),`. If `keys.test.ts` reads this table (the comment says it does), keep the tuple on one line.

- [ ] **Step 4: Run** `pnpm test && pnpm build && cargo test --manifest-path src-tauri/Cargo.toml` → all green.
- [ ] **Step 5: Commit** `git add -A && git commit -m "feat(home): Home view replaces the boot shell; ⌘⇧H and ⌂"`

---

### Task 10: Real-app check and PR

- [ ] **Step 1:** `pnpm tauri dev` (background). Confirm: app opens on Home with real repos (mnemo, mnemo-desktop… and no `/Users/xyrlan`, no `tmp-probe`); worktree sessions listed under the main repo with their cwd shown; clicking a dead session opens a tab that types `claude --resume <id>`; ⌘⇧W on the last tab returns to Home; "Abrir pasta" on a non-git folder shows the notice; Clone `xyrlan/mnemo-desktop` into a temp base would type the `gh` line (cancel or let it run into a temp dir).
- [ ] **Step 2:** Fix anything found, commit.
- [ ] **Step 3:** `git push -u origin feat/home-screen`, `gh pr create` with `Closes` none (no issue), body from the spec's Decisions table. Gate merge on `gh pr checks --fail-fast` exit code, then `gh pr merge --squash --delete-branch`.

---

## Self-review

- Spec coverage: Home placement (T9), derived+curated repos (T2/T3/T5), never-fork click (T7/T8), dialog (T4), clone via terminal tab (T8), title rule (T1/T3), `sessionId` on panes (T6), ⌂/⌘⇧H (T9), settings (T5), errors line + notice (T9), tests as listed. Idle-shell reuse: out of scope, none.
- Types: `HomeSnapshot.clone_base` snake_case on both sides (serde default); `Live` serialises lowercase and TS uses `'here' | 'bg' | 'elsewhere'`; `openCommandTab(cwd, cmd, sessionId?)` same signature in store, cmd-view, `LayoutLike`, app-store.
- `terminal-cmd` view keeps working for the cockpit's `claude attach` (now delegates to `openCommandTab`).

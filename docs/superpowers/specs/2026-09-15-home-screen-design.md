# Home screen: open, clone, resume

**Date:** 2026-09-15
**Status:** approved (user delegated the remaining choices to Claude on 2026-09-15)

## Problem

mnemo-desktop boots straight into an empty shell tab. There is no way to open a repository,
clone one, or get back to a Claude Code conversation from yesterday without remembering the
session id and typing `claude --resume` yourself. Everything that would make that possible
already exists on disk: `~/.claude/history.jsonl` (every prompt with its project and session
id), `~/.claude/projects/<slug>/<id>.jsonl` (transcripts), `claude agents --json --all`
(live sessions), and `gh` (authenticated).

## Decisions

| Question | Choice | Why |
|---|---|---|
| Where does Home live? | Home **replaces** the initial shell tab. Shown whenever `tabs.length === 0`; the boot no longer spawns a tab. Closing the last tab returns to Home. ⌘⇧H / a ⌂ button in the tabbar open it any time (it is a view of the workspace, not a tab). | One fewer piece than a permanent tab; does not compete with the mission sidebar, which is about *now*, not history. |
| What is a repository? | **Derived from history, filtered, then curated.** Each `project` in `history.jsonl` resolves to its git root; worktrees collapse into the main checkout (`git rev-parse --git-common-dir`); non-git projects are dropped. Open and Clone add to the same set. Pin and Hide are persisted in settings. | Full list on first launch (60+ projects here), no junk (`/Users/xyrlan`, `tmp-probe`), and the user still controls the shape. |
| Clicking an old session | **Never fork.** Live *in this window* → focus that pane. Live in a `--bg` job → new tab `claude attach <id>`. Live in another terminal → row says "aberta em outro terminal", click does nothing. Dead with a transcript → new tab, cwd = repo root, `claude --resume <id>`. Transcript missing → row disabled. | `--resume` on a live session bifurcates (verified 2026-09-12). |
| Idle-shell reuse | Not now. | Optimisation; revisit if it annoys. |
| Open folder | `tauri-plugin-dialog` directory picker. | Native, one dependency. |
| Clone | `gh repo clone <spec> <dest>` typed into a fresh terminal tab (existing `terminal-cmd` view), dest = `<cloneBase>/<name>`, `cloneBase` defaults to the most common parent of known repos (here `~/github`). When the tab's shell prompt returns Home refreshes. | Progress is visible for free; `gh` handles auth and `owner/repo` shorthand. |
| Session title | `name` from `claude agents` when the session is known there; otherwise the first prompt in `history.jsonl` whose `display` does not start with `/`, cut to 80 chars. | Transcripts here carry no `summary` lines. |

## Architecture

Follows the existing `src/<view>/` pattern: `types.ts`, `client.ts` (Tauri invoke), `store.ts`
(pure zustand, injectable client), `app-store.ts`, `view.tsx`, `home.css`, tests beside each.
Rust side mirrors `mission.rs`: parse functions are pure and unit-tested on fixtures, one
`collect_*` joins the sources, one Tauri command per verb.

### Rust (`src-tauri/src/home.rs`, commands in `commands.rs`)

```rust
pub struct HomeSession { id, title, cwd, last_at: u64 /*ms*/, transcript: bool,
                         live: Option<"here"|"bg"|"elsewhere">, kind: "interactive"|"background" }
pub struct HomeRepo    { root, name, last_at: u64, pinned: bool, hidden: bool,
                         sessions: Vec<HomeSession> /* newest first, max 50 */ }
pub struct HomeSnapshot{ repos: Vec<HomeRepo> /* pinned first, then by last_at */,
                         clone_base: String, errors: Vec<String> }
```

- `parse_history(text) -> Vec<HistoryRow{project, session_id, display, ts}>` — tolerant of bad lines.
- `sessions_from_history(rows) -> HashMap<session_id, (project, title, last_at)>` — title rule above.
- `repo_root_of(project) -> Option<String>` — `git rev-parse --git-common-dir` from `project`; parent of that dir is the root; cached per process by project path. Non-git → `None`.
- `collect_home(pinned, hidden, live: &[AgentRow]) -> HomeSnapshot` — groups by root, checks `transcript_path(cwd, id).exists()` (already in `mission.rs`), joins live rows from `claude agents --json --all` (reuse `parse_agents`; a row with a `pid` whose session id is in `desktop_sessions` → `here`, kind background → `bg`, else `elsewhere`).
- Commands: `home_snapshot(desktop_session_ids: Vec<String>)`, `home_pick_folder()` (dialog), `home_register_repo(path)` (validates git root, returns the `HomeRepo`).
- `history.jsonl` is re-read on every snapshot (5.8k lines, ~1 MB, milliseconds). No watcher; the view refreshes on show and after Open/Clone.

### Frontend

- `src/home/store.ts` — `snapshot`, `filter` (text), `load()`, `pin(root)`, `hide(root)`, `open(session)`, `newSession(root, {shell?: boolean})`, `openFolder()`, `clone(spec)`. Pure decisions (`whatClickDoes(session, panes)`, sorting, filtering, clone dest) are exported functions with tests.
- Pane record gains an optional `sessionId`, set by the code that opens a pane for a known session (`claude --resume <id>`, `claude attach <id>`). A pane started with a bare `claude` has no id until Claude prints one, so that session shows as `elsewhere` in Home. Accepted for now.
- `App.tsx`: Home renders in the workspace when `activeTab === ''` (true when `tabs` is empty, and after `home.show`). Drop the boot `newTab()` and the two `if (tabs.length === 0) newTab()` lines in `closePane`/`closeTab`. Tabbar shows ⌂ at the left; action `home.show` (⌘⇧H) sets `activeTab = ''` without closing tabs; clicking a tab restores it.
- Settings gain `homePinned: string[]`, `homeHidden: string[]`, `cloneBase: string | null`.

### Layout

Two columns. Left: search box, then repos (pinned section, then recent), each row = name, path
dimmed, last activity, live dot when any session is live. Right: the selected repo — header
with "Nova sessão", "Shell", "Fixar/Esconder"; then sessions newest first, each row = live
badge / title / relative time / cwd when it differs from the root (worktree). Top-right of
the page: "Abrir pasta" and "Clonar" (inline text field for `owner/repo` or URL). Empty
state (no history at all): the two buttons centred with one sentence.

### Errors

- `claude agents` or `gh` missing → snapshot still renders from history; `errors[]` shown as one dim line at the bottom, like the cockpit does.
- `history.jsonl` missing → empty state.
- Clone with an empty spec → button disabled. `gh` failure is visible in the terminal tab; Home just refreshes and finds nothing new.
- Open folder that is not a git root → toast "não é um repositório git", nothing added.

### Testing

- Rust: `parse_history` on a fixture with a corrupt line, title rule (slash prompts skipped, 80-char cut), worktree collapse with a fake `git-common-dir` resolver, live classification for the three cases, transcript-missing flag.
- TS: store with a fake client — sort (pinned first, then recency), hidden filtered out, `whatClickDoes` for the five session states, clone dest derivation, `sessionId` lookup across panes; view test that Home renders when `tabs` is empty and disappears after `newTab`.
- CI smoke unchanged (it drives a shell; Home does not spawn one until asked).

## Out of scope

Idle-shell reuse, session search inside transcripts, deleting sessions, multi-CLI (#5).

# mnemo-desktop — sub-project 2: mission cockpit

**Date:** 2026-09-14
**Status:** shipped (PR #6, 2026-09-15); #3 editor and #4 browser shipped alongside via dispatch (PRs #5, #7)
**Depends on:** sub-project 1 (shell) and the pane view registry (PR #2).

## 1. Why

The reason the app exists. During `mnemo dispatch` the user asks the parent "what is happening?", and misses what happened while not looking (a child blocked, unblocked itself, decided something). The cockpit puts that on screen permanently, without typing, across every repo they have open.

## 2. Shape

A **persistent sidebar** on the right (toggle `⌘B`, default open, width 360px, draggable), plus a **`mission` pane view** for the detail of one child. The sidebar is not a pane: it cannot be closed by `⌘W`, and it survives tab changes.

### 2.1 Sidebar, top to bottom

Grouped by **repo**. The repo of the focused terminal pane (from its OSC 7 cwd, resolved to the git top level) is highlighted and sorted first; every other repo with a live session stays visible below.

```
▾ mnemo-desktop                        ● 2 children · 1 parent
   parent  0ff9d810   active   "editing store.ts"
   ▾ mission panes                     1/2 PR · CI ✓ · land: not yet
      editor   a43d3832  active   "cargo test"              +3
      browser  094c6a03  BLOCKED  "may I enable unstable?"  [reply…]
▾ mnemo                                ● 0 children · 1 parent
   parent  812d9d86   idle
```

Rows:

- **Repo row**: name (basename of the top level), counts of live children and interactive sessions.
- **Parent session row**: every interactive Claude Code session whose cwd is in this repo (kind `interactive` from `claude agents --json --all`). State from `status` (idle/busy/waiting) and the one-line `detail` when present.
- **Mission row**: one per contract that has at least one live or recently finished child (branch prefix `feat/<feature>/`). Shows pieces with a PR / total pieces, CI state of the PRs (green when all checks pass, red when any fails, grey when pending), and whether `mnemo land` could run (all pieces have a PR and CI is green).
- **Child row**: state and tempo folded into one word — `active`, `BLOCKED`, `stalled`, `done`, `stopped`; the `detail` line; and the **delta badge** `+N` = timeline events since the user last looked at that child (opened its mission pane, or replied). Clicking a child row opens or focuses its mission pane.
- **Blocked child**: the `needs` text inline under the row, a text field prefilled with `suggested_reply` when present, and a send button. Sending uses the session's inbox socket (§4); on success the row flips to `active` on the next poll.

Children not belonging to any contract (dispatched by issue number) are listed under the repo directly, in a **"children"** group after missions.

### 2.2 Mission pane (`openView('mission', { id })`)

- Header: piece name or intent first line, branch, PR link (opens in the browser pane when sub-project 4 exists, else the system browser), tokens so far (input + output from `state.json.tokens`) and estimated cost from a fixed per-model table in `src/mission/cost.ts`.
- **Timeline**: every line of `timeline.jsonl` newest-last, rendered as `HH:MM state detail`, with the events since the last look highlighted. The final `text` of the last `blocked`/`done` transition is rendered in full (it is the child's report).
- Actions: reply (same as sidebar), **attach** (opens a terminal pane in a split running `claude attach <id>`; one attach per session, the button disables while a pane for that id exists), **stop** (`claude stop <id>`, confirmed by a second click).
- Opening the pane marks the child as looked-at: the delta badge resets.

## 3. Data

All read-only, all through existing CLIs and files. No daemon, no server.

| Need | Source | How |
|---|---|---|
| Live sessions, all repos | `claude agents --json --all` | run every 3 s while the window is focused, 15 s when not; `cwd`, `kind`, `state`, `id` |
| Child tempo/needs/detail/reply suggestion | `mnemo sessions --json --all` | same cadence; join on `short_id` |
| Tokens, intent, template, children | `~/.claude/jobs/<id>/state.json` | read on demand when a row is rendered; cached by mtime |
| Timeline | `~/.claude/jobs/<id>/timeline.jsonl` | read when the mission pane is open, tail from the last known offset |
| Repo of a cwd | `git -C <cwd> rev-parse --show-toplevel` and `git worktree list --porcelain` in that top level | cached per cwd; a worktree resolves to its main checkout's top level |
| Contract → pieces → branch | `docs/contracts/*.md` in the repo top level, parsed for `feature:` and `## <piece>` | branch is `feat/<feature>/<piece>` |
| PR + CI per branch | `gh pr list --json headRefName,number,url,statusCheckRollup,state --state all --limit 100` in the repo | every 30 s per repo with a mission |
| Last-looked marker | `~/.mnemo-desktop/looked.json` `{ [sessionId]: timelineLineCount }` | written by the app; the only file it writes |

All of this runs in Rust (`src-tauri/src/mission.rs`) behind commands: `mission_snapshot() -> Snapshot` (sessions joined with repos and missions, one call per poll), `mission_timeline(id, from_line) -> { lines, total }`, `mission_reply(id, text)`, `mission_mark_looked(id)`. The front-end never spawns processes.

## 4. Replying to a blocked child

Claude Code exposes `CLAUDE_CODE_MESSAGING_SOCKET=/tmp/cc-socks/<pid>.sock` with an auth token. The auth line is documented; the message line is not verified. Implementation order:

1. Read `state.json` for the child's pid (or resolve via `claude agents --json`, which carries `pid`).
2. Connect to the socket, send the auth line, send a message line, read the ack. **Verify the shape against a live child before shipping** (the memory that documents this says the message shape was a subagent's claim).
3. If the socket path proves wrong, fall back to `claude agents` peek/reply's mechanism by reading its source, or as last resort open an attach pane and type the reply; the UI does not change.

The reply also appends to the mission pane's timeline locally (`you: <text>`), so the user sees it went.

## 5. Store and modules

- `src/mission/store.ts`: zustand slice holding the latest `Snapshot`, per-child looked markers, sidebar open/width. Polling loop lives here, started by `App` and paused when `document.hidden`.
- `src/mission/Sidebar.tsx`, `src/mission/rows/*.tsx`, `src/mission/view.tsx` (registers the `mission` pane view), `src/mission/cost.ts`.
- Palette actions from `view.tsx`: `mission.toggle-sidebar` (`⌘B`), `mission.reply-blocked` (focuses the first blocked child's reply field), `mission.attach-focused`.
- Rust: `src-tauri/src/mission.rs` in the `// -- mission --` anchor blocks of `lib.rs`.

`App.tsx` gains the sidebar slot: `.app` becomes a row of `[workspace column][sidebar]`, the tab bar stays above the workspace only. This is the one shared-file edit; it is done by this sub-project before anything else so that sub-projects 3/4 (in flight in worktrees) merge cleanly: they do not touch `App.tsx`.

## 6. Errors

- `claude` or `mnemo` or `gh` missing on PATH → the sidebar shows one line naming the missing tool, everything else still renders.
- A `gh` call failing (rate limit, no remote) → the mission row shows `PR: ?` and retries on the next cycle; never blocks the session poll.
- Socket reply failure → inline error under the reply field with the raw message; the field keeps its text.
- Snapshot parse errors are logged and the previous snapshot stays on screen.

## 7. Testing

- Rust: `mission.rs` parsers unit-tested on fixtures **copied from real files on this machine** (`state.json`, `timeline.jsonl`, a real `claude agents --json` capture, a real `gh pr list --json` capture, a real contract), per the fixtures-that-lie lesson. The join (sessions × repos × contracts) tested on those fixtures. Path/worktree resolution tested on a temp git repo with a real worktree.
- Front-end: reducer for delta badges and looked markers; grouping/sorting of the snapshot; reply field prefill. Rendering smoke of the sidebar with a fixture snapshot in jsdom.
- Manual: with the two children of the `panes` contract running, the sidebar shows them; block one on purpose and reply from the sidebar.

## 8. Out of scope

Dispatching from the app (use the terminal), editing contracts, multi-machine, notifications/badges in the dock, cost budgets. Attach through anything but a terminal pane.

## 9. Done when

The user runs a dispatch from a terminal pane and, without typing anything else, sees the children appear under the right repo, sees one block, reads the question in the sidebar, answers it there, and later reads the child's final report in the mission pane. The delta badge is correct after looking away and back.

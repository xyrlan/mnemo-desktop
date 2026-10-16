---
feature: grok-accounts-b
created: 2026-10-16
verdict: parallel
---

Wave B of the Grok round: everything in the app that starts, reads or acts on a CLI, made to
follow the account's kind. Read `docs/superpowers/specs/2026-10-16-grok-accounts-design.md`
first. Then read the Facts section of mnemo's `design/specs/2026-10-16-grok-host.md`.

Wave A is merged. Every account has a `kind`, every row's `account_env` carries one, and
`onAccount` / `attachCmd` / `stopCmd` / `activeKind` / `Accounts::apply` route by it. mnemo's
`mnemo grok roster|send|close|billing` exists; its JSON shapes are in mnemo's
`design/contracts/2026-10-16-grok-host-wave1.md`, piece `grok-acp`.

Rules for all four pieces:
- **Claude is unchanged.** With only Claude accounts, every command the app types or spawns is
  byte-identical to main's, and a test says so.
- **Every Grok behaviour you rely on is measured or read from the source**, and the PR says which:
  the real `grok` (a free account is logged in, never print its token) or
  `github.com/xai-org/grok-build`. Vitest and cargo tests use fixtures.
- **Live probes stay out of the vault.** `grok` 1.0.60 is on PATH and `~/.grok` is logged in to a free xAI account (only model:
  `grok-4.7`). Grok fires every hook in `~/.claude/settings.json`, mnemo's and the app's
  included, so a live probe runs with `HOME` set to a throwaway dir and `GROK_HOME=~/.grok`, or
  with `GROK_CLAUDE_HOOKS_ENABLED=0`, and never writes into the maintainer's vault. Never print
  or copy `auth.json`, and stop any leader you started.
  - **No piece calls another piece's internals.** Only the signatures below cross.
- Before your first push, run `git fetch && git rebase origin/main`. A piece that changes the
  screen shows it, and the PR says what was seen.

## launch-grok

- **files:** src/agent/command.ts, src/agent/command.test.ts, src/nexus/drawer/start.ts, src/home/store.ts, src/home/types.ts, src/layout/store.ts, src/github/actions.ts, src/cockpit/job.ts, src-tauri/src/job.rs, src-tauri/src/tools.rs, src-tauri/src/tools_path.rs, src/setup/tools.ts, src/nexus/windows/setup/index.tsx, src/nexus/drawer/*.test.ts, src/home/*.test.ts, src/layout/*.test.ts, src/setup/*.test.ts
- **exposes:** `sessionCommand(kind: AgentKind, opts: { sessionId?: string; resume?: string; skipPermissions?: boolean }): string`
- **consumes:** nothing
- **effort:** high

What the app starts, on the active account's CLI (spec decisions 3, 4 and 10):
- **New session, resume and restore** start `grok` for a Grok account. The TUI runs in leader
  mode, so the session lands in the roster (decision 4). Resume uses the session's own kind and
  home, as Claude's already uses its own account. "Skip permissions" maps to Grok's equivalent.
- **Jobs** (`mnemo dispatch`, `mnemo resume`, from `job.rs`) run with the active account's
  environment: `MNEMO_AGENT` plus its own variable. Today they inherit the app's environment and
  so always reach the default Claude account. Fix that for Claude too, and test it.
- **Setup** finds `grok` on PATH, offers xAI's installer for it, and needs `claude` only when a
  Claude account exists.

## fleet-grok

- **files:** src-tauri/src/mission.rs, src-tauri/src/mission_commands.rs, src-tauri/src/home.rs, src-tauri/src/home/lens.rs, src-tauri/src/chrome.rs, src-tauri/src/workspace.rs, src-tauri/src/worktree.rs, src/mission/as-me.ts, src/mission/store.ts, src/session/host.ts, src/mission/*.test.ts, src/session/*.test.ts
- **exposes:** nothing
- **consumes:** `grok_history_path(home: &Path, session_id: &str) -> Option<PathBuf>` from conversation-grok
- **effort:** high

The fleet (Home, cockpit, Nexus) lists Grok sessions and children beside Claude ones, and every
action on a Grok row works (decisions 5 and 6; memory `views-must-be-operable`):
- **Listing.** Grok sessions come from `mnemo grok roster --json` for each Grok home, cached as
  `claude agents` is. Children come from mnemo's ledgers, which name their agent.
  - Mapping: `needs_input` is waiting on the user; `working` / `idle` / `dormant` map to the
    states the UI already has.
  - A Grok row's `account_env.kind` is `grok`.
- **Reply** to a Grok row goes through `mnemo grok send`, not the TUI-scraping path, which is
  Claude's TUI.
- **Stop** goes through `stopCmd`, and **attach** through `attachCmd` (wave A).
- **Which pane runs a CLI** (`chrome.rs`, `PaneRuns`) recognises `grok`.
- **Worktrees in use** count a Grok session's cwd.
- **Tokens and transcripts** for a Grok row read its `chat_history.jsonl` through
  `grok_history_path`.
- **The rewrite and translate helper** (`translate_with`, `claude -p --model haiku`) uses
  `grok -p` with a small Grok model when the active account is Grok.
- **The app's own agent hooks** already fire in Grok sessions (spec: Facts). Make sure their events
  for a Grok session land on its row.

## conversation-grok

- **files:** src-tauri/src/conversation.rs, src-tauri/src/conversation/grok.rs, src-tauri/src/nexus_feed.rs, src-tauri/src/nexus_feed/transcript.rs, src/conversation/parse.ts, src/conversation/parse-grok.ts, src/conversation/types.ts, src/conversation/stream.ts, src/conversation/*.test.ts
- **exposes:** `grok_history_path(home: &Path, session_id: &str) -> Option<PathBuf>`, `conversation_follow { sessionId, cwd, kind, home }`
- **consumes:** nothing
- **effort:** high

The conversation view and the Nexus feed read a Grok session (decision 8):
- `grok_history_path` finds `chat_history.jsonl` by session id under a home. The directory rule is
  in mnemo's `core/grok/paths.py`, including the long-cwd `.cwd` form.
- Following tails it as the Claude transcript is tailed. `kind` and `home` are optional on the
  command, absent meaning Claude, so the existing callers are unchanged.
- The parser shows user turns, assistant text, tool calls with their results, and errors.
  Injected records (`synthetic_reason`) are marked as not the user's. Reasoning records are
  folded away or shown as thinking, as Claude's are.
- The Nexus feed counts a Grok model call (model ids start with `grok`) and its tokens from
  `usage.json` or the history, whichever is measured to be right.

## usage-grok

- **files:** src-tauri/src/plan_usage.rs, src-tauri/src/plan_usage/grok.rs, src/nexus/accounts/ShipAccounts.tsx, src/nexus/accounts/ShipAccounts.test.tsx
- **exposes:** `plan_usage { configDir, isDefault, kind } -> PlanUsage`
- **consumes:** nothing
- **effort:** medium
- **model:** sonnet

A Grok account's usage, where Claude's plan limits show (decision 9):
- For `kind: "grok"`, `plan_usage` runs `mnemo grok billing --home <dir> --json` and answers a
  `PlanUsage`: the credit percent as a limit, the period's end as its reset, and the subscription
  tier as `plan`. Fields Grok does not give stay null.
- A failure answers a `PlanUsage` whose `stale` says why. The last good reading is kept, as
  Claude's are.
- Claude's path is untouched.
- Measure what `_x.ai/billing` returns on the free account before mapping it. The mnemo spec
  marks it unmeasured.

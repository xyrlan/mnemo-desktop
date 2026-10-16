# Grok accounts: pick a Grok Build account and the app runs Grok

2026-10-16. The maintainer asked for it in conversation: mnemo and the app should work with
xAI's Grok Build CLI (`grok`), and **a Grok account selected in the accounts tab is the signal
that Grok is used** — for panes, dispatch, the fleet and the conversation view. Contracts:
`docs/superpowers/contracts/2026-10-16-grok-accounts-wave-a.md` (the account model) and
`…-wave-b.md` (everything that runs or reads a CLI). mnemo's half, and every fact about Grok
measured for this round, is in mnemo's `design/specs/2026-10-16-grok-host.md`; read its Facts
section before touching anything Grok-shaped.

The maintainer has no Grok subscription. A free xAI account ran every probe of the round.

## Decisions

1. **An account has a kind, `claude` or `grok`.** `accounts.json` entries gain `kind`; an entry
   without one is `claude`, so every existing file reads as it does today. The seam is
   `agent_kind::AgentKind` / `src/agent/kind.ts`.

2. **A Grok account is a Grok home.** The default Grok account is `~/.grok`, run with `GROK_HOME`
   **unset**. Every other Grok account is `~/.grok-<slug>`, run with `GROK_HOME=<dir>`. Each has
   its own login (`auth.json`). Nothing is linked between Grok homes, or between a Grok home and
   `~/.claude`. Grok already reads the user's Claude hooks, `CLAUDE.md`, skills and MCP servers
   from `~/.claude` (mnemo spec: Hooks). mnemo reads the sessions of every home.

3. **The selected account's kind is the CLI.** One active account for the whole app, as before
   (2026-10-07 decision 2). With a Grok account active:
   - a new session pane starts `grok`, resuming starts `grok -r <id>`, and sign-in is `grok login`;
   - dispatch runs on Grok;
   - the rewrite and translate helper uses `grok -p`.

   The app exports `MNEMO_AGENT=<kind>` plus the account's own variable (`CLAUDE_CONFIG_DIR` or
   `GROK_HOME`, set or unset) into every pane it spawns and every job it runs (`mnemo dispatch`,
   `mnemo resume`). mnemo reads `MNEMO_AGENT` and nothing else from the app.

4. **Grok sessions run in Grok's leader.** A pane starts the TUI in leader mode (`--leader`, or
   whatever the measured equivalent is), so the session appears in the leader's roster. mnemo
   can then deliver a child's notice to it, and the fleet can list it, reply to it and stop it.
   A Grok session started outside the leader is invisible to all three, and the app says so
   rather than pretending.

5. **The app reaches Grok sessions through `mnemo grok`, never its own ACP client.**
   - **Roster:** `mnemo grok roster --json`.
   - **Reply:** `mnemo grok send <id> <text>`.
   - **Stop:** `mnemo grok close <id>`.
   - **Credit usage:** `mnemo grok billing --json`.

   Each takes `--home` for the session's own account. The JSON shapes are in mnemo's
   `design/contracts/2026-10-16-grok-host-wave1.md` (`grok-acp`). Attach opens a pane running the
   TUI on that session, on that session's home.

6. **A session belongs to the account that started it, whatever is active later** (2026-10-07
   decision 5, unchanged). Each row in the fleet knows its kind and its home. Every action on a
   row uses that row's kind and home: attach, reply, stop, open the conversation.

7. **Switching across kinds moves nothing.** Switching between two Claude accounts still moves
   the open Claude sessions (2026-10-08 follow). Switching between a Claude and a Grok account
   leaves every running session where it is; only panes opened afterwards change CLI. The same
   holds Grok to Grok, until moving a Grok session between homes is measured.

8. **The conversation view reads Grok's `chat_history.jsonl`.** Grok's record shapes are in the
   mnemo spec. It shows user turns, assistant text, tool calls and results like a Claude
   transcript. Records Grok injected itself (`synthetic_reason`) are marked as not the user's.

9. **Usage per Grok account is credit usage.** It is what `_x.ai/billing` returns: percent used,
   the period, the subscription tier. It is shown where Claude's plan limits are. When it cannot
   be read, the account shows that, not an empty bar.

10. **Setup knows `grok`.** It is a tool the app can find on PATH and install with xAI's installer.
    The app needs `mnemo`, plus `claude` or `grok` for the kinds of the accounts that exist. A
    machine with only Grok accounts does not need `claude`.

## Facts

From mnemo's spec (measured on grok 1.0.60 with a free account), the ones the app depends on:

- `GROK_HOME` selects the account; `grok login [--device-auth]` signs in and writes
  `<home>/auth.json` (0600). The file holds the account's email; the app never prints a token.
- A Grok session lives in `<home>/sessions/<url-encoded cwd>/<id>/chat_history.jsonl`. Its id is
  a UUIDv7, and mnemo's short id is its last eight hex digits.
- The leader keeps a session's turn running when the client that started it leaves. Its roster
  gives `activity`: `working | idle | needs_input | dormant | completed | dead`.
- macOS limits a Unix socket path to 103 bytes; a Grok home whose `leader.sock` path is longer
  cannot run a leader. `~/.grok-<slug>` with a short slug is fine; the app keeps slugs short.
- Grok fires the app's own agent hooks from `~/.claude/settings.json` with snake_case aliases
  (`session_id`, `cwd`, `hook_event_name`, `prompt`). Notification carries `notificationType`
  and `message`.

## Out of scope

- Moving a running session between accounts of different kinds, or between Grok homes.
- Grok's own dashboard, subagents and `grok worktree`.
- The Nexus world's art for Grok sessions: they use the existing sprites.
- Logout from the app (not built for Claude either).

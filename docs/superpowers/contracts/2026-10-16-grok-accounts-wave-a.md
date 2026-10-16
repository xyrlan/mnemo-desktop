---
feature: grok-accounts-a
created: 2026-10-16
verdict: parallel
---

Wave A of the Grok round: one piece, because everything else waits on it. Read
`docs/superpowers/specs/2026-10-16-grok-accounts-design.md` first. Then read the Facts section of
mnemo's `design/specs/2026-10-16-grok-host.md`.

Everything else in the round reads the account's kind and the account's environment through
what this piece exposes. Wave B (`2026-10-16-grok-accounts-wave-b.md`) is written against these
signatures and waits for this piece to merge.

The seam is on main: `agent_kind::AgentKind` (Rust) and `src/agent/kind.ts` (TS). Build on it;
do not move it.

Before your first push, run `git fetch && git rebase origin/main`. A piece that changes what is
on screen shows it, and the PR says what was seen (memories
`see-the-app-through-an-isolated-dev-instance`, `drive-the-preview-harness-interactively`). A
free xAI account is logged in on the maintainer's machine. Never print or copy its token. Test
against a fake `auth.json` in a throwaway home.

## accounts-kind

- **files:** src-tauri/src/accounts.rs, src-tauri/src/mission/account_dirs.rs, src-tauri/src/pty.rs, src/accounts/types.ts, src/accounts/client.ts, src/accounts/store.ts, src/accounts/follow.ts, src/nexus/accounts/AccountsList.tsx, src/nexus/accounts/sign-in.ts, src/mission/account.ts, src/accounts/*.test.ts, src/mission/account.test.ts, src/nexus/accounts/*.test.ts, src/nexus/accounts/*.test.tsx
- **exposes:** `Account.kind: AgentKind`, `PaneAccount { id: String, kind: AgentKind, config_dir: Option<PathBuf> }`, `PaneAccounts::current(&self) -> PaneAccount`, `account_dirs::Account { id: String, config_dir: PathBuf, is_default: bool, kind: AgentKind }`, `account_dirs::AccountEnv { config_dir: Option<String>, kind: AgentKind }`, `Accounts::apply(&self, account: &Account, cmd: &mut std::process::Command)`, `Accounts::grok_homes(&self) -> Vec<PathBuf>`, `type Account = { …; kind: AgentKind }`, `type AccountEnv = { config_dir: string | null; kind?: AgentKind }`, `onAccount(cmd: string, s: OnAccount | null | undefined, shell?: Shell): string`, `attachCmd(s: { id: string } & OnAccount, shell?: Shell): string`, `stopCmd(s: { id: string } & OnAccount, shell?: Shell): string`, `activeKind(state: AccountsState): AgentKind`, `AccountsClient.usage(account: Account, refresh: boolean): Promise<PlanUsage>`
- **consumes:** nothing
- **effort:** high

The account model and its environment, the spec's decisions 1, 2, 3 (environment only), 6 and 7:

- **`kind` on every account.**
  - It lives in `accounts.json` and on the wire. An old file reads as `claude`.
  - The default Claude account stays what it is.
  - A Grok account's dir is `~/.grok` (run with `GROK_HOME` unset) or `~/.grok-<slug>` (set).
  - Nothing is linked into a Grok account's dir, and nothing from Claude's shared list applies to
    it.
  - `problem` says when it is not logged in: no `auth.json`, or no login in it. `email` comes from
    its `auth.json`.
  - A slug that would put the home's `leader.sock` past the platform's socket-path limit is
    refused when the account is added (spec: Facts).
- **Adding a Grok account** from the accounts tab: the user chooses the kind when adding. Sign-in
  opens a terminal running `grok login` on that home. It is the same flow as Claude's sign-in,
  with Grok's command.
- **Every pane and every command routed to an account** gets that account's own variable, set or
  unset, plus `MNEMO_AGENT=<kind>`:
  - Rust: `pty.rs` spawn and `Accounts::apply`.
  - TS: `onAccount` and `withEnv` for posix, `cmd` and PowerShell.
  - A Grok pane never carries a `CLAUDE_CONFIG_DIR` from a Claude account, and the reverse.
- **`attachCmd` / `stopCmd`** reach a session on its own kind.
  - Grok attach opens the TUI on that session, in leader mode, on its home.
  - Grok stop is `mnemo grok close <id> --home <dir>` (mnemo's `grok-acp` piece; the stub exits 2
    until it lands).
- **`follow.ts`**: a switch between two Claude accounts moves the sessions as today. A switch
  that changes kind, or one between Grok accounts, moves nothing (decision 7). Test both.
- **`activeKind`**: the kind of the active account, for wave B to read.
- **`AccountsClient.usage`** passes the account's `kind` to `plan_usage`. Wave B's `usage-grok`
  answers it. Until then, a Grok account's usage shows as unavailable, never as Claude's.

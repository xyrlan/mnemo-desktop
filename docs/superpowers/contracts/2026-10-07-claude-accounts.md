---
feature: claude-accounts
created: 2026-10-07
verdict: parallel
---

Claude Code accounts: switch between them from the app, and see each one's plan usage. The
design is `docs/superpowers/specs/2026-10-07-claude-accounts-design.md`. Read it first. Its
decisions are numbered, and the pieces below cite them.

**What the pieces share is data, not code.**
- **The account list:** `~/.mnemo-desktop/accounts.json`, schema in the spec. `accounts-core`
  writes it. `account-sessions` reads it.
- **The Tauri commands and the event below**, which `accounts-ui` calls by name.
No Rust piece calls another piece's Rust. Each one builds and tests alone.

**`src-tauri/src/lib.rs`** is in two pieces, for anchored blocks only (module and handler
registration). The file's own comments describe these blocks. `accounts-core` adds its blocks
first in each list. `plan-usage` adds its blocks last. Neither changes anything else there.

**Credentials.** Reading a Claude login (Keychain or `.credentials.json`) may be refused by
auto mode (memory `live-claude-tui-probes-blocked-in-auto-mode`). If it is, stop and say what
you needed. Never work around it. Prove what you can with a fake credential store. The
maintainer logs a second account in when a piece needs one live: ask.

Before your first push, run `git fetch && git rebase origin/main` (memory
`rebase-a-piece-before-its-first-push`). A piece that changes what is on screen shows it
(memories `see-the-app-through-an-isolated-dev-instance`,
`drive-the-preview-harness-interactively`) and describes in the PR what it saw.

## accounts-core

The account list and the switch: the spec's decisions 1 to 4.

- **The list:** `accounts.json` as the spec gives it. No file means one default account.
- **Adding** creates `~/.claude-<slug>`. The shared entries point at `~/.claude`'s (decision
  3), and the user-scope `mcpServers` come from the default account's `.claude.json` (decision
  4). It never logs in. An account that is not logged in yet says so in `problem`.
- **Removing** forgets the account and leaves its folder on disk. The default account cannot
  be removed. Removing the active account makes the default active.
- **Switching** sets which account panes spawned from then on run in. A pane on the default
  account has `CLAUDE_CONFIG_DIR` unset, exactly as today. A pane on another account has it
  set to that account's dir. The spawn keeps which account each pane got (`accounts_panes`).
- **`email`** comes from the account's `oauthAccount`.
- **`problem`** says what is wrong with an account, in a sentence, or is null:
  - not logged in yet;
  - a shared entry that is no longer a link (decision 3);
  - `mcpServers` out of step with the default account's (decision 4).
- **At startup** the app brings every account's `mcpServers` in step and reports drifted
  links. It never overwrites a file that has the user's writes in it.
- **Every change** emits `accounts://changed` with the new `AccountsState`.

- **files:** src-tauri/src/accounts.rs, src-tauri/src/pty.rs, src-tauri/src/lib.rs
- **exposes:** `type Account = { id: string; label: string; configDir: string; isDefault: boolean; email: string | null; problem: string | null }`, `type AccountsState = { active: string; accounts: Account[] }`, `invoke('accounts_list') -> AccountsState`, `invoke('accounts_switch', { id: string }) -> AccountsState`, `invoke('accounts_add', { label: string }) -> Account`, `invoke('accounts_rename', { id: string, label: string }) -> AccountsState`, `invoke('accounts_remove', { id: string }) -> AccountsState`, `invoke('accounts_panes') -> Record<number, string>`, `event 'accounts://changed' (payload: AccountsState)`
- **consumes:** nothing
- **model:** opus
- **effort:** high

## plan-usage

One account's plan usage, from the endpoint the spec's Facts describe: decision 6.

**Input.** The account is named by its config dir and whether it is the default account,
because the two keep their credentials under different names. Find the non-default name from
the installed `claude`.

**Output.** `limits` comes from the response's `limits` array:
- `model` is `scope.model.display_name`;
- `active` is `is_active`;
- `percent`, `severity` and `resetsAt` are passed through.
A kind it does not know is passed through like the others. `plan` is the subscription type
when the credentials carry one.

**Old readings.** The last good reading of each account is kept on disk under
`~/.mnemo-desktop/`.
- When a fetch fails (expired token, no network, credential refused), the answer is that
  reading. `stale` says why in a sentence, and `fetchedAt` (unix ms) says when it was read.
- A window whose `resetsAt` has passed reads 0% in it.
- Throws only when the account has no reading at all.

**Fetching.**
- `refresh: false` answers from the kept reading when it is younger than a minute.
- Never more than one fetch a minute per account, whatever `refresh` says.
- Never writes a credential, and never refreshes a token.

**Platforms.** It builds on all three CI OSes: macOS reads the Keychain, the others read
`.credentials.json`.

- **files:** src-tauri/src/plan_usage.rs, src-tauri/src/lib.rs, src-tauri/Cargo.toml
- **exposes:** `type PlanLimit = { kind: string; group: string; model: string | null; percent: number; severity: string; resetsAt: string | null; active: boolean }`, `type PlanUsage = { limits: PlanLimit[]; plan: string | null; fetchedAt: number; stale: string | null }`, `invoke('plan_usage', { configDir: string, isDefault: boolean, refresh: boolean }) -> PlanUsage`
- **consumes:** nothing
- **model:** opus
- **effort:** high

## account-sessions

Background sessions on every account: decision 5.

**Reading.** The app reads each account's `jobs/` and `daemon/roster.json`, for every account
in `accounts.json` (schema in the spec, read directly; this piece does not call
`accounts-core`). Today it reads only `~/.claude`'s. A background child, a Home session and
everything the snapshot builds from them carry the id of the account they run on.

**Acting.** Everything the app does to a background session reaches it through that session's
own account, whatever account is active:
- `claude attach`, Take over and Resume;
- the hidden attach that answers as the maintainer;
- approving a prompt;
- the inbox socket.
Today these are built in `src/cockpit/approve.ts`, `src/dispatch/run.ts`, `src/home/types.ts`
and `src/mission/as-me.ts`, and `inbox_socket` in `mission.rs`. `git grep` for more before
writing.

**Pane environment.** Once `accounts-core` lands, every pane is spawned with the active
account's `CLAUDE_CONFIG_DIR` set, or unset for the default account. A command routed to
another account must win over that environment. Routing to the default account means
`CLAUDE_CONFIG_DIR` unset, not set to `~/.claude` (spec, decision 1).

**Home.** It hides every account's dir the way it hides `~/.claude/` today
(`is_internal_root`).

- **files:** src-tauri/src/mission.rs, src-tauri/src/home.rs, src-tauri/src/home/lens.rs, src/mission/, src/home/, src/cockpit/approve.ts, src/dispatch/run.ts
- **exposes:** `ChildSession.account: string`
- **consumes:** nothing
- **model:** opus
- **effort:** high

## accounts-ui

The switcher and the usage, in the left sidebar's header: decisions 2, 6 and 7.

**Header.** It shows the active account's label and its tightest limit: the highest
`percent`, or the `active` one. A click opens the accounts.

**Accounts.** Each account shows:
- its label and email;
- its `problem`, if any;
- every limit of its `PlanUsage`: a bar coloured by `severity`, the percent, and when it
  resets. A scoped limit is named after its `model`. A limit kind the UI does not know
  still shows.
- a stale reading's age and reason.
The active account is marked. Picking another switches.

**Adding** an account asks its label, then opens a terminal in the new account so the
maintainer logs in. **Renaming and removing** are there too. Removing says the folder stays
on disk.

**Panes.** When there is more than one account, a pane whose account is not the active one
says which account it runs on, in its pane bar.

**Polling.** Usage is fetched for every account when the accounts open, after a switch, and
every few minutes while the app is open. It refreshes on `accounts://changed`.

**Testing.** Test against stand-ins of the commands: memory
`vitest5-spy-rejecting-a-string-fails-the-test` (mock `invoke` with a plain recorder). An open
popover hangs vitest (memory `opening-a-popper-menu-hangs-vitest`): test the trigger and the
handlers, and shoot the open state in the preview harness.

- **files:** src/accounts/, src/sidebar/SidebarHeader.tsx, src/chrome/PaneBar.tsx, tools/preview/scenarios/accounts.mjs
- **exposes:** nothing
- **consumes:** `invoke('accounts_list') -> AccountsState` from accounts-core, `invoke('accounts_switch', { id: string }) -> AccountsState` from accounts-core, `invoke('accounts_add', { label: string }) -> Account` from accounts-core, `invoke('accounts_rename', { id: string, label: string }) -> AccountsState` from accounts-core, `invoke('accounts_remove', { id: string }) -> AccountsState` from accounts-core, `invoke('accounts_panes') -> Record<number, string>` from accounts-core, `event 'accounts://changed' (payload: AccountsState)` from accounts-core, `invoke('plan_usage', { configDir: string, isDefault: boolean, refresh: boolean }) -> PlanUsage` from plan-usage
- **model:** opus
- **effort:** high

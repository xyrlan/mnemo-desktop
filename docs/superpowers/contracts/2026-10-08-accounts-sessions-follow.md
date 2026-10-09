---
feature: accounts-sessions-follow
created: 2026-10-08
verdict: parallel
---

Open Claude sessions follow an account switch, and two accounts logged in as the same Claude
account say so. The design is `docs/superpowers/specs/2026-10-07-claude-accounts-design.md`,
**decisions 9 and 10**. Read all of it first: decisions 1 to 5 say what an account is and what
the switch already does.

**What is on `main`:**
- **`src-tauri/src/accounts.rs` (#295):** the account list, the switch, the record of the
  account each pane was spawned on (`accounts_panes`), and `problem`.
- **`src/accounts/` (#298, #300):** the switcher and its store, which listens to
  `accounts://changed`.
- **`src/mission/account.ts` (#297):** `onAccount`, the command prefix that runs a command on an
  account (`env CLAUDE_CONFIG_DIR=…` / `env -u CLAUDE_CONFIG_DIR`).
- **`src/mission/as-me.ts`:** `inputBox`, which reads a Claude input box off a screen.
- **`src/layout/store.ts`:** a pane knows its Claude session (`sessionId`). At restore it already
  types `claude --resume <id>` into a pane.

**What the pieces share** is one Tauri command, called by name. Each piece builds and tests
alone.

Before your first push, run `git fetch && git rebase origin/main` (memory
`rebase-a-piece-before-its-first-push`). Moving a live session means driving a real Claude TUI.
Auto mode may refuse that (memory `live-claude-tui-probes-blocked-in-auto-mode`). If it does,
prove what you can against recorded screens, say in the PR what is unproven, and never work
around the refusal.

## pane-account

**Moving a pane.** A pane whose session moved to another account is recorded on that account.
`accounts_panes` then reports it there, and its pane-bar chip goes away.

**Same login (decision 10).** An account whose `email` another account also has gets a `problem`
naming that account's label. Today both of the maintainer's accounts hold the same login, so
both should show it.

- **files:** src-tauri/src/accounts.rs, src-tauri/src/pty.rs, src-tauri/src/lib.rs
- **exposes:** `invoke('accounts_move_pane', { pane: number, id: string }) -> void`
- **consumes:** nothing
- **model:** opus
- **effort:** medium

## sessions-follow

The open sessions follow a switch, as decision 9 says.

**Which panes.** When `accounts://changed` brings a new active account, every terminal pane
qualifies whose account (`accounts_panes`) is another one and that runs a Claude session.

**The move:**
1. Claude leaves.
2. The pane's shell moves to the new account. A `claude` typed there later lands on it, and the
   default account means `CLAUDE_CONFIG_DIR` unset.
3. The same session resumes in the same pane.
4. `accounts_move_pane` records it.

**When:**
- An idle session moves at once.
- A working session, or one waiting on the maintainer, moves when it next goes idle.
- A session whose input box holds a draft waits too. The draft is never lost.
- Switching again before a pane moved takes it to the latest active account, or leaves it when
  that is its own account.

**No notice:** no prompt, no count, no toast. The maintainer asked for none.

**Untouched:** background children, and panes not running Claude.

**Testing.** Keys into a Claude TUI need gaps (memory `claude-tui-keys-need-gaps`). Test against
recorded screens of the TUI's idle input box and of the shell prompt Claude leaves to.

- **files:** src/accounts/
- **exposes:** nothing
- **consumes:** `invoke('accounts_move_pane', { pane: number, id: string }) -> void` from pane-account
- **model:** opus
- **effort:** high

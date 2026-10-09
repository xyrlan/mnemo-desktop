# Claude accounts: switch between them, see each one's plan usage

2026-10-07. Decided with the maintainer in conversation; the contract is
`docs/superpowers/contracts/2026-10-07-claude-accounts.md`.

The maintainer has two Claude Code accounts and switches with `/logout` + `/login` today. They
want to switch from the app and see the plan usage of both accounts (what `/usage` shows: the
5-hour session and the weekly limits), side by side.

## Decisions

1. **An account is a Claude Code config dir.** The default account is `~/.claude` and runs with
   `CLAUDE_CONFIG_DIR` **unset**, exactly as today. Setting it to `~/.claude` is not the same
   thing: Claude Code then reads `~/.claude/.claude.json` instead of `~/.claude.json`, and keys
   its login differently. Every other account is `~/.claude-<slug>`, with its own login.

2. **One active account for the whole app.** Switching changes the account of panes opened
   afterwards, and the open Claude sessions follow it (decision 9). When there is more than one
   account, a pane still on another account shows which one.
   *Why global:* the Claude in Chrome extension is signed in to one claude.ai account at a time,
   so sessions on two accounts at once may fight over it. Nobody has checked whether the
   extension actually requires the same account. A global switch avoids the question.

3. **History and memory are shared, fully.** The maintainer: *"não faz nenhum sentido não
   compartilhar o histórico"*. In a non-default account's dir, everything that is the user's
   content or history points at `~/.claude`'s: `projects/` (transcripts and memory),
   `history.jsonl`, `settings.json`, `CLAUDE.md`, `skills/`, `agents/`, `commands/`,
   `plugins/`, `plans/` and the like. Only these stay per account: the login, `.claude.json`,
   the background daemon (`daemon/`, `jobs/`), and runtime state and caches. Two daemons on one
   roster would fight, and a daemon runs its sessions on its own login.
   A shared file Claude Code later replaces with a copy of its own (an atomic write onto a
   link) gets caught. The account shows it, and nothing written to either copy is lost.

4. **`.claude.json` stays per account, and its user-scope `mcpServers` follow the default
   account's.** It holds the login (`oauthAccount`), so it cannot be shared. It also holds the
   MCP servers (`mnemo`, `desktop`), and a session on another account without them loses the
   app's tools.

5. **Background sessions belong to the account that started them.** A wave dispatched from a
   pane on account B runs on B's daemon: its jobs are under `~/.claude-b/jobs`, its roster is
   B's. The app lists the background sessions of every account. Everything it does to one
   (attach, Take over, answering a prompt as the maintainer, its inbox socket) reaches it
   through that session's own account, whichever account is active.

6. **Plan usage, every account, at once.** It comes from the endpoint behind `/usage` (Facts
   below), called with each account's own OAuth token.
   - **Never writes a credential.** Refreshing an OAuth token rotates the refresh token, and
     the copy Claude Code holds would stop working.
   - **An account whose token has expired shows its last reading and how old it is.** An idle
     account's usage can only fall, and a window whose `resets_at` has passed reads 0%. So an
     old reading stays close to right, except for use from claude.ai itself.
   - **A limit kind the app does not know still shows**, by the endpoint's own fields.
   - **Polled every few minutes,** and when the usage is opened or the account switched.
     Never more than once a minute per account.

7. **The switcher is in the left sidebar's header.** The window's title bar is native today
   (`tauri.conf.json` sets no `titleBarStyle`). Putting a control there means an overlay title
   bar on three OSes, which is a change of its own.

8. **Dropped: local token counts per account.** With shared transcripts, nothing says which
   account wrote a line. The endpoint's percentages are the account's real numbers anyway.

9. **Open sessions follow the switch, silently** (decided 2026-10-08). The maintainer switches
   when an account runs out, and expects the sessions already open to go on, on the new account.
   A running `claude` reads its config dir once, at start, so it cannot change account in place.
   Because history is shared (decision 3), it can be resumed there instead.
   - **What moves:** each Claude session open in a pane on another account than the new active
     one. Claude leaves, the pane's shell moves to the new account, and the same session resumes
     in the same pane (`claude --resume <id>`).
   - **When:** an idle session moves at once. One that is working, or waiting on the
     maintainer, moves when it next goes idle. A draft in its input box is never lost.
   - **No notice:** no prompt, no count, no toast. The maintainer: *"não precisa ter esses avisos
     … só vai começar a usar outra conta"*.
   - **What stays:** background children (`mnemo dispatch`) run on their account's daemon and
     stay there (decision 5).

10. **Two accounts logged in as the same Claude account say so.** On 2026-10-08 a `/login`
    typed into a session still on the default account replaced that account's login with the
    other account's. Both then held `xyrlancoding@gmail.com`, and switching changed nothing. An
    account whose email another account also has gets a `problem` that says which one.

## Facts

**Endpoint.** `GET https://api.anthropic.com/api/oauth/usage`, headers
`Authorization: Bearer <accessToken>` and `anthropic-beta: oauth-2025-04-20`. It is
undocumented and may change. Read 2026-10-07 for the default account (trimmed):

```json
{
  "five_hour": { "utilization": 34.0, "resets_at": "2026-10-08T01:10:00.506670+00:00" },
  "seven_day": { "utilization": 36.0, "resets_at": "2026-10-13T16:00:00.506727+00:00" },
  "limits": [
    { "kind": "session", "group": "session", "percent": 34, "severity": "normal",
      "resets_at": "2026-10-08T01:10:00.506670+00:00", "scope": null, "is_active": false },
    { "kind": "weekly_all", "group": "weekly", "percent": 36, "severity": "normal",
      "resets_at": "2026-10-13T16:00:00.506727+00:00", "scope": null, "is_active": true },
    { "kind": "weekly_scoped", "group": "weekly", "percent": 0, "severity": "normal",
      "resets_at": "2026-10-13T16:00:00.507030+00:00",
      "scope": { "model": { "id": null, "display_name": "Fable" }, "surface": null },
      "is_active": false }
  ],
  "extra_usage": { "is_enabled": false },
  "seven_day_breakdown": { "rows": [{ "key": "claude_code", "display_name": "Claude Code", "percent": 100 }] }
}
```

`limits` is the list to show. `five_hour` / `seven_day` say the same in an older shape. The
response also carries many null fields with code names. Ignore them.

**Credentials.**
- **macOS:** a Keychain generic password. For the default account its service is
  `Claude Code-credentials`. Its secret is JSON with `claudeAiOauth.accessToken` (confirmed
  2026-10-07). When `CLAUDE_CONFIG_DIR` is set, the service is
  `Claude Code-credentials-<first 8 hex digits of sha256(dir)>`. That was read from the code of
  `claude` 2.1.293 on 2026-10-07. `CLAUDE_SECURESTORAGE_CONFIG_DIR` overrides it, and the app
  never sets that variable.
- **Linux and Windows:** `<config dir>/.credentials.json`, same JSON.
- Reading the Keychain makes macOS ask the maintainer once per reader.

**Account's identity.** `oauthAccount` in the account's `.claude.json` (`~/.claude.json` for the
default account) carries the email.

**The account list.** `~/.mnemo-desktop/accounts.json`, its own file. `settings.json` is
written whole by the front end and would lose it.

```json
{
  "active": "default",
  "accounts": [
    { "id": "default", "label": "Personal", "configDir": "/Users/x/.claude", "isDefault": true },
    { "id": "work", "label": "Work", "configDir": "/Users/x/.claude-work", "isDefault": false }
  ]
}
```

No file means one account, `default`, active.

## Out of scope

- **The `mnemo` CLI**, a separate repo, may assume `~/.claude/jobs` (`mnemo resume`, tracking
  dispatched children). Children dispatched from account B may be invisible to it. That needs
  a follow-up issue there.
- **The window's title bar.**
- **Switching account by itself when one hits its limit.**

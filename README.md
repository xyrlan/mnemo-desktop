<img src="src/brand/mark.svg" width="96" height="96" alt="" />

# mnemo-desktop

Desktop app for the mnemo agentic development environment: every Claude Code session you run and every child you dispatch as one fleet, seen three ways. **Orbit** shows who needs you at a glance, **Console** is where you work in a session with its live terminal, and **Score** is the day over time. Each session shows what it spent, what it read from memory and what it looked at.

## Dev

    brew install cmake        # whisper-rs (voice) builds against it
    pnpm install
    pnpm tauri dev

Start a session from the app (the Projects panel, or `;` and `new <project>` at the command line), or run your parent Claude Code session in a terminal of its own; it, and the children it dispatches, then appear in the fleet.

## Install

    pnpm run install-app

Builds the release bundle, quits the running app, swaps it into `/Applications/mnemo.app` and relaunches it — one command, and the one to run after every merge. Safe to run from a terminal of the app it is replacing: the swap runs detached, so quitting the app cannot kill the install halfway. `--no-launch` leaves the app closed.

The app then says which commit it is: the short sha and the build time are stamped in at build time, and shown at the bottom of the Settings panel and by `mnemo-desktop --version`.

    /Applications/mnemo.app/Contents/MacOS/mnemo-desktop --version
    mnemo-desktop 0.1.0 (948abbe, built 2026-09-15 16:41 UTC)

So a bundle from before the merge reads as old instead of looking like a missing feature. After a merge, `pnpm run install-app:check` prints one line when the installed app is behind `main`, and nothing at all when it is current or not installed — a merge routine (`mnemo land --merge`, say, which lives in the `mnemo` repo) can call it unconditionally:

    bundle installed at 2026-09-15 10:49 is behind main (6 commits); run `pnpm run install-app`

On Linux and Windows `pnpm tauri build` makes the bundle. On Windows, set MSVC's Release flags first, for a dev build too: without them whisper is compiled with no optimization and dictation takes many times longer than it should (#312). CI and the release set them themselves.

    $env:CMAKE_C_FLAGS_RELEASE = "/MD /O2 /Ob2 /DNDEBUG"
    $env:CMAKE_CXX_FLAGS_RELEASE = "/MD /O2 /Ob2 /DNDEBUG"

An installed app keeps a log, warnings, errors and any crash with where it happened, in `~/.mnemo-desktop/app.log` (`%USERPROFILE%\.mnemo-desktop\app.log` on Windows). A start that fails says so in a dialog that names it. A dev build logs to the terminal that ran it.

### From a release

[Releases](https://github.com/xyrlan/mnemo-desktop/releases) carry a `.dmg` for macOS, a `.deb`, `.rpm` and `.AppImage` for Linux, and one installer for Windows: `mnemo_<version>_x64-setup.exe`, per user, into `%LOCALAPPDATA%\mnemo`, no administrator needed. Releases up to v0.5.3 also had an `.msi`, which installs per machine under Program Files; the `setup.exe` finds that install and offers to remove it first, so take that offer rather than keep both.

The app has no updater. At each start it asks GitHub for the latest release, and when that is newer than itself it says so once per version, with the link; after that the about line at the bottom of the Settings panel names it. Being offline says nothing.

Starting the app while it runs brings the running window forward instead of opening a second app on the same state (`instance.lock` and `instance.port` in the state dir, below). A dev build, with its own state dir, runs beside the installed app.

### Where it keeps its state, and removing it

| | macOS | Linux | Windows |
| --- | --- | --- | --- |
| Settings, sessions, accounts, logs, the managed `mnemo`, voice models | `~/.mnemo-desktop` | `~/.mnemo-desktop` | `%USERPROFILE%\.mnemo-desktop` |
| A dev build's own (debug build) | `~/.mnemo-desktop-dev` | `~/.mnemo-desktop-dev` | `%USERPROFILE%\.mnemo-desktop-dev` |
| The webview's own storage and cache (and, from versions that had browser panes, their logins) | `~/Library/WebKit/sh.mnemo.desktop`, `~/Library/Caches/sh.mnemo.desktop` | `~/.local/share/sh.mnemo.desktop` | `%LOCALAPPDATA%\sh.mnemo.desktop` |

Outside those, only what you asked for or what Claude Code reads: the app's hook entries in `~/.claude/settings.json` (each runs `…/mnemo-desktop-hook`; on Windows `…/mnemo-desktop-hook.exe`, named with its argument and run with no shell, so it needs neither Git Bash nor PowerShell), the `desktop` MCP server it registered with `claude mcp add --scope user`, and, if you pressed *Add to PATH* in setup, a marked block (`# >>> mnemo-desktop: put mnemo and claude on PATH >>>`) in your shell's rc file, or on Windows an entry in your user `Path` (`HKCU\Environment`).

To remove mnemo-desktop: quit it, delete the app (`/Applications/mnemo.app`; the package on Linux; *Settings → Apps → mnemo* on Windows, whose uninstaller's *Delete the application data* box removes `%LOCALAPPDATA%\sh.mnemo.desktop` and nothing else), then delete the state dir and the others above you want gone, run `claude mcp remove --scope user desktop`, delete the hook entries that run `mnemo-desktop-hook` from `~/.claude/settings.json`, and remove the PATH block or entry.

## Test

    pnpm test                                        # front-end
    cargo test --manifest-path src-tauri/Cargo.toml  # core
    MNEMO_DESKTOP_SMOKE=1 ../.mnemo-desktop-target/debug/mnemo-desktop   # shell round-trip, exit 0 (target dir is shared across worktrees, see .cargo/config.toml)

## Using it

The app is one fleet, every Claude Code session you run and every child you dispatch, seen three ways. The selection is shared: the session in hand in one view is the session in hand in the others.

| view | key | position means | it is for |
| --- | --- | --- | --- |
| **Orbit** | `H` | attention (distance from the centre) and project (direction) | seeing the whole fleet at once; the app opens here |
| **Console** | `C` | order of attention, top to bottom | working in a session: the roster, the session on stage with its terminal, and its instruments |
| **Score** | `T` | time | reading what happened and when, with a playhead that replays it |

The top bar has the three views, how many things wait for you, the fleet by state, each account's plan windows, and James. Under it, on a line of its own, are the panels, the motion switch, and which world this is when it is not this machine's.

**What waits** is a short keyed list wherever it is drawn (on a roster entry, on a body in Orbit, at the now edge of a line in Score): a question's own choices; allow once, always, deny; merge, send back; resume, stop. `N` walks to the next one, a digit answers the one that is open, `R` answers it in your words.

**The stage** (Console's middle) is the session in hand: its figure, name and facts, its family across the top, what it is doing now, and its terminal. The terminal is the live one when the app can host it (a session it runs, or a dispatched child through `claude attach`, on the child's own account); otherwise the transcript drawn from what the session recorded, with a box under it that speaks to the session. `changes` on the terminal's bar opens the Changes panel for that session. A terminal that is not a session (a plain shell, a saved command, a session so new the fleet does not list it yet) is listed in the roster after the sessions, under *Terminals*, and stands on stage under a head that says what it is.

**The menu** is the second way to what is already on screen, from wherever a session is drawn: right-click a roster entry or a child inside it, a body or a moon in Orbit, a line or its card in Score, the stage's head or a family tab, a terminal listed under *Terminals*. It opens without selecting anything or moving the stage. It holds, each only when it applies: Open on stage, Answer…, Close session, Resume here, Stop, Message…, Changes, Open pull request, Merge, New session and New shell in the session's project, Copy (its id, `claude --resume <id>`, its folder) and Open folder. What ends something (Close, Stop, Merge) asks once, on the same item; a refusal is said in the menu, in the action's own words, and the menu stays. A project's name (the roster's group head after `G`, Orbit's rim) opens the project's menu: a new session or a shell there, Dispatch… (the Missions panel) and Projects. A right-click inside a live terminal stays the terminal's.

**The instruments** (Console's right, and beside a line selected in Score) are three readings of the session: context and tokens (how full, the curve with its compactions, spent by kind, by sub-agent, by tree), memory (what mnemo gave, what the session asked for, what was held back and why), and sight (the pages it opened with the screenshots it took, searches, files, pull requests).

**The panels** are what is not a session. Their names are on the line under the top bar; a click opens one beside the view, and Esc closes it.

- **Projects**: every repo the app knows, with a new session, a shell and its saved commands one key each, and *Add folder · Clone · Open folder*.
- **Missions**: each repo's open issues and pull requests, dispatch with model (`haiku`, `sonnet`, `opus`, `fable`), effort, may and advisor, dispatch a contract, what was launched, and landing a finished mission.
- **Changes**: the files the session in hand changed in its worktree, and the diff of each.
- **Memory**: the vault's activity, rules, pages and inbox.
- **Learned**: what mnemo learned lately, kept or dropped.
- **Accounts**: each account, its plan windows and resets, switch, add, rename, remove, sign in.
- **Setup**: the tools the app needs, found or missing, and installing them.
- **Settings**: every setting, and the build that is running.

**The command line** (`;`, at the foot, in every view) takes orders for the fleet and completes them against the real sessions, projects and contracts:

    new <project> [first prompt]          start a session in a project
    shell <project>                       open a plain shell in a project
    dispatch <project> <#issue … | contract.md> [model= effort= may= advisor=]
    message <session | all> <words>       to a session, or to every running child
    merge green                           merge every pull request whose checks are green
    land <feature>                        land a contract's feature
    stop <session | all>                  stop a session, or every running child
    go <session>                          put a session on stage (or just type part of its name)
    panel <name>                          open a panel (or just type the start of its name)

A verb that reaches more than one session (`message all`, `merge green`, `stop all`) is asked about before it runs. A refusal is a sentence, said where the order was typed.

The terminals the app runs survive a restart: the core keeps their shells and the app restores them.

### The two worlds

What the views draw is one model of the fleet. A build draws **this machine's**: the sessions, the children, the accounts and the vault as the core reads them. `?world=sample` on the URL, or `localStorage['mnemo.world'] = 'sample'`, draws a **synthetic** fleet instead, with no core at all; there an action changes the sample and nothing else. It is how every view is developed, photographed (`tools/preview`) and tested, and a safe place to try a key. The line under the top bar says `sample world` while it is on.

## Keys

Two places take keys. While the terminal on stage (or a text field) has the caret, keys are typed, and the fleet is reached with **Alt** (⌥ on a Mac). Anywhere else the same keys work bare. `?` shows this table in the app.

| key (Alt+ in a terminal) | does |
| --- | --- |
| `↑` `↓` | previous, next session in the roster's order, then the terminals that are not sessions |
| `←` `→` | through the family on stage: the parent, then each child |
| `Q` | the session you were on before; again at once, the one before that |
| `N` | the next thing that waits |
| `1`–`9` | answer the open waiting item |
| `R` | answer it in your words |
| `M` | the selected session's menu, where it is drawn; with Shift, its project's. The keyboard's menu key and Shift+F10 open it too |
| `H` `C` `T` | Orbit (home), Console, Score (time) |
| `Enter` | into the terminal on stage; again, give it the room |
| `;` | the command line |
| `Esc` | out of a card, a panel, the command line; never taken from a terminal |
| `?` | the keys |

In the menu: `↑` `↓` move, `Enter` chooses, a first letter goes to the item that starts with it (and chooses it when it is the only one), `←` `→` choose what Copy copies, `Esc` takes back a question and then closes.

In Console, `G` regroups the roster by project and back. The app's own chords are unchanged (`src/actions/chords.ts` is the table): ⌘W / Ctrl+Shift+W closes the terminal on stage, ⌘E / Ctrl+Shift+E dictates, ⌥Space / Alt+Space dictates while held.

In a terminal: ⌘←/⌘→ line start/end, ⌘⌫ kill line, ⌥⌫ kill word, ⌘C/⌘V clipboard, Shift+Enter newline (Claude Code). On Windows and Linux: Ctrl+C copies a selection and interrupts without one, Ctrl+V pastes, Ctrl+Shift+C / Ctrl+Shift+V copy and paste.

A file or a link opens in your own editor or browser.

## Replying to a child

A child's question is answered from its waiting card with its options or in words, and its permission prompt with allow or deny: the app presses the key in a hidden `claude attach <id>`, on the child's own account, and detaches. It refuses, and presses nothing, when the prompt on screen is not the one the card shows; the refusal is said on the card, and the child's terminal is on stage for you to answer by hand. `message` posts to the child's inbox socket instead; Claude Code hands that to the child as another session's message, which can never approve a push, a merge or a PR. To type to a child as yourself, put it on stage: its terminal there is a `claude attach`.

## Settings

`~/.mnemo-desktop/settings.json`, chosen in the Settings panel: `outgoing` (`en` rewrites replies and dictation in English through your own `claude -p` before they leave, keeping the text as typed when it is under four words or the answer does not look like a rewrite; `as-typed` sends verbatim), `replyLanguage` (`pt`/`en`/`unchanged`, asks a child to answer in that language), `skipPermissions`, `windowsShell`, `cloneBase` and each repo's setup command. The dictation language is the machine's, kept beside it in the panel.

## Desktop MCP

The app serves the Claude Code sessions it hosts an MCP server named `desktop`, so an agent can look at the other sessions instead of asking you to paste them:

- `desktop_list_panes`: the terminals the app holds, in the order they were opened (sessions, shells, commands), then the ones it runs that it does not show, each with the pane to read, its kind, label, cwd, Claude session and whether it is the one on stage.
- `desktop_terminal_read(pane, lines)`: the last `lines` (default 100) of any of them, scrollback included, shown or not.
- `desktop_app_snapshot`: a screenshot of the app's own window (macOS and Linux).

What works where: on macOS and Linux, every tool. On Windows, the sessions and their terminals (`desktop_list_panes`, `desktop_terminal_read`); the snapshot is not served there yet, so it is not listed.

The server is a second binary, `mnemo-desktop-mcp`, that Claude Code starts over stdio; it relays each call to the running app over `~/.mnemo-desktop/mcp.sock` (owner-only). On macOS and Linux that is a Unix socket. On Windows it is a named pipe, and `mcp.sock` is a one-line file naming it: the pipe is made for your account alone (it is its owner and its only access entry, and remote clients are refused), and the binary speaks only to a pipe your account owns. The agent hooks reach the app the same way, over `agent-hooks.sock`. On start the app links the binary of the build you launched to `~/.mnemo-desktop/bin/mnemo-desktop-mcp` (on Windows it copies it there, as `mnemo-desktop-mcp.exe`), writes `~/.mnemo-desktop/mcp.json`, and, if your Claude config has no user-scope server named `desktop`, runs the one-time equivalent of:

    claude mcp add --scope user desktop -- ~/.mnemo-desktop/bin/mnemo-desktop-mcp

New sessions then have the tools; `/mcp` in a session shows it. That happens once (`~/.mnemo-desktop/mcp-registered` remembers it), so `claude mcp remove --scope user desktop` sticks. To add it by hand instead, or for one project only (`--scope local`), run that line yourself; to try it without touching your Claude config, `claude --mcp-config ~/.mnemo-desktop/mcp.json`. With the app closed the tools answer "the mnemo desktop app is not running"; with several apps open, the one started last serves. `tauri dev` builds only the app binary, so run `cargo build --manifest-path src-tauri/Cargo.toml --bin mnemo-desktop-mcp` (same target dir) before trying it from a dev build.

A debug build (`tauri dev`) keeps all of this in `~/.mnemo-desktop-dev/` instead: its own workspace, settings, usage log, shell integration, `mcp.sock` and `mcp.json`, so it never restores, overwrites or serves over the installed app's. Only the downloads are shared (`tools/`, voice `models/`). Every terminal gets `MNEMO_DESKTOP_MCP_SOCKET` set to its own app's socket, so a session reaches the app it runs in, whichever build's binary it started. On restore, a saved session that a running `claude` already holds (`claude agents --json` gives it a pid) is not resumed: the terminal keeps the session id and opens a plain shell. When the lookup fails, no session is resumed.

## Shell integration

A new session or terminal starts in the repo it was opened from (the Projects panel, the command line), or your home directory. Terminals report their directory with OSC 7 at each prompt, which the app turns on for your default shell without touching your dotfiles:

- **zsh**: starts with `ZDOTDIR=~/.mnemo-desktop/shell/zsh`. Those files source your own `.zshenv`, `.zprofile`, `.zshrc` and `.zlogin` (from your `ZDOTDIR`, else `$HOME`), add a `precmd` hook, and put `ZDOTDIR` back once startup is done.
- **bash**: starts as `bash --rcfile ~/.mnemo-desktop/shell/bash/mnemo.bashrc`, which loads `/etc/profile` and your `~/.bash_profile` (or `~/.bash_login`, `~/.profile`) and prepends a hook to `PROMPT_COMMAND`.
- **fish** reports its directory on its own. Other shells get no hook.

Every shell also gets `TERM_PROGRAM=mnemo` and `TERM_PROGRAM_VERSION`. The app rewrites the files under `~/.mnemo-desktop/shell/` when they differ from the built-in copy, so edits there do not stick. To opt out, set `MNEMO_NO_SHELL_INTEGRATION=1`: in the app's environment it starts shells as before, in your own startup files it skips the hook.

Specs and plans: `docs/superpowers/`.

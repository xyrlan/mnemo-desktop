<img src="src/brand/mark.svg" width="96" height="96" alt="" />

# mnemo-desktop

Desktop app for the mnemo agentic development environment: the Nexus, a ship that shows every Claude Code session you run and every child you dispatch, with each session's live terminal in a drawer beside it.

## Dev

    brew install cmake        # whisper-rs (voice) builds against it
    pnpm install
    pnpm tauri dev

Start a session from the app (right-click a deck or a dock: *New session*, or type `/new <repo>` in the bridge's prompt), or run your parent Claude Code session in a terminal of its own; its captain, and the children it dispatches, then appear on the ship.

## Install

    pnpm run install-app

Builds the release bundle, quits the running app, swaps it into `/Applications/mnemo.app` and relaunches it — one command, and the one to run after every merge. Safe to run from a terminal of the app it is replacing: the swap runs detached, so quitting the app cannot kill the install halfway. `--no-launch` leaves the app closed.

The app then says which commit it is: the short sha and the build time are stamped in at build time, and shown at the bottom of *SYSTEMS › Settings* and by `mnemo-desktop --version`.

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

The app has no updater. At each start it asks GitHub for the latest release, and when that is newer than itself it says so once per version, with the link; after that the about line at the bottom of *SYSTEMS › Settings* names it. Being offline says nothing.

Starting the app while it runs brings the running window forward instead of opening a second app on the same state (`instance.lock` and `instance.port` in the state dir, below). A dev build, with its own state dir, runs beside the installed app.

### Where it keeps its state, and removing it

| | macOS | Linux | Windows |
| --- | --- | --- | --- |
| Settings, sessions, accounts, logs, the managed `mnemo`, voice models | `~/.mnemo-desktop` | `~/.mnemo-desktop` | `%USERPROFILE%\.mnemo-desktop` |
| A dev build's own (debug build) | `~/.mnemo-desktop-dev` | `~/.mnemo-desktop-dev` | `%USERPROFILE%\.mnemo-desktop-dev` |
| The webview's own storage and cache (and, from versions that had browser panes, their logins) | `~/Library/WebKit/sh.mnemo.desktop`, `~/Library/Caches/sh.mnemo.desktop` | `~/.local/share/sh.mnemo.desktop` | `%LOCALAPPDATA%\sh.mnemo.desktop` |

Outside those, only what you asked for or what Claude Code reads: the app's hook entries in `~/.claude/settings.json` (each runs `…/mnemo-desktop-hook`), the `desktop` MCP server it registered with `claude mcp add --scope user`, and, if you pressed *Add to PATH* in setup, a marked block (`# >>> mnemo-desktop: put mnemo and claude on PATH >>>`) in your shell's rc file, or on Windows an entry in your user `Path` (`HKCU\Environment`).

To remove mnemo-desktop: quit it, delete the app (`/Applications/mnemo.app`; the package on Linux; *Settings → Apps → mnemo* on Windows, whose uninstaller's *Delete the application data* box removes `%LOCALAPPDATA%\sh.mnemo.desktop` and nothing else), then delete the state dir and the others above you want gone, run `claude mcp remove --scope user desktop`, delete the hook entries that run `mnemo-desktop-hook` from `~/.claude/settings.json`, and remove the PATH block or entry.

## Test

    pnpm test                                        # front-end
    cargo test --manifest-path src-tauri/Cargo.toml  # core
    MNEMO_DESKTOP_SMOKE=1 ../.mnemo-desktop-target/debug/mnemo-desktop   # shell round-trip, exit 0 (target dir is shared across worktrees, see .cargo/config.toml)

## Using it

The ship's bar counts the agents working, waiting on you and ready, and holds the account switcher and three buttons:

- **PROJECTS**: every repo the app knows, with *New session*, a terminal, its saved commands, and *Add · Clone · Open folder*.
- **MISSIONS**: each repo's open issues and PRs, *Dispatch* (with model, effort and may) and *Dispatch contract*.
- **SYSTEMS**: *Memory* (the vault's pages, health, inbox and level), *What mnemo learned*, *Setup*, *Accounts* and *Settings*.

The bridge lists what waits on you: an answer, a merge, a stalled child (⌥1–9 on a Mac; Tab triages them one card at a time). Its prompt takes orders for the fleet: `/new <repo>`, `/dispatch <repo> #<issue>`, `/msg #<issue> | captain | all <text>`, `/merge green`, `/stop all`, `/land <feature>`. A right-click on a captain, a robot, a deck or a dock opens what can be done with it (open, close, resume, stop, merge, open the PR, its changes, copy its id, a new session or a terminal there).

A click on a figure opens its session in the drawer: its live terminal (a robot's through `claude attach`, on its own account), or its conversation read-only when the session runs outside the app. ⌘\ collapses and expands the drawer, ⌘W closes what is on top (a confirmation, a window, else the drawer's tab), Esc collapses it. A drawer tab's × ends a shell; a Claude session runs on, and its captain opens it again.

The terminals the app runs survive a restart: the core keeps their shells, the app restores them, and the drawer shows its tabs again.

## Shortcuts

⌘W close · ⌘⇧W close · ⌘\ drawer · ⌘E dictate · ⌥Space hold to dictate · ⌥1–9 the bridge's Nth row · Tab triage · `/` the bridge's prompt · Esc collapse the drawer

On Windows and Linux plain Ctrl is the shell's, so the app's chords are Ctrl+Shift where a Mac has ⌘ (Ctrl+Shift+W close, Ctrl+Shift+E dictate, Ctrl+Shift+\ drawer), Alt+Shift+W to close as ⇧⌘W does, and Alt+Space to dictate. `src/actions/chords.ts` is the table.

In a terminal: ⌘←/⌘→ line start/end, ⌘⌫ kill line, ⌥⌫ kill word, ⌘C/⌘V clipboard, Shift+Enter newline (Claude Code). On Windows and Linux: Ctrl+C copies a selection and interrupts without one, Ctrl+V pastes, Ctrl+Shift+C / Ctrl+Shift+V copy and paste.

A file or a link opens in your own editor or browser.

## Replying to a child

From the bridge, a child's question is answered with its options or in words, and its permission prompt with Allow or Deny: the app presses the key in a hidden `claude attach <id>`, on the child's own account, and detaches. It refuses, and presses nothing, when the prompt on screen is not the one the card shows; then the attach opens in a drawer tab for you to answer by hand. `/msg` posts to the child's inbox socket instead; Claude Code hands that to the child as another session's message, which can never approve a push, a merge or a PR. To type to a child as yourself, open its robot: its drawer tab is a `claude attach`.

## Settings

`~/.mnemo-desktop/settings.json`, chosen in *SYSTEMS › Settings*: `outgoing` (`en` rewrites replies and dictation in English through your own `claude -p` before they leave, keeping the text as typed when it is under four words or the answer does not look like a rewrite; `as-typed` sends verbatim), `replyLanguage` (`pt`/`en`/`unchanged`, asks a child to answer in that language), `skipPermissions`, `windowsShell`, `cloneBase` and each repo's setup command. The dictation language is the machine's, kept beside it in the window.

## Desktop MCP

The app serves the Claude Code sessions it hosts an MCP server named `desktop`, so an agent can look at the other sessions instead of asking you to paste them:

- `desktop_list_panes`: the Nexus's sessions: the drawer's tabs in order, then the terminals the app runs that no tab shows, each with the pane to read, its kind, label, cwd, Claude session and whether it is on screen.
- `desktop_terminal_read(pane, lines)`: the last `lines` (default 100) of any of them, scrollback included, shown or not.
- `desktop_app_snapshot`: a screenshot of the app's own window (macOS).

What works where: on macOS, every tool. On Linux, every tool but the snapshot, which is not listed there. On Windows, none: the server needs a Unix socket and Windows has no server for it yet, so the app registers nothing, sets no `MNEMO_DESKTOP_MCP_SOCKET` in its panes, and says so once when it first starts; `mnemo-desktop-mcp.exe`, registered by hand, refuses to start with that reason (`/mcp` shows it failed).

The server is a second binary, `mnemo-desktop-mcp`, that Claude Code starts over stdio; it relays each call to the running app over `~/.mnemo-desktop/mcp.sock` (owner-only). On start the app links the binary of the build you launched to `~/.mnemo-desktop/bin/mnemo-desktop-mcp`, writes `~/.mnemo-desktop/mcp.json`, and, if your Claude config has no user-scope server named `desktop`, runs the one-time equivalent of:

    claude mcp add --scope user desktop -- ~/.mnemo-desktop/bin/mnemo-desktop-mcp

New sessions then have the tools; `/mcp` in a session shows it. That happens once (`~/.mnemo-desktop/mcp-registered` remembers it), so `claude mcp remove --scope user desktop` sticks. To add it by hand instead, or for one project only (`--scope local`), run that line yourself; to try it without touching your Claude config, `claude --mcp-config ~/.mnemo-desktop/mcp.json`. With the app closed the tools answer "the mnemo desktop app is not running"; with several apps open, the one started last serves. `tauri dev` builds only the app binary, so run `cargo build --manifest-path src-tauri/Cargo.toml --bin mnemo-desktop-mcp` (same target dir) before trying it from a dev build.

A debug build (`tauri dev`) keeps all of this in `~/.mnemo-desktop-dev/` instead: its own workspace, settings, usage log, shell integration, `mcp.sock` and `mcp.json`, so it never restores, overwrites or serves over the installed app's. Only the downloads are shared (`tools/`, voice `models/`). Every terminal (on macOS and Linux) gets `MNEMO_DESKTOP_MCP_SOCKET` set to its own app's socket, so a session reaches the app it runs in, whichever build's binary it started. On restore, a saved session that a running `claude` already holds (`claude agents --json` gives it a pid) is not resumed: the terminal keeps the session id and opens a plain shell. When the lookup fails, no session is resumed.

## Shell integration

A new session or terminal starts in the repo it was opened from (a deck, a dock, PROJECTS), or your home directory. Terminals report their directory with OSC 7 at each prompt, which the app turns on for your default shell without touching your dotfiles:

- **zsh**: starts with `ZDOTDIR=~/.mnemo-desktop/shell/zsh`. Those files source your own `.zshenv`, `.zprofile`, `.zshrc` and `.zlogin` (from your `ZDOTDIR`, else `$HOME`), add a `precmd` hook, and put `ZDOTDIR` back once startup is done.
- **bash**: starts as `bash --rcfile ~/.mnemo-desktop/shell/bash/mnemo.bashrc`, which loads `/etc/profile` and your `~/.bash_profile` (or `~/.bash_login`, `~/.profile`) and prepends a hook to `PROMPT_COMMAND`.
- **fish** reports its directory on its own. Other shells get no hook.

Every shell also gets `TERM_PROGRAM=mnemo` and `TERM_PROGRAM_VERSION`. The app rewrites the files under `~/.mnemo-desktop/shell/` when they differ from the built-in copy, so edits there do not stick. To opt out, set `MNEMO_NO_SHELL_INTEGRATION=1`: in the app's environment it starts shells as before, in your own startup files it skips the hook.

Specs and plans: `docs/superpowers/`.

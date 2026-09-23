---
feature: round19
created: 2026-09-23
verdict: parallel
---

Nineteenth round, four pieces, from #155 and the first install on a real
Windows machine (v0.1.0, 2026-09-22). The app opened with neither `mnemo` nor
`claude` found and said so in a notice. The user then had to install Claude
Code, install mnemo, put both on `PATH` by hand, and restart the app before it
saw either. Their verdict: too much for a user to do. The app should find what
is missing and install it.

Traced on `e36589e`:

- **Every `mnemo` and `claude` call resolves through one PATH.** The program is
  a bare name and the child's `PATH` is `mission::login_path()`
  (`vault.rs:1283`, `marketplace.rs:1144`, `mission.rs:838-848`, `job.rs:77`,
  `chrome.rs:123`, `home.rs:368`). That function is the seam: once it has the
  tools on it, every caller has them.
- **On Windows it is the inherited PATH, frozen.** `login_path()` returns
  `std::env::var("PATH")` on Windows, cached in a `OnceLock` for the app's
  lifetime (`mission.rs:619-626`). A tool installed while the app is open is
  not seen until a restart. `merge_paths` splits and joins on `:`, which would
  cut `C:\…` apart if Windows ever reached it.
- **mnemo needs no Python.** Each `xyrlan/mnemo` release ships
  `mnemo-vX-{darwin-arm64,darwin-x64,linux-x64,win-x64}.tar.gz`, each with a
  `.sha256`. The archive holds one top-level `mnemo/` directory, a PyInstaller
  onedir bundle. Checked on v1.6.0 `win-x64` (9.3 MB): `mnemo/mnemo.exe` plus
  `mnemo/_internal/`. The executable only runs next to its `_internal/`. The
  Claude Code plugin already installs it this way (`bin/launch` in the mnemo
  repo), and it refuses an archive whose checksum is missing or does not match.
- **Claude Code's native installer**, per the docs
  (code.claude.com/docs/en/setup): macOS and Linux run
  `curl -fsSL https://claude.ai/install.sh | bash`. Windows CMD runs
  `curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd`,
  and PowerShell runs `irm https://claude.ai/install.ps1 | iex`. It installs
  `~/.local/bin/claude`, and `%USERPROFILE%\.local\bin\claude.exe` on Windows.
  No administrator rights are needed. Login happens by running `claude`. Git
  for Windows is optional for Claude Code, but this app needs `git` itself.
- **`gh` has an install button that only works on a Mac.** `installGh` opens
  `brew install gh` on every platform (`src/github/actions.ts:75`).
- **A process started without `crate::proc::command` flashes a console window
  on Windows** (#154). A test enforces it.

Wiring rules from `docs/contracts/panes.md` hold. The setup screen is a pane
view in `src/setup/view.tsx` and registers its palette action there. Only
three pieces edit **`src-tauri/src/lib.rs`**, each touching only its own
blocks, one in the module list and one in the `invoke_handler` list:
- `tool-path` directly after `// -- editor (src/fs.rs) --` and
  `// -- editor commands --`
- `mnemo-install` directly after `// -- job (src/job.rs) --` and
  `// -- job commands --`
- `system-path` directly after `// -- mcp (src/mcp.rs) --` and
  `// -- mcp commands --`

A command that is written but never registered compiles and fails only at
runtime (`home_refresh_github`). So every new command needs a test that it is
listed in the handler. Only `mnemo-install` may edit `Cargo.toml` and
`Cargo.lock`.

**Signatures that stay put:**
- `mission::login_path() -> String` has 15+ callers. It keeps its name and
  signature.
- `layout.getState().openCommandTab(cwd, command)`.
- `openView`.

Most of this is Windows behaviour that CI cannot show. Keep it in pure
functions over strings and paths, so the Windows cases are unit tests that run
on every OS. Verify the rest against the real app with `tauri dev` on a
private target and port
(`CARGO_TARGET_DIR=$HOME/.cache/mnemo-desktop-r19-<piece> pnpm tauri dev --port 22NN`).
The maintainer runs the acceptance test on a clean Windows machine.

## tool-path

- **files:** src-tauri/src/tools.rs, src-tauri/src/mission.rs, src-tauri/src/pty.rs, src-tauri/src/lib.rs
- **exposes:** `crate::tools::managed_dir(tool: &str) -> std::path::PathBuf`, `crate::tools::extra_dirs() -> Vec<std::path::PathBuf>`, `crate::tools::refresh()`, `tools_status() -> Vec<ToolStatus>`
- **consumes:** nothing
- **model:** opus
- **effort:** high

The app finds `git`, `gh`, `claude` and `mnemo` without anything on the system
`PATH`, and notices a tool installed while it is running.

- `managed_dir(tool)` is the directory the app owns for one tool, under
  `~/.mnemo-desktop/tools/`. After `mnemo-install` has run, the `mnemo`
  executable is directly inside `managed_dir("mnemo")`.
- `extra_dirs()` returns every directory the app puts on `PATH` beyond what the
  system gives it: the managed dirs plus `~/.local/bin` (the Claude installer's
  target, on every OS). `system-path` writes exactly these to the user's own
  `PATH`, so the two lists cannot drift.
- `login_path()` includes `extra_dirs()` on every OS, with the platform's
  separator. On Windows it starts from the `PATH` a newly opened terminal would
  get, meaning the user and machine values as stored now, not the value the
  app inherited at launch. After `refresh()`, the next call reads PATH again.
- A terminal pane gets `extra_dirs()` on its `PATH` too. `mnemo --version`
  typed into a pane works on a machine whose system `PATH` has neither tool.
- `tools_status()` is a Tauri command. It re-reads PATH on every call, so
  "check again" after an install in a pane shows the new tool. It returns one
  row per tool, serialised as
  `{ name: 'git' | 'gh' | 'claude' | 'mnemo', path: string | null, version: string | null, managed: boolean }`.
  `path` is the absolute executable found on `login_path()`, with Windows'
  `.exe` or `.cmd` resolution. `version` is the first line of `--version`, and
  `managed` is true when the path is under `managed_dir`. It opens no window.

## mnemo-install

- **files:** src-tauri/src/tools_install.rs, src-tauri/src/lib.rs, src-tauri/Cargo.toml, src-tauri/Cargo.lock
- **exposes:** `tools_install_mnemo() -> Result<String, String>`, event `tools-install` with payload `{ tool: string, message: string }`
- **consumes:** `crate::tools::managed_dir(tool: &str) -> std::path::PathBuf` from tool-path, `crate::tools::refresh()` from tool-path
- **model:** opus
- **effort:** high

One click installs mnemo on a machine with no Python and no `mnemo`, then runs
`mnemo init`.

- It installs the latest `xyrlan/mnemo` release for this OS and CPU into
  `managed_dir("mnemo")`. `Ok` is the installed tag, `Err` is what failed, in a
  sentence a user can act on.
- **Nothing unverified runs.** A missing `.sha256` or a mismatch installs
  nothing and leaves an earlier install intact. There is a test for that.
- **An install never leaves a half-written directory where `mnemo` resolves**,
  including a second click while one install is running, and a reinstall over
  an existing copy.
- It emits `tools-install` lines while it downloads, verifies, unpacks and
  runs `mnemo init`, including `init`'s own output, so the setup screen can
  show progress and the reason for a failure.
- It calls `refresh()` once `mnemo` is in place, so the next `tools_status`
  and every `login_path()` caller see it.
- It is written against the real release shape above, and the Windows layout
  (`mnemo.exe` next to `_internal/`) has a test.

## system-path

- **files:** src-tauri/src/tools_path.rs, src-tauri/src/lib.rs
- **exposes:** `tools_add_to_path() -> Result<String, String>`
- **consumes:** `crate::tools::extra_dirs() -> Vec<std::path::PathBuf>` from tool-path
- **model:** sonnet
- **effort:** medium

An explicit action, never automatic, puts `extra_dirs()` on the user's own
`PATH`, so terminals outside the app find `mnemo` and `claude` too. `Ok` says
in one sentence what changed and where. It says nothing changed when nothing
did.

- **User scope only.** No administrator rights, and it never touches the
  machine-wide PATH.
- **Windows:** the user `Path` in `HKCU\Environment` keeps every existing
  entry byte for byte. That includes unexpanded `%VAR%` entries, and a value
  longer than 1024 characters survives whole. Terminals opened afterwards see
  the change without a logoff.
- **macOS and Linux:** the change goes in the rc file the user's interactive
  shell reads (zsh reads `.zshrc` only when interactive, see
  `mission::login_path`'s doc comment), as one marked block. Running it twice
  adds nothing.
- It adds no crate.

## setup-view

- **files:** src/setup/, src/github/actions.ts, src/github/Account.tsx
- **exposes:** `openView('setup', {}, place)`, palette action `setup.open`
- **consumes:** `tools_status() -> Vec<ToolStatus>` from tool-path, `tools_install_mnemo() -> Result<String, String>` from mnemo-install, `tools_add_to_path() -> Result<String, String>` from system-path
- **model:** opus
- **effort:** high

A user who launches the app with nothing installed gets from there to a
logged-in `claude` and a working `mnemo` using only clicks inside the app.

- It shows `git`, `claude`, `mnemo` and `gh`: found or missing, path, version,
  and whether the app manages it.
- It opens by itself at launch when `claude` or `mnemo` is missing, which is
  the reporter's first launch. It does not open when all four are present.
  `setup.open` opens it from the palette at any time.
- **Install mnemo** calls `tools_install_mnemo` and shows its `tools-install`
  lines and its error.
- **Install Claude Code** opens a terminal tab that runs the native installer
  for this OS (the forms above). The pane's shell on Windows is `cmd.exe`
  (`COMSPEC`), so it needs the CMD form. The user then logs in with `claude`
  in that tab.
- A missing `git` or `gh` gets this OS's own install route. `brew` exists only
  on macOS, and this piece fixes `installGh` on the other platforms.
- **Check again** calls `tools_status`. **Add to PATH** calls
  `tools_add_to_path` and shows its sentence.
- Nothing is installed without a click.

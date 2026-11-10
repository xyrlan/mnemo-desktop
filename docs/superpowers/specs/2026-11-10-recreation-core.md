# The recreation's core wave: what the new front will read

2026-11-10. First of the recreation's specs. The interface is being rebuilt from scratch on
the branch `redesign/app`; this wave is the part of that work that does not depend on which
interface is chosen, so it runs while the concept prototypes (`redesign/concepts`, PR #545)
are still being built. It adds to the core and takes nothing away: the current front keeps
working on every commit of it.

## Why

The maintainer asked the new app to show, per session and without opening its terminal: what
it has spent and how full its context is; which memories it read, mnemo's and Claude Code's
own; and what it is seeing and making. The audit of the current app found that the core
answers almost none of it, though all of it is on disk:

- Token totals sum input and output and keep cache reads apart; cache writes are dropped,
  side-chain calls are not told apart, and sub-agent transcripts are never read. There is no
  total for a tree (a parent and its children).
- The context is the last call's size with no window to hold it against; the front guesses
  200k or 1M.
- Only the last tool call is kept. Searches, fetched pages, the screenshots a session's
  browser tools took, artifacts, files: all in the transcript, none read.
- Claude Code's own memory is not read at all, though the transcript records the files it
  loaded at the start and every later read or write of a memory file.
- mnemo's side is one list of fired rules per project. The reflex log also says which
  candidates were considered and held back, with scores and the reason; that, the briefing
  log and the friction ledger are not read.
- On Windows, the machine the maintainer works on, the desktop MCP server and the agent hook
  events do not exist: both reach the app over a Unix socket.

`docs/superpowers/prototypes/redesign/capture.py` on `redesign/concepts` reads all of the
above in Python for the prototypes, and `DATA.md` beside it says where each field comes
from. It is the worked example of what this wave moves into the core; it is not the design
of how.

Those files are not on this branch; read them with
`git show origin/redesign/concepts:docs/superpowers/prototypes/redesign/capture.py` (and
`…/DATA.md`, `…/measure_context.py`).

## Session insight

`session_insight(asks) -> { key: Insight }` and `insight_shot(ask, id) -> base64`, in
`src-tauri/src/insight.rs`. The types there are the contract and say what each field is.

What it must hold to:

- **It is asked every few seconds for every session on screen.** A transcript is read from
  where the last call stopped, as `nexus_feed::transcript::Reader` does today; a 38 MB
  transcript (the maintainer has them) costs its size once. Sub-agent transcripts and the
  window likewise. Answering for twenty sessions with nothing new in any of them costs
  about nothing.
- **A number matches its source.** One API message is counted once. `context.tokens` is the
  last main-chain call's input + both caches + output: measured against the size Claude Code
  states at each compaction, that has a median error of 0.00% and a largest of 0.4% over 170
  compactions (`measure_context.py` on `redesign/concepts`). The piece ships the thing that
  checks its own counters against real transcripts on the machine it runs on, and says in
  its PR what it measured.
- **Screenshots stay out of the feed.** A transcript can hold megabytes of base64 pictures;
  the feed lists them and `insight_shot` hands one over when the front shows it.
- **Paths are shown as the transcript wrote them.** Shortening a home directory is the
  front's business.
- Grok sessions have no Claude transcript; they are absent from the answer, not an error.

## Memory trail

`memory_trail(session_ids) -> { id: Trail }` and `vault_pulse(since) -> VaultPulse`, in
`src-tauri/src/memory_trail.rs`. The types there are the contract.

- The logs live in the vault's `.mnemo/`: `reflex-log.jsonl`, `mcp-access-log.jsonl`,
  `briefing-log.jsonl`, `friction-ledger.jsonl`, `learned.jsonl`, each with its `.1`
  rotation where mnemo rotates it. `memory_feed.rs` already finds the vault and reads four of
  them; this must not change what `memory_feed` answers.
- Asked every few seconds too: a log is read from where the last call stopped.
- A rule's `name` comes from its page, as `memory_feed::rule_name` finds it.
- A log line this version of mnemo did not write the way the code expects is skipped, never
  a failure of the whole answer.

## A transport Windows has

The desktop MCP server (`mcp.rs`, `bin/mnemo-desktop-mcp.rs`) and the agent hooks
(`agent_hooks.rs`, `bin/mnemo-desktop-hook.rs`) work on Windows as they do on macOS and
Linux: a session started in the app has the `desktop` tools, and `agent://event` reaches the
front when a session starts, is prompted, stops, notifies and ends.

- What exists on macOS and Linux keeps working unchanged, including an app and a helper
  binary of different builds finding each other.
- Today the socket's file mode is what keeps another user of the machine out. Whatever
  replaces it on Windows keeps other users out too, and the PR says how.
- The hook command installed into `~/.claude/settings.json` must run under Windows as
  Claude Code runs hooks there; today's is POSIX shell.
- `desktop_app_snapshot` is out of scope on Windows.
- The terminal daemon (`mnemo-desktop-ptyd`) is not part of this piece. It is the next user
  of the same transport, so `src-tauri/src/ipc.rs` is written to be used by it.
- CI's Windows job has no desktop session to click in; say what was run on a real Windows
  machine.

## Building

Three pieces build at once on one machine. Each builds into its own Cargo target,
`CARGO_TARGET_DIR=$HOME/.cache/mnemo-desktop-<piece>`, so none waits on another's lock
(`CLAUDE.md`, "One Cargo target, plus temporary per-piece ones"); landing prunes them. On
Windows the whisper build takes MSVC's Release flags first (`README.md`, "Install"), in a dev
build too.

On the maintainer's Windows machine: run `cargo` from PowerShell (in Git Bash the cmake step
of whisper's build fails); `~/.cargo/config.toml` already supplies `LIBCLANG_PATH` and the
MSVC flags; do not set `WHISPER_DONT_GENERATE_BINDINGS` (the bundled bindings are Linux's).
The front's suite runs as `npx -y pnpm@10.34.9 install --frozen-lockfile` then
`npx -y pnpm@10.34.9 test`, with `MNEMO_AGENT` unset.

## Out of this wave

The front. Deleting anything the current front reads. The terminal daemon on Windows.

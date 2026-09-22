---
feature: round18
created: 2026-09-22
verdict: parallel
---

Eighteenth round, five pieces, from the maintainer's 2026-09-22 audit against
Devin: the app is strong in the middle of a task (watching and unblocking many
children) and empty at both ends. A task still starts by typing into a
terminal and ends on GitHub's own page, and the vault that briefed the child is
invisible on every task-level screen.

Traced end to end on `af1ab54`:

- **Dispatch types keystrokes.** `dispatchIssues` opens a terminal tab and types
  `mnemo dispatch N…` after a fixed 700 ms (`src/github/actions.ts:14-21`,
  `src/layout/store.ts:184`). The round-15 spec's "real Tauri command that
  streams output" (`docs/superpowers/specs/2026-09-17-shell-and-lens-design.md`,
  Piece 4) was never built. Contract dispatch and `mnemo resume` have no entry
  at all.
- **Merge covers contract pieces only.** The cockpit's `ci` and `ready` rows come
  from contract pieces (`src/cockpit/needs.ts:51-62`), and PRs are fetched only
  for repos that hold a contract (`src-tauri/src/mission.rs:841`). Most
  dispatches are by issue, so their PRs never reach a merge row.
- **No diff.** Review is github.com in a webview beside the lens
  (`src/home/pr-pane.tsx`).
- **The vault stays on its own screen.** The mission pane shows a child's model,
  effort and timeline, but never what the vault handed it. `_inbox` is counted
  and badged (`src/vault/rules.ts:12`) but cannot be reviewed.

Wiring rules from `docs/contracts/panes.md` hold. **`src-tauri/src/lib.rs`:**
`pr-review` adds its block directly after the `// -- home … --` block, and
`child-memory` adds its block directly after the `// -- mission … --` block,
in both the module list and the `invoke_handler` list. No other piece edits
`lib.rs`. A command that is written but not registered compiles and fails
only at runtime (it happened with `home_refresh_github`), so every new command
needs a test that calls it through the handler, or a check that it is listed.

**Signatures that stay put while others build against them:**

- `runJob(key, title, cwd, argv)` in `src/cockpit/job.ts`.
- `useArm()` in `src/cockpit/actions.ts`.
- The existing fields of `Pr` and `ChildSession` in `src/mission/types.ts`.
  Fields may be added, not renamed or removed.

Verify against the real app, not only the suite. Run `tauri dev` in the
background with a private target and a port per piece
(`CARGO_TARGET_DIR=$HOME/.cache/mnemo-desktop-r18-<piece> pnpm tauri dev --port 22NN`),
and kill leftover `vite` first.

## pr-rows

- **files:** src/cockpit/, src/mission/types.ts, src/mission/types.test.ts, src/mission/fixtures.ts, src-tauri/src/mission.rs, src-tauri/src/mission_commands.rs
- **exposes:** `mergePr(root: string, pr: Pr): void`
- **consumes:** nothing
- **model:** opus
- **effort:** high

Every PR a dispatched child opened reaches the cockpit, contract or not. It is
red CI to open or ready to merge, and **a merge from the app cannot land
something the maintainer would not have merged by hand.**

Facts the merge has to survive, each from a real incident:

- **`gh pr merge` does not gate on checks.** mnemo-desktop has no branch
  protection, and a merge chain landed PRs #27 and #30 on `main` with a red
  Windows job. A green row must mean every check passed, read per check. It
  must not be inferred from the command succeeding.
- **Children open drafts.** A child opened PR #49 as a draft, and `gh pr merge`
  refused it. The row must say "draft", or make the PR ready as part of the
  maintainer's confirmed merge. It must never report "merged" for something
  that did not merge.
- **mnemo's `master` refuses a plain merge.** It requires a code-owner review
  the owner cannot give, so `gh pr merge` fails with *"base branch policy
  prohibits the merge"*; only `--admin` passes. The app never escalates to
  `--admin` on its own. A refused merge shows gh's reason on the row.
- **Merges stay double-confirmed** through `useArm`, as they are today.

`mergePr`'s signature stays as it is: `pr-review` calls it from the PR view.

The PR fetch is one of three `gh` pipelines in the app (`github.rs`,
`home/lens.rs`, `mission.rs`). `home/lens.rs` and `github.rs` are
**read-only** here. Reuse is welcome if it needs no edit there.

## pr-review

- **files:** src/home/pr-pane.tsx, src/home/pr-pane.test.tsx, src/home/home.css, src/home/review/, src-tauri/src/review.rs, src-tauri/src/lib.rs
- **exposes:** nothing
- **consumes:** `mergePr(root: string, pr: Pr): void` from pr-rows
- **model:** opus
- **effort:** high

The PR view (Home → a PR) reads the change natively: files and hunks, next to
the lens that already names the child that opened it. The maintainer can
review and merge a child's PR without GitHub's page. The webview stays
available; a native diff is the default reading, not the only one.

The facts: `gh pr diff <n>` and `gh pr view <n> --json files` answer from the
repo root. Children's PRs on mnemo run to a few hundred lines, and a diff of
thousands must not freeze the pane.

Merge from this view goes through `mergePr`, so its gating is `pr-rows`'s and
is not re-implemented here. The rest of `src/home/` (`Home.tsx`, `store.ts`,
`types.ts`, `lens.rs`) is read-only.

## child-memory

- **files:** src/mission/view.tsx, src/mission/view.test.tsx, src/mission/mission.css, src/mission/memory/, src-tauri/src/child_memory.rs, src-tauri/src/lib.rs
- **exposes:** nothing
- **consumes:** nothing
- **model:** sonnet
- **effort:** high

The mission pane shows a child's model, effort and timeline. It should also
show what the vault gave that child and what the child pushed back against,
so memory is visible where the work is and not only on the vault screen.

What can be joined to a child's `session_id` today (fields read on disk,
2026-09-22):

- `.mnemo/briefing-log.jsonl`: `reader_session_id` and `path`, meaning the
  briefing the session started with.
- `.mnemo/reflex-log.jsonl` and its rotated `.1`: `session_id` and `emitted`,
  meaning the rules injected into its prompts.
- `.mnemo/friction-ledger.jsonl`: `session_id`, `contradicts` and
  `injected_in_session`, meaning the rules its session contradicted.

**What cannot be joined yet:** rules the child *read* over MCP.
`mcp-access-log.jsonl` tool rows carry no session id; xyrlan/mnemo#438 adds
one. Read the field when it is present, and say "not recorded" when it is
absent. Never guess reads by project and time: the parent and siblings work
the same repo in the same window.

`vault_root()` (`src-tauri/src/vault.rs:1269`) and `src-tauri/src/pulse.rs`,
which tails the same logs, are **read-only**. A child with no `session_id` yet,
or with no rows, reads as such. It is never an error.

## inbox-review

- **files:** src/vault/, src-tauri/src/vault.rs
- **exposes:** nothing
- **consumes:** nothing
- **model:** sonnet
- **effort:** high

The vault pane lets the maintainer review `_inbox` (read a staged page,
promote it, drop it), instead of only counting it.

Why it matters, from mnemo's own ledger (xyrlan/mnemo#429):

- 142 pages staged on 2026-09-22.
- **Zero organic promote/drop decisions ever.**
- 44 session-start offers over 09-19..22, followed by 0 decisions.

The inbox has no drain partly because the screen the maintainer lives in
never shows it.

The CLI already has the acts: `mnemo inbox [--all] [--show KEY] [--promote KEY]
[--drop KEY] [--restore KEY] [--stats]`. It is project-scoped unless `--all`
is passed, and it has no `--json`. A drop is undoable with `--restore` (and
pages the reference judge held expire after 14 days, #430), so say that on the
drop. The pane runs only allowlisted subcommands (`ACTIONS`, `vault.rs:1147`),
and `inbox` is not on the list yet. Its argument checks are the ones to extend:
`is_word` already admits `/`, so a key like `reference/mnemo__slug` passes.
Pin in the suite that nothing but an allowlisted `inbox` act reaches the CLI.

## dispatch-job

- **files:** src/github/actions.ts, src/github/actions.test.ts, src/board/
- **exposes:** `dispatchIssues(root: string, ns: number[], opts?: { model?: string; effort?: string; may?: string }): void`
- **consumes:** nothing
- **model:** sonnet
- **effort:** medium

Dispatch runs as a command with its output captured, not as keystrokes typed
into a fresh terminal after a fixed 700 ms. Two dispatches the app cannot start
today also get an entry:

- a **contract**, `mnemo dispatch --contract <path>`. `mission.rs` already
  finds a repo's contracts, and the paths are in the snapshot.
- **`mnemo resume`**, which wakes children the account's rate limit stopped.

`mnemo dispatch` prints each child's id and branch, then `queue:` and `attach:`
lines. Whatever runs it, the maintainer must still see that output and any
refusal (a contract the parser rejects is refused before any worktree exists).
`runJob` (`src/cockpit/job.ts`, owned by `pr-rows`) is available with its
current signature, and its log drawer comes with it. `src/layout/` is
read-only. `dispatchIssues` keeps its signature, so the board's batch sheet
calls it unchanged.

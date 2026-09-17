# The shell and the lens

**Date:** 2026-09-17
**Repos:** mnemo-desktop only. `mnemo dispatch` already accepts `ISSUE ...`, so no CLI change is needed.

## The problem

Six complaints, one root for most of them.

1. Dropping a file with two panes split always writes to the first pane.
2. Panes cannot be repositioned decently.
3. The board lands somewhere awkward once other panes are open.
4. Dispatching issues is one at a time.
5. Home has no job — the real workflow is opening a tab and working from there.
6. `attach` in the UI reads as mysterious.

Complaints 1–3 share a cause: **`openView(..., 'auto')` guesses where a view belongs, and the split tree offers no way to correct the guess.** The only repositioning that exists is swapping two panes in place. Fix the correction mechanism and the guessing stops mattering.

Complaints 5 and 6 are framing, not mechanics. Home duplicates what `⌘T` and `⌘K` already do faster. `attach` is named after its mechanism (`claude attach <id>`) rather than its job.

## What was verified before designing

Five read-only investigations established the facts below. Line numbers are from the state of the repo at `6dc4057`.

**Drop targeting.** `src/terminal/file-drop.ts:11` calls `document.elementFromPoint(x, y)?.closest('.pane[data-pane]')`. That returns the topmost DOM element at the point, which in a split may be an overlay or a child of the wrong pane. `paneRects()` in `src/layout/rects.ts:4` already returns real bounds per pane and is already tested; the drop path just doesn't use it.

**Layout model.** A binary split tree (`src/layout/tree.ts:3`) inside a single OS window. Splits via `⌘D` / `⌘⇧D`, dividers resize, and dragging a pane bar onto another pane calls `swapPanes` (`src/layout/store.ts:308`), which swaps leaf ids in place via `swapLeaves` (`src/layout/tree.ts:35`). There is no operation that removes a leaf and re-inserts it elsewhere, so nothing beyond swapping is reachable.

**Board.** Not an OS window — a pane opened through `openView('board', {}, 'auto', 'board')` (`src/board/view.tsx:8`). The `auto` placement rule (`src/layout/store.ts:210-231`) splits right above 900px, down above 600px, else opens a new tab. No keyboard shortcut is bound.

**Dispatch.** `src/board/Board.tsx:31` calls `dispatchIssue(root, n)`, which opens a terminal tab and types `mnemo dispatch <n>` after a 700ms delay (`src/github/actions.ts:8`, `src/layout/store.ts:165-174`). One issue at a time; no selection state exists. `mnemo dispatch --help` confirms the positional is `ISSUE ...` — already variadic, with `--model`, `--effort`, and `--may` available.

**Home.** Renders repos from `~/.claude/history.jsonl` and `claude agents --json --all` (`src-tauri/src/home.rs:29-71`, `:354`). Unique to it: repo pin/hide, repo search, clone form, one-click resume. Everything else is reachable faster from `⌘T` or `⌘K`. It is the default view only when `activeTab === ''`.

**Attach.** A UI wrapper over `claude attach <id>`. Its real value is `src/cockpit/approve.ts:106`, which opens attach, polls the terminal buffer for up to 20s, detects a permission prompt, and types the answer digit. **This is the only path that can answer a permission prompt** — a socket reply arrives as text from another session and cannot approve anything. Not redundant; badly named.

**PR-to-child attribution.** The chain holds. `dispatch-parents.jsonl` records parent session to child short id (`src/mnemo/core/sessions/parents.py:96`) and survives worktree deletion. Child to PR comes from `~/.claude/jobs/<id>/state.json` `children`, which was populated for **21 of 29** children measured on 2026-09-17 (72%). Of the 8 misses, 3 opened no PR by design. The gap is closed by the fallback `delivery.py:275` already uses: derive `fix/issue-NNN` from the child's cwd and query `gh pr list --head`. Combined coverage approaches 100% for issue-based dispatches.

**Resume and stop.** The resume list is ~95% built: `home.rs` already separates parent sessions from dispatch children (cwd containing `-wt-`), and `src/home/types.ts:39-48` already routes a click correctly — focus an existing pane when live here, `claude attach` when live in background, `claude --resume` when dead. Only a visual marker is missing. Stopping is absent: closing a pane kills the PTY and leaves the Claude session working. `claude stop <id>` fires SessionEnd about 1.3s later (verified live, mnemo #311).

## Piece 1 — Rect-based drop hit-test

Replace `terminalAt(x, y)` in `src/terminal/file-drop.ts` with iteration over `paneRects()`, testing `x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h`. Return the matching pane id or null.

The existing test (`src/terminal/file-drop.test.ts:14-26`) mocks `document.elementFromPoint`, so it must be rewritten: build a two-pane split, drop at coordinates inside the second pane, assert the second pane receives the write.

## Piece 2 — Edge-zone pane dragging

Two new pure functions in `src/layout/tree.ts`:

- `extract(tree, paneId)` — remove a leaf, collapse its parent split into the surviving sibling, redistribute the freed ratio.
- `graft(tree, targetId, paneId, edge)` — replace the target leaf with a split containing both panes, ordered by which edge was targeted, at a 50/50 ratio.

Drop zones on the drag overlay: the outer 25% of each side grafts to that edge; the center 50% keeps the existing `swapPanes` behavior. The overlay highlights the region that will receive the pane.

These are pure functions over a data structure, so they are built test-first with no UI involved. Tree surgery is the only risky part of this design; isolating it is deliberate. The drag wiring in `src/chrome/drag.ts:26-68` changes only after the tree ops are green.

Cross-tab moves are not in scope, though `extract`/`graft` make them possible later.

## Piece 3 — Board fixed slot

`⌘B` toggles the board into a reserved column — fixed side, full height, persisted width, resizable. It is a sibling of the split tree rather than a leaf in it, so toggling never disturbs the working layout. A second `⌘B` hides it and returns focus where it was.

This adds a second layout concept alongside the tree. That is the cost; the benefit is that the board's position stops being a guess and becomes a constant.

## Piece 4 — Batch dispatch

Selection state in the board store: click selects, shift-click extends a range, cmd-click toggles. The dispatch button reads the selection count.

Replace the typed-keystroke path with a real Tauri command that invokes `mnemo dispatch <n> <n> <n>` directly and streams output into a pane. The 700ms `PROMPT_DELAY_MS` sleep disappears with it.

A confirm sheet before dispatch shows the selected issues and offers `--model`, `--effort`, and `--may`, all of which the CLI already accepts.

## Piece 5 — The lens

Home stops being a launcher and becomes a stream of what is happening across all repos.

### Shape

All repos in one scrolling stream, grouped, each group carrying an accent color derived from a stable hash of the repo path. The accent appears on the group header and on every row beneath it, so no row is ever ambiguous about which repo it belongs to.

Per repo, four sections:

- **Sessions** — parent Claude sessions, live and recent. Open resumes, attaches, or focuses depending on state. Stop asks for confirmation, then runs `claude stop`.
- **Children** — dispatched children with their state. Attach, reply, stop.
- **Issues** — open issues from `gh`, each with a dispatch button.
- **PRs** — open PRs with check status and a `← child NNN` badge wherever the link resolves.

### Navigation

A stack, not a split. Clicking a PR pushes the PR view over the stream, with a breadcrumb (`‹ mnemo / PR #372`) and `⌘←` to pop back. The PR view is internally two columns — conversation and diff — because a PR is those two things, not because the user arranged panes. Terminals stay in their own tabs; the lens is a single tab to return to.

### Data

`src-tauri/src/home.rs` keeps its existing session sources and gains:

- Issues and PRs via `gh`, fetched when the lens tab becomes visible and cached between visits. A manual refresh button exists. No background polling of GitHub.
- A PR-to-child resolver: read `state.json.children` first, fall back to deriving `fix/issue-NNN` from the child's cwd and querying `gh pr list --head`. Resolution is cached per invocation and never written to disk.
- Local session and child state, which is free to read, continues to poll live.

### Stopping a session

`claude stop <id>`, behind a confirmation naming the session. SessionEnd fires roughly 1.3s later and writes the briefing.

One caveat governs testing this: **vault silence does not prove the hook did not fire.** The circuit breaker can suppress hook output. Verification must use a marker-file hook via `--settings`, not the absence of a briefing.

### Phases

Each phase ships on its own.

1. Data layer — gh fetch, cache, PR-to-child resolver, all testable without UI.
2. Stream UI — grouped rows, repo accent, sections.
3. Session stop — confirm dialog and the `claude stop` call.
4. PR detail view and the navigation stack.

## Piece 6 — Attach renamed

Labels only, no behavior change. `Answer` for the auto path (`approve.ts`), `Take over` for opening the terminal manually, `Step back` for the Ctrl+Z detach. The buttons name the job instead of the mechanism.

## The board stays

The board remains the GitHub Project kanban; the lens shows live repo state. They overlap on issues, which is acceptable — a kanban is for arranging work, the lens is for seeing what is currently happening.

## Order of work

1. Drop hit-test — standalone bugfix, no dependencies.
2. Edge-zone dragging — tree ops test-first, then the drag UI.
3. Board fixed slot — depends on the store changes from piece 2.
4. Batch dispatch — independent.
5. The lens — largest piece, four phases.
6. Attach rename — independent, trivial.

Pieces 1, 4, and 6 can proceed in parallel with 2.

## Explicitly out of scope

- Named workspaces. Revisit once edge-zone dragging exists and it is clear whether the need survives.
- Tab drag-to-reorder. Separate and smaller; blocks nothing here.
- Cross-tab pane moves. Enabled by `extract`/`graft`, but not built in this pass.
- Any change to the mnemo CLI. The dispatch signature already supports everything this design needs.

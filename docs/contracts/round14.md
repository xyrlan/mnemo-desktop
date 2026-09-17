---
feature: round14
created: 2026-09-17
verdict: parallel
---

Fourteenth round, six pieces, from
`docs/superpowers/specs/2026-09-17-shell-and-lens-design.md` — read that spec
first; it records what was measured before the design and why each piece
exists. Six complaints from the maintainer (2026-09-17, on screen) traced to
two roots: placement is guessed and cannot be corrected, and two surfaces are
named after their mechanism instead of their job.

Wiring rules from `docs/contracts/panes.md` hold.

**`src/layout/store.ts` is read-only for every piece in this round.** Three
pieces would otherwise want it, so the store wiring — grafting into the tree,
the board's fixed slot, the lens UI — is round 15, after the signatures below
exist. Consume the store through `store.getState()`; do not edit it. If a
piece believes it cannot finish without editing the store, that is a real
finding: say so in the PR instead of editing it.

Verify against the real app, not only the suite: run `tauri dev` in the
background with a private target (`CARGO_TARGET_DIR=$HOME/.cache/mnemo-desktop-r14-<piece>
pnpm tauri dev --port 20NN`, a different port per piece), and kill leftover
`vite` first.

## drop-hit-test

- **files:** src/terminal/file-drop.ts, src/terminal/file-drop.test.ts
- **exposes:** `terminalAt(x: number, y: number): PaneId | null`
- **consumes:** nothing
- **model:** sonnet
- **effort:** medium

Dropping a file with two panes split writes to the wrong pane. `terminalAt`
resolves the target with `document.elementFromPoint(x, y)?.closest('.pane[data-pane]')`,
which returns the topmost element at the point — an overlay, or a child of a
pane that is not under the cursor.

`paneRects()` in `src/layout/rects.ts` already returns real bounds per pane and
is already tested. The signature above does not change; only how it resolves.

The existing test mocks `document.elementFromPoint`, so it cannot catch this
and must be rewritten: build a two-pane split, drop at coordinates inside the
second pane, assert the second pane receives the write. Verify by hand too —
split a window, drop a file on the right pane, watch where the path lands.

`src/layout/rects.ts` is read-only.

## tree-ops

- **files:** src/layout/tree.ts, src/layout/tree.test.ts
- **exposes:** `extract(n: Node, target: PaneId): Node | null`, `graft(n: Node, target: PaneId, pane: PaneId, side: Side): Node`
- **consumes:** nothing
- **model:** opus
- **effort:** high

The split tree can only swap two panes in place (`swapLeaves`). Nothing removes
a leaf and re-inserts it elsewhere, which is why panes cannot be repositioned.

`extract` removes a leaf and collapses its parent split into the surviving
sibling, returning null when the last leaf is extracted. `graft` replaces the
target leaf with a split holding both panes, ordered by `side`, at an even
ratio. `closeLeaf` already does most of what `extract` needs — read it first.

These are pure functions over a data structure with no store and no React, so
they are built test-first. Cover at minimum: extract from a nested split,
extract the last leaf, graft onto a leaf inside a split, graft each of the four
sides, and that `leaves()` is preserved across an extract-then-graft round trip.

Nothing consumes these in this round; that is deliberate. This piece exists so
the wiring in round 15 has correct primitives to wire.

## pane-drag-zones

- **files:** src/chrome/drag.ts, src/chrome/drag.test.ts, src/chrome/PaneBar.tsx, src/chrome/PaneBar.test.tsx, src/chrome/chrome.css
- **exposes:** `dropZone(x: number, y: number, rect: Rect): Side | 'center' | null`
- **consumes:** nothing
- **model:** sonnet
- **effort:** high

Dragging a pane bar onto another pane swaps them, and swapping is the only
repositioning that exists. The maintainer wants edge zones: dropping near an
edge should split the target and place the pane there; dropping in the middle
should keep today's swap.

This piece owns the geometry and the visual feedback, not the tree mutation.
`dropZone` returns which region of a target rect a point falls in — the outer
25% of each side is that side, the middle is `center`, outside the rect is
null. `DragState` grows to carry the zone alongside `over`, and the drag
overlay highlights the region that would receive the pane.

While round 15 is unwritten, `center` keeps calling `swapPanes` as today and
an edge zone is inert beyond the highlight. Do not import
`extract`/`graft`; they are another piece's, unlanded, and the store that
would call them is read-only here.

## batch-dispatch

- **files:** src/board/Board.tsx, src/board/board.css, src/github/actions.ts, src/github/app-store.ts, src/github/types.ts, src/github/types.test.ts, src/github/actions.test.ts
- **exposes:** `dispatchIssues(root: string, ns: number[], opts?: { model?: string; effort?: string; may?: string }): void`
- **consumes:** nothing
- **model:** sonnet
- **effort:** high

Issues dispatch one at a time, and the mechanism is a keystroke simulation:
`dispatchIssue` opens a terminal tab and types `mnemo dispatch <n>` after a
700ms delay. The maintainer wants to select several and dispatch them together.

`mnemo dispatch` already takes `ISSUE ...` and already accepts `--model`,
`--effort` and `--may` (verified 2026-09-17 against `mnemo dispatch --help`),
so this is desktop-only work — no CLI change, and none is wanted.

Selection state belongs in `src/github/app-store.ts`: click selects, shift-click
extends a range, cmd-click toggles. A confirm step before dispatch shows the
selected issues and offers model, effort and may, so the maintainer sees what is
about to be spent. Keep `dispatchIssue` working for the single-issue path.

`openCommandTab` on the layout store stays the way the command reaches a
terminal; the store is read-only, so build the argument string and hand it over.
Whether the 700ms delay can go is worth testing, but it is a property of
`openCommandTab`, so removing it is round 15.

## lens-data

- **files:** src-tauri/src/home.rs, src-tauri/fixtures/, src/home/client.ts, src/home/types.ts, src/home/types.test.ts
- **exposes:** `HomeRepo { issues: Issue[], prs: Pr[] }` in the `home_snapshot` JSON, `Pr { number, title, state, checks, child: Option<String> }`, `refreshGithub(): Promise<void>` from `src/home/client.ts`
- **consumes:** nothing
- **model:** opus
- **effort:** high

Home is being rebuilt as a cross-repo lens (see the spec). This piece is its
data layer only — no UI. `src/home/Home.tsx` and `src/home/store.ts` are
**read-only**; the stream, the repo accents and the PR view are round 15.

`home.rs` already collects repos and sessions from `~/.claude/history.jsonl`
and `claude agents --json --all`, and already separates dispatch children by
their `-wt-` worktree cwd. It gains open issues and open PRs per repo via `gh`,
fetched on demand and cached between fetches — `refreshGithub()` is the trigger.
No background polling of GitHub; local session state keeps polling as it does.

Each PR carries the child that opened it where that resolves. The chain was
measured on 2026-09-17: `<vault>/.mnemo/dispatch-parents.jsonl` maps parent
session to child short id, and `~/.claude/jobs/<id>/state.json` `children`
carried a PR for **21 of 29** children (3 of the 8 misses opened no PR by
design). When that field is empty, fall back the way `mnemo`'s
`core/sessions/delivery.py` already does: derive the issue from the child's
worktree cwd and ask `gh pr list --head fix/issue-NNN`. Resolution is cached
per fetch and never written to disk. `child: None` is an ordinary outcome and
must render as an unbadged PR, never as an error.

A repo with no `gh` auth, or no GitHub remote, must degrade to today's
behaviour rather than failing the whole snapshot — `errors` on the snapshot
already exists for saying so. Add fixtures covering: a PR with a resolvable
child, a PR whose `state.json` is empty but whose branch resolves, a PR that
resolves to no child, and a repo where `gh` is unavailable.

## attach-labels

- **files:** src/cockpit/Cockpit.tsx, src/cockpit/Cockpit.test.tsx, src/cockpit/InboxRow.tsx, src/cockpit/MissionMap.tsx, src/cockpit/NeedsList.tsx, src/mission/rows.tsx, src/mission/view.tsx, src/mission/Sidebar.test.tsx
- **exposes:** nothing
- **model:** sonnet
- **effort:** medium
- **may:** pr

The maintainer asked why the UI has an attach function. It is not redundant:
`src/cockpit/approve.ts` opens `claude attach`, polls the terminal buffer for
up to 20s, detects a permission prompt and types the answer — and that is the
**only** path that can answer a prompt, because a socket reply arrives as text
from another session and cannot approve anything. The problem is that every
button is named after `claude attach` rather than after what it does.

Rename the user-facing labels only: the automatic path reads **Answer**, opening
the child's terminal by hand reads **Take over**, and the Ctrl+Z detach reads
**Step back**. Titles and tooltips may still name `claude attach <id>`, since
that is the literal command and knowing it is useful.

**No behaviour changes.** Function names, action kinds (`MapAction['kind']`),
routing and `approve.ts` all stay as they are — `src/cockpit/approve.ts` is
read-only. Four test files assert `textContent === 'attach'` and must be updated
with the labels; that they fail first is the check that every site was found.

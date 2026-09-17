---
feature: round15
created: 2026-09-17
verdict: parallel
---

Fifteenth round, two pieces. Round 14 built primitives and left them unwired:
`extract`/`graft` in `src/layout/tree.ts`, `dropZone` and `DragState.zone` in
`src/chrome/drag.ts`, and the lens data layer in `src-tauri/src/home/lens.rs`.
Neither could reach `src/layout/store.ts`, which was read-only for that whole
round. This round connects them.

Spec: `docs/superpowers/specs/2026-09-17-shell-and-lens-design.md`. Wiring
rules from `docs/contracts/panes.md` hold.

**Only `move-pane` may edit `src/layout/store.ts`.** The lens needs nothing
from it that does not already exist — `newTab`, `openCommandTab` and
`focusPane` are called as they are. If the lens piece believes it must edit
the layout store, that is a finding for its PR, not an edit.

The board's fixed slot is deliberately not here. A movable pane may remove the
need for it, so it is reconsidered after this round, not built alongside it.

Verify against the real app, not only the suite: run `tauri dev` in the
background with a private target (`CARGO_TARGET_DIR=$HOME/.cache/mnemo-desktop-r15-<piece>
pnpm tauri dev --port 21NN`, a different port per piece), and kill leftover
`vite` first.

## move-pane

- **files:** src/layout/store.ts, src/layout/store.test.ts, src/layout/workspace.test.ts, src/chrome/PaneBar.tsx, src/chrome/PaneBar.test.tsx, src/chrome/drag.ts, src/chrome/drag.test.ts
- **exposes:** `movePane(from: PaneId, to: PaneId, side: Side): void` on the layout store
- **consumes:** nothing
- **model:** opus
- **effort:** high

Dragging a pane bar onto another pane still only swaps. `extract` and `graft`
have been in `src/layout/tree.ts` since round 14 and nothing calls them;
`startPaneDrag` already tracks which zone the pointer is in and already
refuses to commit anything but `center`. This piece makes an edge drop move
the pane.

`movePane` extracts `from`, grafts it onto `to` at `side`, and leaves the tree
alone when the move cannot be made. Follow `swapPanes` (`store.ts:308`) for
the shape: map over every tab and keep the tab object identical when its root
did not change, which is also what keeps a cross-tab drag from doing anything.

Three things the suite must pin, because each is a way to lose a pane:

- **A self-move must be refused before it starts.** `movePane(p, p, side)` and
  a drop on the pane's own bar must leave the tree untouched. Measured on
  2026-09-17: `graft` returns the tree unchanged when its target is absent, so
  `graft(extract(t, p), p, p, side)` silently **deletes** pane `p`. The tree
  stays valid and no id is duplicated, which is why only a test catches it.
  The guard belongs here, not in `graft` — the store is the layer that knows a
  drag began on the pane it ended over.
- **Focus must survive the move.** When the moved pane held focus, it still
  holds it afterwards; `swapPanes` leaves `focused` alone today and a move
  must not inherit that by accident.
- **A saved workspace must survive a move.** `snapshotForSave` walks
  `tab.root`, so a moved tree has to round-trip through `restore` with the same
  panes in the same places.

`PaneBar.tsx:88` passes `swapPanes` into `startPaneDrag` today; an edge zone
has to reach `movePane` and `center` must keep swapping exactly as it does
now. Whether that is a second callback or one callback taking the zone is
yours to decide.

`src/layout/tree.ts` is read-only: `extract` and `graft` are correct and
tested, and this piece consumes them.

Verify by hand as well as by suite — drag a terminal onto another pane's right
edge and watch it land there, drop one on its own bar and watch nothing happen.

## lens-stream

- **files:** src/home/Home.tsx, src/home/Home.test.tsx, src/home/store.ts, src/home/store.test.ts, src/home/app-store.ts, src/home/types.ts, src/home/types.test.ts, src/home/home.css, src/home/repo-color.ts, src/home/repo-color.test.ts
- **exposes:** `repoAccent(root: string): string`
- **consumes:** nothing
- **model:** opus
- **effort:** high

Home is a repo launcher the maintainer does not use — his words, 2026-09-17:
he opens a new tab and works from there. Round 14 gave it something worth
showing instead. `HomeRepo` now carries `issues` and `prs`, each PR naming the
dispatch child that opened it, and `refreshGithub()` in `src/home/client.ts`
fetches them.

Home becomes one scrolling stream of every repo, each group showing its open
issues, its open PRs, its parent sessions and its dispatch children. Sections
per repo, not a repo picker: the maintainer asked to see everything at once and
to always know which repo a row belongs to.

`repoAccent` derives a stable colour from a repo's path — same path, same
colour, forever, with no configuration and no entry for a repo first seen a
second ago. Every row carries its repo's accent, so a row read on its own is
never ambiguous. Colours must be distinguishable in both themes; `src/theme.ts`
is read-only, so take the surrounding palette as given.

`refreshGithub()` is called when the lens becomes visible and on an explicit
refresh control, never on a timer — GitHub is read when asked for. Local
session and child state keeps polling as it does now. `issues` and `prs` are
optional on `HomeRepo` and are absent before the first fetch and when `gh`
cannot read a repo, and a PR with no child (`child: null`) is ordinary: render
it without a badge. A repo `gh` could not read still renders its sessions, with
the reason from `HomeSnapshot.errors`.

Clicking a PR or an issue opens it the way the app opens a URL today. **The PR
view with its diff, and the navigation stack behind it, are round 16** — do not
build them here.

Keep what only Home has: repo pin and hide, the filter, the clone form, and the
one-click resume in `whatClickDoes` (`src/home/types.ts:39`), whose three
outcomes — focus a live pane, attach a background session, resume a dead one —
are already correct and must keep working.

`src/layout/store.ts`, `src/github/`, `src/theme.ts` and `src-tauri/` are all
read-only. Reach the layout store through `store.getState()` for `newTab`,
`openCommandTab` and `focusPane`, exactly as Home does today.

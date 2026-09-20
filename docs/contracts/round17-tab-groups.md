---
feature: round17
created: 2026-09-20
verdict: parallel
---

Seventeenth round. `child-rows` shipped as #125; this is the piece that was
rate limited before it edited anything, redispatched unchanged.

The sidebar lists one line per tab, labelled after whichever pane holds focus
(`src/layout/tabs.ts:57`). A tab with three panes shows one, the label changes
as focus moves, and the repo a tab belongs to is never stated — it is only
implied by a cwd. The fix is to stop labelling a group by one of its members:
show the panes.

`src/cockpit/` is **read-only**: `Sidebar.tsx:166` renders `InboxRow`, and
that call site does not change — the row's own contents shipped in #125.

Wiring rules from `docs/contracts/panes.md` hold. Verify against the real app,
not only the suite: run `tauri dev` in the background with a private target
(`CARGO_TARGET_DIR=$HOME/.cache/mnemo-desktop-r17-tabs
pnpm tauri dev --port 2210`), and kill leftover `vite` first.

## tab-groups

- **files:** src/mission/Sidebar.tsx, src/mission/Sidebar.test.tsx, src/mission/mission.css, src/layout/tabs.ts, src/layout/tabs.test.ts, src/layout/store.ts, src/layout/store.test.ts, src/layout/tree.ts, src/layout/tree.test.ts
- **exposes:** `movePane(from: PaneId, to: PaneId, side: Side, tab?: string): void` on the layout store
- **consumes:** nothing
- **model:** opus
- **effort:** high

A tab becomes a group that shows its panes, and a pane can be dragged into
another group.

**A tab with one pane stays one line, exactly as today.** Measured on the
maintainer's own workspace on 2026-09-20: 5 tabs, 7 panes, and 3 of those tabs
hold a single pane. Rendering every tab as a header plus children would spend
three lines saying nothing. The group appears only where there is more than one
pane to group, so that workspace reads as 9 lines rather than 12.

A pane's line carries its own repo accent — `repoAccent(root)` from
`src/home/repo-color.ts`, already used by the lens, and importable here
(`src/layout/` imports from `src/home/` today, so this adds no cycle). With
each pane naming its own repo there is no tab-level repo to choose and no
prefix to add: the maintainer asked for the accent per line instead.

Clicking a pane's line focuses that pane and activates its tab.

**Moving a pane between tabs.** `movePane` (`store.ts:321`) refuses a move
whose panes are not in the same tab — it maps over every tab and only rewrites
one whose root changed. Dropping a pane onto another group makes that refusal
the thing to lift: the pane is extracted from its own tab and grafted into the
target's tree. Both trees change in one `set`, or a failure halfway leaves the
pane in neither.

Three things the suite must pin, because each loses a pane:

- **A cross-tab move keeps every pane.** The union of both tabs' leaves before
  and after is the same set, for a move out of a split and out of a
  single-pane tab alike.
- **Emptying a tab closes it.** A tab whose last pane moved away has no root;
  it must not survive as an empty group, and `activeTab` must not point at it.
- **Focus follows the pane.** The moved pane holds focus in its new tab, and
  the tab it left focuses something that still exists.

`snapshotForSave`/`restore` walk `tab.root` (`store.ts:339`), so a moved
workspace must round-trip: save after a cross-tab move, restore, same panes in
the same groups.

`src/chrome/drag.ts` and `src/chrome/PaneBar.tsx` are **read-only**: they
already track a drag and its zone (round 14), so consume `startPaneDrag` and
`dropZone` as they are. Dropping onto a sidebar line is this piece's own
target, in the sidebar.

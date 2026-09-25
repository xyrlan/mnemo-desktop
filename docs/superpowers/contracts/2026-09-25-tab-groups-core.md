---
feature: tab-groups-core
created: 2026-09-25
verdict: parallel
---

Wave 1 of the tab groups work. The design is `docs/superpowers/specs/2026-09-25-tab-groups-design.md`.
Read it first; it is the source of truth for every behaviour named below. Orca's code is at
`122b8c25` (clone it as the spec says, or look for one under `~/.claude/jobs/*/tmp/orca`), and the
maintainer authorized porting it with attribution (memory `orca-port-authorized`).

One piece. The store holds the whole model, so nothing here divides. The verdict says
`parallel` only so that its single piece dispatches. Wave 2
(`2026-09-25-tab-groups-view.md`) draws the groups and wires the Explorer, the editor and
search. It waits for this wave to merge, and it is written against the signatures below.

This contract reaches `main` as its own squash. Before your first push, run
`git fetch && git rebase origin/main` (memory `rebase-a-piece-before-its-first-push`).

## groups-core

The layout store becomes Orca's model, as the spec's *Model* describes: a split tree of
groups per worktree, each group an ordered set of tabs with one shown, and inner splits
for terminal tabs only.

This piece delivers:

- **`openView`, `split` and `newTab` place things** as the spec's *Opening* and
  *Splitting and moving* say:
  - `auto` never splits.
  - `split-row` and `split-col` mean "to the side".
  - ⌘D in a non-terminal tab opens a terminal to the side.
- **Previews.** An `openView` with `preview` replaces the target group's preview tab, and
  `keepTab` keeps a tab.
- **Closing.** A pane, then its tab, then an empty group collapses (*Closing*).
- **Group-scoped keys.** `goToTab` and `cycleTab` act on the active group (*Keyboard*),
  and so does `focusPane`. `focusPane` on a pane in another group makes that group
  active.
- **The saved workspace**, version 3, which reads version 2 as the spec's *Saved
  workspace* says. The maintainer's running terminals must come back after the upgrade:
  test a version 2 file shaped like theirs, with several worktrees, terminals with
  sessions, a conversation face, and a tab mixing a terminal with another view.

**Keep the rest of the app working while wave 2 is not on `main`.** Seventy-odd files read
`tabs`, `activeTab`, `Tab.root`, `Tab.focused` and `panes`. They keep their meaning:

- `tabs` is every tab of the shown worktree, across its groups;
- `activeTab` is the active group's shown tab;
- the focused pane of that tab has keyboard focus.

Many tests build a store with `setState({ tabs, activeTab })` and no groups: the
conversation, chrome/session, setup, sidebar and statusbar tests, among others. A layout
whose groups list none of its tabs must work as one group holding every tab in `tabs`
order.

`worktreeLayout(path)` covers every open worktree, shown or parked, and `ELSEWHERE` too.
It returns the same object until that layout changes, as `worktreeTabs` does today, so
wave 2's workbench can select it without rendering again.

The old strip (`src/tabs/TabStrip.tsx`) and workbench (`src/shell/Workbench.tsx`, not in
your boundary) keep drawing the active group's tabs. Change the strip only as far as it
needs to activate the right tab. Wave 2 replaces it.

Tests outside `src/layout` that assert the old placement are in the boundary. They
create splits through `openView(…, 'split-row')` or restore a version 1 file mixing a
terminal with a setup pane. Rewrite them for the new meaning; do not delete what they
check.

The reuse registry (`src/layout/reuse.ts`) gains `shows`. A view that registers it is a
document view, like the editor that wave 2 will register:

1. `auto` first shows a tab of that view whose pane already `shows` the props, in the
   target group and then anywhere in the worktree.
2. With `preview`, `auto` next reuses the target group's preview tab of that view through
   the `ReuseFn`.
3. Otherwise it opens a new tab.

An `openView` without `preview` that lands on a preview tab keeps it. That is how an
Explorer double click keeps the tab its single click opened.

A view with no `shows` is reused as today, but only as a whole tab, never as a split.
Test the target-group rule with a fake view that registers `shows`. The editor registers
it in wave 2, not here.

- **files:** src/layout/, src/actions/registry.ts, src/actions/registry.test.ts, src/tabs/TabStrip.tsx, src/tabs/TabStrip.test.tsx, src/chrome/PaneBar.test.tsx, src/chrome/SplitView.test.tsx, src/chrome/pane-bar-pulse.test.tsx, src/chrome/session.test.tsx, src/setup/launch.test.ts, src/shell/Workbench.test.tsx, src/editor/actions.test.ts
- **exposes:** `type Tab = { id: string; root: Node; focused: PaneId; name?: string; preview?: boolean }`, `type Group = { id: string; tabs: string[]; activeTab: string }`, `type GroupNode = { kind: 'group'; group: string } | { kind: 'split'; dir: Dir; ratio: number; children: [GroupNode, GroupNode] }`, `type WorktreeLayout = { tabs: Tab[]; activeTab: string; groups: Record<string, Group>; groupRoot: GroupNode | null; activeGroup: string }`, `type OpenOptions = { preview?: boolean }`, `type TabTarget = { group: string; index?: number } | { group: string; side: Side }`, `State.groups: Record<string, Group>`, `State.groupRoot: GroupNode | null`, `State.activeGroup: string`, `openView(view: string, props: Record<string, unknown>, place: Place, title?: string, opts?: OpenOptions): void`, `worktreeLayout(path: string): WorktreeLayout | undefined`, `activateTab(id: string): void`, `moveTab(id: string, to: TabTarget): void`, `detachPane(pane: PaneId, to: { group: string; index?: number }): void`, `keepTab(id: string): void`, `focusGroup(id: string): void`, `setGroupRatio(path: Path, ratio: number): void`, `type ShowsFn = (id: PaneId, props: Record<string, unknown>) => boolean`, `registerReuse(view: string, fn: ReuseFn, shows?: ShowsFn): () => void`
- **consumes:** nothing
- **model:** opus
- **effort:** xhigh

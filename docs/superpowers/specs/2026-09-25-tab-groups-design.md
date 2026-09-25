# Tab groups — design

Decided 2026-09-25. The maintainer compared the two ways Orca and mnemo-desktop split
the workbench and picked **Orca's full model** over a smaller alternative, preview tabs
inside today's model. Choices they did not make themselves are marked **default**. This
extends `2026-09-24-orca-redesign-design.md`, whose decision table already names
Orca's "split tab groups" (`components/tab-group/`) as the workbench to copy. Waves A–H
kept mnemo's own tree instead.

## Why

Today a worktree's workbench is a list of tabs, and each tab holds a split tree of
panes of any kind (`src/layout/store.ts`, `Tab.root`). One strip in the titlebar shows
the tabs, and only one of them is on screen at a time.

- A click on a file in the right sidebar's Explorer calls `openView('editor', …, 'auto')`.
  When the tab has no editor pane, `auto` **splits the focused pane**: a terminal running
  an agent is squeezed to half its width to show a file. When the tab already has an
  editor pane, the file replaces whatever that pane showed.
- There is nowhere to keep several files open beside a terminal. Each extra file is a
  split, or a tab that hides the terminal.

Orca keeps the terminal where it is and gives files a place of their own. The model
below is Orca's at commit `122b8c25` (paths relative to that clone):

| What | Where |
|---|---|
| Types: groups, split tree of groups, tabs with `isPreview` | `src/shared/tab-types.ts` |
| Store slice: groups per worktree, create/move/drop/close | `src/renderer/src/store/slices/tabs/` |
| Where an opened file goes | `store/slices/editor/tabs/editor-open-target-group.ts`, `workspace-editor-item.ts` |
| Group split layout and panel (tab row per group) | `components/tab-group/TabGroupSplitLayout.tsx`, `TabGroupPanel.tsx` |
| Tab drag onto an edge (drop zones, overlay) | `components/tab-group/tab-drop-zone.ts`, `tab-drag-drop-commit.ts`, `TabGroupDropOverlay.tsx` |
| Tab row, preview tab in italics | `components/tab-bar/`, `EditorFileTab.tsx` |
| Terminal panes inside a terminal tab | `src/shared/terminal-tab-types.ts`, `components/terminal-pane/` |
| Keybindings | `src/shared/keybindings/definitions-core-{2,3,4}.ts` |

## Model

- **A worktree's workbench is a split tree of groups.** Splits are binary, with a
  direction and a ratio clamped to 0.15–0.85, the same clamp as today's panes. A worktree
  with tabs has at least one group.
- **A group is an ordered set of tabs with one of them shown.** Every group draws its
  own tab row. Terminal, editor, browser, diff and every other view share that row, as
  in Orca.
- **Only a terminal tab splits inside itself.** A terminal tab keeps today's split tree,
  with terminal panes only. Every other view is a tab of exactly one pane.
- **The active group** is the one the user last clicked or focused inside. Its shown tab
  is the active tab, and that tab's focused pane holds keyboard focus.
- **A preview tab** is an editor tab that the next file opened in its group replaces.
  A group has at most one. Its title is in italics.

## Behaviours

### Opening

Where each way of opening something lands:

| Entry | Lands |
|---|---|
| Explorer: single click on a file | As a preview tab in the **target group**. If the file is already open there, that tab shows. |
| Explorer: double click | Same place, as a kept tab. |
| Explorer: "Open to the Side", Shift-click | A kept tab in the group to the right of the active group, which is created when there is none. Orca has no such entry; mnemo keeps its own. |
| ⌘K "Open file…" | Enter opens it to the side and ⌘Enter opens it as a tab in the active group. These are today's keys with "split right" read as "to the side". **default** |
| Search panel: a match | As a preview tab in the target group. **default** |
| ⌘T, "+" menu | A terminal tab in the active group. The "+" in a group's own row uses that group. |
| ⌘⇧B | A browser tab in the active group. |
| Any other `openView(…, 'auto')`: vault, mission, marketplace, tasks, diff, learned, setup, job log, links | A tab of the same view already open in the worktree when the view takes the new props (today's reuse handlers). Otherwise a new tab in the active group. **Never a split.** |
| `openView(…, 'split-row' \| 'split-col')` | As a tab in the group to the right of, or below, the active group. That group is created when there is none. |
| Design Mode | The browser opens to the side of the agent's terminal, so both stay on screen. Today that depends on `auto` splitting a wide pane. **default** |

**The target group for a file** is the active group, unless the active group is showing a
terminal. In that case it is a group that is showing an editor tab, if there is one
(Orca's `resolveEditorOpenTargetGroupId`, without its "recently had an editor" step).
**default**

### Splitting and moving

- **⌘D and ⌘⇧D.**
  - In a terminal tab they split the focused terminal inside the tab, as today.
  - In any other tab they open a new terminal tab in the group to that side, which is created when there is none. Orca binds these keys to terminals only. **default**
- **Dragging a tab.**
  - Onto the outer band of a group's body: that side gets a new group holding the tab. The band is the outer 20% on the left and right, and on the body's top and bottom edges (never over the tab row). While dragging, the overlay shades that half and labels it "New split".
  - Onto another group's tab row: the tab moves there, at the insertion bar.
  - Onto the middle of another group's body: the tab moves to the end of that group.
- **A tab's context menu** has "Move Tab to Split ▸ Right / Left / Down / Up". It shows when the group has more than one tab.
- **Dragging a terminal pane's bar.**
  - Inside its tab it swaps with another pane or splits against its edge, as today.
  - Onto any group's tab row it becomes a tab of its own there, but only when its tab has more than one pane.
  - A pane is never dropped onto a group body's edge (Orca).
- **Group sizes** change by dragging the seam between groups.

### Closing

- **⌘W** closes the focused pane of a terminal tab first. Closing a tab's last pane
  closes the tab. In any other tab, ⌘W closes the tab. **⌘⇧W** closes the tab.
- **A group left with no tab collapses.** Its sibling takes the space and becomes active.
  When the worktree's last tab closes, its empty state shows, as today.
- **Middle-click closes a tab.** The ✕ is always shown on each group's shown tab, and on hover for the rest.

### Preview tabs

- Only editor tabs are ever previews.
- A preview tab is replaced by the next preview opened in its group. It becomes kept
  when its buffer is edited, when the tab or the Explorer row is double-clicked, or when
  the tab is dragged. **default**
- There is no setting to turn previews off. Orca has one (`editorPreviewTabsEnabled`);
  it can come later.

### Keyboard

These keys act on the active group: ⌘⇧[ / ⌘⇧] (previous or next tab) and ⌃1–9 (Alt+1–9
off macOS, the Nth tab), as in Orca. ⌘⌥Arrows still move focus to the nearest pane on
that side, and that pane may now be in another group. There is no shortcut to focus or
split a group; Orca has none either. The native menu keeps its items.

### On screen

- **Every group draws its own tab row at its top, even when it is the only group.** The
  workbench's titlebar row goes: the rows of the top groups are the top of the window
  and its drag region on macOS.
  - The top-left group's row leaves room for the window controls and the left sidebar's
    toggle while the left sidebar is closed.
  - The top-right group's row ends with the `titlebar-right` slot (quick commands, the
    floating terminal's toggle), then the right sidebar's toggle while that sidebar is
    closed. Orca puts quick commands in the focused group's row. mnemo keeps them in one
    place so their mounts do not change. **default**
- **While the workbench is split**, the active group's row carries an accent and the
  other groups dim slightly (Orca: `TabGroupPanel.tsx`, an accent bottom border and
  `opacity-95`).
- **Terminal panes keep their pane bars** (title, branch, pulse, drag grip, close).
- **Nothing remounts a pane view:** moving a tab between groups, splitting a group,
  collapsing one, or switching worktree. A terminal keeps its screen and a browser keeps
  its page, as today's worktree switch already guarantees.
- The strip's menu of tabs that belong to no open worktree stays. A tab brought from it
  joins the active group.

### Saved workspace

`~/.mnemo-desktop/workspace.json` goes to version 3. For each worktree it also holds:

- the group tree with its ratios;
- each group's tab order and shown tab;
- the active group;
- which tabs are previews.

The spec's constraints allow a format change with no migration. Still, the maintainer's
live workspace must survive the upgrade: eight terminals, their Claude sessions, and
their faces. So a version 2 file reads as one group per worktree holding its tabs in
order. A version 2 tab whose tree puts a non-terminal view beside other panes is cut
apart: its terminals stay in the tab, and each other view becomes a tab of its own right
after it.

### Unchanged

- The MCP tool `desktop_list_panes` keeps its output (tab index, focused pane of the
  active tab).
- The left sidebar, the dashboard, the right sidebar and the status bar need no change.
  They read the focused pane through `tabs` and `activeTab`, and keep working.

## Not in this work

Orca has these and they wait:

- pinned tabs and tab colours;
- ⌘⇧T to reopen a closed tab;
- cycling tabs of one type, and ⌃Tab by recency;
- zooming a pane (⌘⇧Enter), and equalising pane sizes;
- empty groups, and "Close split pane";
- quick commands in each group's row;
- the preview setting.

## Delivery

The work cannot be cut much. The store holds the whole model, and the drag protocol spans
the tab rows and the group bodies. So it goes in two waves, and each wave is its own
contract.

1. **Wave 1, `tab-groups-core`** (one piece). This wave covers:
   - the model in the layout store;
   - where `openView` and `split` put things;
   - the saved format;
   - the keyboard actions;
   - every test outside `src/layout` that asserts the old placement.

   Until wave 2 lands, the old strip and workbench still draw the active group's tabs.
   That is usable, and no release is cut between the two waves.
2. **Wave 2, two pieces in parallel,** after wave 1 is on `main`:
   - **`workbench-groups`**: the group layout and tab rows, the titlebar change, tab and
     pane drag, preview italics.
   - **`file-open`**: the Explorer, the editor, search and Design Mode opening things as
     described above.

Contracts: `docs/superpowers/contracts/2026-09-25-tab-groups-core.md` and
`docs/superpowers/contracts/2026-09-25-tab-groups-view.md`.

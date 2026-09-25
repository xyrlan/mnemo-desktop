---
feature: tab-groups-view
created: 2026-09-25
verdict: parallel
---

Wave 2 of the tab groups work. The design is `docs/superpowers/specs/2026-09-25-tab-groups-design.md`;
read it first. **Dispatch this only after wave 1
(`2026-09-25-tab-groups-core.md`, piece `groups-core`) is on `main`.** Both pieces are
written against the layout store API that wave 1 exposes, as it landed:

- `groups`, `groupRoot` and `activeGroup`;
- `worktreeLayout`, `activateTab`, `moveTab`, `detachPane`, `keepTab`, `focusGroup` and
  `setGroupRatio`;
- `openView(…, opts: { preview })`;
- `registerReuse(view, fn, shows)`.

Read wave 1's PR for anything its contract did not pin down. It landed as #267 (`0a7f295`),
and its section "Details the contract left open" covers:

- `tabs` order;
- the no-groups fallback;
- `activeTab === ''` as Home;
- `moveTab` indices;
- `detachPane` ids;
- how "+" reaches a group.

Orca's code is at `122b8c25`. Clone it as the spec says, or look for one under
`~/.claude/jobs/*/tmp/orca`. The maintainer authorized porting it with attribution
(memory `orca-port-authorized`): a `// adapted from stablyai/orca <path>` header, plus
`THIRD_PARTY_NOTICES.md` when a new file is ported.

Two pieces. They share no file. The drag protocol spans the tab rows, the group bodies and
the pane bars, so all of it stays in `workbench-groups`. `file-open` only decides where
things open, through the store.

This contract reaches `main` as its own squash. Before your first push, run
`git fetch && git rebase origin/main` (memory `rebase-a-piece-before-its-first-push`). A
piece that changes what is on screen shows it: see the memories
`see-the-app-through-an-isolated-dev-instance` and `drive-the-preview-harness-interactively`,
and describe what you saw in the PR.

## workbench-groups

The workbench draws the group tree, as the spec's *On screen* and *Splitting and moving*
describe.

- Each group has its own tab row: Orca's `TabGroupSplitLayout` and `TabGroupPanel`, with
  today's `SortableTab`, "+" menu and elsewhere menu inside it.
- The workbench's titlebar row goes. The top-left and top-right groups make room for the
  window controls, the sidebar toggles and the `titlebar-right` slot.
- Group seams resize.
- While split, the active group is marked and the others dim.
- Tab drag within a row and across rows, and onto a body's edge, shows Orca's "New split"
  overlay. A tab's menu has "Move Tab to Split".
- A terminal pane's bar can be dragged onto a tab row to become a tab there.
- Preview tabs are in italics. Double-clicking one keeps it.
- Middle-click closes a tab.

**No pane view remounts:** not when a tab moves between groups, not when a group splits or
collapses, and not on a worktree switch. Today's `Workbench` keeps every tab of every
worktree mounted and only toggles which one shows, for this reason. A test must prove a
terminal's view survives a tab move across groups.

The preview scenarios `workbench-tabs`, `shell` and `quick-commands` show the old
titlebar. Update them, and add one for a split workbench: a terminal group beside an
editor group holding a preview tab.

- **files:** src/shell/, src/tabs/, src/chrome/, src/layout/SplitView.tsx, src/tab-group/, tools/preview/scenarios/workbench-tabs.mjs, tools/preview/scenarios/shell.mjs, tools/preview/scenarios/quick-commands.mjs, tools/preview/scenarios/tab-groups.mjs, THIRD_PARTY_NOTICES.md
- **exposes:** nothing
- **consumes:** nothing
- **model:** opus
- **effort:** xhigh

## file-open

Files, search matches and Design Mode open where the spec's *Opening* table says.

- **Explorer:**
  - single click opens a preview in the target group;
  - double click keeps the tab;
  - "Open to the Side" and Shift-click open to the side.
- **Editor:**
  - registers `shows`, so the same file is never opened twice in a group;
  - keeps its tab the moment its buffer is edited;
  - in ⌘K "Open file…", Enter opens to the side and ⌘Enter opens a tab in the active group.
- **Search:** a match opens as a preview.
- **Design Mode:** opens its browser to the side of the agent's terminal.

Since wave 1, the `design-mode` preview scenario restores a terminal beside a browser from
a version 2 layout, and its shot shows the browser as a tab of its own. Redo it with Design
Mode opening to the side. `DesignCard.test.tsx` drives `runDesignMode` with a fake layout.

This piece never touches the store: every placement goes through `openView`, `keepTab`
and the reuse registry that wave 1 exposes. If one of them cannot express what the spec
asks for, stop and say so rather than widen the boundary.

- **files:** src/explorer/, src/editor/, src/search/open.ts, src/search/open.test.ts, src/browser/design-view.tsx, src/browser/design-view.test.ts, src/browser/DesignCard.test.tsx, tools/preview/scenarios/explorer.mjs, tools/preview/scenarios/editor.mjs, tools/preview/scenarios/design-mode.mjs
- **exposes:** nothing
- **consumes:** nothing
- **model:** sonnet
- **effort:** high

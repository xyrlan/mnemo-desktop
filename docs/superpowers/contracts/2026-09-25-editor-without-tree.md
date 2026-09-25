---
feature: editor-without-tree
created: 2026-09-25
verdict: parallel
---

The editor pane keeps a file tree of its own inside it, from before the right sidebar
had an Explorer (spec `docs/superpowers/specs/2026-09-24-orca-redesign-design.md`,
decision 4). A file opened from the right sidebar's Explorer shows up in a pane with
a second tree on its left, because `open` starts every session with `treeOpen: true`
(`src/editor/sessions.ts:50`). On 2026-09-25 the maintainer looked at a screenshot of
this and said it makes no sense: the right sidebar's Explorer is the only one they
want. Orca draws none either. Its editor pane is a header with the file's path, then
the buffer (`src/renderer/src/components/editor/EditorPanelShell.tsx` at `122b8c25`).

One piece, and a single contract so it dispatches like every other wave. The contract
reaches `main` as its own squash. Before your first push, run
`git fetch && git rebase origin/main` (memory `rebase-a-piece-before-its-first-push`).

## editor-drops-its-tree

The editor pane has no file tree. What goes with the tree:

- the tree component, and its ⌘-click split;
- the ☰ toggle in the pane's header;
- the `editor.toggle-tree` action, and its ⌘K entry;
- the per-session state that exists only for the tree;
- the tree's styles.

The header keeps the path and the unsaved-changes dot. Everything else the pane does
stays the same:

- opening a file from the Explorer, from ⌘K "Open file…", and from a `path` prop;
- save;
- the unsaved-changes banner when a new file is opened over edits;
- reuse of a clean editor pane.

A session's `root` still decides how the header shortens the path and where the
"Open file…" prompt starts, and relative paths still resolve from it. Only the text
that calls it the tree's root changes. The Explorer (`src/explorer/`) already opens
files through `openView` and does not change.

The preview scenario `tools/preview/scenarios/editor.mjs` shows the pane with its tree
open and opens `src/editor/Tree.tsx`. Make it show the pane as it is now, and let the
PR describe the shot. `docs/contracts/panes.md` and `src-tauri/fixtures/contract.md`
name `editor.toggle-tree` too. They stay as they are: the first is a closed round's
contract, and the second is a parser fixture.

- **files:** src/editor/, tools/preview/scenarios/editor.mjs
- **model:** sonnet
- **effort:** medium

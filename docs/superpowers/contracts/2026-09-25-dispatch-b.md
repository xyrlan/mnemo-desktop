---
feature: dispatch-b
created: 2026-09-25
verdict: parallel
---

Wave B of the Dispatch tab. The design is `docs/superpowers/specs/2026-09-25-dispatch-tab-design.md`;
read it first.

**Dispatch this only after all of these are on `main`:**

- tab groups wave 2 (`2026-09-25-tab-groups-view.md`), because the tab opens "to the side",
  which needs groups;
- Dispatch wave A (`2026-09-25-dispatch-a.md`), which gives this wave:
  - missions grouped by wave;
  - `childAgent(child)`, the answers for the three kinds of block;
  - `ChildDiff({ worktree, base })`.

Re-read the boundaries below against what those waves actually landed before dispatching.

This contract reaches `main` as its own squash. Before your first push, run
`git fetch && git rebase origin/main` (memory `rebase-a-piece-before-its-first-push`). Both
pieces change what is on screen. Show it (memories `see-the-app-through-an-isolated-dev-instance`,
`drive-the-preview-harness-interactively`) and describe what you saw in the PR.

## dispatch-tab

The Dispatch tab, as the spec's decisions 3 to 6 describe:

- **Scope:** one tab per parent workspace. One section per wave, newest first, finished waves
  folded, plus an "Issues" section.
- **Rows:** the children's rows, with those that need you on top and their answer card open in
  the row.
- **Detail:** the selected child, with Conversation | Diff | Checks, and Take over, Stop and
  Open workspace.
- **Title:** it carries the alert.

**Opening.** The tab opens by itself, to the right of the parent's terminal with focus left
where it was, when a parent dispatches a wave: new children whose parent session runs in a
workspace. It opens once per wave. After the user closes it, only `openDispatch` brings it back.

**Parent.** `parentWorktree` is the spec's parent workspace: the worktree holding the cwd of
the child's `parent_session`, else the repo's main checkout.

**Registration.** The tab is a pane view registered from `src/dispatch/view.tsx`. `App.tsx`
already loads every `src/*/view.tsx`.

- **files:** src/dispatch/, tools/preview/scenarios/dispatch-tab.mjs
- **exposes:** `openDispatch(parent: string, child?: string): void`, `parentWorktree(childId: string): string | null`, `type WaveLine = { feature: string; needsYou: number; working: number; done: number }`, `useWaveLines(parent: string): WaveLine[]`
- **consumes:** nothing
- **model:** opus
- **effort:** xhigh

## child-routing

Every way into a child leads to its parent's Dispatch tab, as the spec's decisions 1, 2 and 7 say.

**Left sidebar:**

- Dispatched worktrees leave the list. The card knows them by `kind: 'dispatched'`.
- The parent's card shows one line per wave, from `useWaveLines`. A click on it opens the tab
  on that wave.
- "New workspace" worktrees stay cards.

**Clicks.** A dispatched child's dashboard card and its notification call
`openDispatch(parentWorktree(id), id)`. Today they only switch to the child's empty worktree.

**Building before `dispatch-tab` lands.** `dispatch-tab` is built at the same time. Reach
its three signatures in a way that still builds while `src/dispatch/` does not exist yet, and
wires itself once it merges (memory `glob-import-a-sibling-piece-not-yet-landed`). Test
against stand-ins.

- **files:** src/sidebar/, src/dashboard/store.ts, src/dashboard/drawer.test.tsx, src/dashboard/view.test.tsx, src/notify/view.tsx, src/notify/notifier.ts, src/notify/notifier.test.ts, tools/preview/scenarios/left-sidebar.mjs
- **exposes:** nothing
- **consumes:** `openDispatch(parent: string, child?: string): void` from dispatch-tab, `parentWorktree(childId: string): string | null` from dispatch-tab, `useWaveLines(parent: string): WaveLine[]` from dispatch-tab
- **model:** opus
- **effort:** high

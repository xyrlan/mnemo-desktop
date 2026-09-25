# The Dispatch tab — design

Decided 2026-09-25 in a grilling session with the maintainer. Every decision below was put to
them and answered. The technical defaults at the end were shown to them before this was written.

## Why

A `mnemo dispatch` child shows in the left sidebar as a worktree card of its own. Clicking it
switches to its worktree, whose layout is empty, so the workbench shows "New terminal / Launch
agent". The dashboard card and the notification of a child that needs you do the same
(`src/sidebar/actions.ts`, `src/dashboard/store.ts`, `src/notify/view.tsx`: "a dispatched child
shows its worktree only").

On 2026-09-25 two children in clearframe were waiting on the maintainer. Nothing they clicked led
to the question.

The screen that answers a child already exists: the mission pane (`src/mission/view.tsx`), with
the child's conversation, its reply box and its approval card. Only ⌘K reaches it ("Open
mission: …", "Reply to the first blocked child").

Two more gaps showed up:

- **Children are not grouped by wave.** `contracts_in` (`src-tauri/src/mission.rs`) reads only
  `docs/contracts/`. Every recent wave's contract is in `docs/superpowers/contracts/`, so those
  children fall into `RepoGroup.children` with no mission.
- **One kind of block cannot be answered in the app.** A child parked on Claude Code's
  multiple-choice dialog (AskUserQuestion, `waiting_for: "input needed"`) gets a text composer
  that cannot answer it. "As me" refuses, because `waitingFor` is set. Only a manual take over
  works.

The maintainer did not want the old cockpit back ("não sinto falta de nada da tela antiga").
This is a new design on the logic that works: the mission pane, and the snapshot's missions.

## Decisions

### 1. A child belongs to its parent's workspace

The parent is the session that dispatched it. Its worktree is only where its files live.

- Every click on a child leads to the parent's workspace, with the Dispatch tab open and that
  child selected: its sidebar line, its dashboard card, its notification.
- The child's own workspace stays reachable through "Open workspace" in its row, and through ⌘J.

**Why:** answering a child needs the wave's context: its siblings, and the contract. Following,
reviewing and landing are things done to the whole wave. The maintainer dispatches from one
session and stays in it, and tab groups (`2026-09-25-tab-groups-design.md`) put the wave beside
that session's terminal.

**Cost:** the right sidebar (Explorer, Source Control, Checks) follows the parent's worktree, not
the child's. So the child's diff and CI come into the tab (decision 5).

### 2. The left sidebar

- **Children leave the worktree list.**
- **The parent's card gains one line per wave**: `▸ tab-groups-core · 1 working`, or
  `⚠ cavebot-lure-saida · 2 need you`. A click on the line opens the Dispatch tab on that wave.
- **Workspaces made with "New workspace"** (an interactive agent, Orca's way) are not children.
  They stay cards of their own.

### 3. One Dispatch tab per parent workspace

- It holds one section per wave, newest first. A finished wave folds.
- A section "Issues" holds the children that belong to no contract.
- The tab's title carries the alert, for example "Dispatch · 2 need you".
- It is saved in `workspace.json` like any tab.

### 4. How it opens

- **When the parent dispatches**, the tab opens in the group to the right of the parent's
  terminal, and focus stays in the terminal.
- **After you close it**, only a click brings it back: the sidebar line, the dashboard, a
  notification, or ⌘K.

### 5. List and detail in one tab

- **Left: the children's rows.** Each row shows its state, piece, what it is doing, PR and CI.
  A child that needs you rises to the top, with its answer card open in the row.
- **Right: the selected child.**
  - Its tabs are Conversation | Diff | Checks.
  - Its header has Take over, Stop and Open workspace.
  - **Conversation** is the mission pane's conversation.
  - **Diff** is the child's branch against its base: its commits and its uncommitted work.
    Notes written on the diff go to the child, as they already do in the diff pane.
  - **Checks** is its PR's CI.

### 6. Answering

Every kind of block gets an answer in the app:

| Block | Answer |
|---|---|
| Permission prompt | Approve / Deny, typed through `claude attach` (`answerPrompt`, exists) |
| Question after the child ended its turn | The composer. **"As me" is the default**: it is the maintainer answering, and a question like "may I add a crate?" needs consent. "Message", the peer route that cannot approve, stays as the second choice. |
| Multiple-choice dialog (AskUserQuestion) | A question card with the dialog's options, answered through `claude attach`. This is the card the terminal's conversation face already shows for interactive sessions (`src/conversation/Foot.tsx`, `QuestionCard`). |

### 7. Alerts

The orange badge, the dashboard count and the notification stay as they are. Only their click
changes (decision 1). Nothing opens by itself when a child blocks: a tab that opens under the
maintainer's work competes with it, which the redesign forbids.

### 8. Not in this work

- **Merge and land buttons.** The tab shows each PR, its CI, and whether the wave can land (the
  snapshot's `landable`). The parent session merges, after green CI and a read diff.
- **Cleaning up merged children.** The maintainer is solving that in mnemo itself.

## Technical defaults

- **A wave** is the `feature` of the branch `feat/<feature>/<piece>`, with its contract when one
  is found in `docs/contracts/`, `docs/superpowers/contracts/` or `contracts/`.
- **The parent workspace** is the worktree holding the cwd of the child's `parent_session`. When
  that session is gone, it is the repo's main checkout. A clearframe child goes to a clearframe
  workspace.
- **A wave leaves the tab** when all its pieces are merged or closed and mnemo prunes them. Until
  then, a finished wave stays folded.

## Delivery

**Wave A** starts now. It shares no file with the tab groups waves (`src/layout`, `src/tabs`,
`src/chrome`, `src/shell`, `src/explorer`, `src/editor`), so it runs beside them. Three pieces
in parallel:

- **`wave-grouping`**: the snapshot groups children by wave.
- **`child-answers`**: the mission pane answers all three kinds of block.
- **`child-diff`**: a child's branch against its base.

**Wave B** starts after tab groups wave 2 is on `main`, because decision 4 needs groups. Two
pieces:

- **`dispatch-tab`**: the tab.
- **`child-routing`**: the sidebar lines, and the clicks from the sidebar, dashboard and
  notifications.

Contracts: `docs/superpowers/contracts/2026-09-25-dispatch-a.md` and `2026-09-25-dispatch-b.md`.

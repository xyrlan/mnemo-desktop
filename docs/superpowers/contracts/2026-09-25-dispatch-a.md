---
feature: dispatch-a
created: 2026-09-25
verdict: parallel
---

Wave A of the Dispatch tab. The design is `docs/superpowers/specs/2026-09-25-dispatch-tab-design.md`;
read it first. This wave builds what the tab will stand on, and each piece is useful on its own
before the tab exists. Wave B (`2026-09-25-dispatch-b.md`) draws the tab after the tab groups
work lands.

These pieces run while the tab groups waves are in flight
(`2026-09-25-tab-groups-core.md`, then `-view.md`). They share no file with them. Do not
touch `src/layout/`, `src/tabs/`, `src/chrome/`, `src/shell/`, `src/explorer/` or
`src/editor/`: they belong to those waves.

This contract reaches `main` as its own squash. Before your first push, run
`git fetch && git rebase origin/main` (memory `rebase-a-piece-before-its-first-push`). A piece
that changes what is on screen shows it (memory `see-the-app-through-an-isolated-dev-instance`)
and describes what it saw in its PR.

## wave-grouping

The snapshot groups children by wave, as the spec's *Technical defaults* say.

Today `contracts_in` reads only `<root>/docs/contracts/`. Every recent wave's contract is in
`docs/superpowers/contracts/`, so those children land in `RepoGroup.children` with no mission.

What this piece delivers:

- A child whose branch is `feat/<feature>/<piece>` belongs to the mission of `<feature>`,
  whether or not its contract is found.
- A contract is found in `docs/contracts/`, `docs/superpowers/contracts/` or `contracts/`.
  When none is, `contract_path` is empty and the pieces are the children seen on that
  feature's branches.
- `landable` keeps its meaning.
- A child on any other branch stays in `children`.

The shape crossing to the front does not change, so `src/mission/types.ts` needs nothing.

- **files:** src-tauri/src/mission.rs
- **exposes:** `pub struct Mission { pub feature: String, pub contract_path: String, pub pieces: Vec<Piece>, pub landable: bool }`
- **consumes:** nothing
- **model:** sonnet
- **effort:** medium

## child-answers

The mission pane answers every kind of block, as the spec's *Answering* table says.

- **Permission:** Approve / Deny, as today (`answerPrompt`).
- **A question after the child ended its turn:** the composer. **"As me" is the default route**
  and "Message" is the second choice.
- **The multiple-choice dialog (AskUserQuestion, `waiting_for: "input needed"`):** a question
  card with the dialog's options, answered through `claude attach`, and "Other" in words when
  the dialog takes it. Today the pane shows a composer that cannot answer it.

The terminal's conversation face already draws these cards for interactive sessions. Its
`Foot` (`src/conversation/Foot.tsx`) shows `ApprovalCard` and `QuestionCard` when
`ConversationView` is given a `ChatAgent` and a status. The mission pane passes neither. Wave
B's Dispatch tab gives its detail the same answers through `childAgent`, so deliver it as a
function the tab can call.

Keystrokes into a live Claude Code TUI need care. Prove every route in a real pty against the
current Claude Code, following the memories `claude-tui-keys-need-gaps` and
`probe-claude-agents-states-from-a-job`. Put what you measured in the PR. A child that is
dispatched and has no bash mode must not offer `!` (wave H).

- **files:** src/mission/, src/cockpit/approve.ts, src/cockpit/approve.test.ts, src/conversation/ConversationView.tsx, src/conversation/view.test.tsx, tools/preview/scenarios/mission-session.mjs
- **exposes:** `childAgent(child: ChildSession): ChatAgent`
- **consumes:** nothing
- **model:** opus
- **effort:** high

## child-diff

The diff of a child's branch against its base, as the spec's decision 5 says.

- It covers everything the child did: its commits since the base, plus its uncommitted work.
- Notes written on it go to the child, as the diff pane's notes already go to a worktree's
  agent (`src/diff/deliver.ts`).
- The base is where the child's branch was cut from: the repo's default branch, at its merge
  base.

Today the diff pane (`src/diff/`, `worktree_diff.rs`) shows uncommitted changes against `HEAD`
only. That is empty for a child, which commits its work. Deliver a component that Wave B's
detail can embed for any worktree.

`src-tauri/src/lib.rs` is not yours. The diff's commands are already registered there
(`worktree_diff_files`, `worktree_diff_file`), and they may take new arguments. If the work
truly needs a new command, stop and say so.

- **files:** src-tauri/src/worktree_diff.rs, src/diff/
- **exposes:** `ChildDiff({ worktree, base }: { worktree: string; base?: string }): JSX.Element`
- **consumes:** nothing
- **model:** sonnet
- **effort:** high

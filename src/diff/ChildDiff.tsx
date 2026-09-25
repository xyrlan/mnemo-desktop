import { DiffView } from './DiffPane'
import { diffStore } from './view'

/** A child's branch against where it was cut from: its commits and its uncommitted work, file by
 *  file, with notes that go to the child as the diff pane's notes go to a worktree's agent.
 *  `base` is any ref; the merge base with it is what the files are compared to. Left out, it is
 *  the repo's default branch. */
export function ChildDiff({ worktree, base }: { worktree: string; base?: string }) {
  return <DiffView store={diffStore} worktree={worktree} base={base ?? ''} />
}

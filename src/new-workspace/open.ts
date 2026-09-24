import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'

/** What the composer was opened for: a project to preselect, and the issue it starts from. */
export type ComposerRequest = { repo?: string; issue?: { number: number; title: string } }

export type ComposerState = {
  /** The open composer's request; null while it is closed. */
  request: ComposerRequest | null
  /** Bumped by every open, so a second open while it is shown starts the form over. */
  seq: number
}

/** Whether the new-workspace composer is open, and for what. Kept free of Tauri so any piece
 *  (Tasks, the sidebar) can import `openNewWorkspace` into its own tests. */
export const composerStore = createStore<ComposerState>(() => ({ request: null, seq: 0 }))
export const useComposer = <T,>(sel: (s: ComposerState) => T): T => useStore(composerStore, sel)

/** Opens the new-workspace composer (Mod+N, `workspace.new`): `repo` preselects that project,
 *  `issue` names the workspace after it, hands it to `claude` as the first prompt, and offers
 *  Dispatch beside Create. */
export function openNewWorkspace(opts?: { repo?: string; issue?: { number: number; title: string } }): void {
  const request: ComposerRequest = {}
  if (opts?.repo) request.repo = opts.repo
  if (opts?.issue) request.issue = { number: opts.issue.number, title: opts.issue.title }
  composerStore.setState((s) => ({ request, seq: s.seq + 1 }))
}

export function closeNewWorkspace(): void {
  composerStore.setState({ request: null })
}

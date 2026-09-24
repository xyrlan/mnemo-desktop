import { run } from '../actions/registry'

export type NewWorkspaceOpts = { repo?: string; issue?: { number: number; title: string } }
type NewWorkspaceModule = { openNewWorkspace(opts?: NewWorkspaceOpts): void }

// `openNewWorkspace` belongs to the new-workspace piece of wave B, written in parallel with this
// one. A glob, not an import, so Tasks builds before that file lands and picks it up once it
// does, with no edit here: an empty match is `{}`.
const found = import.meta.glob<NewWorkspaceModule>('../new-workspace/open.ts', { eager: true })

/** The new-workspace composer, prefilled with the repo and the issue. Until the composer exists,
 *  `workspace.new` — which is nothing until then either. */
export function openNewWorkspace(opts?: NewWorkspaceOpts): void {
  const m = Object.values(found)[0]
  if (m) m.openNewWorkspace(opts)
  else run('workspace.new')
}

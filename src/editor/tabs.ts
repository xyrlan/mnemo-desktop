import type { Sessions } from './sessions'
import type { Store } from '../layout/store'
import { leaves } from '../layout/tree'

type Layout = Pick<Store, 'getState'>

/** The file pane `id` shows: what its session opened, else what it was asked to (not mounted yet). */
export function paneFile(app: Layout, sessions: Pick<Sessions, 'getState'>, id: number): string | undefined {
  const path = sessions.getState().sessions[id]?.path ?? app.getState().panes[id]?.props?.path
  return typeof path === 'string' ? path : undefined
}

/** `registerReuse`'s `shows`: the pane already shows the file asked for, so it is never opened twice. */
export function editorShows(app: Layout, sessions: Sessions) {
  return (id: number, props: Record<string, unknown>) => typeof props.path === 'string' && paneFile(app, sessions, id) === props.path
}

/** A preview tab whose buffer is edited becomes a kept tab (the next file must not replace it). */
export function keepEditedTabs(app: Layout, sessions: Sessions): () => void {
  return sessions.subscribe((s, prev) => {
    for (const [key, session] of Object.entries(s.sessions)) {
      if (!session.dirty || prev.sessions[Number(key)]?.dirty) continue
      const id = Number(key)
      const tab = app.getState().tabs.find((t) => leaves(t.root).includes(id))
      if (tab?.preview) app.getState().keepTab(tab.id)
    }
  })
}

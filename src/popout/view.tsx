/** Session popups (#421). No pane view: App imports every `src/*\/view.tsx`, and this import is
 *  where they mount in the shell's overlay slot and offer their ⌘K entries, one per terminal pane
 *  and one per live background child in no pane. The sessions are the session host's
 *  (`src/session/app-host.ts`). */
import type React from 'react'
import { claimAction, registerProvider } from '../actions/registry'
import { store as layout } from '../layout/app-store'
import { mountInSlot } from '../shell/slots'
import { sessionHost } from '../session/app-host'
import TerminalPane from '../terminal/view'
import { missionStore } from '../mission/app-store'
import { allChildren, childWord } from '../mission/types'
import { basename } from '../path/path'
import { Popouts } from './Popouts'
import { createPopoutStore } from './store'

export const popouts = createPopoutStore({
  host: sessionHost,
  viewport: () => ({ width: window.innerWidth, height: window.innerHeight }),
})

// ⌘W in a popup closes the popup, not the focused pane under it.
const unclaim = claimAction((id) => {
  if (id !== 'pane.close') return false
  const key = document.activeElement?.closest<HTMLElement>('[data-popout]')?.dataset.popout
  if (!key || !popouts.getState().popups.some((p) => p.key === key)) return false
  void popouts.getState().close(key)
  return true
})

registerProvider(() => {
  const { panes } = layout.getState()
  const terminals = Object.values(panes).filter((p) => p.view === 'terminal' && p.id > 0 && p.exitCode === undefined)
  const inPane = new Set(terminals.flatMap((p) => (p.sessionId ? [p.sessionId] : [])))
  const children = allChildren(missionStore.getState().snapshot).filter((c) => c.live && !inPane.has(c.id) && !(c.session_id && inPane.has(c.session_id)))
  return [
    ...terminals.map((p) => {
      const title = p.title || (p.cwd ? basename(p.cwd) : `terminal ${p.id}`)
      return { id: `popout.pane.${p.id}`, title: `Pop out: ${title}`, run: () => popouts.getState().openPane(p.id, title) }
    }),
    ...children.map((c) => {
      const title = c.name ?? c.intent ?? c.id
      return { id: `popout.child.${c.id}`, title: `Pop out child: ${title} (${childWord(c)})`, run: () => popouts.getState().openChild(c, title) }
    }),
  ]
})

function LivePopouts(): React.JSX.Element {
  return <Popouts store={popouts} host={sessionHost} terminal={TerminalPane} />
}

const unmount = mountInSlot('overlay', LivePopouts)
import.meta.hot?.dispose(() => {
  unmount()
  unclaim()
})

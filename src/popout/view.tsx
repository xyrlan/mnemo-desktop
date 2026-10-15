/** Session popups (#421). No pane view: App imports every `src/*\/view.tsx`, and this import is
 *  where they mount in the shell's overlay slot and offer their ⌘K entries, one per terminal pane
 *  and one per live background child in no pane. */
import type React from 'react'
import { registerProvider } from '../actions/registry'
import { store as layout } from '../layout/app-store'
import { tauriPty } from '../pty/client'
import { paneShell } from '../pty/typed'
import { mountInSlot } from '../shell/slots'
import { providedSessions, provideSessions } from '../terminal/sessions'
// Imported first: the terminal view offers the core's terminals as it loads, and the attach PTYs
// are then hidden from what it offers.
import TerminalPane from '../terminal/view'
import { hideFrom } from '../floating/store'
import { missionStore } from '../mission/app-store'
import { allChildren, childWord } from '../mission/types'
import { basename } from '../path/path'
import { Popouts } from './Popouts'
import { createPopoutStore, endLeftovers } from './store'

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

const deps = {
  pty: tauriPty,
  shell: () => paneShell(),
  sinkOf: (id: number) => layout.getState().sinks[id],
  watchSinks: (cb: () => void) =>
    layout.subscribe((s, prev) => {
      if (s.sinks !== prev.sinks) cb()
    }),
  forgetSink: (id: number) =>
    layout.setState((s) => {
      if (!(id in s.sinks)) return {}
      const sinks = { ...s.sinks }
      delete sinks[id]
      return { sinks }
    }),
  storage: storage(),
  viewport: () => ({ width: window.innerWidth, height: window.innerHeight }),
}

export const popouts = createPopoutStore(deps)

// The attaches a reloaded page left are ended; until then, and for the ones open now, the
// workspace restore must not adopt them as tabs.
const leftovers = endLeftovers(deps)
const sessions = providedSessions()
if (sessions) provideSessions(hideFrom(sessions, () => [...leftovers, ...popouts.getState().held()]))

// A pane closed under its popup takes the popup with it.
const unwatch = layout.subscribe((s, prev) => {
  if (s.panes === prev.panes) return
  for (const p of popouts.getState().popups) if (p.kind === 'pane' && !s.panes[p.pty!]) popouts.getState().paneGone(p.pty!)
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
  return <Popouts store={popouts} terminal={TerminalPane} />
}

const unmount = mountInSlot('overlay', LivePopouts)
import.meta.hot?.dispose(() => {
  unmount()
  unwatch()
})

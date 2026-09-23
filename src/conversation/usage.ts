import { store } from '../layout/app-store'
import type { Face, Store } from '../layout/store'
import { tauriConversation } from './client'

/** The one-week measurement of spec Q8: is the conversation face on screen enough to pay for a
 *  composer? Rows go to `~/.mnemo-desktop/usage.jsonl` (`usage_log` stamps `ts`);
 *  `scripts/usage-summary.mjs` reads them back. Nothing leaves the machine. */

/** How often the focused pane's face is sampled while the window has focus. */
export const BEAT_MS = 60_000

export type UsageDeps = {
  layout: Store
  log(row: Record<string, unknown>): void
  hasFocus(): boolean
  every(ms: number, fn: () => void): () => void
}

/** Logs `{event: 'face', face, session}` on every face change of a terminal pane, and
 *  `{event: 'beat', face}` every `BEAT_MS` while the window has focus and the focused pane is a
 *  terminal. A pane that first shows up already on its conversation face (a restored workspace)
 *  counts as a change too: the store cannot tell a restore from a toggle. Returns a stop. */
export function startUsage(d: UsageDeps): () => void {
  const faceOf = (s: ReturnType<Store['getState']>) => {
    const m = new Map<number, Face>()
    for (const p of Object.values(s.panes)) if (p.view === 'terminal') m.set(p.id, p.face ?? 'terminal')
    return m
  }
  let faces = faceOf(d.layout.getState())
  const unsubscribe = d.layout.subscribe((s) => {
    const next = faceOf(s)
    for (const [id, face] of next) {
      if (face === (faces.get(id) ?? 'terminal')) continue
      d.log({ event: 'face', face, session: !!s.panes[id].sessionId })
    }
    faces = next
  })
  const stopBeat = d.every(BEAT_MS, () => {
    if (!d.hasFocus()) return
    const s = d.layout.getState()
    const tab = s.tabs.find((t) => t.id === s.activeTab)
    const pane = tab ? s.panes[tab.focused] : undefined
    if (pane?.view === 'terminal') d.log({ event: 'beat', face: pane.face ?? 'terminal' })
  })
  return () => {
    unsubscribe()
    stopBeat()
  }
}

// Started once, when the face module first loads (never from App.tsx).
const stop = startUsage({
  layout: store,
  log: (row) => {
    try {
      void tauriConversation.logUsage(row).catch(() => {})
    } catch {
      // No Tauri core (a test): the row is lost, which is all a counter can lose.
    }
  },
  hasFocus: () => document.hasFocus(),
  every: (ms, fn) => {
    const t = setInterval(fn, ms)
    return () => clearInterval(t)
  },
})
import.meta.hot?.dispose(stop)

import { createStore } from 'zustand/vanilla'

/** The waves this app has seen, by `waveKey` (a child of no wave by `issueKey`), with when it
 *  first saw each: epoch ms, or 0 for one that was there before anything was watching. It is
 *  what makes the tab open once per wave (a wave seen is never new again, across reloads), and
 *  what orders the tab's sections newest first. Kept in the browser's storage: losing it only
 *  forgets the order of old waves, and nothing opens for a wave already there. */

export const STORAGE_KEY = 'mnemo.dispatch.seen'
/** Oldest forgotten first past this many: a wave a thousand dispatches ago is long gone. */
export const MAX_SEEN = 1000

export type Seen = Record<string, number>

function read(): Seen | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return null
    const v = JSON.parse(raw) as unknown
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter((e): e is [string, number] => typeof e[1] === 'number'))
  } catch {
    return null
  }
}

function write(seen: Seen) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seen))
  } catch {
    // Storage refused (private mode, quota): the waves are still known for this run.
  }
}

export const seenStore = createStore<{ seen: Seen }>(() => ({ seen: read() ?? {} }))

export const bornOf = (key: string): number | undefined => seenStore.getState().seen[key] || undefined

/** Records `keys` as seen `at`; those already seen keep when they were first seen. */
export function markSeen(keys: readonly string[], at: number) {
  const { seen } = seenStore.getState()
  const fresh = keys.filter((k) => !(k in seen))
  if (!fresh.length) return
  let next: Seen = { ...seen }
  for (const k of fresh) next[k] = at
  const all = Object.entries(next)
  if (all.length > MAX_SEEN) next = Object.fromEntries(all.sort((a, b) => b[1] - a[1]).slice(0, MAX_SEEN))
  seenStore.setState({ seen: next })
  write(next)
}

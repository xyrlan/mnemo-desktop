import { useEffect, useState } from 'react'
import { pulseStore } from './app-store'
import type { Pulse, PulseStore } from './store'
import { openRule } from './open'

/** How long an enforcement toast stays. */
export const TOAST_MS = 6000
const MAX_TOASTS = 3

/** Toasts for `enforce` pulses only: mnemo blocked a command. The rest is the pane bar's. */
export default function Toasts({ store = pulseStore }: { store?: PulseStore }) {
  const [shown, setShown] = useState<Pulse[]>([])

  useEffect(() => {
    const timers = new Set<ReturnType<typeof setTimeout>>()
    let seen = store.getState().log.at(-1)?.id ?? 0
    const unsubscribe = store.subscribe((s) => {
      const fresh = s.log.filter((p) => p.id > seen && p.event.kind === 'enforce')
      seen = s.log.at(-1)?.id ?? seen
      if (fresh.length === 0) return
      setShown((cur) => [...cur, ...fresh].slice(-MAX_TOASTS))
      const t = setTimeout(() => {
        timers.delete(t)
        setShown((cur) => cur.filter((p) => !fresh.includes(p)))
      }, TOAST_MS)
      timers.add(t)
    })
    return () => {
      unsubscribe()
      timers.forEach(clearTimeout)
    }
  }, [store])

  if (shown.length === 0) return null
  return (
    <div className="pulse-toasts" role="status" aria-live="polite">
      {shown.map(({ id, event: e }) => (
        <button
          key={id}
          className="pulse-toast"
          title={e.slugs[0] ? `Open ${e.slugs[0]} in the vault` : undefined}
          onClick={() => {
            setShown((cur) => cur.filter((p) => p.id !== id))
            if (e.slugs[0]) void openRule(e.slugs[0], e.agent || e.project)
          }}
        >
          <span className="pulse-toast-head">⛔ mnemo blocked {e.tool ?? 'a command'}</span>
          <span className="pulse-toast-body">
            {e.slugs.join(', ')}
            {e.project && <span className="pulse-toast-where"> · {e.project}</span>}
          </span>
        </button>
      ))}
    </div>
  )
}

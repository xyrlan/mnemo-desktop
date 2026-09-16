/** mnemo acting, over the pane whose session caused it. One scene at a time: an event
 *  arriving mid-play *replaces* what is showing, because a queue would make the overlay
 *  lag behind what mnemo is actually doing, and a stale scene is worse than a skipped one. */
import { useEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { pulseStore } from './app-store'
import type { Pulse, PulseStore } from './store'
import type { PaneId } from '../layout/tree'
import { caption, SCENES } from '../avatar/scenes'
import type { PulseKind } from './types'
import Avatar from '../avatar/Avatar'
import './overlay.css'

/** How long one scene is on screen, in + hold + out. */
export const OVERLAY_MS = 2500

/** `pane`: the pane it sits over; it plays the pulses the store routed there. */
export default function Overlay({ pane, store = pulseStore }: { pane: PaneId; store?: PulseStore }) {
  const latest = useStore(store, (s) => s.latestFor(pane))
  const [live, setLive] = useState<Pulse>()

  /** When a kind sets `minIntervalMs`, the last time it played here. */
  const played = useRef<Partial<Record<PulseKind, number>>>({})

  useEffect(() => {
    if (!latest) return
    const gap = SCENES[latest.event.kind].minIntervalMs ?? 0
    const last = played.current[latest.event.kind] ?? 0
    if (gap > 0 && latest.received - last < gap) return
    played.current[latest.event.kind] = latest.received
    setLive(latest)
    const timer = setTimeout(() => setLive(undefined), OVERLAY_MS)
    return () => clearTimeout(timer)
  }, [latest])

  if (!live) return null
  return (
    <div className="pv-overlay" role="status" aria-live="polite">
      <div className="pv-halo">
        <Avatar scene={live.event.kind} size={88} />
      </div>
      <div className="pv-caption">{caption(live.event)}</div>
    </div>
  )
}

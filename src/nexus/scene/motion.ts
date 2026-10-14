import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { Packet } from '../types'

/** The robots that arrived since the scene first drew (spec Q18: a robot that appears warps in from
 *  its nexus). The ones already there when the drawer opens are not arrivals: opening the view
 *  must not stage a burst of dispatches that happened long ago. With reduced motion nothing warps. */
export function useArrivals(ids: string[], reducedMotion: boolean): { arriving: ReadonlySet<string>; arrived(id: string): void } {
  const seen = useRef<Set<string> | null>(null)
  const [arriving, setArriving] = useState<ReadonlySet<string>>(() => new Set())
  const key = ids.join('\n')
  useLayoutEffect(() => {
    const first = seen.current === null
    const s = (seen.current ??= new Set())
    const fresh = ids.filter((id) => !s.has(id))
    for (const id of fresh) s.add(id)
    if (!first && !reducedMotion && fresh.length) setArriving((prev) => new Set([...prev, ...fresh]))
    // `key` stands for `ids`: the same robots in a new array are not an arrival.
  }, [key])
  const arrived = useCallback(
    (id: string) =>
      setArriving((prev) => {
        if (!prev.has(id)) return prev
        const next = new Set(prev)
        next.delete(id)
        return next
      }),
    [],
  )
  return { arriving, arrived }
}

/** A packet older than this when the scene first sees it is not played: it happened before anyone
 *  looked. */
export const FRESH_MS = 15_000
/** Packets in the air at once; past it the oldest lands early. */
export const MAX_ACTIVE = 40
/** Ids remembered as played; past it the oldest are forgotten. */
const MAX_PLAYED = 5_000

/** The packets in the air (spec Q22, Q23): each id plays once, however many polls still list it,
 *  and drops out when its animation ends. A coalesced packet whose count grows is still the same
 *  packet: the scene draws its latest count. */
export function usePackets(packets: Packet[], now: number): { active: Packet[]; landed(id: string): void } {
  const played = useRef(new Set<string>())
  const [active, setActive] = useState<Packet[]>([])
  useLayoutEffect(() => {
    const seen = played.current
    const fresh = packets.filter((p) => !seen.has(p.id))
    for (const p of fresh) seen.add(p.id)
    for (const id of seen) {
      if (seen.size <= MAX_PLAYED) break
      seen.delete(id)
    }
    const play = fresh.filter((p) => now - p.at <= FRESH_MS)
    if (play.length) setActive((prev) => [...prev, ...play].slice(-MAX_ACTIVE))
  }, [packets, now])
  const landed = useCallback((id: string) => setActive((prev) => (prev.some((p) => p.id === id) ? prev.filter((p) => p.id !== id) : prev)), [])
  const latest = new Map(packets.map((p) => [p.id, p]))
  return { active: active.map((p) => latest.get(p.id) ?? p), landed }
}

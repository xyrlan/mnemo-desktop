import { useCallback, useEffect, useRef, useState } from 'react'
import type { ConversationClient } from './client'
import { applyEarlier, applyEvent, newSegment, TAIL, type Segment } from './stream'
import type { FollowSource } from './types'

/** Follows `sessionId`'s transcript while mounted. A new id (a `/clear`) opens a new segment
 *  below the others, which stay; `null` stops nothing and adds nothing (the session ended, or
 *  none started yet). The cwd a segment was opened with is the one it keeps: a `cd` in the pane
 *  must not restart the follow. So is its `source`, the CLI and home its file is in (absent, a
 *  Claude transcript). */
export function useFollow(client: ConversationClient, sessionId: string | null, cwd: string, source?: FollowSource) {
  const [segments, setSegments] = useState<Segment[]>([])
  const now = useRef(segments)
  now.current = segments
  const last = useRef<{ key: number; sessionId: string } | null>(null)
  const nextKey = useRef(0)
  const cwds = useRef(new Map<number, string>())
  const cwdNow = useRef(cwd)
  cwdNow.current = cwd
  const sources = useRef(new Map<number, FollowSource | undefined>())
  const sourceNow = useRef(source)
  sourceNow.current = source
  const reading = useRef(new Set<number>())
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => void (mounted.current = false)
  }, [])

  const update = useCallback((key: number, f: (s: Segment) => Segment) => {
    if (mounted.current) setSegments((p) => p.map((s) => (s.key === key ? f(s) : s)))
  }, [])

  useEffect(() => {
    if (!sessionId) return
    let key: number
    // The same session again (a remount, or StrictMode's second run) follows into its own
    // segment from scratch: the tailer sends the tail again.
    if (last.current?.sessionId === sessionId) {
      key = last.current.key
      setSegments((p) => p.map((s) => (s.key === key ? newSegment(key, sessionId) : s)))
    } else {
      key = nextKey.current++
      last.current = { key, sessionId }
      cwds.current.set(key, cwdNow.current)
      sources.current.set(key, sourceNow.current)
      setSegments((p) => [...p, newSegment(key, sessionId)])
    }
    let live = true
    let stop: (() => void) | null = null
    client
      .follow(
        sessionId,
        cwds.current.get(key) ?? cwdNow.current,
        TAIL,
        (e) => {
          if (live) update(key, (s) => applyEvent(s, e))
        },
        sources.current.get(key),
      )
      .then((fn) => {
        if (live) stop = fn
        else fn()
      })
      .catch((e) => {
        if (live) update(key, (s) => ({ ...s, state: 'error', error: String(e) }))
      })
    return () => {
      live = false
      stop?.()
    }
  }, [client, sessionId, update])

  /** Reads the lines before segment `key`'s first; nothing when it is at its file's top or
   *  already reading. */
  const loadEarlier = useCallback(
    (key: number) => {
      const seg = now.current.find((s) => s.key === key)
      // `loadingEarlier` lands with the next render; two scroll events can come before it.
      if (!seg || seg.loadingEarlier || !seg.start || reading.current.has(key)) return
      const { gen, start } = seg
      reading.current.add(key)
      update(key, (s) => ({ ...s, loadingEarlier: true }))
      client
        .earlier(seg.sessionId, cwds.current.get(key) ?? cwdNow.current, start, TAIL, sources.current.get(key))
        .then((chunk) => update(key, (s) => applyEarlier(s, chunk, gen, start)))
        .catch((e) => update(key, (s) => ({ ...s, loadingEarlier: false, earlierError: String(e) })))
        .finally(() => reading.current.delete(key))
    },
    [client, update],
  )

  return { segments, loadEarlier }
}

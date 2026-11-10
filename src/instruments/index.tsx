// The instruments: what is known of a session, always open beside it: context and tokens,
// memory, sight (docs/superpowers/specs/2026-11-10-recreation-design.md). Three readings of
// one session; all three at once when the column has the room, one at a time under three
// headers when it has not. `read.ts` works out what each says; this file lays them out.

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { actions } from '../world/actions'
import { tokens as tok } from '../world/format'
import { go, routeStore, useRoute, type Reading } from '../world/route'
import { sessionOf, useWorld } from '../world/store'
import type { Session, World } from '../world/types'
import { ContextBody } from './Context'
import { MemoryBody } from './Memory'
import { OpenContext, plural } from './parts'
import { contextReading, layoutFor, memoryReading, momentOf, sightReading, span, type Layout } from './read'
import { SightBody } from './Sight'
import './instruments.css'

/** The three readings, in the order they are drawn and walked. */
export const READINGS: readonly Reading[] = ['context', 'memory', 'sight']

const TITLE: Record<Reading, string> = { context: 'Context and tokens', memory: 'Memory', sight: 'Sight' }

/** Put a reading in front. For the frame's keys: the instruments listen to no key on `window`. */
export const showReading = (reading: Reading): void => go({ reading })

/** The reading after (1) or before (-1) the one in front, wrapping. */
export function stepReading(step: 1 | -1): void {
  const at = READINGS.indexOf(routeStore.getState().route.reading)
  showReading(READINGS[(at + step + READINGS.length) % READINGS.length])
}

/** How the column's width, in the frame's `em`, lays the readings out. Measured, not asked
 *  of the window: the same component stands in Console's column and beside the score. */
function useLayout(ref: RefObject<HTMLElement | null>): Layout {
  const [layout, setLayout] = useState<Layout>('one')
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setLayout(layoutFor(el.clientWidth / (parseFloat(getComputedStyle(el).fontSize) || 16)))
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const watch = new ResizeObserver(measure)
    watch.observe(el)
    return () => watch.disconnect()
  }, [ref])
  return layout
}

const clock = (t: number): string => {
  const d = new Date(t)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function Readings({ world, session, at, enter }: { world: World; session: Session; at: number | null; enter: boolean }) {
  const reading = useRoute((r) => r.reading)
  const root = useRef<HTMLElement>(null)
  const layout = useLayout(root)
  const uid = useId()

  const m = useMemo(() => momentOf(world, at), [world, at])
  const context = useMemo(() => contextReading(world, session, at), [world, session, at])
  const memory = useMemo(() => memoryReading(world, session, at), [world, session, at])
  const sight = useMemo(() => sightReading(world, session, at), [world, session, at])

  // What an action answered when it refused, said here until the next one.
  const [said, setSaid] = useState<string | null>(null)
  const open = useCallback((target: string) => {
    setSaid(null)
    actions()
      .external(target)
      .then(
        (outcome) => {
          if (!outcome.ok) setSaid(outcome.why)
        },
        (e) => setSaid(String(e)),
      )
  }, [])

  // A reading put in front after the first draw is marked for a moment, so it is found even
  // where all three are open and nothing else moved.
  const [flash, setFlash] = useState(0)
  const drawn = useRef(reading)
  const refocus = useRef(false)
  useEffect(() => {
    if (drawn.current === reading) return
    drawn.current = reading
    setFlash((n) => n + 1)
    if (refocus.current) {
      refocus.current = false
      root.current?.querySelector<HTMLElement>(`[data-inst="${reading}"] .instruments-head`)?.focus()
    }
  }, [reading])

  // Keys are the instruments' only while focus is inside them, and never in a field or under
  // a screenshot shown large (its keys reach here through React's tree, not the page's).
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return
    if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable], .xterm, .instruments-veil')) return
    const step = e.key === ']' ? 1 : e.key === '[' ? -1 : 0
    if (!step) return
    e.preventDefault()
    e.stopPropagation()
    // Focus follows the reading, so the next press is still inside.
    refocus.current = true
    stepReading(step)
  }

  const pct = context.percent == null ? '–' : `${Math.round(context.percent)}%`
  const headline: Record<Reading, ReactNode> = {
    context: (
      <>
        <b className="mn-num">{pct}</b> full · <b className="mn-num">{(m.past ? '≈ ' : '') + tok(context.spent)}</b> spent
      </>
    ),
    memory: (
      <>
        <b className="mn-num">{memory.givenCount}</b> given · <b className="mn-num">{memory.heldCount}</b> held back
      </>
    ),
    sight: (
      <>
        <b className="mn-num">{sight.webCount}</b> on the web · <b className="mn-num">{sight.editedCount}</b> edited · <b className="mn-num">{sight.prCount}</b> {plural(sight.prCount, 'PR')}
      </>
    ),
  }
  const body: Record<Reading, () => ReactNode> = {
    context: () => <ContextBody r={context} m={m} />,
    memory: () => <MemoryBody r={memory} m={m} />,
    sight: () => <SightBody r={sight} m={m} sessionId={session.id} />,
  }

  return (
    <aside ref={root} className="instruments" aria-label="Instruments" data-instruments data-session={session.id} data-layout={layout} data-reading={reading} data-at={m.past ? m.t : undefined} onKeyDown={onKeyDown}>
      {m.past && (
        <p className="instruments-asof">
          <b>As of {clock(m.t)}</b>
          <span>
            {span(m.now - m.t)} before now{context.unborn ? ' · it had not started' : ''} · what came later is dimmed
          </span>
        </p>
      )}
      <OpenContext.Provider value={open}>
        <div className="instruments-readings">
          {READINGS.map((k) => {
            const shown = layout !== 'one' || reading === k
            return (
              <section key={k} className="instruments-inst" data-inst={k} data-open={shown || undefined} data-front={reading === k || undefined}>
                <h2 className="instruments-h">
                  <button type="button" className="instruments-head" aria-expanded={shown} aria-controls={`${uid}-${k}`} onClick={() => showReading(k)}>
                    <i className="instruments-head-mark" aria-hidden="true" />
                    <span className="instruments-head-t">{TITLE[k]}</span>
                    <span className="instruments-head-sum">{headline[k]}</span>
                  </button>
                </h2>
                {shown && (
                  <div id={`${uid}-${k}`} className="instruments-body" data-enter={enter || undefined} tabIndex={0} role="region" aria-label={TITLE[k]}>
                    {body[k]()}
                  </div>
                )}
                {flash > 0 && reading === k && <i key={flash} className="instruments-flash" aria-hidden="true" />}
              </section>
            )
          })}
        </div>
      </OpenContext.Provider>
      {said && (
        <p className="instruments-said" role="status">
          {said}
        </p>
      )}
    </aside>
  )
}

/** The three readings of one session. `at`: as of that moment (Score's playhead); absent or
 *  null is now. */
export function Instruments({ sessionId, at }: { sessionId: string; at?: number | null }) {
  const world = useWorld((w) => w)
  const session = sessionOf(world, sessionId)
  // The readings rise when the session changes, and never on the first draw: a picture taken
  // of a URL is not caught mid-entrance.
  const last = useRef<{ id: string; enter: boolean } | null>(null)
  if (session && last.current?.id !== session.id) last.current = { id: session.id, enter: last.current !== null }
  if (!session) return null
  return <Readings key={session.id} world={world} session={session} at={at ?? null} enter={last.current?.enter ?? false} />
}

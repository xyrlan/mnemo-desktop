// The top bar: the mark, the three views, how many wait, the fleet by state, each account's
// plan windows and James; and under it, on a line of its own, the panels that exist, the motion
// switch and which world this is. The first line is the fleet; the second is the app.

import { useLayoutEffect, useRef } from 'react'
import { Kbd, Mark, Meter, StateMark } from '../ds'
import { panels } from '../panels'
import { WaitingCount } from '../pending'
import { WORD } from '../world/format'
import { go, useRoute, type View } from '../world/route'
import { presentSessions, sessionOf, useWorld, worldSource } from '../world/store'
import { STATE_ORDER, type Account, type PlanLimit, type SessionState, type World } from '../world/types'
import { useJames } from './james'
import { setReduced, useReduced } from './motion'

export const VIEWS: readonly { view: View; name: string; key: string }[] = [
  { view: 'orbit', name: 'Orbit', key: 'H' },
  { view: 'console', name: 'Console', key: 'C' },
  { view: 'score', name: 'Score', key: 'T' },
]

/** How many sessions are in each state, in the order of attention. */
export function countsByState(world: World): { state: SessionState; count: number }[] {
  return STATE_ORDER.map((state) => ({ state, count: presentSessions(world).filter((s) => s.state === state).length }))
}

const WINDOW: Record<string, string> = { session: '5h', weekly_all: 'week' }

/** The two windows the top bar has room for: the 5-hour one and the week across all models. */
export const windowsOf = (account: Account): PlanLimit[] => account.limits.filter((l) => l.kind in WINDOW)

/** The account whose windows are drawn in full: the selected session's, else the active one. */
export function accountInFront(world: World, session: string | null): string | null {
  return sessionOf(world, session)?.account ?? world.accounts.find((a) => a.active)?.id ?? world.accounts[0]?.id ?? null
}

/** "2h", "3d": how long until a window resets, from the world's own now. */
export function until(at: number | null, now: number): string {
  if (at == null || at <= now) return ''
  const m = (at - now) / 60000
  if (m < 90) return `${Math.max(1, Math.round(m))}m`
  if (m < 36 * 60) return `${Math.round(m / 60)}h`
  return `${Math.round(m / 1440)}d`
}

/** A window that is nearly spent is a signal; one the endpoint itself flags is too. */
const hot = (l: PlanLimit) => l.percent >= 80 || l.severity.toLowerCase() !== 'normal'

function Plans() {
  const world = useWorld((w) => w)
  const session = useRoute((r) => r.session)
  const front = accountInFront(world, session)
  return (
    <div className="frame-plans">
      {world.accounts.map((a) => {
        const on = a.id === front
        const windows = windowsOf(a)
        return (
          <span key={a.id} className="frame-acct" data-on={on || undefined} data-stale={a.stale ? true : undefined} title={a.stale ?? undefined}>
            <span className="frame-acct-name">{a.label}</span>
            {a.plan && <span className="frame-acct-plan">{a.plan}</span>}
            {windows.length === 0 && <span className="frame-lim" data-off>no window read</span>}
            {windows.map((l) => {
              const left = until(l.resetsAt, world.at)
              return (
                <span key={l.kind} className="frame-lim" data-off={l.active ? undefined : true} data-hot={hot(l) || undefined} title={left ? `resets in ${left}` : undefined}>
                  <span className="frame-lim-kind">{WINDOW[l.kind]}</span>
                  {on && <Meter value={l.percent / 100} width="4em" hot={hot(l)} />}
                  <b className="mn-num">{Math.round(l.percent)}%</b>
                  {on && left && <span className="frame-lim-left">resets {left}</span>}
                </span>
              )
            })}
            {a.stale && <span className="frame-acct-old">old</span>}
          </span>
        )
      })}
    </div>
  )
}

/** What to call a world that is not this machine: a word, and what follows it where there is room. */
const SOURCE = { sample: ['sample', ' world'], capture: ['capture', ''], live: ['', ''] } as const

/** Marks the fleet `data-tight` when its words do not fit beside everything else in the bar.
 *  The rest of the bar keeps its width (how many wait, the accounts), so the words are what
 *  gives: a state is still its shape and its number. */
export function fitFleet(fleet: HTMLElement): void {
  fleet.removeAttribute('data-tight')
  if (fleet.scrollWidth > fleet.clientWidth + 1) fleet.setAttribute('data-tight', '')
}

/** The panels that exist, each one click away; the open one is lit, and a click on it closes
 *  it. With them, what is the app's and not the fleet's: the motion switch, and which world
 *  this is when it is not this machine's. */
export function PanelBar() {
  const open = useRoute((r) => r.panel)
  const reduced = useReduced()
  const [source, more] = SOURCE[worldSource()]
  return (
    <div className="frame-sub">
      <nav className="frame-panels" aria-label="Panels">
        {panels().map((p) => (
          <button key={p.id} type="button" className="frame-panel-tab" data-panel-tab={p.id} aria-pressed={p.id === open} title={p.hint} onClick={() => go({ panel: p.id === open ? null : p.id, command: false })}>
            {p.title}
          </button>
        ))}
      </nav>

      <button type="button" className="frame-motion" aria-pressed={reduced} onClick={() => setReduced(!reduced)}>
        <span className="mn-label">motion</span>
        <b>{reduced ? 'reduced' : 'full'}</b>
      </button>

      {source && (
        <span className="frame-source mn-label">
          {source}
          <span className="frame-source-more">{more}</span>
        </span>
      )}
    </div>
  )
}

export function TopBar() {
  const world = useWorld((w) => w)
  const view = useRoute((r) => r.view)
  const James = useJames()
  const bar = useRef<HTMLElement>(null)
  const fleet = useRef<HTMLDivElement>(null)

  // Measured after every draw, and again when the window or a neighbour changes width (the
  // count of what waits is another piece's and redraws on its own). Never on a timer.
  useLayoutEffect(() => {
    const el = fleet.current
    if (!el || !bar.current) return
    fitFleet(el)
    if (typeof ResizeObserver === 'undefined') return
    const watch = new ResizeObserver(() => fitFleet(el))
    watch.observe(bar.current)
    for (const child of bar.current.children) if (child !== el) watch.observe(child)
    return () => watch.disconnect()
  })
  const at = VIEWS.findIndex((v) => v.view === view)
  return (
    <header ref={bar} className="frame-top" data-top-bar>
      <div className="frame-brand">
        <Mark size={28} className="frame-mark" />
        <b className="frame-wordmark">mnemo</b>
      </div>

      <nav className="frame-views" aria-label="Views" style={{ '--frame-at': at } as React.CSSProperties}>
        <i className="frame-views-lit" aria-hidden="true" />
        {VIEWS.map((v) => (
          <button key={v.view} type="button" className="frame-view-tab" aria-current={v.view === view ? 'page' : undefined} onClick={() => go({ view: v.view })}>
            {v.name} <Kbd>{v.key}</Kbd>
          </button>
        ))}
      </nav>

      <WaitingCount />

      <div ref={fleet} className="frame-fleet">
        {countsByState(world).map(({ state, count }) => (
          <span key={state} className="frame-fl" data-state={state} data-zero={count ? undefined : true}>
            <StateMark state={state} />
            <b className="mn-num">{count}</b>
            <span className="frame-fl-word">{WORD[state]}</span>
          </span>
        ))}
      </div>

      <Plans />

      {/* James: his state, and the way into his panel (the overlays piece's own). */}
      {James && (
        <div className="frame-james" data-frame-james>
          <James />
        </div>
      )}
    </header>
  )
}

/** What the world could not read, said under the top bar for as long as it is true. */
export function Unread() {
  const errors = useWorld((w) => w.errors)
  if (!errors.length) return null
  return (
    <div className="frame-unread" role="status">
      <span className="mn-label">could not read</span>
      <ul>
        {errors.map((e) => (
          <li key={e}>{e}</li>
        ))}
      </ul>
    </div>
  )
}

// The top bar: the mark, the three views, how many wait, the fleet by state, each account's
// plan windows, the motion switch, and which world this is.

import { Kbd, Mark, Meter, StateMark } from '../ds'
import { WORD } from '../world/format'
import { go, useRoute, type View } from '../world/route'
import { sessionOf, useWorld, worldSource } from '../world/store'
import { STATE_ORDER, type Account, type PlanLimit, type SessionState, type World } from '../world/types'
import { setReduced, useReduced } from './motion'
import { WaitingCount } from './pieces'

export const VIEWS: readonly { view: View; name: string; key: string }[] = [
  { view: 'orbit', name: 'Orbit', key: 'H' },
  { view: 'console', name: 'Console', key: 'C' },
  { view: 'score', name: 'Score', key: 'T' },
]

/** How many sessions are in each state, in the order of attention. */
export function countsByState(world: World): { state: SessionState; count: number }[] {
  return STATE_ORDER.map((state) => ({ state, count: world.sessions.filter((s) => s.state === state).length }))
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

export function TopBar() {
  const world = useWorld((w) => w)
  const view = useRoute((r) => r.view)
  const reduced = useReduced()
  const at = VIEWS.findIndex((v) => v.view === view)
  const [source, more] = SOURCE[worldSource()]
  return (
    <header className="frame-top" data-top-bar>
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

      <div className="frame-fleet">
        {countsByState(world).map(({ state, count }) => (
          <span key={state} className="frame-fl" data-state={state} data-zero={count ? undefined : true}>
            <StateMark state={state} />
            <b className="mn-num">{count}</b>
            <span className="frame-fl-word">{WORD[state]}</span>
          </span>
        ))}
      </div>

      <Plans />

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

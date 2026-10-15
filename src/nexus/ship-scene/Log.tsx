import { useState } from 'react'
import type { LogEvent } from '../ship-types'
import { useScene } from './context'
import { Tag } from './figures'
import { hhmm, LOG_ICON, logTone } from './words'

/** Rows the open log draws; older milestones stay in the store. */
export const LOG_ROWS = 200

/** Who a milestone is about: its robot's tag while the robot is on the ship, else its captain's. */
function Who({ e }: { e: LogEvent }) {
  const s = useScene()
  const r = e.robotId ? s.robots.get(e.robotId) : undefined
  if (r)
    return (
      <b>
        <Tag robot={r} emblem={s.emblems.get(r.captainId) ?? ''} />
      </b>
    )
  const em = e.captainId ? s.emblems.get(e.captainId) : undefined
  return em ? <b className="ship-em">{em}</b> : null
}

/** The ship's log (spec "What it is"): a one-line ticker of the newest milestone that opens into
 *  the list, newest first. A row opens its robot. */
export function ShipLog({ log }: { log: LogEvent[] }) {
  const s = useScene()
  const [open, setOpen] = useState(false)
  const last = log[log.length - 1]
  return (
    <aside className="ship-log" data-open={open ? '' : undefined} aria-label="ship's log">
      <button type="button" className="ship-log-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <b>SHIP'S LOG</b>
        {last ? (
          <span key={last.id} className="ship-tick" data-tone={logTone(last.kind) ?? undefined}>
            {hhmm(last.at)} <i>{LOG_ICON[last.kind]}</i> <Who e={last} /> {last.text}
          </span>
        ) : (
          <span className="ship-tick">no milestones yet</span>
        )}
        <span aria-hidden>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <ol className="ship-log-list">
          {log
            .slice(-LOG_ROWS)
            .reverse()
            .map((e) => (
              <li key={e.id}>
                <button type="button" data-ev={e.id} data-tone={logTone(e.kind) ?? undefined} disabled={!e.robotId} onClick={() => e.robotId && s.onOpen(e.robotId)}>
                  <time>{hhmm(e.at)}</time>
                  <i>{LOG_ICON[e.kind]}</i>
                  <span>
                    <Who e={e} /> {e.text}
                  </span>
                </button>
              </li>
            ))}
        </ol>
      )}
    </aside>
  )
}

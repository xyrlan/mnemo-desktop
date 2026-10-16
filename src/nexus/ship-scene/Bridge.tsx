import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from 'react'
import type { Captain, Ship, ShipAction, ShipRobot } from '../ship-types'
import { isFocused, useScene } from './context'
import { RobotFigure, Tag } from './figures'
import { bridgeStatus, exceptionRow, toneOf, type Row, type RowButton } from './words'
import './bridge.css'

/** Rows the bridge lists; ⌥1–9 reach them, the rest are counted. */
export const ROWS = 9
/** How long a destructive button waits for its confirming press. */
export const CONFIRM_MS = 5_000
/** Blocked robots drawn on the bridge; the rest are counted, and triage reaches them all. */
export const BLOCKED = 2

/** How long a failed PR read stays on the bridge after the snapshot last said it. The app asks
 *  `gh` for PRs on one poll in ten (`shell/mission-poll.ts`: 30 s while shown) and the polls
 *  between say nothing of it, so without this the row would show for one poll and blink out. */
export const PR_ERROR_HOLD_MS = 45_000

/** The bridge's rows: the ship's exceptions, then each failed PR read the snapshot said within
 *  `PR_ERROR_HOLD_MS` and no longer says. Held rows come last, so ⌥1–9 still reach the ship's. */
export function useRows(ship: Ship): Row[] {
  const held = useRef(new Map<string, { row: Row; at: number }>())
  const rows = ship.bridge.exceptions.map(exceptionRow)
  for (const x of ship.bridge.exceptions) if (x.kind === 'snapshot' && x.source === 'prs') held.current.set(`snapshot:${x.text}`, { row: exceptionRow(x), at: ship.at })
  const extra: Row[] = []
  for (const [key, h] of held.current) {
    if (ship.at - h.at > PR_ERROR_HOLD_MS) held.current.delete(key)
    else if (!rows.some((r) => r.key === key)) extra.push(h.row)
  }
  return [...rows, ...extra]
}

/** ⌥1–9 are the Nexus's on macOS only: elsewhere Alt+digit is left to the terminal it is typed in. */
export const altDigits = () => typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac')

/** A button that acts on its second press within `CONFIRM_MS`. The action is taken at the first
 *  press, so the second confirms what was shown, not what is there by then. */
function Armed({ label, confirm, action, go, x }: { label: string; confirm: string; action: () => ShipAction; go?: boolean; x?: string }) {
  const s = useScene()
  const [armed, setArmed] = useState<ShipAction | null>(null)
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(null), CONFIRM_MS)
    return () => clearTimeout(t)
  }, [armed])
  const press = (e: MouseEvent) => {
    e.stopPropagation()
    if (!armed) return setArmed(action())
    setArmed(null)
    s.onAction(armed)
  }
  return (
    <button type="button" className={go ? 'ship-go' : undefined} data-x={x} data-armed={armed ? '' : undefined} onClick={press}>
      {armed ? confirm : label}
    </button>
  )
}

const CONFIRM: Record<ShipAction['kind'], (a: ShipAction) => string> = {
  merge: (a) => (a.kind === 'merge' && a.robotIds.length > 1 ? `confirm merge of ${a.robotIds.length}?` : 'confirm merge?'),
  stop: () => 'confirm stop?',
  land: () => 'confirm land?',
  answer: () => 'confirm?',
  message: () => 'confirm?',
  dispatch: () => 'confirm?',
  open: () => 'confirm?',
}

/** The bridge: you. Only what waits for you: the exceptions, each with what settles it, and every
 *  blocked child, climbed up here with its question and an inline answer. Red for a question or a
 *  red CI, lilac when only a merge waits, calm when nothing does; with nothing at all, one line,
 *  and the board below gains the room. Its head's `/ commands` opens the command line, as `/` does. */
export function Bridge({ ship }: { ship: Ship }) {
  const s = useScene()
  const rows = useRows(ship)
  const ready = ship.bridge.exceptions.flatMap((x) => (x.kind === 'ready' ? [x.robotId] : []))
  const blocked = ship.bridge.blocked
  const mac = altDigits()
  const captains = new Map([...ship.decks.flatMap((d) => [...d.captains, ...d.quiet]), ...ship.docks.flatMap((d) => d.captains)].map((c) => [c.id, c]))
  const quiet = rows.length === 0 && blocked.length === 0

  return (
    <section className="ship-bridge" data-tone={toneOf(ship)} data-quiet={quiet ? '' : undefined} aria-label="bridge">
      <header className="ship-bridge-head">
        <span className="ship-blabel">BRIDGE · exceptions</span>
        <span className="ship-bstatus">{bridgeStatus(ship)}</span>
        {ship.counts.need > 0 && (
          <button type="button" className="ship-attend" onClick={s.onTriage}>
            attend · Tab
          </button>
        )}
        <button type="button" className="ship-line-hint" title="Orders for the whole fleet: / anywhere on the ship" onClick={s.onCommand}>
          <kbd>/</kbd> commands
        </button>
        <span className="ship-lights" aria-hidden>
          <i />
          <i />
          <i />
        </span>
      </header>
      {!quiet && (
        <div className="ship-bridge-body">
          <div className="ship-bridge-main">
            {rows.length > 0 && (
              <div className="ship-exceptions">
                <div className="ship-xhead">
                  <span>EXCEPTIONS</span> <small>— everything else flies itself</small>
                  {ready.length > 1 && (
                    <Armed go x="merge-all" label={`✈ merge all green (${ready.length})`} confirm={`confirm merge of ${ready.length}?`} action={() => ({ kind: 'merge', robotIds: ready })} />
                  )}
                </div>
                {rows.slice(0, ROWS).map((row, k) => (
                  <ExceptionRow
                    key={row.key}
                    row={row}
                    n={mac && (row.robotId || row.captainId) ? k + 1 : null}
                    robot={row.robotId ? s.robots.get(row.robotId) : undefined}
                    captain={row.captainId ? captains.get(row.captainId) : undefined}
                  />
                ))}
                {rows.length > ROWS && <div className="ship-xmore">+{rows.length - ROWS} exceptions</div>}
              </div>
            )}
          </div>
          {blocked.length > 0 && (
            <div className="ship-blocked">
              {blocked.slice(0, BLOCKED).map((r) => (
                <Blocked key={r.id} robot={r} />
              ))}
              {blocked.length > BLOCKED && (
                <button type="button" className="ship-more-blocked" onClick={s.onTriage}>
                  +{blocked.length - BLOCKED} blocked · triage
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function ExceptionRow({ row, n, robot, captain }: { row: Row; n: number | null; robot: ShipRobot | undefined; captain: Captain | undefined }) {
  const s = useScene()
  const press = (b: RowButton) => (e: MouseEvent) => {
    e.stopPropagation()
    if ('open' in b) s.onOpen(b.open)
    else s.onTriage()
  }
  const open = () => {
    const id = row.robotId ?? row.captainId
    if (id) s.onOpen(id)
  }
  return (
    <div className="ship-xrow" data-kind={row.kind} data-row={row.key} onClick={open}>
      {n !== null && (
        <kbd className="ship-xn" title={`⌥${n} opens it`}>
          ⌥{n}
        </kbd>
      )}
      <span className="ship-xi" aria-hidden>
        {row.icon}
      </span>
      {robot && (
        <b className="ship-xtag">
          <Tag robot={robot} emblem={s.emblems.get(robot.captainId) ?? ''} />
        </b>
      )}
      {captain && (
        <b className="ship-xtag">
          <span className="ship-em">{captain.emblem} </span>
          {captain.name}
        </b>
      )}
      <span className="ship-xt" title={row.title}>
        {row.text}
      </span>
      {row.buttons.map((b) =>
        'action' in b ? (
          <Armed key={b.label} go={b.go} x={b.label} label={b.label} confirm={CONFIRM[b.action.kind](b.action)} action={() => b.action} />
        ) : (
          <button key={b.label} type="button" className={b.go ? 'ship-go' : undefined} data-x={b.label} onClick={press(b)}>
            {b.label}
          </button>
        ),
      )}
    </div>
  )
}

/** A blocked child on the bridge, its question over its head with an answer for each option, a
 *  line to type one, and its terminal. */
function Blocked({ robot: r }: { robot: ShipRobot }) {
  const s = useScene()
  const [typed, setTyped] = useState('')
  const need = r.need
  const answer = (text: string) => s.onAction({ kind: 'answer', robotId: r.id, text })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const v = typed.trim()
    if (!v) return
    answer(v)
    setTyped('')
  }
  return (
    <div className="ship-blocked-one" data-blocked={r.id}>
      {need && (
        <div className="ship-need" data-kind={need.kind}>
          <div className="ship-q">{need.kind === 'permission' ? `🔒 wants to run: ${need.text}` : `❓ ${need.text}`}</div>
          <div className="ship-opts">
            {need.options.map((o, k) => (
              <button key={o} type="button" className={k === 0 ? 'ship-go' : undefined} onClick={() => answer(o)}>
                {o}
              </button>
            ))}
          </div>
          {need.kind === 'question' && (
            <form onSubmit={submit}>
              <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="or type the answer…" aria-label={`answer ${r.label}`} />
              <button type="submit" aria-label="send">
                ↩
              </button>
            </form>
          )}
          <button type="button" className="ship-link" onClick={() => s.onOpen(r.id)}>
            open terminal ⤢
          </button>
        </div>
      )}
      <RobotFigure
        robot={r}
        emblem={s.emblems.get(r.captainId) ?? ''}
        pos={null}
        selected={s.selection.has(r.id)}
        focused={isFocused(s.focusId, r)}
        dimmed={false}
        arriving={s.arriving.has(r.id)}
        onArrived={s.arrived}
        reducedMotion={s.reducedMotion}
        onOpen={s.onOpen}
        onSelect={s.onSelect}
        onHover={() => {}}
      />
    </div>
  )
}

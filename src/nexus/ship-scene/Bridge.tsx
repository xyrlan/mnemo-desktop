import { useEffect, useState, type FormEvent, type MouseEvent, type ReactNode } from 'react'
import type { Ship, ShipRobot } from '../ship-types'
import { isFocused, useScene } from './context'
import { RobotFigure, Tag } from './figures'
import { bridgeStatus, exceptionRow, toneOf, type Row, type RowButton } from './words'

/** Rows the bridge lists; ⌥1–9 reach them, the rest are counted. */
export const ROWS = 9
/** How long "merge all green" waits for its confirming click. */
export const CONFIRM_MS = 5_000

/** The bridge: you. The exceptions, each with what settles it; the fleet prompt; and every blocked
 *  child, climbed up here with its question and an inline answer. Red for a question or a red CI,
 *  lilac when only a merge waits, calm when nothing does. */
export function Bridge({ ship, prompt }: { ship: Ship; prompt: ReactNode }) {
  const s = useScene()
  const rows = ship.bridge.exceptions.map(exceptionRow)
  const ready = ship.bridge.exceptions.flatMap((x) => (x.kind === 'ready' ? [x.robotId] : []))
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), CONFIRM_MS)
    return () => clearTimeout(t)
  }, [armed])
  const mergeAll = () => {
    if (!armed) return setArmed(true)
    setArmed(false)
    s.onAction({ kind: 'merge', robotIds: ready })
  }

  return (
    <section className="ship-bridge" data-tone={toneOf(ship)} aria-label="bridge">
      <header className="ship-bridge-head">
        <span className="ship-blabel">BRIDGE · exceptions</span>
        <span className="ship-bstatus">{bridgeStatus(ship)}</span>
        {ship.counts.need > 0 && (
          <button type="button" className="ship-attend" onClick={s.onTriage}>
            attend · Tab
          </button>
        )}
        <span className="ship-lights" aria-hidden>
          <i />
          <i />
          <i />
        </span>
      </header>
      <div className="ship-bridge-body">
        <div className="ship-bridge-main">
          <div className="ship-prompt-slot">{prompt}</div>
          {rows.length > 0 && (
            <div className="ship-exceptions">
              <div className="ship-xhead">
                <span>EXCEPTIONS</span> <small>— everything else flies itself</small>
                {ready.length > 1 && (
                  <button type="button" className="ship-go" data-merge-all="" onClick={mergeAll}>
                    {armed ? `confirm merge of ${ready.length}?` : `✈ merge all green (${ready.length})`}
                  </button>
                )}
              </div>
              {rows.slice(0, ROWS).map((row, k) => (
                <ExceptionRow key={row.key} row={row} n={k + 1} robot={row.robotId ? s.robots.get(row.robotId) : undefined} />
              ))}
              {rows.length > ROWS && <div className="ship-xmore">+{rows.length - ROWS} exceptions</div>}
            </div>
          )}
        </div>
        {ship.bridge.blocked.length > 0 && (
          <div className="ship-blocked">
            {ship.bridge.blocked.map((r) => (
              <Blocked key={r.id} robot={r} />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function ExceptionRow({ row, n, robot }: { row: Row; n: number; robot: ShipRobot | undefined }) {
  const s = useScene()
  const press = (b: RowButton) => (e: MouseEvent) => {
    e.stopPropagation()
    if ('action' in b) s.onAction(b.action)
    else if ('open' in b) s.onOpen(b.open)
    else s.onTriage()
  }
  const open = () => row.robotId && s.onOpen(row.robotId)
  return (
    <div className="ship-xrow" data-kind={row.kind} data-row={row.key} onClick={open}>
      <kbd className="ship-xn" title={`⌥${n} opens it`}>
        ⌥{n}
      </kbd>
      <span className="ship-xi" aria-hidden>
        {row.icon}
      </span>
      {robot && (
        <b className="ship-xtag">
          <Tag robot={robot} emblem={s.emblems.get(robot.captainId) ?? ''} />
        </b>
      )}
      <span className="ship-xt">{row.text}</span>
      {row.buttons.map((b) => (
        <button key={b.label} type="button" className={b.go ? 'ship-go' : undefined} data-x={b.label} onClick={press(b)}>
          {b.label}
        </button>
      ))}
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

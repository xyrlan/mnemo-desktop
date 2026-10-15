import { useMemo, useRef, useState, type CSSProperties } from 'react'
import { SHIP_SPRITES } from '../sprites'
import type { Deck as DeckT, ShipRobot } from '../ship-types'
import { isFocused, useScene } from './context'
import { CaptainChip, CaptainFigure, LeaverFigure, px, RobotFigure, Tag } from './figures'
import { bubblesOf, deckLayout, G, type Bubble, type DeckLayout, type Point } from './geometry'
import { useLeavers, type Drawn } from './motion'
import { pickVoices, type Voice } from './voices'
import { relation, robotLine, robotMore } from './words'

/** A voice whose turn is this close to over at a tick takes its turn: ticks and draws do not
 *  land on the same ms. */
const SLACK_MS = 500

/** Who speaks in each room now, and where their bubbles hang. Remembers each robot's line and when
 *  it last changed, and each room's voices, across draws. */
function useBubbles(layout: DeckLayout, tick: number, rotate: boolean): Bubble[] {
  const said = useRef(new Map<string, { text: string; at: number }>())
  const voices = useRef(new Map<string, Voice[]>())
  const seen = useRef(false)
  return useMemo(() => {
    const now = Date.now()
    // What stands there when the deck is first drawn has not just spoken: the floor goes in order.
    const fresh = seen.current ? now : -Infinity
    seen.current = true
    const out: Bubble[] = []
    for (const room of layout.rooms) {
      for (const r of room.robots) {
        const text = robotLine(r).say
        if (said.current.get(r.id)?.text !== text) said.current.set(r.id, { text, at: fresh })
      }
      const ids = room.robots.map((r) => r.id)
      const cur = pickVoices(voices.current.get(room.zone) ?? [], ids, (id) => said.current.get(id)?.at ?? 0, room.voices, now + (rotate ? SLACK_MS : 0), rotate)
      voices.current.set(room.zone, cur)
      out.push(
        ...bubblesOf(
          room,
          cur.map((v) => v.id),
          layout.robots,
        ),
      )
    }
    return out
    // `tick` moves the turns on.
  }, [layout, tick, rotate])
}

/** One repo's deck: COMMAND with its captains, then in flight, hangar and stranded, each lit while
 *  someone stands in it. */
export function Deck({ deck, width, alive }: { deck: DeckT; width: number; alive: ReadonlySet<string> }) {
  const s = useScene()
  const [open, setOpen] = useState(false)
  const layout = useMemo(() => deckLayout(deck, width, open), [deck, width, open])
  const drawn = useMemo(() => {
    const m = new Map<string, Drawn>()
    for (const room of layout.rooms) for (const r of room.robots) m.set(r.id, { robot: r, ...layout.robots.get(r.id)! })
    return m
  }, [layout])
  // In a fixed order, by id: a robot that changes room keeps its place in the DOM, as moving the
  // node would cancel its walk (a CSS transition).
  const floor = useMemo(() => [...drawn.values()].map((d) => d.robot).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)), [drawn])
  const { leavers, gone } = useLeavers(drawn, alive, s.reducedMotion)
  const bubbles = useBubbles(layout, s.tick, !s.reducedMotion)
  const emblem = (r: ShipRobot) => s.emblems.get(r.captainId) ?? ''

  const hovered = s.hover && (s.hover.kind === 'robot' ? drawn.has(s.hover.id) : layout.captains.some((c) => c.captain.id === s.hover!.id)) ? s.hover : null
  const crewOf = hovered?.kind === 'captain' ? hovered.id : null

  return (
    <section className="ship-deck" data-deck={deck.root} aria-label={deck.name} style={{ height: px(layout.height) }}>
      <div className="ship-cmd" style={{ width: px(layout.cmdW) }}>
        <h3 className="ship-dlabel">{deck.name}</h3>
        {deck.quiet.length > 0 && (
          <div className="ship-quiet">
            {deck.quiet.map((c) => (
              <CaptainChip key={c.id} captain={c} focused={s.focusId === c.id} onOpen={s.onOpen} />
            ))}
          </div>
        )}
      </div>
      {layout.rooms.map((room) => (
        <div
          key={room.zone}
          className="ship-room"
          data-zone={room.zone}
          data-lit={room.robots.length || (room.zone === 'hangar' && layout.stack) ? '' : undefined}
          data-ready={room.zone === 'hangar' && deck.hangarReady ? '' : undefined}
          style={{ left: px(room.x), width: px(room.w) }}
        >
          {deck[room.zone].length > 0 && <span className="ship-rcount">{deck[room.zone].length}</span>}
        </div>
      ))}
      {layout.captains.map((c) => (
        <CaptainFigure key={c.captain.id} captain={c.captain} pos={c} big={c.big} focused={s.focusId === c.captain.id} lit={crewOf === c.captain.id} onOpen={s.onOpen} onHover={s.setHover} />
      ))}
      {floor.map((r) => (
        <RobotFigure
          key={r.id}
          robot={r}
          emblem={emblem(r)}
          pos={layout.robots.get(r.id)!}
          selected={s.selection.has(r.id)}
          focused={isFocused(s.focusId, r)}
          dimmed={!!crewOf && r.captainId !== crewOf}
          arriving={s.arriving.has(r.id)}
          onArrived={s.arrived}
          reducedMotion={s.reducedMotion}
          onOpen={s.onOpen}
          onSelect={s.onSelect}
          onHover={s.setHover}
        />
      ))}
      {layout.stack && (
        <button
          type="button"
          className="ship-stack"
          data-open={layout.stack.open ? '' : undefined}
          style={{ transform: `translate(${px(layout.stack.x)}, ${px(layout.stack.y)})` }}
          title={layout.stack.open ? 'fold them into the stack again' : `open the stack: ${layout.stack.hidden.map((id) => s.robots.get(id)?.label ?? id).join(' ')}`}
          onClick={() => setOpen((o) => !o)}
        >
          {(layout.stack.open ? [0] : [0, 1, 2]).map((i) => (
            <img key={i} className="ship-px" src={SHIP_SPRITES.shuttle.docked.src} alt="" draggable={false} />
          ))}
          <small>{layout.stack.open ? '−' : `+${layout.stack.n}`}</small>
          <b>{layout.stack.open ? `fold ${layout.stack.n} ready` : `${layout.stack.n} PRs waiting for merge${layout.stack.green ? ` · ${layout.stack.green} green` : ''}`}</b>
        </button>
      )}
      {leavers.map((l) => (
        <LeaverFigure key={l.robot.id} leaver={l} emblem={emblem(l.robot)} off={layout.width + 40 - l.x} onGone={gone} />
      ))}
      {bubbles.map((b) => {
        const r = drawn.get(b.robotId)!.robot
        const line = robotLine(r)
        return (
          <div
            key={b.robotId}
            className="ship-bubble"
            data-for={b.robotId}
            data-state={r.state}
            style={{ transform: `translate(${px(b.x)}, ${px(b.y)})`, width: px(b.w), '--tail': px(b.tail) } as CSSProperties}
          >
            <div className="ship-say">
              <b>
                <Tag robot={r} emblem={emblem(r)} />
              </b>{' '}
              {line.say}
            </div>
            {line.act && <div className="ship-act">{line.act}</div>}
          </div>
        )
      })}
      {hovered && <Tethers layout={layout} drawn={drawn} hover={hovered} />}
      {hovered?.kind === 'robot' && <HoverCard robot={drawn.get(hovered.id)!} emblem={emblem(drawn.get(hovered.id)!.robot)} />}
    </section>
  )
}

const center = (p: Point) => ({ x: p.x + G.robot / 2, y: p.y + G.robot / 2 })

/** A hovered robot tied to its captain, and by labelled dotted lines to the pieces it writes
 *  against and its twin; a hovered captain tied to its crew. */
function Tethers({ layout, drawn, hover }: { layout: DeckLayout; drawn: Map<string, Drawn>; hover: { kind: 'robot' | 'captain'; id: string } }) {
  const lines: Array<{ key: string; a: Point; b: Point; label?: string }> = []
  const captainAt = (id: string) => {
    const c = layout.captains.find((c) => c.captain.id === id)
    return c && { x: c.x + G.captain / 2, y: c.y + 60 }
  }
  if (hover.kind === 'robot') {
    const me = drawn.get(hover.id)!
    const a = center(me)
    const cap = captainAt(me.robot.captainId)
    if (cap) lines.push({ key: 'captain', a: cap, b: a })
    for (const o of drawn.values()) {
      if (o.robot.id === me.robot.id) continue
      const label = relation(me.robot, o.robot)
      if (label) lines.push({ key: o.robot.id, a, b: center(o), label })
    }
  } else {
    const cap = captainAt(hover.id)
    if (cap) for (const o of drawn.values()) if (o.robot.captainId === hover.id) lines.push({ key: o.robot.id, a: cap, b: center(o) })
  }
  if (!lines.length) return null
  return (
    <svg className="ship-tether" width={layout.width} height={layout.height} aria-hidden>
      {lines.map((l) => (
        <g key={l.key} data-tether={l.label ? 'relation' : 'crew'}>
          <line x1={l.a.x} y1={l.a.y} x2={l.b.x} y2={l.b.y} />
          {l.label && (
            <text x={(l.a.x + l.b.x) / 2} y={(l.a.y + l.b.y) / 2 - 4} textAnchor="middle">
              {l.label}
            </text>
          )}
        </g>
      ))}
    </svg>
  )
}

/** A hovered robot's full line, model, context, contract, twin and injected rules. */
function HoverCard({ robot: d, emblem }: { robot: Drawn; emblem: string }) {
  const r = d.robot
  const line = robotLine(r)
  return (
    <div className="ship-bubble ship-hover" data-hover={r.id} data-state={r.state} style={{ transform: `translate(${px(Math.max(8, d.x - 100))}, ${px(d.y - 8)}) translateY(-100%)` }}>
      <div className="ship-say">
        <b>
          <Tag robot={r} emblem={emblem} />
        </b>{' '}
        {line.say}
      </div>
      {line.act && <div className="ship-act">{line.act}</div>}
      <div className="ship-more">
        {robotMore(r).map((m) => (
          <div key={m}>{m}</div>
        ))}
        <i>click: open · shift+click: select</i>
      </div>
    </div>
  )
}

import type { AnimationEvent, CSSProperties, MouseEvent, ReactNode } from 'react'
import { SHIP_SPRITES, SPRITES, type CaptainSprite, type PropKind } from '../sprites'
import type { Captain, CaptainPose, RobotClass, RobotPose, ShipRobot } from '../ship-types'
import { useScene } from './context'
import { RuleCount } from './Memory'
import { useNewRule, useWalk, type Exit, type Leaver } from './motion'
import { captainHover, captainTopic, doingOf, lookOf, robotName, type Look } from './words'

/** The figures on the ship, every sprite at 1× with `image-rendering: pixelated` (`.ship-px`). */

export const px = (v: number) => `${v}px`
const at = (x: number, y: number): CSSProperties => ({ transform: `translate(${px(x)}, ${px(y)})` })
const on = (b: boolean) => (b ? '' : undefined)

export type Picks = {
  onOpen(id: string): void
  onSelect(id: string): void
  onHover(h: Hover | null): void
}
export type Hover = { kind: 'robot' | 'captain'; id: string }

/** A robot's tag: its captain's emblem, its label, and `↳#661` for a grandchild. */
export function Tag({ robot, emblem }: { robot: ShipRobot; emblem: string }) {
  return (
    <>
      {emblem && <span className="ship-em">{emblem} </span>}
      {robotName(robot)}
      {robot.via && <span className="ship-via"> ↳{robot.via}</span>}
    </>
  )
}

export type RobotFigureProps = Picks & {
  robot: ShipRobot
  emblem: string
  /** Its top-left on the deck; null on the bridge, where it stands in the flow. */
  pos: { x: number; y: number } | null
  selected: boolean
  /** The deck was laid out again (a resize): it moves to its new spot at once, without walking. */
  still?: boolean
  focused: boolean
  dimmed: boolean
  arriving: boolean
  onArrived(id: string): void
  reducedMotion: boolean
  children?: ReactNode
}

type Pt = readonly [number, number]

/** Where a robot's hand is, in sprite px on its 64×64 sheet, per pose and class (measured). */
export const HAND: Record<RobotPose, Record<RobotClass, Pt>> = {
  working: { mech: [42, 44], droid: [40, 37], drone: [46, 36], unknown: [40, 37] },
  idle: { mech: [46, 41], droid: [40, 39], drone: [46, 34], unknown: [40, 39] },
  waiting: { mech: [44, 6], droid: [41, 8], drone: [47, 30], unknown: [41, 8] },
  sleeping: { mech: [46, 50], droid: [44, 50], drone: [46, 50], unknown: [44, 50] },
}

/** Each 24×24 prop: the pixel the hand grips, whether it is held mirrored, where its particles
 *  leave from (from the grip), and `floor` for one that lies at the feet instead of in the hand. */
export const PROPS: Record<PropKind, { grip: Pt; flip?: true; out?: Pt; floor?: Pt }> = {
  read: { grip: [18, 19], flip: true, out: [11, -12] },
  edit: { grip: [4, 18], out: [18, -17] },
  test: { grip: [12, 14], out: [0, -13] },
  ship: { grip: [12, 20], out: [0, -9] },
  run: { grip: [12, 12], out: [0, 0] },
  need: { grip: [13, 21] },
  green: { grip: [3, 18] },
  red: { grip: [12, 15], out: [0, -7], floor: [54, 52] },
}

/** What a robot holds, at its hand (or its feet), moving as its action does; the particles come
 *  off it, and a torch's sparks ride its tip. */
function Held({ look, klass }: { look: Look; klass: RobotClass }) {
  if (!look.prop) return null
  const p = PROPS[look.prop]
  const [x, y] = p.floor ?? HAND[look.pose][klass]
  const fx = look.particles && p.out && <span className="ship-fx" data-fx={look.particles} style={{ left: px(p.out[0]), top: px(p.out[1]) }} aria-hidden />
  return (
    <span className="ship-held" aria-hidden>
      <span className="ship-prop" data-prop={look.prop} style={{ left: px(x), top: px(y) }}>
        <span className="ship-grip" data-motion={look.motion ?? undefined}>
          <img
            className="ship-px"
            data-flip={on(!!p.flip)}
            src={SHIP_SPRITES.props[look.prop].src}
            alt=""
            draggable={false}
            style={{ left: px(p.flip ? p.grip[0] - 24 : -p.grip[0]), top: px(-p.grip[1]) }}
          />
          {look.particles === 'sparks' && fx}
        </span>
        {look.particles !== 'sparks' && fx}
      </span>
    </span>
  )
}

/** A child: its body and accessory, its halo, the prop it holds and its particles, its shuttle while
 *  its PR waits, the teleport pad when it beams in, ◈ when mnemo injects a rule. */
export function RobotFigure({ robot: r, emblem, pos, still = false, selected, focused, dimmed, arriving, onArrived, reducedMotion, onOpen, onSelect, onHover, children }: RobotFigureProps) {
  const { walking, left, onTransitionEnd } = useWalk(pos?.x ?? 0, reducedMotion || !pos || still)
  const { rule, flashed } = useNewRule(r.injected[0] ?? null)
  const look = lookOf(r)
  const doing = doingOf(r)
  const click = (e: MouseEvent) => (e.shiftKey ? onSelect(r.id) : onOpen(r.id))
  const teleported = (e: AnimationEvent) => {
    if (e.target === e.currentTarget) onArrived(r.id)
  }
  const hover = { kind: 'robot', id: r.id } as const
  const shaking = useScene().memory.shaking(r.sessionId)
  return (
    <div
      className="ship-robot"
      data-ship-id={r.id}
      data-session={r.sessionId ?? undefined}
      data-state={r.state}
      data-zone={r.zone}
      data-ci={r.state === 'done' && r.ci ? r.ci : undefined}
      data-halo={look.halo ?? undefined}
      data-body={look.body ?? undefined}
      data-selected={on(selected)}
      data-focus={on(focused)}
      data-dim={on(dimmed)}
      data-walking={on(walking)}
      data-left={on(left)}
      data-arriving={on(arriving)}
      data-placed={on(!!pos)}
      data-still={on(still)}
      data-shake={on(shaking)}
      style={pos ? at(pos.x, pos.y) : undefined}
      onTransitionEnd={onTransitionEnd}
    >
      {children}
      {arriving && <img className="ship-px ship-teleport" src={SHIP_SPRITES.teleport.src} alt="" draggable={false} onAnimationEnd={teleported} />}
      {r.state === 'done' && r.pr && <img className="ship-px ship-shuttle" src={SHIP_SPRITES.shuttle.docked.src} alt="" draggable={false} />}
      <button
        type="button"
        className="ship-figure"
        aria-label={`${robotName(r)}, ${doing}`}
        onClick={click}
        onMouseEnter={() => onHover(hover)}
        onMouseLeave={() => onHover(null)}
        onFocus={() => onHover(hover)}
        onBlur={() => onHover(null)}
      >
        <span className="ship-halo" aria-hidden />
        <span className="ship-body">
          <img className="ship-px" src={SPRITES.accessories[r.accessory]?.src} alt="" draggable={false} />
          <img className="ship-px" src={SPRITES.robots[r.klass][look.pose].src} alt="" draggable={false} />
        </span>
        <Held look={look} klass={r.klass} />
        {look.particles === 'zz' && <span className="ship-fx" data-fx="zz" aria-hidden />}
        {rule && (
          <span className="ship-rule" title={rule} onAnimationEnd={flashed}>
            ◈
          </span>
        )}
        <RuleCount sessionId={r.sessionId} />
        <span className="ship-tag">
          <Tag robot={r} emblem={emblem} />
        </span>
      </button>
    </div>
  )
}

/** A robot leaving where it last stood: boarding its shuttle and launching, or walking off the
 *  deck's right edge (`off`: how far that is). */
export function LeaverFigure({ leaver, exit, emblem, off, onGone }: { leaver: Leaver; exit: Exit; emblem: string; off: number; onGone(id: string): void }) {
  const r = leaver.robot
  const ended = (e: AnimationEvent) => {
    if (e.target === e.currentTarget) onGone(r.id)
  }
  return (
    <div className="ship-leaver" data-leaving={r.id} data-exit={exit} style={{ ...at(leaver.x, leaver.y), '--off': px(off) } as CSSProperties} aria-hidden>
      {exit === 'launch' ? (
        <img className="ship-px ship-launch" src={SHIP_SPRITES.shuttle.launch.src} alt="" draggable={false} onAnimationEnd={ended} />
      ) : (
        <span className="ship-walk-off" onAnimationEnd={ended}>
          <span className="ship-body">
            <img className="ship-px" src={SPRITES.accessories[r.accessory]?.src} alt="" draggable={false} />
            <img className="ship-px" src={SPRITES.robots[r.klass].idle.src} alt="" draggable={false} />
          </span>
          <span className="ship-tag">
            <Tag robot={r} emblem={emblem} />
          </span>
        </span>
      )}
    </div>
  )
}

const CAPTAIN: Record<Exclude<CaptainPose, 'empty'>, CaptainSprite> = { busy: 'busy', idle: 'idle', alert: 'alert', offline: 'offline' }

export const captainSrc = (pose: CaptainPose) => (pose === 'empty' ? SHIP_SPRITES.chair.src : SHIP_SPRITES.captain[CAPTAIN[pose]].src)

/** A parent at its console (busy types, idle crosses its arms, alert stands and points, offline
 *  slumps), or the empty chair. `big`: with its topic and action under it. */
export function CaptainFigure({
  captain: c,
  pos,
  big,
  focused,
  lit,
  onOpen,
  onHover,
}: Omit<Picks, 'onSelect'> & { captain: Captain; pos: { x: number; y: number }; big: boolean; focused: boolean; lit: boolean }) {
  const topic = captainTopic(c)
  const hover = { kind: 'captain', id: c.id } as const
  const sid = c.parent?.session_id ?? null
  const shaking = useScene().memory.shaking(sid)
  return (
    <button
      type="button"
      className="ship-captain"
      data-ship-id={c.id}
      data-pose={c.pose}
      data-big={on(big)}
      data-focus={on(focused)}
      data-hl={on(lit)}
      data-shake={on(shaking)}
      style={at(pos.x, pos.y)}
      title={captainHover(c)}
      aria-label={`${c.name}: ${c.pose === 'empty' ? 'no parent' : c.pose}`}
      onClick={() => c.parent && onOpen(c.id)}
      onMouseEnter={() => onHover(hover)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(hover)}
      onBlur={() => onHover(null)}
    >
      <span className="ship-floor" aria-hidden />
      <span className="ship-console">
        <img className="ship-px" data-sprite={c.pose === 'empty' ? 'chair' : c.pose} src={captainSrc(c.pose)} alt="" draggable={false} />
        <RuleCount sessionId={sid} />
      </span>
      {c.notices > 0 && (
        <span className="ship-mail" title="notices from its children waiting for its next prompt">
          ✉ {c.notices}
        </span>
      )}
      <span className="ship-cname">
        <span className="ship-em">{c.emblem}</span> {c.pose === 'empty' ? 'no parent' : c.name}
      </span>
      {big && topic && <span className="ship-topic">{topic}</span>}
      {big && c.action && <span className="ship-pact">{c.action}</span>}
    </button>
  )
}

/** A captain in a dock: its whole console at 64 px, its name under it in up to two lines. */
export function DockedCaptain({ captain: c, focused, onOpen }: { captain: Captain; focused: boolean; onOpen(id: string): void }) {
  const sid = c.parent?.session_id ?? null
  const shaking = useScene().memory.shaking(sid)
  return (
    <button type="button" className="ship-docked" data-ship-id={c.id} data-pose={c.pose} data-focus={on(focused)} data-shake={on(shaking)} title={captainHover(c)} onClick={() => c.parent && onOpen(c.id)}>
      <img className="ship-px" src={captainSrc(c.pose)} alt="" draggable={false} />
      <RuleCount sessionId={sid} />
      <span>
        <span className="ship-em">{c.emblem}</span> {c.name}
      </span>
    </button>
  )
}

/** A captain as a small chip: a quiet parent on a deck. Its console seen through a window, still
 *  at 1×; its name beside it in up to two lines. */
export function CaptainChip({ captain: c, focused, onOpen }: { captain: Captain; focused: boolean; onOpen(id: string): void }) {
  const shaking = useScene().memory.shaking(c.parent?.session_id ?? null)
  return (
    <button type="button" className="ship-chip-captain" data-ship-id={c.id} data-pose={c.pose} data-focus={on(focused)} data-shake={on(shaking)} title={captainHover(c)} onClick={() => c.parent && onOpen(c.id)}>
      <span className="ship-window" aria-hidden>
        <img className="ship-px" src={captainSrc(c.pose)} alt="" draggable={false} />
      </span>
      <span className="ship-em">{c.emblem}</span>
      <span className="ship-chip-name">{c.name}</span>
    </button>
  )
}

import type { AnimationEvent, CSSProperties, MouseEvent, ReactNode } from 'react'
import { SHIP_SPRITES, SPRITES, type CaptainSprite } from '../sprites'
import type { Captain, CaptainPose, ShipRobot } from '../ship-types'
import { useNewRule, useWalk, type Exit, type Leaver } from './motion'
import { captainTopic, glyph, particlesOf, poseOf, robotName } from './words'

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

/** A child: its body and accessory, its halo, its action badge and particles, its shuttle while
 *  its PR waits, the teleport pad when it beams in, ◈ when mnemo injects a rule. */
export function RobotFigure({ robot: r, emblem, pos, still = false, selected, focused, dimmed, arriving, onArrived, reducedMotion, onOpen, onSelect, onHover, children }: RobotFigureProps) {
  const { walking, left, onTransitionEnd } = useWalk(pos?.x ?? 0, reducedMotion || !pos || still)
  const { rule, flashed } = useNewRule(r.injected[0] ?? null)
  const fx = particlesOf(r)
  const click = (e: MouseEvent) => (e.shiftKey ? onSelect(r.id) : onOpen(r.id))
  const teleported = (e: AnimationEvent) => {
    if (e.target === e.currentTarget) onArrived(r.id)
  }
  const hover = { kind: 'robot', id: r.id } as const
  return (
    <div
      className="ship-robot"
      data-ship-id={r.id}
      data-session={r.sessionId ?? undefined}
      data-state={r.state}
      data-zone={r.zone}
      data-ci={r.state === 'done' && r.ci ? r.ci : undefined}
      data-selected={on(selected)}
      data-focus={on(focused)}
      data-dim={on(dimmed)}
      data-walking={on(walking)}
      data-left={on(left)}
      data-arriving={on(arriving)}
      data-placed={on(!!pos)}
      data-still={on(still)}
      style={pos ? at(pos.x, pos.y) : undefined}
      onTransitionEnd={onTransitionEnd}
    >
      {children}
      {arriving && <img className="ship-px ship-teleport" src={SHIP_SPRITES.teleport.src} alt="" draggable={false} onAnimationEnd={teleported} />}
      {r.state === 'done' && r.pr && <img className="ship-px ship-shuttle" src={SHIP_SPRITES.shuttle.docked.src} alt="" draggable={false} />}
      <button
        type="button"
        className="ship-figure"
        aria-label={`${robotName(r)}: ${r.state}`}
        onClick={click}
        onMouseEnter={() => onHover(hover)}
        onMouseLeave={() => onHover(null)}
        onFocus={() => onHover(hover)}
        onBlur={() => onHover(null)}
      >
        <span className="ship-halo" aria-hidden />
        <span className="ship-body">
          <img className="ship-px" src={SPRITES.accessories[r.accessory]?.src} alt="" draggable={false} />
          <img className="ship-px" src={SPRITES.robots[r.klass][poseOf(r)].src} alt="" draggable={false} />
        </span>
        {fx && <span className="ship-fx" data-fx={fx} aria-hidden />}
        <span className="ship-ab" aria-hidden>
          {glyph(r)}
        </span>
        {rule && (
          <span className="ship-rule" title={rule} onAnimationEnd={flashed}>
            ◈
          </span>
        )}
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
  return (
    <button
      type="button"
      className="ship-captain"
      data-ship-id={c.id}
      data-pose={c.pose}
      data-big={on(big)}
      data-focus={on(focused)}
      data-hl={on(lit)}
      style={at(pos.x, pos.y)}
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

/** A captain in a dock: its whole console at 64 px, its name under it. */
export function DockedCaptain({ captain: c, focused, onOpen }: { captain: Captain; focused: boolean; onOpen(id: string): void }) {
  return (
    <button type="button" className="ship-docked" data-ship-id={c.id} data-pose={c.pose} data-focus={on(focused)} title={c.topic ?? c.name} onClick={() => c.parent && onOpen(c.id)}>
      <img className="ship-px" src={captainSrc(c.pose)} alt="" draggable={false} />
      <span>
        <span className="ship-em">{c.emblem}</span> {c.name}
      </span>
    </button>
  )
}

/** A captain as a small chip: a quiet parent on a deck. Its console seen through a window, still
 *  at 1×. */
export function CaptainChip({ captain: c, focused, onOpen }: { captain: Captain; focused: boolean; onOpen(id: string): void }) {
  return (
    <button type="button" className="ship-chip-captain" data-ship-id={c.id} data-pose={c.pose} data-focus={on(focused)} title={c.topic ?? c.name} onClick={() => c.parent && onOpen(c.id)}>
      <span className="ship-window" aria-hidden>
        <img className="ship-px" src={captainSrc(c.pose)} alt="" draggable={false} />
      </span>
      <span className="ship-em">{c.emblem}</span>
      <span className="ship-chip-name">{c.name}</span>
    </button>
  )
}

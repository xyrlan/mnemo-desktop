import { useLayoutEffect, useMemo, useRef, useState, type AnimationEvent, type CSSProperties, type ReactNode, type RefObject } from 'react'
import type { PulseEvent } from '../pulse/types'
import { HoverCard } from './HoverCard'
import { Badge, toolIcon } from './scene/Badge'
import { flightOf, restOf, type Flight } from './scene/flights'
import { ARCHIVE, archiveLabel, CORE, coreLabel, layOut, NEXUS, PACKET, ROBOT, type NexusSpot, type Rect, type RobotSpot, type SceneLayout, type TerritorySpot } from './scene/layout'
import { useArrivals, usePackets } from './scene/motion'
import { SPRITES } from './sprites'
import type { Packet, Target, World } from './types'
import './nexus.css'

export type SceneProps = {
  world: World
  packets: Packet[]
  /** The recent pulse events, for the hover card. */
  events: PulseEvent[]
  /** A click on a nexus, robot or archive. */
  onPick(target: Target): void
  /** `prefers-reduced-motion`: no travel and no loops; counters and halos only. */
  reducedMotion: boolean
  /** False while the window is hidden: animations pause. */
  visible: boolean
}

/** The drawer's size before it is measured (and in jsdom, which lays nothing out). */
const UNMEASURED = { w: 1200, h: 800 }

/** The scroll box's inner size, kept current as the drawer resizes. */
function useBox(ref: RefObject<HTMLDivElement | null>): { w: number; h: number } {
  const [box, setBox] = useState(UNMEASURED)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const read = () => {
      const w = el.clientWidth
      const h = el.clientHeight
      if (w > 0 && h > 0) setBox((b) => (b.w === w && b.h === h ? b : { w, h }))
    }
    read()
    if (typeof ResizeObserver !== 'function') return
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return box
}

const px = (v: number) => `${v}px`
const at = (r: Rect): CSSProperties => ({ left: px(r.x), top: px(r.y), width: px(r.w), height: px(r.h) })
const square = (cx: number, cy: number, size: number): Rect => ({ x: cx - size / 2, y: cy - size / 2, w: size, h: size })

type Spots = Map<string, { target: Target; rect: Rect }>

const robotKey = (id: string) => `robot:${id}`
const nexusKey = (id: string) => `nexus:${id}`
const archiveKey = (root: string) => `archive:${root}`

/** Every pickable thing by key, with the box a hover card sits beside. */
function spotsOf(layout: SceneLayout): Spots {
  const s = layout.scale
  const targets: Spots = new Map()
  for (const t of layout.territories) {
    const { archive } = t.territory
    targets.set(archiveKey(t.territory.root), { target: { kind: 'archive', archive, root: t.territory.root }, rect: square(t.archive.x, t.archive.y, ARCHIVE * s) })
    for (const n of t.nexuses) {
      targets.set(nexusKey(n.nexus.sessionId), { target: { kind: 'nexus', nexus: n.nexus }, rect: square(n.x, n.y, NEXUS * s) })
      for (const r of n.robots) targets.set(robotKey(r.robot.id), { target: { kind: 'robot', robot: r.robot }, rect: r })
    }
  }
  return targets
}

/** The world drawn (spec Q4, Q11, Q16–Q18, Q21–Q23): territories in a grid that fits the drawer,
 *  robots in a ring round their nexus, the archive per territory and the universal core in the
 *  middle. Every sprite is a still, so every motion here is CSS (`nexus.css`): bobs, sways, the
 *  tool's swing, glow pulses, the warp in from the nexus, the exits and the packets' travel. With
 *  reduced motion only halos, badges and counters remain; while the window is hidden all of it
 *  pauses. */
export function Scene({ world, packets, events, onPick, reducedMotion, visible }: SceneProps) {
  const ref = useRef<HTMLDivElement>(null)
  const box = useBox(ref)
  const dpr = typeof window !== 'undefined' && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1
  const layout = useMemo(() => layOut(world, box, dpr), [world, box, dpr])
  const spots = useMemo(() => spotsOf(layout), [layout])
  const s = layout.scale

  const robotIds = useMemo(() => world.territories.flatMap((t) => t.nexuses.flatMap((n) => n.robots.map((r) => r.id))), [world])
  const { arriving, arrived } = useArrivals(robotIds, reducedMotion)
  const { active, landed } = usePackets(packets, world.at)

  const [hover, setHover] = useState<string | null>(null)
  const hovered = hover ? spots.get(hover) : undefined

  const pick = (key: string) => {
    const t = spots.get(key)
    if (t) onPick(t.target)
  }
  const touch = (key: string) => ({
    onClick: () => pick(key),
    onMouseEnter: () => setHover(key),
    onMouseLeave: () => setHover((h) => (h === key ? null : h)),
    onFocus: () => setHover(key),
    onBlur: () => setHover((h) => (h === key ? null : h)),
  })

  const flights = active.map((p) => flightOf(p, layout)).filter((f): f is Flight => !!f)

  return (
    <div
      ref={ref}
      className="nexus-scene"
      data-reduced={reducedMotion ? '' : undefined}
      data-paused={visible ? undefined : ''}
      style={{ '--s': s } as CSSProperties}
    >
      <div className="nexus-stage" style={{ width: px(layout.width), height: px(layout.height) }}>
        {layout.territories.map((t) => (
          <TerritoryView key={t.territory.root} spot={t} scale={s} arriving={arriving} onArrived={arrived} touch={touch} />
        ))}
        <div className="nexus-universal" data-tier={world.universal.tier} style={at(square(layout.core.x, layout.core.y, CORE * s))} title={`Universal rules: ${world.universal.pages} pages`}>
          <span className="nexus-glow" aria-hidden />
          <img className="nexus-px" src={SPRITES.universal.src} alt="" draggable={false} />
          <span className="nexus-label">{coreLabel(world.universal.pages)}</span>
        </div>
        {!world.territories.length && <p className="nexus-empty">No live sessions.</p>}
        {flights.map((f) => (
          <PacketView key={f.packet.id} flight={f} scale={s} reducedMotion={reducedMotion} onLanded={landed} />
        ))}
        {hovered && (
          <HoverAnchor rect={hovered.rect} width={layout.width}>
            <HoverCard target={hovered.target} events={events} now={world.at} />
          </HoverAnchor>
        )}
      </div>
    </div>
  )
}

type Touch = (key: string) => {
  onClick(): void
  onMouseEnter(): void
  onMouseLeave(): void
  onFocus(): void
  onBlur(): void
}

function TerritoryView({ spot, scale, arriving, onArrived, touch }: { spot: TerritorySpot; scale: number; arriving: ReadonlySet<string>; onArrived(id: string): void; touch: Touch }) {
  const { territory, archive } = spot
  const a = territory.archive
  return (
    <>
      <section className="nexus-territory" style={at(spot)} aria-label={territory.name}>
        <h3 className="nexus-territory-name">{territory.name}</h3>
      </section>
      <button
        type="button"
        className="nexus-archive"
        data-archive={territory.root}
        data-tier={a.tier}
        style={at(square(archive.x, archive.y, ARCHIVE * scale))}
        aria-label={`${a.project} archive: ${a.pages} pages`}
        {...touch(archiveKey(territory.root))}
      >
        <img className="nexus-px" src={SPRITES.archive[a.tier].src} alt="" draggable={false} />
        <span className="nexus-label">{archiveLabel(a)}</span>
      </button>
      {spot.nexuses.map((n) => (
        <NexusView key={n.nexus.sessionId} spot={n} scale={scale} arriving={arriving} onArrived={onArrived} touch={touch} />
      ))}
    </>
  )
}

function NexusView({ spot, scale, arriving, onArrived, touch }: { spot: NexusSpot; scale: number; arriving: ReadonlySet<string>; onArrived(id: string): void; touch: Touch }) {
  const { nexus } = spot
  return (
    <>
      {spot.robots.length > 0 && <span className="nexus-orbit" style={at(square(spot.x, spot.y, spot.r * 2))} aria-hidden />}
      <button
        type="button"
        className="nexus-core"
        data-nexus={nexus.sessionId}
        data-pose={nexus.pose}
        data-halo={nexus.halo ?? undefined}
        style={at(square(spot.x, spot.y, NEXUS * scale))}
        aria-label={`${nexus.label}: ${nexus.pose}`}
        {...touch(nexusKey(nexus.sessionId))}
      >
        {nexus.halo && <span className="nexus-halo" aria-hidden />}
        <span className="nexus-glow" aria-hidden />
        <img className="nexus-px" src={SPRITES.nexus[nexus.pose].src} alt="" draggable={false} />
        <span className="nexus-label">{nexus.label}</span>
        {spot.hidden > 0 && <span className="nexus-more">+{spot.hidden}</span>}
      </button>
      {spot.robots.map((r) => (
        <RobotView key={r.robot.id} spot={r} home={spot} scale={scale} arriving={arriving.has(r.robot.id)} onArrived={onArrived} touch={touch} />
      ))}
    </>
  )
}

function RobotView({ spot, home, scale, arriving, onArrived, touch }: { spot: RobotSpot; home: NexusSpot; scale: number; arriving: boolean; onArrived(id: string): void; touch: Touch }) {
  const { robot } = spot
  const Tool = robot.tool && robot.pose === 'working' ? toolIcon(robot.tool) : null
  const style = { ...at(spot), '--dx': px(home.x - spot.cx), '--dy': px(home.y - spot.cy) } as CSSProperties
  const onAnimationEnd = (e: AnimationEvent) => {
    if (e.target === e.currentTarget && e.animationName === 'nexus-warp-in') onArrived(robot.id)
  }
  return (
    <button
      type="button"
      className="nexus-robot"
      data-robot={robot.id}
      data-class={robot.klass}
      data-pose={robot.pose}
      data-halo={robot.halo ?? undefined}
      data-exit={robot.exit ?? undefined}
      data-level={robot.level || undefined}
      data-arriving={arriving ? '' : undefined}
      style={style}
      aria-label={`${robot.label}: ${robot.pose}`}
      onAnimationEnd={onAnimationEnd}
      {...touch(robotKey(robot.id))}
    >
      {robot.halo && <span className="nexus-halo" aria-hidden />}
      {robot.level > 0 && <span className="nexus-aura" aria-hidden />}
      <img className="nexus-px nexus-plate" src={SPRITES.accessories[robot.accessory]?.src} alt="" draggable={false} />
      <span className="nexus-body">
        <img className="nexus-px" src={SPRITES.robots[robot.klass][robot.pose].src} alt="" draggable={false} />
      </span>
      {Tool && (
        <span className="nexus-tool" data-tool={robot.tool} style={{ width: px(14 * scale), height: px(14 * scale) }} aria-hidden>
          <Tool size={Math.round(12 * scale)} strokeWidth={2.5} />
        </span>
      )}
      {robot.badge && (
        <span className="nexus-badge-slot">
          <Badge kind={robot.badge} scale={scale} />
        </span>
      )}
      <span className="nexus-label">{robot.label}</span>
      {robot.exit === 'merged' && <span className="nexus-burst" aria-hidden />}
    </button>
  )
}

/** A packet: in the air between the archive and its agent, a glow on the archive, or — with
 *  reduced motion — resting at the end it was going to, its counter only. */
function PacketView({ flight, scale, reducedMotion, onLanded }: { flight: Flight; scale: number; reducedMotion: boolean; onLanded(id: string): void }) {
  const { packet, path } = flight
  const size = PACKET * scale
  const onAnimationEnd = (e: AnimationEvent) => {
    if (e.target === e.currentTarget) onLanded(packet.id)
  }
  const count = packet.count > 1 ? <span className="nexus-count">×{packet.count}</span> : null
  if (reducedMotion) {
    const rest = restOf(flight)
    return (
      <span className="nexus-mark" data-packet={packet.id} data-path={path} style={at(square(rest.x, rest.y - (ROBOT / 2) * scale, size))} onAnimationEnd={onAnimationEnd}>
        <img className="nexus-px" src={SPRITES.packet.src} alt="" draggable={false} />
        {count}
      </span>
    )
  }
  if (path === 'flash') {
    return (
      <span className="nexus-flash" data-packet={packet.id} data-path={path} data-kind={packet.kind} style={at(square(flight.archive.x, flight.archive.y, ARCHIVE * scale))} onAnimationEnd={onAnimationEnd}>
        {count}
      </span>
    )
  }
  const style = {
    ...at({ x: 0, y: 0, w: size, h: size }),
    '--ax': px(flight.archive.x - size / 2),
    '--ay': px(flight.archive.y - size / 2),
    '--gx': px(flight.agent.x - size / 2),
    '--gy': px(flight.agent.y - size / 2),
  } as CSSProperties
  return (
    <span className="nexus-packet" data-packet={packet.id} data-path={path} data-kind={packet.kind} style={style} onAnimationEnd={onAnimationEnd}>
      <img className="nexus-px" src={SPRITES.packet.src} alt="" draggable={false} />
      {count}
    </span>
  )
}

/** Beside the hovered thing, on whichever side has the room. */
function HoverAnchor({ rect, width, children }: { rect: Rect; width: number; children: ReactNode }) {
  const left = rect.x + rect.w / 2 < width * 0.6
  const style: CSSProperties = { left: px(left ? rect.x + rect.w + 8 : rect.x - 8), top: px(Math.max(8, rect.y)) }
  return (
    <div className="nexus-hover-anchor" data-side={left ? 'right' : 'left'} style={style}>
      {children}
    </div>
  )
}

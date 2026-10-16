import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type AnimationEvent, type CSSProperties, type JSX, type RefObject } from 'react'
import type { Pulse } from '../../pulse/store'
import type { Progress } from '../../vaultlevel/level'
import { XP_PER_LEVEL } from '../../vaultlevel/level'
import { SHIP_SPRITES } from '../sprites'
import { openWindow } from '../ui/windows'
import { chooseRepo } from '../windows/memory/repo'
import { useScene } from './context'
import {
  floatOf,
  GLOW_MS,
  ICON_COLOURS,
  ICONS,
  KIND_LABEL,
  launch,
  packetOf,
  LEARNED_GLOW_MS,
  LED_COLOURS,
  LEDS,
  rulesOf,
  sessionOf,
  type Packet,
  type PacketIcon,
  type Session,
} from './packets'

/** mnemo's memory drawn (issue #472): each deck's archive tower, the packets flying between it and
 *  the figures, and what they change when they land. The flights are CSS (`ship.css`); this only
 *  says what flies where. With reduced motion, or while the window is hidden, nothing flies: the
 *  counts change and the tower glows. */

export type Glow = 'short' | 'long'
export type Level = Progress | 'none' | null

/** What the figures and the archives read from the scene's memory. */
export type MemoryCtx = {
  /** The rules session `sessionId` got that have landed, each once, oldest first. */
  rules(sessionId: string | null): string[]
  shaking(sessionId: string | null): boolean
  glow(root: string): Glow | undefined
  level: Level
}

type Point = { x: number; y: number }
/** A packet in the air: the leg it is on, where the archive and the figure were when it left, and
 *  the archive it belongs to. */
type Flight = Packet & { leg: number; a: Point; f: Point; root: string }
type Float = { id: number; x: number; y: number; text: string }
type Card = { packet: Packet; x: number; y: number }

const px = (v: number) => `${v}px`

/** How long the figure shakes when enforcement stops it, and a reflex's rule floats up. */
const SHAKE_MS = 450
const FLOAT_MS = 1_500
/** A flight whose `animationend` never comes (its node was hidden) still lands. */
const LATE = 3

/** The figure on the stage drawn for `sessionId`: a robot (`data-session`) or a captain (its id is
 *  its session's), on a deck, a dock or the bridge; not one leaving. */
function figureEl(stage: HTMLElement, sessionId: string): HTMLElement | null {
  for (const el of stage.querySelectorAll<HTMLElement>('.ship-robot[data-session], .ship-captain[data-ship-id], .ship-docked[data-ship-id], .ship-chip-captain[data-ship-id]')) {
    if (el.dataset.session === sessionId || (!el.classList.contains('ship-robot') && el.dataset.shipId === sessionId)) return el
  }
  return null
}

/** The archive a figure's packets fly from: its own deck's or dock's, else (a robot on the bridge)
 *  the one of the repo the event names. */
function archiveEl(stage: HTMLElement, fig: HTMLElement, project: string): HTMLElement | null {
  const home = fig.closest<HTMLElement>('[data-deck], [data-dock]')
  const own = home?.querySelector<HTMLElement>('[data-archive]')
  if (own) return own
  return [...stage.querySelectorAll<HTMLElement>('[data-archive]')].find((a) => a.dataset.archiveName === project) ?? null
}

/** `el`'s middle in the stage's coordinates; a figure's, at its body. */
function pointOf(stage: HTMLElement, el: HTMLElement, body = false): Point {
  const s = stage.getBoundingClientRect()
  const r = el.getBoundingClientRect()
  return { x: r.left - s.left + r.width / 2, y: r.top - s.top + (body ? Math.min(r.height / 2, 36) : r.height / 2) }
}

/** The scene's memory: every pulse since the ship was drawn launches its packet (none for what was
 *  logged before: opening the view replays nothing). A figure's count leaves out the rules still in
 *  flight to it, so it changes as they land. */
export function useMemory({
  pulses,
  sessions,
  stage,
  reducedMotion,
  visible,
  level,
}: {
  pulses: readonly Pulse[]
  sessions: readonly Session[]
  stage: RefObject<HTMLElement | null>
  reducedMotion: boolean
  visible: boolean
  level: Level
}): { memory: MemoryCtx; layer: LayerProps } {
  const [flying, setFlying] = useState<Flight[]>([])
  const flyingRef = useRef<Flight[]>([])
  const [floats, setFloats] = useState<Float[]>([])
  const [glows, setGlows] = useState<Record<string, Glow>>({})
  const [shaken, setShaken] = useState<ReadonlySet<string>>(() => new Set())
  const [card, setCard] = useState<Card | null>(null)
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())
  const nextId = useRef(1)
  const seen = useRef<number | null>(null)

  const later = useCallback((ms: number, fn: () => void) => {
    const t = setTimeout(() => {
      timers.current.delete(t)
      fn()
    }, ms)
    timers.current.add(t)
  }, [])
  useEffect(() => {
    const all = timers.current
    return () => {
      for (const t of all) clearTimeout(t)
      all.clear()
    }
  }, [])

  const fly = useCallback((next: Flight[]) => {
    flyingRef.current = next
    setFlying(next)
  }, [])
  const glow = useCallback(
    (root: string, g: Glow) => {
      setGlows((prev) => ({ ...prev, [root]: prev[root] === 'long' ? 'long' : g }))
      later(g === 'long' ? LEARNED_GLOW_MS : GLOW_MS, () =>
        setGlows((prev) => {
          if (!(root in prev)) return prev
          const { [root]: _, ...rest } = prev
          return rest
        }),
      )
    },
    [later],
  )
  const shake = useCallback(
    (sessionId: string) => {
      setShaken((prev) => new Set([...prev, sessionId]))
      later(SHAKE_MS, () =>
        setShaken((prev) => {
          const next = new Set(prev)
          next.delete(sessionId)
          return next
        }),
      )
    },
    [later],
  )

  /** A packet at the end of its last leg (or dropped: `flown` false, where nothing shows). */
  const land = useCallback(
    (f: Flight, flown: boolean) => {
      if (f.spec.landing === 'glow') glow(f.root, 'short')
      if (!flown) return
      if (f.spec.landing === 'shake') shake(f.sessionId)
      if (f.kind === 'reflex') {
        const id = nextId.current++
        setFloats((prev) => [...prev, { id, x: f.f.x, y: f.f.y - 40, text: f.n > 1 ? `×${f.n} ${floatOf(f)}` : floatOf(f) }])
        later(FLOAT_MS, () => setFloats((prev) => prev.filter((x) => x.id !== id)))
      }
    },
    [glow, shake, later],
  )

  const legEnded = useCallback(
    (id: number, leg: number) => {
      const f = flyingRef.current.find((x) => x.id === id)
      if (!f || f.leg !== leg) return
      // A round trip turns at the archive: it glows, and the packet comes back with what it read.
      if (f.spec.legs[leg] === 'in') glow(f.root, 'short')
      if (leg + 1 < f.spec.legs.length) return fly(flyingRef.current.map((x) => (x.id === id ? { ...x, leg: leg + 1 } : x)))
      fly(flyingRef.current.filter((x) => x.id !== id))
      land(f, true)
    },
    [fly, glow, land],
  )

  useLayoutEffect(() => {
    const last = seen.current
    seen.current = pulses.length ? Math.max(last ?? 0, pulses[pulses.length - 1].id) : (last ?? 0)
    if (last === null) return
    const fresh = pulses.filter((p) => p.id > last)
    if (!fresh.length) return
    const el = stage.current
    let next = flyingRef.current
    const now = Date.now()
    for (const p of fresh) {
      const e = p.event
      if (e.kind === 'learned') {
        // The vault learned a rule: the archive of its repo glows longer (and its level may tick).
        if (el) for (const a of el.querySelectorAll<HTMLElement>('[data-archive]')) if (a.dataset.archiveName === e.project) glow(a.dataset.archive!, 'long')
        continue
      }
      const sid = sessionOf(e, sessions)
      const fig = sid && el ? figureEl(el, sid) : null
      const arc = fig && el ? archiveEl(el, fig, e.project) : null
      if (!sid || !fig || !arc || !el) continue
      const root = arc.dataset.archive!
      if (reducedMotion || !visible) {
        // Nothing flies: the count has already changed; the archive glows for what came in.
        const spec = packetOf(e.kind)
        if (spec?.legs.includes('in')) glow(root, 'short')
        continue
      }
      const l = launch(next, p, sid, nextId.current, now)
      if (!l) continue
      if (!l.joined) nextId.current++
      const a = pointOf(el, arc)
      const f = pointOf(el, fig, true)
      const before = next
      next = l.flying.map((x) => {
        const was = before.find((y) => y.id === x.id)
        return was ? { ...was, ...x } : { ...x, leg: 0, a, f, root }
      })
      for (const d of l.dropped) land(before.find((x) => x.id === d.id)!, false)
      if (!l.joined) later(LATE * l.packet.spec.ms * l.packet.spec.legs.length + 1_000, () => {
        const f = flyingRef.current.find((x) => x.id === l.packet.id)
        if (f) {
          fly(flyingRef.current.filter((x) => x.id !== f.id))
          land(f, false)
        }
      })
    }
    if (next !== flyingRef.current) fly(next)
    // `sessions` and the flags are read as they are when a pulse arrives.
  }, [pulses])

  // A hidden window or reduced motion lands what is in the air at once.
  useEffect(() => {
    if (visible && !reducedMotion) return
    const all = flyingRef.current
    if (!all.length) return
    fly([])
    for (const f of all) land(f, false)
  }, [visible, reducedMotion, fly, land])

  const pending = useMemo(() => new Set(flying.flatMap((f) => f.pulses)), [flying])
  const got = useMemo(() => rulesOf(pending.size ? pulses.filter((p) => !pending.has(p.id)) : pulses, sessions), [pulses, sessions, pending])

  const memory: MemoryCtx = {
    rules: (sid) => (sid ? (got.get(sid) ?? []) : []),
    shaking: (sid) => !!sid && shaken.has(sid),
    glow: (root) => glows[root],
    level,
  }
  return { memory, layer: { flying, floats, card, onLeg: legEnded, onCard: setCard } }
}

type LayerProps = {
  flying: Flight[]
  floats: Float[]
  card: Card | null
  onLeg(id: number, leg: number): void
  onCard(card: Card | null): void
}

/** A packet's 10×10 icon, as pixels. */
export function PacketIconSvg({ name, size = 20 }: { name: PacketIcon | 'learned'; size?: number }): JSX.Element {
  const rows = ICONS[name]
  return (
    <svg className="ship-pk-ico" width={size} height={size} viewBox="0 0 10 10" shapeRendering="crispEdges" aria-hidden>
      {rows.flatMap((row, y) => [...row].flatMap((c, x) => (ICON_COLOURS[c] ? [<rect key={`${x},${y}`} x={x} y={y} width={1} height={1} fill={ICON_COLOURS[c]} />] : [])))}
    </svg>
  )
}

/** The packets in flight, the rules floating up from where they landed, and the card of the one
 *  clicked. Over the whole stage; only the packets and the card take clicks. */
export function MemoryLayer({ flying, floats, card, onLeg, onCard }: LayerProps): JSX.Element {
  useEffect(() => {
    if (!card) return
    const away = (e: Event) => {
      if (!(e.target as HTMLElement | null)?.closest?.('.ship-pk-card, .ship-pk')) onCard(null)
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      onCard(null)
    }
    document.addEventListener('pointerdown', away, true)
    document.addEventListener('keydown', esc, true)
    return () => {
      document.removeEventListener('pointerdown', away, true)
      document.removeEventListener('keydown', esc, true)
    }
  }, [card, onCard])
  return (
    <div className="ship-memory" aria-hidden={!flying.length && !card ? true : undefined}>
      {flying.map((f) => {
        const leg = f.spec.legs[f.leg]
        const [from, to] = leg === 'out' ? [f.a, f.f] : [f.f, f.a]
        const style = {
          '--x0': px(from.x),
          '--y0': px(from.y),
          '--x1': px(to.x),
          '--y1': px(to.y),
          '--top': px(Math.min(from.y, to.y) - 50),
          '--ms': `${f.spec.ms}ms`,
        } as CSSProperties
        const ended = (e: AnimationEvent) => {
          if (e.target === e.currentTarget) onLeg(f.id, f.leg)
        }
        return (
          <button
            key={`${f.id}:${f.leg}`}
            type="button"
            className="ship-pk"
            data-packet={f.kind}
            data-dir={f.spec.dir}
            data-session-to={f.sessionId}
            style={style}
            aria-label={`memory packet: ${KIND_LABEL[f.kind]}${f.n > 1 ? ` ×${f.n}` : ''}`}
            onAnimationEnd={ended}
            onClick={(e) => {
              e.stopPropagation()
              const r = e.currentTarget.getBoundingClientRect()
              const s = e.currentTarget.parentElement!.getBoundingClientRect()
              onCard({ packet: f, x: r.left - s.left, y: r.top - s.top })
            }}
          >
            <span className="ship-pk-y">
              <span className="ship-pk-box">
                <PacketIconSvg name={f.spec.icons[f.leg] ?? f.spec.icon} />
              </span>
              {f.n > 1 && <span className="ship-pk-n">×{f.n}</span>}
            </span>
          </button>
        )
      })}
      {floats.map((f) => (
        <span key={f.id} className="ship-pk-say" style={{ left: px(f.x), top: px(f.y) }}>
          {f.text}
        </span>
      ))}
      {card && <PacketCard card={card} />}
    </div>
  )
}

function PacketCard({ card: { packet: p, x, y } }: { card: Card }): JSX.Element {
  return (
    <div className="ship-pk-card" data-packet-card={p.kind} role="dialog" aria-label="memory packet" style={{ left: px(x + 30), top: px(Math.max(0, y - 10)) }}>
      <b>
        <PacketIconSvg name={p.spec.icon} size={10} /> {KIND_LABEL[p.kind]}
        {p.n > 1 ? ` ×${p.n}` : ''}
      </b>
      {p.slugs.length ? (
        <ul>
          {p.slugs.map((s) => (
            <li key={s}>
              <code>{s}</code>
            </li>
          ))}
        </ul>
      ) : (
        <p>no rule named</p>
      )}
    </div>
  )
}

/** A figure's rule count, ◈N, once it got any: the rules that have landed, listed on hover. */
export function RuleCount({ sessionId }: { sessionId: string | null }): JSX.Element | null {
  const rules = useScene().memory.rules(sessionId)
  if (!rules.length) return null
  return (
    <span className="ship-rc" data-rules={rules.length} title={`mnemo's rules this session: ${rules.join(', ')}`} aria-label={`${rules.length} rules from mnemo`}>
      <PacketIconSvg name="reflex" size={8} />
      {rules.length}
    </span>
  )
}

/** A deck's or a dock's archive: its repo's memory, the 24×24 tower with its LEDs, then the vault's
 *  level. Click or Enter opens the Memory window on that repo. */
export function Archive({ root, name }: { root: string; name: string }): JSX.Element {
  const { memory } = useScene()
  const level = memory.level
  const n = level && level !== 'none' ? level.level : null
  // The level ticks (its LV flashes) when it goes up, not when it is first read.
  const was = useRef<number | null>(n)
  const up = n !== null && was.current !== null && n > was.current
  useEffect(() => {
    if (n !== null) was.current = n
  }, [n])
  const title = level && level !== 'none' ? `${name}'s memory · the vault's level ${level.level}, ${level.into}/${XP_PER_LEVEL} xp to ${level.level + 1} · open Memory` : `${name}'s memory · open Memory`
  return (
    <button
      type="button"
      className="ship-archive"
      data-archive={root}
      data-archive-name={name}
      data-glow={memory.glow(root)}
      title={title}
      aria-label={`${name}'s archive: open Memory`}
      onClick={() => {
        chooseRepo(root)
        openWindow('memory')
      }}
    >
      <span className="ship-tower">
        <img className="ship-px" src={SHIP_SPRITES.archive.src} alt="" draggable={false} />
        {LEDS.map(([x, y], i) => (
          <i key={i} style={{ left: px(x), top: px(y), background: LED_COLOURS[i % LED_COLOURS.length], animationDelay: `${((i * 0.37) % 1.6).toFixed(2)}s` }} />
        ))}
      </span>
      {n !== null && (
        <span key={n} className={up ? 'ship-lv ship-tick' : 'ship-lv'} data-level={n}>
          LV{n}
        </span>
      )}
    </button>
  )
}

/** The vault as a creature, at the foot of the sidebar: a halo of dots that grows with the
 *  vault, the octopus tinted by its health, and a level that never walks backwards.
 *
 *  One octopus on screen: when a pulse arrives it shrinks out of the square while the
 *  presence overlay plays, and comes back when the scene ends. The halo stays. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { POSES, SCENES, withPartIndex } from '../avatar/scenes'
import { OVERLAY_MS } from '../pulse/Overlay'
import type { PulseStore } from '../pulse/store'
import type { PulseKind } from '../pulse/types'
import type { LevelClient } from './client'
import { flashed, haloDots, haloLayout, healthOf, levelOf, onFire, poseOf, toneOf, xpOf } from './level'
import type { VaultLevel } from './types'
import '../avatar/avatar.css'
import './vaultlevel.css'

/** The square's height, and the width it falls back to before it has been measured. The width
 *  is whatever the sidebar's slot gives it, however wide the user has dragged the sidebar; only
 *  the octopus stays a fixed 80px, because pixel art does not stretch. */
export const SQUARE = 160
/** `vault_level` is cached 10s on the Rust side; the square has no reason to ask faster. */
export const POLL_MS = 30_000
/** How long the dots a pulse lit stay lit. */
export const FLASH_MS = 700
/** How long the octopus takes to eat a fragment after a `learned` scene ends. */
export const EAT_MS = 1400

type Props = {
  client: LevelClient
  pulses: PulseStore
  pollMs?: number
  /** What the ▤ button does. Injected so the square stays free of the layout store. */
  openVault?: () => void
}

export default function Square({ client, pulses, pollMs = POLL_MS, openVault }: Props) {
  const [vault, setVault] = useState<VaultLevel>()
  const [best, setBest] = useState(0)
  const [away, setAway] = useState(false)
  const [eating, setEating] = useState(false)
  const [lit, setLit] = useState<Set<number>>(new Set())

  useEffect(() => {
    let live = true
    const tick = async () => {
      try {
        const v = await client.level()
        if (!live) return
        setVault(v)
        if (v.error) return
        const b = await client.best(xpOf(v))
        if (live) setBest((prev) => Math.max(prev, b))
      } catch (e) {
        console.warn('vault level: not read', e)
      }
    }
    void tick()
    const timer = setInterval(tick, pollMs)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [client, pollMs])

  // The square fills its slot rather than sitting in a 160px column with empty margins, so it
  // has to know how wide that slot actually is.
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(SQUARE)
  useEffect(() => {
    const el = box.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(SQUARE, Math.round(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // The halo orbits in a fixed 160-unit box: `haloLayout` uses one `size` for both axes, so
  // handing it the width would centre the orbit off the bottom of a wide square. The group
  // below shifts that box to the middle of whatever width the slot gives us.
  const dots = useMemo(() => haloLayout(haloDots(vault?.pages ?? 0), SQUARE), [vault?.pages])
  const dotCount = dots.length

  // The octopus leaves for as long as a scene plays, with the overlay's own throttle.
  const played = useRef<Partial<Record<PulseKind, number>>>({})
  useEffect(() => {
    let seen = pulses.getState().log.at(-1)?.id ?? 0
    let back: ReturnType<typeof setTimeout> | undefined
    let unflash: ReturnType<typeof setTimeout> | undefined
    let done: ReturnType<typeof setTimeout> | undefined
    const unsub = pulses.subscribe((s) => {
      const last = s.log.at(-1)
      if (!last || last.id === seen) return
      seen = last.id
      const kind = last.event.kind
      const gap = SCENES[kind]?.minIntervalMs ?? 0
      if (gap > 0 && last.received - (played.current[kind] ?? 0) < gap) return
      played.current[kind] = last.received
      setAway(true)
      setLit(flashed(last.id, dotCount))
      clearTimeout(back)
      clearTimeout(unflash)
      back = setTimeout(() => {
        setAway(false)
        // A rule was born while he was out: he comes back and takes it in. Only `learned`,
        // and only after the scene — eating during it would fight the overlay for the same
        // moment. Firing a rule is using memory, not absorbing it, so it never eats.
        if (kind === 'learned') {
          setEating(true)
          done = setTimeout(() => setEating(false), EAT_MS)
        }
      }, OVERLAY_MS)
      unflash = setTimeout(() => setLit(new Set()), FLASH_MS)
    })
    return () => {
      unsub()
      clearTimeout(back)
      clearTimeout(unflash)
      clearTimeout(done)
    }
  }, [pulses, dotCount])

  const ok = !!vault && !vault.error
  // Two different questions. A vault with no pages is not a sick vault, it is an empty one:
  // `healthOf` floors at 0 for it, which as a tone would paint it red and sink its pose as
  // though something were wrong. It has a level and a HUD; it has no health yet.
  const rated = ok && vault.pages > 0
  const health = rated ? healthOf(vault) : 0
  const tone = rated ? toneOf(health) : 'muted'
  const pose = POSES[rated ? poseOf(toneOf(health)) : 'fair']
  const fire = rated && onFire(health, vault.fired_recent)
  const { level, fraction } = levelOf(best)
  const label = rated
    ? `vault level ${level}, health ${Math.round(health * 100)}%${fire ? ', on fire' : ''}`
    : ok
      ? 'the vault is empty'
      : vault?.error ?? 'reading the vault'
  const detail = rated
    ? `${vault.pages} pages · ${vault.rules_fired} fired (${vault.fired_recent} this week) · ${vault.dormant} dormant · ${vault.inbox} in inbox`
    : label

  return (
    <div ref={box} className={`vl-square vl-${tone}${fire ? ' vl-on-fire' : ''}`} role="img" aria-label={label} title={detail}>
      <svg className="vl-halo" width={width} height={SQUARE} viewBox={`0 0 ${width} ${SQUARE}`} aria-hidden="true">
        <g transform={`translate(${(width - SQUARE) / 2} 0)`}>
          {dots.map((d, i) => (
            <rect
              key={i}
              className={lit.has(i) ? 'vl-dot vl-lit' : 'vl-dot'}
              x={d.x}
              y={d.y}
              width={d.w}
              height={d.h}
              transform={`rotate(${d.a} ${d.x + d.w / 2} ${d.y + d.h / 2})`}
              style={{ animationDelay: `${(i % 9) * 0.35}s` }}
            />
          ))}
        </g>
      </svg>
      <div className={`vl-octo${away ? ' vl-away' : ''}${eating ? ' vl-eating' : ''}`}>
        {fire && <Flames />}
        {eating && <Morsel />}
        {/* No `av-<tone>` class: `avatar.css` only defines four of them, so lime and orange
            would fall back to the accent. The square paints from its own five-step ramp. */}
        <svg className={`av vl-body ${pose.className}`} width={80} height={80} viewBox="0 0 32 32" shapeRendering="crispEdges" aria-hidden="true">
          {withPartIndex(pose.rects).map(([rect, n], i) => (
            <rect key={i} className={`av-${rect.part} av-${rect.part}-${n}`} x={rect.x} y={rect.y} width={rect.w} height={rect.h} />
          ))}
        </svg>
      </div>
      {openVault && (
        <button className="vl-open" onClick={openVault} title="Open the vault" aria-label="Open the vault">
          ▤
        </button>
      )}
      <div className="vl-hud">
        <span className="vl-level">{ok ? `lv ${level}` : 'no vault'}</span>
        <span className="vl-bar" aria-hidden="true">
          <span className="vl-fill" style={{ width: `${Math.round(fraction * 100)}%` }} />
        </span>
      </div>
    </div>
  )
}

/** The fragment a `learned` scene leaves behind: it drifts up to the head and is gone.
 *  Same mark as a halo note, so what he eats is visibly one of them. */
function Morsel() {
  return (
    <svg className="vl-morsel" width={80} height={80} viewBox="0 0 32 32" shapeRendering="crispEdges" aria-hidden="true">
      <rect x={14.6} y={26} width={3.4} height={3.9} transform="rotate(-12 16.3 28)" />
    </svg>
  )
}

/** Three pixel flames under the octopus, flickering out of step. */
function Flames() {
  return (
    <svg className="vl-fire" width={80} height={24} viewBox="0 0 32 10" shapeRendering="crispEdges" aria-hidden="true">
      {[11, 16, 21].map((x, i) => (
        <g key={x} className={`vl-flame vl-flame-${i}`}>
          {/* A tongue tapering to one pixel. Three of them, and no shared base: five wide-based
              tongues merged into an unbroken red bar that read as a birthday cake. */}
          <rect x={x - 1} y={6} width={3} height={4} />
          <rect x={x} y={3} width={1} height={3} />
        </g>
      ))}
    </svg>
  )
}

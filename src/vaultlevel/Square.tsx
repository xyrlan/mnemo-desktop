/** The vault as a creature, at the foot of the sidebar: a halo of dots that grows with the
 *  vault, the octopus tinted by its health, and a level that never walks backwards.
 *
 *  One octopus on screen: when a pulse arrives it shrinks out of the square while the
 *  presence overlay plays, and comes back when the scene ends. The halo stays. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { IDLE, SCENES, withPartIndex } from '../avatar/scenes'
import { OVERLAY_MS } from '../pulse/Overlay'
import type { PulseStore } from '../pulse/store'
import type { PulseKind } from '../pulse/types'
import type { LevelClient } from './client'
import { flashed, haloDots, haloLayout, healthOf, levelOf, onFire, toneOf, xpOf } from './level'
import type { VaultLevel } from './types'
import '../avatar/avatar.css'
import './vaultlevel.css'

export const SQUARE = 160
/** `vault_level` is cached 10s on the Rust side; the square has no reason to ask faster. */
export const POLL_MS = 30_000
/** How long the dots a pulse lit stay lit. */
export const FLASH_MS = 700

type Props = { client: LevelClient; pulses: PulseStore; pollMs?: number }

export default function Square({ client, pulses, pollMs = POLL_MS }: Props) {
  const [vault, setVault] = useState<VaultLevel>()
  const [best, setBest] = useState(0)
  const [away, setAway] = useState(false)
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

  const dots = useMemo(() => haloLayout(haloDots(vault?.pages ?? 0), SQUARE), [vault?.pages])
  const dotCount = dots.length

  // The octopus leaves for as long as a scene plays, with the overlay's own throttle.
  const played = useRef<Partial<Record<PulseKind, number>>>({})
  useEffect(() => {
    let seen = pulses.getState().log.at(-1)?.id ?? 0
    let back: ReturnType<typeof setTimeout> | undefined
    let unflash: ReturnType<typeof setTimeout> | undefined
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
      back = setTimeout(() => setAway(false), OVERLAY_MS)
      unflash = setTimeout(() => setLit(new Set()), FLASH_MS)
    })
    return () => {
      unsub()
      clearTimeout(back)
      clearTimeout(unflash)
    }
  }, [pulses, dotCount])

  const ok = !!vault && !vault.error
  const health = ok ? healthOf(vault) : 0
  const tone = ok ? toneOf(health) : 'muted'
  const fire = ok && onFire(health, vault.fired_recent)
  const { level, fraction } = levelOf(best)
  const label = ok
    ? `vault level ${level}, health ${Math.round(health * 100)}%${fire ? ', on fire' : ''}`
    : vault?.error ?? 'reading the vault'
  const detail = ok
    ? `${vault.pages} pages · ${vault.rules_fired} fired (${vault.fired_recent} this week) · ${vault.dormant} dormant · ${vault.inbox} in inbox`
    : label

  return (
    <div className={`vl-square vl-${tone}${fire ? ' vl-on-fire' : ''}`} role="img" aria-label={label} title={detail}>
      <svg className="vl-halo" width={SQUARE} height={SQUARE} viewBox={`0 0 ${SQUARE} ${SQUARE}`} aria-hidden="true">
        {dots.map((d, i) => (
          <circle key={i} className={lit.has(i) ? 'vl-dot vl-lit' : 'vl-dot'} cx={d.x} cy={d.y} r={d.r} style={{ animationDelay: `${(i % 9) * 0.35}s` }} />
        ))}
      </svg>
      <div className={away ? 'vl-octo vl-away' : 'vl-octo'}>
        {fire && <Flames />}
        <svg className={`av av-${tone === 'muted' ? 'muted' : tone} ${IDLE.className}`} width={80} height={80} viewBox="0 0 32 32" shapeRendering="crispEdges" aria-hidden="true">
          {withPartIndex(IDLE.rects).map(([rect, n], i) => (
            <rect key={i} className={`av-${rect.part} av-${rect.part}-${n}`} x={rect.x} y={rect.y} width={rect.w} height={rect.h} />
          ))}
        </svg>
      </div>
      <div className="vl-hud">
        <span className="vl-level">{ok ? `lv ${level}` : 'no vault'}</span>
        <span className="vl-bar" aria-hidden="true">
          <span className="vl-fill" style={{ width: `${Math.round(fraction * 100)}%` }} />
        </span>
      </div>
    </div>
  )
}

/** Three pixel flames under the octopus, flickering out of step. */
function Flames() {
  return (
    <svg className="vl-fire" width={80} height={24} viewBox="0 0 32 10" shapeRendering="crispEdges" aria-hidden="true">
      {[8, 15, 22].map((x, i) => (
        <g key={x} className={`vl-flame vl-flame-${i}`}>
          <rect x={x} y={2} width={2} height={8} />
          <rect x={x - 1} y={5} width={4} height={5} />
        </g>
      ))}
    </svg>
  )
}

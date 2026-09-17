/** The vault square at the foot of the sidebar. The octopus wears the scene of the last thing
 *  mnemo did, and keeps wearing it until the next pulse; a caption names that action, a trail
 *  records the kinds of thing done lately, and the HUD carries the vault's level and health.
 *
 *  Three sources, three surfaces: the last pulse dresses the octopus and the caption, the last
 *  few pulses draw the trail, and `client.level()` fills the HUD. The scene owns the octopus's
 *  colour — a blocked command is red on a green vault. Health paints him only before the first
 *  pulse, when there is nothing else to wear. */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { POSES, SCENES, withPartIndex, type Scene } from '../avatar/scenes'
import type { PulseStore } from '../pulse/store'
import { squareCaption } from './caption'
import type { LevelClient } from './client'
import { healthOf, levelOf, onFire, poseOf, toneOf, xpOf } from './level'
import { recentPulses } from './recent'
import type { VaultLevel } from './types'
import '../avatar/avatar.css'
import './vaultlevel.css'

/** The square's height. Its width is whatever the sidebar's slot gives it; the octopus stays a
 *  fixed `OCTO`, because pixel art does not stretch. */
export const SQUARE = 176
/** Big enough that a scene's object — a few grid cells — reads as a thing and not a smudge. */
export const OCTO = 104
/** `vault_level` is cached 10s on the Rust side; the square has no reason to ask faster. */
export const POLL_MS = 30_000
/** How often the caption's age recounts itself. Its own timer: the same period as the poll
 *  today, but a different reason to change. */
export const AGE_MS = 30_000
/** Dots in the trail. */
export const TRAIL = 5

type Props = {
  client: LevelClient
  pulses: PulseStore
  pollMs?: number
  ageMs?: number
  /** What the ▤ button does. Injected so the square stays free of the layout store. */
  openVault?: () => void
}

export default function Square({ client, pulses, pollMs = POLL_MS, ageMs = AGE_MS, openVault }: Props) {
  const [vault, setVault] = useState<VaultLevel>()
  const [best, setBest] = useState(0)

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

  // The whole log, every pane's: the square reports on mnemo, not on the focused pane.
  const log = useSyncExternalStore(pulses.subscribe, () => pulses.getState().log)
  const last = log.at(-1)
  const trail = useMemo(() => recentPulses(log, TRAIL), [log])

  // A new pulse resets the clock too, so it never reads as older than it is.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), ageMs)
    return () => clearInterval(timer)
  }, [ageMs, last?.id])

  const ok = !!vault && !vault.error
  // Two different questions. A vault with no pages is not a sick vault, it is an empty one:
  // `healthOf` floors at 0 for it, which as a tone would paint the bar red.
  const rated = ok && vault.pages > 0
  const health = rated ? healthOf(vault) : 0
  const tone = rated ? toneOf(health) : 'muted'
  const fire = rated && onFire(health, vault.fired_recent)
  const { level, fraction } = levelOf(best)

  const scene: Scene | undefined = last && SCENES[last.event.kind]
  const cap = last && scene ? squareCaption(last.event, now) : undefined

  const state = rated
    ? `vault level ${level}, health ${Math.round(health * 100)}%${fire ? ', on fire' : ''}`
    : ok
      ? 'the vault is empty'
      : vault?.error ?? 'reading the vault'
  const label = cap ? `${state}; last: ${[cap.verb, cap.target].filter(Boolean).join(' ')}, ${cap.where}` : state
  const detail = rated
    ? `${vault.pages} pages · ${vault.rules_fired} fired (${vault.fired_recent} this week) · ${vault.dormant} dormant · ${vault.inbox} in inbox`
    : state

  return (
    <div className={`vl-square vl-${tone}${fire ? ' vl-on-fire' : ''}`} role="img" aria-label={label} title={detail}>
      <div className="vl-stage">
        {scene ? (
          <div className={`vl-octo vl-kind-${scene.tone}`}>
            <Octopus scene={scene} className={`av av-${scene.tone}`} />
          </div>
        ) : (
          // Nothing has happened yet: he wears the vault's health. No `av-<tone>` class —
          // `avatar.css` only defines four, so the square paints from its own five-step ramp.
          <div className="vl-octo vl-at-rest">
            <Octopus scene={POSES[rated ? poseOf(toneOf(health)) : 'fair']} className="av vl-body" />
          </div>
        )}
      </div>
      <div className="vl-caption">
        {cap && (
          <>
            <div className="vl-what">
              <span className="vl-verb">{cap.verb}</span>
              {cap.target && <span className="vl-target"> {cap.target}</span>}
            </div>
            <div className="vl-where">{cap.where}</div>
          </>
        )}
      </div>
      <ol className="vl-trail" aria-hidden="true">
        {trail.map((t, i) => (
          <li key={i} className={`vl-dot vl-kind-${SCENES[t.kind]?.tone ?? 'muted'}${i === trail.length - 1 ? ' vl-now' : ''}`} title={t.kind}>
            {t.count > 1 && <span className="vl-count">{t.count}</span>}
          </li>
        ))}
      </ol>
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
        {fire && <Flames />}
      </div>
    </div>
  )
}

function Octopus({ scene, className }: { scene: Scene; className: string }) {
  return (
    <svg className={`${className} ${scene.className}`} width={OCTO} height={OCTO} viewBox="0 0 32 32" shapeRendering="crispEdges" aria-hidden="true">
      {withPartIndex(scene.rects).map(([rect, n], i) => (
        <rect key={i} className={`av-${rect.part} av-${rect.part}-${n}`} x={rect.x} y={rect.y} width={rect.w} height={rect.h} />
      ))}
    </svg>
  )
}

/** Three pixel flames at the end of the bar, flickering out of step: sustained good health. */
function Flames() {
  return (
    <svg className="vl-fire" width={20} height={12} viewBox="9 1 15 9" shapeRendering="crispEdges" aria-hidden="true">
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

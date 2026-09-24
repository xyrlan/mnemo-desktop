/** The octopus as Orca's pet: a small overlay you can drag, reacting to the fleet's state and
 *  the vault's level. Its position is remembered; `prefers-reduced-motion` stills it (pet.css). */
import { useEffect, useState, type PointerEvent } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useFleet } from '../fleet/store'
import { withPartIndex } from '../avatar/scenes'
import { makeLevelClient } from '../vaultlevel/client'
import type { VaultLevel } from '../vaultlevel/types'
import { clampPosition, defaultPosition, loadPosition, PET_SIZE, petScene, petStateOf, savePosition, type Point } from './state'
import '../avatar/avatar.css'
import './pet.css'

const client = makeLevelClient(invoke)
const POLL_MS = 30_000
const CAPTION = { working: 'working', 'needs-you': 'needs you', done: 'done', idle: 'idle' } as const
const view = () => ({ width: window.innerWidth, height: window.innerHeight })

export default function Pet() {
  const state = useFleet(petStateOf)
  const [vault, setVault] = useState<VaultLevel>()
  const [pos, setPos] = useState<Point>(() => clampPosition(loadPosition(localStorage) ?? defaultPosition(view()), view()))
  const [grab, setGrab] = useState<Point | null>(null)

  useEffect(() => {
    let live = true
    const tick = () =>
      client
        .level()
        .then((v) => live && setVault(v))
        .catch((e) => console.warn('pet: vault level not read', e))
    void tick()
    const timer = setInterval(tick, POLL_MS)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [])

  // A smaller window must not strand the pet off screen.
  useEffect(() => {
    const onResize = () => setPos((p) => clampPosition(p, view()))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const down = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture?.(e.pointerId)
    setGrab({ x: e.clientX - pos.x, y: e.clientY - pos.y })
  }
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (grab) setPos(clampPosition({ x: e.clientX - grab.x, y: e.clientY - grab.y }, view()))
  }
  const up = () => {
    if (!grab) return
    setGrab(null)
    savePosition(localStorage, pos)
  }

  const scene = petScene(state, vault)
  return (
    <div
      className={`pet${grab ? ' pet-dragging' : ''}`}
      data-state={state}
      role="img"
      aria-label={`mnemo, ${CAPTION[state]}`}
      style={{ left: pos.x, top: pos.y, width: PET_SIZE, height: PET_SIZE }}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    >
      <svg
        className={`av av-${scene.tone} ${scene.className}`}
        width={PET_SIZE}
        height={PET_SIZE}
        viewBox="0 0 32 32"
        shapeRendering="crispEdges"
        aria-hidden="true"
      >
        {withPartIndex(scene.rects).map(([r, n], i) => (
          <rect key={i} className={`av-${r.part} av-${r.part}-${n}`} x={r.x} y={r.y} width={r.w} height={r.h} />
        ))}
      </svg>
    </div>
  )
}

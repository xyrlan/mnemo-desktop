import { createContext, useContext } from 'react'
import type { ShipAction, ShipRobot } from '../ship-types'
import type { Hover } from './figures'

/** What every part of the drawn ship reads: the props it shares, and the scene's own state. */
export type SceneCtx = {
  /** Captain id → its emblem. */
  emblems: ReadonlyMap<string, string>
  /** Every robot on the ship, by id. */
  robots: ReadonlyMap<string, ShipRobot>
  selection: ReadonlySet<string>
  /** Robots the log says merged: they leave on their shuttle. */
  merged: ReadonlySet<string>
  focusId: string | null
  hover: Hover | null
  setHover(h: Hover | null): void
  arriving: ReadonlySet<string>
  arrived(id: string): void
  reducedMotion: boolean
  /** Moves on every speech turn while turns are taken. */
  tick: number
  onOpen(id: string): void
  onSelect(id: string): void
  onAction(action: ShipAction): void
  onTriage(): void
}

export const SceneContext = createContext<SceneCtx | null>(null)

export function useScene(): SceneCtx {
  const s = useContext(SceneContext)
  if (!s) throw new Error('nexus: a ship part drawn outside ShipScene')
  return s
}

export const isFocused = (focusId: string | null, r: Pick<ShipRobot, 'id' | 'sessionId'>) => !!focusId && (focusId === r.id || focusId === r.sessionId)

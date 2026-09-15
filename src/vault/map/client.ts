import type { Born, Changed, Positions, VaultMap } from './types'

export const BORN_EVENT = 'mnemo://vault-born'
export const CHANGED_EVENT = 'mnemo://vault-changed'

export type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>
export type Listen = <T>(event: string, handler: (e: { payload: T }) => void) => Promise<() => void>

export interface MapClient {
  /** Every live page in `scope` (`''`, `agent:<name>`), its links, rare-topic edges and ghosts. */
  map(scope: string): Promise<VaultMap>
  /** Where the user last saw each page of `scope`. */
  positions(scope: string): Promise<Positions>
  /** Merged into the saved positions of `scope`. */
  savePositions(scope: string, positions: Positions): Promise<void>
  /** Resolves to an unlisten. */
  onBorn(handler: (b: Born) => void): Promise<() => void>
  onChanged(handler: (c: Changed) => void): Promise<() => void>
}

export function makeMapClient(invoke: Invoke, listen: Listen): MapClient {
  return {
    map: (scope) => invoke<VaultMap>('vault_map', { scope }),
    positions: (scope) => invoke<Positions>('vault_map_positions_read', { scope }),
    savePositions: (scope, positions) => invoke<void>('vault_map_positions_write', { scope, positions }),
    onBorn: (handler) => listen<Born>(BORN_EVENT, (e) => handler(e.payload)),
    onChanged: (handler) => listen<Changed>(CHANGED_EVENT, (e) => handler(e.payload)),
  }
}

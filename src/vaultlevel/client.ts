import type { VaultLevel } from './types'

export type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>

export interface LevelClient {
  /** The square's numbers: a page walk and the fire logs, no `mnemo` subprocess. */
  level(): Promise<VaultLevel>
  /** Offers `xp`; resolves to the highest xp ever recorded, which is what the level reads. */
  best(xp: number): Promise<number>
}

export function makeLevelClient(invoke: Invoke): LevelClient {
  return {
    level: () => invoke<VaultLevel>('vault_level'),
    best: (xp) => invoke<number>('vault_level_best', { xp: Math.max(0, Math.floor(xp)) }),
  }
}

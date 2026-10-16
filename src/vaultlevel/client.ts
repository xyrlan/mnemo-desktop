import type { ProjectLevels, VaultLevel } from './types'

export type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>

export interface LevelClient {
  /** The square's numbers: a page walk and the fire logs, no `mnemo` subprocess. */
  level(): Promise<VaultLevel>
  /** Offers `xp`; resolves to the highest xp ever recorded, which is what the level reads. */
  best(xp: number): Promise<number>
  /** Each project's numbers, from the same walk and the same one read of the logs. */
  projects(): Promise<ProjectLevels>
  /** Offers each project's xp; resolves to every project's highest xp ever recorded. */
  projectsBest(xp: Record<string, number>): Promise<Record<string, number>>
}

const whole = (xp: number) => Math.max(0, Math.floor(xp))

export function makeLevelClient(invoke: Invoke): LevelClient {
  return {
    level: () => invoke<VaultLevel>('vault_level'),
    best: (xp) => invoke<number>('vault_level_best', { xp: whole(xp) }),
    projects: () => invoke<ProjectLevels>('vault_project_levels'),
    projectsBest: (xp) => invoke<Record<string, number>>('vault_project_levels_best', { xp: Object.fromEntries(Object.entries(xp).map(([k, v]) => [k, whole(v)])) }),
  }
}

import { useEffect, useState, type JSX } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { pollWhileShown, type Shown } from '../../../shell/while-shown'
import { makeLevelClient, type LevelClient } from '../../../vaultlevel/client'
import { levelOf, XP_PER_LEVEL, xpOf, type Progress } from '../../../vaultlevel/level'

/** How often the level is read again: as the status bar did. */
export const LEVEL_POLL_MS = 30_000
const liveClient = makeLevelClient(invoke)

/** The vault's level (spec Q11: it moves here from the status bar), read now and every
 *  `pollMs`, and not while the window is hidden. The best xp ever recorded is what it reads, so it
 *  never falls. Null until the first read; `'none'` when the vault cannot be read. A new `again`
 *  reads it at once (the ship's: the vault just learned a rule). */
export function useVaultLevel(client: LevelClient = liveClient, pollMs = LEVEL_POLL_MS, shown?: Shown, again?: unknown): Progress | 'none' | null {
  const [level, setLevel] = useState<Progress | 'none' | null>(null)
  useEffect(() => {
    let live = true
    const tick = async () => {
      try {
        const v = await client.level()
        if (!live) return
        if (!v || v.error) return setLevel('none')
        const best = await client.best(xpOf(v))
        if (live) setLevel(levelOf(best))
      } catch (e) {
        console.warn('memory: vault level not read', e)
      }
    }
    const stop = pollWhileShown(tick, pollMs, { shown })
    return () => {
      live = false
      stop()
    }
  }, [client, pollMs, shown, again])
  return level
}

/** Each project's level by name, best xp ever recorded per project; a project not in it is LV0. */
export type ProjectProgress = ReadonlyMap<string, Progress>

/** Every project's level (issue #478), what each deck's `LV` reads: one read for all of them, as
 *  often as `useVaultLevel` and not while hidden. Each reads its project's best xp, so it never
 *  falls. Null until the first read; `'none'` when the vault cannot be read. A new `again` reads
 *  them at once. */
export function useProjectLevels(client: LevelClient = liveClient, pollMs = LEVEL_POLL_MS, shown?: Shown, again?: unknown): ProjectProgress | 'none' | null {
  const [levels, setLevels] = useState<ProjectProgress | 'none' | null>(null)
  useEffect(() => {
    let live = true
    const tick = async () => {
      try {
        const v = await client.projects()
        if (!live) return
        if (!v || v.error) return setLevels('none')
        const xp = Object.fromEntries(Object.entries(v.projects).map(([name, p]) => [name, xpOf(p)]))
        const best = await client.projectsBest(xp)
        if (live) setLevels(new Map(Object.entries(best).map(([name, b]) => [name, levelOf(b)])))
      } catch (e) {
        console.warn('memory: project levels not read', e)
      }
    }
    const stop = pollWhileShown(tick, pollMs, { shown })
    return () => {
      live = false
      stop()
    }
  }, [client, pollMs, shown, again])
  return levels
}

/** `lv 3` in the window's head, how far into the next level on hover; `no vault` when there is
 *  none to read. Nothing before the first read. */
export function VaultLevel({ client }: { client?: LevelClient }): JSX.Element | null {
  const level = useVaultLevel(client)
  if (level === null) return null
  if (level === 'none') {
    return (
      <span className="nx-muted" data-vault-level="none" title="The vault could not be read">
        no vault
      </span>
    )
  }
  return (
    <span className="nx-mem-level" data-vault-level={level.level} title={`vault level ${level.level} · ${level.into}/${XP_PER_LEVEL} xp to level ${level.level + 1}`}>
      lv {level.level}
    </span>
  )
}

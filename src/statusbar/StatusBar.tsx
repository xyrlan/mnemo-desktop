import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useFleet } from '../fleet/store'
import { useApp } from '../layout/app-store'
import { useMission } from '../mission/app-store'
import { usePulse } from '../pulse/app-store'
import { makeLevelClient, type LevelClient } from '../vaultlevel/client'
import { levelOf, xpOf } from '../vaultlevel/level'
import type { VaultLevel } from '../vaultlevel/types'
import { activePane, agentSummary, countAgents, paneTokens } from './model'

const DOT: Record<string, string> = {
  'needs-you': 'bg-amber-500',
  working: 'bg-emerald-500',
  done: 'bg-sky-500',
  idle: 'bg-muted-foreground/50',
}

export const POLL_MS = 30_000
const liveClient = makeLevelClient(invoke)

/** The vault's level, polled as the vault square does. Null until the first read, and when the
 *  vault cannot be read. */
export function useVaultLevel(client: LevelClient, pollMs = POLL_MS): number | null {
  const [level, setLevel] = useState<number | null>(null)
  useEffect(() => {
    let live = true
    let best = 0
    const tick = async () => {
      try {
        const v: VaultLevel = await client.level()
        if (!live) return
        if (v.error) return setLevel(null)
        best = Math.max(best, await client.best(xpOf(v)))
        if (live) setLevel(levelOf(best).level)
      } catch (e) {
        console.warn('status bar: vault level not read', e)
      }
    }
    void tick()
    const timer = setInterval(tick, pollMs)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [client, pollMs])
  return level
}

/** Orca's status bar: the active pane's tokens and pulse count on the left, the fleet's agents
 *  by state and the vault level on the right. */
export default function StatusBar({ client = liveClient }: { client?: LevelClient }) {
  // Two selectors returning what the store holds, never a new object: a selector that builds one
  // (`activePane(s)`) looks changed on every read, and React re-renders until it gives up.
  const activeId = useApp((s) => activePane(s)?.id)
  const pane = useApp((s) => (activeId === undefined ? undefined : s.panes[activeId]))
  const active = activeId !== undefined && pane ? { id: activeId, pane } : undefined
  const snap = useMission((s) => s.snapshot)
  const tokens = paneTokens(active?.pane, snap)
  const pulses = usePulse((s) => (active ? s.counts[active.id] ?? 0 : 0))
  const repos = useFleet((f) => f.repos)
  const agents = agentSummary(countAgents(repos))
  const level = useVaultLevel(client)

  return (
    <div className="flex h-6 w-full items-center gap-3 border-t border-border bg-background px-2 text-[11px] text-muted-foreground select-none" role="status" aria-label="Status bar">
      {tokens && <span data-testid="sb-tokens">{tokens}</span>}
      {pulses > 0 && (
        <span data-testid="sb-pulse" title={`${pulses} mnemo event${pulses === 1 ? '' : 's'} in this pane since launch`}>
          ↯ {pulses}
        </span>
      )}
      <span className="flex-1" />
      <span className="flex items-center gap-2" data-testid="sb-agents" aria-label="Agents by state">
        {agents.length === 0 && <span>no agents</span>}
        {agents.map((a) => (
          <span key={a.state} className="flex items-center gap-1">
            <span className={`size-1.5 rounded-full ${DOT[a.state]}`} aria-hidden />
            {a.label}
          </span>
        ))}
      </span>
      <span data-testid="sb-level">{level === null ? 'no vault' : `lv ${level}`}</span>
    </div>
  )
}

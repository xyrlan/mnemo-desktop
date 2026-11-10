// The live world's sources in the app: the stores the app already keeps current, and the
// core's commands. Loaded only when a live world starts (`./index.ts`), so nothing that draws
// the sample world, and no test, touches Tauri through this folder.

import { invoke } from '@tauri-apps/api/core'
import { accountsStore } from '../../accounts/store'
import { fleetStore } from '../../fleet/store'
import type { Insights, Trails, VaultPulse } from '../../insight/types'
import { store as layout } from '../../layout/app-store'
import { missionStore } from '../../mission/app-store'
import type { Feed } from '../../nexus/ship-types'
import { pulseStore } from '../../pulse/app-store'
import { sessionHost } from '../../session/app-host'
import { pollWhileShown } from '../../shell/while-shown'
import type { LiveSources, Watch } from './engine'

interface Store<S> {
  getState(): S
  subscribe(cb: () => void): () => void
}

/** One reading of a store. `pick` must answer the same object while what it reads is the same. */
const watch = <S, T>(store: Store<S>, pick: (state: S) => T): Watch<T> => ({ get: () => pick(store.getState()), subscribe: (cb) => store.subscribe(cb) })

/** `make(...parts)`, made again only when one of the parts is another object. */
function memo<P extends unknown[], T>(make: (...parts: P) => T): (...parts: P) => T {
  let last: { parts: P; value: T } | null = null
  return (...parts) => {
    if (!last || parts.some((p, i) => p !== last!.parts[i])) last = { parts, value: make(...parts) }
    return last.value
  }
}

export function appSources(): LiveSources {
  // The top bar shows each account's plan windows whether or not anything else reads them.
  accountsStore.getState().start()

  type Accounts = ReturnType<typeof accountsStore.getState>
  // Without `loading`, which flips on every read of the usage and says nothing a view shows.
  const accounts = memo((state: Accounts['state'], usage: Accounts['usage'], error: Accounts['listError']) => ({
    state,
    usage: Object.fromEntries(Object.entries(usage).map(([id, u]) => [id, { usage: u.usage, error: u.error }])),
    error,
  }))
  const pulses = memo((log: ReturnType<typeof pulseStore.getState>['log']) => log.map((p) => p.event))
  // A terminal in a pane that runs a session, and a background child the app is attached to
  // (`child:<its id>` in the session host): both are terminals the app runs itself.
  const hosted = memo((panes: ReturnType<typeof layout.getState>['panes'], sessions: ReturnType<typeof sessionHost.getState>['sessions']) => [
    ...Object.values(panes).flatMap((p) => (p.sessionId ? [p.sessionId] : [])),
    ...Object.keys(sessions).flatMap((key) => (key.startsWith('child:') ? [key.slice('child:'.length)] : [])),
  ])

  return {
    mission: watch(missionStore, (s) => s.snapshot),
    missionError: watch(missionStore, (s) => s.lastError),
    fleet: watch(fleetStore, (s) => s.repos),
    accounts: watch(accountsStore, (s) => accounts(s.state, s.usage, s.listError)),
    pulses: watch(pulseStore, (s) => pulses(s.log)),
    hosted: {
      get: () => hosted(layout.getState().panes, sessionHost.getState().sessions),
      subscribe(cb) {
        const offs = [layout.subscribe(cb), sessionHost.subscribe(cb)]
        return () => offs.forEach((off) => off())
      },
    },
    feed: (asks) => invoke<Feed>('nexus_feed', { asks }),
    insight: (asks) => invoke<Insights>('session_insight', { asks }),
    trails: (sessionIds) => invoke<Trails>('memory_trail', { sessionIds }),
    vault: (since) => invoke<VaultPulse>('vault_pulse', { since }),
    now: Date.now,
    every: (tick, ms, opts) => pollWhileShown(tick, ms, opts),
  }
}

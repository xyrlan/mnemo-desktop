import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import type { Snapshot } from '../mission/types'
import type { Feed, FeedAsk } from './ship-types'

export type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>

export interface ShipClient {
  /** Each session's transcript and job read once, PR fates and the fleet's rate (`nexus_feed`). */
  feed(asks: FeedAsk[]): Promise<Feed>
}

export function makeShipClient(invoke: Invoke): ShipClient {
  return { feed: (asks) => invoke<Feed>('nexus_feed', { asks }) }
}

export const tauriShip: ShipClient = makeShipClient(tauriInvoke)

/** What to ask the feed about: every live parent and every child the snapshot holds (issue
 *  children and contract pieces), once each. A piece's PR wins over its child's own. */
export function asksFrom(snap: Snapshot): FeedAsk[] {
  const asks = new Map<string, FeedAsk>()
  for (const repo of snap.repos) {
    for (const p of repo.parents) {
      asks.set(p.session_id, { key: p.session_id, sessionId: p.session_id, cwd: p.cwd, account: p.account ?? 'default', jobId: null, prUrl: null })
    }
    const children = [
      ...repo.children.map((c) => ({ c, pr: c.pr ?? null })),
      ...repo.missions.flatMap((m) => m.pieces.flatMap((p) => (p.child ? [{ c: p.child, pr: p.pr ?? p.child.pr ?? null }] : []))),
    ]
    for (const { c, pr } of children) {
      if (!c.session_id) continue
      asks.set(c.id, { key: c.id, sessionId: c.session_id, cwd: c.cwd, account: c.account, jobId: c.id, prUrl: pr?.url ?? null })
    }
  }
  return [...asks.values()]
}

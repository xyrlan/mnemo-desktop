import type { AgentNode, RepoNode, WorktreeNode } from '../fleet/types'

/** The kanban's columns, in the order they are drawn: Orca's four, named as the spec names them. */
export type Bucket = AgentNode['state']
export const BUCKETS: readonly Bucket[] = ['needs-you', 'working', 'done', 'idle']

export const BUCKET_LABEL: Record<Bucket, string> = {
  'needs-you': 'Needs you',
  working: 'Working',
  done: 'Done',
  idle: 'Idle',
}

/** One agent on the board, with the worktree and repo it belongs to. Interactive sessions and
 *  dispatched children are the same kind of card; `kind` tells them apart. */
export type DashboardCard = {
  sessionId: string
  paneId: number | null
  bucket: Bucket
  waitingFor: AgentNode['waitingFor']
  title: string
  /** When the agent entered its column: the column's order and the card's time. */
  since: number
  /** Its worktree has news the user has not looked at, and this agent is part of it. */
  unseen: boolean
  repoRoot: string
  repoName: string
  worktreePath: string
  worktreeName: string
  branch: string | null
  kind: WorktreeNode['kind']
  pr: WorktreeNode['pr']
}

/** Every agent of the fleet, one card each. A worktree's unread is news of its finished and
 *  waiting agents only; a working or idle one beside them is not what the user has not seen. */
export function cardsOf(repos: RepoNode[]): DashboardCard[] {
  return repos.flatMap((r) =>
    r.worktrees.flatMap((w) =>
      w.agents.map(
        (a): DashboardCard => ({
          sessionId: a.sessionId,
          paneId: a.paneId,
          bucket: a.state,
          waitingFor: a.waitingFor,
          title: a.title,
          since: a.since,
          unseen: w.unread && (a.state === 'done' || a.state === 'needs-you'),
          repoRoot: r.root,
          repoName: r.name,
          worktreePath: w.path,
          worktreeName: w.name,
          branch: w.branch,
          kind: w.kind,
          pr: w.pr,
        }),
      ),
    ),
  )
}

/** Cards by column, each most-recently-moved first: a card entering a column lands at the top,
 *  where the view transition the user just watched put it. */
export function groupByBucket(cards: DashboardCard[]): Record<Bucket, DashboardCard[]> {
  const grouped: Record<Bucket, DashboardCard[]> = { 'needs-you': [], working: [], done: [], idle: [] }
  for (const c of cards) grouped[c.bucket].push(c)
  for (const b of BUCKETS) grouped[b].sort((x, y) => y.since - x.since || x.sessionId.localeCompare(y.sessionId))
  return grouped
}

/** Which column each card sits in: the only change a view transition animates. A new title or
 *  PR on a card that stays put must not. */
export function columnSignature(cards: DashboardCard[]): string {
  return cards
    .map((c) => `${c.sessionId}:${c.bucket}`)
    .sort()
    .join(',')
}

/** A coarse "how long ago": the card is glanced at, not read. */
export function formatAgo(since: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - since) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

/** What a waiting agent wants, in words. */
export function askOf(card: Pick<DashboardCard, 'bucket' | 'waitingFor'>): string | null {
  if (card.bucket !== 'needs-you') return null
  return card.waitingFor === 'question' ? 'Asked you a question' : 'Waiting on your permission'
}

/** A `view-transition-name` must be a custom ident: the session id, slugged. */
export const transitionName = (sessionId: string) => `agentcard-${sessionId.replace(/[^a-zA-Z0-9]/g, '-')}`

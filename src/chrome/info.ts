import type { Pane } from '../layout/store'
import type { ParentSession, Snapshot } from '../mission/types'
import { parentTokenLine } from '../mission/tokens'
import { paneCwd, repoOfCwd } from '../mission/scope'
import type { PulseEvent } from '../pulse/types'

const trimSlash = (p: string) => p.replace(/\/+$/, '') || '/'
const basename = (p: string) => trimSlash(p).split('/').pop() || p

/** The Claude session a pane runs: the one it was opened for, else the only live parent
 *  sitting in exactly its cwd. Two parents in one directory are ambiguous: none. */
export function paneParent(pane: Pane | undefined, cwd: string | undefined, snap: Snapshot): ParentSession | undefined {
  if (!pane) return undefined
  const parents = snap.repos.flatMap((r) => r.parents)
  if (pane.sessionId) {
    const own = parents.find((p) => p.session_id === pane.sessionId)
    if (own) return own
  }
  if (!cwd || pane.view !== 'terminal') return undefined
  const here = parents.filter((p) => p.cwd && trimSlash(p.cwd) === trimSlash(cwd))
  return here.length === 1 ? here[0] : undefined
}

export type BarInfo = {
  cwd?: string
  /** Repo name, else the folder name when the cwd is outside any repo. */
  place?: string
  branch?: string
  /** `parent 210k · children 640k`, absent when the snapshot has no counts. */
  tokens?: string
  /** What the pane calls itself (terminal title, view title), or its view name. */
  title: string
}

/** Everything the bar shows, from the pane, the mission snapshot and what git said. */
export function barInfo(pane: Pane | undefined, snap: Snapshot, git: { repo?: string | null; branch?: string | null } = {}): BarInfo {
  const cwd = paneCwd(pane, snap)
  const parent = paneParent(pane, cwd, snap)
  const place = cwd ? git.repo || repoOfCwd(snap, cwd)?.name || basename(cwd) : undefined
  return {
    cwd,
    place,
    branch: git.branch || undefined,
    tokens: (parent && parentTokenLine(parent)) || undefined,
    title: pane?.title || pane?.view || '',
  }
}

/** How long the bar shows a pulse after it arrives. */
export const FLASH_MS = 3000

/** `↯ slug`, `↯ slug +2` when several rules fired, `↯ tool` when none did. */
export function pulseLabel(e: PulseEvent): string {
  const [first, ...rest] = e.slugs
  if (!first) return `↯ ${e.tool ?? e.kind}`
  return rest.length ? `↯ ${first} +${rest.length}` : `↯ ${first}`
}

const KIND: Record<PulseEvent['kind'], string> = { reflex: 'injected', tool: 'tool call', enrich: 'enriched', enforce: 'blocked' }

/** The badge tooltip: what happened, the rules, and where a click goes. */
export function pulseTitle(e: PulseEvent): string {
  const what = [KIND[e.kind], e.tool].filter(Boolean).join(' ')
  const rules = e.slugs.length ? `: ${e.slugs.join(', ')} (click to open in the vault)` : ''
  return `mnemo ${what}${rules}`
}

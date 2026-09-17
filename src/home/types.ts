import type { Issue } from '../github/types'

/** Mirrors `src-tauri/src/home.rs`. */
export type Live = 'here' | 'bg' | 'elsewhere'
/** `agent`: the `claude agents` name of a live session, only when it differs from `title`. */
export type HomeSession = { id: string; title: string; cwd: string; last_at: number; transcript: boolean; live: Live | null; kind: string; agent: string | null }
export type Checks = 'pass' | 'fail' | 'pending' | 'none'
/** An open PR (`src-tauri/src/home/lens.rs`). `child`: short id of the dispatch child that
 *  opened it, null when none resolves, which is ordinary: show the PR without a badge. */
export type Pr = { number: number; title: string; state: 'open' | 'draft'; checks: Checks; child: string | null; url: string }

/** `unresolved`: under a folder macOS guards, grouped by its history path without running git
 *  (see `mission::is_protected`); selecting it resolves it. `children`: sessions run in a
 *  dispatch worktree beside the repo, kept out of `sessions`. `issues`/`prs`: open ones as the
 *  last `refreshGithub()` read them, empty before one ran or when `gh` could not read the repo
 *  (the reason is in `HomeSnapshot.errors`). */
export type HomeRepo = {
  root: string
  name: string
  last_at: number
  pinned: boolean
  hidden: boolean
  unresolved: boolean
  sessions: HomeSession[]
  children: HomeSession[]
  // Always sent by `home_snapshot`. Optional only because `Home.test.tsx` and `store.test.ts`
  // (read-only in round 14) build repos without them; required once round 15 updates them.
  issues?: Issue[]
  prs?: Pr[]
}
/** `protected`: unresolved repos that are neither hidden nor pinned, folded behind one line. */
export type HomeSnapshot = { repos: HomeRepo[]; clone_base: string; errors: string[]; protected: number }

export const EMPTY: HomeSnapshot = { repos: [], clone_base: '', errors: [], protected: 0 }

type PaneLike = { id: number; sessionId?: string }

export function paneForSession(panes: Record<number, PaneLike>, sessionId: string): number | null {
  for (const p of Object.values(panes)) if (p.sessionId === sessionId) return p.id
  return null
}

export type Click =
  | { kind: 'focus'; pane: number }
  | { kind: 'command'; cmd: string; sessionId: string }
  | { kind: 'nothing'; why: string }

export const ELSEWHERE = 'open in another terminal'
export const NO_TRANSCRIPT = 'transcript not found'

/** Never fork: a live session is focused or attached, only a dead one is resumed. */
export function whatClickDoes(s: HomeSession, panes: Record<number, PaneLike>): Click {
  if (s.live === 'here') {
    const pane = paneForSession(panes, s.id)
    return pane === null ? { kind: 'nothing', why: ELSEWHERE } : { kind: 'focus', pane }
  }
  if (s.live === 'bg') return { kind: 'command', cmd: `claude attach ${s.id}`, sessionId: s.id }
  if (s.live === 'elsewhere') return { kind: 'nothing', why: ELSEWHERE }
  if (!s.transcript) return { kind: 'nothing', why: NO_TRANSCRIPT }
  return { kind: 'command', cmd: `claude --resume ${s.id}`, sessionId: s.id }
}

/** An unresolved repo the list folds away (see `HomeSnapshot.protected`). */
export const isFolded = (r: HomeRepo) => r.unresolved && !r.hidden && !r.pinned

/** Hidden repos only with `showHidden`; folded protected folders only with `showProtected` or
 *  when a typed filter matches them. */
export function visibleRepos(repos: HomeRepo[], filter: string, showHidden: boolean, showProtected: boolean): HomeRepo[] {
  const q = filter.trim().toLowerCase()
  return repos.filter((r) => {
    const matches = !!q && (r.name.toLowerCase().includes(q) || r.root.toLowerCase().includes(q))
    if (q && !matches) return false
    if (r.hidden && !showHidden) return false
    return !isFolded(r) || showProtected || matches
  })
}

/** `<base>/<name>` for `owner/repo`, an https URL, or an ssh URL; null when blank. */
export function cloneDest(base: string, spec: string): string | null {
  const s = spec.trim()
  if (!s) return null
  const name = s.replace(/\/+$/, '').split(/[/:]/).pop()?.replace(/\.git$/, '')
  return name ? `${base.replace(/\/+$/, '')}/${name}` : null
}

export function relTime(ms: number, now = Date.now()): string {
  if (!ms) return ''
  const m = Math.round(Math.max(0, now - ms) / 60000)
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 48) return `${h}h`
  return `${Math.round(h / 24)}d`
}

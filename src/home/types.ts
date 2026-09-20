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
 *  last `refreshGithub()` read them; absent or empty before one ran and when `gh` could not
 *  read the repo (the reason is in `HomeSnapshot.errors`, see `githubError`). */
export type HomeRepo = {
  root: string
  name: string
  last_at: number
  pinned: boolean
  hidden: boolean
  unresolved: boolean
  sessions: HomeSession[]
  children: HomeSession[]
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

const GH_ERROR = /^github \(([^)]*)\): (.*)$/

/** Why `gh` could not read the repo named `name`, from `HomeSnapshot.errors` lines shaped
 *  `github (a, b): reason` (`lens::error_lines`); null when it could. */
export function githubError(errors: string[], name: string): string | null {
  for (const e of errors) {
    const m = e.match(GH_ERROR)
    if (m && m[1].split(', ').includes(name)) return m[2]
  }
  return null
}

/** The `errors` lines no repo group shows: everything but `gh`'s per-repo reasons. */
export const otherErrors = (errors: string[]) => errors.filter((e) => !GH_ERROR.test(e))

/** The dispatch child a PR names (`Pr.child`, a `~/.claude/jobs` short id, the session id's
 *  first eight characters) among the repo's children; null when this snapshot does not list it. */
export function childSession(repo: HomeRepo, short: string): HomeSession | null {
  return repo.children.find((s) => s.id.startsWith(short)) ?? null
}

/** Rows a group shows before "more": every live session, then the most recent others up to
 *  `recent`. Order is kept; `rest` counts what is left out. */
export function firstRows(sessions: HomeSession[], recent: number): { rows: HomeSession[]; rest: number } {
  let quiet = 0
  const rows = sessions.filter((s) => !!s.live || quiet++ < recent)
  return { rows, rest: sessions.length - rows.length }
}

export function relTime(ms: number, now = Date.now()): string {
  if (!ms) return ''
  const m = Math.round(Math.max(0, now - ms) / 60000)
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 48) return `${h}h`
  return `${Math.round(h / 24)}d`
}

/** The PR the lens pushed over its stream: which repo it belongs to, and the row that was
 *  clicked. One level deep — a PR is as deep as the stream goes. */
export type OpenedPr = { repo: string; pr: Pr }

/** What the PR view shows: the repo as this snapshot has it (null once it is gone from the
 *  list), the PR as the latest read knows it — checks and draft state move while the view is
 *  open — falling back to the row that was clicked, and the child that opened it. */
export type PrView = { repo: HomeRepo | null; pr: Pr; child: HomeSession | null }

export function prView(snapshot: HomeSnapshot, opened: OpenedPr): PrView {
  const repo = snapshot.repos.find((r) => r.root === opened.repo) ?? null
  const pr = repo?.prs?.find((p) => p.number === opened.pr.number) ?? opened.pr
  return { repo, pr, child: repo && pr.child ? childSession(repo, pr.child) : null }
}

/** What taking a child over does, worded for a button: `label` when it acts, `why` when it
 *  cannot (then it is not a control, see `whatClickDoes`). */
export function takeOver(s: HomeSession, panes: Record<number, PaneLike>): { label: string; why: string | null } {
  const c = whatClickDoes(s, panes)
  if (c.kind === 'nothing') return { label: 'Take over', why: c.why }
  if (c.kind === 'focus') return { label: 'Show its pane', why: null }
  return { label: c.cmd.startsWith('claude attach') ? 'Take over' : 'Resume', why: null }
}

/** `claude stop <id>`, as the cockpit's inbox runs it (`src/cockpit/actions.ts`). Only a live
 *  child has one: there is nothing to stop in a finished session. */
export const stopCmd = (s: HomeSession) => `claude stop ${s.id}`

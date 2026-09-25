import { childWord, isOpen, isRecent, type ChildSession, type Mission, type Pr, type RepoGroup, type Snapshot } from '../mission/types'

/** The Dispatch tab's model (spec `2026-09-25-dispatch-tab-design.md`, decisions 1, 3 and 5):
 *  which children belong to a parent workspace, grouped by wave, and in what order they show.
 *  Pure: the live stores are read in `live.ts`. */

/** The section of the children that belong to no wave (no `feat/<feature>/<piece>` branch). It
 *  is also the `feature` of its `WaveLine`, and `openDispatch(parent, ISSUES)` opens on it. */
export const ISSUES = 'Issues'

/** One line of a parent's card in the left sidebar: a wave, and how its children stand. */
export type WaveLine = { feature: string; needsYou: number; working: number; done: number }

/** What a row says a child is doing. A piece whose child is gone (its PR is all that is left)
 *  is done. */
export type RowState = 'needs-you' | 'working' | 'done'

/** One child's row: its piece of the wave (its own name in Issues), and its PR. */
export type Row = {
  key: string
  piece: string
  branch: string | null
  child: ChildSession | null
  pr: Pr | null
  state: RowState
}

/** One section of the tab. `key` names it across polls and reloads (`waveKey`). */
export type Wave = {
  key: string
  feature: string
  /** The contract's path; empty when none was found, and for Issues. */
  contract: string
  /** Every piece has a PR with green CI: the parent session may land it (`mission.rs`). */
  landable: boolean
  issues: boolean
  /** Needs you first, then working, then done. */
  rows: Row[]
  needsYou: number
  working: number
  done: number
  /** Nothing in it is working or waiting on you: the section shows folded. */
  finished: boolean
}

const norm = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p)
const within = (path: string, dir: string) => path === dir || path.startsWith(dir === '/' ? dir : `${dir}/`)

/** A wave's name across polls and reloads: its repo and its feature. */
export const waveKey = (root: string, feature: string) => `${norm(root)}#${feature}`
/** A child of no wave counts as a wave of its own for opening the tab (`watch.ts`). */
export const issueKey = (root: string, id: string) => `${norm(root)}#${ISSUES}:${id}`

/** `claude agents` says what a child is parked on before its tempo does: a permission prompt, a
 *  sandbox request or the multiple-choice dialog is waiting on you (`childStatus`); a dialog the
 *  user opened is not. */
function asks(c: ChildSession): boolean {
  const on = c.waiting_for?.toLowerCase() ?? ''
  return on.includes('permission') || on.includes('input needed') || on.includes('sandbox')
}

export function rowState(child: ChildSession | null): RowState {
  if (!child) return 'done'
  const word = childWord(child)
  if (word === 'done' || word === 'stopped') return 'done'
  if (word === 'BLOCKED' || asks(child)) return 'needs-you'
  return 'working'
}

const RANK: Record<RowState, number> = { 'needs-you': 0, working: 1, done: 2 }

function wave(key: string, feature: string, contract: string, landable: boolean, issues: boolean, rows: Row[]): Wave {
  // Stable: within a state the snapshot's order (the contract's pieces) holds.
  const sorted = rows.map((r, i) => [r, i] as const).sort((a, b) => RANK[a[0].state] - RANK[b[0].state] || a[1] - b[1]).map(([r]) => r)
  const count = (s: RowState) => rows.filter((r) => r.state === s).length
  const needsYou = count('needs-you')
  const working = count('working')
  return { key, feature, contract, landable, issues, rows: sorted, needsYou, working, done: count('done'), finished: needsYou + working === 0 }
}

/** Whether a wave stays in the tab. One whose PRs are all merged or closed and none of whose
 *  children is live leaves it, or every old wave would stay forever. A child that ended without
 *  a PR keeps its wave for as long as the sidebar keeps a finished child (`isRecent`), so a wave
 *  that stopped short does not vanish the moment its last child does. */
export function waveStays(m: Pick<Mission, 'pieces'>, now = Date.now()): boolean {
  return m.pieces.some((p) => isOpen(p.pr) || (p.child && (p.child.live || (!p.pr && isRecent(p.child, now)))))
}

/** A child of no wave stays while it runs, while its PR is open, and for a while after it ends. */
const issueStays = (c: ChildSession, now: number) => c.live || isOpen(c.pr) || isRecent(c, now)

/** The parent workspace of a child (decision 1): the worktree holding the cwd of the session that
 *  dispatched it, the deepest of `worktrees` (every worktree the app knows), else that cwd itself
 *  (a parent runs at its worktree's root); when that session is gone, the repo's main checkout.
 *  Null when the snapshot does not list the child. */
export function parentOf(snap: Snapshot, childId: string, worktrees: readonly string[]): string | null {
  for (const repo of snap.repos) {
    const child = repoChildren(repo).find((c) => c.id === childId)
    if (child) return parentIn(repo, child, worktrees)
  }
  return null
}

function repoChildren(repo: RepoGroup): ChildSession[] {
  return [...repo.missions.flatMap((m) => m.pieces.flatMap((p) => (p.child ? [p.child] : []))), ...repo.children]
}

function parentIn(repo: RepoGroup, child: ChildSession, worktrees: readonly string[]): string {
  const session = child.parent_session ? repo.parents.find((p) => p.session_id === child.parent_session) : undefined
  if (!session?.cwd) return norm(repo.root)
  const cwd = norm(session.cwd)
  const holder = worktrees.map(norm).filter((w) => within(cwd, w)).sort((a, b) => b.length - a.length)[0]
  return holder ?? cwd
}

/** The sections of parent workspace `parent`'s tab: its waves, newest first, then Issues. A wave
 *  belongs to the parent of its children (the first one's, should they disagree); a wave none of
 *  whose children is left belongs to its repo's main checkout. `born` says when a wave was first
 *  seen (`watch.ts`); unknown ones follow the known, the snapshot's later ones first (contracts are
 *  dated, so the newer sort last). */
export function wavesOf(snap: Snapshot, parent: string, worktrees: readonly string[], born: (key: string) => number | undefined = () => undefined, now = Date.now()): Wave[] {
  const want = norm(parent)
  const out: { wave: Wave; born: number; order: number }[] = []
  const issues: Row[] = []
  let order = 0
  for (const repo of snap.repos) {
    for (const m of repo.missions) {
      order++
      const first = m.pieces.find((p) => p.child)?.child
      const owner = first ? parentIn(repo, first, worktrees) : norm(repo.root)
      if (owner !== want || !waveStays(m, now)) continue
      const rows = m.pieces
        .filter((p) => p.child || p.pr)
        .map((p): Row => ({ key: p.child?.id ?? `piece:${p.branch}`, piece: p.name, branch: p.branch, child: p.child, pr: p.pr, state: rowState(p.child) }))
      const key = waveKey(repo.root, m.feature)
      out.push({ wave: wave(key, m.feature, m.contract_path, m.landable, false, rows), born: born(key) ?? 0, order })
    }
    for (const c of repo.children) {
      if (parentIn(repo, c, worktrees) !== want || !issueStays(c, now)) continue
      issues.push({ key: c.id, piece: c.name ?? c.intent ?? c.id, branch: c.branch, child: c, pr: c.pr ?? null, state: rowState(c) })
    }
  }
  const waves = out.sort((a, b) => b.born - a.born || b.order - a.order).map((w) => w.wave)
  return issues.length ? [...waves, wave(`${want}#${ISSUES}`, ISSUES, '', false, true, issues)] : waves
}

/** The sidebar's lines for a parent's card: one per section of its tab, in the tab's order. */
export function waveLines(waves: readonly Wave[]): WaveLine[] {
  return waves.map((w) => ({ feature: w.feature, needsYou: w.needsYou, working: w.working, done: w.done }))
}

/** The tab's title carries the alert (decision 3): "Dispatch · 2 need you". */
export function dispatchTitle(waves: readonly Wave[]): string {
  const n = waves.reduce((sum, w) => sum + w.needsYou, 0)
  return n ? `Dispatch · ${n} need${n === 1 ? 's' : ''} you` : 'Dispatch'
}

/** The section `target` names: a wave's feature, or the one holding child `target`. */
export function waveOfTarget(waves: readonly Wave[], target: string | undefined): Wave | undefined {
  if (!target) return undefined
  return waves.find((w) => w.rows.some((r) => r.child?.id === target)) ?? waves.find((w) => w.feature === target)
}

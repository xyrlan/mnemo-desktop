// The Missions panel's pure part: which repos it lists and what each holds, the rows the cursor
// walks, what a key does, and how a launch is going. The data is the ship's window's: Home's
// last GitHub read (`tasks/model`), the mission snapshot, the cockpit's jobs. What a pick does,
// which contract a mission came from and how a job reads are the ship's own
// (`src/nexus/windows/missions/model.ts`), used where they are.

import type { Job } from '../../cockpit/store'
import { contractDispatchKey, dispatchKey } from '../../github/actions'
import { linkIssues, linkWord, type Issue, type IssueLink } from '../../github/types'
import type { HomeRepo, HomeSnapshot, Pr } from '../../home/types'
import { childWord, missionSummary, type Mission, type Piece, type Snapshot } from '../../mission/types'
import { jobLine, missionOf, robotOf } from '../../nexus/windows/missions/model'
import { samePath } from '../../path/path'
import { taskRepos } from '../../tasks/model'
import { STATE_ORDER, type SessionState } from '../../world/types'
import { plural } from '../projects/model'
import type { Flags, Launch } from './store'

/** One repo as the panel lists it: its contract missions, then its open issues and pull
 *  requests, and what already works on each issue. */
export interface Section {
  repo: HomeRepo
  missions: Mission[]
  issues: Issue[]
  prs: Pr[]
  links: Map<number, IssueLink>
  /** Why GitHub could not read it, when it could not. */
  error: string | null
}

const groupOf = (mission: Snapshot, root: string) => mission.repos.find((g) => samePath(g.root, root))

/** The repos the panel lists, in Home's order: one with an issue, a pull request, GitHub's
 *  reason it could not be read, or a mission dispatched from a contract. Hidden and unresolved
 *  repos stay out, as in Tasks. `only` keeps one repo; under a query a repo is listed for what
 *  matches in it (a mission by its feature). */
export function sectionsOf(home: HomeSnapshot, mission: Snapshot, query: string, only: string | null): Section[] {
  const tasks = new Map(taskRepos(home, query).map((g) => [g.repo.root, g]))
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  const out: Section[] = []
  for (const repo of home.repos) {
    if (repo.hidden || repo.unresolved) continue
    if (only && !samePath(repo.root, only)) continue
    const group = groupOf(mission, repo.root)
    const missions = (group?.missions ?? []).filter((m) => terms.every((t) => `${m.feature} ${repo.name}`.toLowerCase().includes(t)))
    const task = tasks.get(repo.root)
    if (!task && !missions.length) continue
    out.push({
      repo,
      missions,
      issues: task?.issues ?? [],
      prs: task?.prs ?? [],
      links: group ? linkIssues(group, repo.issues ?? []) : new Map(),
      error: task?.error ?? null,
    })
  }
  return out
}

/** A row the cursor can stand on. */
export type Row =
  | { kind: 'mission'; key: string; root: string; mission: Mission }
  | { kind: 'issue'; key: string; root: string; issue: Issue; link: IssueLink | undefined }
  | { kind: 'pr'; key: string; root: string; pr: Pr }

/** Every row in the order shown: each repo's missions, its issues, its pull requests. */
export function rowsOf(sections: Section[]): Row[] {
  return sections.flatMap((s) => [
    ...s.missions.map((mission): Row => ({ kind: 'mission', key: `mission:${s.repo.root}#${mission.feature}`, root: s.repo.root, mission })),
    ...s.issues.map((issue): Row => ({ kind: 'issue', key: `issue:${s.repo.root}#${issue.number}`, root: s.repo.root, issue, link: s.links.get(issue.number) })),
    ...s.prs.map((pr): Row => ({ kind: 'pr', key: `pr:${s.repo.root}#${pr.number}`, root: s.repo.root, pr })),
  ])
}

/** What a key asks of the panel while the list has the focus. */
export type Act =
  | { kind: 'move'; by: 1 | -1 }
  /** Space: pick the issue under the cursor, or drop it; with shift, the range from the last pick. */
  | { kind: 'pick'; range: boolean }
  /** D: the issue under the cursor alone, ready to dispatch. */
  | { kind: 'only' }
  /** Enter: do what the bar at the foot says. */
  | { kind: 'confirm' }
  | { kind: 'land' }
  | { kind: 'open' }
  | { kind: 'contract' }
  | { kind: 'filter' }
  | { kind: 'read' }
  | { kind: 'flag'; flag: keyof Flags }

type Key = { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean }

/** The act a key asks for; null when the key is not the panel's (it goes on to the frame). */
export function actOf(e: Key): Act | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null
  switch (e.key.length === 1 ? e.key.toLowerCase() : e.key) {
    case 'ArrowDown':
    case 'j':
      return { kind: 'move', by: 1 }
    case 'ArrowUp':
    case 'k':
      return { kind: 'move', by: -1 }
    case ' ':
      return { kind: 'pick', range: !!e.shiftKey }
    case 'd':
      return { kind: 'only' }
    case 'Enter':
      return { kind: 'confirm' }
    case 'l':
      return { kind: 'land' }
    case 'o':
      return { kind: 'open' }
    case 'p':
      return { kind: 'contract' }
    case '/':
      return { kind: 'filter' }
    case 'u':
      return { kind: 'read' }
    case 'm':
      return { kind: 'flag', flag: 'model' }
    case 'e':
      return { kind: 'flag', flag: 'effort' }
    case 'y':
      return { kind: 'flag', flag: 'may' }
    case 'v':
      return { kind: 'flag', flag: 'advisor' }
    default:
      return null
  }
}

/** The value after `value` in `options`, round and round: what a flag's key steps to. */
export function nextOf(options: readonly string[], value: string): string {
  return options[(options.indexOf(value) + 1) % options.length] ?? ''
}

/** A state of the fleet's own vocabulary and a word, for a thing that is not a session: a
 *  piece, an issue in flight, a launch. The state picks the shape and the hue (`StateMark`). */
export interface Standing {
  state: SessionState
  word: string
}

const urgent = (states: SessionState[]): SessionState => STATE_ORDER.find((s) => states.includes(s)) ?? 'ended'

const CHILD: Record<ReturnType<typeof childWord>, SessionState> = { BLOCKED: 'need', active: 'working', stalled: 'stalled', done: 'ended', stopped: 'ended' }

/** How one piece of a mission stands: its pull request when it has one (green is ready, red is
 *  stalled), else its child, else not started. */
export function pieceStanding(p: Piece): Standing {
  const word = p.child ? childWord(p.child) : null
  if (word === 'BLOCKED') return { state: 'need', word: 'blocked' }
  if (p.pr) {
    const n = `#${p.pr.number}`
    if (p.pr.state === 'MERGED') return { state: 'ended', word: `${n} merged` }
    if (p.pr.ci === 'fail') return { state: 'stalled', word: `${n} checks fail` }
    if (p.pr.ci === 'pending') return { state: 'working', word: `${n} checks running` }
    return { state: 'ready', word: p.pr.ci === 'pass' ? `${n} checks pass` : `${n} open` }
  }
  if (word) return { state: CHILD[word], word }
  return { state: 'idle', word: 'not started' }
}

/** How a mission stands as a whole, in a few words: its pieces, how many have a pull request,
 *  and whether it can land. */
export function missionStanding(m: Mission): Standing {
  const sum = missionSummary(m)
  const words = [plural(sum.total, 'piece'), `${sum.withPr} with a PR`]
  if (m.landable) return { state: 'ready', word: [...words, 'ready to land'].join(' · ') }
  return { state: urgent(m.pieces.map((p) => pieceStanding(p).state)), word: words.join(' · ') }
}

/** How an issue in flight stands, from the one word the cockpit gives it (`linkWord`). */
export function flightStanding(link: IssueLink): Standing {
  const word = linkWord(link) ?? 'in flight'
  const state: SessionState = /BLOCKED/.test(word) ? 'need' : /✗|stalled/.test(word) ? 'stalled' : /active/.test(word) ? 'working' : /^PR /.test(word) ? 'ready' : 'ended'
  return { state, word: word.replace('BLOCKED', 'blocked') }
}

/** The session behind an issue in flight, to open on stage: its child's session id, or the
 *  child's own short id when the snapshot has no session for it yet. */
export function sessionOfLink(link: IssueLink | undefined): string | null {
  const robot = robotOf(link)
  return robot ? (robot.session_id ?? robot.id) : null
}

/** How a launch is going, and the session to open for it when there is one. */
export interface Progress extends Standing {
  open: string | null
}

/** A launch as it stands now. A refusal is its reason. Otherwise the mission snapshot says how
 *  the work itself goes: each dispatched issue's child or pull request, a contract's pieces.
 *  Before the snapshot knows it, the job `mnemo dispatch` runs under says its last line, and
 *  before that the action's own answer does. */
export function progressOf(l: Launch, jobs: Record<string, Job>, mission: Snapshot, home: HomeSnapshot): Progress {
  if (l.outcome && !l.outcome.ok) return { state: 'stalled', word: l.outcome.why, open: null }
  const group = groupOf(mission, l.root)

  if (l.kind === 'land') {
    if (!l.outcome) return { state: 'working', word: 'rehearsing, then merging…', open: null }
    return { state: 'ended', word: l.outcome.note ?? 'landed', open: null }
  }

  if (l.kind === 'contract' && l.path) {
    const m = missionOf(l.root, l.path, group?.missions ?? [])
    if (m) return { ...missionStanding(m), open: null }
  }

  if (l.kind === 'issues' && group) {
    const issues = home.repos.find((r) => samePath(r.root, l.root))?.issues ?? []
    const links = linkIssues(group, issues)
    const flying = l.issues.flatMap((n) => {
      const link = links.get(n)
      return link ? [{ n, link, ...flightStanding(link) }] : []
    })
    if (flying.length) {
      const state = urgent(flying.map((f) => f.state))
      const first = flying.find((f) => f.state === state)
      return { state, word: flying.map((f) => `#${f.n} ${f.word}`).join(' · '), open: sessionOfLink(first?.link) }
    }
  }

  // Nothing in the snapshot yet: the job, then the answer.
  const job = jobs[l.kind === 'contract' && l.path ? contractDispatchKey(l.root, l.path) : dispatchKey(l.root, l.issues)]
  if (job) {
    const line = jobLine(job)
    return { state: line.tone === 'fail' ? 'stalled' : line.tone === 'run' ? 'working' : 'idle', word: line.text, open: null }
  }
  if (!l.outcome) return { state: 'working', word: 'starting…', open: null }
  return { state: 'idle', word: l.outcome.note ?? 'dispatched', open: null }
}

/** A launch's name: what was asked, and where. */
export function launchTitle(l: Launch): string {
  if (l.kind === 'land') return `land ${l.feature ?? ''}`.trim()
  if (l.kind === 'contract') return `contract ${l.path ?? ''}`.trim()
  return l.issues.map((n) => `#${n}`).join(', ')
}

/** The flags a launch carried, as words; empty when it carried none. */
export function flagWords(o: Launch['options']): string {
  return [o.model, o.effort, o.may && `may ${o.may}`, o.advisor && `advisor ${o.advisor}`].filter(Boolean).join(' · ')
}

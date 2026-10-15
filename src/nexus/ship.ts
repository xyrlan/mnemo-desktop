import { childNext } from '../fleet/model'
import { basename, dirname, norm } from '../path/path'
import { needKind, permissionAsk, type ChildSession, type Mission, type ParentSession, type Pr, type RepoGroup } from '../mission/types'
import { injectedRules } from './packets'
import {
  orphanCaptainId,
  type ActionKind,
  type Activity,
  type AgentView,
  type Captain,
  type CaptainPose,
  type CheckRun,
  type Ci,
  type Deck,
  type Dock,
  type Exception,
  type Need,
  type PrFate,
  type RobotState,
  type SessionFeed,
  type Ship,
  type ShipInput,
  type ShipRobot,
  type Zone,
} from './ship-types'
import { accessoryOf, classOf, isRateLimited, labelOf } from './world'

/* ------------------------------------------------------------------ calibration --
   The prototype's numbers (`docs/superpowers/prototypes/nexus-v2/index.html`), measured on the
   real fleet (spec "Facts it was designed on"). */

/** Without a new action for this long, a session is no longer working. */
export const WORK_GAP_MS = 150_000
/** A tool call still awaiting its result is a command running (a CI watch, a full suite) for at
 *  most this long; older, it is a call that will never answer. */
export const RUNNING_MAX_MS = 3 * 60 * 60 * 1000
/** Idle for longer than this, with no command running: stranded. */
export const STRANDED_MS = 15 * 60_000
/** A child that ended this long ago is done (before that it may still be writing its last line). */
export const DONE_AFTER_MS = 60_000
/** A child without a PR leaves the ship this long after it ended. */
export const LINGER_MS = 40 * 60_000

/* ------------------------------------------------------------------------------- */

export const EMBLEMS = ['◆', '●', '▲', '■', '★', '✚', '♦', '✦'] as const
const ORPHAN_EMBLEM = '?'
const TWINS = 'abcdefghijklmnopqrstuvwxyz'

/** A tool's glyph in an `act` line, as the prototype prints it. */
const ICON: Record<string, string> = {
  Bash: '⌘', Edit: '✎', Write: '✎', MultiEdit: '✎', NotebookEdit: '✎', Read: '◉', Grep: '⌕', Glob: '⌕', Agent: '⇢', Task: '⇢',
  WebFetch: '◎', WebSearch: '◎', TodoWrite: '☑', Skill: '★', SendMessage: '✉', Monitor: '◷', AskUserQuestion: '?',
}

const TEST_RE = /\b(pytest|vitest|jest|pnpm (run )?(test|build|tsc|lint|check|typecheck)|npm (run )?(test|build)|cargo (test|build|check|clippy|nextest)|tsc\b|ruff|mypy|go test|tox)/i
const SHIP_RE = /\b(git (commit|push|tag|rebase|merge)|gh (pr|run|release)|pr checks|claude stop|mnemo (deliver|land))/i
const EDIT_SH = /(sed -i|perl -pi|cat >|tee |apply_patch|> [\w./-]+\.(py|ts|tsx|rs|md|json))/
const FAILED = /FAIL|ERROR|CANCEL|TIMED|ACTION_REQUIRED/i

/** `6s`, `9 min`, `1.5 h`. */
export function ago(ms: number): string {
  const s = Math.max(0, ms) / 1000
  return s < 60 ? `${Math.round(s)}s` : s < 3600 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`
}

/** The first sentence of an assistant's text (at least 20 characters), without markdown marks, at
 *  most `n` characters. */
export function firstSentence(text: string, n = 160): string {
  const t = text.replace(/[*`#|]/g, '').replace(/\s+/g, ' ').trim()
  const m = /^(.{20,}?[.!?:])\s/.exec(t)
  const r = m ? m[1] : t
  return r.length > n ? `${r.slice(0, n - 1)}…` : r
}

/** `⌘ Bash · pnpm test`. */
export const toolLine = (a: Pick<Activity, 'tool' | 'target'>) => `${ICON[a.tool] ?? '⚙'} ${a.tool}${a.target ? ` · ${a.target}` : ''}`

/** The action badge for a tool call. */
export function actionOf(a: Pick<Activity, 'tool' | 'target'>): ActionKind {
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(a.tool)) return 'edit'
  if (a.tool === 'Bash' || a.tool === 'Monitor') {
    if (TEST_RE.test(a.target)) return 'test'
    if (SHIP_RE.test(a.target)) return 'ship'
    if (EDIT_SH.test(a.target)) return 'edit'
  }
  return 'read'
}

/** CI on a PR at `now`, from when each check of its last run started and finished: queued until
 *  one has started, running until all have finished, then red if any failed. */
export function ciAt(checks: CheckRun[], now: number): Ci {
  if (!checks.length) return null
  if (!checks.some((k) => k.startedAt !== null && k.startedAt <= now)) return 'wait'
  if (checks.some((k) => k.completedAt === null || k.completedAt > now)) return 'run'
  return checks.some((k) => FAILED.test(k.conclusion ?? '')) ? 'red' : 'green'
}

const CI_OF: Record<Pr['ci'], Ci> = { pass: 'green', fail: 'red', pending: 'run', none: null }

/** What became of a PR at `now`: the feed's fate, else the snapshot's state. Final either way. */
function prEnd(pr: Pr, fate: PrFate | null, now: number): { kind: 'merged' | 'closed'; at: number | null } | null {
  if (fate?.state === 'MERGED' && (fate.mergedAt ?? -Infinity) <= now) return { kind: 'merged', at: fate.mergedAt }
  if (fate?.state === 'CLOSED' && (fate.closedAt ?? -Infinity) <= now) return { kind: 'closed', at: fate.closedAt }
  if (pr.state === 'MERGED') return { kind: 'merged', at: fate?.mergedAt ?? null }
  if (pr.state === 'CLOSED') return { kind: 'closed', at: fate?.closedAt ?? null }
  return null
}

/* ------------------------------------------------------------------ repos --- */

const joinPath = (dir: string, name: string) => (dir.endsWith('/') ? `${dir}${name}` : `${dir}/${name}`)

/** The repo a group's root folds into (v1's rule, `world.ts`): itself, or for a `<repo>-wt-<name>`
 *  folder its sibling `<repo>`, preferring one the snapshot knows. */
function foldedRoot(root: string, known: Map<string, RepoGroup>): string {
  const name = basename(root)
  const dir = dirname(root)
  const bases: string[] = []
  for (let i = name.indexOf('-wt-'); i >= 0; i = name.indexOf('-wt-', i + 1)) {
    if (i > 0 && i + 4 < name.length) bases.push(joinPath(dir, name.slice(0, i)))
  }
  if (!bases.length) return norm(root)
  return norm(bases.find((b) => known.has(norm(b))) ?? bases[0])
}

type Repo = { key: string; root: string; name: string; parents: ParentSession[]; missions: Mission[] }

/* ------------------------------------------------------------------ departures --
   A robot leaves at its PR's fate, and the ship it leaves no longer holds it; `logEvents` still
   has to tell a merge from a close and date it. The ships `buildShip` returns carry the robots that
   left by a PR here, keyed by the ship, so the shared `Ship` type stays as agreed. */

export type Departure = { robot: ShipRobot; kind: 'merged' | 'closed'; at: number | null }

const DEPARTED = new WeakMap<Ship, Departure[]>()

/** The robots whose PR merged or closed by the time `ship` was built (as the snapshot still holds
 *  them), with when. Empty for a ship `buildShip` did not build. */
export const departuresOf = (ship: Ship): Departure[] => DEPARTED.get(ship) ?? []

/* ------------------------------------------------------------------ the ship --- */

type Seat = { child: ChildSession; pr: Pr | null; piece: string | null; repo: Repo }

const ended = (c: ChildSession) => !c.live || c.state === 'done' || c.state === 'stopped' || c.state === 'failed'

const parseTime = (iso: string | null): number => (iso ? Date.parse(iso) : NaN)

/** The newest of the times given, ignoring missing ones; NaN when none is known. */
function latest(...xs: Array<number | null | undefined>): number {
  let out = NaN
  for (const x of xs) if (typeof x === 'number' && Number.isFinite(x) && !(x <= out)) out = x
  return out
}

/** `claude stop` writes `stopped` as the detail: it says nothing a robot should repeat. */
const ownLine = (detail: string) => (/^\s*stopped\s*$/i.test(detail) ? '' : detail.trim())

/** The fleet as a ship (spec "What it is", "What each figure is computed from"): pure, and the same
 *  input gives the same ship. */
export function buildShip(input: ShipInput): Ship {
  const { snapshot, feed, agents, firstSeen, now } = input
  const sessions = feed?.sessions ?? {}
  const prs = feed?.prs ?? {}

  // ---------------------------------------------------------------- repos
  const known = new Map(snapshot.repos.map((r) => [norm(r.root), r]))
  const repos = new Map<string, Repo>()
  const repoOf = (r: RepoGroup): Repo => {
    const key = foldedRoot(r.root, known)
    let repo = repos.get(key)
    if (!repo) {
      const base = known.get(key)
      repo = { key, root: base?.root ?? key, name: base?.name ?? basename(key), parents: [], missions: [] }
      repos.set(key, repo)
    }
    return repo
  }
  const parentRepo = new Map<string, Repo>()
  const parents = new Map<string, ParentSession>()
  for (const r of snapshot.repos) {
    const repo = repoOf(r)
    for (const p of r.parents) {
      if (parents.has(p.session_id)) continue
      parents.set(p.session_id, p)
      parentRepo.set(p.session_id, repo)
      repo.parents.push(p)
    }
    for (const m of r.missions) if (!repo.missions.some((x) => x.contract_path === m.contract_path)) repo.missions.push(m)
  }

  // Every child once: a piece's row (with its piece's PR) before the repo's own list.
  const seats: Seat[] = []
  const seen = new Set<string>()
  for (const r of snapshot.repos) {
    const repo = repoOf(r)
    for (const m of r.missions)
      for (const p of m.pieces)
        if (p.child && !seen.has(p.child.id)) {
          seen.add(p.child.id)
          seats.push({ child: p.child, pr: p.pr ?? p.child.pr ?? null, piece: p.name, repo })
        }
    for (const c of r.children)
      if (!seen.has(c.id)) {
        seen.add(c.id)
        seats.push({ child: c, pr: c.pr ?? null, piece: null, repo })
      }
  }
  const spawnKey = (c: ChildSession) => c.session_id ?? c.id
  const spawnedAt = (c: ChildSession) => firstSeen[spawnKey(c)] ?? now
  seats.sort((a, b) => spawnedAt(a.child) - spawnedAt(b.child) || cmp(a.child.id, b.child.id))

  // ---------------------------------------------------------------- captains
  // A grandchild stands under its top captain, tagged with the child that dispatched it.
  const childBySession = new Map<string, Seat>()
  for (const s of seats) {
    childBySession.set(s.child.id, s)
    if (s.child.session_id) childBySession.set(s.child.session_id, s)
  }
  const top = (s: Seat): { captainId: string; via: Seat | null; repo: Repo } => {
    let via: Seat | null = null
    let up = s.child.parent_session ?? null
    for (let guard = 0; up && guard < 8; guard++) {
      const p = childBySession.get(up)
      if (!p || p === s) break
      via ??= p
      up = p.child.parent_session ?? null
    }
    if (!up || childBySession.has(up)) return { captainId: orphanCaptainId(s.repo.root), via, repo: s.repo }
    return { captainId: up, via, repo: parentRepo.get(up) ?? s.repo }
  }

  // ---------------------------------------------------------------- robots
  // Twins under one captain share an issue: `a`, `b`, … in spawn order, over every child the
  // snapshot holds, so a twin keeps its letter when its sibling leaves.
  const tops = seats.map((s) => ({ s, ...top(s), label: labelOf(s.child, s.piece) }))
  const twinGroups = new Map<string, string[]>()
  for (const t of tops)
    if (/^#\d+$/.test(t.label)) {
      const k = `${t.captainId}\0${t.label}`
      twinGroups.set(k, [...(twinGroups.get(k) ?? []), t.s.child.id])
    }
  const twinOf = (captainId: string, label: string, id: string): string | null => {
    const g = twinGroups.get(`${captainId}\0${label}`)
    return g && g.length > 1 ? TWINS[g.indexOf(id) % TWINS.length] : null
  }

  type Placed = { robot: ShipRobot; repo: Repo; endedAt: number; left: Departure | null }
  const placed: Placed[] = []
  const childrenOf = new Map<string, number>() // repo key -> children the snapshot holds, for deck order
  for (const { s, captainId, via, repo } of tops) {
    childrenOf.set(repo.key, (childrenOf.get(repo.key) ?? 0) + 1)
    const fate = s.pr ? (prs[s.pr.url] ?? null) : null
    const p = robotOf(s, captainId, via, sessions[s.child.id] ?? null, fate, agents, input, now)
    if (!p) continue
    p.robot.twin = twinOf(captainId, p.robot.label, s.child.id)
    if (p.robot.twin) p.robot.label = `${p.robot.label}·${p.robot.twin}`
    if (via) {
      const vt = twinOf(captainId, labelOf(via.child, via.piece), via.child.id)
      if (vt) p.robot.via = `${p.robot.via}·${vt}`
    }
    placed.push({ ...p, repo })
  }
  const aboard = placed.filter((p) => !p.left)
  const departed = placed.flatMap((p) => (p.left ? [{ ...p.left, robot: p.robot }] : []))

  // ---------------------------------------------------------------- captains, by repo
  const crewOf = new Map<string, ShipRobot[]>()
  for (const p of aboard) crewOf.set(p.robot.captainId, [...(crewOf.get(p.robot.captainId) ?? []), p.robot])
  const deckRepoOfCaptain = new Map<string, Repo>()
  for (const p of aboard) if (!deckRepoOfCaptain.has(p.robot.captainId)) deckRepoOfCaptain.set(p.robot.captainId, p.repo)

  const sightOf = (id: string) => firstSeen[id] ?? Infinity
  const captainOf = (id: string, parent: ParentSession | null, emblem: string): Captain => {
    const crew = crewOf.get(id) ?? []
    const view = agents[id]
    const f = parent ? (sessions[id] ?? null) : null
    let pose: CaptainPose
    if (id.startsWith('orphan:')) pose = 'empty'
    else if (!parent) pose = 'offline'
    else if (crew.some((r) => r.state === 'need') || parentNeeds(parent, view)) pose = 'alert'
    else if (view ? view.state === 'working' : parent.status === 'busy') pose = 'busy'
    else pose = 'idle'
    const busy = pose === 'busy' || (pose === 'alert' && (view ? view.state === 'working' : parent?.status === 'busy'))
    return {
      id,
      parent,
      name: id.startsWith('orphan:') ? 'no parent' : view?.title || parent?.name || `session ${id.slice(0, 8)}`,
      emblem,
      pose,
      topic: f?.topic ?? null,
      action: busy && f ? captainAction(f) : null,
      notices: crew.filter((r) => r.child.notice === 'held').length,
    }
  }

  // Emblems in order of first sight within the repo: its live parents, and the ended ones its
  // children still name.
  const captainsByRepo = new Map<string, Captain[]>()
  const allCaptainIds = new Set<string>([...repos.values()].flatMap((r) => r.parents.map((p) => p.session_id)))
  for (const id of crewOf.keys()) allCaptainIds.add(id)
  const homeOf = (id: string): Repo | undefined => parentRepo.get(id) ?? deckRepoOfCaptain.get(id)
  const ids = [...allCaptainIds].sort((a, b) => sightOf(a) - sightOf(b) || cmp(a, b))
  const counter = new Map<string, number>()
  for (const id of ids) {
    const repo = homeOf(id)
    if (!repo) continue
    let emblem = ORPHAN_EMBLEM
    if (!id.startsWith('orphan:')) {
      const n = counter.get(repo.key) ?? 0
      counter.set(repo.key, n + 1)
      emblem = EMBLEMS[n % EMBLEMS.length]
    }
    captainsByRepo.set(repo.key, [...(captainsByRepo.get(repo.key) ?? []), captainOf(id, parents.get(id) ?? null, emblem)])
  }

  // ---------------------------------------------------------------- decks and docks
  const byRepo = new Map<string, Placed[]>()
  for (const p of aboard) byRepo.set(p.repo.key, [...(byRepo.get(p.repo.key) ?? []), p])

  const decks: Deck[] = []
  const docks: Dock[] = []
  for (const repo of repos.values()) {
    const all = captainsByRepo.get(repo.key) ?? []
    const mine = byRepo.get(repo.key) ?? []
    if (!mine.length) {
      const live = all.filter((c) => c.parent)
      if (live.length) docks.push({ root: repo.root, name: repo.name, captains: live })
      continue
    }
    const working = (c: Captain) => (crewOf.get(c.id) ?? []).filter((r) => r.state === 'working').length
    const captains = all
      .filter((c) => crewOf.has(c.id) || c.pose === 'busy')
      .map((c, i) => ({ c, i }))
      .sort((a, b) => +(b.c.pose === 'alert') - +(a.c.pose === 'alert') || working(b.c) - working(a.c) || +(b.c.pose === 'busy') - +(a.c.pose === 'busy') || a.i - b.i)
      .map(({ c }) => c)
    const quiet = all.filter((c) => c.parent && !captains.includes(c))
    const room = (z: Zone) => mine.filter((p) => p.robot.zone === z)
    const hangar = room('hangar')
      .sort((a, b) => b.endedAt - a.endedAt || cmp(a.robot.id, b.robot.id))
      .map((p) => p.robot)
    decks.push({
      root: repo.root,
      name: repo.name,
      captains,
      quiet,
      flight: room('flight').map((p) => p.robot),
      hangar,
      stranded: room('stranded').map((p) => p.robot),
      hangarReady: hangar.some((r) => r.ci === 'green'),
    })
  }
  const deckKey = new Map([...repos.values()].map((r) => [r.root, r.key]))
  decks.sort((a, b) => (childrenOf.get(deckKey.get(b.root)!) ?? 0) - (childrenOf.get(deckKey.get(a.root)!) ?? 0) || cmp(a.name, b.name) || cmp(a.root, b.root))
  docks.sort((a, b) => cmp(a.name, b.name) || cmp(a.root, b.root))

  // ---------------------------------------------------------------- the bridge
  const inDeckOrder = decks.flatMap((d) => aboard.filter((p) => deckKey.get(d.root) === p.repo.key))
  const longestFirst = (a: Placed, b: Placed) => b.robot.idleMs - a.robot.idleMs || cmp(a.robot.id, b.robot.id)
  const blocked = inDeckOrder.filter((p) => p.robot.zone === 'bridge').sort(longestFirst)
  // Aboard, a robot's PR is open: one that merged or closed has left.
  const waiting = inDeckOrder.filter((p) => p.robot.zone === 'hangar' && p.robot.pr)
  const deckRank = new Map(decks.map((d, i) => [d.root, i]))
  const landOrder = [...repos.values()].sort((a, b) => (deckRank.get(a.root) ?? Infinity) - (deckRank.get(b.root) ?? Infinity) || cmp(a.name, b.name))
  const exceptions: Exception[] = [
    ...blocked.map((p): Exception => ({ kind: 'need', robotId: p.robot.id, need: p.robot.need! })),
    ...waiting
      .filter((p) => p.robot.ci === 'red')
      .sort(longestFirst)
      .map((p): Exception => ({ kind: 'red', robotId: p.robot.id, pr: p.robot.pr! })),
    ...landOrder.flatMap((r) => r.missions.filter((m) => m.landable).map((m): Exception => ({ kind: 'land', root: r.root, mission: m }))),
    ...waiting
      .filter((p) => (p.robot.ci === 'green' || p.robot.ci === null) && !p.robot.pr!.draft)
      .sort(longestFirst)
      .map((p): Exception => ({ kind: 'ready', robotId: p.robot.id, pr: p.robot.pr!, waitingMs: p.robot.idleMs })),
    ...inDeckOrder
      .filter((p) => p.robot.zone === 'stranded')
      .sort(longestFirst)
      .map((p): Exception => ({ kind: 'stranded', robotId: p.robot.id, idleMs: p.robot.idleMs })),
  ]

  const robots = aboard.map((p) => p.robot)
  const ship: Ship = {
    bridge: { exceptions, blocked: blocked.map((p) => p.robot) },
    decks,
    docks,
    counts: {
      working: robots.filter((r) => r.state === 'working').length,
      need: robots.filter((r) => r.state === 'need').length,
      ready: robots.filter((r) => r.zone === 'hangar').length,
    },
    rate: feed?.rate ?? null,
    at: now,
  }
  DEPARTED.set(ship, departed)
  return ship
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** A parent's own pending decision: the fleet's answer, else its `claude agents` status. */
function parentNeeds(p: ParentSession, view: AgentView | undefined): boolean {
  if (view) return view.state === 'needs-you'
  return p.status === 'waiting' && p.waiting_for !== 'dialog open'
}

/** A busy captain's last tool, or its last sentence when that came after. */
function captainAction(f: SessionFeed): string | null {
  const a = f.activity
  const s = f.said
  if (a && (!s || a.at >= s.at)) return toolLine(a)
  return s ? firstSentence(s.text) : null
}

/** One child as a robot, or the PR fate it left by; null when it has gone without one (a child
 *  without a PR, 40 min after it ended). */
function robotOf(
  s: Seat,
  captainId: string,
  via: Seat | null,
  f: SessionFeed | null,
  fate: PrFate | null,
  agents: Record<string, AgentView>,
  input: ShipInput,
  now: number,
): { robot: ShipRobot; endedAt: number; left: Departure | null } | null {
  const c = s.child
  const pr = s.pr
  const end = pr ? prEnd(pr, fate, now) : null
  const open = !!pr && !end

  const lastAct = latest(parseTime(c.updated_at), f?.activity?.at, f?.said?.at)
  const isEnded = ended(c)
  const endedAt = isEnded ? lastAct : NaN
  // An ended child with no PR to wait on leaves 40 min after; one of unknown age has left already.
  if (!end && !open && isEnded && !(now - endedAt <= LINGER_MS)) return null

  const idleMs = Number.isFinite(lastAct) ? Math.max(0, now - lastAct) : 0
  const view = agents[c.session_id ?? c.id]
  const fleet = view ? view.state : childNext(c).state
  const fleetWaits: AgentView['waitingFor'] = view ? view.waitingFor : childNext(c).waitingFor
  const act = f?.activity ?? null
  const running = !isEnded && !!act?.running && now - act.at < RUNNING_MAX_MS
  const ask = !isEnded ? (f?.ask ?? null) : null
  const asks = !!ask || (!isEnded && fleet === 'needs-you' && !isRateLimited(c))

  let state: RobotState
  if (asks) state = 'need'
  else if (isEnded && now - endedAt > DONE_AFTER_MS) state = 'done'
  else if (running || (fleet === 'working' && idleMs <= WORK_GAP_MS)) state = 'working'
  else state = 'idle'

  let zone: Zone
  if (state === 'need') zone = 'bridge'
  else if (state === 'done') zone = 'hangar'
  // A robot whose PR is open waits for the merge in the hangar, never stranded.
  else if (state === 'idle' && open) zone = 'hangar'
  else if (state === 'idle' && idleMs > STRANDED_MS) zone = 'stranded'
  else zone = 'flight'

  const longRun = state === 'working' && running && idleMs > WORK_GAP_MS
  const current: Pick<Activity, 'tool' | 'target'> | null = act ?? (/^Running\s+\S/.test(c.detail) ? { tool: 'Bash', target: c.detail.replace(/^Running\s+/, '') } : null)
  const action: ActionKind | null = state !== 'working' ? null : longRun ? 'run' : current ? actionOf(current) : 'read'

  let actLine: string | null = null
  if (state === 'working') actLine = longRun && act ? `⧗ running for ${ago(idleMs)} · ${toolLine(act)}` : act ? toolLine(act) : null
  else if (state === 'idle' && zone !== 'hangar') actLine = `… idle for ${ago(idleMs)}${act ? ` · last: ${act.tool}` : ''}`

  let need: Need | null = null
  if (state === 'need') {
    if (ask) need = { kind: 'question', text: ask.question, options: [...ask.options] }
    else if ((fleetWaits ?? needKind(c)) === 'permission') need = { kind: 'permission', text: permissionAsk(c) ?? c.waiting_for ?? 'permission prompt', options: ['yes', 'always', 'no'] }
    else need = { kind: 'question', text: c.needs?.trim() || c.waiting_for || 'input needed', options: [] }
  }

  const said = f?.said ? firstSentence(f.said.text) : ''
  const robot: ShipRobot = {
    id: c.id,
    sessionId: c.session_id,
    child: c,
    captainId,
    label: labelOf(c, s.piece),
    via: via ? labelOf(via.child, via.piece) : null,
    klass: classOf(c.model ?? f?.model),
    accessory: accessoryOf(c.id),
    state,
    zone,
    action,
    ci: pr ? (fate ? ciAt(fate.checks, now) : CI_OF[pr.ci]) : null,
    pr,
    fate,
    line: ownLine(c.detail) || said,
    act: actLine,
    idleMs,
    context: f?.context ?? null,
    model: c.model ?? f?.model ?? null,
    contract: f?.contract ?? null,
    twin: null,
    need,
    injected: c.session_id ? injectedRules(input.events, c.session_id) : [],
  }
  return { robot, endedAt: Number.isFinite(endedAt) ? endedAt : now - idleMs, left: end ? { robot, kind: end.kind, at: end.at } : null }
}

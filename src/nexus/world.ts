import { basename, dirname, norm } from '../path/path'
import { isOpen, isRecent, type ChildSession, type ParentSession, type Pr, type RepoGroup, type Snapshot } from '../mission/types'
import { ACCESSORIES, type ArchiveCounts, type Badge, type Exit, type Halo, type Level, type Nexus, type NexusPose, type Robot, type RobotClass, type RobotPose, type Territory, type Tier, type World } from './types'

/* ------------------------------------------------------------------ calibration --
   Everything here is tuned by looking at the drawer, and lives nowhere else. */

/** How long a robot with an exit stays in the world, counted from the child's last write
 *  (`updated_at`), so the scene can play `merged` or `powered-down` before it goes. The snapshot
 *  dates neither the merge nor the notice's delivery, and the world is pure, so the last write is
 *  the only clock: an hour covers a merge after CI (3-OS CI takes ~15 min) and a notice delivered
 *  at the parent's next prompt. An exit that comes later than this is not played: the robot leaves
 *  with no exit. */
export const EXIT_MS = 60 * 60 * 1000

/** Live pages at which an archive grows (tier 1) and is full (tier 2). Live pages per project on
 *  the maintainer's vault (2026-10-14): a few for a new repo, ~70 for this one, 230–740 for the
 *  busiest; ~2,400 universal. */
export const TIER_GROWN = 50
export const TIER_FULL = 250

/* ------------------------------------------------------------------------------- */

export const tierOf = (pages: number): Tier => (pages >= TIER_FULL ? 2 : pages >= TIER_GROWN ? 1 : 0)

/** The chassis from the model (spec Q13): any spelling that names the family (`opus[1m]`,
 *  `claude-haiku-4-5`). No model, or one of no known family, is `unknown`. */
export function classOf(model: string | null | undefined): RobotClass {
  const m = (model ?? '').toLowerCase()
  if (m.includes('opus')) return 'mech'
  if (m.includes('sonnet')) return 'droid'
  if (m.includes('haiku')) return 'drone'
  return 'unknown'
}

const LEVELS: Record<string, Level> = { low: 1, medium: 2, high: 3, xhigh: 4, max: 4 }

/** The level from `--effort` (spec Q3): 0 is the default, then low … max. `xhigh` shares the top
 *  level with `max`: there are four auras and five efforts above the default. */
export const levelOf = (effort: string | null | undefined): Level => LEVELS[(effort ?? '').toLowerCase()] ?? 0

/** The identity accessory, seeded from the short id (FNV-1a): the same child wears the same one
 *  every time it is drawn. */
export function accessoryOf(id: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0) % ACCESSORIES
}

/** The child's tag: `#643` from a `<repo>-wt-643[-…]` worktree, else its contract piece, else its
 *  short id. */
export function labelOf(c: Pick<ChildSession, 'id' | 'cwd' | 'branch'>, piece: string | null): string {
  const issue = c.cwd ? /-wt-(\d+)(?:-|$)/.exec(basename(c.cwd)) : null
  if (issue) return `#${issue[1]}`
  const fromBranch = c.branch ? /^feat\/[^/]+\/([^/]+)$/.exec(c.branch)?.[1] : undefined
  return piece ?? fromBranch ?? c.id
}

/** What a working child runs now: Claude Code writes `Running <command>` as the detail of a Bash
 *  call, and nothing that names any other tool. */
export const toolOf = (detail: string): string | null => (/^Running\s+\S/.test(detail) ? 'Bash' : null)

/** A child stopped by the account's limit: mnemo's sentence for it (`rate limited — wait and
 *  retry`, `stalls.py`), or Claude Code's own "You've hit your session limit". A billing cap
 *  (`usage limit reached — check plan`) needs a person, so it is not one. */
export function isRateLimited(c: Pick<ChildSession, 'needs' | 'detail'>): boolean {
  const said = `${c.needs ?? ''}\n${c.detail}`
  return /rate[ -]?limit/i.test(said) || /hit your (?:\w+ )?limit/i.test(said)
}

const finished = (c: Pick<ChildSession, 'state' | 'live'>) => !c.live || c.state === 'done' || c.state === 'stopped'

const at = (iso: string | null): number => (iso ? Date.parse(iso) : NaN)

/** An open PR's badge (spec Q18): failing checks burn, a draft is a draft, passed checks are
 *  ready, and anything else (running, or none reported yet) is checks running. */
export function prBadge(pr: Pick<Pr, 'ci' | 'draft'>): Badge {
  if (pr.ci === 'fail') return 'fire'
  if (pr.draft) return 'flag-draft'
  return pr.ci === 'pass' ? 'flag-ready' : 'flag-pending'
}

/** A child's robot without its world: pose, halo, badge and exit per the spec's Q18 table and
 *  Q12. `pr` is the child's own or its piece's. null when the robot has left the world: its exit
 *  played out, or it finished long enough ago that it is history (Q5) and no open PR holds it. */
export function robotOf(c: ChildSession, pr: Pr | null, piece: string | null, now: number): Robot | null {
  const open = isOpen(pr)
  const rate = isRateLimited(c)
  const asks = c.live && !rate && (c.tempo === 'blocked' || c.state === 'blocked' || !!c.waiting_for)
  const done = finished(c)
  const busy = !done && c.state !== 'idle' && c.tempo !== 'idle'
  const exit: Exit = pr?.state === 'MERGED' ? 'merged' : !open && done && c.notice === 'delivered' ? 'powered-down' : null

  if (exit) {
    const since = now - at(c.updated_at)
    if (!(since < EXIT_MS)) return null
  } else if (!c.live && !open && !isRecent(c, now)) return null

  const pose: RobotPose = asks ? 'waiting' : rate ? 'sleeping' : busy ? 'working' : 'idle'
  const ready = open && pr.ci === 'pass' && !pr.draft
  // Red checks or a conflict wake the child through pr-follow: `fire`, never the needs-you halo,
  // which only the child's own ask lights. A draft outranks its running checks: they cannot make
  // it ready, only marking it ready can, so the hourglass would promise what it will not bring.
  const badge: Badge = asks ? 'alert' : rate ? 'zzz' : open ? prBadge(pr) : null
  const halo: Halo =
    exit === 'powered-down' ? null : asks ? 'needs-you' : ready || exit === 'merged' ? 'done' : pose === 'working' ? 'working' : 'idle'

  return {
    id: c.id,
    sessionId: c.session_id,
    label: labelOf(c, piece),
    klass: classOf(c.model),
    level: levelOf(c.effort),
    accessory: accessoryOf(c.id),
    pose,
    halo,
    badge,
    exit,
    tool: pose === 'working' ? toolOf(c.detail) : null,
    child: c,
  }
}

/** A live parent's pose (spec Q18). Waiting is waiting on you, whatever it is parked on. */
export function nexusPoseOf(p: Pick<ParentSession, 'status'>): NexusPose {
  if (p.status === 'busy') return 'busy'
  if (p.status === 'waiting') return 'waiting'
  return 'idle'
}

const HALO_OF: Record<NexusPose, Halo> = { busy: 'working', waiting: 'needs-you', idle: 'idle', dead: null }

/** The session id of the dead nexus that holds children whose parent nobody knows. */
export const UNKNOWN_PARENT = ''

const shortId = (id: string) => id.slice(0, 8)

const joinPath = (dir: string, name: string) => (dir.endsWith('/') ? `${dir}${name}` : `${dir}/${name}`)

/** The repo root a group's root folds into: itself, or for a `<repo>-wt-<name>` folder, its
 *  sibling `<repo>` (spec premise). The snapshot already follows git worktrees to their main
 *  checkout; this catches a tree git was not asked about (a locked folder, a removed `.git`).
 *  When `-wt-` appears more than once, a `<repo>` the snapshot knows wins, else the first. */
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

type Placed = { robot: Robot; territory: Territory }

/** The snapshot as a world (spec Q5, Q12, Q18, Q25): one territory per repo, one nexus per live
 *  session that is not a dispatched child (and per dead parent whose children still live), one robot
 *  per child that has not left. Pure: the same inputs give the same world.
 *
 *  A child whose parent is not live is placed under a dead nexus for that parent, in the
 *  territory of the first such child; a child with no known parent goes under its own repo's dead
 *  nexus `UNKNOWN_PARENT`. A territory with no nexus left is not drawn. */
export function buildWorld(snap: Snapshot, archives: ArchiveCounts, now: number): World {
  const known = new Map(snap.repos.map((r) => [norm(r.root), r]))
  const territories = new Map<string, Territory>()
  const territoryOf = (r: RepoGroup): Territory => {
    const key = foldedRoot(r.root, known)
    let t = territories.get(key)
    if (!t) {
      const base = known.get(key)
      const name = base?.name ?? basename(key)
      const pages = archives.projects[name] ?? 0
      t = { root: base?.root ?? key, name, archive: { project: name, pages, tier: tierOf(pages) }, nexuses: [] }
      territories.set(key, t)
    }
    return t
  }

  const live = new Map<string, Nexus>()
  for (const r of snap.repos) {
    const t = territoryOf(r)
    for (const p of r.parents) {
      if (live.has(p.session_id)) continue
      const pose = nexusPoseOf(p)
      const n: Nexus = { sessionId: p.session_id, label: p.name || shortId(p.session_id), cwd: p.cwd, pose, halo: HALO_OF[pose], robots: [], parent: p }
      live.set(p.session_id, n)
      t.nexuses.push(n)
    }
  }

  // Every child once, with the PR and piece its row carries.
  const seen = new Set<string>()
  const orphans: Placed[] = []
  const dead = new Map<string, { nexus: Nexus; territory: Territory }>()
  const place = (r: RepoGroup, c: ChildSession, pr: Pr | null, piece: string | null) => {
    if (seen.has(c.id)) return
    seen.add(c.id)
    const robot = robotOf(c, pr, piece, now)
    if (!robot) return
    const parentId = c.parent_session || null
    const home = parentId ? live.get(parentId) : undefined
    if (home) return void home.robots.push(robot)
    const t = territoryOf(r)
    if (!parentId) return void orphans.push({ robot, territory: t })
    let d = dead.get(parentId)
    if (!d) {
      d = { nexus: deadNexus(parentId, shortId(parentId), t.root), territory: t }
      dead.set(parentId, d)
    }
    d.nexus.robots.push(robot)
  }
  for (const r of snap.repos) {
    for (const m of r.missions) for (const p of m.pieces) if (p.child) place(r, p.child, p.pr ?? p.child.pr ?? null, p.name)
    for (const c of r.children) place(r, c, c.pr ?? null, null)
  }

  for (const id of [...dead.keys()].sort()) {
    const d = dead.get(id)!
    d.territory.nexuses.push(d.nexus)
  }
  const unknown = new Map<Territory, Nexus>()
  for (const { robot, territory } of orphans) {
    let n = unknown.get(territory)
    if (!n) {
      n = deadNexus(UNKNOWN_PARENT, 'unknown parent', territory.root)
      unknown.set(territory, n)
      territory.nexuses.push(n)
    }
    n.robots.push(robot)
  }

  const byId = (a: Robot, b: Robot) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  for (const t of territories.values()) for (const n of t.nexuses) n.robots.sort(byId)

  return {
    territories: [...territories.values()].filter((t) => t.nexuses.length > 0),
    universal: { pages: archives.universal, tier: tierOf(archives.universal) },
    at: now,
  }
}

function deadNexus(sessionId: string, label: string, cwd: string): Nexus {
  return { sessionId, label, cwd, pose: 'dead', halo: HALO_OF.dead, robots: [], parent: null }
}

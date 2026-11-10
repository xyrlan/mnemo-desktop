// Where the live world differs from the prototypes' capture of the same machine
// (docs/superpowers/prototypes/redesign/capture.py, read through `../capture.ts`), and why.
// The two read the same sessions by different roads: the capture walks every transcript and
// asks `claude agents`, `mnemo sessions` and `gh` itself; the live world is the app's snapshot,
// feed, hook events and the core wave's commands. `tools/world/compare.mjs` runs this on two
// files; `__mnemoWorld.compare()` runs it in a dev build.
//
// The report names sessions by their first 8 characters and never prints a title, a prompt, a
// path, a project or an account: it is meant to be pasted where the public can read it.

import type { Session, SessionState, TokenRow, World } from '../types'

export interface Difference {
  /** What differs: a field of a session, or of the world. */
  field: string
  /** The session's first 8 characters; null for something of the world. */
  session: string | null
  live: string
  capture: string
  why: string
}

export interface Comparison {
  liveAt: number
  captureAt: number
  /** Sessions in both, and the ones only one side has. */
  both: number
  differences: Difference[]
  /** How many readings of sessions in both were compared and found the same. */
  same: number
}

const total = (r: TokenRow) => r.input + r.output + r.cacheRead + r.cacheCreation

const BETWEEN = 'the two were read at different moments, and the session went on in between'
const INSIGHT = "the core's session insight answers nothing in this build, so the live world has only the feed's last call"
const TRAIL = "the core's memory trail answers nothing in this build, so the live world has only what the app heard from mnemo while it ran"

/** Why the two call one session's state differently, by what each said. */
export function whyState(capture: SessionState, live: SessionState, s: Session): string {
  if (capture === 'working' && live !== 'need')
    return "the capture calls a live child working while mnemo's tempo is active; the live world asks for an action in the last 150 s or a tool call still awaiting its result (the ship's thresholds), and otherwise calls it idle, stalled after 15 min, or ready when its pull request is open"
  if (live === 'working') return 'a tool call still awaiting its result is work, and a hook says a turn began the moment it does; the capture reads the status `claude agents` and mnemo last wrote'
  if (live === 'need') return "a hook's notification, the feed's unanswered question or a block with no process behind it says it waits; the capture read `claude agents` and mnemo's `needs` at its own moment"
  if (capture === 'need') return "the capture counts any `waitingFor` as a need (a dialog the maintainer opened himself too) and any `needs` text (a rate limit too); the live world does not, as the ship did not"
  if (live === 'ready') return 'its pull request is open: the snapshot knows a pull request by the job that opened it or by its branch, the capture only by a `pr-link` in the transcript that `gh` confirmed'
  if (capture === 'ready') return 'the capture found an open pull request linked in the transcript; the snapshot gives this session none (it is not its job’s or its branch’s), or says it merged or closed since'
  if (live === 'stalled')
    return s.live
      ? 'live and quiet for more than 15 min with nothing running is stalled in the live world; the capture calls a live child idle until mnemo says `stall`, which the snapshot does not carry'
      : "its process is gone and its job never said done or stopped: stopped without finishing. The capture calls that ended unless mnemo's `stall` is set, which the snapshot does not carry"
  if (capture === 'stalled') return "mnemo's `stall` is not in the snapshot: the live world calls stalled what went quiet for 15 min or died unfinished, and this session is neither"
  return BETWEEN
}

function whyMissingFromLive(s: Session): string {
  if (s.live && s.agentKind === 'background')
    return 'a background job `claude agents` still lists as blocked or working: the capture calls that live, with or without a process. The live world keeps a child that has no process 48 h from its last sign of life, or it ended between the two readings'
  if (s.live)
    return 'it is live in the capture: a headless `claude` the snapshot leaves out as no one’s session (mnemo’s briefing writer, the app’s own brain), or it started or ended between the two readings, or the snapshot could not list it (see the live world’s errors)'
  if (s.role === 'child') return 'an ended child: the snapshot leaves out a finished job whose worktree is gone, and the live world keeps an ended child 48 h from its last sign of life, where the capture keeps `mnemo sessions --stale` rows by their `updated_at`'
  return 'an ended parent no child in the live world names: the live world learns of a parent that is gone only through a child it still holds'
}

function whyMissingFromCapture(s: Session): string {
  if (s.role === 'parent' && !s.live) return 'a parent that is gone, which a child still names: the capture leaves out a session it finds no transcript, agent row or job for'
  if (s.live) return 'it is live in the live world: it started between the two readings, or it runs in a scratch directory the capture leaves out on purpose'
  return 'an ended child the live world keeps for its open pull request or its unanswered block however old, or that the capture’s window (48 h by default) had already dropped'
}

/** The readings of one session that a view shows as a word or a number, each with why the
 *  two roads may disagree on it. Text is compared and never printed. */
function readings(live: Session, capture: Session): Difference[] {
  const out: Difference[] = []
  const put = (field: string, a: unknown, b: unknown, why: string, show = true) => {
    out.push({ field, session: live.short, live: show ? String(a) : a === b ? 'same' : 'differs', capture: show ? String(b) : 'same', why: a === b ? '' : why })
  }
  put('state', live.state, capture.state, live.state === capture.state ? '' : whyState(capture.state, live.state, live))
  put('role', live.role, capture.role, 'the capture calls any session with a recorded parent a child; the snapshot calls it a parent while `claude agents` lists it and no job holds it')
  put(
    'live',
    live.live,
    capture.live,
    live.role === 'child' && capture.live && !live.live
      ? 'the capture calls a background session live while `claude agents` lists it as anything but stopped or done, with or without a process; the snapshot calls a child live when its daemon’s roster holds a running process for it'
      : BETWEEN,
  )
  put('parent', live.parent?.slice(0, 8) ?? 'none', capture.parent?.slice(0, 8) ?? 'none', "the snapshot links a child by its recorded `parent_session`, or guesses the youngest older parent in its repo; the capture reads mnemo's dispatch log and never guesses")
  put('children', live.children.length, capture.children.length, 'a child only one side holds (see the sessions only one side has)')
  put('abandoned', live.abandoned, capture.abandoned, "the snapshot does not carry mnemo's `is_abandoned`: the live world calls a need abandoned when no process is behind it")
  put('project', live.project, capture.project, 'the capture names a project by `git rev-parse --git-common-dir`; the snapshot by its own grouping of repos, with `<repo>-wt-<name>` folded into `<repo>`', false)
  put('account', live.account, capture.account, "the capture finds the account by the transcript's owner; the snapshot by the account whose `claude agents` or `jobs/` lists the session", false)
  put('title', live.title, capture.title, live.role === 'child' ? "before the insight answers, a child is titled by its job's name or its intent's first line, not by Claude Code's own title" : 'the feed prefers a name a person gave the session; the capture takes the last title record of either kind', false)
  put('model', live.model, capture.model, 'the capture reads the last main-chain call’s model; before the insight answers, the live world has the feed’s last model or the alias the child was dispatched with')
  put('effort', live.effort, capture.effort, INSIGHT)
  put('advisor', live.advisor, capture.advisor, 'the snapshot does not carry a child’s advisor')
  put('branch', live.branch, capture.branch, 'the capture reads the transcript’s `gitBranch`; before the insight answers, the live world has a child’s contract branch and nothing for a parent', false)
  put('turns', live.turns, capture.turns, live.turns === 0 ? INSIGHT : BETWEEN)

  const a = total(live.totals.own)
  const b = total(capture.totals.own)
  out.push({ field: 'tokens', session: live.short, live: String(a), capture: String(b), why: a === b ? '' : a === 0 ? INSIGHT : BETWEEN })
  const x = live.context.tokens
  const y = capture.context.tokens
  const near = x !== null && y !== null && Math.abs(x - y) <= Math.max(2000, 0.02 * y)
  out.push({
    field: 'context',
    session: live.short,
    live: String(x),
    capture: String(y),
    why: x === y ? '' : x === null ? "neither the insight nor the feed read this session's transcript (it has none, or mnemo does not know its session id)" : near ? "the feed's context leaves out the last call's output, which the insight and the capture count" : BETWEEN,
  })
  put('calls', live.activityTotal, capture.activityTotal, live.activityTotal <= 1 ? INSIGHT : BETWEEN)
  put('pull requests', live.prs.length, capture.prs.length, 'the snapshot gives a child the one pull request of its job or branch; the capture lists the last three its transcript links')
  put('rules given', live.memory.trail.injected.length, capture.memory.trail.injected.length, live.memory.trail.considered.length || live.memory.trail.briefings.length ? BETWEEN : TRAIL)
  put('rules held back', live.memory.trail.considered.length, capture.memory.trail.considered.length, TRAIL)
  return out
}

export function compareWorlds(live: World, capture: World): Comparison {
  const differences: Difference[] = []
  let same = 0
  let both = 0
  const theirs = new Map(capture.sessions.map((s) => [s.id, s]))
  const ours = new Map(live.sessions.map((s) => [s.id, s]))

  for (const s of live.sessions) {
    const other = theirs.get(s.id)
    if (!other) {
      differences.push({ field: 'session', session: s.short, live: `${s.role}, ${s.state}`, capture: 'absent', why: whyMissingFromCapture(s) })
      continue
    }
    both++
    for (const d of readings(s, other)) {
      if (d.why) differences.push(d)
      else same++
    }
  }
  for (const s of capture.sessions) if (!ours.has(s.id)) differences.push({ field: 'session', session: s.short, live: 'absent', capture: `${s.role}, ${s.state}`, why: whyMissingFromLive(s) })

  // What waits, where the two agree on the session's state (a different state says why itself).
  const kinds = (w: World, id: string) => w.pending.filter((p) => p.session === id).map((p) => p.kind).sort().join('+') || 'nothing'
  for (const s of live.sessions) {
    const other = theirs.get(s.id)
    if (!other || other.state !== s.state) continue
    const a = kinds(live, s.id)
    const b = kinds(capture, s.id)
    if (a === b) same++
    else
      differences.push({
        field: 'waiting',
        session: s.short,
        live: a,
        capture: b,
        why:
          b === 'merge'
            ? 'its pull request’s CI is red, which is not a need while mnemo’s follow wakes the child to fix it; or the open pull request is one only the transcript links'
            : 'the capture calls a need a question only when the transcript holds an unanswered one, a permission when `needs` says so, else a block; the live world asks the fleet (hooks and `claude agents`) what kind of answer is wanted',
      })
  }

  const world = (field: string, a: unknown, b: unknown, why: string) => {
    if (a === b) same++
    else differences.push({ field, session: null, live: String(a), capture: String(b), why })
  }
  world('accounts', live.accounts.length, capture.accounts.length, 'the app lists the accounts it manages; the capture reads `accounts.json` and adds the default one when the file does not name it')
  for (const acc of live.accounts) {
    const other = capture.accounts.find((x) => x.id === acc.id)
    if (other) world('plan windows', acc.limits.length, other.limits.length, 'the app’s own reading of the plan’s usage and the cache file the capture reads may be minutes apart, or one of them has no reading yet')
  }
  world('vault rules', live.vault.rules, capture.vault.rules, "the core's vault pulse answers nothing in this build")
  world('vault prompts', live.vault.prompts, capture.vault.prompts, "the core's vault pulse answers nothing in this build")
  world('projects with a session', live.projects.filter((p) => p.sessions.length).length, capture.projects.filter((p) => p.sessions.length).length, 'sessions only one side has, or a project the two name differently (see `project` above)')

  return { liveAt: live.at, captureAt: capture.at, both, differences, same }
}

/** The comparison in words: each kind of difference once, with why and the sessions it is seen on. */
export function report(c: Comparison): string {
  const lines: string[] = []
  const gap = Math.round(Math.abs(c.liveAt - c.captureAt) / 1000)
  lines.push(`live world against capture: ${c.both} sessions in both, ${c.same} readings the same, ${c.differences.length} different`)
  lines.push(`read ${gap} s apart${gap > 120 ? ' (more than two minutes: expect sessions to have moved on; take the two together)' : ''}`)
  const groups = new Map<string, Difference[]>()
  for (const d of c.differences) {
    const key = `${d.field}\n${d.why}`
    groups.set(key, [...(groups.get(key) ?? []), d])
  }
  for (const [key, rows] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
    const [field, why] = key.split('\n')
    lines.push('')
    lines.push(`${field}: ${rows.length}`)
    lines.push(`  why: ${why}`)
    for (const d of rows.slice(0, 12)) lines.push(`  ${d.session ?? 'world'}  capture ${d.capture} -> live ${d.live}`)
    if (rows.length > 12) lines.push(`  and ${rows.length - 12} more`)
  }
  if (!c.differences.length) lines.push('', 'nothing differs')
  return lines.join('\n')
}

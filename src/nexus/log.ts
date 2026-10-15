import { ago, departuresOf, STRANDED_MS } from './ship'
import type { Captain, CaptainNeed, LogEvent, LogKind, Ship, ShipRobot } from './ship-types'

const robotsOf = (ship: Ship): ShipRobot[] => [...ship.bridge.blocked, ...ship.decks.flatMap((d) => [...d.flight, ...d.hangar, ...d.stranded])]
const captainsOf = (ship: Ship): Captain[] => [...ship.decks.flatMap((d) => [...d.captains, ...d.quiet]), ...ship.docks.flatMap((d) => d.captains)]
const captainNeedsOf = (ship: Ship): CaptainNeed[] => ship.bridge.exceptions.filter((x): x is CaptainNeed => x.kind === 'captain')

/** A short stable tag for a text, for an id that must change when the text does. */
function tag(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

/** The run a PR's checks belong to: the newest start among them, so a re-run is a new milestone. */
const runOf = (r: ShipRobot): string => {
  const starts = (r.fate?.checks ?? []).map((k) => k.startedAt ?? 0)
  return starts.length ? String(Math.max(...starts)) : ''
}

/** When a PR's checks all finished, if the feed dates them. */
const ciDoneAt = (r: ShipRobot): number | null => {
  const ends = (r.fate?.checks ?? []).map((k) => k.completedAt)
  return ends.length && ends.every((t) => t !== null) ? Math.max(...(ends as number[])) : null
}

const short = (s: string, n = 80) => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

/** The milestones between two ships, for the ship's log; `prev` is null on the first build.
 *
 *  Each is logged at the change: a robot that came aboard, opened a PR, got its CI's verdict,
 *  finished without a PR, was stranded or blocked, got a rule injected, or left by its PR's merge
 *  or close; and a captain that began to wait on you. On the first build only what the data dates
 *  is logged (a verdict, a finish, a strand, a block, a fate), so opening the app does not log
 *  every robot as just dispatched. Ids are
 *  stable, so a milestone the store holds is not logged twice. Times are the change's own when the
 *  data has one (`mergedAt`, a check's `completedAt`, when the robot went idle), else `now`.
 *  Oldest first. */
export function logEvents(prev: Ship | null, next: Ship, now: number): LogEvent[] {
  const out: LogEvent[] = []
  const was = new Map((prev ? robotsOf(prev) : []).map((r) => [r.id, r]))
  const captains = new Map(captainsOf(next).map((c) => [c.id, c]))
  const push = (kind: LogKind, r: ShipRobot, key: string, at: number, text: string) =>
    out.push({ id: `${kind}:${r.id}${key ? `:${key}` : ''}`, at, kind, robotId: r.id, captainId: r.captainId, text: `${r.label} ${text}` })

  for (const r of robotsOf(next)) {
    const p = was.get(r.id) ?? null
    const lastAct = next.at - r.idleMs

    if (prev && !p) {
      const cap = captains.get(r.captainId)
      push('dispatched', r, '', now, cap?.parent ? `dispatched by ${cap.emblem} ${cap.name}` : 'dispatched')
    }
    if (r.pr && prev && p?.pr?.number !== r.pr.number) push('pr-opened', r, String(r.pr.number), now, `opened PR #${r.pr.number}`)
    if (r.pr && (r.ci === 'green' || r.ci === 'red') && p?.ci !== r.ci) {
      const at = ciDoneAt(r)
      if (prev || at !== null) push(r.ci === 'green' ? 'ci-green' : 'ci-red', r, `${r.pr.number}:${runOf(r)}`, at ?? now, `CI ${r.ci} on PR #${r.pr.number}`)
    }
    if (r.state === 'done' && !r.pr && p?.state !== 'done') push('finished', r, '', lastAct, 'finished without a PR')
    if (r.zone === 'stranded' && p?.zone !== 'stranded') push('stranded', r, String(lastAct), lastAct + STRANDED_MS, `stranded — idle for ${ago(r.idleMs)}`)
    if (r.need && p?.state !== 'need') {
      const what = r.need.kind === 'permission' ? `wants to run ${short(r.need.text)}` : `asks: ${short(r.need.text)}`
      push('blocked', r, tag(`${r.need.kind}\0${r.need.text}`), now, what)
    }
    if (prev) {
      const had = new Set(p?.injected ?? [])
      for (const slug of [...r.injected].reverse()) if (!had.has(slug)) push('rule', r, slug, now, `got \`${slug}\``)
    }
  }

  // A captain that began to wait on you, keyed by what and since when: the same permission asked
  // again later is a new milestone.
  const waited = new Set((prev ? captainNeedsOf(prev) : []).map((x) => x.captainId))
  for (const x of captainNeedsOf(next)) {
    if (waited.has(x.captainId)) continue
    const c = captains.get(x.captainId)
    const who = c?.name ?? `session ${x.captainId.slice(0, 8)}`
    const what = x.question ? `asks: ${short(x.question)}` : x.waitsOn === 'question' ? 'waits on a question' : 'waits on a permission'
    out.push({ id: `blocked:${x.captainId}:${tag(`${x.waitsOn}\0${x.question ?? ''}\0${x.since ?? ''}`)}`, at: now, kind: 'blocked', robotId: null, captainId: x.captainId, text: `${who} ${what}` })
  }

  // A robot leaves at its PR's fate: logged when it leaves, or on the first build when dated.
  for (const d of departuresOf(next)) {
    if (prev ? !was.has(d.robot.id) : d.at === null) continue
    const n = d.robot.pr?.number
    push(d.kind, d.robot, String(n ?? ''), d.at ?? now, d.kind === 'merged' ? `PR #${n} merged — lifted off` : `PR #${n} closed — walked off`)
  }

  return out.sort((a, b) => a.at - b.at)
}

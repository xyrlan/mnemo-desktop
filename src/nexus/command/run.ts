import type { Choice } from '../../cockpit/prompt'
import type { ChildSession, Mission, Pr } from '../../mission/types'
import type { ActionResult, Captain, Exception, LogEvent, Ship, ShipAction, ShipRobot } from '../ship-types'
import { captainById, captainLabel, isRunning, reposOf, robotById, rootOf } from './find'

/** The app's own paths to the fleet, one per thing the Nexus does (contract `command`). `actions.ts`
 *  wires the real ones; a test hands in its own. Each resolves with how it went or rejects with
 *  why; none of them throws for a refusal it can say. */
export type Paths = {
  /** Picks option `index` of the question the child is asking (`answerQuestion`). */
  answerQuestion(child: ChildSession, index: number): Promise<void>
  /** Answers the child's question in words (`answerQuestionOther`). */
  answerQuestionOther(child: ChildSession, text: string): Promise<void>
  /** Presses `choice` on the child's permission prompt (`answerPrompt`). */
  answerPrompt(child: ChildSession, choice: Choice): Promise<Outcome>
  /** The cockpit's checks-gated merge of one PR, once it has ended. */
  merge(root: string, pr: Pr): Promise<Outcome>
  /** `mnemo land` on a contract, as an app job, once it has ended. */
  land(root: string, mission: Mission): Promise<Outcome>
  /** `claude stop` on each child's own account. */
  stop(children: ChildSession[]): Promise<Outcome>
  /** One user turn into a session's inbox (`mission_reply`), by its short id. */
  reply(id: string, text: string): Promise<void>
  /** `mnemo dispatch` of the issues in `root`, once it has ended. */
  dispatch(root: string, issues: number[]): Promise<Outcome>
  now(): number
}

export type Outcome = { ok: boolean; why: string }

const why = (e: unknown) => (e instanceof Error ? e.message : String(e))
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

let seq = 0
/** A `you` milestone. Its id is new each time: two of the same action are two things you did. */
function you(at: number, text: string, robotId: string | null = null, captainId: string | null = null): LogEvent {
  return { id: `you:${at}:${++seq}`, at, kind: 'you', robotId, captainId, text }
}

const result = (ok: boolean, say: string, log: LogEvent[] = []): ActionResult => ({ ok, say, log })

/** The words a permission is answered with, to the prompt's choice. */
function choiceOf(text: string): Choice | null {
  const t = text.trim().toLowerCase()
  if (['yes', 'y', 'approve', '1'].includes(t)) return 'yes'
  if (['always', 'a', "yes, and don't ask again", '2'].includes(t)) return 'always'
  if (['no', 'n', 'deny', '3'].includes(t)) return 'no'
  return null
}

async function answer(p: Paths, ship: Ship, robotId: string, text: string): Promise<ActionResult> {
  const r = robotById(ship, robotId)
  if (!r) return result(false, `${robotId} is not on the ship any more: nothing was sent`)
  if (!r.need) return result(false, `${r.label} is not waiting for an answer: nothing was sent`)
  const words = text.trim()
  if (!words) return result(false, 'nothing to send')
  const at = p.now()
  if (r.need.kind === 'permission') {
    const choice = choiceOf(words)
    if (!choice) return result(false, `${r.label} asks a permission: answer yes, always or no`)
    const o = await p.answerPrompt(r.child, choice).catch((e): Outcome => ({ ok: false, why: why(e) }))
    if (!o.ok) return result(false, `${r.label}: ${o.why}`)
    return result(true, `↩ ${r.label}: ${choice === 'no' ? 'denied' : choice === 'always' ? 'approved, and not asked again' : 'approved'}`, [you(at, `you answered ${r.label}: ${choice}`, r.id, r.captainId)])
  }
  const options = r.need.options
  const n = /^[1-9]$/.test(words) ? Number(words) - 1 : -1
  const index = n >= 0 && n < options.length ? n : options.findIndex((o) => o.trim().toLowerCase() === words.toLowerCase())
  try {
    if (index >= 0) await p.answerQuestion(r.child, index)
    else await p.answerQuestionOther(r.child, words)
  } catch (e) {
    return result(false, `${r.label}: ${why(e)}`)
  }
  const said = index >= 0 ? options[index] : words
  return result(true, `↩ ${r.label}: ${said}`, [you(at, `you answered ${r.label}: ${said}`, r.id, r.captainId)])
}

/** One PR at a time, each reported: a merge reads the checks at the moment it runs. */
async function merge(p: Paths, ship: Ship, ids: string[]): Promise<ActionResult> {
  const merged: string[] = []
  const not: string[] = []
  const log: LogEvent[] = []
  for (const id of ids) {
    const r = robotById(ship, id)
    if (!r) {
      not.push(`${id} (not on the ship any more)`)
      continue
    }
    if (!r.pr) {
      not.push(`${r.label} (no PR)`)
      continue
    }
    const pr = `PR #${r.pr.number}`
    const o = await p.merge(rootOf(ship, r), r.pr).catch((e): Outcome => ({ ok: false, why: why(e) }))
    if (o.ok) {
      merged.push(`${pr} (${r.label})`)
      log.push(you(p.now(), `you merged ${pr} (${r.label})`, r.id, r.captainId))
    } else not.push(`${pr} (${r.label}): ${o.why}`)
  }
  const parts = [merged.length ? `✈ merged ${merged.join(', ')}` : '', not.length ? `not merged: ${not.join(' · ')}` : ''].filter(Boolean)
  return result(not.length === 0 && merged.length > 0, parts.join(' · ') || 'nothing to merge', log)
}

async function land(p: Paths, ship: Ship, root: string, feature: string): Promise<ActionResult> {
  const x = ship.bridge.exceptions.find((e): e is Extract<Exception, { kind: 'land' }> => e.kind === 'land' && e.root === root && e.mission.feature === feature)
  if (!x) return result(false, `mission ${feature} is not landable now: nothing was run`)
  const o = await p.land(root, x.mission).catch((e): Outcome => ({ ok: false, why: why(e) }))
  if (!o.ok) return result(false, `mission ${feature} did not land: ${o.why}`)
  return result(true, `⇪ mission ${feature} landed`, [you(p.now(), `you landed mission ${feature}`)])
}

async function stop(p: Paths, ship: Ship, ids: string[]): Promise<ActionResult> {
  const robots = ids.map((id) => robotById(ship, id)).filter((r): r is ShipRobot => !!r && isRunning(r))
  if (!robots.length) return result(false, 'none of them is running: nothing was stopped')
  const o = await p.stop(robots.map((r) => r.child)).catch((e): Outcome => ({ ok: false, why: why(e) }))
  if (!o.ok) return result(false, `not stopped: ${o.why}`)
  const at = p.now()
  return result(
    true,
    `■ claude stop for ${robots.map((r) => r.label).join(' ')}${o.why ? ` ${o.why}` : ''} — each keeps its conversation`,
    robots.map((r) => you(at, `you stopped ${r.label}`, r.id, r.captainId)),
  )
}

/** A session's inbox is reached by its short id: a child's own, a captain's from its session id. */
function inboxOf(ship: Ship, id: string): { label: string; inbox: string | null; robot?: ShipRobot; captain?: Captain } {
  const r = robotById(ship, id)
  if (r) return { label: r.label, inbox: r.id, robot: r }
  const c = captainById(ship, id)
  if (c) return { label: captainLabel(c), inbox: c.parent ? c.parent.session_id.slice(0, 8) : null, captain: c }
  return { label: id, inbox: null }
}

async function message(p: Paths, ship: Ship, ids: string[], text: string): Promise<ActionResult> {
  const words = text.trim()
  if (!words) return result(false, 'nothing to send')
  const sent: string[] = []
  const not: string[] = []
  const log: LogEvent[] = []
  for (const id of ids) {
    const t = inboxOf(ship, id)
    if (!t.inbox) {
      not.push(`${t.label} (${t.captain ? 'no session' : 'not on the ship any more'})`)
      continue
    }
    try {
      await p.reply(t.inbox, words)
      sent.push(t.label)
      log.push(you(p.now(), `you wrote to ${t.label}: ${words}`, t.robot?.id ?? null, t.robot?.captainId ?? t.captain?.id ?? null))
    } catch (e) {
      not.push(`${t.label}: ${why(e)}`)
    }
  }
  const parts = [sent.length ? `✉ sent to ${sent.length > 3 ? plural(sent.length, 'session') : sent.join(', ')}` : '', not.length ? `not sent: ${not.join(' · ')}` : ''].filter(Boolean)
  return result(not.length === 0 && sent.length > 0, parts.join(' · ') || 'nobody to write to', log)
}

async function dispatch(p: Paths, ship: Ship, root: string, issues: number[]): Promise<ActionResult> {
  if (!issues.length) return result(false, 'no issue to dispatch')
  const name = reposOf(ship).find((r) => r.root === root)?.name ?? root
  const list = issues.map((n) => `#${n}`).join(' ')
  const o = await p.dispatch(root, issues).catch((e): Outcome => ({ ok: false, why: why(e) }))
  if (!o.ok) return result(false, `${list} not dispatched in ${name}: ${o.why}`)
  return result(true, `⇣ dispatched ${list} in ${name}`, [you(p.now(), `you dispatched ${list} in ${name}`)])
}

/** Does what an action says through `p` (spec "Acting from it"). `open` is the view's. */
export async function act(p: Paths, action: ShipAction, ship: Ship): Promise<ActionResult> {
  switch (action.kind) {
    case 'answer':
      return answer(p, ship, action.robotId, action.text)
    case 'merge':
      return merge(p, ship, action.robotIds)
    case 'land':
      return land(p, ship, action.root, action.feature)
    case 'stop':
      return stop(p, ship, action.robotIds)
    case 'message':
      return message(p, ship, action.ids, action.text)
    case 'dispatch':
      return dispatch(p, ship, action.root, action.issues)
    case 'open':
      return result(false, 'opening a session is the view’s, not an action')
  }
}

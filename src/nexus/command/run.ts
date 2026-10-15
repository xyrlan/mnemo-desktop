import type { Choice } from '../../cockpit/prompt'
import type { ChildSession, Mission, Pr } from '../../mission/types'
import type { ActionResult, Captain, Exception, LogEvent, Ship, ShipAction, ShipRobot } from '../ship-types'
import { captainById, captainLabel, isRunning, otherRepo, reposOf, repoRootOf, robotById } from './find'

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
  /** `claude stop` on each child's own account, run from `root`. */
  stop(root: string, children: ChildSession[]): Promise<Outcome>
  /** One user turn into a background session's inbox (`mission_reply`), by its short id. */
  reply(id: string, text: string): Promise<void>
  /** The terminal pane a session runs in, when one of the app's panes does. */
  paneOf(sessionId: string): number | null
  /** Types `text` into pane `pane`'s Claude as a prompt and submits it (the chat input's way). */
  prompt(pane: number, text: string): Promise<void>
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
    // The child's own repo: its captain's deck can be another one, and gh reads the repo from the cwd.
    const root = repoRootOf(ship, r.child)
    const elsewhere = otherRepo(root, r.pr)
    if (elsewhere) {
      not.push(`${pr} (${r.label}): ${elsewhere}`)
      continue
    }
    const o = await p.merge(root, r.pr).catch((e): Outcome => ({ ok: false, why: why(e) }))
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
  // Where its pieces' children work, when the ship still has one; every piece's PR must be there.
  const at = x.mission.pieces.flatMap((piece) => (piece.child ? [repoRootOf(ship, piece.child)] : []))[0] ?? root
  const elsewhere = x.mission.pieces.map((piece) => (piece.pr ? otherRepo(at, piece.pr) : null)).find(Boolean)
  if (elsewhere) return result(false, `mission ${feature} did not land: ${elsewhere}`)
  const o = await p.land(at, x.mission).catch((e): Outcome => ({ ok: false, why: why(e) }))
  if (!o.ok) return result(false, `mission ${feature} did not land: ${o.why}`)
  return result(true, `⇪ mission ${feature} landed`, [you(p.now(), `you landed mission ${feature}`)])
}

async function stop(p: Paths, ship: Ship, ids: string[]): Promise<ActionResult> {
  const robots = ids.map((id) => robotById(ship, id)).filter((r): r is ShipRobot => !!r && isRunning(r))
  if (!robots.length) return result(false, 'none of them is running: nothing was stopped')
  const o = await p.stop(repoRootOf(ship, robots[0].child), robots.map((r) => r.child)).catch((e): Outcome => ({ ok: false, why: why(e) }))
  if (!o.ok) return result(false, `not stopped: ${o.why}`)
  const at = p.now()
  return result(
    true,
    `■ claude stop for ${robots.map((r) => r.label).join(' ')}${o.why ? ` ${o.why}` : ''} — each keeps its conversation`,
    robots.map((r) => you(at, `you stopped ${r.label}`, r.id, r.captainId)),
  )
}

type Recipient = { label: string; robot?: ShipRobot; captain?: Captain }

/** Writes to one session: a child through its inbox; a captain typed into the pane it runs in,
 *  else through its inbox when it is a background session. Rejects with why it did not. */
async function send(p: Paths, to: Recipient, text: string): Promise<void> {
  if (to.robot) return p.reply(to.robot.id, text)
  const parent = to.captain?.parent
  if (!parent) throw new Error('no session: nothing was sent')
  const pane = p.paneOf(parent.session_id)
  if (pane !== null) return p.prompt(pane, text)
  // A parent only reaches the inbox through the daemon's roster, which lists background sessions.
  await p.reply(parent.session_id.slice(0, 8), text).catch(() => {
    throw new Error('not open in a pane here, and not a background session with an inbox: nothing was sent')
  })
}

async function message(p: Paths, ship: Ship, ids: string[], text: string): Promise<ActionResult> {
  const words = text.trim()
  if (!words) return result(false, 'nothing to send')
  const sent: string[] = []
  const not: string[] = []
  const log: LogEvent[] = []
  for (const id of ids) {
    const robot = robotById(ship, id)
    const captain = robot ? undefined : captainById(ship, id)
    if (!robot && !captain) {
      not.push(`${id} (not on the ship any more)`)
      continue
    }
    const to: Recipient = { label: robot ? robot.label : captainLabel(captain!), robot, captain }
    try {
      await send(p, to, words)
      sent.push(to.label)
      log.push(you(p.now(), `you wrote to ${to.label}: ${words}`, robot?.id ?? null, robot?.captainId ?? captain?.id ?? null))
    } catch (e) {
      not.push(`${to.label}: ${why(e)}`)
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

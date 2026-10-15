import type { Exception, Parsed, Ship, ShipAction, ShipRobot } from '../ship-types'
import { baseName, captainsOf, isGreen, isRunning, reposOf, robotsOf } from './find'

/** How long a batch verb waits for `/yes`. */
export const CONFIRM_MS = 20_000

/** What the prompt says it takes, under it. */
export const HINT = '/dispatch <repo> #<issue> · /msg <#issue | captain | all> <text> · /merge green · /stop all · /land <feature>'

const START = 'start with / — e.g. /dispatch mnemo #123 · /msg #682 text · /msg all text. To talk to one session, click it.'
const UNKNOWN = (verb: string) => `unknown /${verb} — use /dispatch, /msg, /merge green, /stop all or /land`
const CONFIRM = ' — type /yes within 20 s to confirm'

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const labels = (rs: ShipRobot[]) => rs.map((r) => r.label).join(' ')

/** A robot's label without its twin suffix: `#404·a` → `#404`. */
const issueOf = (label: string) => label.replace(/·[a-z]+$/, '')

function dispatch(rest: string, ship: Ship): Parsed {
  const m = /^(\S+)\s+((?:#?\d+[\s,]*)+)$/.exec(rest)
  if (!m) return { error: 'usage: /dispatch <repo> #<issue> [#<issue>…]' }
  const want = m[1].toLowerCase()
  const repos = reposOf(ship)
  const repo = repos.find((r) => r.name.toLowerCase() === want) ?? repos.find((r) => r.root === m[1] || baseName(r.root).toLowerCase() === want)
  if (!repo) return { error: repos.length ? `no repo called ${m[1]} on the ship — repos: ${repos.map((r) => r.name).join(', ')}` : 'no repo is on the ship right now' }
  const issues = [...new Set((m[2].match(/\d+/g) ?? []).map(Number))]
  return { action: { kind: 'dispatch', root: repo.root, issues } }
}

/** `who` among the robots: `#682` is every twin of it, `#682·a` one twin; a piece's name or a
 *  short id names one robot. */
function robotsCalled(who: string, ship: Ship): ShipRobot[] {
  const w = who.toLowerCase()
  return robotsOf(ship).filter((r) => {
    const label = r.label.toLowerCase()
    const full = r.twin && !label.endsWith(`·${r.twin}`) ? `${label}·${r.twin}` : label
    return label === w || full === w || issueOf(label) === w || r.id.toLowerCase() === w
  })
}

function message(rest: string, ship: Ship): Parsed {
  const usage = { error: 'usage: /msg <#issue | captain | all> <text>' }
  const m = /^(\S+)\s+([\s\S]+)$/.exec(rest)
  if (!m) return usage
  if (m[1] === 'all') {
    const text = m[2].trim()
    const crew = robotsOf(ship).filter((r) => r.state === 'working' || r.state === 'idle')
    if (!crew.length) return { error: 'no child is running right now' }
    return { confirm: { kind: 'message', ids: crew.map((r) => r.id), text }, prompt: `message ${plural(crew.length, 'child', 'children')}: ${labels(crew)}${CONFIRM}` }
  }
  const robots = robotsCalled(m[1], ship)
  if (robots.length) return { action: { kind: 'message', ids: robots.map((r) => r.id), text: m[2].trim() } }
  // A captain's name can hold spaces: the longest name the line starts with.
  const lower = rest.toLowerCase()
  const captain = captainsOf(ship)
    .filter((c) => c.parent && lower.startsWith(`${c.name.toLowerCase()} `))
    .sort((a, b) => b.name.length - a.name.length)[0]
  if (captain) {
    const text = rest.slice(captain.name.length).trim()
    return text ? { action: { kind: 'message', ids: [captain.id], text } } : usage
  }
  return { error: `nobody called ${m[1]} on the ship right now` }
}

function merge(rest: string, ship: Ship): Parsed {
  if (rest !== 'green') return { error: 'usage: /merge green — merges every PR in the hangar whose CI is green' }
  const green = ship.decks.flatMap((d) => d.hangar).filter(isGreen)
  if (!green.length) return { error: 'no green PR waiting for merge right now' }
  return { confirm: { kind: 'merge', robotIds: green.map((r) => r.id) }, prompt: `merge ${plural(green.length, 'green PR')}: ${labels(green)}${CONFIRM}` }
}

function stop(rest: string, ship: Ship): Parsed {
  if (rest !== 'all') return { error: 'usage: /stop all — stops every running child (each keeps its conversation)' }
  const running = robotsOf(ship).filter(isRunning)
  if (!running.length) return { error: 'no child is running right now' }
  return { confirm: { kind: 'stop', robotIds: running.map((r) => r.id) }, prompt: `stop ${plural(running.length, 'running child', 'running children')}: ${labels(running)}${CONFIRM}` }
}

function land(rest: string, ship: Ship): Parsed {
  const landable = ship.bridge.exceptions.filter((x): x is Extract<Exception, { kind: 'land' }> => x.kind === 'land')
  if (!rest) return { error: landable.length ? `usage: /land <feature> — landable now: ${landable.map((x) => x.mission.feature).join(', ')}` : 'usage: /land <feature> — no mission is landable right now' }
  const x = landable.find((l) => l.mission.feature === rest) ?? landable.find((l) => l.mission.feature.toLowerCase() === rest.toLowerCase())
  if (!x) return { error: landable.length ? `mission ${rest} is not landable — landable now: ${landable.map((l) => l.mission.feature).join(', ')}` : `mission ${rest} is not landable: no mission is right now` }
  const action: ShipAction = { kind: 'land', root: x.root, feature: x.mission.feature }
  return { action }
}

/** A line typed at the fleet prompt, read against the ship (spec "Acting from it", contract
 *  `command`). The batch verbs (`/merge green`, `/stop all`, `/msg all`) come back as `confirm`,
 *  for `/yes`; anything that is not a verb is a hint, never an action. */
export function parseCommand(line: string, ship: Ship): Parsed {
  const m = /^\/(\w+)\s*([\s\S]*)$/.exec(line.trim())
  if (!m) return { error: START }
  const verb = m[1].toLowerCase()
  const rest = m[2].trim()
  switch (verb) {
    case 'yes':
      return rest ? { error: 'usage: /yes — confirms the batch the prompt asked about' } : { yes: true }
    case 'dispatch':
      return dispatch(rest, ship)
    case 'msg':
      return message(rest, ship)
    case 'merge':
      return merge(rest, ship)
    case 'stop':
      return stop(rest, ship)
    case 'land':
      return land(rest, ship)
    default:
      return { error: UNKNOWN(m[1]) }
  }
}

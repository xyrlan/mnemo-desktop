import type { Exception, Parsed, Ship, ShipAction, ShipRobot } from '../ship-types'
import { basename, samePath } from '../../path/path'
import { captainsOf, isGreen, isRunning, reposOf, robotsOf } from './find'

/** How long a batch verb waits for `/yes`. */
export const CONFIRM_MS = 20_000

/** A verb the command line takes: `fill` is what Tab completes it to, `syntax` how it is
 *  written, `does` what it does. */
export type Verb = { fill: string; syntax: string; does: string }

/** Every verb, as the command line suggests them. `/msg all` first: nothing else on the ship
 *  says one thing to every child. */
export const VERBS: readonly Verb[] = [
  { fill: '/msg all ', syntax: '/msg all <text>', does: 'say it to every running child' },
  { fill: '/msg ', syntax: '/msg <#issue | captain> <text>', does: 'say it to one child or captain' },
  { fill: '/dispatch ', syntax: '/dispatch <repo> #<issue>', does: 'a child per issue' },
  { fill: '/new ', syntax: '/new <repo>', does: 'start claude in a repo, in the drawer' },
  { fill: '/merge green', syntax: '/merge green', does: 'merge every green PR in the hangar' },
  { fill: '/stop all', syntax: '/stop all', does: 'stop every running child' },
  { fill: '/land ', syntax: '/land <feature>', does: 'land a mission' },
  { fill: '/yes', syntax: '/yes', does: 'confirm the batch asked about' },
]

/** The verbs to suggest for what is typed: the ones it is the start of, and, once a verb's
 *  arguments are being typed, that verb (the longest whose `fill` it starts with). Nothing for a
 *  line that does not start with `/`. */
export function suggest(typed: string): Verb[] {
  const t = typed.trimStart().toLowerCase()
  if (!t.startsWith('/')) return []
  const inside = VERBS.filter((v) => t.startsWith(v.fill)).sort((a, b) => b.fill.length - a.fill.length)[0]
  return VERBS.filter((v) => v === inside || v.fill.startsWith(t))
}

const START = 'start with / — e.g. /dispatch mnemo #123 · /msg #682 text · /msg all text. To talk to one session, click it.'
const UNKNOWN = (verb: string) => `unknown /${verb} — use /new, /dispatch, /msg, /merge green, /stop all or /land`
const CONFIRM = ' — type /yes within 20 s to confirm'

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const labels = (rs: ShipRobot[]) => rs.map((r) => r.label).join(' ')

/** A robot's label without its twin suffix: `#404·a` → `#404`. */
const issueOf = (label: string) => label.replace(/·[a-z]+$/, '')

/** The repo on the ship called `name`: by its name, its path, or its folder's name. */
function repoCalled(name: string, ship: Ship): { root: string; name: string } | { error: string } {
  const repos = reposOf(ship)
  return repoIn(name, repos) ?? { error: repos.length ? `no repo called ${name} on the ship — repos: ${repos.map((r) => r.name).join(', ')}` : 'no repo is on the ship right now' }
}

function repoIn(name: string, repos: readonly { root: string; name: string }[]): { root: string; name: string } | undefined {
  const want = name.toLowerCase()
  const repo = repos.find((r) => r.name.toLowerCase() === want) ?? repos.find((r) => samePath(r.root, name) || basename(r.root).toLowerCase() === want)
  return repo && { root: repo.root, name: repo.name }
}

function dispatch(rest: string, ship: Ship): Parsed {
  // Word by word, each word checked alone: a pattern over the whole list backtracks.
  const [name, ...words] = rest.split(/[\s,]+/).filter(Boolean)
  if (!name || !words.length || !words.every((w) => /^#?\d+$/.test(w))) return { error: 'usage: /dispatch <repo> #<issue> [#<issue>…]' }
  const repo = repoCalled(name, ship)
  if ('error' in repo) return repo
  const issues = [...new Set(words.map((w) => Number(w.replace('#', ''))))]
  return { action: { kind: 'dispatch', root: repo.root, issues } }
}

/** `/new <repo>`: `claude` started in that repo, named as `/dispatch` names one, in a drawer tab:
 *  one on the ship, else one of `known` (every repo PROJECTS lists: `useKnownRepos`). Not a ship
 *  action: the prompt opens the session itself (`openSession`). Null for any other line. */
export function parseNew(line: string, ship: Ship, known: readonly { root: string; name: string }[] = []): { root: string; name: string } | { error: string } | null {
  const m = /^\/new(?:\s+([\s\S]*))?$/i.exec(line.trim())
  if (!m) return null
  const name = m[1]?.trim() ?? ''
  if (!name || /\s/.test(name)) return { error: 'usage: /new <repo> — starts claude in that repo' }
  const onShip = repoCalled(name, ship)
  if (!('error' in onShip) || !known.length) return onShip
  return repoIn(name, known) ?? { error: `no repo called ${name} — open PROJECTS to add it` }
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

/** A line typed at the fleet's command line, read against the ship (spec "Acting from it", contract
 *  `command`). The batch verbs (`/merge green`, `/stop all`, `/msg all`) come back as `confirm`,
 *  for `/yes`; anything that is not a verb is a hint, never an action. */
export function parseCommand(line: string, ship: Ship): Parsed {
  const m = /^\/(\w+)\s*([\s\S]*)$/.exec(line.trim())
  if (!m) return { error: START }
  const verb = m[1].toLowerCase()
  const rest = m[2].trim()
  switch (verb) {
    case 'yes':
      return rest ? { error: 'usage: /yes — confirms the batch the command line asked about' } : { yes: true }
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

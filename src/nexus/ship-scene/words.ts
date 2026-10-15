import type { ActionKind, Captain, Ci, Exception, FleetRate, LogKind, RobotPose, Ship, ShipAction, ShipCounts, ShipRobot } from '../ship-types'

/** Everything the ship says, in English (spec "What it is"). Pure. */

/** `40s`, `48 min`, `5.1 h`: the prototype's `ago`, from ms. */
export function ago(ms: number): string {
  const s = Math.max(0, ms) / 1000
  if (s < 60) return `${Math.round(s)}s`
  if (s < 3600) return `${Math.round(s / 60)} min`
  return `${(s / 3600).toFixed(1).replace(/\.0$/, '')} h`
}

/** `812`, `42k`, `1.3M`: a context size at a glance. */
export function tokensWord(n: number): string {
  if (n < 1000) return `${n}`
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
}

/** `14:05`, local time. */
export function hhmm(at: number): string {
  const d = new Date(at)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const k = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : `${Math.round(n)}`)

export function chips(c: ShipCounts): { working: string; need: string; ready: string } {
  return { working: `⚙ ${c.working} working`, need: `! ${c.need} need${c.need === 1 ? 's' : ''} you`, ready: `✓ ${c.ready} ready` }
}

/** The rate chip: calls and output tokens a minute, with input and cache share on hover. No US$
 *  figure (spec "Telemetry chip"). */
export function rateChip(rate: FleetRate | null): { text: string; title: string } {
  if (!rate) return { text: '⚡ —', title: 'the whole fleet, last 5 min: no API calls read yet' }
  return {
    text: `⚡ ${Math.round(rate.callsPerMin)} calls/min · ${k(rate.outPerMin)} out tok/min`,
    title: [
      'the whole fleet, last 5 min',
      `input: ${k(rate.inPerMin)} tok/min, ${Math.round(rate.cacheShare * 100)}% read from cache`,
      `output: ${k(rate.outPerMin)} tok/min`,
      'no US$ cost: the subscription is not billed per token',
    ].join('\n'),
  }
}

/** The label, with its twin suffix when the label does not carry it already. */
export function robotName(r: Pick<ShipRobot, 'label' | 'twin'>): string {
  return r.twin && !r.label.endsWith(`·${r.twin}`) ? `${r.label}·${r.twin}` : r.label
}

const CI_SAY: Record<Exclude<Ci, null>, string> = { green: 'CI green · waiting for merge', red: 'CI red', run: 'CI running', wait: 'CI queued' }

/** What a robot's speech bubble says, and the smaller line under it. */
export function robotLine(r: ShipRobot): { say: string; act: string } {
  if (r.state === 'done') {
    const head = r.pr ? `✓ PR #${r.pr.number} · ${r.ci ? CI_SAY[r.ci] : 'open'}` : '✓ finished'
    return { say: r.line ? `${head} — ${r.line}` : head, act: '' }
  }
  if (r.state === 'stopped') return { say: '■ stopped — the conversation stays; it can resume', act: '' }
  if (r.state === 'need' && r.need) return { say: r.need.text, act: r.act ?? '' }
  return { say: r.line || r.act || '…', act: r.line ? (r.act ?? '') : '' }
}

const ACTION_GLYPH: Record<ActionKind, string> = { read: '⌕', edit: '✎', test: '⚗', ship: '⇪', run: '⧗' }

/** The action badge (spec "What it is"): what it is doing, CI on a finished PR, or ! for you. */
export function glyph(r: ShipRobot): string {
  if (r.state === 'need') return '!'
  if (r.state === 'stopped') return '■'
  if (r.state === 'done') return r.ci === 'red' ? '✗' : r.ci === 'run' || r.ci === 'wait' ? '⧗' : '✓'
  if (r.state === 'idle') return r.zone === 'stranded' ? '⏸' : '…'
  return r.action ? ACTION_GLYPH[r.action] : '⌕'
}

export type Particles = 'sparks' | 'bubbles' | 'pages' | 'zz' | 'radar'

/** The particles round a robot (spec "Motion"): sparks while it edits, bubbles while it tests,
 *  pages while it reads, a radar ping while it ships or a long command runs, zZ while stranded. */
export function particlesOf(r: ShipRobot): Particles | null {
  if (r.state === 'working') return r.action === 'edit' ? 'sparks' : r.action === 'test' ? 'bubbles' : r.action === 'ship' || r.action === 'run' ? 'radar' : 'pages'
  if (r.state === 'idle' && r.zone === 'stranded') return 'zz'
  return null
}

/** Ten minutes idle and a robot sleeps. */
export const SLEEP_MS = 10 * 60_000

export function poseOf(r: ShipRobot): RobotPose {
  if (r.state === 'working') return 'working'
  if (r.state === 'need') return 'waiting'
  if (r.state === 'stopped') return 'sleeping'
  if (r.state === 'idle' && r.idleMs > SLEEP_MS) return 'sleeping'
  return 'idle'
}

/** What the hover adds: title, model and context, contract, twin, rules. */
export function robotMore(r: ShipRobot): string[] {
  const out: string[] = []
  const title = r.child.name ?? r.child.intent?.split('\n')[0]
  if (title) out.push(title)
  out.push(`${r.model ?? 'model ?'}${r.context != null ? ` · context ${tokensWord(r.context)}` : ''}`)
  if (r.contract) {
    const { feature, piece, consumes } = r.contract
    out.push(`contract ${feature} · piece ${piece}${consumes.length ? ` · writes against ${consumes.join(', ')} (does not wait)` : ''}`)
  }
  if (r.twin) out.push('A/B twin — independent by design')
  if (r.injected.length) out.push(`◈ rules: ${r.injected.join(', ')}`)
  return out
}

/** How two robots relate, for the hover's dotted lines: the contract piece one writes against, or
 *  a twin. Never "blocked by" (spec "Decisions"). */
export function relation(a: ShipRobot, b: ShipRobot): string | null {
  if (a.contract && b.contract && a.contract.feature === b.contract.feature) {
    if (a.contract.consumes.includes(b.contract.piece)) return `consumes ${b.contract.piece}`
    if (b.contract.consumes.includes(a.contract.piece)) return `${b.contract.piece} consumes`
  }
  if (a.twin && b.twin && a.captainId === b.captainId && issueOf(a) === issueOf(b)) return 'twin'
  return null
}
const issueOf = (r: ShipRobot) => r.label.replace(/·[a-z]$/, '')

export type Tone = 'red' | 'lilac' | 'calm'

/** Red for a question (a child's or a captain's) or a red CI, lilac when only a merge (or a
 *  landing, a stranded child, a read that failed) waits, calm when nothing does. */
export function toneOf(ship: Ship): Tone {
  const x = ship.bridge.exceptions
  if (ship.bridge.blocked.length || x.some((e) => e.kind === 'need' || e.kind === 'captain' || e.kind === 'red')) return 'red'
  return x.length ? 'lilac' : 'calm'
}

export function bridgeStatus(ship: Ship): string {
  const n = ship.bridge.exceptions.length
  return n ? `${n} thing${n > 1 ? 's wait' : ' waits'} for you` : 'nothing needs you — the fleet flies itself'
}

export type RowButton = { label: string; go?: boolean } & ({ action: ShipAction } | { open: string } | { triage: true })
/** `robotId` / `captainId`: the figure the row is about, which a click on it opens. `title`: the
 *  text's hover, when there is more to it. */
export type Row = { key: string; kind: Exception['kind']; robotId: string | null; captainId?: string; icon: string; text: string; title?: string; buttons: RowButton[] }

/** What a waiting captain waits on, as its bridge row and triage card say it. */
export function captainWait(x: Extract<Exception, { kind: 'captain' }>): string {
  if (x.question) return x.question
  return x.waitsOn === 'question' ? 'waits on a question' : 'waits on a permission'
}

/** One bridge row per exception, with the buttons that settle it. */
export function exceptionRow(x: Exception): Row {
  switch (x.kind) {
    case 'need':
      return {
        key: `need:${x.robotId}`,
        kind: x.kind,
        robotId: x.robotId,
        icon: x.need.kind === 'permission' ? '🔒' : '❓',
        text: x.need.kind === 'permission' ? `wants to run: ${x.need.text}` : x.need.text,
        buttons: [{ label: 'answer · Tab', go: true, triage: true }],
      }
    case 'captain':
      return {
        key: `captain:${x.captainId}`,
        kind: x.kind,
        robotId: null,
        captainId: x.captainId,
        icon: x.waitsOn === 'permission' ? '🔒' : '❓',
        text: captainWait(x),
        buttons: [{ label: 'open', go: true, open: x.captainId }],
      }
    case 'red':
      return {
        key: `red:${x.robotId}`,
        kind: x.kind,
        robotId: x.robotId,
        icon: '✗',
        text: `PR #${x.pr.number} · CI red${x.pr.failing?.length ? `: ${x.pr.failing.join(', ')}` : ''}`,
        buttons: [{ label: 'open', open: x.robotId }],
      }
    case 'ready':
      return {
        key: `ready:${x.robotId}`,
        kind: x.kind,
        robotId: x.robotId,
        icon: '✈',
        text: `PR #${x.pr.number}${x.pr.draft ? ' · draft' : ''} · CI green · waiting ${ago(x.waitingMs)}`,
        buttons: [
          { label: 'merge', go: true, action: { kind: 'merge', robotIds: [x.robotId] } },
          { label: 'open', open: x.robotId },
        ],
      }
    case 'land': {
      const { pieces, feature } = x.mission
      const green = pieces.filter((p) => (p.pr ?? p.child?.pr)?.ci === 'pass' || (p.pr ?? p.child?.pr)?.state === 'MERGED').length
      return {
        key: `land:${x.root}:${feature}`,
        kind: x.kind,
        robotId: null,
        icon: '⚑',
        text: `mission ${feature} · ${green}/${pieces.length} green → land`,
        buttons: [{ label: 'land', go: true, action: { kind: 'land', root: x.root, feature } }],
      }
    }
    case 'stranded':
      return {
        key: `stranded:${x.robotId}`,
        kind: x.kind,
        robotId: x.robotId,
        icon: '⏸',
        text: `idle for ${ago(x.idleMs)}`,
        buttons: [
          { label: 'open', open: x.robotId },
          { label: 'stop', action: { kind: 'stop', robotIds: [x.robotId] } },
        ],
      }
    case 'snapshot':
      // Nothing to press: the text says what to do, and the row leaves once the read succeeds.
      return { key: `snapshot:${x.text}`, kind: x.kind, robotId: null, icon: '⚠', text: x.text, title: x.detail, buttons: [] }
  }
}

/** What an empty ship says. With the sessions or the children unlisted, none is not known to be
 *  none (#367): the bridge says what failed. */
export function emptyText(ship: Ship): string {
  const unlisted = ship.bridge.exceptions.some((x) => x.kind === 'snapshot' && (x.source === 'sessions' || x.source === 'children'))
  return unlisted ? 'Sessions unknown: the bridge says what could not be read.' : 'No live sessions.'
}

export const LOG_ICON: Record<LogKind, string> = {
  dispatched: '⇣',
  'pr-opened': '⇪',
  'ci-green': '✓',
  'ci-red': '✗',
  merged: '✈',
  closed: '⨯',
  finished: '■',
  stranded: '⏸',
  blocked: '❓',
  rule: '◈',
  you: '↩',
}

/** A log row's colour: state only (green, red), lilac for a warning, magenta for you. */
export function logTone(kind: LogKind): 'ok' | 'bad' | 'warn' | 'you' | null {
  if (kind === 'ci-green' || kind === 'merged') return 'ok'
  if (kind === 'ci-red' || kind === 'blocked') return 'bad'
  if (kind === 'stranded' || kind === 'rule') return 'warn'
  return kind === 'you' ? 'you' : null
}

/** A captain's caption under its console: the empty chair says why it is empty. */
export function captainTopic(c: Captain): string | null {
  if (c.pose === 'empty') return 'children with no recorded parent'
  return c.topic ? `“${c.topic.slice(0, 80)}”` : null
}

// What the stage says about the session on it, worked out from the world and nothing else:
// its family, what it is doing now, the rhythm of its tool calls, its facts, and the
// transcript drawn when its terminal cannot be shown live. Pure: a world in, plain values out.

import { age } from '../world/format'
import { childrenOf, pendingOf, rootOf, sessionOf } from '../world/store'
import type { Pending, Session, World } from '../world/types'

/** Whitespace folded: a tool's target or a status on one line. */
export const clean = (text: string | null | undefined): string => String(text ?? '').replace(/\s+/g, ' ').trim()

/** "claude-opus-5-5" → "opus 5.5"; a name that is not Claude's stays as it came. */
export function modelName(model: string | null | undefined): string {
  if (!model) return ''
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{6,})?(\[[^\]]+\])?$/.exec(model)
  if (!m) return model
  return `${m[1]} ${m[2]}${m[3] ? '.' + m[3] : ''}${m[4] ? ' ' + m[4] : ''}`
}

/** "692ms", "1.5s", "18s", "4m 05s", "1h 22m". */
export function duration(ms: number | null | undefined): string {
  if (ms == null) return ''
  if (ms < 1000) return Math.round(ms) + 'ms'
  if (ms < 60_000) return (ms / 1000).toFixed(ms < 10_000 ? 1 : 0) + 's'
  if (ms < 3_600_000) return Math.floor(ms / 60_000) + 'm ' + String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0') + 's'
  return Math.floor(ms / 3_600_000) + 'h ' + String(Math.floor((ms % 3_600_000) / 60_000)).padStart(2, '0') + 'm'
}

/** The clock time a line was printed at, "17:33", in this machine's zone. */
export function clock(at: number): string {
  const d = new Date(at)
  return Number.isNaN(d.getTime()) ? '' : String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
}

/** The family on stage: its root first, then every descendant under its parent, each level
 *  most urgent first (the roster's order). It is what left and right walk. */
export function familyOf(world: World, session: Session): Session[] {
  const out: Session[] = []
  const seen = new Set<string>()
  const add = (s: Session) => {
    if (seen.has(s.id)) return
    seen.add(s.id)
    out.push(s)
    for (const child of childrenOf(world, s)) add(child)
  }
  add(rootOf(world, session))
  if (!seen.has(session.id)) add(session)
  return out
}

/** The member `step` places from `session` in its family, wrapping; null when it is alone. */
export function familyStep(world: World, session: Session, step: number): Session | null {
  const family = familyOf(world, session)
  if (family.length < 2) return null
  const at = family.findIndex((s) => s.id === session.id)
  return family[(((at + step) % family.length) + family.length) % family.length]
}

export type NowKind = 'running' | 'you said' | 'recap' | 'status' | 'said' | 'asked to' | 'last' | 'prompt'

/** What a session is doing now, from the most telling thing the world has of it. */
export interface Now {
  kind: NowKind
  /** A sentence; or, for a tool call, null with `tool` and `target` set. */
  text: string | null
  tool: string | null
  target: string | null
  at: number | null
}

const says = (kind: NowKind, text: string, at: number | null): Now => ({ kind, text: clean(text), tool: null, target: null, at })

/** A call still running tells more than any summary; then what was just said to it from the
 *  stage, until the session has said or done something newer; then the session's own recap; a
 *  child's status; its last words; what it was sent to do; its last call; its last prompt. */
export function nowOf(s: Session, sent: readonly Sent[] = []): Now | null {
  for (let i = s.activity.length - 1; i >= 0; i--) {
    const a = s.activity[i]
    if (a.running) return { kind: 'running', text: null, tool: a.tool, target: clean(a.target), at: a.at }
  }
  const settled = settledOf(s)
  const told = sent[sent.length - 1]
  return told && (settled?.at ?? -Infinity) <= told.at ? says('you said', told.text, told.at) : settled
}

function settledOf(s: Session): Now | null {
  if (s.recap?.text) return says('recap', s.recap.text, s.recap.at)
  if (s.role === 'child' && (s.needs || s.detail)) return says('status', s.needs || s.detail || '', s.lastAt)
  if (s.said?.text) return says('said', s.said.text, s.said.at)
  if (s.intent) return says('asked to', s.intent, s.startedAt)
  const last = s.activity[s.activity.length - 1]
  if (last) return { kind: 'last', text: null, tool: last.tool, target: clean(last.target), at: last.at }
  if (s.lastPrompt) return says('prompt', s.lastPrompt, s.lastAt)
  return null
}

/** The width of one bucket of `Session.timeline`. */
const BUCKET_MS = 5 * 60_000

export interface Pulse {
  total: number
  /** The kinds it called most, most first. */
  kinds: [string, number][]
  /** One bar per bucket with calls: `left` and `width` in percent of the span, `height` in
   *  percent of the busiest bucket. */
  bars: { t: number; calls: number; left: number; width: number; height: number }[]
  from: number
  to: number
}

/** The rhythm of a session's tool calls: how many per five minutes, over at least an hour. */
export function pulseOf(s: Session): Pulse | null {
  if (!s.timeline.length) return null
  const from = s.timeline[0].t
  const to = Math.max(s.timeline[s.timeline.length - 1].t + BUCKET_MS, from + 12 * BUCKET_MS)
  const span = to - from
  const sums = s.timeline.map((b) => Object.values(b.kinds).reduce((n: number, k) => n + (k ?? 0), 0))
  const max = Math.max(1, ...sums)
  const width = Math.max(0.12, (BUCKET_MS / span) * 100 * 0.7)
  return {
    total: s.activityTotal,
    kinds: Object.entries(s.activityCounts)
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 7),
    bars: s.timeline.map((b, i) => ({ t: b.t, calls: sums[i], left: ((b.t - from) / span) * 100, width, height: Math.max(6, (sums[i] / max) * 100) })),
    from,
    to,
  }
}

/** One fact of the stage's head. `tone`: a pill (a thing with a name) or quiet running text. */
export interface Fact {
  key: 'branch' | 'model' | 'advisor' | 'account' | 'started' | 'turns' | 'process'
  text: string
  tone: 'pill' | 'quiet'
  mono?: boolean
}

/** The session's facts, in the order the head lists them. A fact the world lacks is left out. */
export function factsOf(world: World, s: Session): Fact[] {
  const out: Fact[] = []
  if (s.branch) out.push({ key: 'branch', text: s.branch, tone: 'pill', mono: true })
  if (s.model) out.push({ key: 'model', text: modelName(s.model) + (s.effort ? ' · ' + s.effort : ''), tone: 'pill' })
  if (s.advisor) out.push({ key: 'advisor', text: 'advisor ' + modelName(s.advisor), tone: 'pill' })
  if (s.account) out.push({ key: 'account', text: world.accounts.find((a) => a.id === s.account)?.label ?? s.account, tone: 'pill' })
  if (s.startedAt != null) out.push({ key: 'started', text: `started ${age(s.startedAt, world.at)} ago`, tone: 'quiet' })
  if (s.turns > 0) out.push({ key: 'turns', text: `${s.turns} ${s.turns === 1 ? 'prompt' : 'prompts'}${s.turnMs ? ' · ' + duration(s.turnMs) + ' in turns' : ''}`, tone: 'quiet' })
  out.push({ key: 'process', text: s.live ? 'process live' : 'no process', tone: 'quiet' })
  return out
}

/** Words the maintainer sent to a session from the stage, kept until the page reloads. */
export interface Sent {
  at: number
  text: string
}

/** One line of the drawn transcript. */
export type Line =
  | { kind: 'note'; key: string; text: string }
  /** Words typed to the session. `tag`: `sent` for a child's dispatch, `you` for what was
   *  said from this stage, null for the session's last prompt. */
  | { kind: 'prompt'; key: string; text: string; tag: 'sent' | 'you' | null }
  /** A finished tool call. `time` is null when the line above printed the same minute. */
  | { kind: 'call'; key: string; time: string | null; tool: string; target: string; failed: boolean; took: string }
  | { kind: 'words'; key: string; time: string; label: 'recap' | null; text: string }
  | { kind: 'running'; key: string; time: string; tool: string; target: string; since: string }
  | { kind: 'working'; key: string }
  | { kind: 'pending'; key: string; pending: Pending }

/** How many finished calls the transcript draws. */
export const TAIL = 90
/** A silence this long between two calls starts a new burst of work. */
const BURST_GAP_MS = 5 * 60_000

/** The transcript of a session whose terminal is not shown live, oldest line first: what it
 *  was sent to do, its calls, its last prompt, what it said, what was said to it from here,
 *  what still runs, and what waits at its foot.
 *
 *  The world has no time for the last prompt, so it stands where the newest burst of calls
 *  begins: a guess, and the only one in here. Words sent from this stage have their own time
 *  and stand where they were said. */
export function transcriptOf(world: World, s: Session, sent: readonly Sent[] = []): Line[] {
  const running = s.activity.filter((a) => a.running)
  const done = s.activity.filter((a) => !a.running).slice(-TAIL)
  let burst = 0
  for (let i = done.length - 1; i > 0; i--) {
    if (done[i].at - done[i - 1].at > BURST_GAP_MS) {
      burst = i
      break
    }
  }

  // Everything with a time, in the order it happened. `rank` settles a tie: a call, then the
  // words that followed it, then what was typed back.
  type Dated = { at: number; rank: number; line: (time: string, same: boolean) => Line }
  const dated: Dated[] = []
  const echoed = sent.some((x) => x.text === s.lastPrompt)
  done.forEach((a, i) => {
    if (i === burst && s.lastPrompt && !echoed) dated.push({ at: a.at, rank: 0, line: () => ({ kind: 'prompt', key: 'prompt', text: s.lastPrompt as string, tag: null }) })
    dated.push({
      at: a.at,
      rank: 1,
      line: (time, same) => ({ kind: 'call', key: `call-${i}-${a.at}`, time: same ? null : time, tool: a.tool, target: clean(a.target), failed: a.ok === false, took: duration(a.ms) }),
    })
  })
  if (!done.length && s.lastPrompt && !echoed) dated.push({ at: -Infinity, rank: 0, line: () => ({ kind: 'prompt', key: 'prompt', text: s.lastPrompt as string, tag: null }) })
  const recap = s.recap?.text && clean(s.recap.text) !== clean(s.said?.text) ? s.recap : null
  if (recap) dated.push({ at: recap.at, rank: 2, line: (time) => ({ kind: 'words', key: 'recap', time, label: 'recap', text: recap.text.trim() }) })
  const said = s.said?.text ? s.said : null
  if (said) dated.push({ at: said.at, rank: 3, line: (time) => ({ kind: 'words', key: 'said', time, label: null, text: said.text.trim() }) })
  sent.forEach((x, i) => dated.push({ at: x.at, rank: 4, line: () => ({ kind: 'prompt', key: `sent-${i}-${x.at}`, text: x.text, tag: 'you' }) }))
  dated.sort((a, b) => a.at - b.at || a.rank - b.rank)

  const lines: Line[] = []
  if (s.role === 'child' && s.intent) lines.push({ kind: 'prompt', key: 'intent', text: s.intent, tag: 'sent' })
  const earlier = Math.max(s.activityTotal, s.activity.length) - done.length - running.length
  if (earlier > 0) lines.push({ kind: 'note', key: 'earlier', text: `· · · ${earlier.toLocaleString('en-US')} earlier tool ${earlier === 1 ? 'call' : 'calls'}` })
  let minute = ''
  for (const d of dated) {
    const time = Number.isFinite(d.at) ? clock(d.at) : ''
    const line = d.line(time, time === minute)
    // only a call's time is dropped when it repeats, so only a call moves the clock on
    if (line.kind === 'call') minute = time
    lines.push(line)
  }
  if (!lines.length && !running.length) lines.push({ kind: 'note', key: 'nothing', text: 'Nothing recorded for this session yet.' })
  for (const a of running) lines.push({ kind: 'running', key: `running-${a.at}-${a.tool}`, time: clock(a.at), tool: a.tool, target: clean(a.target), since: age(a.at, world.at) })
  if (!running.length && s.state === 'working') lines.push({ kind: 'working', key: 'working' })
  for (const p of pendingOf(world, s.id)) lines.push({ kind: 'pending', key: `pending-${p.id}`, pending: p })
  return lines
}

/** The line under the terminal: how the session runs. */
export function statusOf(s: Session): string {
  const context = s.context.percent != null ? Math.round(s.context.percent) + '% context' : null
  return [s.permissionMode, modelName(s.model), s.effort, context].filter(Boolean).join('  ·  ')
}

/** The session a child was dispatched by, when the world has it. */
export const parentOf = (world: World, s: Session): Session | null => (s.parent ? (sessionOf(world, s.parent) ?? null) : null)

// One session of the live world: what it is to the maintainer right now (its state), what it
// waits for, and everything known of it, from its snapshot row, its feed, its insight and its
// trail. State follows the design's meanings (`../types.ts`) and the thresholds the ship
// learned on the real fleet (`src/nexus/ship.ts`).

import { childNext, parentNext } from '../../fleet/model'
import type { AskQuestion, Insight, ToolCall, ToolKind, Trail } from '../../insight/types'
import { needKind, permissionAsk, splitAsk, type ChildSession, type Pr } from '../../mission/types'
import { isRateLimited } from '../../nexus/robot'
import { ciAt, firstSentence, RUNNING_MAX_MS, STRANDED_MS, WORK_GAP_MS } from '../../nexus/ship'
import type { AgentView, PrFate, SessionFeed } from '../../nexus/ship-types'
import { basename } from '../../path/path'
import type { PulseEvent, PulseKind } from '../../pulse/types'
import { choicesFor } from '../pending'
import type { Context, Pending, PendingKind, PullRequest, Session, SessionState, TokenRow, Tokens } from '../types'
import { isOpen, latest, parseTime, type ChildSeat, type GoneSeat, type ParentSeat } from './roster'

/* ---------------------------------------------------------------- what is not known yet --
   One object each, so a session without an insight is handed the same ones every time. */

const ZERO: TokenRow = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, thinking: 0 }
const NO_TOKENS: Tokens = { main: ZERO, sidechain: ZERO, subagents: [], byModel: {}, own: ZERO }
const NO_WEB: Session['web'] = { searches: [], fetches: [], pages: [], shots: [], artifacts: [] }
const NO_FILES: Session['files'] = { edited: [], read: [] }
const NO_CLAUDE_MEMORY: Session['memory']['claude'] = { instructions: [], touches: [], skills: [] }
const NO_TRAIL: Trail = { prompts: 0, injected: [], considered: [], read: [], briefings: [], frictions: [] }
const NONE: never[] = []
const NO_COUNTS: Record<string, number> = {}

export const sumRows = (rows: TokenRow[]): TokenRow =>
  rows.reduce<TokenRow>(
    (t, r) => ({ input: t.input + r.input, output: t.output + r.output, cacheRead: t.cacheRead + r.cacheRead, cacheCreation: t.cacheCreation + r.cacheCreation, thinking: t.thinking + r.thinking }),
    ZERO,
  )

/* ---------------------------------------------------------------- small readings -- */

const KINDS: Record<string, ToolKind> = {
  Read: 'read', Grep: 'search-code', Glob: 'search-code', NotebookEdit: 'edit', Edit: 'edit', MultiEdit: 'edit', Write: 'write',
  Bash: 'shell', PowerShell: 'shell', Monitor: 'shell', WebSearch: 'web-search', WebFetch: 'web-fetch', Artifact: 'artifact',
  Agent: 'agent', Task: 'agent', Workflow: 'agent', SendMessage: 'message', Skill: 'skill', AskUserQuestion: 'ask',
  ToolSearch: 'meta', TaskStop: 'meta',
}

/** A tool's kind, as the insight names kinds (and the prototypes' capture did). */
export function toolKind(tool: string): ToolKind {
  if (KINDS[tool]) return KINDS[tool]
  if (tool.startsWith('mcp__mnemo__')) return 'memory'
  if (/^mcp__(claude-in-chrome|Claude_Browser|remote-devices__Claude_Browser)__/.test(tool)) return 'browser'
  return tool.startsWith('mcp__') ? 'mcp' : 'other'
}

const num = (t: number): number | null => (Number.isFinite(t) ? t : null)

/** `owner/repo` of a pull request's address. */
const repoOfUrl = (url: string) => /github\.com\/([^/]+\/[^/]+)\/pull\//.exec(url)?.[1] ?? ''

/** A short, stable mark of a text: a waiting item's id changes when what it asks does. */
function mark(text: string): string {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = (Math.imul(h, 33) ^ text.charCodeAt(i)) >>> 0
  return h.toString(36)
}

/** The unanswered question, from the insight (which knows each choice's description, and every
 *  question of a call that asks several) or the feed. */
interface Ask {
  id: string
  at: number | null
  question: string
  options: { label: string; description: string | null }[]
  /** Every question of the call when it asks more than one; else empty. */
  questions: AskQuestion[]
}

function askOf(f: SessionFeed | null, i: Insight | null): Ask | null {
  const a = i?.pendingAsk
  if (a) return { id: a.id, at: a.at, question: a.question, options: a.options, questions: a.questions && a.questions.length > 1 ? a.questions : [] }
  if (f?.ask) return { id: mark(f.ask.question), at: null, question: f.ask.question, options: f.ask.options.map((label) => ({ label, description: null })), questions: [] }
  return null
}

/** The tool a question is asked with. Claude Code first says such a call waits on a permission,
 *  and the hooks repeat it; it is a question all the same. */
const ASK_TOOL = 'AskUserQuestion'

/** The last tool call: the feed's (read this second), else the insight's newest. */
function lastCall(f: SessionFeed | null, i: Insight | null): { tool: string; target: string; at: number; running: boolean } | null {
  return f?.activity ?? i?.activity.at(-1) ?? null
}

/* ---------------------------------------------------------------- pull requests -- */

const CI: Record<Pr['ci'], PullRequest['ci']> = { pass: 'green', fail: 'red', pending: 'running', none: null }

function ciOf(pr: Pr | null, fate: PrFate | null, now: number): PullRequest['ci'] {
  if (!fate) return pr ? CI[pr.ci] : null
  const ci = ciAt(fate.checks, now)
  return ci === 'wait' || ci === 'run' ? 'running' : ci
}

function stateOfPr(pr: Pr | null, fate: PrFate | null): PullRequest['state'] {
  const said = fate?.state ?? pr?.state ?? null
  return said === 'OPEN' ? 'open' : said === 'MERGED' ? 'merged' : said === 'CLOSED' ? 'closed' : null
}

/** A session's pull requests, oldest first: the ones its transcript links, and the one the
 *  snapshot gives it, which also says where it stands (state, draft, checks). */
function prsOf(own: Pr | null, i: Insight | null, fates: Record<string, PrFate>, now: number): PullRequest[] {
  const row = (number: number, url: string, repo: string, pr: Pr | null): PullRequest => {
    const fate = fates[url] ?? null
    return { number, url, repo: repo || repoOfUrl(url), state: stateOfPr(pr, fate), draft: pr?.draft ?? null, title: null, ci: ciOf(pr, fate, now), mergeable: null }
  }
  const out = (i?.prs ?? []).map((p) => row(p.number, p.url, p.repo, own?.url === p.url ? own : null))
  if (own && !out.some((p) => p.url === own.url)) out.push(row(own.number, own.url, '', own))
  return out
}

/* ---------------------------------------------------------------- mnemo's side of memory -- */

const INJECTED: ReadonlySet<PulseKind> = new Set(['reflex', 'catchup', 'enrich'])

const ofSession = (e: PulseEvent, sid: string) => !!e.session_id && (e.session_id === sid || (sid.length < e.session_id.length && e.session_id.startsWith(sid)))

/** What mnemo gave a session, from the events the app heard while it ran: what the world knows
 *  of a session the core's trail does not answer for yet. */
function trailFromPulses(pulses: PulseEvent[], sid: string): Trail {
  const mine = pulses.filter((e) => ofSession(e, sid))
  if (!mine.length) return NO_TRAIL
  return {
    ...NO_TRAIL,
    prompts: mine.filter((e) => e.kind === 'reflex').length,
    injected: mine.filter((e) => INJECTED.has(e.kind)).flatMap((e) => e.slugs.map((slug) => ({ at: e.at, slug, name: null, score: null, judge: null }))),
    read: mine.filter((e) => e.kind === 'tool').map((e) => ({ at: e.at, tool: e.tool ?? '', slug: e.slugs.length === 1 ? e.slugs[0] : null, topic: null, query: null, hits: e.slugs, ms: null })),
  }
}

/* ---------------------------------------------------------------- what the transcript says -- */

function contextOf(f: SessionFeed | null, i: Insight | null): Context {
  if (i) return i.context
  const tokens = f?.context ?? null
  const window = (tokens ?? 0) > 200_000 ? 1_000_000 : 200_000
  return { tokens, window, percent: tokens === null ? null : Math.round((1000 * tokens) / window) / 10, series: NONE, compactions: NONE }
}

/** The fields a session's transcript and mnemo's logs fill, the same for a parent and a child. */
function read(sid: string, f: SessionFeed | null, i: Insight | null, trail: Trail | null, pulses: PulseEvent[]) {
  const call = f?.activity ?? null
  const one: ToolCall[] = call ? [{ at: call.at, tool: call.tool, kind: toolKind(call.tool), target: call.target, running: call.running, ok: null, ms: null }] : NONE
  const tokens = i?.tokens ?? NO_TOKENS
  return {
    effort: i?.effort ?? null,
    permissionMode: i?.permissionMode ?? null,
    startedAt: i?.startedAt ?? null,
    recap: i?.recap ?? null,
    lastPrompt: i?.lastPrompt ?? f?.topic ?? null,
    said: i?.said ?? (f?.said ? { at: f.said.at, text: f.said.text } : null),
    turns: i?.turns ?? 0,
    turnMs: i?.turnMs ?? 0,
    tokens,
    cost: i?.cost ?? null,
    context: contextOf(f, i),
    activity: i?.activity ?? one,
    activityTotal: i?.activityTotal ?? one.length,
    activityCounts: (i?.activityCounts as Record<string, number> | undefined) ?? (call ? { [toolKind(call.tool)]: 1 } : NO_COUNTS),
    timeline: i?.timeline ?? NONE,
    web: i?.web ?? NO_WEB,
    files: i?.files ?? NO_FILES,
    memory: { claude: i?.memory ?? NO_CLAUDE_MEMORY, trail: trail ?? trailFromPulses(pulses, sid) },
  }
}

/* ---------------------------------------------------------------- the sources of one session -- */

export interface Around {
  feed: { sessions: Record<string, SessionFeed>; prs: Record<string, PrFate> }
  agents: Record<string, AgentView>
  insights: Record<string, Insight>
  trails: Record<string, Trail>
  pulses: PulseEvent[]
  hosted: ReadonlySet<string>
  /** Where each dialog of several questions is, by its call's id (`./asked.ts`). */
  asked: Readonly<Record<string, number>>
  /** The kind of each account, by id: which CLI runs a session on it. */
  kinds: ReadonlyMap<string, string>
  now: number
}

/** A session before its family is known: `children` and `totals.tree` are the builder's. */
export interface Built {
  session: Session
  pending: Pending | null
}

const agentOf = (row: { account?: string; account_env?: { kind?: string } | null }, kinds: ReadonlyMap<string, string>) =>
  row.account_env?.kind ?? kinds.get(row.account ?? 'default') ?? 'claude'

const pendingOf = (s: Session, kind: PendingKind, mark: string, p: Omit<Pending, 'id' | 'session' | 'kind' | 'reply'>): Pending => ({
  id: `${s.id}:${kind}:${mark}`,
  session: s.id,
  kind,
  reply: kind !== 'merge',
  ...p,
})

/** The item of an unanswered question. A call that asks several is one item per question, in
 *  the dialog's order, then one for the review that submits them: each has its own id, so the
 *  card of the one just answered is not the card of the next. */
function questionOf(session: Session, ask: Ask, around: Around, suggestedReply: string | null, since: number | null): Pending {
  const rest = { suggestedReply, pr: null, since: ask.at ?? since }
  const n = ask.questions.length
  if (n < 2) return pendingOf(session, 'question', ask.id, { text: ask.question, detail: null, choices: choicesFor('question', ask.options, null), ...rest })
  const at = Math.min(Math.max(around.asked[ask.id] ?? 0, 0), n)
  const step = { ask: ask.id, at, of: n, firsts: ask.questions.map((q) => q.options[0]?.label ?? '') }
  if (at === n) {
    const review = pendingOf(session, 'question', `${ask.id}.review`, { text: 'Submit the answers?', detail: `All ${n} questions are answered: its terminal shows them for review.`, choices: [{ key: 1, label: 'Submit answers', hint: null, tone: 'good' }], ...rest })
    return { ...review, reply: false, step }
  }
  const q = ask.questions[at]
  const where = `Question ${at + 1} of ${n}${q.header ? ` · ${q.header}` : ''}`
  const item = pendingOf(session, 'question', at ? `${ask.id}.${at}` : ask.id, {
    text: q.question,
    detail: q.multi ? `${where}. It takes several answers: tick them in its terminal.` : where,
    choices: q.multi ? [] : choicesFor('question', q.options, null),
    ...rest,
  })
  return { ...item, reply: !q.multi, step }
}

/* ---------------------------------------------------------------- a child -- */

/** `done` and `stopped` are a child saying it is over; anything else with no process is a
 *  child that stopped without finishing. */
const finished = (c: ChildSession) => c.state === 'done' || c.state === 'stopped'

export function childSession(seat: ChildSeat, around: Around): Built {
  const { child: c, sid } = seat
  const { now } = around
  const f = around.feed.sessions[c.id] ?? null
  const i = around.insights[c.id] ?? null
  const view = around.agents[sid]
  const fate = seat.pr ? (around.feed.prs[seat.pr.url] ?? null) : null
  const open = isOpen(seat.pr, fate)

  const over = !c.live || finished(c) || c.state === 'failed'
  const lastAct = latest(parseTime(c.updated_at), f?.activity?.at, f?.said?.at, i?.lastAt)
  const idleMs = Number.isFinite(lastAct) ? Math.max(0, now - lastAct) : 0
  const fleet = view ? view.state : childNext(c).state
  const call = lastCall(f, i)
  // A tool call still awaiting its result is work, not a stop (a CI watch, a full suite).
  const running = !over && !!call?.running && now - call.at < RUNNING_MAX_MS
  const ask = over ? null : askOf(f, i)
  const asks = !!ask || (!over && fleet === 'needs-you' && !isRateLimited(c))
  // Blocked with no process behind it: the need stands, and nobody is there to hear the answer.
  const abandoned = !asks && !c.live && c.tempo === 'blocked'

  let state: SessionState
  if (asks || abandoned) state = 'need'
  else if (over) state = open ? 'ready' : finished(c) ? 'ended' : 'stalled'
  else if (running || (fleet === 'working' && idleMs <= WORK_GAP_MS)) state = 'working'
  // Its turn is over and its pull request is open: it waits for the merge, never stalled.
  else if (open) state = 'ready'
  else state = idleMs > STRANDED_MS ? 'stalled' : 'idle'

  const issue = c.cwd ? /-wt-(\d+)(?:-|$)/.exec(basename(c.cwd)) : null
  const detail = /^\s*stopped\s*$/i.test(c.detail) ? '' : c.detail.trim()
  const prs = prsOf(seat.pr, i, around.feed.prs, now)
  const session: Session = {
    id: sid,
    short: sid.slice(0, 8),
    role: 'child',
    parent: seat.parent,
    children: NONE,
    agentKind: 'background',
    agent: agentOf(c, around.kinds),
    live: c.live,
    hosted: around.hosted.has(sid) || around.hosted.has(c.id),
    state,
    abandoned,
    project: seat.repo.name,
    root: seat.repo.root,
    cwd: c.cwd || null,
    branch: i?.branch ?? c.branch ?? null,
    title: i?.title || c.name || c.intent || `session ${sid.slice(0, 8)}`,
    account: c.account ?? 'default',
    // The model it really ran on; the snapshot's is the alias it was dispatched with.
    model: i?.model ?? f?.model ?? c.model ?? null,
    advisor: null,
    lastAt: num(lastAct),
    intent: c.intent ?? null,
    detail: detail || null,
    needs: c.needs?.trim() || c.waiting_for || null,
    contract: f?.contract ? { feature: f.contract.feature, piece: f.contract.piece } : seat.contract,
    issue: issue ? Number(issue[1]) : null,
    totals: { own: ZERO, tree: ZERO },
    prs,
    ...read(sid, f, i, around.trails[sid] ?? null, around.pulses),
    effort: i?.effort ?? c.effort ?? null,
  }

  const since = num(lastAct)
  let pending: Pending | null = null
  if (state === 'need') {
    const waits = view?.waitingFor ?? needKind(c)
    const suggestedReply = c.suggested_reply ?? null
    const asked = !abandoned && waits === 'permission' ? permissionAsk(c) : null
    const { tool, command } = asked ? splitAsk(asked) : { tool: null, command: '' }
    if (ask) pending = questionOf(session, ask, around, suggestedReply, since)
    // The question is asked and not read yet: it is still no permission.
    else if (tool === ASK_TOOL) pending = pendingOf(session, 'question', mark(asked ?? ''), { text: command || 'It asks a question.', detail: null, choices: [], suggestedReply, pr: null, since })
    else if (!abandoned && waits === 'permission') {
      const text = tool ? `Allow ${tool}?` : asked || 'It asks for permission.'
      pending = pendingOf(session, 'permission', mark(asked ?? ''), { text, detail: tool ? command : (c.waiting_for ?? null), choices: choicesFor('permission', [], null), suggestedReply: null, pr: null, since })
    } else {
      const text = c.needs?.trim() || detail || (session.said ? firstSentence(session.said.text) : '') || 'It is blocked.'
      pending = pendingOf(session, 'blocked', mark(text), { text, detail: null, choices: choicesFor('blocked', [], null), suggestedReply, pr: null, since })
    }
  } else if (state === 'ready') {
    const pr = prs.find((p) => p.url === seat.pr?.url) ?? null
    // Red CI is not a need while mnemo's follow wakes the child to fix it.
    if (pr && pr.ci !== 'red') pending = pendingOf(session, 'merge', String(pr.number), { text: session.title, detail: `${pr.repo}#${pr.number}`, choices: choicesFor('merge', [], pr), suggestedReply: null, pr, since })
  } else if (state === 'stalled') {
    const text = detail || (session.said ? firstSentence(session.said.text) : '') || (c.live ? 'It went quiet with nothing running.' : 'Its process ended before it finished.')
    pending = pendingOf(session, 'stalled', c.live ? 'quiet' : 'gone', { text, detail: null, choices: choicesFor('stalled', [], null), suggestedReply: null, pr: null, since })
  }
  return { session, pending }
}

/* ---------------------------------------------------------------- a parent -- */

export function parentSession(seat: ParentSeat, around: Around): Built {
  const { parent: p } = seat
  const sid = p.session_id
  const f = around.feed.sessions[sid] ?? null
  const i = around.insights[sid] ?? null
  const view = around.agents[sid]
  // The fleet's answer (hook events fused in), else the row `claude agents` gave. A dialog the
  // maintainer opened himself asks nothing of him.
  const needs = view ? view.state === 'needs-you' : p.status === 'waiting' && p.waiting_for !== 'dialog open'
  const busy = view ? view.state === 'working' : p.status === 'busy'
  const state: SessionState = needs ? 'need' : busy ? 'working' : 'idle'
  const lastAt = num(latest(i?.lastAt, f?.activity?.at, f?.said?.at))

  const session: Session = {
    id: sid,
    short: sid.slice(0, 8),
    role: 'parent',
    parent: null,
    children: NONE,
    agentKind: 'interactive',
    agent: agentOf(p, around.kinds),
    live: true,
    hosted: around.hosted.has(sid),
    state,
    abandoned: false,
    project: seat.repo.name,
    root: seat.repo.root,
    cwd: p.cwd || null,
    branch: i?.branch ?? null,
    title: i?.title || f?.title || view?.title || p.name || `session ${sid.slice(0, 8)}`,
    account: p.account ?? 'default',
    model: i?.model ?? f?.model ?? null,
    advisor: null,
    lastAt,
    intent: null,
    detail: null,
    needs: p.status === 'waiting' ? (p.waiting_for ?? null) : null,
    contract: null,
    issue: null,
    totals: { own: ZERO, tree: ZERO },
    prs: prsOf(null, i, around.feed.prs, around.now),
    ...read(sid, f, i, around.trails[sid] ?? null, around.pulses),
  }

  let pending: Pending | null = null
  if (state === 'need') {
    const ask = askOf(f, i)
    // `claude agents` says a permission is asked, not for what: the call still awaiting its
    // result is the one it asks about.
    const call = lastCall(f, i)
    const asked = call?.running ? call : null
    // A question the transcript holds is the question, whatever kind of wait is reported: the
    // call that asks one is first said to wait on a permission.
    const asking = asked?.tool === ASK_TOOL
    const waits = ask || asking ? 'question' : ((view ? view.waitingFor : parentNext(p, undefined).waitingFor) ?? 'permission')
    if (ask) pending = questionOf(session, ask, around, null, lastAt)
    else if (waits === 'question') {
      // Asked and not read yet (its words are the call's target), or only known to be asked.
      const text = (asking && asked?.target) || 'It asks for your input.'
      pending = pendingOf(session, 'question', asking && asked?.target ? mark(asked.target) : 'input', { text, detail: null, choices: [], suggestedReply: null, pr: null, since: lastAt })
    } else {
      pending = pendingOf(session, 'permission', mark(asked ? `${asked.tool} ${asked.target}` : ''), { text: asked ? `Allow ${asked.tool}?` : 'It asks for permission.', detail: asked?.target || null, choices: choicesFor('permission', [], null), suggestedReply: null, pr: null, since: asked?.at ?? lastAt })
    }
  }
  return { session, pending }
}

/* ---------------------------------------------------------------- a parent that is gone -- */

/** A session children still name as their parent, that no process runs any more. */
export function goneSession(seat: GoneSeat, around: Around): Built {
  const { sid } = seat
  const i = around.insights[sid] ?? null
  const session: Session = {
    id: sid,
    short: sid.slice(0, 8),
    role: 'parent',
    parent: null,
    children: NONE,
    agentKind: null,
    agent: around.kinds.get(seat.account) ?? 'claude',
    live: false,
    hosted: false,
    state: 'ended',
    abandoned: false,
    project: seat.repo.name,
    root: seat.repo.root,
    cwd: null,
    branch: i?.branch ?? null,
    title: i?.title || `session ${sid.slice(0, 8)}`,
    account: seat.account,
    model: i?.model ?? null,
    advisor: null,
    lastAt: i?.lastAt ?? null,
    intent: null,
    detail: null,
    needs: null,
    contract: null,
    issue: null,
    totals: { own: ZERO, tree: ZERO },
    prs: prsOf(null, i, around.feed.prs, around.now),
    ...read(sid, null, i, around.trails[sid] ?? null, around.pulses),
  }
  return { session, pending: null }
}

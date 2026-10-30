/** Following a parent (#505, decision 6) through what the desktop already reads on Windows, where
 *  the agent-hooks socket does not exist: the session's `claude agents` row, which the mission poll
 *  brings, and its transcript. Pure: `readTurn` says what the transcript shows of the turn, `step`
 *  turns that and the row into the parent's state and what Jarvis says of it. Only the parent's own
 *  row and transcript are read, so no child is ever reported: the parent hears from its children and
 *  says what matters. */

import { deriveConversation } from '../../conversation/parse'
import type { TranscriptRecord } from '../../conversation/types'
import type { ParentState } from './index'

/** A session's `claude agents` row, as the mission snapshot carries it (`ParentSession`). */
export type Row = { status: string; waiting_for?: string | null }

/** What the transcript says of the turn the last prompt started. */
export type Turn = {
  /** The last prompt typed (its record's uuid), null before one. */
  promptId: string | null
  /** When it was typed, ms; null when unknown. */
  promptAt: number | null
  /** The index of its record: what came before it says nothing of this turn. */
  start: number
  /** The last thing the parent said since, and its card's id. */
  text: string | null
  textId: string | null
  /** The tool call the parent has no result for yet: running, or parked on a prompt. */
  pending: { id: string; ask: boolean; question: string } | null
  /** Claude Code wrote the turn's end (`system` `turn_duration`) after the prompt. */
  done: boolean
  /** When the transcript last moved, ms; null when unknown. */
  lastAt: number | null
}

/** How much older than the transcript's last line a row read may be and still be believed: the
 *  mission poll asks `claude agents` a moment before it hands the snapshot over, so a row read in
 *  the same breath as a line may be from before it. */
export const ROW_LAG_MS = 5_000

const time = (at: string | undefined) => {
  const t = at ? Date.parse(at) : NaN
  return Number.isNaN(t) ? null : t
}

export function readTurn(records: TranscriptRecord[]): Turn {
  const { cards } = deriveConversation(records)
  let from = -1
  for (let i = cards.length - 1; i >= 0; i--) {
    const c = cards[i]
    if (c.kind === 'user' && !c.queued) {
      from = i
      break
    }
  }
  const prompt = from >= 0 ? cards[from] : null
  const since = cards.slice(from + 1)
  const said = since.filter((c) => c.kind === 'assistant' && c.text.trim()).at(-1)
  const tool = since.find((c) => c.kind === 'tool' && c.outcome === null)
  const pending =
    tool?.kind === 'tool'
      ? { id: tool.id, ask: tool.name === 'AskUserQuestion', question: tool.name === 'AskUserQuestion' ? tool.summary : tool.summary ? `${tool.name}: ${tool.summary}` : tool.name }
      : null
  // The prompt's record, by the uuid its card carries (a repeated id gets `#2` on its card).
  const uuid = prompt?.id.replace(/#\d+$/, '')
  const start = uuid ? Math.max(0, records.findIndex((r) => r.uuid === uuid)) : 0
  const turn = records.slice(start)
  const done = !!prompt && turn.slice(1).some((r) => r.type === 'system' && r.subtype === 'turn_duration')
  const times = turn.flatMap((r) => time(r.timestamp) ?? [])
  return {
    promptId: prompt?.id ?? null,
    promptAt: prompt ? time(prompt.at) : null,
    start,
    text: said?.kind === 'assistant' ? said.text : null,
    textId: said?.id ?? null,
    pending,
    done,
    lastAt: times.length ? Math.max(...times) : null,
  }
}

/** One sentence of `text`, for the panel and the voice: its first, markdown dropped, at most
 *  `max` characters. */
export const sentence = (text: string, max = 200): string => sentences(text, 1, max)

/** The first `n` sentences of `text`, markdown dropped, at most `max` characters. */
export function sentences(text: string, n: number, max: number): string {
  const plain = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(#+|[-*+]|\d+\.)\s+/gm, '')
    .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
  const first = new RegExp(`^(?:.*?[.!?…](?=\\s|$)){1,${n}}`).exec(plain)?.[0] ?? plain
  return first.length > max ? `${first.slice(0, max - 1).trimEnd()}…` : first
}

/** How much of the parent's last message a turn's end carries, characters: enough for the brain
 *  to answer "e aí, o que ele achou?" from a report of a page or so, without a long one taking
 *  the next request over. Longer ones are cut, marked by "…". */
export const LAST_MAX = 1_500

/** `text`, at most `LAST_MAX` characters. */
export const bounded = (text: string) => (text.length > LAST_MAX ? `${text.slice(0, LAST_MAX - 1).trimEnd()}…` : text)

/** What Jarvis knows of a parent between reads. */
export type Track = {
  state: ParentState
  summary: string | null
  question: string | null
  /** The handoff was typed: before it, the parent is starting whatever it shows. */
  handedOff: boolean
  /** The turn whose end was reported, and the prompt that was (`Turn.textId`, `Turn.pending.id`). */
  reported: string | null
  asked: string | null
  /** When `answer` last answered a prompt, ms: a row read before it still shows that prompt. */
  answeredAt: number | null
  /** What was last said, as `told` writes it, since the parent was last seen working or was sent
   *  or answered something: the same said again in between is a repeat. */
  told: string | null
}

export const STARTING: Track = { state: 'starting', summary: null, question: null, handedOff: false, reported: null, asked: null, answeredAt: null, told: null }

/** What a read of the parent saw. `rowAt`: when the row was read (the snapshot's `at`), ms; `row`
 *  null when the snapshot does not list the session. */
export type Seen = { row: Row | null; rowAt: number | null; turn: Turn; exited: boolean }

/** What Jarvis says of a move: a `ParentEvent` without its parent, which the caller adds. */
export type Said = { kind: 'turn-ended'; summary: string; last: string } | { kind: 'asking' | 'approval'; question: string } | { kind: 'exited' }

/** `claude agents`' `waitingFor` (`fleet/model.ts`'s reading): a question, a permission, or
 *  nothing asked of anyone (`dialog open`: the person opened `/config`). A row from before it was
 *  carried reads as a permission. */
function waitingOn(row: Row): 'asking' | 'approval' | null {
  if (row.status !== 'waiting') return null
  if (row.waiting_for === 'input needed') return 'asking'
  if (row.waiting_for == null || row.waiting_for === 'permission prompt' || row.waiting_for === 'sandbox request') return 'approval'
  return null
}

/** Whether a row read at `rowAt` was read after `ms`: one read before says nothing of what came
 *  since. An unknown time is taken as current. */
const after = (rowAt: number | null, ms: number | null) => rowAt === null || ms === null || rowAt > ms

/** What `said` says, to tell a repeat. */
const told = (said: Said) => (said.kind === 'turn-ended' ? `${said.kind}
${said.last}` : said.kind === 'exited' ? said.kind : `${said.kind}
${said.question}`)

/** `step`, and a repeat said once: what says the same as the last said, with nothing moved
 *  in between, is not said again (a history read again under new ids, a row that flaps). */
export function step(t: Track, s: Seen): { track: Track; said: Said[] } {
  const next = move(t, s)
  const said = next.said.filter((x) => told(x) !== t.told)
  const last = said.at(-1)
  return { track: last ? { ...next.track, told: told(last) } : next.track, said }
}

/** The parent's next state from `s`, and what Jarvis says of the move: the end of a turn once,
 *  with a sentence of its last message and the message itself, bounded; a question or a
 *  permission prompt once per tool call; its exit. A row older than the last prompt or the last
 *  answer is not believed. */
function move(t: Track, s: Seen): { track: Track; said: Said[] } {
  if (t.state === 'exited') return { track: t, said: [] }
  if (s.exited) return { track: { ...t, state: 'exited', question: null }, said: [{ kind: 'exited' }] }
  if (!t.handedOff) return { track: t, said: [] }
  const { turn, row } = s
  const live = row && after(s.rowAt, turn.promptAt) && after(s.rowAt, t.answeredAt) ? row : null

  // Parked on a prompt: the row says so, and the transcript has the tool call it is parked on
  // (Claude writes the call before it asks; a Grok history may not, so a bare row does too).
  const waits = live ? waitingOn(live) : null
  if (waits && (turn.pending || !turn.promptId)) {
    const state: 'asking' | 'approval' = turn.pending?.ask ? 'asking' : waits
    const question = turn.pending?.question || (state === 'asking' ? 'Tem uma pergunta.' : 'Pede uma permissão.')
    const key = turn.pending?.id ?? `${state}@${turn.promptId}`
    const next = { ...t, state, question, asked: key }
    return { track: next, said: key === t.asked ? [] : [{ kind: state, question }] }
  }

  // The turn ended: Claude wrote its end, or a row read well after the transcript last moved
  // finds the session idle with nothing left running (a Grok history writes no end).
  const settled = live?.status === 'idle' && !!turn.text && after(s.rowAt, turn.lastAt === null ? null : turn.lastAt + ROW_LAG_MS)
  const ended = !!turn.promptId && !turn.pending && (turn.done || settled)
  if (ended) {
    const summary = turn.text ? sentence(turn.text) : 'Terminou a vez sem dizer nada.'
    const key = turn.textId ?? turn.promptId
    const next = { ...t, state: 'idle' as const, summary, question: null, reported: key }
    return { track: next, said: key === t.reported ? [] : [{ kind: 'turn-ended', summary, last: bounded(turn.text ?? '') }] }
  }

  if (turn.promptId || live?.status === 'busy') return { track: { ...t, state: 'working', question: null, told: null }, said: [] }
  return { track: t, said: [] }
}

import type { Card, Conversation, ImageRef, ToolOutcome, TranscriptRecord } from './types'
import { toolSummary } from './parse'

/** A Grok Build session's `chat_history.jsonl` as a `Conversation` (spec
 *  `2026-10-16-grok-accounts-design.md`, decision 8).
 *
 *  What a history holds, read from Grok's source (`github.com/xai-org/grok-build` 2bdd1d6,
 *  `xai-grok-sampling-types/src/conversation.rs`, `ConversationItem`) and checked against
 *  histories grok 1.0.60 wrote on 2026-10-16:
 *
 *  - One record per line, tagged by `type`: `system` (the system prompt), `user` (`content`: text
 *    and image parts), `assistant` (`content`: a string; `tool_calls` `[{id, name, arguments}]`
 *    with `arguments` a JSON string; `model_id`), `tool_result` (`tool_call_id`, `content`: a
 *    string, `images`), `reasoning` (`summary` / `content` parts, `encrypted_content`) and
 *    `backend_tool_call` (a search the server ran).
 *  - No record has a uuid, a timestamp, a session id or token usage: cards have no `at`, and the
 *    context ring has no reading.
 *  - A `user` record is the person's when `synthetic_reason` is absent (`human`) or `interjection`
 *    (typed mid-turn), and then its words sit in `<user_query>…</user_query>`. The untagged record
 *    after the system prompt (`<user_info>`, rules) has none. Every other `user` record carries
 *    the reason Grok injected it.
 *  - An API error (a rate limit, measured) writes nothing here: it is in `updates.jsonl` and
 *    `events.jsonl`, which the follow does not read. */

type Rec = TranscriptRecord & Record<string, unknown>
type ToolCard = Extract<Card, { kind: 'tool' }>

const GROK_ONLY = new Set(['tool_result', 'reasoning', 'backend_tool_call'])

/** Whether `r` is a Grok history record: a type Claude Code never writes, or a turn with its
 *  `content` on the record itself where Claude Code nests a `message` under a uuid. */
export function isGrokRecord(r: TranscriptRecord): boolean {
  if (GROK_ONLY.has(r.type)) return true
  return (r.type === 'user' || r.type === 'assistant' || r.type === 'system') && 'content' in r && !('message' in r) && r.uuid === undefined
}

/** Grok's tools under the Claude Code names it maps them to (`xai-grok-tools/src/types/
 *  claude_alias.rs`), so a run counts and draws them as it does Claude's. */
export const CLAUDE_NAMES: Readonly<Record<string, string>> = {
  run_terminal_command: 'Bash',
  read_file: 'Read',
  write: 'Write',
  search_replace: 'Edit',
  hashline_edit: 'Edit',
  grep: 'Grep',
  list_dir: 'LS',
  web_search: 'WebSearch',
}

/** Injected records that wake the session for a turn of its own: a line in the stream says why.
 *  The rest (reminders, project instructions, the session prefix, what compaction re-read) are
 *  context the model was given, hidden as Claude Code's meta records are. */
const WAKES: Readonly<Record<string, string>> = {
  task_completed: 'A background command finished',
  subagent_completed: 'A subagent finished',
  notification_drain: 'Notifications delivered',
  scheduler_fired: 'A scheduled prompt fired',
  goal_summary: 'Goal progress',
  goal_classifier_nudge: 'Goal not yet achieved',
  stop_hook_feedback: 'A stop hook kept the session going',
  auto_continue: 'Continued after compacting',
  auto_recovery: 'Retrying after a tool failure',
}
/** Injected words another session wrote: a peer card, as a message over the inbox is. */
const PEERS: Readonly<Record<string, string>> = {
  agent_message: 'another agent',
  parent_agent_message: 'another agent',
  parent_human_message: 'the parent session',
}
const CONTEXT = new Set([
  'primary', 'session_prefix', 'system_reminder', 'project_instructions', 'compaction_meta',
  'length_continue', 'working_directory_switch', 'goal_setup', 'direct_bash',
])

const USER_QUERY = /<user_query>([\s\S]*?)<\/user_query>/g

const obj = (v: unknown): Record<string, unknown> | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const parts = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.map(obj).filter((b): b is Record<string, unknown> => b !== null) : []

/** The person's words in `<user_query>` blocks, or `null` when there are none. */
export function userQuery(text: string): string | null {
  const found = [...text.matchAll(USER_QUERY)].map((m) => m[1].trim()).filter(Boolean)
  return found.length ? found.join('\n\n') : null
}

/** Text and images of a Grok `content`: a string, or `text` and `image` parts (an image's `url`
 *  is a `data:` URI; one that is not is left out, the view draws only inline data). */
function flatten(content: unknown): { text: string; images: ImageRef[] } {
  if (typeof content === 'string') return { text: content, images: [] }
  const texts: string[] = []
  const images: ImageRef[] = []
  for (const p of parts(content)) {
    if (p.type === 'text' && typeof p.text === 'string') texts.push(p.text)
    if (p.type === 'image') {
      const image = dataImage(p.url)
      if (image) images.push(image)
    }
  }
  return { text: texts.join('\n'), images }
}

function dataImage(url: unknown): ImageRef | null {
  const m = typeof url === 'string' ? /^data:([^;,]+);base64,(.*)$/s.exec(url) : null
  return m ? { mediaType: m[1], data: m[2] } : null
}

/** A tool call's `arguments` (a JSON string on disk) as an object. */
function args(raw: unknown): Record<string, unknown> {
  const direct = obj(raw)
  if (direct) return direct
  if (typeof raw !== 'string') return {}
  try {
    const v: unknown = JSON.parse(raw)
    return obj(v) ?? { arguments: v }
  } catch {
    return { arguments: raw }
  }
}

/** What Grok's terminal tool prints first (`bash/mod.rs`, `format_default_prompt`): `exit: <code>`
 *  or `exit: killed (<reason>)`, then annotations, then the output on the next line. */
const EXIT = /^exit: (?:(-?\d+)|killed \(([^)]*)\))[^\n]*(?:\n|$)/

/** What a finished call returned. Grok's result is text with no error flag: only the terminal
 *  tool says whether it failed, by its exit code. */
function outcome(name: string, input: Record<string, unknown>, text: string): ToolOutcome {
  if (name === 'Bash') {
    const exit = EXIT.exec(text)
    if (exit) {
      const out = text.slice(exit[0].length)
      if (exit[2] !== undefined) return { kind: 'bash', stdout: out, stderr: '', interrupted: true }
      return exit[1] === '0' ? { kind: 'bash', stdout: out, stderr: '', interrupted: false } : { kind: 'error', text }
    }
  }
  // A new file's whole content is its diff, as Claude Code's Write of a new file has it.
  const content = str(input.content)
  if (name === 'Write' && content !== null && /has been created/.test(text)) {
    const lines = content.replace(/\n$/, '').split('\n')
    return {
      kind: 'diff',
      filePath: str(input.file_path) ?? '',
      created: true,
      hunks: [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: lines.length, lines: lines.map((l) => '+' + l) }],
    }
  }
  return { kind: 'text', text }
}

/** Cheap stable hash, for the id of a record that has none. */
function hash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193)
  return (h >>> 0).toString(36)
}

const firstLine = (s: string): string => {
  const line = s.split('\n').map((l) => l.trim()).find(Boolean) ?? ''
  return line.length > 200 ? line.slice(0, 199) + '…' : line
}

/** The conversation a Grok history's `records` describe. Pure: the same records always give the
 *  same cards, with the same ids (a tool call's id, a prompt's index, else a hash of the record). */
export function deriveGrokConversation(records: TranscriptRecord[]): Conversation {
  const cards: Card[] = []
  const ids = new Set<string>()
  const tools = new Map<string, ToolCard>()

  const push = (card: Card) => {
    let id = card.id
    for (let n = 2; ids.has(id); n++) id = `${card.id}#${n}`
    card.id = id
    ids.add(id)
    cards.push(card)
  }
  const recordId = (r: Rec) => `grok:${r.type}:${hash(JSON.stringify(r))}`

  const userRecord = (r: Rec) => {
    const reason = str(r.synthetic_reason) ?? 'human'
    const { text, images } = flatten(r.content)
    if (reason === 'human' || reason === 'interjection') {
      const query = userQuery(text)
      // No `<user_query>`: the session prefix, which Grok leaves untagged.
      if (query === null && !images.length) return
      const index = typeof r.prompt_index === 'number' ? `grok:prompt:${r.prompt_index}` : recordId(r)
      return push({ kind: 'user', id: index, at: '', text: query ?? '', images, rules: [], queued: false })
    }
    if (CONTEXT.has(reason)) return
    const from = PEERS[reason]
    if (from) return push({ kind: 'peer', id: recordId(r), at: '', from, text: (userQuery(text) ?? text).trim() })
    const said = firstLine(text.replace(/<\/?[a-z][\w-]*(\s[^>]*)?>/g, ' '))
    const label = WAKES[reason] ?? `Injected by Grok (${reason})`
    push({ kind: 'notification', id: recordId(r), at: '', text: said ? `${label}: ${said}` : label })
  }

  const assistantRecord = (r: Rec) => {
    const calls = parts(r.tool_calls)
    const text = str(r.content) ?? flatten(r.content).text
    const first = str(calls[0]?.id)
    if (text.trim()) push({ kind: 'assistant', id: first ? `grok:said:${first}` : recordId(r), at: '', text })
    for (const call of calls) {
      const toolUseId = str(call.id) ?? ''
      const grokName = str(call.name) ?? ''
      const name = CLAUDE_NAMES[grokName] ?? grokName
      const input = args(call.arguments)
      // Grok's reader names its path `target_file`; a Read card reads `file_path`.
      if (name === 'Read' && input.file_path === undefined && typeof input.target_file === 'string') input.file_path = input.target_file
      const card: ToolCard = {
        kind: 'tool', id: toolUseId || recordId(r), at: '', toolUseId, name,
        summary: toolSummary(name, input), input, outcome: null, images: [], rules: [],
      }
      push(card)
      if (toolUseId) tools.set(toolUseId, card)
    }
  }

  const resultRecord = (r: Rec) => {
    const card = tools.get(str(r.tool_call_id) ?? '')
    if (!card) return
    const { text, images } = flatten(r.content)
    card.outcome = outcome(card.name, card.input, text)
    card.images = [...images, ...flatten(r.images).images]
  }

  /** What the model thought, when the record keeps it readable: its reasoning text, else its
   *  summary. Encrypted alone, it makes no card, as Claude Code's redacted thinking does not. */
  const reasoningRecord = (r: Rec) => {
    const own = parts(r.content).map((p) => str(p.text) ?? '').filter((t) => t.trim())
    const text = (own.length ? own : parts(r.summary).map((p) => str(p.text) ?? '').filter((t) => t.trim())).join('\n\n')
    if (text.trim()) push({ kind: 'thinking', id: str(r.id) ? `grok:reasoning:${r.id}` : recordId(r), at: '', text })
  }

  for (const rec of records) {
    const r = rec as Rec
    switch (r.type) {
      case 'system':
        break
      case 'user':
        userRecord(r)
        break
      case 'assistant':
        assistantRecord(r)
        break
      case 'tool_result':
        resultRecord(r)
        break
      case 'reasoning':
        reasoningRecord(r)
        break
      case 'backend_tool_call': {
        // A search the server ran and answered itself: it never waits on a result.
        const call = obj(r.kind) ?? {}
        const type = str(call.tool_type) ?? 'backend_tool_call'
        const name = CLAUDE_NAMES[type] ?? type
        const id = str(call.id)
        push({
          kind: 'tool', id: id ?? recordId(r), at: '', toolUseId: id ?? '', name,
          summary: toolSummary(name, obj(call.action) ?? call), input: call, outcome: { kind: 'text', text: '' }, images: [], rules: [],
        })
        break
      }
      default: {
        const last = cards[cards.length - 1]
        if (last?.kind === 'unknown' && last.type === r.type) break
        push({ kind: 'unknown', id: recordId(r), at: '', type: r.type })
      }
    }
  }
  return { sessionId: null, title: null, prs: [], cards, usage: null, thinkingAt: null }
}

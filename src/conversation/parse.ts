import type { Card, Conversation, DiffHunk, ImageRef, PrLink, RuleChannel, RuleChip, ToolOutcome, TranscriptRecord } from './types'

/** One transcript line as a record; `null` for a line that is not a JSON object with a `type`. */
export function parseRecord(line: string): TranscriptRecord | null {
  try {
    const v: unknown = JSON.parse(line)
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return null
    return typeof (v as { type?: unknown }).type === 'string' ? (v as TranscriptRecord) : null
  } catch {
    return null
  }
}

/** Top-level record types that carry nothing to show: the TUI's own bookkeeping. Known, so
 *  they never make an `unknown` card. Read off every transcript on the maintainer's machine
 *  (Claude Code 2.1.280, 2026-09-23). */
const HIDDEN = new Set([
  'mode',
  'last-prompt',
  'atis-latch',
  'permission-mode',
  'file-history-snapshot',
  'file-history-delta',
  'cost-state',
  'system',
  'queue-operation',
  'agent-name',
  'bridge-session',
  'worktree-state',
  'relocated',
  'frame-link',
  'history-suppression',
  'artifact-autoreact-ledger',
  'artifact-comment-monitor',
  'summary',
])

/** Everything a user record's text can open with that is not something the user typed:
 *  the output of a `!` command or a local slash command, and the caveat before it. */
const HIDDEN_PROMPT = /^\s*<(bash-stdout|bash-stderr|local-command-stdout|local-command-stderr|local-command-caveat)>/

const REFLEX = 'mnemo reflex context:'
const SLUG = /\[\[([^\]\s]+)\]\]/g
const ENRICHMENT = /• mnemo rule \[\[([^\]\s]+)\]\]/g
const MNEMO_SESSION = /mnemo:\/\/v1|\[last-briefing|\[mnemo learned since your last session\]/

type Rec = TranscriptRecord & Record<string, unknown>
type ToolCard = Extract<Card, { kind: 'tool' }>
type AgentCard = Extract<Card, { kind: 'agent' }>

const obj = (v: unknown): Record<string, unknown> | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const blocks = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.map(obj).filter((b): b is Record<string, unknown> => b !== null) : []

/** Text and images out of a message's `content` (a string or content blocks). */
function flatten(content: unknown): { text: string; images: ImageRef[] } {
  if (typeof content === 'string') return { text: content, images: [] }
  const texts: string[] = []
  const images: ImageRef[] = []
  for (const b of blocks(content)) {
    if (b.type === 'text' && typeof b.text === 'string') texts.push(b.text)
    else if (b.type === 'image') {
      const src = obj(b.source)
      if (src && typeof src.data === 'string') images.push({ mediaType: str(src.media_type) ?? 'image/png', data: src.data })
    }
  }
  return { text: texts.join('\n\n'), images }
}

/** The inner text of the first `<tag>…</tag>` in `s`. */
function tag(s: string, name: string): string | null {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(s)
  return m ? m[1] : null
}

const oneLine = (s: string): string => {
  const lines = s.split('\n').map((l) => l.trim()).filter(Boolean)
  const first = lines[0] ?? ''
  const cut = first.length > 200 ? first.slice(0, 199) + '…' : first
  return lines.length > 1 && cut === first ? cut + ' …' : cut
}

/** What a tool chip shows collapsed: the command, the path, the pattern. */
const SUMMARY_KEYS = [
  'command', 'file_path', 'notebook_path', 'pattern', 'url', 'query', 'slug', 'skill',
  'description', 'subject', 'to', 'path', 'prompt', 'name',
]
export function toolSummary(name: string, input: Record<string, unknown>): string {
  if (name === 'AskUserQuestion') {
    const q = blocks(input.questions)[0]
    if (q && typeof q.question === 'string') return oneLine(q.question)
  }
  for (const k of SUMMARY_KEYS) {
    const v = input[k]
    if (typeof v === 'string' && v.trim()) return oneLine(v)
  }
  for (const v of Object.values(input)) if (typeof v === 'string' && v.trim()) return oneLine(v)
  return ''
}

function hunks(patch: unknown): DiffHunk[] {
  return blocks(patch).map((h) => ({
    oldStart: Number(h.oldStart) || 0,
    oldLines: Number(h.oldLines) || 0,
    newStart: Number(h.newStart) || 0,
    newLines: Number(h.newLines) || 0,
    lines: Array.isArray(h.lines) ? h.lines.filter((l): l is string => typeof l === 'string') : [],
  }))
}

/** What a finished tool call returned. `result` is its `tool_result` block, `rec` the record
 *  holding it (the structured `toolUseResult` and a denial live on the record). */
function outcome(result: Record<string, unknown>, rec: Rec, input: Record<string, unknown>, only: boolean): ToolOutcome {
  const { text } = flatten(result.content)
  const denial = str(rec.toolDenialKind)
  if (denial) {
    const said = /the user said:\s*([\s\S]*)$/.exec(text)?.[1].trim()
    return { kind: 'denied', reason: denial, feedback: said ? said : null }
  }
  // A record carrying several results (older transcripts) cannot say whose `toolUseResult` it is.
  const tur = only ? obj(rec.toolUseResult) : null
  if (tur && Array.isArray(tur.structuredPatch)) {
    const created = tur.type === 'create'
    let hs = hunks(tur.structuredPatch)
    // A Write that created its file has no patch, only the content.
    if (created && hs.length === 0 && typeof tur.content === 'string') {
      const lines = tur.content.replace(/\n$/, '').split('\n')
      hs = [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: lines.length, lines: lines.map((l) => '+' + l) }]
    }
    return { kind: 'diff', filePath: str(tur.filePath) ?? str(input.file_path) ?? '', created, hunks: hs }
  }
  if (tur && typeof tur.stdout === 'string') {
    return { kind: 'bash', stdout: tur.stdout, stderr: str(tur.stderr) ?? '', interrupted: tur.interrupted === true }
  }
  const answers = tur && obj(tur.answers)
  if (answers) {
    const out: Record<string, string> = {}
    for (const [q, a] of Object.entries(answers)) out[q] = Array.isArray(a) ? a.join(', ') : String(a)
    return { kind: 'answers', answers: out }
  }
  if (result.is_error === true) return { kind: 'error', text }
  return { kind: 'text', text }
}

/** A subagent's report out of its result, or `null` for a launch (an async agent reports
 *  later, through a task notification). */
function agentReport(result: Record<string, unknown>, rec: Rec, only: boolean): string | null {
  const tur = only ? obj(rec.toolUseResult) : null
  if (tur?.status === 'async_launched') return null
  if (tur && typeof tur.result === 'string') return tur.result
  const text = flatten(tur && Array.isArray(tur.content) ? tur.content : result.content).text
  return text.trim() ? text : null
}

/** Cheap stable hash, for an id when a record has no uuid. */
function hash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193)
  return (h >>> 0).toString(36)
}

function addRules(to: RuleChip[], slugs: Iterable<string>, channel: RuleChannel) {
  for (const slug of slugs) if (!to.some((r) => r.slug === slug && r.channel === channel)) to.push({ slug, channel })
}

/** The contexts a hook attachment carries, one string each. */
const contexts = (a: Record<string, unknown>): string[] =>
  Array.isArray(a.content) ? a.content.filter((c): c is string => typeof c === 'string') : typeof a.content === 'string' ? [a.content] : []

/** The SessionStart block's briefing body and learned slugs. */
function sessionBlock(text: string): { briefing: string | null; learned: string[]; mentioned: string[] } {
  let briefing: string | null = null
  const open = text.indexOf('[last-briefing')
  const close = text.indexOf('[/last-briefing]')
  if (open >= 0 && close > open) {
    // The body starts on the line after `[last-briefing session=… date=…]`.
    const eol = text.indexOf('\n', open)
    const body = text.slice(eol >= 0 && eol < close ? eol + 1 : open + '[last-briefing'.length, close).trim()
    briefing = body || null
  }
  const learned: string[] = []
  const at = text.indexOf('[mnemo learned since your last session]')
  if (at >= 0) {
    const end = text.indexOf('[/mnemo learned]', at)
    const block = text.slice(at, end >= 0 ? end : undefined)
    for (const m of block.matchAll(/^• (\S+) —/gm)) learned.push(m[1])
  }
  const mentioned = briefing ? [...briefing.matchAll(SLUG)].map((m) => m[1]) : []
  return { briefing, learned, mentioned }
}

/** The conversation `records` (in file order) describe. Pure: the same records always give the
 *  same cards, with the same ids. */
export function deriveConversation(records: TranscriptRecord[]): Conversation {
  const cards: Card[] = []
  const ids = new Set<string>()
  let sessionId: string | null = null
  let title: string | null = null
  /** A title the user set (`/rename`) beats the one Claude Code generated. */
  let customTitle: string | null = null
  const prs: PrLink[] = []

  const tools = new Map<string, ToolCard | AgentCard>()
  /** Cards a prompt-answering hook can belong to, by record uuid. */
  const prompts = new Map<string, Card>()
  let lastPrompt: Card | null = null
  const parents = new Map<string, string>()
  /** Enrichment that arrived before its tool call. */
  const early = new Map<string, string[]>()
  /** Source of the latest `SessionStart:<source>` hook, for the block that follows it. */
  let startSource = 'startup'

  const push = (card: Card) => {
    let id = card.id
    for (let n = 2; ids.has(id); n++) id = `${card.id}#${n}`
    card.id = id
    ids.add(id)
    cards.push(card)
    return card
  }
  const recordId = (r: Rec) => (typeof r.uuid === 'string' && r.uuid ? r.uuid : `${r.type}@${str(r.timestamp) ?? hash(JSON.stringify(r))}`)
  const prompt = (r: Rec, card: Card) => {
    push(card)
    if (typeof r.uuid === 'string') prompts.set(r.uuid, card)
    lastPrompt = card
  }

  /** A task notification: a thin line, and the report of the async agent it is about. */
  const notification = (r: Rec, text: string) => {
    const toolUseId = tag(text, 'tool-use-id')?.trim()
    const result = tag(text, 'result')
    const agent = toolUseId ? tools.get(toolUseId) : undefined
    if (agent?.kind === 'agent' && result !== null && result.trim()) agent.report = result.trim()
    const summary = tag(text, 'summary') ?? tag(text, 'status') ?? text.replace(/<[^>]+>/g, ' ')
    prompt(r, { kind: 'notification', id: recordId(r), at: str(r.timestamp) ?? '', text: summary.replace(/\s+/g, ' ').trim() })
  }

  const peer = (r: Rec, origin: Record<string, unknown>, fallback: string) => {
    const body = str(origin.body) ?? fallback.replace(/<\/?[a-z][\w-]*(\s[^>]*)?>/g, '').trim()
    prompt(r, { kind: 'peer', id: recordId(r), at: str(r.timestamp) ?? '', from: str(origin.from) ?? 'another session', text: body })
  }

  const userRecord = (r: Rec) => {
    const message = obj(r.message)
    const content = message?.content
    const origin = obj(r.origin)
    const kind = str(origin?.kind)
    const at = str(r.timestamp) ?? ''

    const results = blocks(content).filter((b) => b.type === 'tool_result')
    if (results.length) {
      const only = results.length === 1
      for (const res of results) {
        const card = tools.get(str(res.tool_use_id) ?? '')
        if (!card) continue
        if (card.kind === 'agent') {
          if (r.toolDenialKind || res.is_error === true) card.report = flatten(res.content).text || null
          else card.report = agentReport(res, r, only)
        } else {
          card.outcome = outcome(res, r, card.input, only)
          card.images = flatten(res.content).images
        }
      }
      return
    }

    const { text, images } = flatten(content)
    if (kind === 'peer' && origin) return peer(r, origin, text)
    if (kind === 'task-notification') return notification(r, text)
    if (r.isMeta === true) return
    if (r.isCompactSummary === true) return prompt(r, { kind: 'notification', id: recordId(r), at, text: 'conversation compacted' })
    if (HIDDEN_PROMPT.test(text)) return
    const interrupted = /^\s*\[(Request interrupted by user[^\]]*)\]\s*$/.exec(text)
    if (interrupted) return prompt(r, { kind: 'notification', id: recordId(r), at, text: interrupted[1] })
    if (/^\s*<command-(name|message|args)>/.test(text)) {
      const name = tag(text, 'command-name')
      if (name !== null) return prompt(r, { kind: 'command', id: recordId(r), at, name: name.trim(), args: (tag(text, 'command-args') ?? '').trim() })
    }
    const bash = /^\s*<bash-input>([\s\S]*?)<\/bash-input>/.exec(text)
    if (bash) return prompt(r, { kind: 'command', id: recordId(r), at, name: '!', args: bash[1].trim() })
    if (!text.trim() && !images.length) return
    prompt(r, { kind: 'user', id: recordId(r), at, text, images, rules: [], queued: false })
  }

  const assistantRecord = (r: Rec) => {
    const content = obj(r.message)?.content
    const at = str(r.timestamp) ?? ''
    if (typeof content === 'string') {
      if (content.trim()) push({ kind: 'assistant', id: recordId(r), at, text: content })
      return
    }
    const texts: string[] = []
    const flush = () => {
      const text = texts.join('\n\n')
      texts.length = 0
      if (text.trim()) push({ kind: 'assistant', id: recordId(r), at, text })
    }
    for (const b of blocks(content)) {
      if (b.type === 'text' && typeof b.text === 'string') texts.push(b.text)
      if (b.type !== 'tool_use') continue
      flush()
      const toolUseId = str(b.id) ?? ''
      const name = str(b.name) ?? ''
      const input = obj(b.input) ?? {}
      if (name === 'Agent' || name === 'Task') {
        const card = push({
          kind: 'agent', id: toolUseId || recordId(r), at, toolUseId,
          description: str(input.description) ?? '', agentType: str(input.subagent_type), report: null,
        }) as AgentCard
        if (toolUseId) tools.set(toolUseId, card)
        continue
      }
      const rules: RuleChip[] = []
      addRules(rules, early.get(toolUseId) ?? [], 'enrichment')
      early.delete(toolUseId)
      if (name === 'mcp__mnemo__read_mnemo_rule' && typeof input.slug === 'string') addRules(rules, [input.slug], 'mcp')
      const card = push({
        kind: 'tool', id: toolUseId || recordId(r), at, toolUseId, name,
        summary: toolSummary(name, input), input, outcome: null, images: [], rules,
      }) as ToolCard
      if (toolUseId) tools.set(toolUseId, card)
    }
    flush()
  }

  /** The user card a UserPromptSubmit hook answered: up the `parentUuid` chain to the first
   *  prompt, or the latest prompt when the chain does not reach one. */
  const answered = (r: Rec): Card | null => {
    let at = str(r.parentUuid)
    for (let i = 0; at && i < 200; i++) {
      const card = prompts.get(at)
      if (card) return card
      at = parents.get(at) ?? null
    }
    return lastPrompt
  }

  const attachmentRecord = (r: Rec) => {
    const a = obj(r.attachment)
    if (!a) return
    const at = str(r.timestamp) ?? ''
    if (a.type === 'queued_command') {
      const origin = obj(a.origin)
      const { text, images } = flatten(a.prompt)
      if (a.commandMode === 'task-notification' || origin?.kind === 'task-notification') return notification(r, text)
      if (origin?.kind === 'peer') return peer(r, origin, text)
      return prompt(r, { kind: 'user', id: recordId(r), at, text, images, rules: [], queued: true })
    }
    const hookName = str(a.hookName) ?? ''
    if (hookName.startsWith('SessionStart:')) startSource = hookName.slice('SessionStart:'.length) || 'startup'
    if (a.type !== 'hook_additional_context') return
    const texts = contexts(a)
    if (a.hookEvent === 'UserPromptSubmit') {
      const slugs = texts.flatMap((t) => {
        const i = t.indexOf(REFLEX)
        return i < 0 ? [] : [...t.slice(i).matchAll(SLUG)].map((m) => m[1])
      })
      const card = slugs.length ? answered(r) : null
      if (card?.kind === 'user') addRules(card.rules, slugs, 'reflex')
    } else if (a.hookEvent === 'PreToolUse') {
      const slugs = texts.flatMap((t) => [...t.matchAll(ENRICHMENT)].map((m) => m[1]))
      const toolUseId = str(a.toolUseID) ?? ''
      if (!slugs.length || !toolUseId) return
      const card = tools.get(toolUseId)
      if (card?.kind === 'tool') addRules(card.rules, slugs, 'enrichment')
      else if (!card) early.set(toolUseId, [...(early.get(toolUseId) ?? []), ...slugs])
    } else if (a.hookEvent === 'SessionStart') {
      const text = texts.filter((t) => MNEMO_SESSION.test(t)).join('\n')
      if (!text) return
      const { briefing, learned, mentioned } = sessionBlock(text)
      const rules: RuleChip[] = []
      addRules(rules, mentioned, 'briefing')
      addRules(rules, learned, 'learned')
      push({ kind: 'session', id: recordId(r), at, source: startSource, briefing, rules })
    }
  }

  for (const rec of records) {
    const r = rec as Rec
    if (sessionId === null && typeof r.sessionId === 'string') sessionId = r.sessionId
    if (typeof r.uuid === 'string' && typeof r.parentUuid === 'string') parents.set(r.uuid, r.parentUuid)
    // A subagent's own records, from transcripts older than `subagents/`.
    if (r.isSidechain === true) continue
    switch (r.type) {
      case 'user':
        userRecord(r)
        break
      case 'assistant':
        assistantRecord(r)
        break
      case 'attachment':
        attachmentRecord(r)
        break
      case 'ai-title':
        if (typeof r.aiTitle === 'string' && r.aiTitle.trim()) title = r.aiTitle
        break
      case 'custom-title':
        if (typeof r.customTitle === 'string' && r.customTitle.trim()) customTitle = r.customTitle
        break
      case 'pr-link': {
        const number = Number(r.prNumber)
        if (Number.isInteger(number) && number > 0 && !prs.some((p) => p.number === number)) {
          prs.push({ number, url: str(r.prUrl) ?? '' })
        }
        break
      }
      default: {
        if (HIDDEN.has(r.type) || r.type.startsWith('file-history-')) break
        const last = cards[cards.length - 1]
        if (last?.kind === 'unknown' && last.type === r.type) break
        push({ kind: 'unknown', id: recordId(r), at: str(r.timestamp) ?? '', type: r.type })
      }
    }
  }
  return { sessionId, title: customTitle ?? title, prs, cards }
}

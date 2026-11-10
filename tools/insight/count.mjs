// A transcript counted the plain way: every line parsed whole, every API message kept in a Map,
// nothing carried over from an earlier read. It is the second opinion `check.mjs` holds the
// core's incremental reader (src-tauri/src/insight/) against, so it shares no code with it and
// is written from the transcript's shapes, not from the Rust.

const ZERO = () => ({ input: 0, output: 0, cacheRead: 0, cacheCreation: 0, thinking: 0 })
const whole = v => (Number.isInteger(v) && v >= 0 ? v : 0)

export function add(total, row) {
  for (const k of Object.keys(total)) total[k] += row[k]
  return total
}

function usageRow(usage) {
  const u = usage && typeof usage === 'object' ? usage : {}
  return {
    input: whole(u.input_tokens),
    output: whole(u.output_tokens),
    cacheRead: whole(u.cache_read_input_tokens),
    cacheCreation: whole(u.cache_creation_input_tokens),
    thinking: whole(u.output_tokens_details?.thinking_tokens),
  }
}

/** A real model's API message on this line, as `[id, row, model]`; Claude Code's own
 *  `<synthetic>` messages are no call. */
function apiMessage(r) {
  const m = r.message
  if (r.type !== 'assistant' || !m || typeof m !== 'object') return null
  if (typeof m.model !== 'string' || !m.model.startsWith('claude')) return null
  const id = typeof m.id === 'string' ? m.id : typeof r.uuid === 'string' ? r.uuid : null
  return [id, usageRow(m.usage), m.model]
}

const TOOL_KINDS = {
  Read: 'read', Grep: 'search-code', Glob: 'search-code', LS: 'search-code',
  Edit: 'edit', NotebookEdit: 'edit', MultiEdit: 'edit', Write: 'write',
  Bash: 'shell', PowerShell: 'shell', Monitor: 'shell', BashOutput: 'shell', KillShell: 'shell',
  WebSearch: 'web-search', WebFetch: 'web-fetch', Artifact: 'artifact',
  Agent: 'agent', Task: 'agent', Workflow: 'agent', SendMessage: 'message', Skill: 'skill', AskUserQuestion: 'ask',
}
const META = new Set(['ToolSearch', 'TaskStop', 'TaskCreate', 'TaskGet', 'TaskList', 'TaskUpdate', 'TaskOutput', 'TodoWrite',
  'EnterPlanMode', 'ExitPlanMode', 'EnterWorktree', 'ExitWorktree', 'ListAgents', 'CronCreate', 'CronDelete', 'CronList', 'ScheduleWakeup'])
const BROWSERS = ['mcp__claude-in-chrome__', 'mcp__Claude_Browser__', 'mcp__remote-devices__Claude_Browser__']

export function kindOf(name) {
  if (Object.hasOwn(TOOL_KINDS, name)) return TOOL_KINDS[name]
  if (META.has(name)) return 'meta'
  if (name.startsWith('mcp__mnemo__')) return 'memory'
  if (BROWSERS.some(p => name.startsWith(p))) return 'browser'
  if (name.startsWith('mcp__desktop__') && /browser|snapshot/.test(name.slice('mcp__desktop__'.length))) return 'browser'
  return name.startsWith('mcp__') ? 'mcp' : 'other'
}

const WRAPPERS = ['<command-name>', '<command-message>', '<command-args>', '<bash-input>', '<bash-stdout>', '<bash-stderr>', '<local-command-']

/** Whether a user record is a prompt a person typed. */
export function isTyped(r, text) {
  if (r.isMeta === true || r.isCompactSummary === true || r.isSidechain === true) return false
  const kind = r.origin && typeof r.origin === 'object' ? r.origin.kind : undefined
  if (typeof kind === 'string' && kind !== 'human') return false
  let t = text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
  const open = t.indexOf('<system-reminder>')
  if (open !== -1) t = t.slice(0, open)
  t = t.trim()
  if (!t || WRAPPERS.some(w => t.startsWith(w)) || t.startsWith('[Request interrupted')) return false
  return kind === 'human' || !(t.startsWith('<') || t.startsWith('Caveat:'))
}

const oneLine = (s, n) => {
  const chars = Array.from(s.split(/\s+/).filter(Boolean).join(' '))
  return chars.length <= n ? chars.join('') : chars.slice(0, n - 1).join('') + '…'
}

function* records(lines) {
  for (const line of lines) {
    let r
    try {
      r = JSON.parse(line)
    } catch {
      continue
    }
    if (r && typeof r === 'object' && !Array.isArray(r)) yield r
  }
}

/** Everything `check.mjs` compares, counted from a session's own transcript. */
export function countTranscript(lines) {
  const messages = new Map() // id → { row, side, model }; the last record of a message wins
  let anonymous = 0
  let context = null, peak = 0, beta1m = false, model1m = false
  let sinceBoundary = null // the last main call's size since the last compaction
  const compactions = [], measured = []
  const tools = new Map() // tool_use id → name
  const activityCounts = {}
  let activityTotal = 0, turns = 0, turnMs = 0, shots = 0
  let aiTitle = null, customTitle = null, startedAt = null, lastAt = null, costUsd = null
  const prs = []

  for (const r of records(lines)) {
    // A request's own record is not an event of the session.
    if (r.type === 'api-request-blob' || r.type === 'api-request-shape') continue
    const at = typeof r.timestamp === 'string' ? Date.parse(r.timestamp) : NaN
    if (!Number.isNaN(at)) {
      startedAt ??= at
      lastAt = lastAt === null ? at : Math.max(lastAt, at)
    }
    const side = r.isSidechain === true
    const content = r.message && typeof r.message === 'object' ? r.message.content : undefined
    const blocks = Array.isArray(content) ? content.filter(b => b && typeof b === 'object') : []

    if (r.type === 'assistant') {
      const call = apiMessage(r)
      if (call) {
        const [id, row, model] = call
        messages.set(id ?? `\0${++anonymous}`, { row, side, model })
        if (!side) {
          const size = row.input + row.cacheRead + row.cacheCreation + row.output
          context = sinceBoundary = size
          peak = Math.max(peak, size)
          if (typeof r.requestedModel === 'string') model1m = r.requestedModel.endsWith('[1m]')
        }
      }
      if (side || Number.isNaN(at)) continue
      for (const b of blocks) {
        if (b.type !== 'tool_use') continue
        const name = typeof b.name === 'string' ? b.name : ''
        activityTotal += 1
        activityCounts[kindOf(name)] = (activityCounts[kindOf(name)] ?? 0) + 1
        if (typeof b.id === 'string') tools.set(b.id, name)
      }
    } else if (r.type === 'user' && !side) {
      const results = blocks.filter(b => b.type === 'tool_result')
      for (const b of results) {
        const name = tools.get(b.tool_use_id)
        if (name === undefined) continue
        tools.delete(b.tool_use_id)
        if (kindOf(name) !== 'browser' || !Array.isArray(b.content)) continue
        shots += b.content.filter(p => p?.type === 'image' && p.source?.type === 'base64' && p.source.data !== undefined && p.source.data !== null).length
      }
      if (results.length || !r.message || typeof r.message !== 'object') continue
      const text = typeof content === 'string' ? content : blocks.filter(b => b.type === 'text' && typeof b.text === 'string').map(b => b.text).join('\n')
      if (isTyped(r, text)) turns += 1
    } else if (r.type === 'system' && !side) {
      if (r.subtype === 'turn_duration' && typeof r.durationMs === 'number' && r.durationMs >= 0) turnMs += Math.round(r.durationMs)
      if (r.subtype === 'compact_boundary') {
        const meta = r.compactMetadata && typeof r.compactMetadata === 'object' ? r.compactMetadata : {}
        const [pre, post] = [whole(meta.preTokens), whole(meta.postTokens)]
        compactions.push({ pre, post })
        if (sinceBoundary !== null && pre > 0) measured.push([pre, sinceBoundary])
        sinceBoundary = null
        peak = Math.max(peak, pre)
        if (post > 0) context = post
      }
    } else if (r.type === 'ai-title' && typeof r.aiTitle === 'string') {
      aiTitle = oneLine(r.aiTitle, 200) || aiTitle
    } else if (r.type === 'custom-title' && typeof r.customTitle === 'string') {
      customTitle = oneLine(r.customTitle, 200) || customTitle
    } else if (r.type === 'pr-link' && typeof r.prUrl === 'string' && r.prUrl) {
      if (!prs.includes(r.prUrl)) prs.push(r.prUrl)
    } else if (r.type === 'cost-state' && typeof r.totalCostUSD === 'number') {
      costUsd = r.totalCostUSD
    } else if (r.type === 'api-request' && (r.querySource === 'repl_main_thread' || r.querySource === 'sdk')) {
      const betas = r.params && typeof r.params === 'object' && Array.isArray(r.params.betas) ? r.params.betas : []
      beta1m = betas.some(b => typeof b === 'string' && b.includes('context-1m'))
    }
  }

  const [main, sidechain, byModel] = [ZERO(), ZERO(), {}]
  const count = { main: 0, sidechain: 0 }
  for (const { row, side, model } of messages.values()) {
    add(side ? sidechain : main, row)
    add((byModel[model] ??= ZERO()), row)
    count[side ? 'sidechain' : 'main'] += 1
  }
  return {
    ids: new Set(messages.keys()),
    main, sidechain, byModel,
    messages: count,
    context,
    window: beta1m || model1m || peak > 200_000 ? 1_000_000 : 200_000,
    compactions, measured,
    activityTotal, activityCounts,
    turns, turnMs, shots,
    title: customTitle ?? aiTitle,
    startedAt, lastAt, prs, costUsd,
  }
}

/** A sub-agent transcript's API messages: id → its last record's row. */
export function countSubagent(lines) {
  const rows = new Map()
  for (const r of records(lines)) {
    const call = apiMessage(r)
    if (call && call[0] !== null) rows.set(call[0], call[1])
  }
  return rows
}

/** One row per sub-agent, in the order given. A message the session's own transcript holds, or
 *  an earlier sub-agent's, is that same message: it is counted there. */
export function subagentRows(subagents, sessionIds) {
  const seen = new Set()
  return subagents.map(({ id, rows }) => {
    const row = { id, calls: 0, tokens: ZERO() }
    for (const [key, tokens] of rows) {
      if (sessionIds.has(key) || seen.has(key)) continue
      seen.add(key)
      row.calls += 1
      add(row.tokens, tokens)
    }
    return row
  })
}

function same(a, b) {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const [ka, kb] = [Object.keys(a), Object.keys(b)]
  return ka.length === kb.length && ka.every(k => Object.hasOwn(b, k) && same(a[k], b[k]))
}

/** The newest screenshots, compactions and pull requests the core keeps of each. */
const KEPT = 100

/** Where the core's reading of one transcript (`core`: a row of the probe's dump) and this
 *  file's count of the same bytes (`mine`, with `subagents` from `subagentRows`) differ. */
export function compare(core, mine, subagents) {
  const i = core.insight
  const own = add(add(ZERO(), mine.main), mine.sidechain)
  for (const s of subagents) add(own, s.tokens)
  const pairs = [
    ['tokens.main', i.tokens.main, mine.main],
    ['tokens.sidechain', i.tokens.sidechain, mine.sidechain],
    ['tokens.byModel', i.tokens.byModel, mine.byModel],
    ['tokens.subagents', i.tokens.subagents.map(s => ({ id: s.id, calls: s.calls, tokens: s.tokens })), subagents],
    ['tokens.own', i.tokens.own, own],
    ['messages', core.messages, mine.messages],
    ['context.tokens', i.context.tokens, mine.context],
    ['context.window', i.context.window, mine.window],
    ['context.compactions', i.context.compactions.map(c => ({ pre: c.pre, post: c.post })), mine.compactions.slice(-KEPT)],
    ['context at compactions', core.measured, mine.measured],
    ['activityTotal', i.activityTotal, mine.activityTotal],
    ['activityCounts', i.activityCounts, mine.activityCounts],
    ['turns', i.turns, mine.turns],
    ['turnMs', i.turnMs, mine.turnMs],
    ['web.shots', i.web.shots.length, Math.min(mine.shots, KEPT)],
    ['screenshots read back', core.shotsRead, i.web.shots.length],
    ['title', i.title, mine.title],
    ['startedAt', i.startedAt, mine.startedAt],
    ['lastAt', i.lastAt, mine.lastAt],
    ['prs', i.prs.map(p => p.url), mine.prs.slice(-KEPT)],
    ['cost.usd', i.cost?.usd ?? null, mine.costUsd],
  ]
  return pairs.filter(([, a, b]) => !same(a, b)).map(([field, a, b]) => ({ field, core: a, check: b }))
}

/** How far the context the core reports was from the size Claude Code stated at each
 *  compaction: `pairs` are `[preTokens, the last main call's size]`. */
export function contextError(pairs) {
  if (!pairs.length) return null
  const errors = pairs.map(([pre, said]) => said / pre - 1).sort((a, b) => a - b)
  const mid = errors.length >> 1
  return {
    compactions: pairs.length,
    smallest: Math.min(...pairs.map(p => p[0])),
    largest: Math.max(...pairs.map(p => p[0])),
    median: errors.length % 2 ? errors[mid] : (errors[mid - 1] + errors[mid]) / 2,
    worst: Math.max(...errors.map(Math.abs)),
  }
}

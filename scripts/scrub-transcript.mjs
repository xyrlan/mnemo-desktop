#!/usr/bin/env node
/** Scrub a Claude Code transcript so it can be committed as a parser fixture (round 20).
 *
 *    node scripts/scrub-transcript.mjs [--clip <n>] <in.jsonl> > <out.jsonl>
 *
 *  The repo is public and transcripts hold secrets (vault rules reach them through injection)
 *  and base64 screenshots. What survives is what the parser reads for structure: every key,
 *  record type and subtype, id, timestamp, tool name, `hookName`/`hookEvent`,
 *  `toolDenialKind`, `origin.kind`, numbers and booleans (so `structuredPatch` keeps its
 *  shape), the tags the parser reads (`<command-name>`, `<task-notification>`…) and
 *  Claude Code's own command names, and mnemo's envelopes (`mnemo://v1`,
 *  `mnemo reflex context:`, `• mnemo rule [[`…) so rule chips still parse. Every other string
 *  becomes lorem of the same length and punctuation, whatever its case (a class name, another
 *  plugin's tag), slugs become fake ones, and every base64
 *  image becomes one tiny valid PNG. A line that is not JSON is dropped. `--clip <n>` also
 *  cuts every run of lorem to a few lines of n characters (tags and phrases stay), which
 *  keeps a committed fixture small: its lorem carries no meaning past its shape.
 *
 *  Pure except for `main`: `scrubLines` is what the test runs. */

/** A 1×1 transparent PNG. */
export const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

/** Keys whose string values are structure, not content. A value is still scrubbed if it does
 *  not look like structure (too long, spaces, a path). Inside a tool's `input` and below the
 *  top of a `toolUseResult` the same keys hold the tool's own data, so there they are
 *  scrubbed too (bar `subagent_type`, the agent card's label). */
export const KEEP = new Set([
  'type', 'subtype', 'uuid', 'parentUuid', 'logicalParentUuid', 'sessionId', 'session_id',
  'timestamp', 'id', 'tool_use_id', 'toolUseID', 'sourceToolAssistantUUID', 'promptId',
  'requestId', 'source_uuid', 'agentId', 'messageId', 'leafUuid', 'hookName', 'hookEvent',
  'toolDenialKind', 'kind', 'role', 'stop_reason', 'media_type', 'userType', 'entrypoint',
  'version', 'level', 'operation', 'permissionMode', 'promptSource', 'turnOrigin',
  'commandMode', 'model', 'subagent_type', 'status', 'source', 'isMeta', 'mode', 'sessionKind',
])
const STRUCTURAL = /^[\w.:-]{0,80}$/
const MEDIA_TYPE = /^[\w.+-]{1,40}\/[\w.+-]{1,40}$/

/** Boilerplate the parser reads as markers; kept verbatim wherever it appears. */
export const PHRASES = [
  'mnemo://v1',
  'mnemo reflex context:',
  '• mnemo rule ',
  '[last-briefing',
  '[/last-briefing]',
  '[mnemo learned since your last session]',
  '[/mnemo learned]',
  'the user said:',
  '[Request interrupted by user',
]
const MNEMO = /mnemo:\/\/v1|mnemo reflex context:|• mnemo rule \[\[|\[last-briefing|\[mnemo learned since/

const CLIP_LINES = 8

const LOREM = 'loremipsumdolorsitametconsecteturadipiscingelitseddoeiusmodtemporincididunt'

/** Same length, same punctuation and whitespace; every letter or digit run becomes lorem, and
 *  a long run is broken with spaces so no scrubbed string reads as base64. Every run starts
 *  with `l`, so no secret prefix (`sk-`, `ghp_`) can be spelled by accident. */
export function lorem(s) {
  return s.replace(/[\p{L}\p{N}]+/gu, (run) => {
    let out = ''
    for (let i = 0; i < run.length; i++) out += i % 32 === 31 ? ' ' : LOREM[i % LOREM.length]
    return out
  })
}

/** Tags whose value is an id or a status, kept like the `KEEP` keys: a task notification
 *  names the tool call it reports on. */
const KEEP_TAGS = ['tool-use-id', 'task-id', 'status']

/** Tag names the parser reads (or Claude Code writes around them). Any other `<Tag>` is text:
 *  a component in an edited file, another plugin's `<EXTREMELY_IMPORTANT>`. */
export const TAGS = [
  'command-name', 'command-message', 'command-args', 'bash-input', 'bash-stdout', 'bash-stderr',
  'local-command-stdout', 'local-command-stderr', 'local-command-caveat', 'task-notification',
  'task-id', 'tool-use-id', 'output-file', 'status', 'summary', 'result', 'note', 'usage', 'event',
  'task-type', 'system-reminder',
]

/** Claude Code's own slash commands; any other `<command-name>` (a skill, a project command)
 *  is lorem like the rest. */
export const COMMANDS = [
  'add-dir', 'agents', 'bashes', 'clear', 'compact', 'config', 'context', 'cost', 'doctor',
  'effort', 'exit', 'export', 'fast', 'help', 'hooks', 'ide', 'init', 'login', 'logout', 'loop',
  'mcp', 'memory', 'model', 'permissions', 'plugin', 'plugins', 'release-notes', 'resume',
  'review', 'rewind', 'status', 'statusline', 'theme', 'todos', 'usage', 'vim',
]

/** A string with the tags and phrases in it kept and the text between them lorem'd. With
 *  `clip`, each run of lorem keeps its first `CLIP_LINES` lines, each cut past `clip`
 *  characters. */
function text(s, fake, clip) {
  const mnemo = MNEMO.test(s)
  const parts = []
  const gap = (t) => {
    const lines = lorem(t).split('\n')
    if (!clip) return lines.join('\n')
    const kept = lines.slice(0, CLIP_LINES).map((l) => (l.length > clip ? l.slice(0, clip) + '…' : l))
    return kept.join('\n') + (lines.length > CLIP_LINES ? '…\n' : '')
  }
  // Tags (`<command-name>`), the boilerplate phrases, and in mnemo text its slugs.
  const pieces = [
    ...KEEP_TAGS.map((t) => `<${t}>[\\w.:-]{0,80}</${t}>`),
    `</?(?:${TAGS.join('|')})>`,
    // The briefing's header line, whole, so a clip never cuts the `]` that ends it.
    '\\[last-briefing[^\\]\\n]*\\]',
    ...PHRASES.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    ...(mnemo ? ['\\[\\[[^\\]\\s]+\\]\\]', '(?<=^|\\n)• [^\\s\\[]+(?= —)'] : []),
  ]
  const re = new RegExp(pieces.join('|'), 'g')
  let at = 0
  for (const m of s.matchAll(re)) {
    parts.push(gap(s.slice(at, m.index)))
    const t = m[0]
    if (t.startsWith('[last-briefing')) parts.push(`[last-briefing${lorem(t.slice('[last-briefing'.length, -1))}]`)
    else if (t.startsWith('[[') && t.endsWith(']]')) parts.push(`[[${fake(t.slice(2, -2))}]]`)
    else if (t.startsWith('• ') && !PHRASES.includes(t)) parts.push(`• ${fake(t.slice(2))}`)
    else parts.push(t)
    at = m.index + t.length
  }
  parts.push(gap(s.slice(at)))
  return parts.join('')
}

/** Keep the real `<command-name>` values of `s` in its scrubbed form `out` when they are
 *  Claude Code's own commands (`/clear`, `/model`): those are structure, not content. */
function keepCommandNames(s, out) {
  const names = [...s.matchAll(/<command-name>([^<]*)<\/command-name>/g)].map((m) => m[1])
  let i = 0
  return out.replace(/<command-name>[^<]*<\/command-name>/g, (all) => {
    const name = names[i++]
    return name !== undefined && COMMANDS.includes(name.replace(/^\//, '')) ? `<command-name>${name}</command-name>` : all
  })
}

function scrubString(s, key, parent, o, data) {
  if (key === 'slug') return o.fake(s)
  if (key === 'name' && parent && parent.type === 'tool_use' && STRUCTURAL.test(s)) return s
  if (key === 'media_type' && MEDIA_TYPE.test(s)) return s
  const kept = data ? key === 'subagent_type' : KEEP.has(key)
  if (kept && STRUCTURAL.test(s)) return s
  return keepCommandNames(s, text(s, o.fake, o.clip))
}

/** `data`: inside a tool's own data (its `input`, or below the top of its `toolUseResult`),
 *  where no key is structure. */
function scrubValue(v, key, parent, o, data = false) {
  if (typeof v === 'string') return scrubString(v, key, parent, o, data)
  if (Array.isArray(v)) return v.map((x) => scrubValue(x, key, parent, o, data))
  if (v === null || typeof v !== 'object') return v
  // An inline image: one tiny PNG, whatever it was.
  if (v.type === 'base64' && typeof v.data === 'string') {
    return { ...Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrubValue(x, k, v, o, data)])), media_type: 'image/png', data: TINY_PNG }
  }
  const out = {}
  for (const [k, x] of Object.entries(v)) {
    // Keys are structure unless they read like text (AskUserQuestion's `answers` is keyed
    // by the question) or name a file (`trackedFileBackups` is keyed by path).
    const kk = /^[A-Za-z_$][\w$-]{0,63}$/.test(k) ? k : lorem(k)
    if (typeof x === 'string' && /^[A-Za-z0-9+/=\r\n]{200,}$/.test(x)) out[kk] = TINY_PNG
    else {
      const deeper = data || k === 'input' || (key === 'toolUseResult' && typeof x === 'object')
      out[kk] = scrubValue(x, k, v, o, deeper)
    }
  }
  return out
}

/** A `pr-link` names a repository, which may be private. */
function scrubRecord(r, o) {
  const out = scrubValue(r, '', null, o)
  if (r.type === 'pr-link') {
    if (typeof r.prNumber === 'number') out.prUrl = `https://github.com/example/repo/pull/${r.prNumber}`
    if ('prRepository' in r) out.prRepository = 'example/repo'
  }
  return out
}

/** Scrub transcript lines; slugs map to the same fake slug across all of them. */
export function scrubLines(lines, { clip = 0 } = {}) {
  const slugs = new Map()
  const fake = (slug) => {
    if (!slugs.has(slug)) slugs.set(slug, `fake-rule-${slugs.size + 1}`)
    return slugs.get(slug)
  }
  const out = []
  for (const line of lines) {
    if (!line.trim()) continue
    let r
    try {
      r = JSON.parse(line)
    } catch {
      continue
    }
    out.push(JSON.stringify(scrubRecord(r, { fake, clip })))
  }
  return out
}

async function main() {
  const args = process.argv.slice(2)
  const at = args.indexOf('--clip')
  const clip = at >= 0 ? Number(args.splice(at, 2)[1]) : 0
  const [file] = args
  if (!file || !(clip >= 0)) {
    process.stderr.write('usage: node scripts/scrub-transcript.mjs [--clip <n>] <in.jsonl> > <out.jsonl>\n')
    process.exit(2)
  }
  const fs = await import('node:fs')
  const lines = fs.readFileSync(file, 'utf8').split('\n')
  process.stdout.write(scrubLines(lines, { clip }).map((l) => l + '\n').join(''))
}

const url = await import('node:url').catch(() => null)
if (url && process.argv[1] && url.fileURLToPath(import.meta.url) === process.argv[1]) await main()

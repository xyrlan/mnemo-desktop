#!/usr/bin/env node
/** `node scripts/jarvis-bench.mjs [options]`: how well a local model routes a request spoken in
 *  Portuguese to Jarvis's tools (#504, step 1 of #503). Each request goes to a running
 *  `llama-server` (or one this script starts) with Jarvis's tool schema; the reply is scored on
 *  the right tool, the right arguments (the project above all), asking when it should, latency,
 *  and the GPU's peak memory while it ran.
 *
 *  A set is JSONL, one request per line:
 *    {"request": "o CI do mnemo passou?", "context": "...", "expect": {"tool": "gh_run_list", "project": "mnemo"}}
 *  `context` is what Jarvis would know besides the words (a running parent, the focused window).
 *  `expect.args` names other arguments to check. `"tool": "none"` expects a reply in words and no
 *  tool call (a greeting, "I'll pass you the tasks"). A line `{"projects": [{"name", "aliases"}]}`
 *  lists the projects Jarvis knows; without one they are the projects the set expects.
 *
 *  The repo's set is `scripts/jarvis-bench.jsonl` (public names only). The maintainer's real set
 *  lives at `~/mnemo/.mnemo/jarvis-bench.jsonl` and names private projects, so the report never
 *  prints a request or a project from a set: only scores. */

import { spawn, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const REPO_SET = join(dirname(fileURLToPath(import.meta.url)), 'jarvis-bench.jsonl')
export const REAL_SET = join(homedir(), 'mnemo', '.mnemo', 'jarvis-bench.jsonl')

/** What the maintainer calls the assistant out loud; "Jarvis" is only the project's name. */
export const NAME = 'James'

/** `expect.tool` for a request that wants a reply in words and no tool call. */
export const NO_TOOL = 'none'

/** A set's name in the report: only the repo's own set is not `real`, which is never echoed. */
export const setName = (file) => (resolve(file) === REPO_SET ? 'repo (synthetic)' : 'real')

const project = (what = 'the project') => ({ type: 'string', description: `${what}: one of the known projects' names, exactly as listed` })
const fn = (name, description, properties, required = Object.keys(properties)) => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required } },
})

/** Step 2's (#505) closed set of read tools, plus following a running parent, handing a write to
 *  a parent, and asking. Never a shell. */
export const TOOLS = [
  fn('git_status', 'git status of a project.', { project: project() }),
  fn('git_log', 'Recent commits of a project.', { project: project(), limit: { type: 'integer' } }, ['project']),
  fn('git_diff', 'Uncommitted changes in a project, optionally of one path.', { project: project(), path: { type: 'string' } }, ['project']),
  fn('read_file', 'Read a file in a project.', { project: project(), path: { type: 'string' } }),
  fn('list_dir', 'List a folder in a project.', { project: project(), path: { type: 'string' } }, ['project']),
  fn('search', 'Search a project\'s files for text (ripgrep).', { project: project(), query: { type: 'string' } }),
  fn('read_briefings', 'Read the briefings of past work sessions in a project: what was done, decided, left open.', { project: project(), since: { type: 'string', description: 'e.g. "yesterday", "2026-10-01"' } }, ['project']),
  fn('query_rules', 'Look up the rules and conventions mnemo learned for a project.', { project: project(), query: { type: 'string' } }, ['query']),
  fn('list_sessions', 'List agent sessions (running and recent), optionally of one project.', { project: project() }, []),
  fn('gh_pr_list', 'Open pull requests of a project, or of every known project when none is named.', { project: project() }, []),
  fn('gh_pr_view', 'Show a pull request.', { project: project(), number: { type: 'integer' } }, ['project']),
  fn('gh_pr_checks', 'CI checks of a pull request.', { project: project(), number: { type: 'integer' } }, ['project']),
  fn('gh_run_list', 'Recent CI (GitHub Actions) runs of a project.', { project: project() }),
  fn('gh_issue_view', 'Show an issue.', { project: project(), number: { type: 'integer' } }),
  fn('parent_status', 'How a parent session already working on an earlier request is doing.', { project: project('the project the parent runs in') }),
  fn('delegate_to_parent', 'Hand a request that writes anything (code, commits, PRs, issues, messages, a follow-up instruction to a running parent) to a parent session in the project. Jarvis itself only reads.', { project: project(), request: { type: 'string', description: 'the request, verbatim' } }),
  fn('ask_user', 'Ask the user before acting: when the project cannot be told, or the request is destructive (delete, force-push, reset).', {
    question: { type: 'string' },
    reason: { type: 'string', enum: ['project_unknown', 'destructive', 'ambiguous'] },
    project: project('the project, when it is known'),
  }, ['question', 'reason']),
]

/** Jarvis's system prompt over the known `projects` and what it knows besides the words. */
export function systemPrompt(projects, context, reasoning = false) {
  const list = projects.map((p) => `- ${p.name}${p.aliases?.length ? ` (também: ${p.aliases.join(', ')})` : ''}`).join('\n')
  return [
    reasoning ? '' : '/no_think',
    `Você é o ${NAME}, um assistente de voz no desktop do usuário. O usuário fala em português.`,
    'Você só lê: git, arquivos, briefings, regras, sessões e o gh somente-leitura, pelas ferramentas.',
    'Tudo que escreve (código, commits, PRs, issues, apagar algo, instruções a um parent já rodando) vai para delegate_to_parent, com o pedido literal.',
    'Pergunte com ask_user, antes de qualquer outra ferramenta, quando o pedido precisar de um projeto e não der para saber qual, ou quando for destrutivo (apagar, force-push, reset).',
    'Pedidos que escrevem e não são destrutivos (corrigir, criar issue, abrir PR, mergear, despachar, subir release, escrever testes) vão direto para delegate_to_parent, sem pedir confirmação: o parent confirma o que precisar.',
    'Quando o Estado atual diz que um parent está rodando e o usuário pergunta como está ou se terminou, use parent_status nesse projeto.',
    'Quando houver o que ler, fazer ou perguntar, chame exatamente uma ferramenta. Quando não houver (um bom-dia, um aviso de que o usuário ainda vai passar as tarefas), responda só com uma frase curta, sem ferramenta.',
    '',
    'Projetos conhecidos:',
    list,
    '',
    `Estado atual: ${context || 'nenhum parent rodando, nenhuma janela em foco.'}`,
  ].filter((l, i) => i > 0 || l).join('\n')
}

/** The requests and known projects of a set's JSONL text. A line that is not a request (no
 *  `request` and `expect.tool`, or marked `example`) is skipped, unless it is the `projects` line. */
export function parseSet(text) {
  const requests = []
  let projects = null
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    let r
    try {
      r = JSON.parse(line)
    } catch {
      continue
    }
    if (Array.isArray(r?.projects)) projects = r.projects.map((p) => (typeof p === 'string' ? { name: p } : p))
    // A request marked `example` is a template for the file's format, not part of the set.
    else if (typeof r?.request === 'string' && typeof r.expect?.tool === 'string' && !r.example) requests.push(r)
  }
  if (!projects) projects = [...new Set(requests.map((r) => r.expect.project).filter(Boolean))].map((name) => ({ name }))
  return { requests, projects }
}

/** The body of the chat request for `row`. */
export function chatBody(row, projects, { reasoning = false, stream = true } = {}) {
  return {
    messages: [
      { role: 'system', content: systemPrompt(projects, row.context, reasoning) },
      { role: 'user', content: row.request },
    ],
    tools: TOOLS,
    tool_choice: 'auto',
    temperature: 0,
    max_tokens: reasoning ? 2048 : 384,
    stream,
    chat_template_kwargs: { enable_thinking: reasoning, thinking: reasoning },
  }
}

/** Folds an OpenAI-style stream of chat chunks (already JSON-parsed) into one reply message.
 *  Tool calls arrive in pieces keyed by `index`. */
export function foldChunks(chunks) {
  const msg = { content: '', reasoning_content: '', tool_calls: [] }
  for (const c of chunks) {
    const d = c?.choices?.[0]?.delta
    if (!d) continue
    if (d.content) msg.content += d.content
    if (d.reasoning_content) msg.reasoning_content += d.reasoning_content
    for (const t of d.tool_calls ?? []) {
      const i = t.index ?? msg.tool_calls.length
      const slot = (msg.tool_calls[i] ??= { function: { name: '', arguments: '' } })
      if (t.function?.name) slot.function.name += t.function.name
      if (t.function?.arguments) slot.function.arguments += t.function.arguments
    }
  }
  msg.tool_calls = msg.tool_calls.filter(Boolean)
  return msg
}

/** Whether a chunk is the model's first output: text, reasoning or a tool call. */
export const isOutput = (c) => {
  const d = c?.choices?.[0]?.delta
  return !!(d && (d.content || d.reasoning_content || d.tool_calls?.length))
}

const norm = (v) => String(v ?? '').trim().toLowerCase()

/** The first tool call of a reply `message`: `{tool, args}`, `tool` null when the model only wrote
 *  text, `args` null when they are not JSON. */
export function firstCall(message) {
  const call = message?.tool_calls?.[0]
  if (!call) return { tool: null, args: null }
  const raw = call.function?.arguments
  let args = null
  if (raw && typeof raw === 'object') args = raw
  else
    try {
      args = JSON.parse(raw || '{}')
    } catch {
      args = null
    }
  return { tool: call.function?.name ?? null, args }
}

/** The project named by `value`: its canonical name if `value` is one of `projects`' names or
 *  aliases, else `value` itself, normalized. */
export function canonicalProject(value, projects) {
  const v = norm(value)
  const p = projects.find((p) => norm(p.name) === v || (p.aliases ?? []).some((a) => norm(a) === v))
  return p ? norm(p.name) : v
}

/** Scores one reply `message` against `row.expect`:
 *  - `expected`: the tool the row expects (`NO_TOOL` for a reply in words);
 *  - `tool`: the first call is the expected tool, or there is none when `NO_TOOL` is expected;
 *  - `args`: the right tool, and the project (when expected) and every `expect.args` value match;
 *  - `project`: the call names the expected project, whichever tool it is (null when none is);
 *  - `shouldAsk`/`asked`: whether the row wants `ask_user`, and whether the model called it;
 *  - `textOnly`: the model only wrote text where a tool was due;
 *  - `reasoned`: the reply carried reasoning, which a reasoning-off run should not. */
export function score(row, message, projects) {
  const { tool, args } = firstCall(message)
  const e = row.expect
  const want = e.tool === NO_TOOL ? null : e.tool
  const toolOk = !!message && tool === want
  let argsOk = toolOk && (want === null || args !== null)
  if (argsOk && e.project) argsOk = canonicalProject(args.project, projects) === canonicalProject(e.project, projects)
  for (const [k, want] of Object.entries(e.args ?? {})) {
    if (!argsOk) break
    const got = args[k]
    argsOk = typeof want === 'string' ? norm(got).includes(norm(want)) : norm(got) === norm(want)
  }
  const projectOk = e.project ? canonicalProject(args?.project, projects) === canonicalProject(e.project, projects) : null
  const reasoned = !!message?.reasoning_content?.trim()
  return { expected: e.tool, tool, toolOk, argsOk, projectOk, shouldAsk: e.tool === 'ask_user', asked: tool === 'ask_user', textOnly: !!message && tool === null && want !== null, reasoned }
}

/** The `p`th percentile (0–1) of `xs`, nearest rank; null for none. */
export function percentile(xs, p) {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))]
}

/** One table row's figures from per-request `results` ({...score, ttftMs, totalMs, error}).
 *  `byTool` is, per expected tool, its rows and how many got the right arguments. */
export function summarize(results) {
  const n = results.length
  const ok = results.filter((r) => !r.error)
  const ask = results.filter((r) => r.shouldAsk)
  const noAsk = results.filter((r) => !r.shouldAsk)
  const ms = (k) => ok.map((r) => r[k]).filter((x) => typeof x === 'number')
  const byTool = {}
  for (const r of results.filter((r) => r.expected)) {
    const t = (byTool[r.expected] ??= { n: 0, args: 0 })
    t.n++
    if (r.argsOk) t.args++
  }
  return {
    n,
    errors: n - ok.length,
    tool: results.filter((r) => r.toolOk).length,
    args: results.filter((r) => r.argsOk).length,
    project: results.filter((r) => r.projectOk).length,
    withProject: results.filter((r) => r.projectOk !== null && r.projectOk !== undefined).length,
    asked: ask.filter((r) => r.asked).length,
    shouldAsk: ask.length,
    askedNeedlessly: noAsk.filter((r) => r.asked).length,
    textOnly: results.filter((r) => r.textOnly).length,
    reasoned: results.filter((r) => r.reasoned).length,
    ttft: { p50: percentile(ms('ttftMs'), 0.5), p95: percentile(ms('ttftMs'), 0.95) },
    total: { p50: percentile(ms('totalMs'), 0.5), p95: percentile(ms('totalMs'), 0.95) },
    byTool,
  }
}

const frac = (a, b) => (b ? `${a}/${b} (${Math.round((100 * a) / b)}%)` : '—')
const msCell = (p) => (p.p50 === null ? '—' : `${Math.round(p.p50)} / ${Math.round(p.p95)}`)

/** The Markdown table for `rows` of `{candidate, summary, vram}`; `vram` is `{peakMiB, deltaMiB}`
 *  or null. Names no request and no project. */
export function table(rows) {
  const out = [
    '| candidate | right tool | right arguments | right project | asked when it should | asked needlessly | text where a tool was due | TTFT p50 / p95 (ms) | total p50 / p95 (ms) | peak VRAM (MiB) |',
    '|---|---|---|---|---|---|---|---|---|---|',
  ]
  for (const { candidate, summary: s, vram } of rows) {
    const v = vram ? `${vram.peakMiB}${vram.deltaMiB !== null ? ` (+${vram.deltaMiB} over idle)` : ''}` : '—'
    const notes = (s.errors ? ` · ${s.errors} errors` : '') + (s.reasoned ? ` · reasoned on ${s.reasoned}` : '')
    out.push(`| ${candidate}${notes} | ${frac(s.tool, s.n)} | ${frac(s.args, s.n)} | ${frac(s.project, s.withProject)} | ${frac(s.asked, s.shouldAsk)} | ${s.askedNeedlessly} | ${s.textOnly} | ${msCell(s.ttft)} | ${msCell(s.total)} | ${v} |`)
  }
  return out.join('\n')
}

/** The Markdown table of a summary's `byTool`: right arguments per expected tool, the tools with
 *  the most rows first. Names tools only. */
export function toolTable(summary) {
  const out = ['| expected tool | right arguments |', '|---|---|']
  const tools = Object.entries(summary.byTool ?? {}).sort(([a, x], [b, y]) => y.n - x.n || a.localeCompare(b))
  for (const [tool, t] of tools) out.push(`| ${tool} | ${frac(t.args, t.n)} |`)
  return out.join('\n')
}

/** Splits an SSE body's text into its `data:` payloads, JSON-parsed, stopping at `[DONE]`. */
export function sseEvents(text) {
  const events = []
  for (const line of text.split('\n')) {
    const m = /^data:\s?(.*)$/.exec(line.trimEnd())
    if (!m) continue
    if (m[1] === '[DONE]') break
    try {
      events.push(JSON.parse(m[1]))
    } catch {
      // A keep-alive or a torn line.
    }
  }
  return events
}

/** Sends `row` to the server at `url` and times it: `{message, ttftMs, totalMs}`. */
export async function ask(url, row, projects, opts = {}) {
  const t0 = performance.now()
  const res = await fetch(`${url}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(chatBody(row, projects, opts)),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const chunks = []
  let ttftMs = null
  let buf = ''
  const dec = new TextDecoder()
  for await (const part of res.body) {
    buf += dec.decode(part, { stream: true })
    const cut = buf.lastIndexOf('\n')
    if (cut < 0) continue
    for (const c of sseEvents(buf.slice(0, cut + 1))) {
      if (ttftMs === null && isOutput(c)) ttftMs = performance.now() - t0
      chunks.push(c)
    }
    buf = buf.slice(cut + 1)
  }
  chunks.push(...sseEvents(buf))
  return { message: foldChunks(chunks), ttftMs, totalMs: performance.now() - t0 }
}

/** The GPU's used memory in MiB (the first GPU), or null without `nvidia-smi`. */
export function gpuUsedMiB() {
  try {
    const out = execFileSync('nvidia-smi', ['--query-gpu=memory.used', '--format=csv,noheader,nounits'], { encoding: 'utf8', timeout: 5000 })
    const v = Number(out.split('\n')[0].trim())
    return Number.isFinite(v) ? v : null
  } catch {
    return null
  }
}

/** Samples `gpuUsedMiB` every `everyMs` until `stop()`, which returns the peak. */
export function vramSampler(everyMs = 250, read = gpuUsedMiB) {
  let peak = read()
  const timer = setInterval(() => {
    const v = read()
    if (v !== null && (peak === null || v > peak)) peak = v
  }, everyMs)
  return { stop: () => (clearInterval(timer), peak) }
}

export function sha256(file) {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256')
    createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject)
  })
}

async function waitHealthy(url, child, ms = 600_000) {
  const until = Date.now() + ms
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error(`llama-server exited with ${child.exitCode}`)
    try {
      const r = await fetch(`${url}/health`)
      if (r.ok) return
    } catch {
      // Not listening yet.
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('llama-server did not become healthy')
}

/** The options of `argv`: `--set`, `--url`, `--server`, `--model`, `--candidate`, `--reasoning`,
 *  `--json`, `--verbose`, and everything after `--` for `llama-server`. */
export function parseArgs(argv) {
  const o = { sets: [], url: 'http://127.0.0.1:8080', serverArgs: [], reasoning: false, verbose: false }
  const dd = argv.indexOf('--')
  if (dd >= 0) o.serverArgs = argv.slice(dd + 1)
  const a = dd >= 0 ? argv.slice(0, dd) : argv
  for (let i = 0; i < a.length; i++) {
    const k = a[i]
    const v = () => a[++i]
    if (k === '--set') o.sets.push(v())
    else if (k === '--url') o.url = v()
    else if (k === '--server') o.server = v()
    else if (k === '--model') o.model = v()
    else if (k === '--candidate') o.candidate = v()
    else if (k === '--json') o.json = v()
    else if (k === '--reasoning') o.reasoning = true
    else if (k === '--verbose') o.verbose = true
    else throw new Error(`unknown option ${k}`)
  }
  if (!o.sets.length) o.sets.push(REPO_SET, REAL_SET)
  return o
}

const USAGE = `usage: node scripts/jarvis-bench.mjs [--set FILE]... [--candidate NAME] [--reasoning] [--json OUT]
         [--url http://127.0.0.1:8080 | --server PATH/llama-server --model FILE.gguf [-- llama-server args]]`

async function main(argv) {
  const o = parseArgs(argv)
  const sets = []
  for (const file of o.sets) {
    let text
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      console.error(`skipping ${file}: not readable`)
      continue
    }
    const set = parseSet(text)
    if (set.requests.length) sets.push({ name: setName(file), file, ...set })
    else console.error(`skipping ${file}: no requests`)
  }
  if (!sets.length) throw new Error('no request set to run')

  let child = null
  const idle = gpuUsedMiB()
  let gguf = null
  if (o.server) {
    if (!o.model) throw new Error('--server needs --model')
    const port = new URL(o.url).port || '8080'
    gguf = { file: basename(o.model), sha256: await sha256(o.model) }
    child = spawn(o.server, ['-m', o.model, '--port', port, '--jinja', ...o.serverArgs], { stdio: o.verbose ? 'inherit' : 'ignore' })
    await waitHealthy(o.url, child)
  }
  const candidate = (o.candidate ?? (gguf?.file || 'model')) + (o.reasoning ? ' (reasoning on)' : '')
  const sampler = vramSampler()
  const report = { candidate, gguf, reasoning: o.reasoning, idleMiB: idle, sets: [] }
  try {
    for (const set of sets) {
      const results = []
      // One unscored warm-up: the first request also pays for loading weights into caches.
      await ask(o.url, set.requests[0], set.projects, o).catch(() => {})
      for (const row of set.requests) {
        try {
          const r = await ask(o.url, row, set.projects, o)
          results.push({ ...score(row, r.message, set.projects), ttftMs: r.ttftMs, totalMs: r.totalMs })
          // Only the repo's set may be echoed: the real one names private projects.
          if (o.verbose && set.name !== 'real') console.error(JSON.stringify({ request: row.request, expect: row.expect, got: firstCall(r.message) }))
        } catch (e) {
          results.push({ ...score(row, null, set.projects), error: String(e.message ?? e) })
        }
      }
      report.sets.push({ name: set.name, summary: summarize(results) })
    }
  } finally {
    const peak = sampler.stop()
    report.vram = peak === null ? null : { peakMiB: peak, deltaMiB: idle !== null && child ? peak - idle : null }
    child?.kill()
  }
  for (const s of report.sets) {
    console.log(`\n### ${s.name} set\n`)
    console.log(table([{ candidate, summary: s.summary, vram: report.vram }]))
    console.log(`\n${toolTable(s.summary)}`)
  }
  if (gguf) console.log(`\n${gguf.file} sha256 ${gguf.sha256}`)
  if (o.json) (await import('node:fs')).writeFileSync(o.json, JSON.stringify(report, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(String(e.message ?? e))
    console.error(USAGE)
    process.exit(1)
  })
}

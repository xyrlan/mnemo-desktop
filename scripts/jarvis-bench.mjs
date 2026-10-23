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
import { NAME, NO_TOOL, TOOLS, canonicalProject, chatBody, firstCall, foldChunks, isOutput, sseEvents, systemPrompt } from '../src/jarvis/routing.ts'

// James's name, tools, prompt and wire format are the app's own (`src/jarvis/routing.ts`), so the
// benchmark measures what ships.
export { NAME, NO_TOOL, TOOLS, canonicalProject, chatBody, firstCall, foldChunks, isOutput, sseEvents, systemPrompt }

export const REPO_SET = join(dirname(fileURLToPath(import.meta.url)), 'jarvis-bench.jsonl')
export const REAL_SET = join(homedir(), 'mnemo', '.mnemo', 'jarvis-bench.jsonl')

/** A set's name in the report: only the repo's own set is not `real`, which is never echoed. */
export const setName = (file) => (resolve(file) === REPO_SET ? 'repo (synthetic)' : 'real')

/** The requests, known projects and apps of a set's JSONL text. A line that is not a request (no
 *  `request` and `expect.tool`, or marked `example`) is skipped, unless it is the `projects` line,
 *  which may also list the `apps` James can open (`[{"name", "project"}]`). */
export function parseSet(text) {
  const requests = []
  let projects = null
  let apps = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    let r
    try {
      r = JSON.parse(line)
    } catch {
      continue
    }
    if (Array.isArray(r?.projects)) {
      projects = r.projects.map((p) => (typeof p === 'string' ? { name: p } : p))
      if (Array.isArray(r.apps)) apps = r.apps.map((a) => (typeof a === 'string' ? { name: a } : a))
    }
    // A request marked `example` is a template for the file's format, not part of the set.
    else if (typeof r?.request === 'string' && typeof r.expect?.tool === 'string' && !r.example) requests.push(r)
  }
  if (!projects) projects = [...new Set(requests.map((r) => r.expect.project).filter(Boolean))].map((name) => ({ name }))
  return { requests, projects, apps }
}

const norm = (v) => String(v ?? '').trim().toLowerCase()

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
      await ask(o.url, set.requests[0], set.projects, { ...o, apps: set.apps }).catch(() => {})
      for (const row of set.requests) {
        try {
          const r = await ask(o.url, row, set.projects, { ...o, apps: set.apps })
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

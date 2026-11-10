// The live world against the prototypes' capture of the same machine: where they differ, and why.
//
//   node tools/world/compare.mjs --run             # take a capture now, and compare
//   node tools/world/compare.mjs                   # compare with the capture already there (data.js)
//   node tools/world/compare.mjs --world w.json    # the world a running app built, saved from its console
//
// `docs/superpowers/prototypes/redesign/capture.py` reads this machine's sessions its own way
// (every transcript, `claude agents`, `mnemo sessions`, `gh`). The live world (`src/world/live/`)
// reads them through the app. This holds one against the other with `src/world/live/compare.ts`,
// the code `__mnemoWorld.compare()` runs inside a dev build.
//
// Two ways to have a live world to compare:
//
// - `--world <file>`: the world the app itself built. In the app's console (the new front, live):
//   `copy(JSON.stringify(__mnemoWorld.world()))`, pasted into a file. This is the whole road: the
//   core's snapshot, feed and hook events, as the app heard them.
// - without it, the rows are read here: `claude agents --json --all` on every account and each
//   account's `jobs/*/state.json` with its daemon's roster, put into a snapshot as
//   `src-tauri/src/mission.rs` puts them, and built into a world by the same `buildWorld` the
//   app runs. What only a transcript says
//   (titles, tokens, the last tool call, pull requests) is taken from the capture itself, standing
//   in for the feed and the core wave's insight, so those readings agree by construction: this
//   way checks who is in the world, in what state, under whom and waiting for what. It needs no
//   app. It hears no hook event, and it does not guess a child's parent as the core does
//   (`link_children`) when mnemo did not record one.
//
// The report names sessions by their first 8 characters and prints no title, prompt, path,
// project or account. `--json` prints the comparison itself.

import { execFileSync, execSync, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const prototypes = resolve(root, 'docs/superpowers/prototypes/redesign')
const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const value = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)

if (flag('--help') || flag('-h')) {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'))
  process.exit(0)
}

const home = homedir()

/** A read-only command's output, or '' when it is not there or fails. */
function sh(cmd, argv, opts = {}) {
  const how = { encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024, ...opts }
  try {
    // `claude` is a `.cmd` shim on Windows, which only a shell runs; its arguments here are plain words.
    return cmd === 'claude' && process.platform === 'win32' ? execSync([cmd, ...argv].join(' '), how) : execFileSync(cmd, argv, how)
  } catch {
    return ''
  }
}

const parse = (text, fallback) => {
  try {
    return JSON.parse(text)
  } catch {
    return fallback
  }
}

const jsonl = (path) =>
  existsSync(path)
    ? readFileSync(path, 'utf8')
        .split('\n')
        .filter((l) => l.trim())
        .flatMap((l) => {
          const row = parse(l, null)
          return row ? [row] : []
        })
    : []

/** A capture file as JSON: `data.js` (`window.MNEMO = {…};`) or the JSON itself. */
function readCapture(path) {
  const text = readFileSync(path, 'utf8').trim()
  return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1))
}

/* ------------------------------------------------------------------ the rows, read here --
   The snapshot as `mission.rs` puts it together, from the same two commands. */

const samePath = (a, b) => resolve(a).toLowerCase() === resolve(b).toLowerCase()
const roots = new Map()

/** The main checkout a directory belongs to, so a worktree's session lands in its repo. */
function repoRoot(cwd) {
  if (!cwd) return null
  if (!roots.has(cwd)) {
    const common = existsSync(cwd) ? sh('git', ['-C', cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir']).trim() : ''
    roots.set(cwd, common ? (basename(common) === '.git' ? dirname(common) : common) : cwd.replace(/([\\/]\.claude[\\/]worktrees[\\/][^\\/]+|-wt-[^\\/]+)$/, ''))
  }
  return roots.get(cwd)
}

const isDir = (path) => {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

const alive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    // No right to signal it is still a process that is there.
    return e?.code === 'EPERM'
  }
}

/** One account's background jobs as `read_job_children` reads them: each `jobs/<short>/state.json`,
 *  live when the daemon's roster lists a running pid for it, and a finished job whose worktree is
 *  gone left out unless it is blocked. */
function readJobs(configDir) {
  const jobs = join(configDir, 'jobs')
  if (!isDir(jobs)) return []
  const workers = parse(safeRead(join(configDir, 'daemon', 'roster.json')), null)?.workers ?? null
  const out = []
  for (const short of readdirSync(jobs).sort()) {
    const v = parse(safeRead(join(jobs, short, 'state.json')), null)
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue
    const text = (k) => (typeof v[k] === 'string' && v[k] ? v[k] : null)
    const flags = Array.isArray(v.respawnFlags) ? v.respawnFlags : []
    const flagOf = (name) => (flags.includes(name) && typeof flags[flags.indexOf(name) + 1] === 'string' ? flags[flags.indexOf(name) + 1] || null : null)
    const state = text('state') ?? ''
    const tempo = text('tempo') ?? ''
    const cwd = text('cwd') ?? ''
    if ((state === 'done' || state === 'stopped') && tempo !== 'blocked' && cwd && !isDir(cwd)) continue
    const pid = workers?.[short]?.pid
    out.push({
      short_id: short,
      session_id: text('sessionId'),
      name: text('name'),
      state,
      tempo,
      needs: text('needs'),
      detail: text('detail') ?? '',
      suggested_reply: text('suggestedReply'),
      cwd,
      tokens: typeof v.tokens === 'number' ? v.tokens : 0,
      live: Number.isInteger(pid) && alive(pid),
      updated_at: text('updatedAt'),
      intent: text('intent'),
      model: flagOf('--model'),
      effort: flagOf('--effort'),
      configDir,
    })
  }
  return out
}

/** What the machine says now: `claude agents` on every account, and every account's jobs. */
function readRaw() {
  const configDirs = [null, ...readdirSync(home).filter((d) => d.startsWith('.claude-') && existsSync(join(home, d, 'projects'))).map((d) => join(home, d))]
  return {
    at: Date.now(),
    agents: configDirs.map((dir) => ({ dir, rows: parse(sh('claude', ['agents', '--json', '--all'], dir ? { env: { ...process.env, CLAUDE_CONFIG_DIR: dir } } : {}), []) })),
    sessions: configDirs.flatMap((dir) => readJobs(dir ?? join(home, '.claude'))),
  }
}

/** Those rows as a snapshot's repos. The capture says which account a config dir is, and which
 *  pull request a child opened (the snapshot reads that with `gh`). */
function snapshotOf(raw, capture) {
  const accountOf = (dir) => capture.accounts.find((a) => samePath(String(a.configDir).replace(/^~/, home), dir ?? join(home, '.claude')))?.id ?? 'default'
  const captured = new Map(capture.sessions.map((s) => [s.id, s]))

  const parents = []
  const waiting = new Map()
  const seen = new Set()
  for (const { dir, rows } of raw.agents) {
    for (const r of rows) {
      if (r.waitingFor) for (const key of [r.sessionId, r.id]) if (key) waiting.set(key, r.waitingFor)
      if (r.kind !== 'interactive' || !r.sessionId || !r.cwd || seen.has(r.sessionId)) continue
      seen.add(r.sessionId)
      // A headless `claude` (mnemo's briefing writer) is no one's parent; nor is the app's own brain.
      const own = parse(r.pid ? safeRead(join(dir ?? join(home, '.claude'), 'sessions', `${r.pid}.json`)) : '', null)
      if (own?.entrypoint === 'sdk-cli' || /[\\/]\.mnemo-desktop[^\\/]*[\\/]/.test(r.cwd)) continue
      parents.push({ session_id: r.sessionId, pid: r.pid ?? null, name: r.name ?? null, status: r.status ?? 'unknown', cwd: r.cwd, waiting_for: r.waitingFor || null, account: accountOf(dir) })
    }
  }

  const vault = process.env.MNEMO_VAULT || join(home, 'mnemo')
  const dispatched = new Map(jsonl(join(vault, '.mnemo', 'dispatch-parents.jsonl')).map((r) => [r.short_id, r.parent_session]))
  const children = []
  const shorts = new Set()
  for (const r of raw.sessions) {
    if (!r.short_id || shorts.has(r.short_id)) continue
    shorts.add(r.short_id)
    const known = r.session_id ? captured.get(r.session_id) : null
    const prs = known?.prs ?? []
    const pr = prs.find((p) => p.state === 'open') ?? prs.at(-1) ?? null
    children.push({
      id: r.short_id,
      session_id: r.session_id ?? null,
      name: r.name ?? null,
      state: r.state ?? '',
      tempo: r.tempo ?? '',
      needs: r.needs ?? null,
      detail: r.detail ?? '',
      suggested_reply: r.suggested_reply ?? null,
      cwd: r.cwd ?? '',
      tokens: r.tokens ?? 0,
      live: !!r.live,
      updated_at: r.updated_at ?? null,
      intent: typeof r.intent === 'string' ? r.intent.split('\n')[0] : null,
      branch: null,
      timeline_len: 0,
      parent_session: dispatched.get(r.short_id) ?? null,
      waiting_for: waiting.get(r.session_id) ?? waiting.get(r.short_id) ?? null,
      model: r.model ?? null,
      effort: r.effort ?? null,
      // The snapshot reads a child's pull request with `gh`; here it is the one the capture found.
      pr: pr ? { number: pr.number, url: pr.url, state: String(pr.state ?? 'open').toUpperCase(), head: '', ci: { green: 'pass', red: 'fail', running: 'pending' }[pr.ci] ?? 'none', draft: !!pr.draft, failing: [] } : null,
      account: accountOf(samePath(r.configDir, join(home, '.claude')) ? null : r.configDir),
      account_env: null,
      notice: null,
    })
  }

  const groups = new Map()
  const group = (cwd) => {
    const dir = repoRoot(cwd) ?? cwd ?? ''
    const key = dir.replace(/\\/g, '/').toLowerCase()
    if (!groups.has(key)) groups.set(key, { root: dir, name: basename(dir), parents: [], missions: [], children: [] })
    return groups.get(key)
  }
  for (const p of parents) group(p.cwd).parents.push(p)
  for (const c of children) group(c.cwd).children.push(c)
  return { at: raw.at, repos: [...groups.values()], parents: parents.length, children: children.length }
}

function safeRead(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

/* ------------------------------------------------------------------ the comparison -- */

const capturePath = resolve(value('--capture') ?? join(prototypes, 'data.js'))
const worldPath = value('--world')

// The rows first, the capture straight after: `capture.py` reads `claude agents` as it starts,
// so the two readings are a moment apart.
let raw = null
if (flag('--run')) {
  if (!worldPath) raw = readRaw()
  const python = process.platform === 'win32' ? 'python' : 'python3'
  const ran = spawnSync(python, [join(prototypes, 'capture.py'), ...(flag('--no-gh') ? ['--no-gh'] : [])], { stdio: ['ignore', 'ignore', 'inherit'] })
  if (ran.status !== 0) {
    console.error(`capture.py did not run (${ran.error?.message ?? `exit ${ran.status}`}).`)
    process.exit(1)
  }
}

if (!existsSync(capturePath)) {
  console.error(`No capture at ${capturePath}. Take one with --run (it runs capture.py), or name one with --capture.`)
  process.exit(1)
}
const capture = readCapture(capturePath)
if (capture.synthetic) console.error('This capture is the synthetic one: it says nothing of this machine.')

const server = await createServer({ root, logLevel: 'silent', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true } })
let text
try {
  const { fromCapture } = await server.ssrLoadModule('/src/world/capture.ts')
  const { compareWorlds, report } = await server.ssrLoadModule('/src/world/live/compare.ts')
  const theirs = fromCapture(capture)
  let ours
  let how
  if (worldPath) {
    ours = JSON.parse(readFileSync(resolve(worldPath), 'utf8'))
    how = 'the world the app built'
  } else {
    const { buildWorld } = await server.ssrLoadModule('/src/world/live/build.ts')
    const { readingsFromWorld } = await server.ssrLoadModule('/src/world/live/backwards.ts')
    const fresh = snapshotOf(raw ?? readRaw(), capture)
    const readings = readingsFromWorld(theirs)
    ours = buildWorld({ snapshot: { repos: fresh.repos, errors: [] }, feed: { sessions: {}, prs: {} }, agents: {}, repos: [], pulses: [], hosted: [], notes: [], ...readings, now: fresh.at }, null)
    how = `rows read here (${fresh.parents} parents, ${fresh.children} children), transcripts as the capture read them`
  }
  const comparison = compareWorlds(ours, theirs)
  text = flag('--json') ? JSON.stringify(comparison, null, 2) : `${how}\n${report(comparison)}`
} finally {
  await server.close()
}
console.log(text)

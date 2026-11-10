// What the app costs at rest: the CPU and the GPU of its processes over a stretch of time with
// nothing touched. The design's budget is under 2% of one core and under 3% of the GPU
// (docs/superpowers/specs/2026-11-10-recreation-design.md, "Motion and its budget").
//
//   node tools/perf/rest.mjs --pid 12345                 # the app's main process; its children are found
//   node tools/perf/rest.mjs --pid 12345 --seconds 60 --label orbit
//   node tools/perf/rest.mjs --pid 12345 --json
//
// The app is a tree of processes: the core, the webview's own (on Windows the WebView2 browser,
// renderer and GPU processes), the helpers it started. All of them are measured, and summed.
//
// - CPU: each process's processor time at the start and at the end; the difference over the
//   wall time is its share of ONE core (100 is one core kept busy, whatever the machine has).
// - GPU (Windows only): the `GPU Engine` counters Task Manager reads, sampled every two
//   seconds for the tree's processes; a process's share is its busiest engine type, as Task
//   Manager shows it. Elsewhere it is not measured, and the answer says so.
//
// It only reads counters: it starts, stops and touches nothing.
import { execFileSync, spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const BUDGET = { cpu: 2, gpu: 3 }

/** The processes of a tree, from a table of every process: `root` and whatever descends from it. */
export function treeOf(all, root) {
  const kids = new Map()
  for (const p of all) {
    if (!kids.has(p.ppid)) kids.set(p.ppid, [])
    kids.get(p.ppid).push(p)
  }
  const out = []
  const seen = new Set()
  const walk = (pid) => {
    if (seen.has(pid)) return
    seen.add(pid)
    const p = all.find((x) => x.pid === pid)
    if (p) out.push(p)
    for (const k of kids.get(pid) ?? []) walk(k.pid)
  }
  walk(root)
  return out
}

/** Each process's share of one core between two readings of its processor time (seconds),
 *  and the tree's. A process that started or ended in between counts for what it was seen to use. */
export function cpuShares(before, after, wallSeconds) {
  const was = new Map(before.map((p) => [p.pid, p]))
  const rows = after.map((p) => {
    const used = Math.max(0, p.cpuSeconds - (was.get(p.pid)?.cpuSeconds ?? p.cpuSeconds))
    return { pid: p.pid, name: p.name, percent: (used / wallSeconds) * 100 }
  })
  return { rows, total: rows.reduce((n, r) => n + r.percent, 0) }
}

/** The tree's GPU share from samples of the engine counters: per sample, each engine type's
 *  utilisation summed over the tree; the busiest type is the share; the answer is the mean and
 *  the peak over the samples. `samples`: arrays of `{ pid, type, percent }`. */
export function gpuShare(samples, pids) {
  if (!samples.length) return null
  const mine = new Set(pids)
  const per = samples.map((sample) => {
    const byType = {}
    for (const e of sample) if (mine.has(e.pid)) byType[e.type] = (byType[e.type] ?? 0) + e.percent
    return Math.max(0, ...Object.values(byType))
  })
  return { mean: per.reduce((n, v) => n + v, 0) / per.length, peak: Math.max(...per), samples: per.length }
}

/** `pid_1234_luid_0x0_0x1_phys_0_eng_3_engtype_3D` → `{ pid: 1234, type: '3D' }`. */
export function engineOf(instance) {
  const m = /pid_(\d+)_.*engtype_(.+)$/i.exec(instance)
  return m ? { pid: Number(m[1]), type: m[2] } : null
}

// ── reading the machine ──

const ps = (script) => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })

function processes() {
  if (process.platform === 'win32') {
    // KernelModeTime and UserModeTime are in 100 ns units.
    const rows = JSON.parse(ps('Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,KernelModeTime,UserModeTime | ConvertTo-Json -Compress'))
    return rows.map((r) => ({ pid: r.ProcessId, ppid: r.ParentProcessId, name: r.Name, cpuSeconds: (Number(r.KernelModeTime) + Number(r.UserModeTime)) / 1e7 }))
  }
  const text = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,time=,comm='], { encoding: 'utf8' })
  return text
    .split('\n')
    .map((line) => /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line))
    .filter(Boolean)
    .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), name: path.basename(m[4]), cpuSeconds: clock(m[3]) }))
}

/** `ps`'s `[[dd-]hh:]mm:ss[.cc]`, in seconds. */
export function clock(text) {
  const [rest, days] = text.includes('-') ? [text.split('-')[1], Number(text.split('-')[0])] : [text, 0]
  const parts = rest.split(':').map(Number)
  const [s, m = 0, h = 0] = parts.reverse()
  return days * 86400 + h * 3600 + m * 60 + s
}

function gpuSample() {
  if (process.platform !== 'win32') return null
  const script = "(Get-Counter '\\GPU Engine(*)\\Utilization Percentage' -ErrorAction SilentlyContinue).CounterSamples | Where-Object { $_.CookedValue -gt 0 } | ForEach-Object { $_.InstanceName + '=' + $_.CookedValue }"
  const out = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' })
  if (out.status !== 0) return []
  return out.stdout
    .split(/\r?\n/)
    .map((line) => {
      const [instance, value] = line.split('=')
      const engine = engineOf(instance ?? '')
      return engine ? { ...engine, percent: Number(String(value).replace(',', '.')) } : null
    })
    .filter(Boolean)
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

/** Measures the tree under `pid` for `seconds`. */
export async function rest({ pid, seconds = 60 }) {
  const first = treeOf(processes(), pid)
  if (!first.length) throw new Error(`no process ${pid}`)
  const started = Date.now()
  const samples = []
  while (Date.now() - started < seconds * 1000) {
    const sample = gpuSample()
    if (sample) samples.push(sample)
    await sleep(Math.min(2000, Math.max(0, seconds * 1000 - (Date.now() - started))))
  }
  const wall = (Date.now() - started) / 1000
  const last = treeOf(processes(), pid)
  const cpu = cpuShares(first, last, wall)
  const gpu = process.platform === 'win32' ? gpuShare(samples, last.map((p) => p.pid)) : null
  return { seconds: wall, processes: last.length, cpu, gpu, budget: BUDGET }
}

async function main() {
  const args = process.argv.slice(2)
  const value = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined)
  const pid = Number(value('--pid'))
  if (!pid) {
    process.stderr.write('usage: node tools/perf/rest.mjs --pid <the app\'s main process> [--seconds 60] [--label <what is on screen>] [--json]\n')
    process.exit(2)
  }
  const label = value('--label') ?? ''
  const m = await rest({ pid, seconds: Number(value('--seconds') ?? 60) })
  if (args.includes('--json')) return void process.stdout.write(JSON.stringify({ label, ...m }) + '\n')
  const lines = [`${label ? label + ': ' : ''}${m.processes} processes over ${m.seconds.toFixed(0)} s`]
  lines.push(`  CPU ${m.cpu.total.toFixed(2)}% of one core (budget ${BUDGET.cpu}%)`)
  for (const r of [...m.cpu.rows].sort((a, b) => b.percent - a.percent).filter((r) => r.percent >= 0.01)) lines.push(`      ${r.percent.toFixed(2).padStart(6)}%  ${r.name} (${r.pid})`)
  lines.push(m.gpu ? `  GPU ${m.gpu.mean.toFixed(2)}% mean, ${m.gpu.peak.toFixed(2)}% peak over ${m.gpu.samples} samples (budget ${BUDGET.gpu}%)` : '  GPU not measured on this system')
  process.stdout.write(lines.join('\n') + '\n')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()

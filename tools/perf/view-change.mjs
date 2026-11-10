// How long a change of view takes. The design's budget is under 100 ms
// (docs/superpowers/specs/2026-11-10-recreation-design.md, "Motion and its budget").
//
//   pnpm exec vite build
//   node tools/perf/view-change.mjs                       # the sample world
//   node tools/perf/view-change.mjs --world capture       # this machine's own capture, when
//                                                         # scripts/world-sample.mjs --real wrote one
//   node tools/perf/view-change.mjs --size 2560x1440 --motion reduced --json
//
// It serves the production bundle (`dist/`), opens it in the preview harness's Chromium with
// Tauri's IPC answered as the harness answers it, and runs `view-change.page.js` in the page:
// thirty changes, five of each pair. What it prints is the median and the slowest, per pair,
// of the time from the key to the first frame that shows the new view, and to the end of the
// movement. The same page script runs in a dev build through `desktop_app_drive`, which is
// how the real webview is timed (README.md here).
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '../..')
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.webm': 'video/webm', '.mp4': 'video/mp4', '.jpg': 'image/jpeg', '.png': 'image/png' }

export const BUDGET_MS = 100

/** The middle of a list of numbers. */
export function median(list) {
  const sorted = [...list].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** The timings by pair of views: how many, the median and the slowest of each clock. A change
 *  that never showed (null) counts as slower than anything, and is said. */
export function summarize(timings) {
  const pairs = new Map()
  for (const t of timings) {
    const key = `${t.from} → ${t.to}`
    if (!pairs.has(key)) pairs.set(key, [])
    pairs.get(key).push(t)
  }
  const stat = (list, pick) => {
    const got = list.map(pick).filter((v) => v != null)
    return { median: got.length ? median(got) : null, worst: got.length ? Math.max(...got) : null, missed: list.length - got.length }
  }
  const rows = [...pairs].map(([pair, list]) => ({ pair, n: list.length, shown: stat(list, (t) => t.shown), settled: stat(list, (t) => t.settled) }))
  const all = stat(timings, (t) => t.shown)
  return { rows, shown: all, within: all.missed === 0 && all.worst != null && all.worst <= BUDGET_MS }
}

function serve(dir) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x')
    const file = path.join(dir, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname))
    try {
      if (!file.startsWith(dir)) throw new Error('outside')
      const body = await readFile(file)
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' })
      res.end(body)
    } catch {
      res.writeHead(404)
      res.end()
    }
  })
  return new Promise((done) => server.listen(0, '127.0.0.1', () => done({ server, url: `http://127.0.0.1:${server.address().port}/` })))
}

async function main() {
  const args = process.argv.slice(2)
  const value = (flag, fallback) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback)
  const world = value('--world', 'sample')
  const [width, height] = value('--size', '2560x1440').split('x').map(Number)
  const motion = value('--motion', 'full')

  // Playwright and the Tauri stand-in are the preview harness's own.
  const require = createRequire(path.join(REPO, 'tools/preview/package.json'))
  const { chromium } = require('playwright')
  const { preparePage } = await import(pathToFileURL(path.join(REPO, 'tools/preview/shot.mjs')).href)
  const { appIpc } = await import(pathToFileURL(path.join(REPO, 'tools/preview/fixtures/app.mjs')).href)
  const script = await readFile(path.join(HERE, 'view-change.page.js'), 'utf8')

  const { server, url } = await serve(path.join(REPO, 'dist'))
  const browser = await chromium.launch()
  try {
    const page = await (await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 })).newPage()
    const storage = { 'mnemo.boot': '0', 'mnemo.world': world, 'mnemo.motion': motion, 'mnemo.route': '#v=orbit' }
    await preparePage(page, { ipc: appIpc({}), events: [], storage })
    await page.goto(url, { waitUntil: 'networkidle' })
    await page.waitForSelector('.mn .frame-view')
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(600)
    const sessions = await page.evaluate(() => document.querySelectorAll('[data-orbit-body], .orbit-body').length)
    const timings = await page.evaluate(script)
    const summary = summarize(timings)
    if (args.includes('--json')) return void process.stdout.write(JSON.stringify({ world, size: `${width}x${height}`, motion, ...summary }) + '\n')
    const ms = (v) => (v == null ? '   never' : `${v.toFixed(0).padStart(5)} ms`)
    const lines = [`${world} world, ${width}x${height}, motion ${motion}${sessions ? `, ${sessions} bodies in Orbit` : ''}`, '', 'key to the first frame of the new view (median, slowest)        to the end of the movement (median)']
    for (const r of summary.rows) lines.push(`  ${r.pair.padEnd(18)} ${ms(r.shown.median)} ${ms(r.shown.worst)}${r.shown.missed ? `  (${r.shown.missed} never shown)` : ''}                    ${ms(r.settled.median)}`)
    lines.push('', `slowest of all: ${ms(summary.shown.worst).trim()} (budget ${BUDGET_MS} ms: ${summary.within ? 'within' : 'over'})`)
    process.stdout.write(lines.join('\n') + '\n')
  } finally {
    await browser.close()
    server.close()
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()

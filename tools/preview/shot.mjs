#!/usr/bin/env node
// Shoots one screen of the real app without a Tauri build: serves `src/` with the repo's own
// vite config, opens it in headless Chromium, answers Tauri's IPC from a scenario, and writes
// a PNG.
//
//   node tools/preview/shot.mjs --scenario <name> --out <file.png> [--size <w>x<h>]
//
// Also: --list (the scenarios), --trace (every command and its reply, on stderr),
// --settle <ms> (extra wait before the shot, default 400).

import { mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createServer as createNetServer } from 'node:net'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { installTauriMock } from './runtime.mjs'
import { getScenario, loadScenarios, reviveChannels, scenarioNames } from './scenario.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const REPO = path.resolve(HERE, '../..')
export const DEFAULT_SIZE = { width: 1440, height: 900 }
const DEFAULT_SETTLE_MS = 400

export function parseArgs(argv) {
  const opts = { size: { ...DEFAULT_SIZE }, settleMs: DEFAULT_SETTLE_MS, trace: false, list: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const value = () => {
      const v = argv[++i]
      if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`)
      return v
    }
    switch (a) {
      case '--scenario':
        opts.scenario = value()
        break
      case '--out':
        opts.out = value()
        break
      case '--size': {
        const v = value()
        const m = /^(\d+)x(\d+)$/.exec(v)
        if (!m || +m[1] < 1 || +m[2] < 1) throw new Error(`--size must be <w>x<h>, got ${v}`)
        opts.size = { width: +m[1], height: +m[2] }
        break
      }
      case '--settle': {
        const v = value()
        if (!/^\d+$/.test(v)) throw new Error(`--settle must be milliseconds, got ${v}`)
        opts.settleMs = +v
        break
      }
      case '--trace':
        opts.trace = true
        break
      case '--list':
        opts.list = true
        break
      default:
        throw new Error(`unknown argument: ${a}`)
    }
  }
  if (!opts.list) {
    if (!opts.scenario) throw new Error('--scenario is required')
    if (!opts.out) throw new Error('--out is required')
    if (!opts.out.toLowerCase().endsWith('.png')) throw new Error(`--out must be a .png file, got ${opts.out}`)
  }
  return opts
}

const freePort = () =>
  new Promise((resolve, reject) => {
    const s = createNetServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => resolve(port))
    })
  })

/** The repo's own vite, with the repo's own config: the preview renders what `pnpm dev` does. */
async function startVite() {
  const require = createRequire(path.join(REPO, 'package.json'))
  const { createServer } = await import(pathToFileURL(require.resolve('vite')).href)
  const port = await freePort()
  const server = await createServer({
    root: REPO,
    // Page errors are reported by `shoot`; vite would print them a second time.
    logLevel: 'silent',
    clearScreen: false,
    // Its own cache, so a shot never fights a running `pnpm dev` over optimized deps.
    cacheDir: path.join(HERE, 'node_modules', '.vite'),
    server: { host: '127.0.0.1', port, strictPort: true, hmr: false, watch: null },
  })
  await server.listen()
  return { server, url: `http://127.0.0.1:${port}/` }
}

/**
 * Wires a page to a scenario before it navigates: the Tauri stand-in as an init script, and
 * `window.__previewIpc` calling the scenario's `ipc` in Node. Commands the scenario answers
 * `undefined` to are added to `unanswered`.
 */
export async function preparePage(page, setup, { trace = false, log = () => {}, unanswered = new Set() } = {}) {
  const deliver = (id, message) => page.evaluate(([i, m]) => window.__previewChannelSend(i, m), [id, message])
  await page.exposeFunction('__previewIpc', async (cmd, args) => {
    try {
      const value = await setup.ipc(cmd, reviveChannels(args, deliver))
      if (value === undefined) unanswered.add(cmd)
      if (trace) log(`ipc ${cmd} ${JSON.stringify(args)} -> ${JSON.stringify(value)}`)
      return { value: value === undefined ? null : value }
    } catch (e) {
      const error = e instanceof Error ? e.message : e
      if (trace) log(`ipc ${cmd} ${JSON.stringify(args)} !! ${JSON.stringify(error)}`)
      return { error: error ?? 'error' }
    }
  })
  await page.addInitScript(installTauriMock, { events: setup.events ?? [] })
  return unanswered
}

/**
 * Renders one scenario and writes the PNG. Returns what a caller may want to check: the
 * commands the scenario left unanswered and the errors the page threw.
 */
export async function shoot({ scenario: name, out, size = DEFAULT_SIZE, settleMs = DEFAULT_SETTLE_MS, trace = false, log = (l) => process.stderr.write(l + '\n') }) {
  const setup = getScenario(name)
  if (!setup) throw new Error(`no scenario named ${name} (have: ${scenarioNames().join(', ') || 'none'})`)
  const { chromium } = await import('playwright')

  const pageErrors = []
  const { server, url } = await startVite()
  let browser
  let unanswered
  try {
    browser = await chromium.launch()
    const context = await browser.newContext({ viewport: size, deviceScaleFactor: 1 })
    const page = await context.newPage()
    page.on('pageerror', (e) => pageErrors.push(e.message))
    page.on('console', (m) => {
      if (m.type() === 'error') pageErrors.push(m.text())
    })
    unanswered = await preparePage(page, setup, { trace, log })

    await page.goto(url, { waitUntil: 'networkidle' })
    await page.waitForFunction(() => window.__previewEventsDone === true)
    await page.evaluate(() => document.fonts.ready)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(settleMs)

    await mkdir(path.dirname(path.resolve(out)), { recursive: true })
    await page.screenshot({ path: out })
  } finally {
    await browser?.close()
    await server.close()
  }
  return { unanswered: [...unanswered].sort(), pageErrors }
}

async function main() {
  let opts
  try {
    opts = parseArgs(process.argv.slice(2))
  } catch (e) {
    process.stderr.write(`${e.message}\nusage: node tools/preview/shot.mjs --scenario <name> --out <file.png> [--size <w>x<h>]\n`)
    process.exit(2)
  }
  await loadScenarios()
  if (opts.list) {
    process.stdout.write(scenarioNames().join('\n') + '\n')
    return
  }
  const { unanswered, pageErrors } = await shoot(opts)
  if (unanswered.length) process.stderr.write(`note: the scenario answered nothing to: ${unanswered.join(', ')}\n`)
  // One line each: the rest is a stack through vite's module urls. React logs a bare `%o` first.
  for (const e of pageErrors) {
    const line = e.split('\n').find((l) => l.trim() && !/^(%[a-z]\s*)+$/.test(l.trim())) ?? e
    process.stderr.write(`page error: ${line.trim()}\n`)
  }
  process.stdout.write(`${opts.out}\n`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((e) => {
    process.stderr.write(`${e?.stack ?? e}\n`)
    process.exit(1)
  })
}

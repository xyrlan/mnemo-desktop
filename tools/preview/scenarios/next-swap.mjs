// What the swap closed (docs/superpowers/specs/2026-11-10-recreation-swap.md), one scenario per
// state worth looking at. Every name, prompt and path is invented.
//
//   next-swap-console      the frame as a build shows it: the panels on their own line under the top bar
//   next-swap-orbit, -score   the same line over the two views that have the whole room
//   next-swap-panel        a panel opened from that line, its name lit
//   next-swap-command-panel   the command line finding a panel by the start of its name
//   next-swap-changes      the Changes panel opened from the stage, for the session on stage
//   next-swap-shell        a plain shell on stage, and in the roster after the sessions (a live world)
//   next-swap-boot         the launch: the clip of the lattice assembling, mid-way
//   next-swap-boot-opening Orbit opening out of the clip's last moments
//   next-swap-broken       what stands in the frame's place when it cannot be drawn
//
//   for s in 2560x1440 1920x1080 1366x768; do
//     node tools/preview/shot.mjs --scenario next-swap-console --size $s --out /tmp/swap-console-$s.png
//   done
import { scenario } from '../scenario.mjs'
import { appIpc, HOME } from '../fixtures/app.mjs'
import { next, sessionTitled } from '../fixtures/next.mjs'

const billing = sessionTitled('Idempotent retries')
const console_ = { v: 'console', s: billing }

const typed =
  (text, ...keys) =>
  async (page) => {
    await page.keyboard.press(';')
    await page.keyboard.type(text)
    for (const k of keys) await page.keyboard.press(k)
  }

scenario('next-swap-console', next(console_))
scenario('next-swap-orbit', next({ v: 'orbit' }))
scenario('next-swap-score', next({ v: 'score', s: billing }))

scenario('next-swap-panel', {
  ...next(console_),
  drive: async (page) => {
    await page.click('[data-panel-tab="accounts"]')
  },
})

scenario('next-swap-command-panel', { ...next(console_), drive: typed('me') })

scenario('next-swap-changes', {
  ...next(console_),
  drive: async (page) => {
    await page.click('[data-stage-changes]')
  },
})

// ── a plain shell: only a live world has a runtime to hold one ──

const ESC = '\x1b['
const c = (code, s) => `${ESC}${code}m${s}${ESC}0m`
const ROOT = `${HOME}/work/atlas-api`
const PARENT = 'a1f0c3d2-7b54-4e19-9c06-2d8e5f7a1b30'
const now = Date.now()

/** What a shell prints once it is up, and after two commands. */
const SHELL = [
  `${c('2', '~/work/atlas-api')} ${c('36', 'fix/order-status-history')} ${c('2', '$')} git status -sb`,
  `## fix/order-status-history...origin/fix/order-status-history ${c('32', '[ahead 2]')}`,
  ` ${c('31', 'M')} db/migrate/0412_add_status_history.sql`,
  ` ${c('31', 'M')} src/models/order.ts`,
  `${c('2', '~/work/atlas-api')} ${c('36', 'fix/order-status-history')} ${c('2', '$')} pnpm test --run orders`,
  '',
  ` ${c('32', '✓')} src/models/order.test.ts ${c('2', '(14 tests) 212ms')}`,
  ` ${c('32', '✓')} src/api/routes/orders.test.ts ${c('2', '(31 tests) 640ms')}`,
  '',
  ` ${c('2', 'Test Files')}  ${c('1;32', '2 passed')} ${c('2', '(2)')}`,
  ` ${c('2', '     Tests')}  ${c('1;32', '45 passed')} ${c('2', '(45)')}`,
  '',
  `${c('2', '~/work/atlas-api')} ${c('36', 'fix/order-status-history')} ${c('2', '$')} `,
].join('\r\n')

const live = {
  mission_snapshot: () => ({
    repos: [
      {
        root: ROOT,
        name: 'atlas-api',
        parents: [{ session_id: PARENT, pid: 4001, name: 'Order status history column', status: 'waiting', cwd: ROOT, waiting_for: 'input needed', account: 'default' }],
        missions: [],
        children: [],
      },
    ],
    errors: [],
    at: new Date(now).toISOString(),
  }),
  mission_looked: {},
  nexus_feed: () => ({
    sessions: {
      [PARENT]: { activity: null, said: { text: 'The migration is written and tested on a copy. I need one decision from you before running the backfill.', at: now - 14 * 60_000 }, context: 94_000, model: 'claude-opus-5-5', topic: 'add a status_history column to orders and backfill it', title: 'Order status history column', contract: null, ask: null },
    },
    prs: {},
    rate: null,
    at: now,
  }),
  worktree_list: () => [],
  pty_write: null,
  pty_resize: null,
  pty_kill: null,
  pty_spawn: ({ onOutput }) => {
    setTimeout(() => void onOutput.sendBytes(SHELL), 60)
    return 60
  },
  pty_pid: 4060,
}

scenario('next-swap-shell', {
  storage: { 'mnemo.route': '#' + new URLSearchParams({ v: 'console', s: PARENT }).toString() },
  ipc: appIpc(live),
  drive: async (page) => {
    // As the maintainer opens one: the command line, `shell`, the project.
    await page.keyboard.press(';')
    await page.keyboard.type('shell atlas-api')
    await page.keyboard.press('Enter')
    await page.waitForSelector('[data-stage][data-terminal] .xterm')
  },
})

// ── the launch ──

/** The clip as the launch plays it, held at `seconds`: the clip's own clock is stopped there,
 *  so the picture is the same every time. */
const bootAt = (seconds, phase) => ({
  ...next({ v: 'orbit' }),
  storage: { ...next({ v: 'orbit' }).storage, 'mnemo.boot': '1' },
  drive: async (page) => {
    await page.waitForSelector(`[data-frame-boot="${phase}"]`, { timeout: 8000 })
    await page.evaluate(async (t) => {
      const video = document.querySelector('[data-frame-boot] video')
      video.pause()
      video.currentTime = t
      await new Promise((done) => video.addEventListener('seeked', done, { once: true }))
    }, seconds)
  },
})
scenario('next-swap-boot', bootAt(2.6, 'playing'))

// ── the frame that cannot be drawn ──

scenario('next-swap-broken', {
  ...next(console_),
  // The frame's own module does not arrive: what `view.tsx` mounts stands in its place.
  before: async (page) => {
    await page.route('**/src/frame/Frame.tsx*', (route) => route.abort())
  },
})

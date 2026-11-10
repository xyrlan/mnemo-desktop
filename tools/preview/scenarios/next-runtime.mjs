// The runtime's states on the stage (src/runtime/): a session's real terminal where the
// transcript would be drawn. The runtime runs only in a live world, so these start the app live
// (no `mnemo.world`): the live world builds its sessions from what the fixture answers for the
// core (a mission snapshot, the feed), and the terminals are the fixture's too. Every name,
// prompt and path is invented.
//
//   next-runtime-terminal   a session one of the app's terminals runs, held the moment it is on stage
//   next-runtime-attach     a live child, attached to once it has stayed on stage
//   next-runtime-attaching  the same child while its attach starts
//   next-runtime-detached   its terminal let go of while it was on stage
import { scenario } from '../scenario.mjs'
import { appIpc, HOME } from '../fixtures/app.mjs'

const ESC = '\x1b['
const c = (code, s) => `${ESC}${code}m${s}${ESC}0m`
const RULE = c('2', '─'.repeat(72))

const ROOT = `${HOME}/work/atlas-api`
const PARENT = 'a1f0c3d2-7b54-4e19-9c06-2d8e5f7a1b30'
const CHILD = 'c6d082fb-3e41-4a7c-8f25-90b1d4e6a7c2'
const WORKTREE = `${ROOT}-wt-tenant`
const QUESTION = 'The orders table has 2.1M rows. Backfill the new column online in batches, or take a short maintenance window?'
const OPTIONS = ['Online, in batches (Recommended)', 'Maintenance window', 'Skip the backfill']
const now = Date.now()

/** Claude Code's screen in a terminal of the app: the session asks its question. */
const ASKING = [
  `${c('1;38;5;208', '✻')} ${c('1', 'Claude Code')}  ${c('2', '~/work/atlas-api · fix/order-status-history')}`,
  '',
  `${c('2', '>')} add a status_history column to orders and backfill it`,
  '',
  `${c('32', '●')} I added the migration and the model change. Before the backfill runs I need one decision.`,
  '',
  `${c('32', '●')} ${c('1', 'Read')}(db/migrate/0412_add_status_history.sql)`,
  `  ${c('2', '⎿  Read 38 lines')}`,
  `${c('32', '●')} ${c('1', 'Bash')}(psql -c "select count(*) from orders")`,
  `  ${c('2', '⎿  2104332')}`,
  '',
  RULE,
  ` ${c('1', 'The orders table has 2.1M rows. Backfill the new column online in batches,')}`,
  ` ${c('1', 'or take a short maintenance window?')}`,
  '',
  ` ${c('36', `❯ 1. ${OPTIONS[0]}`)}`,
  `      ${c('2', 'No downtime; the backfill runs for about 40 minutes and can be paused.')}`,
  `   2. ${OPTIONS[1]}`,
  `      ${c('2', 'Simpler migration, roughly 6 minutes of read-only mode.')}`,
  `   3. ${OPTIONS[2]}`,
  `      ${c('2', 'Leave old rows null and handle it in code.')}`,
  '   4. Type something.',
  '   5. Chat about this',
  '',
  ` ${c('2', 'Enter to select · ↑/↓ to navigate · Esc to cancel')}`,
].join('\r\n')

/** A child's screen, as `claude attach` draws it: at work. */
const WORKING = [
  `${c('1;38;5;208', '✻')} ${c('1', 'Claude Code')}  ${c('2', '~/work/atlas-api-wt-tenant · fix/tenant-cache-key')}`,
  '',
  `${c('2', '>')} Work on issue #398 in this repo: the cache key must carry the tenant`,
  '',
  `${c('32', '●')} The key is built in one place. I am threading the tenant through it and its three callers.`,
  '',
  `${c('32', '●')} ${c('1', 'Edit')}(src/cache/key.ts)`,
  `  ${c('2', '⎿  Updated with 9 additions and 4 removals')}`,
  `${c('32', '●')} ${c('1', 'Edit')}(src/cache/key.test.ts)`,
  `  ${c('2', '⎿  Updated with 22 additions')}`,
  `${c('32', '●')} ${c('1', 'Bash')}(pnpm vitest run src/cache)`,
  `  ${c('2', '⎿  Running…')}`,
  '',
  `${c('38;5;208', '✶')} ${c('38;5;208', 'Threading the tenant…')} ${c('2', '(2m 14s · ↓ 3.1k tokens · esc to interrupt)')}`,
  '',
  RULE,
  `${c('2', '❯')} `,
  RULE,
  `  ${c('2', '⏵⏵ accept edits on · ctrl+z to detach')}`,
].join('\r\n')

const route = (r) => ({ 'mnemo.route': '#' + new URLSearchParams(r).toString() })
const bytes = (text) => [...new TextEncoder().encode(text)]

/** What the core says of the fleet: one session the maintainer talks to, which asks a question,
 *  and one child it dispatched, at work in its own worktree. */
const fleet = {
  mission_snapshot: () => ({
    repos: [
      {
        root: ROOT,
        name: 'atlas-api',
        parents: [{ session_id: PARENT, pid: 4001, name: 'Order status history column', status: 'waiting', cwd: ROOT, waiting_for: 'input needed', account: 'default' }],
        missions: [],
        children: [
          { id: CHILD.slice(0, 8), session_id: CHILD, name: 'issue-398', state: 'working', tempo: 'active', needs: null, detail: 'threading the tenant through the cache key', suggested_reply: null, cwd: WORKTREE, tokens: 90_000, live: true, updated_at: new Date(now - 60_000).toISOString(), intent: 'Work on issue #398 in this repo: the cache key must carry the tenant', branch: 'fix/tenant-cache-key', timeline_len: 12, parent_session: PARENT, account: 'default' },
        ],
      },
    ],
    errors: [],
    at: new Date(now).toISOString(),
  }),
  mission_looked: {},
  nexus_feed: () => ({
    sessions: {
      [PARENT]: { activity: null, said: { text: 'The migration is written and tested on a copy. I need one decision from you before running the backfill.', at: now - 14 * 60_000 }, context: 94_000, model: 'claude-opus-5-5', topic: 'add a status_history column to orders and backfill it', title: 'Order status history column', contract: null, ask: { question: QUESTION, options: OPTIONS } },
      [CHILD.slice(0, 8)]: { activity: { tool: 'Bash', target: 'pnpm vitest run src/cache', at: now - 40_000, running: true }, said: { text: 'The key is built in one place. I am threading the tenant through it and its three callers.', at: now - 3 * 60_000 }, context: 72_000, model: 'claude-sonnet-5-5', topic: null, title: 'Tenant in every cache key', contract: null, ask: null },
    },
    prs: {},
    rate: null,
    at: now,
  }),
  worktree_list: () => [],
  pty_write: null,
  pty_resize: null,
  pty_kill: null,
}

/** One of the app's terminals runs the parent: kept in the workspace from the last run, its shell
 *  still running, so the restore brings it back and the stage draws it from the core's screen. */
const hostedParent = {
  ...fleet,
  workspace_read: { version: 1, tabs: [], panes: {}, activeTab: null, offscreen: [{ pane: 1, cwd: ROOT, sessionId: PARENT, title: 'Order status history column' }] },
  pty_list: () => [{ id: 1, cwd: ROOT, pid: 4001, alive: true }],
  pty_attach: () => bytes(ASKING),
  pty_pid: 4001,
  chrome_session: () => PARENT,
  chrome_pane_runs: () => 'claude',
  chrome_claude_running: () => true,
  workspace_live_sessions: () => [PARENT],
}

scenario('next-runtime-terminal', {
  storage: route({ v: 'console', s: PARENT }),
  ipc: appIpc(hostedParent),
  drive: (page) => page.waitForSelector('[data-live-terminal] .xterm'),
})

/** The attach's PTY: `spawned` says when the core answers the spawn. */
const attach = (spawned) => ({
  ...fleet,
  pty_spawn: async ({ onOutput }) => {
    await spawned()
    setTimeout(() => void onOutput.sendBytes(WORKING), 60)
    return 50
  },
  pty_pid: 4050,
})

scenario('next-runtime-attach', {
  storage: route({ v: 'console', s: CHILD }),
  ipc: appIpc(attach(async () => {})),
  drive: (page) => page.waitForSelector('[data-live-terminal] .xterm'),
})

scenario('next-runtime-attaching', {
  storage: route({ v: 'console', s: CHILD }),
  // The core has not answered the spawn yet.
  ipc: appIpc(attach(() => new Promise(() => {}))),
  drive: (page) => page.waitForSelector('[data-live-terminal][data-terminal-state="held"]'),
})

scenario('next-runtime-detached', {
  storage: route({ v: 'console', s: CHILD }),
  ipc: appIpc(attach(async () => {})),
  drive: async (page) => {
    await page.waitForSelector('[data-live-terminal] .xterm')
    // The app's close chord on the terminal on stage: its attach is let go, and not taken back.
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+w' : 'Control+Shift+W')
    await page.waitForSelector('[data-live-terminal][data-terminal-state="detached"]')
  },
})

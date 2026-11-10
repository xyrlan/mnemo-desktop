// The runtime's states on the stage (src/runtime/): a session's real terminal where the
// transcript would be drawn. The runtime runs only in a live world, and the live world is its own
// piece, so each scenario starts the app live (no `mnemo.world`) and then hands the world store
// the synthetic world marked live: the sessions are the sample's, the terminals are the
// fixture's.
//
//   next-runtime-terminal   a session one of the app's terminals runs, held the moment it is on stage
//   next-runtime-attach     a live child, attached to once it has stayed on stage
//   next-runtime-attaching  the same child while its attach starts
//   next-runtime-detached   its terminal let go of while it was on stage
//   next-runtime-orbit      off Console: the terminals stay held, hidden
import { scenario } from '../scenario.mjs'
import { appIpc } from '../fixtures/app.mjs'
import { sessions, sessionTitled } from '../fixtures/next.mjs'

const ESC = '\x1b['
const c = (code, s) => `${ESC}${code}m${s}${ESC}0m`
const RULE = c('2', '─'.repeat(72))

const byId = (id) => sessions.find((s) => s.id === id)
const PARENT = sessionTitled('Order status history')
const CHILD = sessionTitled('Tenant in every cache key')

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
  ` ${c('36', '❯ 1. Online, in batches (Recommended)')}`,
  `      ${c('2', 'No downtime; the backfill runs for about 40 minutes and can be paused.')}`,
  '   2. Maintenance window',
  `      ${c('2', 'Simpler migration, roughly 6 minutes of read-only mode.')}`,
  '   3. Skip the backfill',
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

/** The world store given the synthetic world as this machine's. */
const worldIsLive = (page) =>
  page.evaluate(async () => {
    const { worldStore } = await import('/src/world/store.ts')
    const { sampleWorld } = await import('/src/world/sample.ts')
    worldStore.getState().set({ ...sampleWorld(), source: 'live', errors: [] })
  })

const route = (r) => ({ 'mnemo.next': '1', 'mnemo.route': '#' + new URLSearchParams(r).toString() })
const bytes = (text) => [...new TextEncoder().encode(text)]

/** One of the app's terminals runs the parent: kept in the workspace from the last run, its shell
 *  still running, so the restore brings it back and the stage draws it from the core's screen. */
const hostedParent = {
  workspace_read: { version: 1, tabs: [], panes: {}, activeTab: null, offscreen: [{ pane: 1, cwd: byId(PARENT).cwd, sessionId: PARENT, title: byId(PARENT).title }] },
  pty_list: () => [{ id: 1, cwd: byId(PARENT).cwd, pid: 4001, alive: true }],
  pty_attach: () => bytes(ASKING),
  pty_write: null,
  pty_resize: null,
  pty_kill: null,
  pty_pid: 4001,
  chrome_session: () => PARENT,
  chrome_pane_runs: () => 'claude',
  chrome_claude_running: () => true,
  workspace_live_sessions: () => [PARENT],
}

scenario('next-runtime-terminal', {
  storage: route({ v: 'console', s: PARENT }),
  ipc: appIpc(hostedParent),
  drive: async (page) => {
    await worldIsLive(page)
    await page.waitForSelector('[data-live-terminal] .xterm')
  },
})

scenario('next-runtime-orbit', {
  storage: route({ v: 'orbit', s: PARENT }),
  ipc: appIpc(hostedParent),
  drive: worldIsLive,
})

/** The mission snapshot the child's row comes from: a live background child of the sample's
 *  first parent, in its own worktree. */
const snapshot = () => {
  const child = byId(CHILD)
  const parent = byId(child.parent)
  return {
    repos: [
      {
        root: parent.cwd,
        name: 'atlas-api',
        parents: [{ session_id: parent.id, pid: 4100, name: parent.title, status: 'busy', cwd: parent.cwd, waiting_for: null, account: 'default' }],
        missions: [],
        children: [
          { id: child.short, session_id: child.id, name: 'issue-398', state: 'working', tempo: 'active', needs: null, detail: 'threading the tenant', suggested_reply: null, cwd: child.cwd, tokens: 90_000, live: true, updated_at: null, intent: null, branch: null, timeline_len: 12, parent_session: parent.id, account: 'default' },
        ],
      },
    ],
    errors: [],
    at: '2026-11-09T21:30:00Z',
  }
}

/** The attach's PTY: `spawned` says when the core answers the spawn. */
const attach = (spawned) => ({
  mission_snapshot: snapshot,
  mission_looked: {},
  pty_spawn: async ({ onOutput }) => {
    await spawned()
    setTimeout(() => void onOutput.sendBytes(WORKING), 60)
    return 50
  },
  pty_write: null,
  pty_resize: null,
  pty_kill: null,
  pty_pid: 4050,
})

scenario('next-runtime-attach', {
  storage: route({ v: 'console', s: CHILD }),
  ipc: appIpc(attach(async () => {})),
  drive: async (page) => {
    await worldIsLive(page)
    await page.waitForSelector('[data-live-terminal] .xterm')
  },
})

scenario('next-runtime-attaching', {
  storage: route({ v: 'console', s: CHILD }),
  // The core has not answered the spawn yet.
  ipc: appIpc(attach(() => new Promise(() => {}))),
  drive: async (page) => {
    await worldIsLive(page)
    await page.waitForSelector('[data-live-terminal][data-terminal-state="held"]')
  },
})

scenario('next-runtime-detached', {
  storage: route({ v: 'console', s: CHILD }),
  ipc: appIpc(attach(async () => {})),
  drive: async (page) => {
    await worldIsLive(page)
    await page.waitForSelector('[data-live-terminal] .xterm')
    // The app's close chord on the terminal on stage: its attach is let go, and not taken back.
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+w' : 'Control+Shift+W')
    await page.waitForSelector('[data-live-terminal][data-terminal-state="detached"]')
  },
})

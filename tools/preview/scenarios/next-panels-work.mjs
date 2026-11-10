// The work panels of the recreation (src/panels/{projects,missions,changes}) over the synthetic
// world. A panel reads the app's own stores, not the world, so each scenario answers what those
// stores ask: Home's snapshot, the mission snapshot, a repo's contract folders, a worktree's
// diff. Every name, path and line below is invented, in the sample world's own projects.
import { scenario } from '../scenario.mjs'
import { HOME } from '../fixtures/app.mjs'
import { next, sessions, sessionTitled } from '../fixtures/next.mjs'

const AT = Date.parse('2026-11-09T21:30:00Z')
const root = (project) => `${HOME}/work/${project}`

const PROJECTS = ['atlas-api', 'lumen-web', 'tessera', 'harbor-cli']

/** A sample session as Home lists it. */
const homeSession = (s) => ({
  id: s.id,
  title: s.title,
  cwd: s.cwd.replace('~', HOME),
  last_at: Date.parse(s.lastAt ?? '2026-11-09T21:00:00Z'),
  transcript: true,
  live: s.live ? (s.role === 'parent' ? 'here' : 'bg') : null,
  kind: s.role === 'parent' ? 'interactive' : 'background',
  agent: null,
})

const issue = (number, title, labels = [], over = {}) => ({
  number,
  title,
  labels,
  assignees: [],
  state: 'OPEN',
  url: `https://github.com/example/atlas-api/issues/${number}`,
  updated_at: '2026-11-09T20:00:00Z',
  milestone: null,
  prs: [],
  pieces: [],
  ...over,
})

const ISSUES = {
  'atlas-api': [
    issue(465, 'Webhook signature check before parsing', ['security']),
    issue(397, 'Forward-only migration for invoices', ['db']),
    issue(327, 'Cursor pagination for /orders', ['api'], { prs: [412] }),
    issue(305, 'Tenant in every cache key', ['cache']),
    issue(512, 'Rate-limit the export endpoint per tenant', ['api']),
    issue(518, 'Paginate the audit log and keep the newest page warm', ['api', 'perf']),
    issue(521, 'A retry budget per tenant, so one noisy tenant cannot starve the queue', ['billing']),
    issue(530, 'Drop the legacy invoice renderer', ['cleanup']),
  ],
  'lumen-web': [
    issue(311, 'Empty state for the orders table', ['ui']),
    issue(340, 'Keyboard navigation in the orders table', ['ui', 'a11y']),
    issue(344, 'Remember the last filter per screen', ['ui']),
  ],
  tessera: [issue(88, 'Validate a plugin manifest before loading it', ['plugins'])],
}

const PRS = {
  'atlas-api': [
    { number: 412, title: 'orders: cursor pagination, offset kept behind a flag', state: 'open', checks: 'pass', child: '841cb39e', url: 'https://github.com/example/atlas-api/pull/412' },
    { number: 418, title: 'billing: verify the webhook before it is parsed', state: 'draft', checks: 'pending', child: null, url: 'https://github.com/example/atlas-api/pull/418' },
  ],
  'lumen-web': [{ number: 233, title: 'orders: an empty state that says what to do next', state: 'open', checks: 'pending', child: '2144d649', url: 'https://github.com/example/lumen-web/pull/233' }],
}

function homeSnapshot({ github = true } = {}) {
  return {
    repos: PROJECTS.map((name, i) => {
      const mine = sessions.filter((s) => s.project === name)
      return {
        root: root(name),
        name,
        last_at: AT - i * 3_600_000,
        pinned: false,
        hidden: false,
        unresolved: false,
        sessions: mine.filter((s) => s.role === 'parent').map(homeSession),
        children: mine.filter((s) => s.role === 'child').map(homeSession),
        issues: github ? (ISSUES[name] ?? []) : [],
        prs: github ? (PRS[name] ?? []) : [],
      }
    }),
    clone_base: `${HOME}/work`,
    errors: [],
    protected: 0,
  }
}

/** A sample child as the mission snapshot has it. */
function child(titleStart, over = {}) {
  const s = sessions.find((x) => x.title.startsWith(titleStart))
  return {
    id: s.short,
    session_id: s.id,
    name: s.title,
    state: s.state === 'ended' || s.state === 'ready' ? 'done' : 'working',
    tempo: s.state === 'need' ? 'blocked' : s.state === 'stalled' ? 'stalled' : 'active',
    needs: null,
    detail: '',
    suggested_reply: null,
    cwd: s.cwd.replace('~', HOME),
    tokens: 0,
    live: !!s.live,
    updated_at: s.lastAt ?? null,
    intent: null,
    branch: s.branch,
    timeline_len: 0,
    account: 'default',
    ...over,
  }
}

const pr = (number, ci, head) => ({ number, url: `https://github.com/example/atlas-api/pull/${number}`, state: 'OPEN', head, ci })
const CONTRACT = 'docs/superpowers/contracts/2026-11-08-billing-webhooks.md'

function missionSnapshot() {
  return {
    at: '2026-11-09T21:30:00Z',
    errors: [],
    repos: [
      {
        root: root('atlas-api'),
        name: 'atlas-api',
        parents: [],
        children: [
          child('Webhook signature check', { live: true }),
          child('Forward-only migration', { live: true }),
          child('Cursor pagination', { pr: pr(412, 'pass', 'fix/issue-327') }),
          child('Tenant in every cache key', { live: true }),
        ],
        missions: [
          {
            feature: 'billing-webhooks',
            contract_path: `${root('atlas-api')}/${CONTRACT}`,
            landable: true,
            pieces: [
              { name: 'verify', branch: 'feat/billing-webhooks/verify', child: null, pr: pr(431, 'pass', 'feat/billing-webhooks/verify') },
              { name: 'retries', branch: 'feat/billing-webhooks/retries', child: null, pr: pr(432, 'pass', 'feat/billing-webhooks/retries') },
              { name: 'docs', branch: 'feat/billing-webhooks/docs', child: null, pr: pr(433, 'pass', 'feat/billing-webhooks/docs') },
            ],
          },
        ],
      },
      {
        root: root('lumen-web'),
        name: 'lumen-web',
        parents: [],
        children: [child('Empty state for the orders table', { pr: pr(233, 'pending', 'fix/issue-311') })],
        missions: [
          {
            feature: 'orders-screen',
            contract_path: `${root('lumen-web')}/docs/superpowers/contracts/2026-11-07-orders-screen.md`,
            landable: false,
            pieces: [
              { name: 'table', branch: 'feat/orders-screen/table', child: null, pr: pr(240, 'pass', 'feat/orders-screen/table') },
              { name: 'filters', branch: 'feat/orders-screen/filters', child: null, pr: pr(241, 'fail', 'feat/orders-screen/filters') },
              { name: 'export', branch: 'feat/orders-screen/export', child: null, pr: null },
            ],
          },
        ],
      },
    ],
  }
}

const QUICK = {
  [root('atlas-api')]: [
    { label: 'dev', command: 'pnpm dev' },
    { label: 'test billing', command: 'pnpm test --run billing' },
    { label: 'migrate', command: 'pnpm db:migrate' },
  ],
  [root('lumen-web')]: [{ label: 'storybook', command: 'pnpm storybook' }],
}

/** What every scenario here answers: Home, the missions, the saved commands, a repo's contracts. */
const work = (over = {}) => ({
  home_snapshot: () => homeSnapshot(),
  mission_snapshot: () => missionSnapshot(),
  mission_looked: () => ({}),
  settings_read: () => ({ quickCommands: QUICK, projects: PROJECTS.map(root) }),
  fs_list: ({ dir }) => {
    if (dir === `${root('atlas-api')}/docs/superpowers/contracts`)
      return ['2026-11-08-billing-webhooks.md', '2026-11-09-tenant-cache.md', '2026-11-02-audit-log.md'].map((name) => ({ name, is_dir: false }))
    throw new Error('No such file or directory (os error 2)')
  },
  ...over,
})

const press = async (page, ...keys) => {
  for (const key of keys) await page.keyboard.press(key)
}

// ── Projects ────────────────────────────────────────────────────────────────────────────────

const onConsole = { v: 'console', s: sessionTitled('Idempotent retries') }

scenario('next-projects', next({ ...onConsole, panel: 'projects' }, work()))

// The cursor on the second repo, a session asked for: the sample world says what it did not do.
scenario('next-projects-said', {
  ...next({ ...onConsole, panel: 'projects' }, work()),
  drive: (page) => press(page, 'ArrowDown', 'Enter'),
})

// A saved command being written.
scenario('next-projects-command', {
  ...next({ ...onConsole, panel: 'projects' }, work()),
  drive: async (page) => {
    await press(page, '+')
    await page.keyboard.type('lint')
    await page.keyboard.press('Tab')
    await page.keyboard.type('pnpm lint --fix')
  },
})

// A repo being cloned: where it lands is said before it starts.
scenario('next-projects-clone', {
  ...next({ ...onConsole, panel: 'projects' }, work()),
  drive: async (page) => {
    await press(page, 'g')
    await page.keyboard.type('example/quill-docs')
  },
})

scenario('next-projects-filter', {
  ...next({ ...onConsole, panel: 'projects' }, work()),
  drive: async (page) => {
    await press(page, '/')
    await page.keyboard.type('zzz')
  },
})

scenario('next-projects-empty', next({ v: 'orbit', panel: 'projects' }, work({ home_snapshot: () => ({ repos: [], clone_base: `${HOME}/work`, errors: [], protected: 0 }), settings_read: () => ({}) })))

// ── Missions ────────────────────────────────────────────────────────────────────────────────

scenario('next-missions', next({ ...onConsole, panel: 'missions' }, work()))

// Three issues picked, the flags set: what Enter does is at the foot.
const pickThree = async (page) => {
  // Past the mission and the four issues in flight, to the first that can be dispatched.
  await press(page, 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'Space', 'ArrowDown', 'ArrowDown', 'Shift+Space')
  await press(page, 'm', 'm', 'm', 'e', 'e', 'e', 'y', 'v', 'v', 'v')
}
scenario('next-missions-picked', { ...next({ ...onConsole, panel: 'missions' }, work()), drive: pickThree })

// Dispatched, a contract dispatched, a mission landed: each stays listed with how it is going.
scenario('next-missions-launched', {
  ...next({ ...onConsole, panel: 'missions' }, work()),
  drive: async (page) => {
    await pickThree(page)
    await press(page, 'Enter')
    // The picker reads the repo's contract folders before it offers one.
    await press(page, 'p')
    await page.locator('[data-contract-picker] [role=radio]').first().waitFor()
    await press(page, 'Enter')
    await press(page, 'l', 'Enter')
  },
})

// A mission that can land, armed: Enter lands it.
scenario('next-missions-land', {
  ...next({ ...onConsole, panel: 'missions' }, work()),
  drive: (page) => press(page, 'l'),
})

// The repo's contracts, one of them dispatched before.
scenario('next-missions-contract', {
  ...next({ ...onConsole, panel: 'missions' }, work()),
  drive: (page) => press(page, 'p'),
})

// GitHub not read yet.
scenario('next-missions-reading', next({ v: 'orbit', panel: 'missions' }, work({ home_snapshot: () => homeSnapshot({ github: false }), mission_snapshot: () => ({ repos: [], errors: [], at: '2026-11-09T21:30:00Z' }), home_refresh_github: () => new Promise(() => {}) })))

// ── Changes ─────────────────────────────────────────────────────────────────────────────────

const WEBHOOK = sessionTitled('Webhook signature check')
const TREE = '~/work/atlas-api-wt-webhook'

const WEBHOOK_BEFORE = `import type { Request, Response } from 'express'
import { parseEvent } from './events'
import { enqueue } from '../queue'
import { logger } from '../lib/logger'

const TOLERANCE_S = 300

export async function webhook(req: Request, res: Response) {
  const event = parseEvent(req.body)
  if (!event) {
    logger.warn('webhook: unreadable body')
    return res.status(400).end()
  }

  const signature = req.header('x-billing-signature')
  if (!signature) return res.status(401).end()

  await enqueue('billing', event)
  logger.info('webhook: queued', { id: event.id, type: event.type })
  return res.status(202).end()
}

export function isFresh(timestamp: number, now = Date.now() / 1000) {
  return Math.abs(now - timestamp) <= TOLERANCE_S
}
`

const WEBHOOK_AFTER = `import type { Request, Response } from 'express'
import { parseEvent } from './events'
import { verify } from './signature'
import { enqueue } from '../queue'
import { logger } from '../lib/logger'
import { rawBody } from '../lib/raw-body'

const TOLERANCE_S = 300

export async function webhook(req: Request, res: Response) {
  // The signature covers the bytes as they arrived: check it before anything reads them.
  const signature = req.header('x-billing-signature')
  if (!signature) return res.status(401).end()

  const body = await rawBody(req)
  const checked = verify(body, signature, process.env.BILLING_WEBHOOK_SECRET ?? '')
  if (!checked.ok) {
    logger.warn('webhook: bad signature', { why: checked.why })
    return res.status(401).end()
  }
  if (!isFresh(checked.timestamp)) return res.status(408).end()

  const event = parseEvent(body)
  if (!event) {
    logger.warn('webhook: unreadable body')
    return res.status(400).end()
  }

  await enqueue('billing', event, { idempotencyKey: event.id })
  logger.info('webhook: queued', { id: event.id, type: event.type })
  return res.status(202).end()
}

export function isFresh(timestamp: number, now = Date.now() / 1000) {
  return Math.abs(now - timestamp) <= TOLERANCE_S
}
`

const SIGNATURE = `import { createHmac, timingSafeEqual } from 'node:crypto'

export type Checked = { ok: true; timestamp: number } | { ok: false; why: string }

/** \`t=<unix>,v1=<hex>\`: the timestamp and the HMAC of \`<t>.<body>\`. */
export function verify(body: Buffer, header: string, secret: string): Checked {
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]))
  const timestamp = Number(parts.t)
  if (!Number.isFinite(timestamp) || !parts.v1) return { ok: false, why: 'malformed header' }
  const want = createHmac('sha256', secret).update(\`\${timestamp}.\`).update(body).digest()
  const got = Buffer.from(parts.v1, 'hex')
  if (got.length !== want.length || !timingSafeEqual(got, want)) return { ok: false, why: 'signature mismatch' }
  return { ok: true, timestamp }
}
`

const FILES = [
  { path: 'src/billing/webhook.ts', oldPath: null, status: 'modified', additions: 16, deletions: 5, binary: false },
  { path: 'src/billing/signature.ts', oldPath: null, status: 'added', additions: 14, deletions: 0, binary: false },
  { path: 'src/lib/raw-body.ts', oldPath: null, status: 'added', additions: 18, deletions: 0, binary: false },
  { path: 'tests/billing/webhook.test.ts', oldPath: null, status: 'modified', additions: 52, deletions: 4, binary: false },
  { path: 'src/billing/verify.ts', oldPath: 'src/billing/legacy-verify.ts', status: 'renamed', additions: 3, deletions: 3, binary: false },
  { path: 'docs/webhooks.md', oldPath: null, status: 'modified', additions: 6, deletions: 2, binary: false },
  { path: 'src/billing/unsigned.ts', oldPath: null, status: 'deleted', additions: 0, deletions: 27, binary: false },
  { path: 'docs/img/webhook-flow.png', oldPath: null, status: 'added', additions: null, deletions: null, binary: true },
]

const SIDES = {
  'src/billing/webhook.ts': { original: WEBHOOK_BEFORE, modified: WEBHOOK_AFTER },
  'src/billing/signature.ts': { original: '', modified: SIGNATURE },
}

const changes = (over = {}) =>
  work({
    worktree_diff_files: () => ({ root: `${HOME}/work/atlas-api-wt-webhook`, files: FILES, truncated: false, base: 'main @ 4c1d9e2' }),
    worktree_diff_file: ({ file }) => ({ original: '', modified: '', binary: file.endsWith('.png'), tooLarge: false, ...(SIDES[file] ?? {}) }),
    ...over,
  })

/** Notes kept from before, as the diff store keeps them. */
const NOTES = JSON.stringify([
  { id: 'n1', worktreeId: TREE, filePath: 'src/billing/webhook.ts', lineNumber: 16, body: 'Read the secret once at boot and fail the start when it is missing; an empty secret verifies anything signed with an empty secret.', quote: '', createdAt: AT - 600_000 },
  { id: 'n2', worktreeId: TREE, filePath: 'src/billing/webhook.ts', startLine: 28, lineNumber: 29, body: 'Good. Say in the PR that the key is the event id.', quote: '', createdAt: AT - 300_000 },
  { id: 'n3', worktreeId: TREE, filePath: 'src/billing/signature.ts', lineNumber: 8, body: 'More than one v1 can be sent while a secret rotates.', quote: '', createdAt: AT - 200_000 },
])
const withNotes = (setup) => ({ ...setup, storage: { ...setup.storage, 'mnemo-desktop.diff-comments': NOTES } })

const onWebhook = { v: 'console', s: WEBHOOK, panel: 'changes' }

scenario('next-changes', next(onWebhook, changes()))

scenario('next-changes-notes', withNotes(next(onWebhook, changes())))

scenario('next-changes-split', { ...withNotes(next(onWebhook, changes())), drive: (page) => press(page, 'v') })

// A note being written on a line of an added file.
scenario('next-changes-writing', {
  ...next(onWebhook, changes()),
  drive: async (page) => {
    await press(page, 'ArrowDown')
    await page.getByRole('button', { name: 'Note on line 10', exact: true }).click()
    await page.keyboard.type('Compare lengths first, as here. Keep it.')
  },
})

// The notes sent: the sample world takes them as a reply.
scenario('next-changes-sent', { ...withNotes(next(onWebhook, changes())), drive: (page) => press(page, 's') })

scenario('next-changes-none', next(onWebhook, changes({ worktree_diff_files: () => ({ root: `${HOME}/work/atlas-api-wt-webhook`, files: [], truncated: false, base: 'main @ 4c1d9e2' }) })))

scenario('next-changes-gone', next(onWebhook, changes({ worktree_diff_files: () => { throw new Error('git: No such file or directory (os error 2)') } })))

// No session selected: whose changes.
scenario('next-changes-choose', next({ v: 'orbit', panel: 'changes' }, changes()))

// The system panels of the recreation (memory, learned, accounts, setup, settings) over the
// synthetic world, one scenario per state worth looking at. A panel reads the vault, the
// accounts, the tools and the settings through the stores the ship's windows use, so each
// scenario answers the commands those stores ask. Every name, path and number here is invented,
// in the sample world's own projects.
import { scenario } from '../scenario.mjs'
import { next, sessionTitled } from '../fixtures/next.mjs'

const HOME = '/Users/preview'
const VAULT = `${HOME}/mnemo`
const WORK = `${HOME}/work`
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const now = Date.now()
const ok = (stdout) => ({ stdout, stderr: '', code: 0 })

const PROJECTS = ['lumen-web', 'atlas-api', 'harbor-cli', 'tessera']
const root = (name) => `${WORK}/${name}`
const home_snapshot = () => ({
  repos: PROJECTS.map((name, i) => ({ root: root(name), name, last_at: Math.floor((now - i * HOUR) / 1000), pinned: false, hidden: false, unresolved: false, sessions: [], children: [] })),
  clone_base: WORK,
  errors: [],
  protected: 0,
})

// ---------------------------------------------------------------- the vault

const dirOf = (agent) => (agent === 'shared' ? `${VAULT}/shared` : `${VAULT}/bots/${agent}/memory`)
const ACRONYMS = /\b(ui|css|js|api|utc|pr|kb)\b/gi
const sentence = (slug) => (slug[0].toUpperCase() + slug.slice(1).replace(/-/g, ' ')).replace(ACRONYMS, (w) => (w.toLowerCase() === 'kb' ? 'kB' : w.toUpperCase()))

/** agent, type, slug, description, confidence, fires, last fired (days ago), heat, topics, badges, reasons */
const RULES = [
  ['shared', 'feedback', 'dispatch-children-push-before-stop', 'A dispatched child pushes its branch before it stops, or its work reaches no one.', 'verified', 31, 0, 5.0, ['dispatch', 'git']],
  ['atlas-api', 'feedback', 'retry-with-idempotency-key', 'A retried write carries the key of the first try, so it lands once.', 'verified', 22, 0, 4.8, ['billing', 'webhooks']],
  ['lumen-web', 'feedback', 'optimistic-ui-rolls-back-on-409', 'An optimistic update is undone when the server answers 409.', 'verified', 14, 0, 4.2, ['ui', 'orders']],
  ['atlas-api', 'project', 'webhook-signature-before-parse', 'The signature is checked on the raw body, before any JSON is read.', 'verified', 17, 1, 4.1, ['webhooks', 'security']],
  ['atlas-api', 'project', 'cache-key-includes-tenant', 'Every cache key starts with the tenant, or one tenant reads another.', 'verified', 12, 0, 3.3, ['cache', 'tenancy']],
  ['lumen-web', 'feedback', 'css-animations-over-js-motion', 'Motion is CSS on transform and opacity; no timer runs at rest.', 'verified', 9, 1, 3.1, ['ui', 'motion']],
  ['atlas-api', 'project', 'migrations-are-forward-only', 'A migration is never edited after it ran anywhere; a new one corrects it.', 'verified', 11, 2, 2.9, ['database']],
  ['shared', 'feedback', 'changelog-entry-per-change', 'Each change a user can see adds its line to the changelog.', 'verified', 9, 2, 2.4, ['release']],
  ['lumen-web', 'project', 'image-upload-unique-key-per-version', 'An uploaded image gets a new key per version, so a cache never serves the old one.', 'ci', 6, 3, 2.2, ['uploads', 'cache']],
  ['atlas-api', 'feedback', 'never-mock-the-database-in-integration', 'Integration tests run on a real database; a mock hid two bugs.', 'verified', 8, 3, 2.0, ['testing', 'database']],
  ['shared', 'reference', 'paths-compare-as-paths-on-windows', 'Paths are compared normalised, never as strings.', 'verified', 7, 4, 1.9, ['windows', 'paths']],
  ['atlas-api', 'reference', 'timezones-store-utc-render-local', 'Times are stored in UTC and shown in the reader’s zone.', 'ci', 6, 5, 1.7, ['time']],
  ['harbor-cli', 'project', 'flags-before-positionals', 'Flags are read before positionals, as the help says.', 'verified', 6, 6, 1.5, ['cli']],
  ['lumen-web', 'project', 'orders-table-virtualized-past-200', 'The orders table draws only the rows on screen past 200.', 'verified', 4, 8, 1.4, ['orders', 'performance']],
  ['atlas-api', 'feedback', 'feature-flag-default-off', 'A new flag ships off, and is turned on per tenant.', 'verified', 5, 9, 1.2, ['release']],
  ['shared', 'feedback', 'run-the-whole-suite-before-a-push', 'The whole suite runs before a push, not the file that changed.', 'inferred', 4, 10, 1.1, ['testing', 'git']],
  ['harbor-cli', 'project', 'exit-codes-are-part-of-the-contract', 'A script reads the exit code: 2 is "could not run", never 1.', 'ci', 4, 12, 1.0, ['cli']],
  ['atlas-api', 'project', 'pagination-cursor-not-offset', 'Lists page by cursor; an offset skips rows under writes.', 'inferred', 3, 14, 0.9, ['api'], ['inbox']],
  ['shared', 'user', 'answer-in-the-language-asked', 'Replies are in the language the question came in.', 'verified', 3, 15, 0.8, []],
  ['tessera', 'project', 'manifest-version-is-semver', 'A plugin manifest’s version is semver, and is compared as one.', 'verified', 3, 16, 0.7, ['plugins']],
  ['lumen-web', 'feedback', 'empty-states-say-what-to-do', 'An empty list says what to do next, not only that it is empty.', 'inferred', 2, 20, 0.6, ['ui']],
  ['atlas-api', 'reference', 'log-request-id-everywhere', 'Every log line carries the request id.', 'observed', 2, 41, 0.5, ['observability'], ['review'], ['has activates_on, last fired 41 days ago']],
  ['lumen-web', 'reference', 'dark-theme-contrast-ratio', 'Text on the dark theme holds 4.5:1 against its ground.', 'verified', 1, 30, 0.3, ['ui', 'a11y'], ['review'], ['verified without evidence']],
  ['tessera', 'project', 'plugins-load-in-declared-order', 'Plugins load in the order the manifest declares.', 'observed', 1, 35, 0.2, ['plugins'], ['review'], ['verified without evidence']],
  ['lumen-web', 'project', 'bundle-budget-is-180-kb', 'The entry bundle stays under 180 kB gzipped.', 'verified', 0, null, 0, ['performance'], ['never']],
  ['lumen-web', 'feedback', 'storybook-is-not-the-source-of-truth', 'A component is right when the app shows it right.', 'demoted', 0, null, 0, ['ui'], ['never']],
  ['harbor-cli', 'reference', 'shell-completions-are-generated', 'Completions are generated from the command tree at build.', 'inferred', 0, null, 0, ['cli'], ['never']],
].map(([agent, type, slug, description, confidence, fires, days, heat, topics, badges = [], reasons = []]) => ({
  path: `${dirOf(agent)}/${type}/${slug}.md`,
  slug,
  name: sentence(slug),
  description,
  type,
  agent,
  confidence,
  topics,
  fires,
  last_fired: days === null ? null : now - days * DAY - 2 * HOUR,
  heat,
  badges,
  reasons,
}))

const ruleAt = (path) => RULES.find((r) => r.path === path)
const pathOf = (slug) => RULES.find((r) => r.slug === slug).path

const BODY = {
  'optimistic-ui-rolls-back-on-409': `# Optimistic UI rolls back on 409

The orders screen shows an edit before the server has answered. When the answer is **409**, the row goes back to what the server holds and says so in place.

## Why

Two people edited one order in March and the second save was shown as kept while the server had refused it.

## How to apply

- Keep the server's copy of the row beside the optimistic one.
- On 409, put it back and show \`This order changed since you opened it\`.
- Never retry a 409 by itself: see [[retry-with-idempotency-key]].

\`\`\`ts
if (res.status === 409) rollback(row.id, res.current)
\`\`\`

The contract is in [the orders API notes](https://example.org/docs/orders#conflicts).`,
}
const bodyOf = (r) => BODY[r.slug] ?? `# ${r.name}\n\n${r.description}\n\n## How to apply\n\n- Check it before the change, not after.\n- When it does not hold, say so in the pull request.`

const pageInfo = (r) => ({ path: r.path, slug: r.slug, name: r.name, description: r.description, type: r.type, confidence: r.confidence, topics: r.topics, modified: now - 6 * DAY, body: bodyOf(r) })
const BRIEFING = `${dirOf('lumen-web')}/briefings/sessions/2026-11-09-5efebf83.md`
const vault_page = ({ path }) => {
  const r = ruleAt(path)
  if (r) {
    return {
      ...pageInfo(r),
      runtime: r.type === 'feedback' ? 'reflex' : null,
      frontmatter: [
        { key: 'name', value: r.name },
        { key: 'type', value: r.type },
        { key: 'confidence', value: r.confidence },
        { key: 'topics', value: r.topics.join(', ') },
        ...(r.confidence === 'verified' && !r.reasons.includes('verified without evidence') ? [{ key: 'evidence', value: 'tests/orders/conflict.test.ts' }] : []),
      ],
      error: null,
    }
  }
  if (path === BRIEFING) {
    return {
      path,
      slug: '2026-11-09-5efebf83',
      name: 'Session briefing, 2026-11-09',
      description: 'Optimistic updates on the orders screen.',
      type: 'briefing',
      confidence: null,
      topics: [],
      modified: now - 5 * HOUR,
      body: '# Optimistic updates on the orders screen\n\nOptimistic updates are in for edit and cancel, with a rollback on 409.\n\n## Next\n\n- The empty state of the orders table.\n- The same treatment for refunds.',
      runtime: null,
      frontmatter: [{ key: 'session', value: '5efebf83' }],
      error: null,
    }
  }
  throw `no page at ${path}`
}

const vault_tree = () => {
  const agents = ['shared', ...PROJECTS].map((name) => {
    const rows = RULES.filter((r) => r.agent === name)
    const types = [...new Set(rows.map((r) => r.type))]
    return { name, kind: name === 'shared' ? 'shared' : 'repo', dir: dirOf(name), groups: types.map((type) => ({ type, pages: rows.filter((r) => r.type === type).map(pageInfo) })) }
  })
  const noise = (name) => ({ name, kind: 'other', dir: dirOf(name), groups: [{ type: 'user', pages: [{ path: `${dirOf(name)}/user/scratch.md`, slug: 'scratch', name: 'Scratch', description: '', type: 'user', confidence: null, topics: [], modified: null, body: '' }] }] })
  return [...agents, noise('bg-suite-1'), noise('bg-suite-2')]
}

const vault_rules = ({ scope, filter }) => {
  const terms = String(filter ?? '').toLowerCase().split(/\s+/).filter(Boolean)
  const agent = String(scope ?? '').startsWith('agent:') ? scope.slice(6) : null
  return RULES.filter((r) => (!agent || r.agent === agent) && terms.every((t) => `${r.name} ${r.slug} ${r.description} ${r.topics.join(' ')}`.toLowerCase().includes(t)))
}

const STATUS = `mnemo 1.12.0
vault: ${VAULT}
reflex: injected on 219 of 1039 prompts (21.1%)
recall: primacy@5 41.2% over 90 cases (mnemo recall, 2026-11-02)
Briefings: 412 across 6 agents (3.1 MB) — 0 prunable
Circuit breaker: closed (ok)`
const review = (r) => ({ path: r.path, slug: r.slug, name: r.name, reason: r.reasons[0] })
const vault_health = () => ({
  root: VAULT,
  status: ok(STATUS),
  tiles: [
    { key: 'reflex', label: 'reflex injected', value: '21.1%', detail: '219 of 1039 prompts', tone: 'muted' },
    { key: 'recall', label: 'recall primacy@5', value: '41.2%', detail: 'over 90 cases', tone: 'muted' },
    { key: 'briefings', label: 'briefings', value: '412', detail: 'across 6 agents (3.1 MB)', tone: 'muted' },
    { key: 'breaker', label: 'circuit breaker', value: 'closed', detail: 'ok', tone: 'ok' },
  ],
  label_only: RULES.filter((r) => r.reasons.includes('verified without evidence')).map(review),
  dormant: RULES.filter((r) => r.reasons.some((x) => x.startsWith('has activates_on'))).map(review),
  pages: 4160,
  never_fired: 3,
  inbox: 7,
  error: null,
})
const DOCTOR = `mnemo doctor
  ok   vault at ${VAULT}
  ok   hooks installed for Claude Code
  ok   index is current (4160 pages)
  warn 3 pages cite files that are gone at HEAD
  ok   circuit breaker closed`

const node = (r) => ({ id: r.path, label: r.name, slug: r.slug, type: r.type, confidence: r.confidence, topics: r.topics, fires: r.fires, last_fired: r.last_fired })
const vault_ego = ({ path }) => {
  const centre = ruleAt(path)
  if (!centre) return { center: path, nodes: [], edges: [], total: 0, error: null }
  const linked = centre.slug === 'optimistic-ui-rolls-back-on-409' ? [ruleAt(pathOf('retry-with-idempotency-key'))] : []
  const topical = RULES.filter((r) => r !== centre && !linked.includes(r) && r.topics.some((t) => centre.topics.includes(t))).slice(0, 5)
  return {
    center: path,
    nodes: [centre, ...linked, ...topical].map(node),
    edges: [
      ...linked.map((r, i) => ({ id: `l${i}`, source: path, target: r.path, kind: 'link', label: '' })),
      ...topical.map((r, i) => ({ id: `t${i}`, source: path, target: r.path, kind: 'topic', label: r.topics.filter((t) => centre.topics.includes(t)).join(', ') })),
    ],
    total: linked.length + topical.length,
    error: null,
  }
}

const STAGED = [
  ['feedback/lumen-web__confirm-before-bulk-cancel', 'new', 1, 'Cancelling several orders at once asks first, and names how many.'],
  ['project/lumen-web__orders-poll-every-30s', 'new', 2, 'The orders screen reads again every 30 s while it shows.'],
  ['reference/lumen-web__design-tokens-live-in-one-file', 'rewrite', 4, 'Colours and sizes come from tokens.css; nothing is hard-coded.'],
  ['feedback/lumen-web__screenshots-in-every-ui-pr', 'held', 6, 'A pull request that changes a screen carries a picture of it.'],
]
const INBOX = `${STAGED.length} staged pages for lumen-web in shared/_inbox/ (median 3d, oldest 6d)

${STAGED.map(([key, reason, age, text]) => `  ${key}   ${reason}   ${age}d  ${text}`).join('\n')}

nothing was written — this is a listing only.
  (3 more staged for other projects — \`mnemo inbox --all\`)
`
const INBOX_STATS = `7 staged in shared/_inbox/ (median 3d, oldest 9d)
last 30 days: 26 offered at session start, 14 promoted, 5 dropped (19 resolved)
held pages expired unreviewed: 2, restored: 1
median offer → decision: 1.5d
`
const SHOWN = `---
name: Confirm before a bulk cancel
type: feedback
origin: extraction
staged_at: 2026-11-09T14:02:11
---
# Confirm before a bulk cancel

Cancelling several orders at once asks first, and the question names **how many** and their total.

## Why

A slip of the hand cancelled 40 orders in the demo tenant; each had to be restored by hand.

## How to apply

- One order: no question, Undo is enough.
- More than one: \`Cancel 12 orders (R$ 4,180)?\`, with the cancel button second.
`
const WHY = JSON.stringify([
  { ts: new Date(now - 4 * MIN).toISOString(), project: 'lumen-web', emitted: ['lumen-web__optimistic-ui-rolls-back-on-409'], scores: [3.4], silence_reason: null, candidates: [['lumen-web__optimistic-ui-rolls-back-on-409', 3.4], ['atlas-api__retry-with-idempotency-key', 2.1]] },
  { ts: new Date(now - 26 * MIN).toISOString(), project: 'lumen-web', emitted: [], scores: [], silence_reason: 'judge_none_relevant', candidates: [['lumen-web__optimistic-ui-rolls-back-on-409', 2.2], ['lumen-web__css-animations-over-js-motion', 1.9]] },
  { ts: new Date(now - 3 * HOUR).toISOString(), project: 'lumen-web', emitted: ['lumen-web__optimistic-ui-rolls-back-on-409', 'lumen-web__empty-states-say-what-to-do'], scores: [3.9, 2.6], silence_reason: null, candidates: [] },
])
const STALE = JSON.stringify({ stale: [{ slug: 'lumen-web__orders-table-virtualized-past-200', page: pathOf('orders-table-virtualized-past-200'), missing: [{ path: 'src/orders/Table.tsx', moved_to: 'src/orders/table/Table.tsx' }] }] })

const vault_run = ({ action, args }) => {
  const [first] = args
  if (action === 'stale') return ok(STALE)
  if (action === 'why') return ok(WHY)
  if (action === 'reverify') return ok('reverify (dry run): 3 rules cite code that changed since they were verified\n  lumen-web  orders-table-virtualized-past-200\n  atlas-api  pagination-cursor-not-offset\n  atlas-api  log-request-id-everywhere\nnothing was written.')
  if (action === 'status') return ok(STATUS)
  if (action === 'inbox') {
    if (first === '--stats') return ok(INBOX_STATS)
    if (first === '--show') return ok(SHOWN)
    if (first === '--promote') return ok(`promoted ${args[1]}`)
    if (first === '--drop') return ok(`dropped ${args[1]} (archived; mnemo inbox --restore ${args[1]})`)
    return ok(INBOX)
  }
  return ok('')
}

const memory_feed = ({ cwd }) => ({
  project: String(cwd).split('/').pop(),
  briefing: {
    sessionId: '5efebf83-97ae-4a7a-a52d-f220905bf713',
    date: '2026-11-09',
    tldr: 'Optimistic updates are in for edit and cancel on the orders screen, with a rollback on 409 that says so in place. The empty state of the orders table is next; refunds should get the same treatment after it.',
    path: BRIEFING,
  },
  fired: [
    { slug: 'optimistic-ui-rolls-back-on-409', name: 'Optimistic UI rolls back on 409', at: now - 4 * MIN, source: 'reflex' },
    { slug: 'css-animations-over-js-motion', name: 'CSS animations over JS motion', at: now - 31 * MIN, source: 'reflex' },
    { slug: 'dispatch-children-push-before-stop', name: 'Dispatch children push before stop', at: now - 2 * HOUR, source: 'mcp' },
    { slug: 'changelog-entry-per-change', name: 'Changelog entry per change', at: now - 5 * HOUR, source: 'denial' },
    { slug: 'image-upload-unique-key-per-version', name: 'Image upload unique key per version', at: now - 26 * HOUR, source: 'reflex' },
  ],
  learned: [
    { slug: 'cache-key-includes-tenant', name: 'Cache key includes tenant', at: now - 2 * DAY },
    { slug: 'empty-states-say-what-to-do', name: 'Empty states say what to do', at: now - 3 * DAY },
    { slug: 'orders-table-virtualized-past-200', name: 'Orders table virtualized past 200', at: now - 9 * DAY },
  ],
  inbox: STAGED.map(([key, , , text]) => ({ key, type: key.split('/')[0], title: sentence(key.split('__')[1]), excerpt: text })),
})

const vaultIpc = {
  home_snapshot,
  memory_feed,
  vault_tree,
  vault_page,
  vault_rules,
  vault_health,
  vault_ego,
  vault_run,
  vault_doctor: () => ok(DOCTOR),
  // Level 49 of a vault with some history (`levelOf(xpOf(…))`).
  vault_level: () => ({ root: VAULT, pages: 2413, rules_fired: 386, fires: 576, fired_recent: 320, dormant: 46, label_only: 2, inbox: 7, error: null }),
}

// ---------------------------------------------------------------- the scenarios

// What the app asks at launch beside what a panel asks: no worktree to list, one shell.
const QUIET = { worktree_list: () => [], pty_shells: () => ({ shells: [], current: null, kind: 'cmd' }) }
/** The new front on the sample world with the panel `name` open, answering `ipc`. */
const panel = (name, ipc = {}) => next({ v: 'console', s: sessionTitled('Optimistic updates'), panel: name }, { ...QUIET, ...ipc })
const tab = (name) => async (page) => {
  await page.getByRole('tab', { name: new RegExp(`^${name}`) }).click()
}

scenario('next-panel-memory', panel('memory', vaultIpc))
scenario('next-panel-memory-rules', { ...panel('memory', vaultIpc), drive: tab('Rules') })
scenario('next-panel-memory-rule', {
  ...panel('memory', vaultIpc),
  drive: async (page) => {
    await tab('Rules')(page)
    await page.locator('[data-project="lumen-web"]').click()
    await page.locator('[data-rule="optimistic-ui-rolls-back-on-409"]').click()
    await page.getByRole('button', { name: 'Why', exact: true }).click()
  },
})
scenario('next-panel-memory-pages', {
  ...panel('memory', vaultIpc),
  drive: async (page) => {
    await tab('Pages')(page)
    await page.locator('[data-pick="optimistic-ui-rolls-back-on-409"]').click()
  },
})
scenario('next-panel-memory-inbox', {
  ...panel('memory', vaultIpc),
  drive: async (page) => {
    await tab('Inbox')(page)
    await page.locator('[data-staged] .memory-staged-open').first().click()
  },
})

// ---------------------------------------------------------------- what mnemo learned

const learnedPage = (type, slug, name, description, excerpt) => ({ key: `${type}/lumen-web__${slug}`, type, name, description, excerpt, staged_at: '2026-11-09T10:12:03', expires_at: '2026-11-23T10:12:03' })
const LEARNED = [
  learnedPage('project', 'orders-poll-every-30s', 'The orders screen polls every 30 s', 'It reads again every 30 s while it shows, and not while hidden.', 'The orders screen reads the list again every 30 s while the tab shows. A push channel was tried in June and dropped: the proxy closed idle sockets.'),
  learnedPage('project', 'refunds-go-through-the-ledger', 'Refunds go through the ledger', 'A refund is a ledger entry, never an edit to the order.', 'A refund writes a negative entry to the ledger; the order row is never edited. Reports read the ledger.'),
  learnedPage('project', 'demo-tenant-resets-nightly', 'The demo tenant resets nightly', 'Demo data is rebuilt at 03:00 UTC.', 'Anything written to the demo tenant is gone at 03:00 UTC. Do not use it to keep fixtures.'),
  learnedPage('feedback', 'confirm-before-bulk-cancel', 'Confirm before a bulk cancel', 'Cancelling several orders at once asks first, and names how many.', 'One order: no question, Undo is enough. More than one: the question names how many and their total.'),
  learnedPage('feedback', 'screenshots-in-every-ui-pr', 'Screenshots in every UI pull request', 'A pull request that changes a screen carries a picture of it.', 'Reviewers asked three times in a row for a picture. Attach one at each of the sizes the screen is used at.'),
  learnedPage('reference', 'design-tokens-live-in-one-file', 'Design tokens live in one file', 'Colours and sizes come from tokens.css.', 'tokens.css is the only place a colour or a size is written. Components read the variables.'),
  learnedPage('user', 'prefers-small-prs', 'Prefers small pull requests', 'One change per pull request, under 400 lines when it can be.', 'Asked twice to split a pull request that mixed a refactor with a fix.'),
]
const learnedIpc = (pages) => ({
  ...vaultIpc,
  install_review_project: ({ cwd }) => ({ project: String(cwd).split('/').pop(), root: cwd }),
  install_review_decided: () => null,
  install_review_run: ({ project }) => `install-review:${project}`,
  install_review_record: () => null,
  install_review_step: ({ step, keys }) => {
    if (step === 'dry-run') return ok(JSON.stringify({ project: 'lumen-web', sessions: 38, calls_estimate: 16, api_price_estimate_usd: 1.1 }))
    if (step === 'promote') return ok(JSON.stringify({ promoted: keys, failed: [] }))
    if (step === 'drop') return ok(JSON.stringify({ dropped: keys, failed: [] }))
    return ok(JSON.stringify({ project: 'lumen-web', origin: 'backfill', pages }))
  },
})

scenario('next-panel-learned-consent', panel('learned', learnedIpc([])))
scenario('next-panel-learned-running', {
  ...panel('learned', learnedIpc([])),
  drive: async (page) => {
    await page.getByRole('button', { name: 'Read my history' }).click()
    await page.evaluate(() => {
      const line = (o) => window.__previewEmit('job-line', { id: 'install-review:lumen-web', stream: 'out', line: JSON.stringify(o) })
      line({ event: 'harvest', done: 38, of: 38 })
      line({ event: 'extract', done: 5, of: 16 })
    })
  },
})
scenario('next-panel-learned-review', {
  ...panel('learned', learnedIpc(LEARNED)),
  drive: async (page) => {
    await page.getByRole('checkbox', { name: 'keep The demo tenant resets nightly' }).click()
    await page.locator('[data-key$="confirm-before-bulk-cancel"] .learned-pick').click()
  },
})

// ---------------------------------------------------------------- accounts

const account = (id, more = {}) => ({ id, label: id, configDir: id === 'default' ? `${HOME}/.claude` : `${HOME}/.claude-${id}`, isDefault: id === 'default', kind: 'claude', email: `${id}@example.org`, problem: null, unshared: [], ...more })
const limit = (kind, percent, inMs, more = {}) => ({ kind, group: kind.startsWith('weekly') ? 'weekly' : kind, model: null, percent, severity: 'normal', resetsAt: new Date(now + inMs).toISOString(), active: true, ...more })
const usageOf = (limits, more = {}) => ({ limits, plan: 'max', fetchedAt: now - 40_000, stale: null, ...more })
const accountsIpc = (accounts, usage) => ({
  accounts_list: () => ({ active: 'default', accounts }),
  plan_usage: ({ configDir }) => {
    const u = usage[accounts.find((a) => a.configDir === configDir)?.id]
    if (typeof u === 'string') throw u
    return u
  },
})

// The sample world's two accounts, with the windows its top bar shows.
const TWO = [account('default', { label: 'main', email: 'main@example.org' }), account('second')]
scenario(
  'next-panel-accounts',
  panel(
    'accounts',
    accountsIpc(TWO, {
      default: usageOf([limit('session', 46, 2 * HOUR + 20 * MIN), limit('weekly_all', 21, 3 * DAY), limit('weekly_scoped', 6, 3 * DAY, { model: 'Fable' })]),
      second: usageOf([limit('session', 8, 2 * HOUR + 20 * MIN), limit('weekly_all', 2, 3 * DAY), limit('weekly_scoped', 0, 3 * DAY, { model: 'Fable' })]),
    }),
  ),
)
// Every state a card can be in: a window near its end, an old reading, an account that is not
// logged in and keeps its own settings, a Grok account whose credit could not be read; and the
// form that adds one.
const MANY = [
  account('default', { label: 'main', email: 'main@example.org' }),
  account('second'),
  account('studio', { email: null, problem: 'Not logged in yet. Sign in to use it.', unshared: ['settings.json', 'skills'] }),
  account('grok', { kind: 'grok', configDir: `${HOME}/.grok`, email: 'main@example.org' }),
]
scenario('next-panel-accounts-states', {
  ...panel(
    'accounts',
    accountsIpc(MANY, {
      default: usageOf([limit('session', 93, 38 * MIN, { severity: 'warning' }), limit('weekly_all', 71, 3 * DAY), limit('weekly_scoped', 100, 3 * DAY, { model: 'Fable', severity: 'exceeded' })]),
      second: usageOf([limit('session', 8, 2 * HOUR), limit('weekly_all', 2, 3 * DAY)], { fetchedAt: now - 3 * HOUR, stale: 'the usage endpoint answered 429; this is the last reading' }),
      studio: 'this account has no login',
      grok: 'grok did not answer in 10 s',
    }),
  ),
  drive: async (page) => {
    await page.getByRole('button', { name: '+ Add account' }).click()
    await page.getByRole('button', { name: 'Grok Build' }).click()
    await page.getByPlaceholder(/^New account/).fill('night shift')
  },
})

// ---------------------------------------------------------------- setup

const tool = (name, version, more = {}) => ({ name, path: `/opt/homebrew/bin/${name}`, version, managed: false, needed: name === 'claude' || name === 'mnemo', ...more })
scenario(
  'next-panel-setup',
  panel('setup', {
    tools_status: () => [
      tool('git', 'git version 2.50.1'),
      tool('claude', '2.4.0 (Claude Code)'),
      tool('mnemo', 'mnemo 1.11.2', { path: `${HOME}/.mnemo-desktop/tools/mnemo/bin/mnemo`, managed: true }),
      tool('gh', 'gh version 2.80.0'),
    ],
    tools_mnemo_latest: () => 'v1.12.0',
  }),
)
scenario('next-panel-setup-missing', {
  ...panel('setup', {
    tools_status: () => [tool('git', 'git version 2.50.1'), tool('claude', null, { path: null }), tool('grok', null, { path: null, needed: false }), tool('mnemo', null, { path: null }), tool('gh', null, { path: null })],
    tools_install_mnemo: () => new Promise(() => {}),
  }),
  drive: async (page) => {
    await page.getByRole('button', { name: 'Install mnemo' }).click()
    await page.evaluate(() => {
      for (const message of ['downloading mnemo v1.12.0 for this system…', '18.4 MB of 18.4 MB', 'checking it against its published checksum… ok', 'running mnemo init…']) window.__previewEmit('tools-install', { tool: 'mnemo', message })
    })
  },
})

// ---------------------------------------------------------------- settings

scenario(
  'next-panel-settings',
  panel('settings', {
    home_snapshot,
    settings_read: () => ({ outgoing: 'en', outgoingChosen: true, replyLanguage: 'pt', skipPermissions: true, cloneBase: WORK, repoSetup: { [root('lumen-web')]: 'pnpm install --frozen-lockfile', [root('atlas-api')]: 'uv sync && uv run alembic upgrade head' } }),
    pty_shells: () => ({
      shells: [
        { id: 'cmd', label: 'cmd', kind: 'cmd', path: 'C:\\Windows\\System32\\cmd.exe' },
        { id: 'pwsh', label: 'PowerShell 7', kind: 'powershell', path: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe' },
        { id: 'git-bash', label: 'Git Bash', kind: 'posix', path: 'C:\\Program Files\\Git\\bin\\bash.exe' },
      ],
      current: 'pwsh',
      kind: 'powershell',
    }),
    app_build_info: () => ({ version: '0.8.0', sha: '9f3ab21', built_at: '2026-11-09 13:49 UTC' }),
    app_newer_release: () => ({ version: '0.9.0', url: 'https://example.org/releases/0.9.0', told: true }),
  }),
)

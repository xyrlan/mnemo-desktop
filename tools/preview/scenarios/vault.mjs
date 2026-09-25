// The vault pane (⌘K → Open vault), open as the only tab of a worktree, on each of its three
// screens: `vault` is Health (status tiles, the rules table with its badges and chips),
// `vault-pages` the pages tree by agent, `vault-inbox` the staged pages with their stats. The
// screen is picked by running `vault.pages` / `vault.inbox`, as the palette would.
import { scenario } from '../scenario.mjs'
import { appIpc, HOME, REPO } from '../fixtures/app.mjs'

const VAULT = `${HOME}/mnemo`
const SHARED = `${VAULT}/shared`
const MINE = `${VAULT}/bots/mnemo-desktop/memory`
const DAY = 86_400_000
// Relative to the shot, so the ages read the same whenever it is taken.
const ago = (days) => Date.now() - days * DAY

const rule = (dir, slug, name, over = {}) => ({
  path: `${dir}/${slug}.md`,
  slug,
  name,
  description: '',
  type: 'feedback',
  agent: dir === MINE ? 'mnemo-desktop' : 'shared',
  confidence: 'verified',
  topics: [],
  fires: 0,
  last_fired: null,
  heat: 0,
  badges: [],
  reasons: [],
  ...over,
})

const RULES = [
  rule(SHARED, 'run-git-commands-yourself', 'Run git commands yourself', { description: 'Never hand a push or merge back to the user; ask first, then run it.', topics: ['git', 'workflow'], fires: 41, last_fired: ago(0), heat: 4.6 }),
  rule(MINE, 'fresh-worktree-needs-pnpm-install', 'Fresh worktree needs pnpm install', { type: 'project', description: 'No node_modules in a dispatch worktree; pnpm, never npm.', confidence: 'observed', topics: ['build', 'workflow'], fires: 22, last_fired: ago(1), heat: 3.1, badges: ['stale'], reasons: ['stale: cites package.json, changed since'] }),
  rule(SHARED, 'pnpm-never-npm', 'pnpm, never npm', { description: 'The lockfile is pnpm-lock.yaml; npm rewrites it.', topics: ['build'], fires: 17, last_fired: ago(2), heat: 2.4 }),
  rule(MINE, 'new-ui-inside-app-needs-data-ui', 'New UI inside .app needs data-ui', { type: 'project', description: 'Raw buttons in a Tailwind pane draw as white boxes without it.', confidence: 'verified-elsewhere', topics: ['css', 'ui'], fires: 9, last_fired: ago(3), heat: 1.7, badges: ['inbox'] }),
  rule(SHARED, 'vitest-mock-factory-cycle', 'vitest mock-factory cycle hangs silently', { type: 'reference', description: 'testing.ts must not import what imports ./upstream.', confidence: 'inferred', topics: ['testing', 'debugging'], fires: 4, last_fired: ago(9), heat: 0.8 }),
  rule(MINE, 'tauri-drop-position-is-webview-relative', 'Tauri drop position is webview-relative', { type: 'project', description: 'Logical on macOS/Linux despite PhysicalPosition.', topics: ['ui'], fires: 2, last_fired: ago(27), heat: 0.3 }),
  rule(SHARED, 'merge-green-prs-myself', 'Merge green PRs myself', { description: 'After 3-OS CI green and a read of the diff; squash --match-head-commit.', topics: ['git', 'process'], badges: ['never', 'review'], reasons: ['verified without evidence'] }),
  rule(SHARED, 'orca-port-authorized', 'Orca port authorized', { type: 'project', description: 'The maintainer authorized porting Orca MIT code.', confidence: 'demoted', topics: ['process'], fires: 1, last_fired: ago(140), heat: 0.02, badges: ['review'], reasons: ['has activates_on, not fired in 60 days'] }),
]

const STATUS = [
  `Vault: ${VAULT}  (exists)`,
  'Briefings: 362 across 14 agents (2.5 MB) — 0 prunable (retention 180d, keep 20/agent)',
  'reflex: injected on 117 of 2350 prompts (5.0%)',
  'recall: primacy@5 34.4% over 90 cases (mnemo recall, 2026-09-14)',
  'Circuit breaker: closed (ok)',
].join('\n')

const HEALTH = {
  root: VAULT,
  status: { stdout: STATUS, stderr: '', code: 0 },
  tiles: [
    { key: 'reflex', label: 'reflex injected', value: '5.0%', detail: '117 of 2350 prompts', tone: 'muted' },
    { key: 'recall', label: 'recall primacy@5', value: '34.4%', detail: 'over 90 cases', tone: 'muted' },
    { key: 'briefings', label: 'briefings', value: '362', detail: 'across 14 agents (2.5 MB)', tone: 'muted' },
    { key: 'breaker', label: 'circuit breaker', value: 'closed', detail: 'ok', tone: 'ok' },
  ],
  label_only: [{ path: `${SHARED}/merge-green-prs-myself.md`, slug: 'merge-green-prs-myself', name: 'Merge green PRs myself', reason: 'verified without evidence' }],
  dormant: [{ path: `${SHARED}/orca-port-authorized.md`, slug: 'orca-port-authorized', name: 'Orca port authorized', reason: 'has activates_on, not fired in 60 days' }],
  pages: RULES.length,
  never_fired: 1,
  inbox: 3,
  error: null,
}

const info = (r) => ({ path: r.path, slug: r.slug, name: r.name, description: r.description, type: r.type, confidence: r.confidence, topics: r.topics, modified: ago(4), body: '' })
const TREE = [
  { name: 'shared', kind: 'shared', dir: SHARED, groups: [
    { type: 'feedback', pages: RULES.filter((r) => r.agent === 'shared' && r.type === 'feedback').map(info) },
    { type: 'reference', pages: RULES.filter((r) => r.agent === 'shared' && r.type === 'reference').map(info) },
    { type: 'project', pages: RULES.filter((r) => r.agent === 'shared' && r.type === 'project').map(info) },
  ] },
  { name: 'mnemo-desktop', kind: 'repo', dir: MINE, groups: [{ type: 'project', pages: RULES.filter((r) => r.agent === 'mnemo-desktop').map(info) }] },
  { name: 'mnemo', kind: 'repo', dir: `${VAULT}/bots/mnemo/memory`, groups: [{ type: 'project', pages: [info(rule(`${VAULT}/bots/mnemo/memory`, 'hooks-run-python', 'Hooks run python3 -m mnemo.hooks'))] }] },
  { name: 'bg-pytest-1', kind: 'other', dir: `${VAULT}/bots/bg-pytest-1/memory`, groups: [{ type: 'user', pages: [info(rule(`${VAULT}/bots/bg-pytest-1/memory`, 'noise', 'noise'))] }] },
  { name: 'bg-pytest-2', kind: 'other', dir: `${VAULT}/bots/bg-pytest-2/memory`, groups: [{ type: 'user', pages: [info(rule(`${VAULT}/bots/bg-pytest-2/memory`, 'noise', 'noise'))] }] },
]

const BODY = `Never hand a \`git push\` or \`gh pr merge\` back to the user: ask once, then run it yourself.

**Why:** the user owns the repository's state, and a command pasted back to them is one they have to read, check and run.

**How to apply:**

- ask before any push or merge; a yes covers that one action
- see [[merge-green-prs-myself]] for when merging needs no ask
`

const page = (path) => {
  const r = RULES.find((x) => x.path === path) ?? rule(SHARED, path.split('/').pop().replace('.md', ''), path.split('/').pop().replace('.md', ''))
  return { ...info(r), body: BODY, runtime: 'reflex', frontmatter: [{ key: 'name', value: r.name }, { key: 'metadata.type', value: r.type }, { key: 'metadata.confidence', value: r.confidence ?? '' }], error: null }
}

const LISTING = `3 staged pages for mnemo-desktop in shared/_inbox/ (median 4d, oldest 7d)

  feedback/headless-shell-diffs-computed-styles          extraction     2d  Playwright's cached chrome-headless-shell --dump-dom works from a job; ful…
  reference/github-auth-via-gh-cli-not-oauth             demotion       4d  Use 'gh auth login --web' for authentication instead of implementing na…
  project/new-ui-inside-app-needs-data-ui                rewrite        7d  Raw buttons in a Tailwind pane draw as white boxes without data-ui on the…

nothing was written — this is a listing only.
  \`mnemo inbox --promote KEY\` moves one into shared/<type>/, where recall sees it
  \`mnemo inbox --drop KEY\` archives it and takes it out of the queue
  \`mnemo inbox --show KEY\` prints one page
  (12 more staged for other projects — \`mnemo inbox --all\`)
`

const STATS = [
  '3 staged in shared/_inbox/ (median 4d, oldest 7d)',
  'last 30 days: 18 offered at session start, 9 promoted, 5 dropped (14 resolved)',
  'held pages expired unreviewed: 2, restored: 1',
  'median offer → decision: 1.5d',
].join('\n')

const SHOWN = `---
name: Headless shell diffs computed styles
type: feedback
tags:
  - testing
  - css
---

Playwright's cached \`chrome-headless-shell --dump-dom\` works from a job; full Chrome hangs.

**Why:** a background job has no window server session.
`

const ran = (stdout) => ({ stdout, stderr: '', code: 0 })

const ipc = appIpc({
  workspace_read: {
    version: 2,
    activeWorktree: REPO,
    worktrees: [{ path: REPO, tabs: [{ id: 'tab-1', root: { kind: 'leaf', pane: 1 }, focused: 1 }], panes: { 1: { view: 'vault', cwd: REPO } }, activeTab: 'tab-1' }],
  },
  home_snapshot: {
    repos: [{ root: REPO, name: 'mnemo-desktop', last_at: ago(0), pinned: true, hidden: false, unresolved: false, sessions: [], children: [] }],
    clone_base: `${HOME}/code`,
    errors: [],
    protected: 0,
  },
  worktree_list: ({ repo }) => (repo === REPO ? [{ path: REPO, branch: 'main', head: 'a'.repeat(40), isMain: true, dispatched: false, dirty: false, setupJob: null }] : []),
  mission_looked: {},
  pty_list: [],
  memory_feed: { project: 'mnemo-desktop', briefing: null, fired: [], learned: [], inbox: [] },
  chrome_repo: 'mnemo-desktop',
  chrome_branch: 'main',
  vault_rules: ({ scope, filter }) => RULES.filter((r) => (!scope || scope === `agent:${r.agent}`) && (!filter || `${r.name} ${r.description}`.toLowerCase().includes(filter.toLowerCase()))),
  vault_health: HEALTH,
  vault_doctor: ran('doctor: 0 problems'),
  vault_tree: TREE,
  vault_page: ({ path }) => page(path),
  vault_ego: ({ path }) => ({ center: path, nodes: [], edges: [], total: 0, error: null }),
  vault_run: ({ action, args }) => {
    if (action === 'stale') return ran(JSON.stringify([{ slug: 'fresh-worktree-needs-pnpm-install', reason: 'cites package.json, changed since' }]))
    if (action === 'inbox') {
      if (args[0] === '--stats') return ran(STATS)
      if (args[0] === '--show') return ran(SHOWN)
      if (args[0] === '--promote') return ran(`promoted ${args[1]} → shared/${args[1]}.md`)
      if (args[0] === '--drop') return ran(`dropped ${args[1]}; archived to shared/_archive/dropped-2026-09-24/${args[1]}.md`)
      if (args[0] === '--restore') return ran(`restored ${args[1]} → shared/_inbox/${args[1]}.md`)
      return ran(LISTING)
    }
    return ran('ok')
  },
})

scenario('vault', { ipc })
scenario('vault-pages', { ipc, events: [{ event: 'app://action', payload: { id: 'vault.pages' }, afterMs: 1500 }] })
scenario('vault-inbox', { ipc, events: [{ event: 'app://action', payload: { id: 'vault.inbox' }, afterMs: 1500 }] })

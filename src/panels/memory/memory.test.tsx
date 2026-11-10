// The Memory panel on the vault's stores, drawn by the panel host. The commands the stores ask
// are answered here; every name and path is made up.

import type { MemoryFeed } from '../../memory/types'
import type { Agent, Health, Page, RuleRow, RunResult } from '../../vault/types'

const t = vi.hoisted(() => ({
  calls: [] as [string, Record<string, unknown> | undefined][],
  /** What `vault_run` answers, by `mnemo` subcommand and first argument. */
  run: {} as Record<string, { stdout: string; stderr: string; code: number | null }>,
  feed: null as unknown,
  external: [] as string[],
  fleet: {
    repos: [
      { root: '/Users/you/work/lumen-web', name: 'lumen-web', worktrees: [] },
      { root: '/Users/you/work/atlas-api', name: 'atlas-api', worktrees: [] },
    ],
  },
}))

const VAULT = '/Users/you/vault'
const dirOf = (agent: string) => (agent === 'shared' ? `${VAULT}/shared` : `${VAULT}/bots/${agent}/memory`)
const rule = (agent: string, slug: string, over: Partial<RuleRow> = {}): RuleRow => ({
  path: `${dirOf(agent)}/project/${slug}.md`,
  slug,
  name: slug,
  description: `about ${slug}`,
  type: 'project',
  agent,
  confidence: 'verified',
  topics: ['orders'],
  fires: 3,
  last_fired: null,
  heat: 1,
  badges: [],
  reasons: [],
  ...over,
})
// Hottest first, as `vault_rules` answers.
const RULES = [
  rule('shared', 'push-before-stop', { heat: 5 }),
  rule('atlas-api', 'idempotency-key', { heat: 4.8 }),
  rule('lumen-web', 'rolls-back-on-409', { heat: 4.2 }),
  rule('atlas-api', 'signature-before-parse', { heat: 4.1 }),
  rule('lumen-web', 'contrast-ratio', { heat: 0.3, confidence: 'observed', badges: ['review'], reasons: ['verified without evidence'] }),
]
const pageOf = (path: string): Page => ({
  path,
  slug: path.split('/').pop()!.replace(/\.md$/, ''),
  name: path.split('/').pop()!.replace(/\.md$/, ''),
  description: 'what it is about',
  type: 'project',
  confidence: 'verified',
  topics: ['orders'],
  modified: Date.UTC(2026, 9, 1),
  body: '# Rule\n\nSee [[idempotency-key]] and [the notes](https://example.org/notes).',
  runtime: null,
  frontmatter: [{ key: 'type', value: 'project' }],
  error: null,
})
const TREE: Agent[] = ['shared', 'lumen-web', 'atlas-api'].map((name) => ({
  name,
  kind: name === 'shared' ? 'shared' : 'repo',
  dir: dirOf(name),
  groups: [{ type: 'project', pages: RULES.filter((r) => r.agent === name).map((r) => pageOf(r.path)) }],
}))
const HEALTH: Health = {
  root: VAULT,
  status: { stdout: 'vault: 5 pages', stderr: '', code: 0 },
  tiles: [{ key: 'briefings', label: 'briefings', value: '12', detail: 'across 3 agents', tone: 'muted' }],
  label_only: [{ path: RULES[4].path, slug: 'contrast-ratio', name: 'contrast-ratio', reason: 'verified without evidence' }],
  dormant: [],
  pages: 5,
  never_fired: 0,
  inbox: 2,
  error: null,
}
const LISTING = `2 staged pages for lumen-web in shared/_inbox/ (median 2d, oldest 3d)

  feedback/lumen-web__confirm-bulk-cancel   new   3d  Ask before cancelling several orders
  project/lumen-web__orders-poll   new   1d  The orders screen polls

nothing was written — this is a listing only.
`
const FEED: MemoryFeed = {
  project: 'lumen-web',
  briefing: { sessionId: '5efebf83-0000-4000-8000-000000000001', date: '2026-11-09', tldr: 'Optimistic updates are in.', path: `${dirOf('lumen-web')}/briefings/sessions/b.md` },
  fired: [
    { slug: 'rolls-back-on-409', name: 'rolls-back-on-409', at: Date.now() - 120_000, source: 'reflex' },
    { slug: 'push-before-stop', name: 'push-before-stop', at: Date.now() - 3_600_000, source: 'mcp' },
  ],
  learned: [{ slug: 'contrast-ratio', name: 'contrast-ratio', at: Date.now() - 86_400_000 }],
  inbox: [
    { key: 'feedback/lumen-web__confirm-bulk-cancel', type: 'feedback', title: 'confirm-bulk-cancel', excerpt: '' },
    { key: 'project/lumen-web__orders-poll', type: 'project', title: 'orders-poll', excerpt: '' },
    { key: 'project/lumen-web__third', type: 'project', title: 'third', excerpt: '' },
  ],
}

vi.mock('@tauri-apps/api/core', () => ({
  Channel: class {},
  invoke: async (cmd: string, args?: Record<string, unknown>) => {
    t.calls.push([cmd, args])
    switch (cmd) {
      case 'vault_tree':
        return TREE
      case 'vault_page':
        return pageOf(args!.path as string)
      case 'vault_rules': {
        const f = String(args!.filter ?? '').toLowerCase()
        return RULES.filter((r) => r.slug.includes(f))
      }
      case 'vault_health':
        return HEALTH
      case 'vault_level':
        return { root: VAULT, pages: 120, rules_fired: 30, fires: 72, fired_recent: 10, dormant: 4, label_only: 0, inbox: 2, error: null }
      case 'vault_level_best':
        return args!.xp
      case 'memory_feed':
        if (t.feed === null) throw 'no vault for this project'
        return t.feed
      case 'home_snapshot':
        return { repos: [], clone_base: '', errors: [], protected: 0 }
      case 'vault_run': {
        const a = args!.args as string[]
        return t.run[`${args!.action} ${a[0] ?? ''}`.trim()] ?? t.run[args!.action as string] ?? { stdout: '', stderr: '', code: 0 }
      }
    }
    return null
  },
}))
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }))
// A stable object: a fresh array per call would loop the renders.
vi.mock('../../fleet/store', () => ({ useFleet: <T,>(sel: (f: typeof t.fleet) => T): T => sel(t.fleet) }))

import { vault } from '../../vault/app-store'
import { NO_CHIPS } from '../../vault/rules'
import { NO_ACTIONS, setActions } from '../../world/actions'
import { go, routeStore } from '../../world/route'
import { Panels, panels } from '../index'
import { FILTER_MS } from './Rules'
import { memoryFeed, memoryPanel } from './state'
import { button, click, draw, flush, key, texts, type } from './testing'

const ran = (action: string) => t.calls.filter(([c, a]) => c === 'vault_run' && a!.action === action).map(([, a]) => a!.args as string[])
const asked = (cmd: string) => t.calls.filter(([c]) => c === cmd).map(([, a]) => a)
const tab = (name: string) => click([...document.querySelectorAll('[data-memory-panel] > .memory-head [role=tab]')].find((b) => b.textContent!.startsWith(name)))
const ruleRows = () => texts('[data-rule] .memory-rule-name .sp-name')
const result = (stdout: string, code = 0): RunResult => ({ stdout, stderr: '', code })

let undraw: () => Promise<void>
let unset: () => void
beforeEach(async () => {
  t.calls.length = 0
  t.external.length = 0
  t.run = { stale: result(''), inbox: result(LISTING) }
  t.feed = FEED
  memoryPanel.setState({ tab: 'activity', repo: null, project: null })
  memoryFeed.setState({ target: null, feed: null, error: null })
  vault.setState({ selected: null, page: null, filter: '', query: '', scope: '', chips: NO_CHIPS, log: [], rules: [], rulesLoaded: false, inboxSelected: null, inboxNotice: null, inboxAll: false, inboxListing: null, health: null })
  unset = setActions({
    ...NO_ACTIONS,
    external: async (target) => {
      t.external.push(target)
      return { ok: true }
    },
  })
  // The host takes a panel once it has loaded: a tick after the modules did.
  await vi.waitFor(() => expect(panels().some((p) => p.id === 'memory')).toBe(true))
  go({ panel: 'memory' })
  undraw = await draw(<Panels />)
})
afterEach(async () => {
  await undraw()
  unset()
  go({ panel: null })
})

describe('the panel', () => {
  test('is the wide one the host opens for `memory`, and reads for the first repo the app knows', () => {
    const sheet = document.querySelector('[data-panel="memory"]')!
    expect(sheet.getAttribute('data-size')).toBe('wide')
    expect(document.querySelector('[role=group][aria-label=Repo] [aria-pressed=true]')!.textContent).toBe('lumen-web')
    expect(asked('memory_feed')[0]).toEqual({ cwd: '/Users/you/work/lumen-web', sessionId: null })
  })

  test('its tabs carry the numbers behind them: the staged pages at once, the rules once read', async () => {
    const counts = () => Object.fromEntries([...document.querySelectorAll('.memory-head [role=tab]')].map((b) => [b.firstChild!.textContent, b.querySelector('.sp-tab-count')?.textContent ?? null]))
    expect(counts()).toEqual({ Activity: null, Rules: null, Pages: null, Inbox: '3' })
    await tab('Rules')
    expect(counts().Rules).toBe('5')
  })

  test('another repo is one press, and everything is read for it', async () => {
    await click(button('atlas-api', document.querySelector('[aria-label=Repo]')!))
    expect(asked('memory_feed').at(-1)).toEqual({ cwd: '/Users/you/work/atlas-api', sessionId: null })
    await tab('Inbox')
    expect(t.calls.filter(([c, a]) => c === 'vault_run' && a!.action === 'inbox').at(-1)![1]!.cwd).toBe('/Users/you/work/atlas-api')
  })
})

describe('activity', () => {
  test('says how many rules were given, learned and wait, and lists them newest first', () => {
    expect(texts('.memory-figure').map((s) => s.replace(/\s+/g, ' '))).toEqual(['2given lately', '1learned here', '3wait in the inbox'])
    expect(texts('.memory-column:last-child [data-line] .sp-name')).toEqual(['rolls-back-on-409', 'push-before-stop', 'contrast-ratio'])
    expect(texts('.memory-column:last-child [data-line] .memory-sub').slice(0, 2)).toEqual(['given by a hook', 'read by the session'])
  })

  test('the briefing is read whole in the Pages tab, one press away', async () => {
    await click(button('Read it whole'))
    expect(memoryPanel.getState().tab).toBe('pages')
    expect(vault.getState().selected).toBe(FEED.briefing!.path)
    expect(document.querySelector('[data-page]')!.getAttribute('data-page')).toBe(FEED.briefing!.path)
  })

  test('Review goes to the inbox', async () => {
    await click(button('Review'))
    expect(memoryPanel.getState().tab).toBe('inbox')
    expect(texts('[data-staged] .memory-staged-key')).toEqual(['feedback/lumen-web__confirm-bulk-cancel', 'project/lumen-web__orders-poll'])
  })

  test('a repo mnemo has no vault for says why instead of an empty screen', async () => {
    t.feed = null
    await click(button('atlas-api', document.querySelector('[aria-label=Repo]')!))
    expect(document.querySelector('[role=alert]')!.textContent).toContain('no vault for this project')
  })
})

describe('the rules by project', () => {
  beforeEach(() => tab('Rules'))

  test('every project is listed with its count: this repo first, shared second, then the fullest', () => {
    expect(texts('.memory-rail .memory-project').map((s) => s.replace(/\s+/g, ' '))).toEqual(['Every project5', 'lumen-webthis repo1 flagged2', 'shared1', 'atlas-api2'])
    expect(ruleRows()).toEqual(RULES.map((r) => r.slug))
  })

  test('a project narrows the rules to its own in one press, and the same press again shows all', async () => {
    await click(document.querySelector('[data-project="atlas-api"]'))
    expect(ruleRows()).toEqual(['idempotency-key', 'signature-before-parse'])
    expect(document.querySelector('.memory-count')!.textContent).toBe('2 rules')
    await click(document.querySelector('[data-project="atlas-api"]'))
    expect(ruleRows()).toHaveLength(5)
  })

  test('the rules are read once for every project, whatever scope the old window left set', async () => {
    await undraw()
    t.calls.length = 0
    vault.setState({ scope: 'agent:atlas-api', rulesLoaded: true, rules: [RULES[1]] })
    undraw = await draw(<Panels />)
    expect(asked('vault_rules')).toEqual([{ scope: '', filter: '' }])
    expect(texts('.memory-rail .memory-project')).toHaveLength(4)
  })

  test('the arrows walk the rules from the first, and hold at the last', async () => {
    const list = document.querySelector('.memory-list')!
    await key('ArrowDown', list)
    expect(vault.getState().selected).toBe(RULES[0].path)
    await key('ArrowDown', list)
    expect(vault.getState().selected).toBe(RULES[1].path)
    await key('ArrowUp', list)
    expect(vault.getState().selected).toBe(RULES[0].path)
    for (let i = 0; i < 9; i++) await key('ArrowDown', list)
    expect(vault.getState().selected).toBe(RULES[4].path)
  })

  test('the arrows walk from the filter too, and typing there reads the table again once it pauses', async () => {
    const filter = document.querySelector('[aria-label="Filter rules"]')!
    await type(filter, 'key')
    expect(asked('vault_rules').at(-1)).toEqual({ scope: '', filter: '' })
    await flush(FILTER_MS + 30)
    expect(asked('vault_rules').at(-1)).toEqual({ scope: '', filter: 'key' })
    expect(ruleRows()).toEqual(['idempotency-key'])
    await key('ArrowDown', filter)
    expect(vault.getState().selected).toBe(RULES[1].path)
  })

  test('"want review" counts the rules the vault flags, and its press shows only the flagged', async () => {
    const tile = document.querySelector('[data-tile="review"]')!
    expect(tile.querySelector('.memory-tile-value')!.textContent).toBe('1')
    await click(tile)
    expect(ruleRows()).toEqual(['contrast-ratio'])
    await click(tile)
    expect(ruleRows()).toHaveLength(5)
  })

  test('a rule mnemo stale names carries the badge and says why on its page', async () => {
    t.run.stale = result(JSON.stringify({ stale: [{ slug: 'lumen-web__rolls-back-on-409', reason: 'cites a file that moved' }] }))
    await click(button('Read again', document.querySelector('.memory-strip')!))
    expect(texts('[data-rule="rolls-back-on-409"] [data-badge]')).toEqual(['stale'])
    await click(document.querySelector('[data-rule="rolls-back-on-409"]'))
    expect(document.querySelector('[data-reasons]')!.textContent).toContain('stale: cites a file that moved')
  })
})

describe('a rule', () => {
  beforeEach(async () => {
    await tab('Rules')
    await click(document.querySelector('[data-rule="rolls-back-on-409"]'))
  })

  test('is disabled only on a second press', async () => {
    const disable = () => button(/^Disable/)!
    await click(disable())
    expect(ran('disable-rule')).toEqual([])
    expect(disable().textContent).toBe('Disable rolls-back-on-409? Press again')
    await click(disable())
    expect(ran('disable-rule')).toEqual([['rolls-back-on-409']])
  })

  test('an armed Disable is let go by Esc, which closes nothing else', async () => {
    await click(button(/^Disable/))
    expect(await key('Escape')).toBe(true)
    expect(button(/^Disable/)!.textContent).toBe('Disable rule')
    expect(vault.getState().selected).toBe(RULES[2].path)
    expect(ran('disable-rule')).toEqual([])
  })

  test('Why runs in the repo and shows the decisions that mention the rule', async () => {
    t.run.why = result(
      JSON.stringify([
        { ts: '2026-11-09T12:00:00', project: 'lumen-web', emitted: ['lumen-web__rolls-back-on-409'], scores: [3.4], silence_reason: null, candidates: [] },
        { ts: '2026-11-09T11:00:00', project: 'lumen-web', emitted: [], scores: [], silence_reason: 'judge_none_relevant', candidates: [['other', 1.1]] },
      ]),
    )
    await click(button('Why'))
    const run = document.querySelector('[data-run="why"]')!
    expect(run.textContent).toContain('$ mnemo why --json --limit 50')
    expect(run.textContent).toContain('~/work/lumen-web')
    expect(run.textContent).toContain('1 of 2 decisions mention rolls-back-on-409')
    expect(texts('.memory-why-row', run)).toHaveLength(1)
  })

  test('a wikilink opens the page it names, and a web link leaves the app', async () => {
    await click(document.querySelector('[data-wiki="idempotency-key"]'))
    expect(vault.getState().selected).toBe(RULES[1].path)
    await click(document.querySelector('[data-href]'))
    expect(t.external).toEqual(['https://example.org/notes'])
  })

  test('a link in a page is followed from the keyboard too: Enter on it', async () => {
    await key('Enter', document.querySelector('[data-wiki="idempotency-key"]')!)
    expect(vault.getState().selected).toBe(RULES[1].path)
    await key('Enter', document.querySelector('[data-href]')!)
    expect(t.external).toEqual(['https://example.org/notes'])
  })

  test('Edit and Open folder go outside the app with the page and its folder', async () => {
    await click(button('Edit'))
    await click(button('Open folder'))
    expect(t.external).toEqual([RULES[2].path, `${dirOf('lumen-web')}/project`])
  })
})

describe('Esc', () => {
  test('closes what is open inside the panel first, then the panel', async () => {
    await tab('Rules')
    await type(document.querySelector('[aria-label="Filter rules"]'), 'o')
    await click(document.querySelector('[data-rule="rolls-back-on-409"]'))
    await key('Escape')
    expect(vault.getState().selected).toBeNull()
    expect(routeStore.getState().route.panel).toBe('memory')
    await key('Escape')
    expect(vault.getState().filter).toBe('')
    expect(routeStore.getState().route.panel).toBe('memory')
    await key('Escape')
    expect(routeStore.getState().route.panel).toBeNull()
  })

  test('typed in a terminal is the terminal’s', async () => {
    await tab('Rules')
    await click(document.querySelector('[data-rule="rolls-back-on-409"]'))
    const terminal = document.body.appendChild(document.createElement('div'))
    terminal.className = 'xterm'
    const input = terminal.appendChild(document.createElement('textarea'))
    // The host's own Esc is not this piece's; what is open inside the panel must stay.
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(vault.getState().selected).toBe(RULES[2].path)
    terminal.remove()
  })
})

describe('the pages', () => {
  beforeEach(() => tab('Pages'))

  test('this repo’s pages come first and open, then shared, then the other repos folded', () => {
    expect(texts('[data-agent] > .memory-agent-head .sp-name')).toEqual(['lumen-web', 'shared', 'atlas-api'])
    expect(texts('[data-pick] .sp-name')).toEqual(['rolls-back-on-409', 'contrast-ratio', 'push-before-stop'])
  })

  test('the arrows walk the pages on screen', async () => {
    const tree = document.querySelector('.memory-tree')!
    await key('ArrowDown', tree)
    await key('ArrowDown', tree)
    expect(vault.getState().selected).toBe(RULES[4].path)
    await key('ArrowDown', tree)
    expect(vault.getState().selected).toBe(RULES[0].path)
  })

  test('a search opens every agent that still has a match', async () => {
    await type(document.querySelector('[aria-label="Search pages"]'), 'signature')
    expect(texts('[data-pick] .sp-name')).toEqual(['signature-before-parse'])
  })
})

describe('the inbox', () => {
  const key1 = 'feedback/lumen-web__confirm-bulk-cancel'
  const row = () => document.querySelector(`[data-staged="${key1}"]`)!
  beforeEach(() => tab('Inbox'))

  test('a page is kept in one press', async () => {
    t.run['inbox --promote'] = result(`promoted ${key1}`)
    await click(button('Keep', row()))
    expect(ran('inbox')).toContainEqual(['--promote', key1])
    expect(document.querySelector('[role=status].sp-notice')!.textContent).toContain(`promoted ${key1}`)
  })

  test('a page is dropped in two, and the drop can be taken back', async () => {
    t.run['inbox --drop'] = result(`dropped ${key1}`)
    await click(button('Drop', row()))
    expect(ran('inbox').some((a) => a[0] === '--drop')).toBe(false)
    await click(button(/^Drop it\?/, row()))
    expect(ran('inbox')).toContainEqual(['--drop', key1])
    await click(button('Undo'))
    expect(ran('inbox')).toContainEqual(['--restore', key1])
  })

  test('a page is read before it is decided, and Esc puts it away', async () => {
    t.run['inbox --show'] = result('---\ntype: feedback\n---\n# Confirm\n\nAsk first.')
    await click(row().querySelector('.memory-staged-open'))
    expect(document.querySelector('[data-shown]')!.textContent).toContain('Ask first.')
    await key('Escape')
    expect(document.querySelector('[data-shown]')).toBeNull()
    expect(routeStore.getState().route.panel).toBe('memory')
  })

  test('What mnemo learned opens the Learned panel', async () => {
    await click(button('What mnemo learned'))
    expect(routeStore.getState().route.panel).toBe('learned')
  })
})

describe('what the vault can be asked', () => {
  test('a run that changes it is asked twice; one that only reads runs at once, in the repo', async () => {
    await click(button('Reverify'))
    expect(ran('reverify')).toEqual([[]])
    expect(t.calls.find(([c, a]) => c === 'vault_run' && a!.action === 'reverify')![1]!.cwd).toBe('/Users/you/work/lumen-web')
    await click(button('Apply safe rewrites'))
    expect(ran('rewrites')).toEqual([])
    await click(button(/^mnemo rewrites --apply-safe\?/))
    expect(ran('rewrites')).toEqual([['--apply-safe']])
  })

  test('a run that failed says how it ended and what it printed', async () => {
    t.run.status = { stdout: '', stderr: 'no vault configured', code: 2 }
    await click(button('Status'))
    const run = document.querySelector('[data-run="status"]')!
    expect(run.getAttribute('data-ok')).toBe('false')
    expect(run.textContent).toContain('exit 2')
    expect(run.textContent).toContain('no vault configured')
  })
})

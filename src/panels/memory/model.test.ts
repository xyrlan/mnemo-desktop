import type { GraphEdge, RuleRow } from '../../vault/types'
import { elapsedText, ended, inProject, pickRepo, projectsOf, relation, staleRows, step } from './model'

const rule = (agent: string, slug: string, over: Partial<RuleRow> = {}): RuleRow => ({
  path: `/Users/you/vault/${agent}/${slug}.md`,
  slug,
  name: slug,
  description: '',
  type: 'project',
  agent,
  confidence: 'verified',
  topics: [],
  fires: 1,
  last_fired: null,
  heat: 1,
  badges: [],
  reasons: [],
  ...over,
})

// Hottest first, as the table comes.
const ROWS = [
  rule('shared', 'push-before-stop', { heat: 5 }),
  rule('atlas-api', 'idempotency-key', { heat: 4.8 }),
  rule('lumen-web', 'rolls-back-on-409', { heat: 4.2 }),
  rule('atlas-api', 'signature-before-parse', { heat: 4.1, badges: ['review'] }),
  rule('atlas-api', 'tenant-in-cache-key', { heat: 3.3 }),
  rule('tessera', 'semver', { heat: 2 }),
  rule('harbor-cli', 'flags-first', { heat: 1.5, badges: ['never'] }),
  rule('lumen-web', 'bundle-budget', { heat: 0, badges: ['never', 'stale'] }),
]

describe('the rules by project', () => {
  test('the repo the panel is on comes first, shared second, then the others by how many rules they hold', () => {
    expect(projectsOf(ROWS, 'lumen-web').map((p) => p.name)).toEqual(['lumen-web', 'shared', 'atlas-api', 'harbor-cli', 'tessera'])
  })

  test('two projects with as many rules are in name order', () => {
    expect(projectsOf(ROWS, undefined).map((p) => p.name)).toEqual(['shared', 'atlas-api', 'lumen-web', 'harbor-cli', 'tessera'])
  })

  test('a project says how many rules it holds, how many carry a badge, and its hottest', () => {
    const [lumen, , atlas] = projectsOf(ROWS, 'lumen-web')
    expect(lumen).toEqual({ name: 'lumen-web', rules: 2, problems: 1, heat: 4.2, current: true })
    expect(atlas).toEqual({ name: 'atlas-api', rules: 3, problems: 1, heat: 4.8, current: false })
  })

  test('a picked project narrows the rows to its own, in the order they came', () => {
    expect(inProject(ROWS, 'atlas-api').map((r) => r.slug)).toEqual(['idempotency-key', 'signature-before-parse', 'tenant-in-cache-key'])
    expect(inProject(ROWS, null)).toBe(ROWS)
  })

  test('a picked project the table no longer names shows every row, not an empty table', () => {
    expect(inProject(ROWS, 'gone')).toBe(ROWS)
  })
})

describe('what mnemo stale said', () => {
  test('exit 0 with nothing printed is nothing stale', () => {
    expect(staleRows({ stdout: '  \n', stderr: '', code: 0 })).toEqual([])
  })

  test('before it ran, and when it printed something else, there is no answer', () => {
    expect(staleRows(null)).toBeNull()
    expect(staleRows({ stdout: 'no vault here', stderr: '', code: 0 })).toBeNull()
  })

  test('its JSON names the rules', () => {
    expect(staleRows({ stdout: JSON.stringify({ stale: [{ slug: 'x', reason: 'moved' }] }), stderr: '', code: 0 })).toEqual([{ slug: 'x', reason: 'moved', path: null }])
  })
})

describe('walking a list with the arrows', () => {
  const rows = ['a', 'b', 'c'].map((path) => ({ path }))
  test('from nothing selected, either arrow takes the first row', () => {
    expect(step(rows, null, 1)?.path).toBe('a')
    expect(step(rows, null, -1)?.path).toBe('a')
  })

  test('it moves one row and holds at both ends', () => {
    expect(step(rows, 'a', 1)?.path).toBe('b')
    expect(step(rows, 'c', 1)?.path).toBe('c')
    expect(step(rows, 'a', -1)?.path).toBe('a')
  })
})

describe('the repo a panel reads for', () => {
  const repos = [
    { root: 'C:/Users/you/work/lumen-web', name: 'lumen-web' },
    { root: 'C:/Users/you/work/atlas-api', name: 'atlas-api' },
  ]
  test('the picked one while it is known, whichever way its path is spelt', () => {
    expect(pickRepo(repos, 'c:\\Users\\you\\work\\atlas-api\\')?.name).toBe('atlas-api')
  })

  test('the first when none was picked, or the picked one is gone', () => {
    expect(pickRepo(repos, null)?.name).toBe('lumen-web')
    expect(pickRepo(repos, '/somewhere/else')?.name).toBe('lumen-web')
    expect(pickRepo([], null)).toBeNull()
  })
})

test('a neighbour says how it stands to the rule: the links each way, then the topics', () => {
  const edges: GraphEdge[] = [
    { id: '1', source: 'c', target: 'n', kind: 'link', label: '' },
    { id: '2', source: 'n', target: 'c', kind: 'link', label: '' },
    { id: '3', source: 'c', target: 'n', kind: 'topic', label: 'orders, ui' },
    { id: '4', source: 'c', target: 'other', kind: 'link', label: '' },
  ]
  expect(relation('c', 'n', edges)).toBe('links to it · links here · shares orders, ui')
  expect(relation('c', 'other', edges)).toBe('links to it')
  expect(relation('c', 'far', edges)).toBe('nearby')
})

test('a run says how long it has gone, and how it ended', () => {
  expect(elapsedText(12_400)).toBe('12s')
  expect(elapsedText(65_000)).toBe('1m 05s')
  expect(ended({ stdout: '', stderr: '', code: 0 })).toBe('exit 0')
  expect(ended({ stdout: '', stderr: 'killed', code: null })).toBe('not run')
})

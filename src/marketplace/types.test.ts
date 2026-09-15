import { groupBySource, typeSummary, type RuleSet } from './types'

const rs = (source: string, name: string): RuleSet => ({
  source, name, path: `/${name}`, description: '', rule_count: 1, types: {}, topics: [], projects: [], last_commit: null, error: null,
})

test('groups keep the listed order of sources and sets', () => {
  const g = groupBySource([rs('a', 'root'), rs('b', 'x'), rs('a', 'react')])
  expect(g.map((x) => [x.source, x.sets.map((s) => s.name)])).toEqual([['a', ['root', 'react']], ['b', ['x']]])
})

test('type summary', () => {
  expect(typeSummary({ feedback: 3, project: 1 })).toBe('3 feedback · 1 project')
  expect(typeSummary({})).toBe('')
})

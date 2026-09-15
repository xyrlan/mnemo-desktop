import { decisionsFor, namesRule, parseWhy } from './why'

// The shape `mnemo why --json` prints.
const out = JSON.stringify([
  {
    session_id: 's1',
    project: 'mnemo',
    prompt_hash: 'h',
    prompt_tokens: 12,
    emitted: ['mnemo__exploration-before-first-edit'],
    scores: [8.7016],
    silence_reason: null,
    candidates: [['mnemo__exploration-before-first-edit', 8.7016], ['run-tests-before-commit', 3.1]],
    thresholds: { relative_gap: 1.5 },
    ts: '2026-09-15T10:00:00',
  },
  { project: 'mnemo', emitted: [], scores: [], silence_reason: 'relative_gap_fail', candidates: [['other-rule', 15.4]], ts: '2026-09-15T09:00:00' },
  { project: 'mnemo', emitted: [], scores: [], silence_reason: 'index_missing', candidates: null, ts: '2026-09-15T08:00:00' },
])

test('parses decisions defensively and rejects non-JSON output', () => {
  const d = parseWhy(out)!
  expect(d).toHaveLength(3)
  expect(d[0]).toEqual({
    ts: '2026-09-15T10:00:00',
    project: 'mnemo',
    emitted: ['mnemo__exploration-before-first-edit'],
    scores: [8.7016],
    silence_reason: null,
    candidates: [['mnemo__exploration-before-first-edit', 8.7016], ['run-tests-before-commit', 3.1]],
  })
  expect(d[2].candidates).toEqual([])
  expect(parseWhy('no decisions logged yet\n')).toBeNull()
  expect(parseWhy('{"a":1}')).toBeNull()
})

test('rule ids name a slug with or without their project prefix', () => {
  expect(namesRule('mnemo__exploration-before-first-edit', 'exploration-before-first-edit')).toBe(true)
  expect(namesRule('feedback/run-tests', 'run-tests')).toBe(true)
  expect(namesRule('run-tests', 'run-tests')).toBe(true)
  expect(namesRule('mnemo__run-tests-later', 'run-tests')).toBe(false)
})

test('decisions that mention the slug, else all of them', () => {
  const d = parseWhy(out)!
  expect(decisionsFor(d, 'run-tests-before-commit')).toEqual({ shown: [d[0]], matched: true })
  expect(decisionsFor(d, 'other-rule').shown).toEqual([d[1]])
  expect(decisionsFor(d, 'never-seen')).toEqual({ shown: d, matched: false })
  expect(decisionsFor(d, undefined)).toEqual({ shown: d, matched: false })
})

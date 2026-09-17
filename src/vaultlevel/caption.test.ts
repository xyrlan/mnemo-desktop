import type { PulseEvent, PulseKind } from '../pulse/types'
import { ageOf, squareCaption } from './caption'

const NOW = 1_000_000_000
const ev = (over: Partial<PulseEvent>): PulseEvent => ({ at: NOW, kind: 'reflex', project: 'mnemo', agent: 'mnemo', slugs: [], ...over })
const line = (over: Partial<PulseEvent>) => {
  const c = squareCaption(ev(over), NOW)
  return [c.verb, c.target].filter(Boolean).join(' ')
}

test('each of the nine kinds has its past-tense verb and target', () => {
  expect(line({ kind: 'reflex', hits: 3 })).toBe('injected 3 rules')
  expect(line({ kind: 'tool', slugs: ['git-rules', 'other'] })).toBe('read git-rules')
  expect(line({ kind: 'enrich', tool: 'Edit' })).toBe('recalled Edit')
  expect(line({ kind: 'enforce', tool: 'git push --force' })).toBe('blocked git push --force')
  expect(line({ kind: 'briefing' })).toBe('saved briefing')
  expect(line({ kind: 'catchup', tool: 'x', slugs: ['y'], hits: 2 })).toBe('caught up')
  expect(line({ kind: 'learned', slugs: ['new-rule'] })).toBe('learned new-rule')
  expect(line({ kind: 'friction' })).toBe('noted friction')
  expect(line({ kind: 'dispatch', hits: 2 })).toBe('dispatched 2 children')
})

test('counts stay singular at one', () => {
  expect(line({ kind: 'reflex', hits: 1 })).toBe('injected 1 rule')
  expect(line({ kind: 'dispatch', hits: 1 })).toBe('dispatched 1 child')
})

test('with nothing to name, the caption is the verb alone — never undefined', () => {
  const bare: Partial<PulseEvent> = { slugs: [], tool: undefined, hits: undefined }
  expect(line({ ...bare, kind: 'reflex' })).toBe('injected')
  expect(line({ ...bare, kind: 'tool' })).toBe('read memory')
  expect(line({ ...bare, kind: 'enrich' })).toBe('recalled')
  expect(line({ ...bare, kind: 'enforce', tool: '' })).toBe('blocked')
  expect(line({ ...bare, kind: 'learned' })).toBe('learned')
  expect(line({ ...bare, kind: 'dispatch' })).toBe('dispatched')
  for (const kind of ['reflex', 'tool', 'enrich', 'enforce', 'briefing', 'catchup', 'learned', 'friction', 'dispatch'] as PulseKind[]) {
    const c = squareCaption(ev({ ...bare, kind }), NOW)
    expect(`${c.verb} ${c.target ?? ''} ${c.where}`).not.toMatch(/undefined|NaN/)
  }
})

test('the second line is the project and the age', () => {
  expect(squareCaption(ev({ at: NOW - 125_000 }), NOW).where).toBe('mnemo · 2m')
  expect(squareCaption(ev({ project: '' }), NOW).where).toBe('0s')
})

test('age falls in four bands, and a future clock reads as now', () => {
  expect(ageOf(12_400)).toBe('12s')
  expect(ageOf(59_999)).toBe('59s')
  expect(ageOf(60_000)).toBe('1m')
  expect(ageOf(4 * 60_000 + 59_000)).toBe('4m')
  expect(ageOf(2 * 3_600_000 + 1)).toBe('2h')
  expect(ageOf(24 * 3_600_000 - 1)).toBe('23h')
  expect(ageOf(3 * 86_400_000)).toBe('3d')
  expect(ageOf(-5_000)).toBe('0s')
})

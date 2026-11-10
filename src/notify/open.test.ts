import { expect, test } from 'vitest'
import { openSession } from './open'

/** What a click asked for, in order. */
function deps(over: { figure?: boolean; next?: boolean; known?: string | null } = {}) {
  const asked: string[] = []
  return {
    asked,
    figure: () => (asked.push('figure'), over.figure ?? false),
    next: over.next ?? false,
    known: () => (asked.push('known'), over.known ?? null),
    stage: (id: string) => void asked.push(`stage ${id}`),
  }
}

test('what the mounted front opens is what opens: the stage is not asked twice', () => {
  const d = deps({ figure: true, next: true, known: 's1' })
  expect(openSession(d)).toBe(true)
  expect(d.asked).toEqual(['figure'])
})

test('under the ship, a figure the ship does not know opens nothing', () => {
  const d = deps({ figure: false, next: false, known: 's1' })
  expect(openSession(d)).toBe(false)
  expect(d.asked).toEqual(['figure'])
})

test('in the new front, a session the world knows goes on stage, by the world\'s id for it', () => {
  const d = deps({ figure: false, next: true, known: '493cbd64-144a-4000-8000-000000000000' })
  expect(openSession(d)).toBe(true)
  expect(d.asked).toEqual(['figure', 'known', 'stage 493cbd64-144a-4000-8000-000000000000'])
})

test('in the new front, a session the world does not have opens nothing', () => {
  const d = deps({ figure: false, next: true, known: null })
  expect(openSession(d)).toBe(false)
  expect(d.asked).toEqual(['figure', 'known'])
})

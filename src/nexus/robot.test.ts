import type { PulseEvent } from '../pulse/types'
import { accessoryOf, classOf, injectedRules, isRateLimited, labelOf } from './robot'
import { ACCESSORIES } from './ship-types'

const ROOT = '/Users/you/github/mnemo-desktop'
const T0 = 1_760_000_000_000

test('takes the class from the model', () => {
  expect(['opus[1m]', 'claude-sonnet-4-6', 'claude-haiku-4-5', 'claude-fable-5-1', null, undefined].map(classOf)).toEqual(['mech', 'droid', 'drone', 'unknown', 'unknown', 'unknown'])
})

test('seeds the accessory from the id: the same each time, always in range, and varied', () => {
  const ids = Array.from({ length: 200 }, (_, i) => `job${i.toString(16)}`)
  const got = ids.map(accessoryOf)
  expect(ids.map(accessoryOf)).toEqual(got)
  expect(got.every((a) => Number.isInteger(a) && a >= 0 && a < ACCESSORIES)).toBe(true)
  expect(new Set(got).size).toBe(ACCESSORIES)
})

test('labels by issue from the worktree, else the contract piece, else the short id', () => {
  expect(labelOf({ id: 'a1', cwd: `${ROOT}-wt-643`, branch: null }, null)).toBe('#643')
  expect(labelOf({ id: 'a1', cwd: '/Users/you/github/mnemo-wt-655-49bb67', branch: 'fix/x' }, null)).toBe('#655')
  expect(labelOf({ id: 'a1', cwd: 'C:\\Users\\you\\repo-wt-12\\', branch: null }, null)).toBe('#12')
  expect(labelOf({ id: 'a1', cwd: `${ROOT}-wt-c-world`, branch: 'feat/nexus/world' }, 'world')).toBe('world')
  expect(labelOf({ id: 'a1', cwd: `${ROOT}-wt-c-world`, branch: 'feat/nexus/world' }, null)).toBe('world')
  expect(labelOf({ id: 'a1', cwd: `${ROOT}-wt-c-world`, branch: null }, null)).toBe('a1')
  expect(labelOf({ id: 'a1', cwd: '', branch: null }, null)).toBe('a1')
})

test('tells a rate limit from a spent plan', () => {
  expect(isRateLimited({ needs: 'rate limited — wait and retry', detail: '' })).toBe(true)
  expect(isRateLimited({ needs: null, detail: "You've hit your limit" })).toBe(true)
  expect(isRateLimited({ needs: 'usage limit reached — check plan', detail: '' })).toBe(false)
  expect(isRateLimited({ needs: 'may I?', detail: 'Running grep rate' })).toBe(false)
})

const ev = (kind: PulseEvent['kind'], at: number, more: Partial<PulseEvent> = {}): PulseEvent => ({
  at,
  kind,
  project: 'mnemo-desktop',
  agent: 'mnemo-desktop',
  slugs: [],
  ...more,
})

test('injected rules: the slugs put in front of one session, newest first, without repeats', () => {
  const events = [
    ev('catchup', T0, { session_id: 'child-a', slugs: ['boot-1', 'boot-2'] }),
    ev('reflex', T0 + 10, { session_id: 'child-a', slugs: ['r1', 'boot-1'] }),
    ev('reflex', T0 + 20, { session_id: 'child-b', slugs: ['not-mine'] }),
    // What the agent searched for was not injected.
    ev('tool', T0 + 30, { session_id: 'child-a', slugs: ['searched'] }),
    ev('reflex', T0 + 40, { session_id: 'child-a', slugs: ['r2'] }),
    ev('reflex', T0 + 50, { slugs: ['no-session'] }),
  ]
  expect(injectedRules(events, 'child-a')).toEqual(['r2', 'r1', 'boot-1', 'boot-2'])
  expect(injectedRules(events, 'nobody')).toEqual([])
})

test('injected rules: of two events at one time, the one logged later is newer', () => {
  const events = [ev('reflex', T0, { session_id: 's', slugs: ['first'] }), ev('reflex', T0, { session_id: 's', slugs: ['second'] })]
  expect(injectedRules(events, 's')).toEqual(['second', 'first'])
})

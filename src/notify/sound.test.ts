import { expect, test } from 'vitest'
import { chime } from './sound'

type Call = [string, ...unknown[]]

function fakeAudio(state: 'running' | 'suspended' = 'running') {
  const calls: Call[] = []
  const param = (name: string) => ({
    value: 0,
    setValueAtTime: (v: number, t: number) => void calls.push([`${name}.set`, v, t]),
    exponentialRampToValueAtTime: (v: number, t: number) => void calls.push([`${name}.ramp`, v, t]),
  })
  const node = () => ({ connect: (n: unknown) => n })
  const ctx = {
    currentTime: 5,
    state,
    destination: {},
    resume: async () => void calls.push(['resume']),
    createGain: () => ({ ...node(), gain: param('gain') }),
    createOscillator: () => {
      const o = { ...node(), type: '', frequency: { value: 0 }, start: (t: number) => void calls.push(['start', o.frequency.value, t]), stop: (t: number) => void calls.push(['stop', t]) }
      return o
    },
  }
  return { ctx: ctx as unknown as AudioContext, calls }
}

test('two short notes, rising, starting now and done within half a second', () => {
  const { ctx, calls } = fakeAudio()
  chime(() => ctx)
  const starts = calls.filter((c) => c[0] === 'start')
  expect(starts).toEqual([['start', 1318.5, 5], ['start', 1760, 5.09]])
  expect(Math.max(...calls.filter((c) => c[0] === 'stop').map((c) => c[1] as number))).toBeLessThan(5.5)
  // Quiet: the peak gain stays well under full scale.
  expect(Math.max(...calls.filter((c) => c[0] === 'gain.ramp').map((c) => c[1] as number))).toBeLessThanOrEqual(0.1)
  expect(calls.some((c) => c[0] === 'resume')).toBe(false)
})

test('a suspended context is resumed; no Web Audio is silence', () => {
  const { ctx, calls } = fakeAudio('suspended')
  chime(() => ctx)
  expect(calls[0]).toEqual(['resume'])
  expect(() => chime(() => null)).not.toThrow()
})

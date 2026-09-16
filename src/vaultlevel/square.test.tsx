import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { vi } from 'vitest'
import Square, { FLASH_MS } from './Square'
import { OVERLAY_MS } from '../pulse/Overlay'
import { createPulseStore } from '../pulse/store'
import type { LevelClient } from './client'
import type { VaultLevel } from './types'
import type { PulseEvent } from '../pulse/types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const vault = (over: Partial<VaultLevel> = {}): VaultLevel => ({
  root: '/v',
  pages: 1000,
  rules_fired: 200,
  fires: 300,
  fired_recent: 40,
  dormant: 0,
  label_only: 0,
  inbox: 0,
  error: null,
  ...over,
})
const ev = (over: Partial<PulseEvent> = {}): PulseEvent => ({ at: 1, kind: 'reflex', project: 'x', agent: 'x', slugs: [], ...over })

/** A client whose best-ever xp is whatever it was offered highest, like the Rust side. */
function fakeClient(levels: VaultLevel[]): LevelClient & { offered: number[] } {
  let best = 0
  const offered: number[] = []
  let i = 0
  return {
    offered,
    level: async () => levels[Math.min(i++, levels.length - 1)],
    best: async (xp) => {
      offered.push(xp)
      best = Math.max(best, xp)
      return best
    },
  }
}

async function render(node: React.ReactNode) {
  const host = document.createElement('div')
  const root = createRoot(host)
  await act(async () => root.render(node))
  return { host, unmount: () => act(() => root.unmount()) }
}

afterEach(() => vi.useRealTimers())

test('the square shows the level from the best xp, tinted by health', async () => {
  const client = fakeClient([vault()])
  const { host, unmount } = await render(<Square client={client} pulses={createPulseStore()} />)
  // 1000 + 5×200 + 300 = 2300
  expect(client.offered).toEqual([2300])
  expect(host.querySelector('.vl-level')?.textContent).toBe('lv 23')
  expect(host.querySelector('.vl-square')?.classList.contains('vl-green')).toBe(true)
  expect(host.querySelector('.vl-square')?.classList.contains('vl-on-fire')).toBe(true)
  expect(host.querySelector('.av-idle')).not.toBeNull()
  expect(host.querySelectorAll('.vl-dot').length).toBeGreaterThan(0)
  unmount()
})

test('a retired rule moves the colour and not the level', async () => {
  vi.useFakeTimers()
  const client = fakeClient([vault(), vault({ rules_fired: 20, dormant: 900 })])
  const { host, unmount } = await render(<Square client={client} pulses={createPulseStore()} pollMs={1000} />)
  expect(host.querySelector('.vl-level')?.textContent).toBe('lv 23')
  await act(async () => vi.advanceTimersByTime(1000))
  expect(client.offered[1]).toBeLessThan(client.offered[0])
  expect(host.querySelector('.vl-level')?.textContent).toBe('lv 23')
  expect(host.querySelector('.vl-square')?.classList.contains('vl-red')).toBe(true)
  unmount()
})

test('no vault reads as such and records nothing', async () => {
  const client = fakeClient([vault({ error: 'no mnemo vault found', pages: 0 })])
  const { host, unmount } = await render(<Square client={client} pulses={createPulseStore()} />)
  expect(host.querySelector('.vl-level')?.textContent).toBe('no vault')
  expect(host.querySelector('.vl-muted')).not.toBeNull()
  expect(client.offered).toEqual([])
  unmount()
})

test('a pulse sends the octopus away, flashes the halo, and it returns when the scene ends', async () => {
  vi.useFakeTimers()
  const pulses = createPulseStore()
  const { host, unmount } = await render(<Square client={fakeClient([vault()])} pulses={pulses} />)
  const octo = () => host.querySelector('.vl-octo')!
  expect(octo().classList.contains('vl-away')).toBe(false)

  await act(async () => pulses.getState().push(ev()))
  expect(octo().classList.contains('vl-away')).toBe(true)
  expect(host.querySelectorAll('.vl-lit').length).toBeGreaterThan(0)
  // The halo stays while he is away.
  expect(host.querySelectorAll('.vl-dot').length).toBeGreaterThan(0)

  await act(async () => vi.advanceTimersByTime(FLASH_MS))
  expect(host.querySelectorAll('.vl-lit')).toHaveLength(0)
  await act(async () => vi.advanceTimersByTime(OVERLAY_MS - FLASH_MS - 10))
  expect(octo().classList.contains('vl-away')).toBe(true)
  await act(async () => vi.advanceTimersByTime(20))
  expect(octo().classList.contains('vl-away')).toBe(false)
  unmount()
})

test('a second pulse keeps him away for a full scene', async () => {
  vi.useFakeTimers()
  const pulses = createPulseStore()
  const { host, unmount } = await render(<Square client={fakeClient([vault()])} pulses={pulses} />)
  await act(async () => pulses.getState().push(ev()))
  await act(async () => vi.advanceTimersByTime(OVERLAY_MS / 2))
  await act(async () => pulses.getState().push(ev({ kind: 'learned' })))
  await act(async () => vi.advanceTimersByTime(OVERLAY_MS - 10))
  expect(host.querySelector('.vl-octo')?.classList.contains('vl-away')).toBe(true)
  await act(async () => vi.advanceTimersByTime(20))
  expect(host.querySelector('.vl-octo')?.classList.contains('vl-away')).toBe(false)
  unmount()
})


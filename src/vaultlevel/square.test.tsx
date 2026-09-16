import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { vi } from 'vitest'
import Square, { EAT_MS, FLASH_MS } from './Square'
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
  // 1000 pages shelves 14 books.
  expect(host.querySelectorAll('.vl-book').length).toBe(14)
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
  // Health 0.335 lands in the orange band: five tones report the slide before it is red.
  expect(host.querySelector('.vl-square')?.classList.contains('vl-orange')).toBe(true)
  // Orange wears the poor pose.
  expect(host.querySelector('.av-poor')).not.toBeNull()
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

test('an empty vault reads as neutral, not as a sick one', async () => {
  const { host, unmount } = await render(<Square client={fakeClient([vault({ pages: 0, rules_fired: 0, fires: 0 })])} pulses={createPulseStore()} />)
  const square = host.querySelector('.vl-square')!
  // healthOf floors at 0 for an empty vault, which as a tone would be red.
  expect(square.classList.contains('vl-muted')).toBe(true)
  expect(square.classList.contains('vl-red')).toBe(false)
  expect(host.querySelector('.av-poor')).toBeNull()
  expect(square.getAttribute('aria-label')).toBe('the vault is empty')
  unmount()
})

test('a pulse sends the octopus away, lights the shelves, and he returns when the scene ends', async () => {
  vi.useFakeTimers()
  const pulses = createPulseStore()
  const { host, unmount } = await render(<Square client={fakeClient([vault()])} pulses={pulses} />)
  const octo = () => host.querySelector('.vl-octo')!
  expect(octo().classList.contains('vl-away')).toBe(false)

  await act(async () => pulses.getState().push(ev()))
  expect(octo().classList.contains('vl-away')).toBe(true)
  // The lamp comes on over the shelves, and the library stays while he is away.
  expect(host.querySelector('.vl-shelves')!.classList.contains('vl-lit')).toBe(true)
  expect(host.querySelectorAll('.vl-book').length).toBe(14)

  await act(async () => vi.advanceTimersByTime(FLASH_MS))
  expect(host.querySelector('.vl-shelves')!.classList.contains('vl-lit')).toBe(false)
  await act(async () => vi.advanceTimersByTime(OVERLAY_MS - FLASH_MS - 10))
  expect(octo().classList.contains('vl-away')).toBe(true)
  await act(async () => vi.advanceTimersByTime(20))
  expect(octo().classList.contains('vl-away')).toBe(false)
  unmount()
})

test('a learned pulse is eaten on the way back, and only that kind is', async () => {
  vi.useFakeTimers()
  const pulses = createPulseStore()
  const { host, unmount } = await render(<Square client={fakeClient([vault()])} pulses={pulses} />)

  await act(async () => pulses.getState().push(ev({ kind: 'learned' })))
  // Nothing to eat while the scene is still playing over the pane.
  expect(host.querySelector('.vl-morsel')).toBeNull()
  await act(async () => vi.advanceTimersByTime(OVERLAY_MS))
  expect(host.querySelector('.vl-morsel')).not.toBeNull()
  expect(host.querySelector('.vl-octo')?.classList.contains('vl-eating')).toBe(true)
  await act(async () => vi.advanceTimersByTime(EAT_MS))
  expect(host.querySelector('.vl-morsel')).toBeNull()

  // A rule firing is using memory, not absorbing it.
  await act(async () => pulses.getState().push(ev({ kind: 'reflex' })))
  await act(async () => vi.advanceTimersByTime(OVERLAY_MS + EAT_MS))
  expect(host.querySelector('.vl-morsel')).toBeNull()
  unmount()
})

test('the ▤ button opens the vault, and is absent when nothing can open it', async () => {
  const open = vi.fn()
  const withButton = await render(<Square client={fakeClient([vault()])} pulses={createPulseStore()} openVault={open} />)
  withButton.host.querySelector<HTMLButtonElement>('.vl-open')!.click()
  expect(open).toHaveBeenCalledTimes(1)
  withButton.unmount()

  const without = await render(<Square client={fakeClient([vault()])} pulses={createPulseStore()} />)
  expect(without.host.querySelector('.vl-open')).toBeNull()
  without.unmount()
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


test('the last book slots in with the gesture, and only while he is shelving', async () => {
  const shelving = await render(<Square client={fakeClient([vault()])} pulses={createPulseStore()} />)
  // One book is the one in his hands, landing as it leaves them.
  expect(shelving.host.querySelectorAll('.vl-slotting')).toHaveLength(1)
  expect(shelving.host.querySelector('.vl-shelving')).not.toBeNull()
  shelving.unmount()

  // A sick vault stops working, so nothing is being slotted either.
  const sick = await render(<Square client={fakeClient([vault({ rules_fired: 20, dormant: 900 })])} pulses={createPulseStore()} />)
  expect(sick.host.querySelector('.vl-shelving')).toBeNull()
  expect(sick.host.querySelectorAll('.vl-slotting')).toHaveLength(0)
  sick.unmount()

  // An empty vault has nothing to shelve and no books at all.
  const empty = await render(<Square client={fakeClient([vault({ pages: 0 })])} pulses={createPulseStore()} />)
  expect(empty.host.querySelector('.vl-shelving')).toBeNull()
  expect(empty.host.querySelectorAll('.vl-book')).toHaveLength(0)
  empty.unmount()
})

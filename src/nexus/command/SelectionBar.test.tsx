import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ActionResult, ShipAction } from '../ship-types'
import { ship } from './fixtures'
import { ARM_MS, SelectionBar } from './SelectionBar'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLElement
const ran: ShipAction[] = []
let cleared = 0
const run = async (a: ShipAction): Promise<ActionResult> => (ran.push(a), { ok: true, say: '', log: [] })

beforeEach(() => {
  ran.length = 0
  cleared = 0
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
})

const draw = (ids: string[]) => act(async () => root.render(<SelectionBar ship={ship()} selection={new Set(ids)} onClear={() => cleared++} run={run} />))
const bar = () => host.querySelector('[data-selection-bar]')
const btn = (b: string) => host.querySelector<HTMLButtonElement>(`[data-b="${b}"]`)!
const click = (b: string) => act(async () => btn(b).click())

test('nothing while there is no selection, or none of it is on the ship', async () => {
  await draw([])
  expect(bar()).toBeNull()
  await draw(['gone'])
  expect(bar()).toBeNull()
})

test('it counts what each button would act on', async () => {
  await draw(['105', '106', '103', 'gone'])
  expect(bar()!.textContent).toContain('3 selected')
  expect(btn('merge').textContent).toBe('✈ merge 1 green')
  expect(btn('stop').textContent).toBe('■ stop 1')
  expect(btn('open').textContent).toBe('⤢ open 3')
  await draw(['106'])
  expect(btn('merge').disabled).toBe(true)
  expect(btn('stop').disabled).toBe(true)
})

test('a merge takes a second click, then runs on the green ones and clears', async () => {
  await draw(['105', '106'])
  await click('merge')
  expect(ran).toEqual([])
  expect(btn('merge').textContent).toBe('confirm merge of 1?')
  await click('merge')
  expect(ran).toEqual([{ kind: 'merge', robotIds: ['105'] }])
  expect(cleared).toBe(1)
})

test('an armed button lapses', async () => {
  vi.useFakeTimers()
  await draw(['103'])
  await click('stop')
  await act(async () => vi.advanceTimersByTime(ARM_MS + 1))
  expect(btn('stop').textContent).toBe('■ stop 1')
  await click('stop')
  expect(ran).toEqual([])
})

test('open opens each through the view, then clears', async () => {
  await draw(['103', '105'])
  await click('open')
  expect(ran).toEqual([
    { kind: 'open', id: '103' },
    { kind: 'open', id: '105' },
  ])
  expect(cleared).toBe(1)
  await click('clear')
  expect(cleared).toBe(2)
})

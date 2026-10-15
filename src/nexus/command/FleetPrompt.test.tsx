import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ActionResult, ShipAction } from '../ship-types'
import { FleetPrompt } from './FleetPrompt'
import type { SessionSpec } from '../drawer/open'
import { MNEMO, ship } from './fixtures'
import { CONFIRM_MS } from './parse'

const started = vi.hoisted(() => ({ specs: [] as SessionSpec[], fail: null as string | null }))
vi.mock('../drawer/open', () => ({
  openSession: async (spec: SessionSpec) => {
    if (started.fail) throw new Error(started.fail)
    started.specs.push(spec)
  },
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLElement
const ran: ShipAction[] = []
const run = async (a: ShipAction): Promise<ActionResult> => {
  ran.push(a)
  return a.kind === 'dispatch' ? { ok: false, say: '#7 not dispatched in mnemo: gh is not logged in', log: [] } : { ok: true, say: `done: ${a.kind}`, log: [] }
}

beforeEach(async () => {
  ran.length = 0
  started.specs.length = 0
  started.fail = null
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  await act(async () => root.render(<FleetPrompt ship={ship()} run={run} />))
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
})

const input = () => host.querySelector<HTMLInputElement>('[data-fleet-prompt] input')!
const out = () => host.querySelector('[data-fleet-out]')!
async function type(line: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(), line)
    input().dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => input().form!.requestSubmit())
}

test('its input sits in [data-fleet-prompt], with the hint under it', () => {
  expect(input()).not.toBeNull()
  expect(host.querySelector('[data-fleet-hint]')!.textContent).toContain('/merge green')
})

test('an order runs and its result shows under the prompt; the line clears', async () => {
  await type('/msg #103 rebase on main')
  expect(ran).toEqual([{ kind: 'message', ids: ['103'], text: 'rebase on main' }])
  expect(out().textContent).toBe('done: message')
  expect(out().className).toContain('text-green-300')
  expect(input().value).toBe('')
  await type('/dispatch mnemo #7')
  expect(out().textContent).toBe('#7 not dispatched in mnemo: gh is not logged in')
  expect(out().className).toContain('text-rose-300')
})

test('a line that is not an order is a hint and runs nothing', async () => {
  await type('merge all of them')
  expect(ran).toEqual([])
  expect(out().textContent).toMatch(/^start with \//)
})

test('a batch verb waits for /yes', async () => {
  await type('/merge green')
  expect(ran).toEqual([])
  expect(out().textContent).toBe('merge 1 green PR: #105 — type /yes within 20 s to confirm')
  await type('/yes')
  expect(ran).toEqual([{ kind: 'merge', robotIds: ['105'] }])
  await type('/yes')
  expect(ran).toHaveLength(1)
  expect(out().textContent).toBe('nothing to confirm')
})

test('a confirmation lapses after 20 s', async () => {
  vi.useFakeTimers()
  await type('/stop all')
  await act(async () => vi.advanceTimersByTime(CONFIRM_MS + 1))
  expect(out().textContent).toBe('not confirmed within 20 s: nothing was done')
  await type('/yes')
  expect(ran).toEqual([])
})

test('another order drops the batch waiting for /yes', async () => {
  await type('/stop all')
  await type('/msg #103 hi')
  await type('/yes')
  expect(ran).toEqual([{ kind: 'message', ids: ['103'], text: 'hi' }])
})

test('/new <repo> starts claude in that repo, in the drawer, and says so; a repo not on the ship starts nothing', async () => {
  await type('/new mnemo')
  expect(started.specs).toEqual([{ kind: 'claude', root: MNEMO }])
  expect(out().textContent).toBe('▸ claude started in mnemo')
  await type('/new elsewhere')
  expect(started.specs).toHaveLength(1)
  expect(out().textContent).toContain('no repo called elsewhere')
  expect(ran).toEqual([])
  expect(host.querySelector('[data-fleet-hint]')!.textContent).toContain('/new <repo>')
})

test('/new replaces a batch waiting for its /yes', async () => {
  await type('/stop all')
  await type('/new mnemo')
  await type('/yes')
  expect(out().textContent).toBe('nothing to confirm')
  expect(ran).toEqual([])
})

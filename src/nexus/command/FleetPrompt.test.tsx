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
let closed = 0
const ran: ShipAction[] = []
const run = async (a: ShipAction): Promise<ActionResult> => {
  ran.push(a)
  return a.kind === 'dispatch' ? { ok: false, say: '#7 not dispatched in mnemo: gh is not logged in', log: [] } : { ok: true, say: `done: ${a.kind}`, log: [] }
}

/** Draws the line, open or closed, on the same root: closed, it keeps what it holds. */
const draw = (open = true) => act(async () => root.render(<FleetPrompt ship={ship()} run={run} open={open} onClose={() => void closed++} />))

beforeEach(async () => {
  ran.length = 0
  closed = 0
  started.specs.length = 0
  started.fail = null
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  await draw()
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
})

const input = () => host.querySelector<HTMLInputElement>('[data-fleet-prompt] input')!
const out = () => host.querySelector('[data-fleet-out]')!
const verbs = () => [...host.querySelectorAll<HTMLElement>('[data-fleet-verbs] [role="option"]')].map((o) => o.querySelector('code')!.textContent)
const picked = () => host.querySelector('[data-fleet-verbs] [aria-selected="true"] code')?.textContent
async function fill(line: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(), line)
    input().dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function type(line: string) {
  await fill(line)
  await act(async () => input().form!.requestSubmit())
}
const key = (k: string, target: EventTarget = input()) => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })
  act(() => void target.dispatchEvent(e))
  return e
}

test('open, it takes the focus with / typed and suggests every verb; closed, it draws nothing', async () => {
  expect(document.activeElement).toBe(input())
  expect(input().value).toBe('/')
  expect(verbs()).toEqual(['/msg all <text>', '/msg <#issue | captain> <text>', '/dispatch <repo> #<issue>', '/new <repo>', '/merge green', '/stop all', '/land <feature>'])
  await draw(false)
  expect(host.querySelector('[data-fleet-prompt]')).toBeNull()
  expect(host.querySelector('input')).toBeNull()
})

test('the suggestions follow what is typed; ↑/↓ pick one and Tab completes it', async () => {
  await fill('/m')
  expect(verbs()).toEqual(['/msg all <text>', '/msg <#issue | captain> <text>', '/merge green'])
  expect(picked()).toBe('/msg all <text>')
  key('ArrowDown')
  key('ArrowDown')
  expect(picked()).toBe('/merge green')
  key('ArrowDown')
  expect(picked()).toBe('/msg all <text>')
  key('ArrowUp')
  expect(picked()).toBe('/merge green')
  const tab = key('Tab')
  expect(tab.defaultPrevented).toBe(true)
  expect(input().value).toBe('/merge green')
  // Typing a verb's arguments, that verb's syntax stays; Tab keeps what was typed.
  await fill('/msg all rebase')
  expect(verbs()).toEqual(['/msg all <text>'])
  key('Tab')
  expect(input().value).toBe('/msg all rebase')
  await fill('/dis')
  key('Tab')
  expect(input().value).toBe('/dispatch ')
  await fill('hello')
  expect(verbs()).toEqual([])
})

test('a click on a suggestion completes it, the focus staying in the line', async () => {
  await fill('/st')
  const option = host.querySelector('[data-verb="/stop all"]')!
  const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
  act(() => void option.dispatchEvent(down))
  expect(down.defaultPrevented).toBe(true)
  expect(input().value).toBe('/stop all')
  expect(closed).toBe(0)
})

test('Esc and a click outside it close it; its own keys reach nothing else', async () => {
  const heard: string[] = []
  const listen = (e: KeyboardEvent) => void heard.push(e.key)
  document.addEventListener('keydown', listen)
  document.addEventListener('keydown', listen, true)
  try {
    for (const k of ['Tab', 'ArrowDown', 'ArrowUp', 'a']) key(k)
    expect(heard).toEqual([])
    const esc = key('Escape')
    expect(esc.defaultPrevented).toBe(true)
    expect(closed).toBe(1)
    expect(heard).toEqual([])
  } finally {
    document.removeEventListener('keydown', listen)
    document.removeEventListener('keydown', listen, true)
  }
  act(() => void input().dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
  expect(closed).toBe(1)
  act(() => void document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
  expect(closed).toBe(2)
  // A key typed elsewhere is not the line's.
  const away = document.body.appendChild(document.createElement('button'))
  expect(key('Escape', away).defaultPrevented).toBe(false)
  expect(closed).toBe(2)
  away.remove()
})

test('/yes is suggested only while a batch waits for it, and still takes it after the line is closed and reopened', async () => {
  await fill('/y')
  expect(verbs()).toEqual([])
  await type('/msg all hold on')
  expect(ran).toEqual([])
  expect(out().textContent).toMatch(/^message \d+ children: .* — type \/yes within 20 s to confirm$/)
  await fill('/y')
  expect(verbs()).toEqual(['/yes'])
  await draw(false)
  await draw(true)
  expect(out().textContent).toContain('type /yes')
  await type('/yes')
  expect(ran).toHaveLength(1)
  expect(ran[0]).toMatchObject({ kind: 'message', text: 'hold on' })
  expect(out().textContent).toBe('done: message')
  // Reopened with nothing waiting, the last result is gone.
  await draw(false)
  await draw(true)
  expect(out().textContent).toBe('')
})

test('an order runs and its result shows under the line; the line clears', async () => {
  await type('/msg #103 rebase on main')
  expect(ran).toEqual([{ kind: 'message', ids: ['103'], text: 'rebase on main' }])
  expect(out().textContent).toBe('done: message')
  expect(out().hasAttribute('data-err')).toBe(false)
  expect(input().value).toBe('')
  await type('/dispatch mnemo #7')
  expect(out().textContent).toBe('#7 not dispatched in mnemo: gh is not logged in')
  expect(out().hasAttribute('data-err')).toBe(true)
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
})

test('/new replaces a batch waiting for its /yes', async () => {
  await type('/stop all')
  await type('/new mnemo')
  await type('/yes')
  expect(out().textContent).toBe('nothing to confirm')
  expect(ran).toEqual([])
})

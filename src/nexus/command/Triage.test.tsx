import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ActionResult, Ship, ShipAction } from '../ship-types'
import { ship } from './fixtures'
import { cardsOf, SETTLED_MS, Triage } from './Triage'

vi.mock('../../mission/client', () => ({
  tauriMission: {
    timeline: async (id: string) => ({ lines: [{ at: '', state: 'working', detail: `${id}: reading the tests`, text: '' }], total: 1 }),
  },
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLElement
const ran: ShipAction[] = []
let closed = 0
const opened: string[] = []
let answer: ActionResult = { ok: true, say: 'answered', log: [] }
const run = async (a: ShipAction): Promise<ActionResult> => (ran.push(a), answer)

beforeEach(() => {
  ran.length = 0
  opened.length = 0
  closed = 0
  answer = { ok: true, say: 'answered', log: [] }
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
})

const draw = (s: Ship = ship(), open = true) =>
  act(async () => root.render(<Triage ship={s} open={open} onClose={() => closed++} onOpen={(id) => opened.push(id)} run={run} />))
const card = () => host.querySelector('[data-triage-card]')?.getAttribute('data-triage-card')
const key = (k: string) => act(async () => void window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })))

test('one card per need on the bridge, with its breadcrumbs, title and question', () => {
  const cards = cardsOf(ship())
  expect(cards.map((c) => [c.robot.id, c.crumbs.join(' ▸ '), c.title])).toEqual([
    ['101', 'mnemo-desktop ▸ ◆ fleet lead ▸ #101', 'Work on issue in this repo (101)'],
    ['102', 'mnemo-desktop ▸ ◆ fleet lead ▸ #102', 'Work on issue in this repo (102)'],
  ])
})

test('closed, it draws nothing', async () => {
  await draw(ship(), false)
  expect(host.querySelector('[data-triage]')).toBeNull()
})

test('a card shows the question, the child’s last lines and its options', async () => {
  await draw()
  expect(host.querySelector('[data-triage]')!.getAttribute('role')).toBe('dialog')
  expect(host.querySelector('[data-triage-count]')!.textContent).toBe('1/2')
  expect(host.querySelector('[data-triage-question]')!.textContent).toBe('❓ Which way?')
  expect(host.querySelector('[data-triage-lines]')!.textContent).toBe('101: reading the tests')
  expect([...host.querySelectorAll('[data-triage-option]')].map((b) => b.textContent)).toEqual(['1Keep it', '2Drop it'])
})

test('a digit answers with that option, and the next card comes up', async () => {
  await draw()
  await key('2')
  expect(ran).toEqual([{ kind: 'answer', robotId: '101', text: 'Drop it' }])
  expect(card()).toBe('102')
  expect(host.querySelector('[data-triage-question]')!.textContent).toBe('🔒 wants to run: Bash: rm -rf build')
  await key('n')
  expect(ran[1]).toEqual({ kind: 'answer', robotId: '102', text: 'no' })
})

test('a refused answer keeps the card and says why', async () => {
  answer = { ok: false, say: '#101: 101 is not asking a question now: nothing was typed', log: [] }
  await draw()
  await key('1')
  expect(card()).toBe('101')
  expect(host.querySelector('[data-triage-out]')!.textContent).toBe('#101: 101 is not asking a question now: nothing was typed')
})

test('arrows move between cards, T opens the robot, Esc closes', async () => {
  await draw()
  await key('ArrowRight')
  expect(card()).toBe('102')
  await key('ArrowRight')
  expect(card()).toBe('101')
  await key('ArrowLeft')
  expect(card()).toBe('102')
  await key('t')
  expect(opened).toEqual(['102'])
  expect(closed).toBe(1)
  await key('Escape')
  expect(closed).toBe(2)
})

test('it closes itself once none is left', async () => {
  vi.useFakeTimers()
  await draw()
  await key('1')
  await key('y')
  expect(host.querySelector('[data-triage-settled]')).not.toBeNull()
  expect(closed).toBe(0)
  await act(async () => vi.advanceTimersByTime(SETTLED_MS + 1))
  expect(closed).toBe(1)
})

test('a card settled elsewhere leaves a notice, and its key does not answer the card behind it', async () => {
  await draw()
  expect(card()).toBe('101')
  const after = ship()
  after.bridge = { exceptions: after.bridge.exceptions.filter((x) => !('robotId' in x) || x.robotId !== '101'), blocked: after.bridge.blocked.filter((r) => r.id !== '101') }
  await draw(after)
  expect(card()).toBeUndefined()
  expect(host.querySelector('[data-triage-gone]')!.textContent).toBe('#101 was settled elsewhere — ← → for the next')
  await key('y')
  await key('1')
  expect(ran).toEqual([])
  await key('ArrowRight')
  expect(card()).toBe('102')
})

test('"always" takes a second press', async () => {
  await draw()
  await key('ArrowRight')
  await key('a')
  expect(ran).toEqual([])
  expect(host.querySelector('[data-triage-out]')!.textContent).toBe('press A again within 4 s to allow it always: Bash: rm -rf build')
  expect(host.querySelector('[data-triage-option="always"]')!.textContent).toBe('AA again: always')
  await key('a')
  expect(ran).toEqual([{ kind: 'answer', robotId: '102', text: 'always' }])
})

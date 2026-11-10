import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { closeMenu, menuStore } from '../menu'
import { HOME, routeStore } from '../world/route'
import { sampleWorld } from '../world/sample'
import { rosterOrder, worldStore } from '../world/store'
import type { Pending } from '../world/types'
import { ScoreView, rowAt } from './ScoreView'
import type { Row } from './model'
import { DEFAULT_SPAN, scoreStore } from './state'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../instruments', () => ({ Instruments: ({ sessionId }: { sessionId: string }) => <div data-testid="instruments" data-session={sessionId} /> }))
vi.mock('../pending', async (real) => ({
  ...(await real<typeof import('../pending')>()),
  PendingCard: ({ pending }: { pending: Pending }) => <div data-testid="card" data-id={pending.id} />,
}))

const world = sampleWorld()
const titled = (text: string) => world.sessions.find((s) => s.title.startsWith(text))!
const order = rosterOrder(world, true)
/** Each line is this tall here: jsdom lays nothing out, so the rows are given a height. */
const LINE = 40

let host: HTMLElement
let root: Root
const $ = (sel: string) => host.querySelector<HTMLElement>(sel)!
const opened = () => menuStore.getState().open ?? null

async function rightClick(el: Element, at: { x: number; y: number } = { x: 300, y: 200 }): Promise<boolean> {
  const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y, button: 2 })
  await act(async () => void el.dispatchEvent(e))
  return e.defaultPrevented
}

const real = { top: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetTop'), height: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight') }

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext
  // The rows are measured from the DOM: here each is LINE tall, one under the other.
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => LINE })
  Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
    configurable: true,
    get(this: HTMLElement) {
      const rows = this.parentElement ? [...this.parentElement.querySelectorAll(':scope > [data-score-row]')] : []
      return Math.max(0, rows.indexOf(this)) * LINE
    },
  })
})
afterAll(() => {
  if (real.top) Object.defineProperty(HTMLElement.prototype, 'offsetTop', real.top)
  if (real.height) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', real.height)
})

beforeEach(async () => {
  localStorage.clear()
  worldStore.setState({ world, ready: true })
  routeStore.setState({ route: { ...HOME, view: 'score' }, recent: [] })
  scoreStore.setState({ span: DEFAULT_SPAN, end: null, flip: [], scrub: null, width: 1200 })
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  await act(async () => root.render(<ScoreView />))
})
afterEach(async () => {
  closeMenu()
  await act(async () => root.unmount())
  host.remove()
})

describe('a right-click in Score', () => {
  test('on a line’s card opens its session’s menu, and selects nothing', async () => {
    const s = titled('Tenant in every cache key')
    expect(await rightClick($(`[data-score-card="${s.id}"] .score-title`))).toBe(true)
    expect(opened()?.target).toEqual({ kind: 'session', id: s.id })
    expect(routeStore.getState().route).toMatchObject({ view: 'score', session: null, at: null })
  })

  test('on the line itself (the canvas) opens the menu of the session whose row is under the pointer, there', async () => {
    // the canvas starts at the top of the page here, so a pointer at y is in row y / LINE
    for (const i of [0, 3, order.length - 1]) {
      expect(await rightClick($('.score-canvas'), { x: 500, y: i * LINE + 10 })).toBe(true)
      expect(opened()).toMatchObject({ target: { kind: 'session', id: order[i].id }, place: { x: 500, y: i * LINE + 10 } })
    }
    expect(routeStore.getState().route).toMatchObject({ session: null, at: null })
  })

  test('on the canvas under the last line nothing opens', async () => {
    expect(await rightClick($('.score-canvas'), { x: 500, y: order.length * LINE + 10 })).toBe(false)
    expect(opened()).toBeNull()
  })

  test('on the head of the session beside the lines opens the selected session’s', async () => {
    const s = titled('Why is the bundle')
    await act(async () => routeStore.getState().go({ session: s.id }))
    await rightClick($('.score-sidehead h2'))
    expect(opened()?.target).toEqual({ kind: 'session', id: s.id })
  })
})

describe('the row under a point', () => {
  const rows = order.slice(0, 3).map((s) => ({ type: 'session', s, depth: 0 }) as unknown as Row)
  const boxes = [
    { y: 0, h: 40, h0: 40 },
    { y: 40, h: 100, h0: 40 },
    { y: 140, h: 40, h0: 40 },
  ]

  test('is the one whose box holds it, a card that grew included', () => {
    expect(rowAt(rows, boxes, 0)).toBe(rows[0])
    expect(rowAt(rows, boxes, 39.9)).toBe(rows[0])
    expect(rowAt(rows, boxes, 40)).toBe(rows[1])
    expect(rowAt(rows, boxes, 139)).toBe(rows[1])
    expect(rowAt(rows, boxes, 140)).toBe(rows[2])
  })

  test('is none above the first or under the last', () => {
    expect(rowAt(rows, boxes, -1)).toBeUndefined()
    expect(rowAt(rows, boxes, 180)).toBeUndefined()
    expect(rowAt(rows, [], 10)).toBeUndefined()
  })
})

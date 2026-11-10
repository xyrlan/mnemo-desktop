import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { HOME, routeStore, type Route } from '../world/route'
import { sampleWorld } from '../world/sample'
import { EMPTY, rosterOrder, worldStore } from '../world/store'
import type { Pending } from '../world/types'
import { ScoreView } from './ScoreView'
import { HOUR, MIN } from './model'
import { DEFAULT_SPAN, scoreStore } from './state'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// The two pieces the score shows but does not own, as stand-ins that say what they were given:
// these tests hold before and after the real ones land.
vi.mock('../instruments', () => ({
  Instruments: ({ sessionId, at }: { sessionId: string; at?: number | null }) => <div data-testid="instruments" data-session={sessionId} data-at={at ?? 'now'} />,
}))
vi.mock('../pending', async (real) => ({
  ...(await real<typeof import('../pending')>()),
  PendingCard: ({ pending, armed }: { pending: Pending; armed: boolean }) => <div data-testid="card" data-id={pending.id} data-armed={String(armed)} />,
}))

const world = sampleWorld()
const NOW = world.at
const titled = (text: string) => world.sessions.find((s) => s.title.startsWith(text))!
const route = () => routeStore.getState().route

let host: HTMLElement
let root: Root
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => host.querySelector<T>(sel)
const $$ = (sel: string) => [...host.querySelectorAll<HTMLElement>(sel)]
const card = (text: string) => $(`[data-score-card="${titled(text).id}"]`)!
const rowOf = (text: string) => $(`[data-score-row="${titled(text).id}"]`)!
const press = (el: Element, key: string, init: KeyboardEventInit = {}) => act(async () => void el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })))
const click = (el: HTMLElement) => act(async () => el.click())
const goTo = (patch: Partial<Route>) => act(async () => routeStore.getState().go(patch))

beforeAll(() => {
  // jsdom has no canvas: the view must stand without one
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext
})

beforeEach(async () => {
  localStorage.clear()
  worldStore.setState({ world, ready: true })
  routeStore.setState({ route: { ...HOME, view: 'score' }, recent: [] })
  scoreStore.setState({ span: DEFAULT_SPAN, end: null, flip: [], scrub: null, width: 1200 })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root.render(<ScoreView />))
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

test('before a world arrives it says so, and the lines appear when one does', async () => {
  await act(async () => worldStore.setState({ world: EMPTY, ready: false }))
  expect(host.textContent).toBe('Reading the fleet…')
  expect($$('[data-score-card]')).toEqual([])
  await act(async () => worldStore.setState({ world, ready: true }))
  expect($$('[data-score-card]').length).toBe(15)
})

describe('the now column', () => {
  test('is the roster’s order, one card per line', () => {
    expect($$('[data-score-card]').map((el) => el.dataset.scoreCard)).toEqual(rosterOrder(world, true).map((s) => s.id))
  })

  test('each card carries its session’s id as `data-session`, inside its row: what the frame slides a roster entry onto', () => {
    const entries = $$('[data-score-row] [data-session]')
    expect(entries.map((el) => el.dataset.session)).toEqual(rosterOrder(world, true).map((s) => s.id))
    expect(entries.every((el) => el.dataset.session === el.dataset.scoreCard)).toBe(true)
  })

  test('says each session’s state in a word, and how full its context is', () => {
    expect(rowOf('Order status').dataset.state).toBe('need')
    expect(card('Order status').textContent).toContain('needs you')
    expect(card('Order status').textContent).toContain('47%')
    expect(card('Order status').textContent).toContain('94k of 200k')
  })

  test('counts the lines and what waits', () => {
    expect($('.score-colhead')!.textContent).toBe('15 lines5 waiting')
  })
})

describe('selecting a line', () => {
  test('selects the session for every view and opens its instruments at now', async () => {
    expect($('[data-testid="instruments"]')).toBeNull()
    await click(card('Dark theme'))
    expect(route().session).toBe(titled('Dark theme').id)
    expect(rowOf('Dark theme').dataset.selected).toBe('true')
    expect($('[data-testid="instruments"]')!.dataset).toMatchObject({ session: titled('Dark theme').id, at: 'now' })
  })

  test('Enter on a card opens that session on stage, whichever is selected', async () => {
    await goTo({ session: titled('Dark theme').id })
    await press(card('Flaky snapshot'), 'Enter')
    expect(route()).toMatchObject({ view: 'console', session: titled('Flaky snapshot').id })
  })

  test('Close gives the room back to the score', async () => {
    await goTo({ session: titled('Dark theme').id })
    await click($$('.score-ghost').find((b) => b.textContent!.startsWith('Close'))!)
    expect(route().session).toBeNull()
    expect($('[data-testid="instruments"]')).toBeNull()
  })
})

describe('a held playhead', () => {
  const then = NOW - 3 * HOUR

  test('shows every session as it was then, and the instruments at that moment', async () => {
    await goTo({ session: titled('Idempotent retries').id, at: then })
    // this one began 35 minutes before now
    expect(rowOf('Why is the bundle').dataset.state).toBe('future')
    expect(card('Why is the bundle').textContent).toContain('not started')
    expect($('[data-testid="instruments"]')!.dataset.at).toBe(String(then))
    expect($('.score-colhead')!.textContent).toContain('replay · 3h ago')
    expect($('.score-asof')!.textContent).toMatch(/^as of /)
  })

  test('marks what it reads of the past as an estimate', async () => {
    const spent = () => card('Dark theme').querySelector('.score-spent')!.textContent!
    expect(spent()).not.toContain('≈')
    await goTo({ at: then })
    expect(spent()).toContain('≈')
  })

  test('is stepped with the arrows while the keys are the view’s, and let go with Esc', async () => {
    await press($('section')!, 'ArrowLeft')
    expect(route().at).toBe(NOW - 15 * MIN)
    await press($('section')!, 'Escape')
    expect(route().at).toBeNull()
  })

  test('Now returns', async () => {
    await goTo({ at: then })
    await click($('.score-back')!)
    expect(route().at).toBeNull()
    expect($('.score-colhead')!.textContent).toContain('15 lines')
  })
})

describe('what waits', () => {
  test('opens at its line when the line is selected, armed', async () => {
    expect($('[data-testid="card"]')).toBeNull()
    await goTo({ session: titled('Order status').id })
    const open = $$('[data-testid="card"]')
    expect(open.map((el) => el.dataset.armed)).toEqual(['true'])
    expect(rowOf('Order status').contains(open[0])).toBe(true)
  })

  test('opens for the item the route names, wherever the selection is', async () => {
    const merge = world.pending.find((p) => p.kind === 'merge')!
    await goTo({ session: titled('Order status').id, pending: merge.id })
    expect($$('[data-testid="card"]').map((el) => el.dataset.id)).toEqual([merge.id])
  })

  test('stands back while the playhead is held in the past, and says how to answer', async () => {
    await goTo({ session: titled('Order status').id, at: NOW - HOUR })
    expect($('[data-testid="card"]')).toBeNull()
    const hint = $('.score-waits')!
    expect(hint.textContent).toContain('It waits now.')
    await click(hint)
    expect(route().at).toBeNull()
    expect($('[data-testid="card"]')!.dataset.armed).toBe('true')
  })
})

describe('keys', () => {
  test('are never taken from a text field inside the view', async () => {
    const field = document.createElement('input')
    $('section')!.append(field)
    await press(field, 'ArrowLeft')
    await press(field, '0')
    expect(route().at).toBeNull()
  })

  test('are left alone with Ctrl, Alt or the command key held', async () => {
    await press($('section')!, 'ArrowLeft', { altKey: true })
    await press($('section')!, 'ArrowLeft', { ctrlKey: true })
    await press($('section')!, '+', { metaKey: true })
    expect(route().at).toBeNull()
    expect(scoreStore.getState().span).toBe(DEFAULT_SPAN)
  })

  test('a key the view used goes no further; one it did not does', async () => {
    const seen: string[] = []
    const listen = (ev: KeyboardEvent) => seen.push(ev.key)
    document.body.addEventListener('keydown', listen)
    await press($('section')!, 'ArrowLeft')
    await press($('section')!, 'ArrowDown')
    document.body.removeEventListener('keydown', listen)
    expect(seen).toEqual(['ArrowDown'])
  })

  test('Enter on a button inside the view stays that button’s', async () => {
    await goTo({ session: titled('Dark theme').id })
    await press($('.score-zoom button')!, 'Enter')
    expect(route().view).toBe('score')
  })
})

describe('the bar', () => {
  test('a zoom is one click away, and the one in force is marked', async () => {
    const pill = (name: string) => $$('.score-zoom button').find((b) => b.textContent === name)!
    expect(pill('12h').dataset.on).toBe('true')
    await click(pill('2h'))
    expect(scoreStore.getState().span).toBe(2 * HOUR)
    expect(pill('2h').dataset.on).toBe('true')
    expect(pill('12h').dataset.on).toBeUndefined()
  })

  test('“to now” appears once the axis no longer ends at now, and returns it', async () => {
    expect($('.score-tonow')).toBeNull()
    await act(async () => scoreStore.setState({ end: NOW - 4 * HOUR }))
    await click($('.score-tonow')!)
    expect(scoreStore.getState().end).toBeNull()
  })
})

describe('folding', () => {
  test('the chip on a parent folds its ended children into one row, which unfolds them', async () => {
    expect($('[data-ensemble]')).toBeNull()
    await click(card('Release 2.4').querySelector<HTMLElement>('.score-chip')!)
    expect($(`[data-score-card="${titled('Shell completions').id}"]`)).toBeNull()
    expect($('[data-ensemble]')!.textContent).toContain('1 ended child · 1 merged')
    // folding is not selecting
    expect(route().session).toBeNull()
    await click($('[data-ensemble] button')!)
    expect(card('Shell completions')).not.toBeNull()
  })
})

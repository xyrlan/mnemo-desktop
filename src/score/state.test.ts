import { HOME, routeStore } from '../world/route'
import { sampleWorld } from '../world/sample'
import { EMPTY, worldStore } from '../world/store'
import { HOUR, MIN, rows, scoreOf } from './model'
import { DEFAULT_SPAN, MAX_SPAN, MIN_SPAN, parseSpan, playhead, scoreKey, scoreStore, setSpan, setView, spanText } from './state'

const world = sampleWorld()
const NOW = world.at
const titled = (text: string) => world.sessions.find((s) => s.title.startsWith(text))!
const route = () => routeStore.getState().route
const score = () => scoreStore.getState()

beforeEach(() => {
  localStorage.clear()
  worldStore.setState({ world, ready: true })
  routeStore.setState({ route: { ...HOME, view: 'score' }, recent: [] })
  scoreStore.setState({ span: DEFAULT_SPAN, end: null, flip: [], scrub: null, width: 1200 })
})

describe('the playhead', () => {
  test('is the one being dragged, else the one held, else now; never past now', () => {
    expect(playhead(NOW, null, null)).toBe(NOW)
    expect(playhead(NOW, NOW - HOUR, null)).toBe(NOW - HOUR)
    expect(playhead(NOW, NOW - HOUR, NOW - 2 * HOUR)).toBe(NOW - 2 * HOUR)
    expect(playhead(NOW, NOW + HOUR, null)).toBe(NOW)
  })

  test('← steps it back from now by what 24 pixels of the axis hold; → brings it home', () => {
    expect(scoreKey('ArrowLeft')).toBe(true)
    expect(route().at).toBe(NOW - 15 * MIN)
    scoreKey('ArrowLeft')
    expect(route().at).toBe(NOW - 30 * MIN)
    scoreKey('ArrowRight')
    scoreKey('ArrowRight')
    expect(route().at).toBeNull()
    // at now there is nowhere further to go
    scoreKey('ArrowRight')
    expect(route().at).toBeNull()
  })

  test('with Shift it goes six steps', () => {
    scoreKey('ArrowLeft', true)
    expect(route().at).toBe(NOW - 90 * MIN)
  })

  test('a finer zoom makes a finer step', () => {
    setSpan(30 * MIN)
    scoreKey('ArrowLeft')
    expect(route().at).toBe(NOW - MIN)
  })

  test('the axis follows a playhead that leaves it', () => {
    setSpan(30 * MIN)
    for (let i = 0; i < 6; i++) scoreKey('ArrowLeft', true)
    const at = route().at!
    expect(at).toBe(NOW - 36 * MIN)
    const end = score().end!
    expect(end).toBeLessThan(NOW)
    expect(at).toBeGreaterThan(end - 30 * MIN)
    expect(at).toBeLessThan(end)
  })

  test('it never goes back further than the axis may', () => {
    setSpan(MAX_SPAN)
    for (let i = 0; i < 40; i++) scoreKey('ArrowLeft', true)
    expect(route().at).toBe(NOW - 48 * HOUR)
  })
})

describe('Esc', () => {
  test('lets go of the playhead and the pan first, then closes the selection, then is the frame’s', () => {
    routeStore.getState().go({ session: titled('Order status').id, at: NOW - HOUR })
    setView(DEFAULT_SPAN, NOW - 3 * HOUR)
    expect(scoreKey('Escape')).toBe(true)
    expect(route()).toMatchObject({ at: null, session: titled('Order status').id })
    expect(score().end).toBeNull()
    expect(scoreKey('Escape')).toBe(true)
    expect(route().session).toBeNull()
    expect(scoreKey('Escape')).toBe(false)
  })
})

describe('the zoom', () => {
  test('+ halves what the axis holds and − doubles it; 0 is twelve hours ending now', () => {
    scoreKey('+')
    expect(score().span).toBe(6 * HOUR)
    scoreKey('-')
    scoreKey('-')
    expect(score().span).toBe(24 * HOUR)
    setView(24 * HOUR, NOW - 5 * HOUR)
    scoreKey('0')
    expect(score()).toMatchObject({ span: DEFAULT_SPAN, end: null })
  })

  test('it stops at ten minutes and at fourteen days', () => {
    for (let i = 0; i < 12; i++) scoreKey('+')
    expect(score().span).toBe(MIN_SPAN)
    for (let i = 0; i < 20; i++) scoreKey('-')
    expect(score().span).toBe(MAX_SPAN)
  })

  test('zooming in keeps a held playhead where it is on the screen', () => {
    routeStore.getState().go({ at: NOW - 3 * HOUR })
    const place = () => (route().at! - ((score().end ?? NOW) - score().span)) / score().span
    const before = place()
    scoreKey('+')
    expect(score().span).toBe(6 * HOUR)
    expect(place()).toBeCloseTo(before, 6)
  })

  test('an edge at now follows now; one in the past is held', () => {
    setView(DEFAULT_SPAN, NOW)
    expect(score().end).toBeNull()
    setView(DEFAULT_SPAN, NOW - 2 * HOUR)
    expect(score().end).toBe(NOW - 2 * HOUR)
  })

  test('it is kept for the next run, and the edge is not', () => {
    setView(2 * HOUR, NOW - HOUR)
    expect(new URLSearchParams(localStorage.getItem('mnemo.score')!).get('span')).toBe('2h')
    expect(localStorage.getItem('mnemo.score')).not.toContain(String(NOW - HOUR))
    expect([parseSpan('2h'), parseSpan('30m'), parseSpan('2d'), parseSpan('soon'), parseSpan('1m')]).toEqual([2 * HOUR, 30 * MIN, 48 * HOUR, null, MIN_SPAN])
    expect([spanText(2 * HOUR), spanText(30 * MIN)]).toEqual(['2h', '30m'])
  })
})

describe('F', () => {
  const ensembles = () => rows(scoreOf(world), new Set(score().flip), route().session).filter((r) => r.type === 'ensemble').length

  test('folds the selected line’s ended children, and unfolds them again', () => {
    routeStore.getState().go({ session: titled('Release 2.4').id })
    expect(ensembles()).toBe(0)
    expect(scoreKey('f')).toBe(true)
    expect(ensembles()).toBe(1)
    expect(scoreKey('F')).toBe(true)
    expect(ensembles()).toBe(0)
  })

  test('on an ended child, folds its parent’s', () => {
    routeStore.getState().go({ session: titled('Shell completions').id })
    expect(scoreKey('f')).toBe(true)
    expect(score().flip).toEqual([titled('Release 2.4').id])
  })

  test('means nothing on a line with no ended child, or with no line selected', () => {
    expect(scoreKey('f')).toBe(false)
    routeStore.getState().go({ session: titled('Order status').id })
    expect(scoreKey('f')).toBe(false)
    // a child whose parent has no ended child to fold
    routeStore.getState().go({ session: titled('Tenant in every cache key').id })
    expect(scoreKey('f')).toBe(false)
    expect(score().flip).toEqual([])
  })
})

describe('Enter', () => {
  test('puts the selected session on stage', () => {
    routeStore.getState().go({ session: titled('Dark theme').id })
    expect(scoreKey('Enter')).toBe(true)
    expect(route()).toMatchObject({ view: 'console', session: titled('Dark theme').id })
  })

  test('is the frame’s when no line is selected', () => {
    expect(scoreKey('Enter')).toBe(false)
    expect(route().view).toBe('score')
  })
})

describe('answering', () => {
  test('a digit pressed in the past returns to now instead of answering what is not on screen', () => {
    routeStore.getState().go({ session: titled('Order status').id, at: NOW - HOUR })
    expect(scoreKey('1')).toBe(true)
    expect(route().at).toBeNull()
    // and the next press, now at now, is the frame's to answer with
    expect(scoreKey('1')).toBe(false)
  })

  test('at now a digit, and R, are left to the frame', () => {
    routeStore.getState().go({ session: titled('Order status').id })
    expect(scoreKey('1')).toBe(false)
    expect(scoreKey('r')).toBe(false)
  })

  test('in the past with nothing waiting on the line, a digit is left alone too', () => {
    routeStore.getState().go({ session: titled('Dark theme').id, at: NOW - HOUR })
    expect(scoreKey('1')).toBe(false)
    expect(route().at).toBe(NOW - HOUR)
  })
})

test('no key means anything before a world arrives, and other keys are never taken', () => {
  expect(scoreKey('n')).toBe(false)
  expect(scoreKey('ArrowUp')).toBe(false)
  worldStore.setState({ world: EMPTY, ready: false })
  expect(scoreKey('ArrowLeft')).toBe(false)
  expect(route().at).toBeNull()
})

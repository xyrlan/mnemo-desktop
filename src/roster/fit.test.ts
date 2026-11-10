import { sampleWorld } from '../world/sample'
import { fitStep, reveal, settle, startFit, type Measured } from './fit'
import { plan, type Density } from './model'

// A layout with no browser: every block of the plan has a height, so a drawing of the sample
// at a density can be measured against a room.
const HEIGHT = { band: 30, whole: 100, tight: 50, kid: 25, fold: 25, heap: 25 }
const world = sampleWorld()
const here = world.sessions.find((s) => s.title.startsWith('Idempotent retries')) ?? null

function drawing(room: number) {
  const calls: [Density, string[]][] = []
  const measure = (density: Density, roomy: ReadonlySet<string>): Measured => {
    calls.push([density, [...roomy]])
    const heights = new Map<string, number>()
    let total = 0
    for (const b of plan(world, { here, density, roomy })) {
      if (b.kind !== 'entry') {
        total += HEIGHT[b.kind]
        continue
      }
      const h = (b.tight ? HEIGHT.tight : HEIGHT.whole) + b.kids.length * HEIGHT.kid + (b.hidden && !b.tight ? HEIGHT.kid : 0)
      heights.set(b.root.id, h)
      total += h
    }
    return { fits: total <= room, free: room - total, heights }
  }
  return { measure, calls }
}
const height = (density: Density, roomy: ReadonlySet<string> = new Set()) => 1e6 - drawing(1e6).measure(density, roomy).free
const idOf = (text: string) => world.sessions.find((s) => s.title.startsWith(text))?.id ?? ''

describe('the density the roster takes', () => {
  test('is the design when the design fits, and nothing is drawn twice', () => {
    const { measure, calls } = drawing(height(0))
    expect(settle(measure)).toMatchObject({ density: 0, over: false, pass: 'done' })
    expect(calls.length).toBe(1)
  })

  test('is the first that fits', () => {
    expect(height(0)).toBeGreaterThan(height(1))
    expect(height(1)).toBeGreaterThan(height(2))
    expect(settle(drawing(height(0) - 1).measure).density).toBe(1)
    expect(settle(drawing(height(1)).measure).density).toBe(1)
    expect(settle(drawing(height(1) - 1).measure).density).toBe(2)
    expect(settle(drawing(height(2)).measure)).toMatchObject({ density: 2, over: false })
  })

  test('is the tightest when nothing fits, and the list is said to be over', () => {
    expect(settle(drawing(100).measure)).toMatchObject({ density: 3, over: true, pass: 'done' })
    expect(settle(drawing(100).measure).roomy.size).toBe(0)
  })
})

describe('the room left over', () => {
  test('goes back to the entries highest in the list', () => {
    // density 2 fits with room for one entry and a half to be whole again
    const room = height(2) + (HEIGHT.whole - HEIGHT.tight) * 1.5
    const fit = settle(drawing(room).measure)
    expect(fit.density).toBe(2)
    // the family on stage is already whole; the next one down takes the room
    expect([...fit.roomy]).toEqual([idOf('Order status')])
    expect(fit.over).toBe(false)
  })

  test('is not handed out past what there is', () => {
    // one px short of what three entries need (which is also where density 1 would fit)
    const fit = settle(drawing(height(2) + (HEIGHT.whole - HEIGHT.tight) * 3 - 1).measure)
    expect(fit.density).toBe(2)
    expect([...fit.roomy]).toEqual([idOf('Order status'), idOf('Optimistic updates')])
    expect(settle(drawing(height(2)).measure).roomy.size).toBe(0)
  })

  test('skips an entry that needs more than is left and gives it to the next that fits', () => {
    const order = new Map([
      ['a', 40],
      ['b', 40],
      ['c', 40],
    ])
    const loose = new Map([
      ['a', 140],
      ['b', 60],
      ['c', 70],
    ])
    let fit = fitStep(startFit(), { fits: false, free: -100, heights: loose })
    expect(fit).toMatchObject({ density: 1, pass: 'measure' })
    fit = fitStep(fit, { fits: true, free: 55, heights: order })
    expect(fit.pass).toBe('roomy')
    expect([...fit.roomy]).toEqual(['b', 'c'])
  })

  test('is taken back when the roomier drawing does not fit after all', () => {
    let fit = fitStep(startFit(), { fits: false, free: -10, heights: new Map([['a', 100]]) })
    fit = fitStep(fit, { fits: true, free: 60, heights: new Map([['a', 50]]) })
    expect([...fit.roomy]).toEqual(['a'])
    const kept = fitStep(fit, { fits: true, free: 10, heights: new Map([['a', 100]]) })
    expect(kept).toMatchObject({ pass: 'done', density: 1 })
    expect([...kept.roomy]).toEqual(['a'])
    const dropped = fitStep(fit, { fits: false, free: -4, heights: new Map([['a', 104]]) })
    expect(dropped).toMatchObject({ pass: 'done', density: 1, over: false })
    expect(dropped.roomy.size).toBe(0)
  })

  test('a fitting that is done stays as it is', () => {
    const done = settle(drawing(height(0)).measure)
    expect(fitStep(done, { fits: false, free: -500, heights: new Map() })).toBe(done)
  })
})

describe('keeping the selection in sight', () => {
  // a list showing 300px, with 12px wanted around the selection
  test('leaves the list alone when the selection is in sight', () => {
    expect(reveal(100, 160, 0, 300, 12)).toBe(0)
    expect(reveal(500, 560, 400, 300, 12)).toBe(400)
  })

  test('scrolls down just far enough for the row and what hangs under it', () => {
    expect(reveal(400, 460, 0, 300, 12)).toBe(172)
    expect(reveal(400, 600, 0, 300, 12)).toBe(312)
  })

  test('scrolls up to a row above, and never past the top', () => {
    expect(reveal(100, 160, 400, 300, 12)).toBe(88)
    expect(reveal(5, 60, 400, 300, 12)).toBe(0)
  })

  test('shows the top of what is taller than the room', () => {
    expect(reveal(400, 900, 0, 300, 12)).toBe(388)
  })
})

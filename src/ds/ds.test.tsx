import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { age, sum, tokens, WORD } from '../world/format'
import { sampleWorld } from '../world/sample'
import { STATE_ORDER, type Context, type TokenRow } from '../world/types'
import { compactionNote, curveOf, namedCliff } from './curve'
import { constellation, FIGURE_APART, FIGURE_BOX, figureDistance } from './figure'
import { galleryPage } from './flag'
import { tailStart } from './full'
import { ContextCurve, Full, Mark, Meter, Pill, Ring, SpentBar, SpentRow, Starfield, StateMark } from './index'
import { fill, spentKinds } from './spent'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const world = sampleWorld()
const withFalls = (n: number) => world.sessions.find((s) => s.context.compactions.length === n)!

let root: Root
let host: HTMLElement
const draw = (node: ReactNode) => act(() => root.render(node))
const press = (el: Element, key: string) => act(() => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })))
const click = (el: Element) => act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true })))

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.restoreAllMocks()
  localStorage.clear()
})

describe("a session's figure", () => {
  const ids = Array.from({ length: 300 }, (_, i) => `${(i * 2654435761).toString(16).padStart(8, '0')}-4a1c-4f0e-9b7d-${(i * 7919 + 13).toString(16).padStart(12, '0')}`)

  test('is the same every time it is worked out', () => {
    for (const s of world.sessions) expect(constellation(s.id)).toEqual(constellation(s.id))
  })

  test('no two sessions of the sample world share one', () => {
    for (const a of world.sessions) for (const b of world.sessions) if (a.id < b.id) expect(figureDistance(constellation(a.id), constellation(b.id)), `${a.title} | ${b.title}`).toBeGreaterThan(0)
  })

  test('ids that differ by their last character are far apart', () => {
    expect(figureDistance(constellation('session-1'), constellation('session-2'))).toBeGreaterThanOrEqual(4)
  })

  test('has four to six stars, none on top of another, all inside its ring', () => {
    for (const id of ids) {
      const { points } = constellation(id)
      expect(points.length).toBeGreaterThanOrEqual(4)
      expect(points.length).toBeLessThanOrEqual(6)
      points.forEach(([x, y, r], i) => {
        expect(Math.hypot(x - FIGURE_BOX / 2, y - FIGURE_BOX / 2) + r).toBeLessThan(FIGURE_BOX / 2 - 0.6)
        for (const [ox, oy] of points.slice(i + 1)) expect(Math.hypot(x - ox, y - oy)).toBeGreaterThanOrEqual(FIGURE_APART)
      })
    }
  })

  test('has one bright star, the first, and one line through all of them', () => {
    for (const id of ids) {
      const { points, lines } = constellation(id)
      expect(points[0][2]).toBeGreaterThan(Math.max(...points.slice(1).map((p) => p[2])))
      const reached = new Set(lines.flat())
      expect(reached.size).toBe(points.length)
      for (const i of reached) expect(points[i]).toBeDefined()
    }
  })

  test('comes in both families, closed and open', () => {
    const closed = ids.filter((id) => constellation(id).lines.length === constellation(id).points.length).length
    expect(closed).toBeGreaterThan(ids.length * 0.5)
    expect(closed).toBeLessThan(ids.length * 0.9)
  })
})

describe('the context curve', () => {
  const t0 = 1_000_000
  const context = (over: Partial<Context> = {}): Context => ({ tokens: 400, window: 1000, percent: 40, series: [[t0, 100], [t0 + 100, 500], [t0 + 200, 900], [t0 + 300, 150], [t0 + 400, 400]], compactions: [], ...over })

  test('runs from the first call to the last, against the window', () => {
    const c = curveOf(context())
    expect(c.points[0]).toEqual([0, 0.1])
    expect(c.points[c.points.length - 1]).toEqual([1, 0.4])
    expect(c.top).toBe(1000)
    expect(c.window).toBe(1)
    expect(c.now).toEqual({ x: 1, y: 0.4, tokens: 400 })
    expect(c.cut).toBe(1)
  })

  test('a compaction is a cliff: straight down at its moment, from what it took to what it left', () => {
    const c = curveOf(context({ compactions: [{ at: t0 + 250, pre: 950, post: 120, trigger: 'auto' }] }))
    const fall = c.points.filter((p) => p[0] === 0.625)
    expect(fall).toEqual([[0.625, 0.95], [0.625, 0.12]])
    expect(c.cliffs).toMatchObject([{ x: 0.625, from: 0.95, to: 0.12, pre: 950, post: 120, trigger: 'auto', later: false }])
    // the curve still passes every sample, in order
    expect(c.points.map((p) => p[0])).toEqual([0, 0.25, 0.5, 0.625, 0.625, 0.75, 1])
  })

  test('a sample taken at the cliff itself is its foot, not a second step', () => {
    const c = curveOf(context({ compactions: [{ at: t0 + 300, pre: 900, post: 150, trigger: null }] }))
    expect(c.points.filter((p) => p[0] === 0.75)).toEqual([[0.75, 0.9], [0.75, 0.15]])
  })

  test('a peak past the window lifts the top, and the window is marked under it', () => {
    const c = curveOf(context({ compactions: [{ at: t0 + 250, pre: 1250, post: 100, trigger: null }] }))
    expect(c.top).toBe(1250)
    expect(c.window).toBe(0.8)
  })

  test('as of a moment, now is the last call before it and what follows had not happened', () => {
    const c = curveOf(context({ compactions: [{ at: t0 + 250, pre: 950, post: 120, trigger: null }] }), t0 + 220)
    expect(c.now).toEqual({ x: 0.5, y: 0.9, tokens: 900 })
    expect(c.cut).toBeCloseTo(0.55)
    expect(c.cliffs[0].later).toBe(true)
    expect(curveOf(context({ compactions: [{ at: t0 + 250, pre: 950, post: 120, trigger: null }] }), t0 + 260).cliffs[0].later).toBe(false)
  })

  test('too few calls draw nothing, and say so', () => {
    const few = context({ series: [[t0, 100]] })
    expect(curveOf(few).points).toEqual([])
    draw(<ContextCurve context={few} now={t0 + 1000} />)
    expect(host.textContent).toBe('Too few calls to draw a curve.')
  })

  test('the sample sessions keep every cliff they had', () => {
    for (const s of world.sessions) {
      const c = curveOf(s.context)
      expect(c.cliffs.length).toBe(s.context.compactions.length)
      for (const [x, y] of c.points) {
        expect(x).toBeGreaterThanOrEqual(0)
        expect(x).toBeLessThanOrEqual(1)
        expect(y).toBeGreaterThanOrEqual(0)
        expect(y).toBeLessThanOrEqual(1)
      }
    }
  })

  test('the line under it says how many compactions, and the last', () => {
    expect(compactionNote(context(), t0)).toBe('Never compacted.')
    expect(compactionNote(context({ compactions: [{ at: t0, pre: 784_000, post: 22_000, trigger: 'auto' }] }), t0 + 3 * 3_600_000)).toBe('1 compaction. The last, 3h ago, took 784k down to 22k (auto).')
    expect(
      compactionNote(context({ compactions: [{ at: t0 + 60_000, pre: 850_000, post: 21_000, trigger: null }, { at: t0, pre: 784_000, post: 22_000, trigger: 'auto' }] }), t0 + 120_000),
    ).toBe('2 compactions. The last, 60s ago, took 850k down to 21k.')
  })

  test('it names the last cliff, and the one whose mark is picked', () => {
    const s = withFalls(3)
    const falls = [...s.context.compactions].sort((a, b) => a.at - b.at)
    const said = (k: { pre: number; post: number }) => `${tokens(k.pre)} → ${tokens(k.post)}`
    draw(<ContextCurve context={s.context} now={world.at} />)
    expect(host.querySelector('.mn-curve-fall')!.textContent).toContain(said(falls[2]))
    const marks = host.querySelectorAll('button.mn-curve-mark')
    expect(marks.length).toBe(3)
    click(marks[0])
    expect(host.querySelector('.mn-curve-fall')!.textContent).toContain(said(falls[0]))
    expect(host.querySelector('.mn-curve-fall')!.textContent).toContain(`${age(falls[0].at, world.at)} ago`)
    expect(host.querySelectorAll('.mn-curve-fall').length).toBe(1)
  })

  test('as of a moment it names the last cliff that had happened, or none', () => {
    const s = withFalls(3)
    const falls = [...s.context.compactions].sort((a, b) => a.at - b.at)
    expect(namedCliff(curveOf(s.context, falls[1].at + 1))!.at).toBe(falls[1].at)
    expect(namedCliff(curveOf(s.context, falls[0].at - 1))).toBeNull()
    expect(namedCliff(curveOf(s.context, falls[0].at - 1), falls[2].at)!.at).toBe(falls[2].at)
  })
})

describe('spent by kind', () => {
  const row: TokenRow = { input: 100, output: 300, cacheRead: 5000, cacheCreation: 600, thinking: 120 }

  test('is four kinds in one order, whose parts make the whole', () => {
    const parts = spentKinds(row)
    expect(parts.map((p) => p.label)).toEqual(['input', 'output', 'cache read', 'cache written'])
    expect(parts.reduce((n, p) => n + p.value, 0)).toBe(sum(row))
    expect(parts.reduce((n, p) => n + p.share, 0)).toBeCloseTo(1)
    expect(parts[2].share).toBeCloseTo(5000 / 6000)
  })

  test('thinking is said under the output and never counted again', () => {
    const parts = spentKinds(row)
    expect(parts[1].note).toBe('120 of it thinking')
    expect(parts.filter((p) => p.note).length).toBe(1)
    expect(spentKinds({ ...row, thinking: 0 })[1].note).toBeNull()
  })

  test('a session that spent nothing has four empty kinds, not a division by zero', () => {
    for (const none of [null, undefined, { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, thinking: 0 }]) {
      expect(spentKinds(none).map((p) => [p.value, p.share])).toEqual([[0, 0], [0, 0], [0, 0], [0, 0]])
    }
  })

  test('a bar fills in proportion, keeps a hairline for anything spent and never runs over', () => {
    expect(fill(50, 100)).toBe(0.5)
    expect(fill(0, 100)).toBe(0)
    expect(fill(1, 1_000_000)).toBe(0.004)
    expect(fill(300, 100)).toBe(1)
    expect(fill(5, 0)).toBe(0)
    expect(fill(Number.NaN, 100)).toBe(0)
  })

  test('the split bar gives a part to each kind that spent, sized by what it spent', () => {
    draw(<SpentBar tokens={{ ...row, input: 0 }} />)
    const parts = [...host.querySelectorAll<HTMLElement>('.mn-spent-bar > i')]
    expect(parts.map((p) => [p.dataset.kind, p.style.flexGrow])).toEqual([['output', '300'], ['cacheRead', '5000'], ['cacheCreation', '600']])
    expect(host.querySelector('.mn-spent-bar')!.getAttribute('aria-label')).toBe('input 0, output 300, cache read 5.0k, cache written 600')
  })

  test('a row that goes somewhere is a button, and says its number in tokens unless told otherwise', () => {
    const go = vi.fn()
    draw(
      <>
        <SpentRow label="Cursor pagination" value={16_000_000} of={98_000_000} onClick={go} />
        <SpentRow label="weekly all" value={21} of={100} text="21%" />
      </>,
    )
    const [first, second] = host.querySelectorAll('.mn-row')
    expect(first.tagName).toBe('BUTTON')
    expect(first.textContent).toBe('Cursor pagination16M')
    click(first)
    expect(go).toHaveBeenCalledTimes(1)
    expect(second.tagName).toBe('DIV')
    expect(second.textContent).toBe('weekly all21%')
  })
})

describe('a full value', () => {
  let cut = true
  beforeEach(() => {
    cut = true
    // jsdom lays nothing out: a head is as wide as its box unless the test says it is cut
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => 100)
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('mn-full-head') && cut ? 240 : 100
    })
  })
  const VALUE = 'Idempotent retries for the billing webhooks'
  const full = () => host.querySelector<HTMLElement>('.mn-full')!

  test('that fits is plain text: nothing to press', () => {
    cut = false
    draw(<Full value={VALUE} />)
    expect(full().textContent).toBe(VALUE)
    expect(full().getAttribute('role')).toBeNull()
    expect(full().tabIndex).toBe(-1)
    press(full(), 'Enter')
    expect(full().dataset.open).toBeUndefined()
  })

  test('that is cut can be reached and opened where it stands, and closed again', () => {
    draw(<Full value={VALUE} />)
    expect(full().textContent).toBe(VALUE)
    expect(full().getAttribute('role')).toBe('button')
    expect(full().tabIndex).toBe(0)
    expect(full().getAttribute('aria-expanded')).toBe('false')
    press(full(), 'Enter')
    expect(full().dataset.open).toBe('true')
    expect(full().getAttribute('aria-expanded')).toBe('true')
    press(full(), ' ')
    expect(full().dataset.open).toBeUndefined()
    click(full())
    expect(full().dataset.open).toBe('true')
  })

  test('stays something to close while it is open, though opened it no longer overflows', () => {
    draw(<Full value={VALUE} />)
    press(full(), 'Enter')
    cut = false
    draw(<Full value={VALUE} />)
    expect(full().getAttribute('role')).toBe('button')
    press(full(), 'Enter')
    expect(full().dataset.open).toBeUndefined()
    expect(full().getAttribute('role')).toBeNull()
  })

  test('closes when focus leaves it', () => {
    draw(<Full value={VALUE} />)
    act(() => full().focus())
    press(full(), 'Enter')
    expect(full().dataset.open).toBe('true')
    act(() => full().blur())
    expect(full().dataset.open).toBeUndefined()
  })

  test('keeps the key it used to itself, and leaves every other key alone', () => {
    const heard: string[] = []
    draw(
      <div onKeyDown={(e) => heard.push(e.key)}>
        <Full value={VALUE} />
      </div>,
    )
    press(full(), 'Enter')
    press(full(), 'ArrowDown')
    press(full(), 'n')
    expect(heard).toEqual(['ArrowDown', 'n'])
  })

  test('keeping the end, a path keeps its file name whole and the value is still all there', () => {
    const path = '~/work/atlas-api/src/services/billing/idempotency-key-store.ts'
    draw(<Full value={path} keep="end" />)
    expect(full().textContent).toBe(path)
    expect(host.querySelector('.mn-full-tail')!.textContent).toBe('idempotency-key-store.ts')
  })

  test('where the kept end starts', () => {
    expect('src/lib/cache.ts'.slice(tailStart('src/lib/cache.ts'))).toBe('cache.ts')
    expect('C:\\work\\atlas\\notes.md'.slice(tailStart('C:\\work\\atlas\\notes.md'))).toBe('notes.md')
    expect('~/work/atlas-api/'.slice(tailStart('~/work/atlas-api/'))).toBe('atlas-api/')
    expect('2f051967-9c1e-4d55-8a0b-6f1d2c3b4a59'.slice(tailStart('2f051967-9c1e-4d55-8a0b-6f1d2c3b4a59'))).toBe('6f1d2c3b4a59')
    expect(tailStart('cache.ts')).toBe(0)
  })
})

describe('the primitives', () => {
  test('a state is a shape of its own and always says its word', () => {
    const shapes = new Set<string>()
    for (const state of STATE_ORDER) {
      draw(<StateMark state={state} />)
      expect(host.textContent).toBe(WORD[state])
      shapes.add(host.querySelector('svg')!.innerHTML)
      draw(<StateMark state={state} word />)
      expect(host.textContent).toBe(WORD[state])
    }
    expect(shapes.size).toBe(STATE_ORDER.length)
  })

  test('a meter reads from 0 to 100 whatever it is given', () => {
    const read = (value: number) => {
      draw(<Meter value={value} label="context" />)
      const el = host.querySelector('[role="meter"]')!
      return [el.getAttribute('aria-valuenow'), el.querySelector<HTMLElement>('i')!.style.transform]
    }
    expect(read(0.47)).toEqual(['47', 'scaleX(0.4700)'])
    expect(read(1.8)).toEqual(['100', 'scaleX(1.0000)'])
    expect(read(-1)).toEqual(['0', 'scaleX(0.0000)'])
    expect(read(Number.NaN)).toEqual(['0', 'scaleX(0.0000)'])
  })

  test('a ring leaves undrawn what is not full, in pixels or in any length', () => {
    const left = (value: number) => {
      draw(<Ring value={value} size="7em" />)
      return host.querySelector('.fill')!.getAttribute('stroke-dashoffset')
    }
    expect(left(0.31)).toBe('0.6900')
    expect(left(4)).toBe('0.0000')
    expect(left(Number.NaN)).toBe('1.0000')
    expect(host.querySelector<HTMLElement>('.mn-ring')!.style.width).toBe('7em')
    draw(<Ring value={0.5} size={24} />)
    expect(host.querySelector<HTMLElement>('.mn-ring')!.style.width).toBe('24px')
  })

  test('a pill with something to do is a button that does it, and its words stay one run', () => {
    const go = vi.fn()
    const waiting = 5
    draw(
      <>
        <Pill onClick={go}>
          {waiting} wait for you <kbd>N</kbd>
        </Pill>
        <Pill>main</Pill>
      </>,
    )
    const [button, tag] = host.querySelectorAll('.mn-pill')
    expect(button.tagName).toBe('BUTTON')
    expect(tag.tagName).toBe('SPAN')
    click(button)
    expect(go).toHaveBeenCalledTimes(1)
    expect([...button.childNodes].map((n) => n.textContent)).toEqual(['5 wait for you ', 'N'])
  })

  test('the mark keeps as much of the crystal as its size can carry', () => {
    const shells = (size: number | string, detail?: 1 | 2 | 3) => {
      draw(<Mark size={size} detail={detail} />)
      return Number(host.querySelector<SVGElement>('.mn-mark')!.dataset.detail)
    }
    expect(shells(14)).toBe(1)
    expect(shells(24)).toBe(2)
    expect(shells(112)).toBe(3)
    expect(shells('1.6em')).toBe(2)
    expect(shells(14, 3)).toBe(3)
    const nodes = () => host.querySelectorAll('.mn-mark circle').length
    draw(<Mark size={112} />)
    expect(nodes()).toBe(16)
    draw(<Mark size={24} />)
    expect(nodes()).toBe(0)
  })

  test('the starfield is the same sky every time, with as many stars as asked', () => {
    const sky = (count?: number) => {
      draw(<Starfield count={count} />)
      return [...host.querySelectorAll('circle')].map((c) => `${c.getAttribute('cx')},${c.getAttribute('cy')}`)
    }
    const first = sky()
    expect(first.length).toBe(140)
    expect(sky()).toEqual(first)
    expect(sky(12)).toEqual(first.slice(0, 12))
    expect(new Set(first).size).toBe(140)
  })
})

describe('the gallery', () => {
  test('is drawn only when asked for, on the page named', () => {
    expect(galleryPage()).toBeNull()
    localStorage.setItem('mnemo.ds', 'readings')
    expect(galleryPage()).toBe('readings')
    localStorage.setItem('mnemo.ds', '1')
    expect(galleryPage()).toBe('identity')
  })
})

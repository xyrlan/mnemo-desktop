import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { actions, setActions } from '../world/actions'
import { HOME, go, routeStore } from '../world/route'
import { sampleActions, sampleWorld } from '../world/sample'
import { EMPTY, rosterOrder, worldStore } from '../world/store'
import type { Pending, Session, World } from '../world/types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// The two pieces the roster holds are other pieces' to draw. Here they are stand-ins that say
// what they were given, so these tests pass before and after those pieces land.
vi.mock('../orbit', () => ({
  OrbitMap: ({ focus }: { focus: string | null }) => <div data-test-map={focus ?? ''} />,
}))
vi.mock('../pending', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../pending')>()),
  PendingCard: ({ pending, armed }: { pending: Pending; armed: boolean }) => (
    <div data-test-card={pending.id} data-armed={String(armed)}>
      <input aria-label="in your words" />
    </div>
  ),
}))

const { Roster, rosterShown, setGroup, shownOrder, waitText } = await import('./index')

let root: Root
let host: HTMLElement
let world: World
let undo: () => void

const titled = (text: string): Session => {
  const hit = worldStore.getState().world.sessions.find((s) => s.title.startsWith(text))
  if (!hit) throw new Error(`no session titled ${text}`)
  return hit
}
const route = () => routeStore.getState().route
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => host.querySelector<T>(sel) as T
const $$ = (sel: string) => [...host.querySelectorAll<HTMLElement>(sel)]
const rowOf = (s: Session) => $(`[data-session="${s.id}"]`)
const shown = () => $$('[data-session]').map((el) => el.dataset.session)
const headings = () => $$('.roster-band').map((el) => el.textContent ?? '')
const key = (el: Element, k: string, init: KeyboardEventInit = {}) => act(() => void el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init })))
const click = (el: Element) => act(() => void (el as HTMLElement).click())

beforeEach(async () => {
  world = sampleWorld()
  worldStore.setState({ world, ready: true })
  undo = setActions(sampleActions(() => worldStore.getState().world, worldStore.getState().set))
  routeStore.setState({ route: { ...HOME, view: 'console' }, recent: [] })
  setGroup('attention')
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root.render(<Roster />))
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  undo()
  worldStore.setState({ world: EMPTY, ready: false })
  unlayout()
})

describe('the roster lists the fleet', () => {
  test('every session in roster order, once the family that hides an ended child is on stage', async () => {
    const ended = titled('Shell completions')
    expect(shown()).toEqual(rosterOrder(world).filter((s) => s !== ended).map((s) => s.id))
    await act(async () => go({ session: ended.id }))
    expect(shown()).toEqual(rosterOrder(world).map((s) => s.id))
  })

  test('says how many roots there are and what the bands hold', () => {
    expect($('.roster-head').textContent).toContain('Sessions9')
    expect(headings()).toEqual([expect.stringMatching(/^Waiting for you5/), 'Working1', 'Your turn5'])
  })

  test('a child is drawn inside its parent’s entry', () => {
    const entry = rowOf(titled('Idempotent retries')).closest('.roster-ent') as HTMLElement
    for (const text of ['Webhook signature', 'Forward-only migration', 'Cursor pagination', 'Tenant in every']) expect(entry.contains(rowOf(titled(text)))).toBe(true)
    expect(entry.contains(rowOf(titled('Order status')))).toBe(false)
  })

  test('an entry says its state in words, how full its context is and what its tree spent', () => {
    const text = rowOf(titled('Idempotent retries')).textContent ?? ''
    expect(text).toContain('working')
    expect(text).toContain('31%')
    expect(text).toContain('98M')
    expect(text).toContain('ATL')
    expect(rowOf(titled('Dark theme')).querySelector('b[data-hot]')?.textContent).toBe('83%')
    expect(rowOf(titled('Idempotent retries')).querySelector('b[data-hot]')).toBeNull()
  })

  test('a quiet family says how many ended children it keeps, and shows them when asked', async () => {
    const parent = titled('Release 2.4')
    const entry = rowOf(parent).closest('.roster-ent') as HTMLElement
    expect(entry.textContent).toContain('1 ended child')
    expect(entry.textContent).not.toContain('Shell completions')
    await click($('.roster-kid-more'))
    expect(route().session).toBe(parent.id)
    expect(entry.textContent).toContain('Shell completions')
    expect($('.roster-kid-more')).toBeNull()
  })

  test('a child that waits is not said twice: the line of what waits stands for its status', async () => {
    await act(async () => go({ session: titled('Idempotent retries').id }))
    const waits = titled('Webhook signature')
    expect(waits.needs).toBeTruthy()
    expect(rowOf(waits).textContent).not.toContain(waits.needs)
    expect(rowOf(waits).textContent).toContain('needs you')
    // a child with nothing waiting says what it is doing
    expect(rowOf(titled('Tenant in every')).textContent).toMatch(/runnings*Grep/)
  })

  test('an ended parent is one line, still chosen with a click', async () => {
    const before = worldStore.getState().world
    const notes = titled('Notes for the 2.5')
    await act(async () => worldStore.getState().set({ ...before, sessions: before.sessions.map((s) => (s.id === notes.id ? { ...s, state: 'ended' as const, live: false } : s)) }))
    expect(headings().at(-1)).toBe('Ended1')
    expect(rowOf(notes).closest('.roster-fold')).not.toBeNull()
    expect(rowOf(notes).textContent).not.toContain('ctx')
    await click(rowOf(notes))
    expect(route().session).toBe(notes.id)
    // on stage it is whole again
    expect(rowOf(notes).closest('.roster-fold')).toBeNull()
    expect(rowOf(notes).textContent).toContain('ctx')
  })

  test('an empty world says so', async () => {
    await act(async () => worldStore.setState({ world: EMPTY }))
    expect(host.textContent).toContain('No sessions yet.')
    expect(shown()).toEqual([])
  })

  test('hands the map the session on stage', async () => {
    expect($('[data-test-map]').dataset.testMap).toBe('')
    const s = titled('Order status')
    await act(async () => go({ session: s.id }))
    expect($('[data-test-map]').dataset.testMap).toBe(s.id)
  })
})

describe('choosing a session', () => {
  test('a click puts it on Console’s stage, from any view', async () => {
    await act(async () => go({ view: 'score', panel: 'memory', pending: 'x' }))
    const s = titled('Why is the bundle')
    await click(rowOf(s))
    expect(route()).toMatchObject({ view: 'console', session: s.id, pending: null, panel: null })
  })

  test('a child is chosen the same way', async () => {
    const child = titled('Tenant in every')
    await click(rowOf(child))
    expect(route().session).toBe(child.id)
  })

  test('the entry on stage is the one marked, and only it', async () => {
    expect($$('[aria-current]')).toEqual([])
    const child = titled('Tenant in every')
    await act(async () => go({ session: child.id }))
    expect($$('[aria-current]')).toEqual([rowOf(child)])
    expect((rowOf(child).closest('.roster-ent') as HTMLElement).hasAttribute('data-on')).toBe(true)
    const other = titled('Order status')
    await click(rowOf(other))
    expect($$('[aria-current]')).toEqual([rowOf(other)])
    expect($$('.roster-ent[data-on]').length).toBe(1)
  })
})

describe('what waits', () => {
  const card = () => $$('[data-test-card]')

  test('is one line under its session until that session is on stage', () => {
    expect(card()).toEqual([])
    expect($$('[data-wait]').length).toBe(world.pending.length)
    for (const p of world.pending) {
      const line = $(`[data-wait="${p.id}"]`)
      const session = worldStore.getState().world.sessions.find((s) => s.id === p.session) as Session
      // right after its session's row, before the next session
      expect(rowOf(session).compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      const after = shown()[shown().indexOf(session.id) + 1]
      if (after) expect(line.compareDocumentPosition($(`[data-session="${after}"]`)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
  })

  test('opens as the card, armed, in place of its line when its session is on stage', async () => {
    const s = titled('Order status')
    const p = world.pending.find((x) => x.session === s.id) as Pending
    await act(async () => go({ session: s.id }))
    expect(card().map((c) => [c.dataset.testCard, c.dataset.armed])).toEqual([[p.id, 'true']])
    expect($(`[data-wait="${p.id}"]`)).toBeNull()
    expect($$('[data-wait]').length).toBe(world.pending.length - 1)
    expect(rowOf(s).nextElementSibling?.contains(card()[0])).toBe(true)
  })

  test('choosing a line opens that item and puts its session on stage', async () => {
    const p = world.pending.find((x) => x.kind === 'permission') as Pending
    await act(async () => go({ view: 'orbit', session: titled('Dark theme').id }))
    await click($(`[data-wait="${p.id}"]`))
    expect(route()).toMatchObject({ view: 'console', session: p.session, pending: p.id })
    expect(card().map((c) => c.dataset.testCard)).toEqual([p.id])
  })

  test('of two items on one session one is open at a time, and choosing the other opens it', async () => {
    const s = titled('Order status')
    const first = world.pending.find((x) => x.session === s.id) as Pending
    const second: Pending = { ...first, id: 'second', kind: 'permission', text: 'permission: Bash — pnpm test', since: (first.since ?? 0) + 1000 }
    await act(async () => worldStore.getState().set({ ...world, pending: [...world.pending, second] }))
    await act(async () => go({ session: s.id }))
    expect(card().map((c) => c.dataset.testCard)).toEqual([first.id])
    expect($('[data-wait="second"]')).not.toBeNull()
    await click($('[data-wait="second"]'))
    expect(card().map((c) => c.dataset.testCard)).toEqual(['second'])
    expect($(`[data-wait="${first.id}"]`)).not.toBeNull()
    expect(route()).toMatchObject({ session: s.id, pending: 'second' })
  })

  test('the open item stays open when the selection moves on without closing it', async () => {
    const p = world.pending.find((x) => x.kind === 'question') as Pending
    await act(async () => go({ session: titled('Dark theme').id, pending: p.id }))
    expect(card().map((c) => c.dataset.testCard)).toEqual([p.id])
  })

  test('an answer takes the item off the list and moves its family where its new state puts it', async () => {
    const s = titled('Order status')
    const p = world.pending.find((x) => x.session === s.id) as Pending
    expect(headings()[0]).toMatch(/^Waiting for you5/)
    await act(async () => void (await actions().answer(p.id, 1)))
    expect($(`[data-wait="${p.id}"]`)).toBeNull()
    expect(headings()).toEqual([expect.stringMatching(/^Waiting for you4/), 'Working2', 'Your turn5'])
    const working = $$('.roster-band')[1]
    expect(working.compareDocumentPosition(rowOf(s)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(shown()).toEqual(rosterShown().filter((x) => !x.title.startsWith('Shell completions')).map((x) => x.id))
  })

  test('a line is said without repeating its own kind', () => {
    const p = world.pending.find((x) => x.kind === 'permission') as Pending
    expect(p.text).toMatch(/^permission: /)
    expect(waitText(p)).toBe(p.text.replace(/^permission: /, ''))
    expect(waitText({ ...p, text: 'permission:' })).toBe('permission:')
    expect(waitText({ ...p, kind: 'question', text: ' Which\n one? ' })).toBe('Which one?')
    expect($(`[data-wait="${p.id}"]`).textContent).toContain('3 choices')
  })
})

describe('the roster’s own keys', () => {
  test('G regroups by project and back, while the focus is inside it', async () => {
    const row = rowOf(titled('Why is the bundle'))
    row.focus()
    await key(row, 'g')
    expect(headings()).toEqual(['ATLatlas-api2', 'LUMlumen-web3', 'HARharbor-cli2', 'TEStessera2'])
    expect(shown()).toEqual(shownOrder(world, 'project').filter((s) => !s.title.startsWith('Shell completions')).map((s) => s.id))
    expect(rosterShown()).toEqual(shownOrder(world, 'project'))
    expect(localStorage.getItem('mnemo.roster.group')).toBe('project')
    await key(row, 'G')
    expect(headings()[1]).toBe('Working1')
    expect(rosterShown()).toEqual(rosterOrder(world))
  })

  test('the chip does what G does', async () => {
    await click($('.roster-chip'))
    expect($('.roster-chip').textContent).toContain('By project')
    expect(headings()[0]).toBe('ATLatlas-api2')
  })

  test('G is left alone in a text field, with a modifier, and outside the roster', async () => {
    await act(async () => go({ session: titled('Order status').id }))
    const field = $<HTMLInputElement>('[data-test-card] input')
    field.focus()
    await key(field, 'g')
    await key(rowOf(titled('Order status')), 'g', { ctrlKey: true })
    await key(rowOf(titled('Order status')), 'g', { altKey: true })
    await key(document.body, 'g')
    expect(headings()[1]).toBe('Working1')
  })

  test('Home and End select the top and the bottom of what is shown', async () => {
    const row = rowOf(titled('Why is the bundle'))
    await key(row, 'End')
    expect(route().session).toBe(rosterOrder(world).at(-1)?.id)
    await key(row, 'Home')
    expect(route().session).toBe(rosterOrder(world)[0].id)
    await act(async () => setGroup('project'))
    await key(row, 'End')
    expect(route().session).toBe(shownOrder(world, 'project').at(-1)?.id)
  })

  test('the arrows are not the roster’s: the frame walks the fleet', async () => {
    const before = route()
    await key(rowOf(titled('Why is the bundle')), 'ArrowDown')
    expect(route()).toEqual(before)
  })
})

// jsdom lays nothing out, so the tests that need a layout give it one: every row has a
// height, a row's top is the rows before it, and the list shows `room` px of them.
const ROWS = '.roster-band, .roster-main, .roster-kid, .roster-wait, .roster-card, .roster-heap'
let room = 0
let restore: (() => void) | null = null
const rowHeight = (el: Element) => (el.matches('.roster-main') ? (el.closest('[data-tight]') ? 40 : el.closest('.roster-fold') ? 20 : 100) : el.matches('.roster-card') ? 120 : 20)
const tall = (el: Element): number => {
  if (el.matches(ROWS)) return rowHeight(el)
  if (el.matches('.roster-scroll')) return room
  return [...el.querySelectorAll(ROWS)].reduce((n, r) => n + rowHeight(r), 0)
}
function layout(px: number) {
  room = px
  const proto = HTMLElement.prototype
  const before = { offsetHeight: Object.getOwnPropertyDescriptor(proto, 'offsetHeight'), clientHeight: Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight'), scrollHeight: Object.getOwnPropertyDescriptor(Element.prototype, 'scrollHeight'), rect: proto.getBoundingClientRect }
  Object.defineProperty(proto, 'offsetHeight', { configurable: true, get(this: HTMLElement) { return tall(this) } })
  Object.defineProperty(proto, 'clientHeight', { configurable: true, get(this: HTMLElement) { return tall(this) } })
  Object.defineProperty(proto, 'scrollHeight', { configurable: true, get(this: HTMLElement) { return this.matches('.roster-scroll') ? tall(this.querySelector('.roster-list') as Element) : tall(this) } })
  proto.getBoundingClientRect = function (this: HTMLElement) {
    const scroll = this.closest('.roster-scroll') as HTMLElement | null
    let top = 0
    if (scroll && this !== scroll) {
      for (const r of scroll.querySelectorAll(ROWS)) {
        if (r === this || r.contains(this)) break
        top += rowHeight(r)
      }
      top -= scroll.scrollTop
    }
    return { top, bottom: top + tall(this), left: 0, right: 0, width: 0, height: tall(this), x: 0, y: top, toJSON: () => ({}) } as DOMRect
  }
  restore = () => {
    for (const k of ['offsetHeight', 'clientHeight', 'scrollHeight'] as const) {
      const was = before[k]
      // the stand-ins sit on HTMLElement; taking them off shows jsdom's own again
      delete (proto as unknown as Record<string, unknown>)[k]
      if (was && k === 'offsetHeight') Object.defineProperty(proto, k, was)
    }
    proto.getBoundingClientRect = before.rect
  }
}
function unlayout() {
  restore?.()
  restore = null
}
/** Draw the roster again from nothing, in the layout now in force. */
async function redraw() {
  await act(async () => root.unmount())
  root = createRoot(host)
  await act(async () => root.render(<Roster />))
}
const scroller = () => $('.roster-scroll')
const beam = () => $('.roster-beam').style
const topOf = (el: HTMLElement) => el.getBoundingClientRect().top + scroller().scrollTop

describe('fitting the height it has', () => {
  test('is drawn as designed when that fits', async () => {
    layout(5000)
    await redraw()
    expect(scroller().dataset.density).toBe('0')
    expect($$('[data-tight]')).toEqual([])
    expect(scroller().hasAttribute('data-over')).toBe(false)
  })

  test('is drawn tighter until every root is on screen, the one on stage staying whole', async () => {
    const s = titled('Idempotent retries')
    await act(async () => go({ session: s.id }))
    layout(5000)
    await redraw()
    const loose = tall($('.roster-list'))
    // nine entries, five of them quiet, lose 60px each when tight
    layout(loose - 60 * 5)
    await redraw()
    expect(scroller().dataset.density).toBe('1')
    expect($$('[data-tight]').length).toBe(5)
    expect(tall($('.roster-list'))).toBeLessThanOrEqual(room)

    layout(loose - 60 * 8)
    await redraw()
    expect(scroller().dataset.density).toBe('2')
    expect($$('[data-tight]').length).toBe(8)
    expect((rowOf(s).closest('.roster-ent') as HTMLElement).hasAttribute('data-tight')).toBe(false)
    expect(scroller().hasAttribute('data-over')).toBe(false)
  })

  test('gives the room left over back to the entries highest in the list', async () => {
    layout(5000)
    await redraw()
    const loose = tall($('.roster-list'))
    // room for density 1 with 130px to spare: two quiet entries get their rows back
    layout(loose - 60 * 5 + 130)
    await redraw()
    expect(scroller().dataset.density).toBe('1')
    const quiet = ['Design the plugin', 'Release 2.4', 'Dark theme', 'Flaky snapshot', 'Notes for the 2.5'].map((t) => (rowOf(titled(t)).closest('.roster-ent') as HTMLElement).hasAttribute('data-tight'))
    expect(quiet).toEqual([false, false, true, true, true])
    expect(tall($('.roster-list'))).toBeLessThanOrEqual(room)
  })

  test('scrolls, and says so, when not even the tightest drawing fits', async () => {
    layout(200)
    await redraw()
    expect(scroller().dataset.density).toBe('3')
    expect(scroller().hasAttribute('data-over')).toBe(true)
  })

  test('is fitted again when the world changes what there is to draw', async () => {
    layout(5000)
    await redraw()
    const loose = tall($('.roster-list'))
    layout(loose)
    await redraw()
    expect(scroller().dataset.density).toBe('0')
    // a question opens as a card under its session: 100px more than its line
    await act(async () => go({ session: titled('Order status').id }))
    expect(scroller().dataset.density).toBe('1')
    await act(async () => go({ session: null }))
    expect(scroller().dataset.density).toBe('0')
  })
})

describe('the beam and the selection in sight', () => {
  test('the beam is on the row on stage, at its height, and hidden when nothing is', async () => {
    layout(5000)
    await redraw()
    expect(beam().opacity).toBe('0')
    const child = titled('Tenant in every')
    await act(async () => go({ session: child.id }))
    expect(beam().opacity).toBe('1')
    expect(beam().transform).toBe(`translateY(${topOf(rowOf(child))}px) scaleY(20)`)
    const root = titled('Order status')
    await act(async () => go({ session: root.id }))
    expect(beam().transform).toBe(`translateY(${topOf(rowOf(root))}px) scaleY(100)`)
    await act(async () => go({ session: null }))
    expect(beam().opacity).toBe('0')
  })

  test('the beam slides between sessions and is simply there on the first draw and when the list moves under it', async () => {
    const first = titled('Order status')
    await act(async () => go({ session: first.id }))
    layout(5000)
    await redraw()
    expect(beam().transition).toBe('none')
    await act(async () => go({ session: titled('Dark theme').id }))
    expect(beam().transition).toBe('')
    // the world moves the rows: the beam goes with them at once
    await act(async () => worldStore.getState().set({ ...worldStore.getState().world }))
    expect(beam().transition).toBe('none')
  })

  test('the list scrolls to the session chosen', async () => {
    layout(300)
    await redraw()
    expect(scroller().scrollTop).toBe(0)
    const last = rosterOrder(world).at(-1) as Session
    await act(async () => go({ session: last.id }))
    const row = rowOf(last).getBoundingClientRect()
    expect(scroller().scrollTop).toBeGreaterThan(0)
    expect(row.top).toBeGreaterThanOrEqual(0)
    expect(row.bottom).toBeLessThanOrEqual(room)
  })

  test('the card that opens under the session chosen is brought into sight with it', async () => {
    layout(300)
    await redraw()
    const asks = titled('Order status')
    // its row starts in sight, at the foot of what shows; its card would open below the fold
    expect(rowOf(asks).getBoundingClientRect().top).toBeLessThan(room)
    await act(async () => go({ session: asks.id }))
    const card = $('.roster-card').getBoundingClientRect()
    expect(card.height).toBe(120)
    expect(rowOf(asks).getBoundingClientRect().top).toBeGreaterThanOrEqual(0)
    expect(card.bottom).toBeLessThanOrEqual(room)
  })

  test('a list he scrolled himself stays where he put it until he chooses another session', async () => {
    layout(300)
    await redraw()
    await act(async () => go({ session: titled('Dark theme').id }))
    const followed = scroller().scrollTop
    expect(followed).toBeGreaterThan(0)
    // the world puts a family above the selection and he has not touched the list: it
    // goes on keeping the selection in sight
    const notes = titled('Notes for the 2.5')
    const before = worldStore.getState().world
    await act(async () => before && worldStore.getState().set({ ...before, sessions: before.sessions.map((s) => (s.id === notes.id ? { ...s, state: 'need' as const } : s)) }))
    const row = rowOf(titled('Dark theme')).getBoundingClientRect()
    expect(scroller().scrollTop).toBeGreaterThan(followed)
    expect(row.top).toBeGreaterThanOrEqual(0)
    expect(row.bottom).toBeLessThanOrEqual(room)
    // he scrolls to the top to read something else; the world changes again
    scroller().scrollTop = 0
    await act(async () => worldStore.getState().set({ ...worldStore.getState().world }))
    expect(scroller().scrollTop).toBe(0)
    await act(async () => go({ session: titled('Flaky snapshot').id }))
    expect(scroller().scrollTop).toBeGreaterThan(followed)
  })
})

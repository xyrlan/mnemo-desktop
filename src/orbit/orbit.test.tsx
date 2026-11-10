import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { setActions } from '../world/actions'
import { HOME, routeStore } from '../world/route'
import { sampleActions, sampleWorld } from '../world/sample'
import { EMPTY, presentSessions, worldStore } from '../world/store'
import type { Pending, Session, World } from '../world/types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// The two pieces Orbit is written against are stood in for, so these tests say the same
// before and after the pieces land. The lattice records which node was lit.
const lit: number[] = []
vi.mock('../ds', async (importOriginal) => {
  const real = await importOriginal<typeof import('../ds')>()
  const { createElement, useEffect } = await import('react')
  return {
    ...real,
    Lattice: ({ onReady }: { onReady?: (handle: unknown) => void }) => {
      useEffect(() => {
        onReady?.({ spines: 32, pulse: (i: number) => lit.push(i), node: () => ({ x: 10, y: 10 }), dispose: () => {} })
        // made once, as the real one is
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])
      return createElement('canvas', { 'data-asset': 'lattice' })
    },
  }
})
vi.mock('../pending', async (importOriginal) => {
  const real = await importOriginal<typeof import('../pending')>()
  const { createElement } = await import('react')
  return {
    ...real,
    PendingCard: ({ pending, armed }: { pending: Pending; armed: boolean }) => createElement('div', { 'data-test-card': pending.id, 'data-test-armed': String(armed) }, createElement('input', { 'data-test-words': '' })),
  }
})

const { OrbitMap, OrbitView } = await import('./index')
const { resetFlight } = await import('./flight')
const { orbitStore, resetOrbit } = await import('./state')

let root: Root
let host: HTMLElement
let said: string[]

const world = (): World => worldStore.getState().world
const route = () => routeStore.getState().route
const titled = (text: string): Session => world().sessions.find((s) => s.title.startsWith(text))!
const waitingOn = (text: string): Pending => world().pending.find((p) => p.session === titled(text).id)!
const $ = <T extends Element = HTMLElement>(selector: string): T | null => host.querySelector<T>(selector)
const $$ = (selector: string): HTMLElement[] => [...host.querySelectorAll<HTMLElement>(selector)]
const scene = (): HTMLElement => $('.orbit')!

async function show(node: React.ReactNode, at: Partial<typeof HOME> = {}) {
  routeStore.setState({ route: { ...HOME, ...at }, recent: [] })
  await act(async () => root.render(node))
}
/** A key, pressed wherever focus is. Returns whether something took it. */
async function press(key: string, on: Element = document.activeElement ?? document.body, init: KeyboardEventInit = {}): Promise<boolean> {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  await act(async () => void on.dispatchEvent(event))
  return event.defaultPrevented
}
const click = (el: Element) => act(async () => void el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })))
async function type(input: HTMLInputElement, text: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  lit.length = 0
  said = []
  localStorage.clear()
  worldStore.getState().set(sampleWorld())
  setActions(sampleActions(world, worldStore.getState().set, said))
  resetOrbit()
  resetFlight()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
})

describe('the scene', () => {
  test('every root session is a body carrying its full title, and no child is', async () => {
    await show(<OrbitView />)
    const roots = world().sessions.filter((s) => !s.parent)
    expect($$('[data-body]').map((el) => el.dataset.body).sort()).toEqual(roots.map((s) => s.id).sort())
    for (const s of roots) expect($(`[data-label="${s.id}"]`)?.textContent).toContain(s.title)
    // the sample's one ended child left the present hours ago: it is no moon
    expect($$('[data-moon]').length).toBe(presentSessions(world()).length - roots.length)
  })

  test('a body shows its own state while its family’s band says who needs him', async () => {
    await show(<OrbitView />)
    const body = $(`[data-body="${titled('Idempotent retries').id}"]`)!
    expect([body.dataset.state, body.dataset.band]).toEqual(['working', 'need'])
    expect($(`[data-moon="${titled('Webhook signature check').id}"]`)?.dataset.state).toBe('need')
  })

  test('the centre says how many rules memory holds', async () => {
    await show(<OrbitView />)
    expect($('.orbit-core-cap')?.textContent).toBe('4,160 rules in memory')
  })

  test('takes the keys when nothing else has them', async () => {
    await show(<OrbitView />)
    expect(document.activeElement).toBe(scene())
  })
})

describe('arrow keys', () => {
  test('the first one lands on the body that asks loudest', async () => {
    await show(<OrbitView />)
    expect(await press('ArrowDown')).toBe(true)
    expect(route().session).toBe(titled('Idempotent retries').id)
    expect($('[data-body][data-cursor]')?.dataset.body).toBe(titled('Idempotent retries').id)
  })

  test('move to the neighbour that way, the centre among them', async () => {
    await show(<OrbitView />, { session: titled('Order status history').id })
    await press('ArrowLeft')
    expect(route().session).toBeNull()
    expect($('.orbit-core')?.hasAttribute('data-cursor')).toBe(true)
    expect($('[data-body][data-cursor]')).toBeNull()
    await press('ArrowLeft')
    const left = world().sessions.find((s) => s.id === route().session)!
    expect(left.project).toBe('lumen-web')
    expect($('.orbit-core')?.hasAttribute('data-cursor')).toBe(false)
    await press('ArrowRight')
    expect(orbitStore.getState().core).toBe(true)
    await press('ArrowRight')
    expect(world().sessions.find((s) => s.id === route().session)!.project).toBe('atlas-api')
  })

  test('a child selected elsewhere puts the cursor on its family’s body', async () => {
    await show(<OrbitView />, { session: titled('Tenant in every cache key').id })
    expect($('[data-body][data-cursor]')?.dataset.body).toBe(titled('Idempotent retries').id)
  })

  test('are not Orbit’s inside a text field, with a modifier, or while the frame has a panel open', async () => {
    const order = waitingOn('Order status history')
    await show(<OrbitView />, { session: order.session })
    const before = route().session
    expect(await press('ArrowLeft', $('[data-test-words]')!)).toBe(false)
    expect(await press('ArrowLeft', scene(), { altKey: true })).toBe(false)
    expect(await press('ArrowLeft', scene(), { ctrlKey: true })).toBe(false)
    expect(route().session).toBe(before)
    await act(async () => routeStore.getState().go({ panel: 'memory' }))
    expect(await press('ArrowLeft', scene())).toBe(false)
    expect(await press('Escape', scene())).toBe(false)
    expect(route().session).toBe(before)
  })
})

describe('Enter', () => {
  test('opens the body under the cursor on stage', async () => {
    const id = titled('Why is the bundle').id
    await show(<OrbitView />, { session: id })
    expect(await press('Enter')).toBe(true)
    expect([route().view, route().session]).toEqual(['console', id])
  })

  test('is left to the frame when nothing is under the cursor', async () => {
    await show(<OrbitView />)
    expect(await press('Enter')).toBe(false)
    expect(route().view).toBe('orbit')
  })

  test('on the centre opens the vault, and Esc returns to the scene with the cursor where it was', async () => {
    await show(<OrbitView />, { session: titled('Order status history').id })
    await press('ArrowLeft')
    await press('Enter')
    expect($('[data-orbit-vault]')).not.toBeNull()
    expect(scene().dataset.open).toBe('vault')
    expect(route().view).toBe('orbit')
    // the arrows wait while the vault is read
    await press('ArrowLeft')
    expect(route().session).toBeNull()
    await press('Escape')
    expect($('[data-orbit-vault]')).toBeNull()
    expect($('.orbit-core')?.hasAttribute('data-cursor')).toBe(true)
  })
})

describe('the centre, opened', () => {
  test('Home opens it from anywhere and closes it again', async () => {
    await show(<OrbitView />)
    await press('Home')
    expect($('[data-figure="rules"]')?.textContent).toBe('4,160')
    expect($('[data-figure="spoke"]')?.textContent).toBe('219')
    expect($('[data-figure="silent"]')?.textContent).toBe('819')
    expect($$('[data-outcome]').map((el) => el.dataset.outcome)[0]).toBe('emitted')
    await press('Home')
    expect($('[data-orbit-vault]')).toBeNull()
  })

  test('a click on the centre opens it, and a rule it lists opens the session that last got it', async () => {
    await show(<OrbitView />)
    await click($('.orbit-core')!)
    const rule = $<HTMLButtonElement>('[data-rule]')!
    const slug = rule.dataset.rule!
    const last = world()
      .events.filter((e) => e.kind === 'rule-injected' && e.text === slug)
      .pop()!
    await click(rule)
    expect([route().view, route().session]).toEqual(['console', last.session])
  })
})

describe('what Orbit keeps and lets go', () => {
  test('opening the centre lets go of the body, so no card stays armed unseen', async () => {
    const order = waitingOn('Order status history')
    await show(<OrbitView />, { session: order.session })
    expect($('[data-test-card]')).not.toBeNull()
    await press('Home', scene())
    expect(route().session).toBeNull()
    expect($('[data-test-card]')).toBeNull()
    expect($('[data-orbit-vault]')).not.toBeNull()
  })

  test('the finder does not outlive the view, the opened centre does', async () => {
    await show(<OrbitView />)
    await press('Home')
    await press('/', scene())
    expect(orbitStore.getState().find).toBe('')
    await act(async () => root.render(null))
    expect(orbitStore.getState().find).toBeNull()
    await act(async () => root.render(<OrbitView />))
    expect($('[data-orbit-finder]')).toBeNull()
    expect($('[data-orbit-vault]')).not.toBeNull()
  })

  test('a project keeps its direction for the day, whatever the others gain', async () => {
    const sectors = () => $$('[data-sector]').map((el) => el.dataset.sector)
    await show(<OrbitView />)
    const before = sectors()
    expect(before[0]).toBe('atlas-api')
    // tessera now has the most sessions
    const most = { ...world(), projects: [...world().projects].reverse() }
    await act(async () => worldStore.getState().set(most))
    expect(sectors()).toEqual(before)
    // the next day the rim is dealt again
    await act(async () => worldStore.getState().set({ ...most, at: most.at + 2 * 86_400_000 }))
    expect(sectors()[0]).toBe('tessera')
  })
})

describe('typing', () => {
  test('finds a session: the matches are listed, most likely first, and stay lit in the scene', async () => {
    await show(<OrbitView />)
    expect(await press('o')).toBe(true)
    const input = $<HTMLInputElement>('[data-orbit-finder] input')!
    expect(input.value).toBe('o')
    expect(document.activeElement).toBe(input)
    await type(input, 'order')
    expect($$('[data-hit]').map((el) => el.querySelector('.orbit-f-title')!.textContent)).toEqual(['Order status history column', 'Cursor pagination for /orders', 'Empty state for the orders table', 'Optimistic updates on the orders screen'])
    const litBodies = $$('[data-body][data-match]').map((el) => el.dataset.body)
    expect(litBodies.sort()).toEqual([titled('Order status history').id, titled('Idempotent retries').id, titled('Optimistic updates').id].sort())
  })

  test('the arrows choose and Enter opens the chosen one on stage', async () => {
    await show(<OrbitView />)
    await press('o')
    const input = $<HTMLInputElement>('[data-orbit-finder] input')!
    await type(input, 'order')
    await press('ArrowDown', input)
    await press('ArrowDown', input)
    await press('ArrowUp', input)
    expect($('[data-hit][data-on]')?.dataset.hit).toBe(titled('Cursor pagination').id)
    // the scene's cursor did not move under the finder
    expect(route().session).toBeNull()
    await press('Enter', input)
    expect([route().view, route().session]).toEqual(['console', titled('Cursor pagination').id])
    expect($('[data-orbit-finder]')).toBeNull()
  })

  test('Esc closes the finder and gives the keys back to the scene', async () => {
    await show(<OrbitView />)
    await press('o')
    await press('Escape', $('[data-orbit-finder] input')!)
    expect($('[data-orbit-finder]')).toBeNull()
    expect(document.activeElement).toBe(scene())
  })

  test('the frame’s letters stay the frame’s, and / opens the finder for a name that starts with one', async () => {
    await show(<OrbitView />)
    for (const key of ['q', 'n', 'r', 'h', 'c', 't', 'C', ';', '1']) expect(await press(key)).toBe(false)
    expect($('[data-orbit-finder]')).toBeNull()
    expect(await press('/')).toBe(true)
    expect($<HTMLInputElement>('[data-orbit-finder] input')!.value).toBe('')
    expect($('.orbit-f-none')?.textContent).toMatch(/^Type part of a name/)
  })
})

describe('what waits', () => {
  test('opens as a card on its own body, armed, and the body’s label steps aside', async () => {
    const order = waitingOn('Order status history')
    await show(<OrbitView />, { session: order.session, pending: order.id })
    expect($$('[data-orbit-card]').map((el) => el.dataset.orbitCard)).toEqual([order.id])
    const card = $('[data-test-card]')!
    expect([card.dataset.testCard, card.dataset.testArmed]).toEqual([order.id, 'true'])
    expect($(`[data-label="${order.session}"]`)?.hasAttribute('data-asked')).toBe(true)
    expect($('[data-orbit-card]')?.textContent).toContain('Order status history column')
    expect($('[data-orbit-card]')?.textContent).not.toContain('a child of')
  })

  test('a child’s card opens on its family’s body, says whose child it is, and lights the moon that asks', async () => {
    const push = waitingOn('Webhook signature check')
    await show(<OrbitView />, { session: push.session, pending: push.id })
    expect($('[data-orbit-card]')?.textContent).toContain('a child of Idempotent retries for the billing webhooks')
    expect($(`[data-label="${titled('Idempotent retries').id}"]`)?.hasAttribute('data-asked')).toBe(true)
    expect($$('[data-moon][data-asked]').map((el) => el.dataset.moon)).toEqual([push.session])
  })

  test('the card of the selected session is open, since a digit would answer it', async () => {
    await show(<OrbitView />, { session: titled('Order status history').id })
    expect($('[data-test-card]')?.dataset.testCard).toBe(waitingOn('Order status history').id)
    // a parent whose child asks is not itself waiting
    await act(async () => routeStore.getState().go({ session: titled('Idempotent retries').id }))
    expect($('[data-orbit-card]')).toBeNull()
  })

  test('the line on a label that says what waits opens that card', async () => {
    await show(<OrbitView />)
    const push = waitingOn('Webhook signature check')
    await click($(`[data-want="${push.id}"]`)!)
    expect([route().session, route().pending, route().view]).toEqual([push.session, push.id, 'orbit'])
    expect($('[data-test-card]')?.dataset.testCard).toBe(push.id)
  })

  test('a moon that waits opens its card; one that does not opens on stage', async () => {
    await show(<OrbitView />)
    const merge = waitingOn('Cursor pagination')
    await click($(`[data-moon="${merge.session}"]`)!)
    expect([route().pending, route().view]).toEqual([merge.id, 'orbit'])
    const quiet = titled('Tenant in every cache key')
    await click($(`[data-moon="${quiet.id}"]`)!)
    expect([route().session, route().view]).toEqual([quiet.id, 'console'])
  })

  test('Esc closes the card, then lets go of the body', async () => {
    const order = waitingOn('Order status history')
    await show(<OrbitView />, { session: order.session, pending: order.id })
    await press('Escape', scene())
    expect([route().pending, route().session]).toEqual([null, order.session])
    await press('Escape', scene())
    expect(route().session).toBeNull()
    expect($('[data-orbit-card]')).toBeNull()
    expect(await press('Escape', scene())).toBe(false)
  })

  test('a click on a body or its title opens it on stage', async () => {
    await show(<OrbitView />)
    const id = titled('Dark theme contrast').id
    await click($(`[data-label="${id}"] .orbit-lab-title`)!)
    expect([route().view, route().session]).toEqual(['console', id])
  })

  test('when the last one is answered the band says so and a ring crosses the scene once', async () => {
    await show(<OrbitView />)
    expect($('[data-band="need"].orbit-band-name')?.textContent).toBe('needs you')
    expect($('.orbit-settle')).toBeNull()
    for (const p of [...world().pending]) await act(async () => void (await sampleActions(world, worldStore.getState().set, said).answer(p.id, 1)))
    expect(world().pending).toEqual([])
    expect($('[data-band="need"].orbit-band-name')?.textContent).toBe('nothing needs you')
    expect($$('.orbit-settle').length).toBe(1)
    expect($$('[data-body][data-band="need"]')).toEqual([])
  })
})

describe('memory in flight', () => {
  const line = () => $('.orbit-tick')!.textContent ?? ''

  test('the newest events are replayed once, each lighting the node it leaves from, and then nothing ticks', async () => {
    await show(<OrbitView />)
    expect(line()).toMatch(/memory moved \d+ times lately · replay the last 14/)
    expect(vi.getTimerCount()).toBe(1)
    const events = (await import('./model')).memoryEvents(world())
    const newest = events.slice(-14)
    const node = (await import('./model')).nodeFor
    // jsdom has no Web Animations, so a mote is not drawn here; the line names each as it goes
    Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: () => ({}) })
    try {
      await act(async () => void vi.advanceTimersByTime(600))
      expect(line()).toContain(newest[0].slug)
      expect(line()).toContain(world().sessions.find((s) => s.id === newest[0].session)!.title.slice(0, 44))
      expect(lit).toEqual([node(newest[0].slug, 32)])
      expect($$('.orbit-mote').length).toBe(1)
      for (let i = 1; i < 14; i++) await act(async () => void vi.advanceTimersByTime(2600))
      expect(line()).toContain(newest[13].slug)
      expect(lit.length).toBe(14)
      await act(async () => void vi.advanceTimersByTime(2600))
      expect(line()).toMatch(/replay the last 14/)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      delete (HTMLElement.prototype as { animate?: unknown }).animate
    }
  })

  test('a rule handed over later flies on its own', async () => {
    await show(<OrbitView />)
    await act(async () => void vi.advanceTimersByTime(600 + 14 * 2600))
    expect(vi.getTimerCount()).toBe(0)
    const to = titled('Dark theme contrast')
    await act(async () => worldStore.getState().set({ ...world(), events: [...world().events, { at: world().at, kind: 'rule-injected', session: to.id, text: 'a-new-rule' }] }))
    expect(vi.getTimerCount()).toBe(1)
    await act(async () => void vi.advanceTimersByTime(600))
    expect(line()).toContain('a-new-rule')
    expect(line()).toContain(to.title)
  })

  test('nothing flies with motion reduced, or while the centre is open', async () => {
    host.setAttribute('data-motion', 'reduced')
    await show(<OrbitView />)
    expect(vi.getTimerCount()).toBe(0)
    host.removeAttribute('data-motion')
    await click($('[data-replay]')!)
    expect(vi.getTimerCount()).toBe(1)
    await press('Home', scene())
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('a world with nothing in it', () => {
  test('says so, and the arrows find only the centre', async () => {
    worldStore.getState().set({ ...EMPTY, source: 'sample', at: 1 })
    await show(<OrbitView />)
    expect($('.orbit-empty')?.textContent).toMatch(/^Nothing in orbit/)
    expect($$('[data-body]')).toEqual([])
    await press('ArrowRight')
    expect($('.orbit-core')?.hasAttribute('data-cursor')).toBe(true)
  })
})

describe('more sessions than the scene can name', () => {
  test('the oldest ended ones are beads on the rim, counted on the outer band, and still open on stage', async () => {
    const model = titled('Notes for the 2.5')
    const more = Array.from({ length: 14 }, (_, i): Session => ({ ...model, id: `ended-${i}`, short: `ended-${i}`, title: `Ended ${i}`, state: 'ended', live: false, children: [], lastAt: world().at - (i + 1) * 60_000 }))
    worldStore.getState().set({ ...world(), sessions: [...world().sessions, ...more] })
    await show(<OrbitView />)
    expect($$('[data-body]').length).toBe(18)
    expect($$('[data-bead]').map((el) => el.dataset.bead)).toEqual(['ended-9', 'ended-10', 'ended-11', 'ended-12', 'ended-13'])
    expect($('[data-band="ended"].orbit-band-name')?.textContent).toBe('ended · 5 more on the rim')
    await click($('[data-bead="ended-12"]')!)
    expect([route().view, route().session]).toEqual(['console', 'ended-12'])
  })
})

describe('the map', () => {
  const litBodies = () => $$('[data-map-body][data-lit]').map((el) => el.dataset.mapBody)

  test('draws every body and lights the family of the session in focus', async () => {
    const child = titled('Webhook signature check')
    await show(<OrbitMap focus={child.id} />, { view: 'console', session: child.id })
    expect($$('[data-map-body]').length).toBe(world().sessions.filter((s) => !s.parent).length)
    expect(litBodies()).toEqual([titled('Idempotent retries').id])
    expect($$('[data-map-moon][data-lit]').map((el) => el.dataset.mapMoon)).toEqual([child.id])
    expect($('[data-orbit-map]')?.dataset.focus).toBe(child.id)
  })

  test('a root in focus lights its body and no moon; no focus lights nothing', async () => {
    const id = titled('Dark theme contrast').id
    await show(<OrbitMap focus={id} />, { view: 'console', session: id })
    expect(litBodies()).toEqual([id])
    expect($$('[data-map-moon][data-lit]')).toEqual([])
    await act(async () => root.render(<OrbitMap focus={null} />))
    expect(litBodies()).toEqual([])
    expect($('[data-orbit-map]')?.hasAttribute('data-focus')).toBe(false)
  })

  test('a body on it puts that session on stage; the map itself leads back to the scene', async () => {
    const id = titled('Dark theme contrast').id
    await show(<OrbitMap focus={id} />, { view: 'console', session: id })
    const other = titled('Why is the bundle').id
    await click($(`[data-map-body="${other}"]`)!)
    expect([route().view, route().session]).toEqual(['console', other])
    await click($('[data-orbit-map]')!)
    expect([route().view, route().session]).toEqual(['orbit', other])
  })

  test('stands where the scene stands: the same directions for the same bodies', async () => {
    const { geom, stageOf } = await import('./layout')
    const { buildScene } = await import('./model')
    await show(<OrbitMap focus={null} />)
    const stage = stageOf(buildScene(world()), geom(1920, 1026, 14))
    for (const p of stage.placed) expect($(`[data-map-body="${p.id}"]`)?.getAttribute('transform')).toBe(`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`)
  })
})

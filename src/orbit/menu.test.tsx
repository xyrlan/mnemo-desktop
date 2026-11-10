import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { closeMenu, menuStore } from '../menu'
import { HOME, routeStore } from '../world/route'
import { sampleWorld } from '../world/sample'
import { worldStore } from '../world/store'
import type { Pending, Session } from '../world/types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// The lattice and the waiting card are other pieces: stand-ins, as in Orbit's own tests.
vi.mock('../ds', async (importOriginal) => {
  const real = await importOriginal<typeof import('../ds')>()
  const { createElement } = await import('react')
  return { ...real, Lattice: () => createElement('canvas', { 'data-asset': 'lattice' }) }
})
vi.mock('../pending', async (importOriginal) => {
  const real = await importOriginal<typeof import('../pending')>()
  const { createElement } = await import('react')
  return { ...real, PendingCard: ({ pending }: { pending: Pending }) => createElement('div', { 'data-test-card': pending.id }) }
})

const { OrbitView } = await import('./index')
const { orbitStore, resetOrbit } = await import('./state')
const { resetFlight } = await import('./flight')

let root: Root
let host: HTMLElement

const world = () => worldStore.getState().world
const titled = (text: string): Session => world().sessions.find((s) => s.title.startsWith(text))!
const opened = () => menuStore.getState().open?.target ?? null
const $ = (sel: string) => host.querySelector<HTMLElement>(sel)!

async function rightClick(el: Element): Promise<boolean> {
  const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 200, button: 2 })
  await act(async () => void el.dispatchEvent(e))
  return e.defaultPrevented
}
async function press(key: string, init: KeyboardEventInit = {}): Promise<boolean> {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  await act(async () => void $('.orbit').dispatchEvent(e))
  return e.defaultPrevented
}

beforeEach(async () => {
  localStorage.clear()
  resetOrbit()
  resetFlight()
  worldStore.setState({ world: sampleWorld(), ready: true })
  routeStore.setState({ route: { ...HOME, view: 'orbit' }, recent: [] })
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  await act(async () => root.render(<OrbitView />))
})
afterEach(async () => {
  closeMenu()
  await act(async () => root.unmount())
  host.remove()
})

describe('a right-click in Orbit', () => {
  test('on a body opens its session’s menu, and selects nothing', async () => {
    const s = titled('Idempotent retries')
    expect(await rightClick($(`[data-body="${s.id}"] .orbit-b-hit`))).toBe(true)
    expect(opened()).toEqual({ kind: 'session', id: s.id })
    expect(routeStore.getState().route).toMatchObject({ view: 'orbit', session: null, pending: null })
  })

  test('on a moon opens the child’s, not its parent’s', async () => {
    const kid = titled('Tenant in every cache key')
    await rightClick($(`[data-moon="${kid.id}"]`))
    expect(opened()).toEqual({ kind: 'session', id: kid.id })
  })

  test('on what a body carries (its title, its line of what waits) opens that body’s', async () => {
    const s = titled('Order status history')
    await rightClick($(`[data-label="${s.id}"] .orbit-lab-title`))
    expect(opened()).toEqual({ kind: 'session', id: s.id })
    closeMenu()
    await rightClick($(`[data-label="${s.id}"] .orbit-lab-want`))
    expect(opened()).toEqual({ kind: 'session', id: s.id })
    // and opens no card: that is the left click's
    expect(routeStore.getState().route.pending).toBeNull()
  })

  test('on a project’s name on the rim opens the project’s menu', async () => {
    expect(await rightClick($('.orbit-chart [data-sector="harbor-cli"] text'))).toBe(true)
    expect(opened()).toEqual({ kind: 'project', name: 'harbor-cli' })
  })

  test('every project the scene names on the rim is a project of the world', () => {
    const names = [...host.querySelectorAll('.orbit-chart [data-sector]')].map((g) => g.getAttribute('data-menu'))
    expect(names.sort()).toEqual(world().projects.map((p) => `project:${p.name}`).sort())
  })
})

describe('`M` in Orbit', () => {
  test('is left to the frame: it does not start the finder, as another letter does', async () => {
    expect(await press('m')).toBe(false)
    expect(orbitStore.getState().find).toBeNull()
    expect(await press('M', { shiftKey: true })).toBe(false)
    expect(orbitStore.getState().find).toBeNull()
    expect(await press('b')).toBe(true)
    expect(orbitStore.getState().find).toBe('b')
  })
})

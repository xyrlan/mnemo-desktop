import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { closeMenu, menuStore } from '../menu'
import { runtimeStore } from '../runtime/current'
import { HOME, go, routeStore } from '../world/route'
import { sampleWorld } from '../world/sample'
import { worldStore } from '../world/store'
import type { Session } from '../world/types'
import { Stage } from './index'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// The runtime and the waiting card are other pieces: stand-ins, as in the stage's own tests.
const held = vi.hoisted(() => ({ live: new Set<string>(), hosted: [] as { id: string; kind: 'session'; label: string; cwd: string | null; sessionId: string | null; pty: number | null }[] }))
vi.mock('../runtime', () => ({
  useCanHost: (s: Session | null | undefined) => !!s && held.live.has(s.id),
  useHosted: () => held.hosted,
  LiveTerminal: ({ sessionId }: { sessionId: string }) => (
    <div className="xterm" data-fake-terminal={sessionId}>
      <textarea className="xterm-helper-textarea" />
    </div>
  ),
}))
vi.mock('../pending', async (original) => ({
  ...(await original<typeof import('../pending')>()),
  PendingCard: ({ pending }: { pending: { id: string } }) => <div data-fake-card={pending.id} />,
}))

let host: HTMLElement
let root: Root

const world = () => worldStore.getState().world
const titled = (start: string): Session => world().sessions.find((s) => s.title.startsWith(start))!
const opened = () => menuStore.getState().open?.target ?? null
const $ = (sel: string) => host.querySelector<HTMLElement>(sel)!

async function rightClick(el: Element): Promise<boolean> {
  const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 30, clientY: 40, button: 2 })
  await act(async () => void el.dispatchEvent(e))
  return e.defaultPrevented
}

async function mount(session: string) {
  await act(async () => {
    go({ ...HOME, view: 'console', session })
    root.render(<Stage />)
  })
}

beforeEach(() => {
  worldStore.setState({ world: sampleWorld(), ready: true })
  routeStore.setState({ route: HOME, recent: [] })
  held.live.clear()
  held.hosted = []
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
})
afterEach(async () => {
  closeMenu()
  await act(async () => root.unmount())
  host.remove()
  runtimeStore.setState({ runtime: null })
})

describe('a right-click on the stage', () => {
  test('on its head opens the menu of the session on stage', async () => {
    const s = titled('Idempotent retries')
    await mount(s.id)
    expect(await rightClick($('.stage-title'))).toBe(true)
    expect(opened()).toEqual({ kind: 'session', id: s.id })
  })

  test('on a family tab opens that member’s, and the stage stays where it is', async () => {
    const s = titled('Idempotent retries')
    const kid = titled('Tenant in every cache key')
    await mount(s.id)
    const chip = [...host.querySelectorAll<HTMLElement>('.stage-chip')].find((c) => c.textContent?.includes('Tenant in every cache key'))!
    await rightClick(chip)
    expect(opened()).toEqual({ kind: 'session', id: kid.id })
    expect(routeStore.getState().route.session).toBe(s.id)
  })

  test('on a child’s head, its parent’s name is the parent', async () => {
    const kid = titled('Tenant in every cache key')
    await mount(kid.id)
    await rightClick($('.stage-link'))
    expect(opened()).toEqual({ kind: 'session', id: titled('Idempotent retries').id })
    await rightClick($('.stage-title'))
    expect(opened()).toEqual({ kind: 'session', id: kid.id })
  })

  test('never over the live terminal: that right-click is the terminal’s, as it was', async () => {
    const s = titled('Idempotent retries')
    held.live.add(s.id)
    await mount(s.id)
    expect(await rightClick($('.stage-live .xterm-helper-textarea'))).toBe(false)
    expect(await rightClick($('.stage-live .xterm'))).toBe(false)
    expect(opened()).toBeNull()
    // its bar is not the terminal's area, and is nobody's drawing of the session either
    expect(await rightClick($('.stage-term-bar'))).toBe(false)
  })

  test('a terminal that is no session: its head opens the terminal’s menu', async () => {
    held.hosted = [{ id: 'tab-7', kind: 'session', label: '', cwd: '/Users/you/work/atlas-api', sessionId: null, pty: 7 }]
    runtimeStore.setState({ runtime: { canHost: () => false, Terminal: () => null, hosted: () => held.hosted, subscribe: () => () => {}, focus: () => false } })
    await mount('tab-7')
    expect(await rightClick($('[data-stage-terminal] .stage-title'))).toBe(true)
    expect(opened()).toEqual({ kind: 'terminal', id: 'tab-7' })
    closeMenu()
    expect(await rightClick($('.stage-live .xterm'))).toBe(false)
    expect(opened()).toBeNull()
  })
})

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { closeMenu, menuStore } from '../menu'
import { HOME, routeStore } from '../world/route'
import { sampleWorld } from '../world/sample'
import { worldStore } from '../world/store'
import type { Pending, Session } from '../world/types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// The terminals the app holds, as a test says: only a live world has a runtime to hold one.
const held = vi.hoisted(() => ({ hosted: [] as { id: string; kind: 'session'; label: string; cwd: string | null; sessionId: string | null; pty: number | null }[] }))
vi.mock('../runtime', () => ({ useHosted: () => held.hosted }))
vi.mock('../pending', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../pending')>()),
  PendingCard: ({ pending }: { pending: Pending }) => (
    <div data-test-card={pending.id}>
      <textarea aria-label="in your words" />
    </div>
  ),
}))

const { Roster, setGroup } = await import('./index')

let root: Root
let host: HTMLElement

const world = () => worldStore.getState().world
const titled = (text: string): Session => world().sessions.find((s) => s.title.startsWith(text))!
const opened = () => menuStore.getState().open?.target ?? null
const $ = (sel: string) => host.querySelector<HTMLElement>(sel)!

/** A right-click where a view would get it. True when the webview's own menu was held back. */
async function rightClick(el: Element): Promise<boolean> {
  const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 30, clientY: 40, button: 2 })
  await act(async () => void el.dispatchEvent(e))
  return e.defaultPrevented
}

beforeEach(async () => {
  worldStore.setState({ world: sampleWorld(), ready: true })
  routeStore.setState({ route: { ...HOME, view: 'console', session: titled('Idempotent retries').id }, recent: [] })
  setGroup('attention')
  held.hosted = []
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  await act(async () => root.render(<Roster />))
})
afterEach(async () => {
  closeMenu()
  await act(async () => root.unmount())
  host.remove()
})

describe('a right-click in the roster', () => {
  test('on an entry opens that session’s menu, and neither selects it nor moves the stage', async () => {
    const s = titled('Why is the bundle')
    const before = routeStore.getState().route
    expect(await rightClick($(`.roster-main[data-session="${s.id}"] .roster-title`))).toBe(true)
    expect(opened()).toEqual({ kind: 'session', id: s.id })
    expect(routeStore.getState().route).toEqual(before)
  })

  test('on a child inside its parent’s entry opens the child’s', async () => {
    const kid = titled('Tenant in every cache key')
    await rightClick($(`.roster-kid[data-session="${kid.id}"]`))
    expect(opened()).toEqual({ kind: 'session', id: kid.id })
  })

  test('on a waiting line opens the menu of the session it waits on', async () => {
    const kid = titled('Webhook signature check')
    const wait = [...host.querySelectorAll<HTMLElement>('[data-wait]')].find((el) => world().pending.find((p) => p.id === el.dataset.wait)?.session === kid.id)!
    await rightClick(wait)
    expect(opened()).toEqual({ kind: 'session', id: kid.id })
  })

  test('on an ended session folded to one line', async () => {
    const s = titled('Notes for the 2.5')
    await act(async () => worldStore.getState().set({ ...world(), sessions: world().sessions.map((x) => (x.id === s.id ? { ...x, state: 'ended', live: false, hosted: false } : x)) }))
    await rightClick($(`.roster-fold [data-session="${s.id}"]`))
    expect(opened()).toEqual({ kind: 'session', id: s.id })
  })

  test('on the map at its head, a body and a moon are their sessions', async () => {
    const parent = titled('Idempotent retries')
    const kid = titled('Tenant in every cache key')
    await rightClick($(`[data-map-body="${parent.id}"] .orbit-map-hit`))
    expect(opened()).toEqual({ kind: 'session', id: parent.id })
    await rightClick($(`[data-map-moon="${kid.id}"]`))
    expect(opened()).toEqual({ kind: 'session', id: kid.id })
  })

  test('on a band of attention, or between entries, nothing opens', async () => {
    expect(await rightClick($('.roster-band'))).toBe(false)
    expect(await rightClick($('.roster-head'))).toBe(false)
    expect(opened()).toBeNull()
  })
})

describe('a project’s name', () => {
  test('grouped by project, each group head opens its project’s menu', async () => {
    await act(async () => setGroup('project'))
    const heads = [...host.querySelectorAll<HTMLElement>('.roster-band')]
    expect(heads.map((h) => h.getAttribute('data-menu'))).toEqual(['project:atlas-api', 'project:lumen-web', 'project:harbor-cli', 'project:tessera'])
    expect(await rightClick(heads[1].querySelector('span:not(.roster-proj)')!)).toBe(true)
    expect(opened()).toEqual({ kind: 'project', name: 'lumen-web' })
  })

  test('sessions with no project stand under a head that is no project’s', async () => {
    const s = titled('Why is the bundle')
    await act(async () => {
      worldStore.getState().set({ ...world(), sessions: world().sessions.map((x) => (x.id === s.id ? { ...x, project: null } : x)) })
      setGroup('project')
    })
    const none = [...host.querySelectorAll<HTMLElement>('.roster-band')].find((h) => h.textContent?.includes('No project'))!
    expect(none.hasAttribute('data-menu')).toBe(false)
    expect(await rightClick(none)).toBe(false)
  })
})

describe('a terminal listed under Terminals', () => {
  test('opens the terminal’s own menu', async () => {
    held.hosted = [{ id: 'tab-7', kind: 'session', label: '', cwd: '/Users/you/work/atlas-api', sessionId: null, pty: 7 }]
    await act(async () => root.render(<Roster key="again" />))
    // the menu asks the runtime what is held; here the roster's own list stands in for it
    const { runtimeStore } = await import('../runtime/current')
    runtimeStore.setState({ runtime: { canHost: () => false, Terminal: () => null, hosted: () => held.hosted, subscribe: () => () => {}, focus: () => false } })
    expect(await rightClick($('[data-terminal="tab-7"] .roster-title'))).toBe(true)
    expect(opened()).toEqual({ kind: 'terminal', id: 'tab-7' })
    runtimeStore.setState({ runtime: null })
  })
})

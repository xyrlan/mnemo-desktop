// The stage's seam with the runtime (docs/superpowers/specs/2026-11-10-recreation-swap.md): a
// terminal that becomes available is on stage at once, a terminal that is no session stands
// there under a head that says what it is, and the Changes panel opens from the stage. The
// runtime module is the real one, with a runtime of the test's own set where the app's would be.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Hosted } from '../runtime'
import { runtimeStore, type Runtime } from '../runtime/current'
import { setActions, type Outcome } from '../world/actions'
import { HOME, go, routeStore } from '../world/route'
import { sampleActions, sampleWorld } from '../world/sample'
import { worldStore } from '../world/store'
import type { Session, World } from '../world/types'
import { Stage, focusTerminal } from './index'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../pending', async (original) => ({
  ...(await original<typeof import('../pending')>()),
  PendingCard: ({ pending }: { pending: { id: string } }) => <div data-fake-card={pending.id} />,
}))

const shell: Hosted = { id: 'tab-1', kind: 'session', label: 'shell', cwd: '/Users/you/work/atlas-api', sessionId: null, pty: 4 }
const started: Hosted = { id: 'tab-9', kind: 'captain', label: 'claude', cwd: '/Users/you/work/tessera', sessionId: 'not-in-the-world-yet', pty: 9 }

let host: HTMLElement
let root: Root
let world: World
let undo: () => void
let closed: string[]
let closing: (id: string) => Promise<Outcome>
let rt: ReturnType<typeof running>

/** A runtime that hosts what the test says it hosts, and tells who listens when that changes. */
function running() {
  let held: Hosted[] = []
  const can = new Set<string>()
  const listeners = new Set<() => void>()
  const tell = () => listeners.forEach((fn) => fn())
  const runtime: Runtime = {
    canHost: (s) => can.has(s.id),
    Terminal: ({ sessionId, active }) => <textarea data-fake-terminal={sessionId} data-active={String(active)} />,
    hosted: () => held,
    subscribe: (fn) => (listeners.add(fn), () => void listeners.delete(fn)),
    focus: () => false,
  }
  runtimeStore.setState({ runtime })
  return {
    hold: (next: Hosted[]) => ((held = next), tell()),
    host: (id: string) => (can.add(id), tell()),
    drop: (id: string) => (can.delete(id), tell()),
    listeners,
  }
}

const titled = (start: string): Session => world.sessions.find((s) => s.title.startsWith(start))!
const stage = () => host.querySelector<HTMLElement>('[data-stage]')!
const live = () => host.querySelector<HTMLElement>('[data-fake-terminal]')
const route = () => routeStore.getState().route
const button = (sel: string) => host.querySelector<HTMLButtonElement>(sel)!

function mount(session: string | null, more: Partial<typeof HOME> = {}) {
  act(() => {
    go({ ...HOME, view: 'console', session, ...more })
    root.render(<Stage />)
  })
}

beforeEach(() => {
  world = sampleWorld()
  worldStore.setState({ world, ready: true })
  closed = []
  closing = async (id) => (closed.push(id), { ok: true })
  const sample = sampleActions(() => worldStore.getState().world, worldStore.getState().set)
  undo = setActions({ ...sample, close: (id) => closing(id) })
  rt = running()
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  undo()
  runtimeStore.setState({ runtime: null })
})

describe('a session’s terminal, heard', () => {
  test('one that becomes available is on stage at once, with no change of the world', () => {
    const s = titled('Order status history')
    mount(s.id)
    expect(live()).toBeNull()
    expect(host.querySelector('[aria-label="Transcript"]')).not.toBeNull()
    const before = worldStore.getState().world
    // the attach took, or `open` resumed it: the runtime says so, the world says nothing
    act(() => rt.host(s.id))
    expect(worldStore.getState().world).toBe(before)
    expect(live()!.dataset.fakeTerminal).toBe(s.id)
    expect(host.querySelector('[aria-label="Transcript"]')).toBeNull()
  })

  test('one that goes gives the stage back to the transcript', () => {
    const s = titled('Order status history')
    rt.host(s.id)
    mount(s.id)
    expect(live()).not.toBeNull()
    act(() => rt.drop(s.id))
    expect(live()).toBeNull()
    expect(host.querySelector('[data-stage-reply]')).not.toBeNull()
  })

})

describe('a terminal that is not a session', () => {
  test('stands on stage as a terminal, under a head that says what it is', () => {
    rt.hold([shell])
    mount(shell.id)
    expect(stage().dataset.terminal).toBe('tab-1')
    expect(live()!.dataset.fakeTerminal).toBe('tab-1')
    const head = host.querySelector('[data-stage-terminal]')!
    expect(head.querySelector('.stage-project')!.textContent).toBe('terminal')
    expect(head.querySelector('.stage-of')!.textContent).toBe('shell')
    expect(head.querySelector('h1')!.textContent).toBe('shell')
    expect(head.querySelector('[data-fact="cwd"]')!.textContent).toBe('~/work/atlas-api')
    expect(head.querySelector('[data-fact="what"]')!.textContent).toBe('A terminal the app holds, not a session: the fleet reads nothing of it but what it prints.')
    // it has no family, no transcript and nothing that waits: only what it prints
    expect(host.querySelector('.stage-family')).toBeNull()
    expect(host.querySelector('.stage-now')).toBeNull()
    expect(host.querySelector('[data-stage-reply]')).toBeNull()
    expect(host.querySelector('[data-stage-changes]')).toBeNull()
  })

  test('a session the app started and the world does not list yet says that instead', () => {
    rt.hold([started])
    mount(started.id)
    expect(host.querySelector('.stage-of')!.textContent).toBe('session, not listed yet')
    expect(host.querySelector('[data-fact="what"]')!.textContent).toMatch(/^A session the app started\. The fleet does not list it yet/)
  })

  test('it takes the keys on Console only, and Enter reaches it', () => {
    rt.hold([shell])
    mount(shell.id, { view: 'score' })
    expect(live()!.dataset.active).toBe('false')
    act(() => go({ view: 'console' }))
    expect(live()!.dataset.active).toBe('true')
    expect(focusTerminal()).toBe(true)
    expect(document.activeElement).toBe(live())
  })

  test('it opens there the moment the app holds it, and the stage is empty again when it lets go', () => {
    mount(shell.id)
    expect(host.querySelector('.stage-none')).not.toBeNull()
    act(() => rt.hold([shell]))
    expect(live()).not.toBeNull()
    act(() => rt.hold([]))
    expect(live()).toBeNull()
    expect(host.querySelector('.stage-none')).not.toBeNull()
  })

  test('ending it is asked first, then goes through actions().close', async () => {
    rt.hold([shell])
    mount(shell.id)
    const end = () => button('[data-stage-end]')
    expect(end().textContent).toBe('end it')
    await act(async () => end().click())
    expect(closed).toEqual([])
    expect(end().textContent).toBe('end it, and what runs in it?')
    await act(async () => end().click())
    expect(closed).toEqual(['tab-1'])
  })

  test('looking away takes the question back', async () => {
    rt.hold([shell])
    mount(shell.id)
    await act(async () => button('[data-stage-end]').click())
    await act(async () => {
      button('[data-stage-end]').focus()
      button('[data-stage-end]').blur()
    })
    expect(button('[data-stage-end]').dataset.stageEnd).toBe('idle')
    expect(closed).toEqual([])
  })

  test('a close that is refused, or throws, is said beside it, in its own words', async () => {
    rt.hold([shell])
    mount(shell.id)
    closing = async () => ({ ok: false, why: 'It does not run in the app: there is nothing to close here.' })
    await act(async () => button('[data-stage-end]').click())
    await act(async () => button('[data-stage-end]').click())
    expect(host.querySelector('.stage-term-note')!.textContent).toBe('not ended: It does not run in the app: there is nothing to close here.')
    closing = async () => {
      throw new Error('the terminal is gone')
    }
    await act(async () => button('[data-stage-end]').click())
    await act(async () => button('[data-stage-end]').click())
    expect(host.querySelector('.stage-term-note')!.textContent).toBe('not ended: the terminal is gone')
  })
})

describe('the Changes panel, from the stage', () => {
  test('opens for the session on stage, and closes again', () => {
    const s = titled('Order status history')
    mount(s.id)
    const changes = () => button('[data-stage-changes]')
    expect(changes().getAttribute('aria-pressed')).toBe('false')
    act(() => changes().click())
    expect(route()).toMatchObject({ panel: 'changes', session: s.id, view: 'console' })
    expect(changes().getAttribute('aria-pressed')).toBe('true')
    act(() => changes().click())
    expect(route().panel).toBeNull()
  })

  test('is there over a live terminal too', () => {
    const s = titled('Order status history')
    rt.host(s.id)
    mount(s.id)
    expect(live()).not.toBeNull()
    act(() => button('[data-stage-changes]').click())
    expect(route().panel).toBe('changes')
  })

  test('another panel open is replaced by it, and the command line closes', () => {
    mount(titled('Order status history').id, { panel: 'memory', command: true })
    act(() => button('[data-stage-changes]').click())
    expect(route()).toMatchObject({ panel: 'changes', command: false })
  })

  test('a session with no folder has no changes to read, and no button', () => {
    const s = titled('Order status history')
    worldStore.setState({ world: { ...world, sessions: world.sessions.map((x) => (x.id === s.id ? { ...x, cwd: null } : x)) } })
    mount(s.id)
    expect(host.querySelector('[data-stage-changes]')).toBeNull()
  })
})

// The terminals the app holds that are no session, in the roster: listed after the sessions,
// one line each, staged with a click. The runtime module is the real one, with a runtime of the
// test's own set where the app's would be.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Hosted } from '../runtime'
import { runtimeStore, type Runtime } from '../runtime/current'
import { HOME, routeStore } from '../world/route'
import { sampleWorld } from '../world/sample'
import { roots, rosterOrder, worldStore } from '../world/store'
import type { World } from '../world/types'
import { plainTerminals, terminalName, terminalOf, terminalWord } from './terminals'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../orbit', () => ({
  OrbitMap: ({ focus }: { focus: string | null }) => (
    <div data-test-map={focus ?? ''}>
      <span>where it stands</span>
    </div>
  ),
}))

const { Roster, rosterShown } = await import('./index')

const world: World = sampleWorld()
const order = rosterOrder(world)
const shell: Hosted = { id: 'tab-1', kind: 'session', label: 'shell', cwd: '/Users/you/work/atlas-api', sessionId: null, pty: 4 }
const command: Hosted = { id: 'tab-2', kind: 'session', label: 'dev server', cwd: '/Users/you/work/lumen-web', sessionId: null, pty: 5 }
/** One of the app's terminals running a session the world lists. */
const ofSession: Hosted = { id: 'tab-3', kind: 'captain', label: order[0].title, cwd: order[0].cwd, sessionId: order[0].id, pty: 6 }
/** A session the app started a moment ago: the world has not heard of it yet. */
const started: Hosted = { id: 'tab-4', kind: 'captain', label: '', cwd: '/Users/you/work/tessera', sessionId: 'a-session-the-world-does-not-list', pty: 8 }

/** A runtime that holds what the test says it holds, and tells who listens when that changes. */
function holding(first: Hosted[]) {
  let held = first
  const listeners = new Set<() => void>()
  const runtime: Runtime = {
    canHost: () => false,
    Terminal: () => null,
    hosted: () => held,
    subscribe: (fn) => (listeners.add(fn), () => void listeners.delete(fn)),
    focus: () => false,
  }
  runtimeStore.setState({ runtime })
  return (next: Hosted[]) => {
    held = next
    listeners.forEach((fn) => fn())
  }
}

describe('which held terminals are no session', () => {
  test('a shell and a command are; a terminal running a session the world lists is not', () => {
    expect(plainTerminals(world, [shell, ofSession, command]).map((h) => h.id)).toEqual(['tab-1', 'tab-2'])
  })

  test('a hosted entry that is itself a session of the world is not one either', () => {
    expect(plainTerminals(world, [{ ...shell, id: order[1].id }])).toEqual([])
  })

  test('a session the world does not list yet is held, so it has a place until it does', () => {
    expect(plainTerminals(world, [started]).map((h) => h.id)).toEqual(['tab-4'])
    const listed = { ...world, sessions: [...world.sessions, { ...order[0], id: started.sessionId!, short: started.sessionId!.slice(0, 8) }] }
    expect(plainTerminals(listed, [started])).toEqual([])
  })

  test('a terminal is found by its id, and only when it is one of those', () => {
    expect(terminalOf(world, [shell, ofSession], 'tab-1')).toBe(shell)
    expect(terminalOf(world, [shell, ofSession], 'tab-3')).toBeUndefined()
    expect(terminalOf(world, [shell], order[0].id)).toBeUndefined()
    expect(terminalOf(world, [shell], null)).toBeUndefined()
  })

  test('what it is called: its label, else its folder, else what it is', () => {
    expect(terminalName(command)).toBe('dev server')
    expect(terminalName({ ...shell, label: '  ' })).toBe('atlas-api')
    expect(terminalName({ ...shell, label: '', cwd: 'C:\\Users\\you\\work\\lumen-web\\' })).toBe('lumen-web')
    expect(terminalName({ ...shell, label: '', cwd: null })).toBe('shell')
    expect(terminalWord(shell)).toBe('shell')
    expect(terminalWord(started)).toBe('session, not listed yet')
  })
})

describe('the roster', () => {
  let root: Root
  let host: HTMLElement
  let hold: (next: Hosted[]) => void

  const entries = () => [...host.querySelectorAll<HTMLElement>('[data-session]')].map((el) => el.dataset.session!)
  const terminal = (id: string) => host.querySelector<HTMLElement>(`[data-terminal="${id}"] [data-session]`)!

  beforeEach(async () => {
    worldStore.setState({ world, ready: true })
    routeStore.setState({ route: { ...HOME, view: 'console', session: order[0].id }, recent: [] })
    hold = holding([shell, ofSession, command])
    host = document.body.appendChild(document.createElement('div'))
    root = createRoot(host)
    await act(async () => root.render(<Roster />))
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    runtimeStore.setState({ runtime: null })
  })

  test('lists them after the sessions, in the order they were opened, under a band that counts them', () => {
    const listed = entries()
    expect(listed.slice(-2)).toEqual(['tab-1', 'tab-2'])
    expect(listed.slice(0, -2).every((id) => order.some((s) => s.id === id))).toBe(true)
    const band = host.querySelector('.roster-band[data-band="terminals"]')!
    expect(band.querySelector('span')!.textContent).toBe('Terminals')
    expect(band.querySelector('b')!.textContent).toBe('2')
    // the sessions' own count is the sessions'
    expect(host.querySelector('.roster-head b')!.textContent).toBe(String(roots(world).length))
  })

  test('each says its name, what it is and where it runs', () => {
    expect(terminal('tab-2').querySelector('.roster-title')!.textContent).toBe('dev server')
    expect(terminal('tab-1').querySelector('.roster-term-word')!.textContent).toBe('shell')
    expect(terminal('tab-1').querySelector('.roster-term-cwd')!.textContent).toBe('~/work/atlas-api')
  })

  test('a click puts it on Console’s stage, and it is the entry lit', async () => {
    routeStore.getState().go({ view: 'orbit' })
    await act(async () => terminal('tab-2').click())
    expect(routeStore.getState().route).toMatchObject({ view: 'console', session: 'tab-2' })
    expect(terminal('tab-2').getAttribute('aria-current')).toBe('true')
    expect(host.querySelectorAll('[data-sel]').length).toBe(1)
  })

  test('one that opens, or goes, is listed or gone at once, with no change of the world', async () => {
    await act(async () => hold([shell]))
    expect(entries().slice(-1)).toEqual(['tab-1'])
    expect(host.querySelector('[data-terminal="tab-2"]')).toBeNull()
    await act(async () => hold([]))
    expect(host.querySelector('.roster-band[data-band="terminals"]')).toBeNull()
    await act(async () => hold([command]))
    expect(entries().slice(-1)).toEqual(['tab-2'])
  })

  test('the order the keys walk is still the sessions’: the frame adds the terminals after it', () => {
    expect(rosterShown().map((s) => s.id)).toEqual(order.map((s) => s.id))
  })

  test('“where it stands” is said once: by the map, not by the roster over it', () => {
    const said = [...host.querySelectorAll('.roster-map *')].filter((el) => el.children.length === 0 && /where it stands/i.test(el.textContent ?? ''))
    expect(said.length).toBe(1)
    expect(said[0].closest('[data-test-map]')).not.toBeNull()
  })
})

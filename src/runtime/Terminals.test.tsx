import { StrictMode, useEffect, useState } from 'react'
import { createStore } from 'zustand/vanilla'
import type { DrawerTab } from '../nexus/store'
import type { PaneViewProps } from '../panes/registry'
import type { HostedSession } from '../session/host'
import type { TerminalView } from './hosting'
import { createTerminals } from './Terminals'
import { act, byLabel, byText, cleanup, render } from './testing-dom'

const tab = (id: string, pane: number): DrawerTab => ({ id, kind: 'captain', key: `pane:${pane}`, readOnly: null, label: id, sessionId: id, cwd: null })
const held = (pane: number): HostedSession => ({ key: `pane:${pane}`, kind: 'pane', pty: pane, by: ['nexus-drawer'] })

/** A terminal view that says when it mounts and unmounts, and what it was told. */
function bench() {
  const life: string[] = []
  function FakeTerminal({ id, props }: PaneViewProps) {
    useEffect(() => {
      life.push(`mount ${id}`)
      return () => void life.push(`unmount ${id}`)
    }, [id])
    return (
      <div data-fake-terminal={id} data-view-active={String(props.active)} data-view-name={String(props.name)} className="xterm">
        <textarea aria-label={`terminal ${id}`} />
      </div>
    )
  }
  const nexus = createStore<{ tabs: DrawerTab[] }>(() => ({ tabs: [] }))
  const host = createStore<{ sessions: Record<string, HostedSession> }>(() => ({ sessions: {} }))
  const views = new Map<string, TerminalView>()
  const listeners = new Set<() => void>()
  const opened: string[] = []
  const closed: string[] = []
  let terminals!: ReturnType<typeof createTerminals>
  act(() => {
    terminals = createTerminals({
      hosting: {
        view: (id) => views.get(id) ?? { state: 'none' },
        subscribe: (fn) => (listeners.add(fn), () => void listeners.delete(fn)),
        open: async (id) => (opened.push(id), { ok: true }),
      },
      nexus,
      host,
      terminal: FakeTerminal,
      close: (id) => void closed.push(id),
    })
  })
  benches.push(terminals)
  return {
    ...terminals,
    life,
    opened,
    nexus,
    /** The app holds terminal `pane` for session `id`. */
    hold(id: string, pane: number) {
      act(() => {
        nexus.setState((s) => ({ tabs: [...s.tabs, tab(id, pane)] }))
        host.setState((s) => ({ sessions: { ...s.sessions, [`pane:${pane}`]: held(pane) } }))
        views.set(id, { state: 'held', tab: id, key: `pane:${pane}`, pty: pane, error: null })
        listeners.forEach((fn) => fn())
      })
    },
    drop(id: string) {
      act(() => {
        nexus.setState((s) => ({ tabs: s.tabs.filter((t) => t.id !== id) }))
        views.delete(id)
        listeners.forEach((fn) => fn())
      })
    },
    say(id: string, view: TerminalView) {
      act(() => {
        views.set(id, view)
        listeners.forEach((fn) => fn())
      })
    },
  }
}

const benches: { dispose(): void }[] = []
const terminal = (pane: number) => document.querySelector<HTMLElement>(`[data-fake-terminal="${pane}"]`)
const onStage = (pane: number) => terminal(pane)?.closest('[data-live-terminal]')?.getAttribute('data-live-terminal') ?? null
const parked = (pane: number) => !!terminal(pane)?.closest('[data-runtime-park]')

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cleanup()
  for (const b of benches.splice(0)) b.dispose()
  act(() => vi.runAllTimers())
  vi.useRealTimers()
})

test('a held terminal has a view from the moment it is held, hidden until the stage shows it', () => {
  const b = bench()
  b.hold('alpha', 1)
  expect(b.life).toEqual(['mount 1'])
  expect(parked(1)).toBe(true)
  expect(terminal(1)?.closest<HTMLElement>('[data-runtime-park]')?.style.display).toBe('none')
  expect(terminal(1)?.dataset.viewActive).toBe('false')
  expect(b.drawn()).toBeNull()
})

test("the stage moves the view into its box and gives it back, never drawing it again: not under the app's StrictMode either", () => {
  const b = bench()
  function Stage() {
    const [id, setId] = useState<string | null>('alpha')
    return (
      <>
        <button onClick={() => setId('beta')}>beta</button>
        <button onClick={() => setId(null)}>none</button>
        {id && <b.LiveTerminal sessionId={id} active />}
      </>
    )
  }
  render(
    <StrictMode>
      <Stage />
    </StrictMode>,
  )
  b.hold('alpha', 1)
  b.hold('beta', 2)
  expect(onStage(1)).toBe('alpha')
  expect(terminal(1)?.dataset.viewActive).toBe('true')
  expect(b.drawn()).toBe('pane:1')
  expect(parked(2)).toBe(true)

  act(() => byText('beta').click())
  expect(onStage(2)).toBe('beta')
  expect(parked(1)).toBe(true)
  expect(terminal(1)?.dataset.viewActive).toBe('false')
  expect(terminal(2)?.dataset.viewActive).toBe('true')
  expect(b.drawn()).toBe('pane:2')

  act(() => byText('none').click())
  expect(parked(1) && parked(2)).toBe(true)
  expect(b.drawn()).toBeNull()
  // Each was mounted once, and neither was unmounted by the stage changing.
  expect(b.life).toEqual(['mount 1', 'mount 2'])
})

test('a tab renamed when its session is learnt keeps the view it had', () => {
  const b = bench()
  render(<b.LiveTerminal sessionId="alpha" active />)
  b.hold('session:1', 1)
  b.say('alpha', { state: 'held', tab: 'session:1', key: 'pane:1', pty: 1, error: null })
  expect(onStage(1)).toBe('alpha')
  act(() => b.nexus.setState({ tabs: [tab('alpha', 1)] }))
  b.say('alpha', { state: 'held', tab: 'alpha', key: 'pane:1', pty: 1, error: null })
  expect(onStage(1)).toBe('alpha')
  expect(b.life).toEqual(['mount 1'])
})

test('a terminal let go of is unmounted, and the stage says what there is instead', () => {
  const b = bench()
  render(<b.LiveTerminal sessionId="alpha" active />)
  b.hold('alpha', 1)
  b.drop('alpha')
  expect(b.life).toEqual(['mount 1', 'unmount 1'])
  expect(terminal(1)).toBeNull()

  b.say('alpha', { state: 'waiting' })
  expect(byText('Attaching…')).toBeTruthy()
  b.say('alpha', { state: 'held', tab: 'alpha', key: 'child:alpha', pty: null, error: 'no pty' })
  expect(byText('no pty')).toBeTruthy()
  b.say('alpha', { state: 'detached' })
  act(() => byText('Show it').click())
  expect(b.opened).toEqual(['alpha'])
})

test('the terminal on stage takes the keys when it is active, and not from a field being typed in', () => {
  const b = bench()
  const frame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => (cb(0), 0))
  const stage = (active: boolean) => (
    <>
      <input aria-label="command line" />
      <b.LiveTerminal sessionId="alpha" active={active} />
    </>
  )
  const { rerender } = render(stage(false))
  b.hold('alpha', 1)
  expect(document.activeElement).toBe(document.body)
  rerender(stage(true))
  expect(document.activeElement).toBe(byLabel('terminal 1'))

  rerender(stage(false))
  byLabel('command line').focus()
  rerender(stage(true))
  expect(document.activeElement).toBe(byLabel('command line'))
  // Asked for, it takes them from anywhere.
  expect(b.focus()).toBe(true)
  expect(document.activeElement).toBe(byLabel('terminal 1'))
  frame.mockRestore()
})

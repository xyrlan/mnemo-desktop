import { useEffect, useState } from 'react'
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
      <div data-fake-terminal={id} data-view-active={String(props.active)} className="xterm">
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
  const terminals = createTerminals({
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
  return {
    ...terminals,
    life,
    opened,
    /** The app holds terminal `pane` for session `id`. */
    hold(id: string, pane: number) {
      act(() => {
        nexus.setState((s) => ({ tabs: [...s.tabs, tab(id, pane)] }))
        host.setState((s) => ({ sessions: { ...s.sessions, [`pane:${pane}`]: held(pane) } }))
        views.set(id, { state: 'held', tab: id, pty: pane, error: null })
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

const terminal = (pane: number) => document.querySelector<HTMLElement>(`[data-fake-terminal="${pane}"]`)
const onStage = (pane: number) => terminal(pane)?.closest('[data-live-terminal]')?.getAttribute('data-live-terminal') ?? null
const parked = (pane: number) => terminal(pane)?.closest('[data-runtime-park]') !== null

afterEach(cleanup)

test('a held terminal has a view from the moment it is held, hidden until the stage shows it', () => {
  const b = bench()
  render(<b.Pool />)
  b.hold('alpha', 1)
  expect(b.life).toEqual(['mount 1'])
  expect(parked(1)).toBe(true)
  expect(terminal(1)?.closest<HTMLElement>('[data-runtime-park]')?.style.display).toBe('none')
  expect(terminal(1)?.dataset.viewActive).toBe('false')
  b.dispose()
})

test('the stage moves the view into its box and gives it back, never drawing it again', () => {
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
    <>
      <b.Pool />
      <Stage />
    </>,
  )
  b.hold('alpha', 1)
  b.hold('beta', 2)
  expect(onStage(1)).toBe('alpha')
  expect(terminal(1)?.dataset.viewActive).toBe('true')
  expect(parked(2)).toBe(true)

  act(() => byText('beta').click())
  expect(onStage(2)).toBe('beta')
  expect(parked(1)).toBe(true)
  expect(terminal(1)?.dataset.viewActive).toBe('false')
  expect(terminal(2)?.dataset.viewActive).toBe('true')

  act(() => byText('none').click())
  expect(parked(1) && parked(2)).toBe(true)
  // Each was mounted once, and neither was unmounted by the stage changing.
  expect(b.life).toEqual(['mount 1', 'mount 2'])
  b.dispose()
})

test('a terminal let go of is unmounted, and the stage says what there is instead', () => {
  const b = bench()
  render(
    <>
      <b.Pool />
      <b.LiveTerminal sessionId="alpha" active />
    </>,
  )
  b.hold('alpha', 1)
  b.drop('alpha')
  expect(b.life).toEqual(['mount 1', 'unmount 1'])
  expect(terminal(1)).toBeNull()

  b.say('alpha', { state: 'waiting' })
  expect(byText('Attaching…')).toBeTruthy()
  b.say('alpha', { state: 'held', tab: 'alpha', pty: null, error: 'no pty' })
  expect(byText('no pty')).toBeTruthy()
  b.say('alpha', { state: 'detached' })
  act(() => byText('Show it').click())
  expect(b.opened).toEqual(['alpha'])
  b.dispose()
})

test('the terminal on stage takes the keys when it is active, and not from a field being typed in', async () => {
  const b = bench()
  const frame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => (cb(0), 0))
  const { rerender } = render(
    <>
      <b.Pool />
      <input aria-label="command line" />
      <b.LiveTerminal sessionId="alpha" active={false} />
    </>,
  )
  b.hold('alpha', 1)
  expect(document.activeElement).toBe(document.body)
  const again = (active: boolean) =>
    rerender(
      <>
        <b.Pool />
        <input aria-label="command line" />
        <b.LiveTerminal sessionId="alpha" active={active} />
      </>,
    )
  again(true)
  expect(document.activeElement).toBe(byLabel('terminal 1'))

  again(false)
  byLabel('command line').focus()
  again(true)
  expect(document.activeElement).toBe(byLabel('command line'))
  // Asked for, it takes them from anywhere.
  expect(b.focus()).toBe(true)
  expect(document.activeElement).toBe(byLabel('terminal 1'))
  frame.mockRestore()
  b.dispose()
})

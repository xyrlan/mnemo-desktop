import { act, Profiler } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { shortcutLabel } from '../../actions/chords'
import type { ParentRef } from '../parent'
import { addLine, createJarvisStore, foldParent, type JarvisStore } from '../store'
import { JamesPresence } from './index'
import { alive, hostPresence, jamesStore, presenceHosts, presenceOf, type PresenceState } from './james'
import { Presence } from './Presence'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ref = (sessionId: string, project: string): ParentRef => ({ sessionId, project, root: `/Users/you/code/${project}`, request: 'corrige o login', host: 'claude', startedAt: 0 })

describe('what the presence says of James', () => {
  let store: JarvisStore
  beforeEach(() => void (store = createJarvisStore()))
  const state = () => presenceOf(store.getState()).state

  test('nothing going on, he is at rest', () => {
    expect(presenceOf(store.getState())).toEqual({ state: 'rest', approvals: 0 })
  })

  test.each([
    ['listening', 'listening'],
    ['transcribing', 'thinking'],
    ['speaking', 'speaking'],
    ['waiting', 'waiting'],
  ] as const)('the voice %s is James %s', (voice, expected) => {
    store.setState({ voice })
    expect(state()).toBe(expected)
  })

  test('a request being worked on is James thinking, but the voice says more while it is on', () => {
    store.setState({ busy: true })
    expect(state()).toBe('thinking')
    store.setState({ voice: 'speaking' })
    expect(state()).toBe('speaking')
  })

  test('a failure shows until something is said after it, and never over what he is doing', () => {
    addLine(store, { who: 'james', text: 'Pronto.' })
    expect(state()).toBe('rest')
    addLine(store, { who: 'note', text: 'Voz: sem microfone', error: true })
    expect(state()).toBe('error')
    store.setState({ busy: true })
    expect(state()).toBe('thinking')
    store.setState({ busy: false, voice: 'listening' })
    expect(state()).toBe('listening')
    store.setState({ voice: 'idle' })
    expect(state()).toBe('error')
    addLine(store, { who: 'you', text: 'de novo', spoken: false })
    expect(state()).toBe('rest')
  })

  test('a note that is no failure is not one', () => {
    addLine(store, { who: 'note', text: 'Mãos livres ligado: diga «James».' })
    expect(state()).toBe('rest')
  })

  test('it counts the parents that wait on an approval, and no other parent', () => {
    let parents = foldParent([], { kind: 'opened', parent: ref('a', 'mnemo-desktop') })
    parents = foldParent(parents, { kind: 'approval', parent: ref('b', 'tasklist'), question: 'Push?' })
    parents = foldParent(parents, { kind: 'asking', parent: ref('c', 'atlas'), question: 'Qual branch?' })
    parents = foldParent(parents, { kind: 'approval', parent: ref('d', 'lumen'), question: 'Rodar?' })
    store.setState({ parents, voice: 'speaking' })
    expect(presenceOf(store.getState())).toEqual({ state: 'speaking', approvals: 2 })
  })

  test('his orb is alive while he listens, thinks or speaks, and only then', () => {
    const states: PresenceState[] = ['rest', 'listening', 'thinking', 'speaking', 'waiting', 'error']
    expect(states.filter(alive)).toEqual(['listening', 'thinking', 'speaking'])
  })
})

describe('the presence', () => {
  let host: HTMLElement
  let root: Root
  let store: JarvisStore

  beforeEach(() => {
    host = document.body.appendChild(document.createElement('div'))
    root = createRoot(host)
    store = createJarvisStore()
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    jamesStore.setState(createJarvisStore().getState())
  })

  const draw = (shortcut?: string) => act(() => root.render(<Presence store={store} shortcut={shortcut} />))
  const button = () => host.querySelector<HTMLButtonElement>('button')!
  const word = () => host.querySelector('.jv-presence-word')?.textContent ?? null

  test('a click opens the panel, and another closes it', () => {
    draw()
    expect(button().getAttribute('aria-expanded')).toBe('false')
    act(() => button().click())
    expect(store.getState().open).toBe(true)
    expect(button().getAttribute('aria-expanded')).toBe('true')
    act(() => button().click())
    expect(store.getState().open).toBe(false)
  })

  test('at rest it is his name alone; then the word for what he is doing', () => {
    draw()
    expect(button().textContent).toBe('James')
    expect(button().getAttribute('aria-label')).toBe('James')
    expect(word()).toBeNull()
    expect(button().hasAttribute('data-alive')).toBe(false)

    act(() => store.setState({ voice: 'listening' }))
    expect(word()).toBe('listening')
    expect(button().dataset.james).toBe('listening')
    expect(button().hasAttribute('data-alive')).toBe(true)
    expect(button().getAttribute('aria-label')).toBe('James: James is listening')

    act(() => store.setState({ voice: 'idle', busy: true }))
    expect(word()).toBe('thinking')

    act(() => store.setState({ voice: 'speaking', busy: false }))
    expect(word()).toBe('speaking')

    // He answered and still listens for more: said, and the orb holds still.
    act(() => store.setState({ voice: 'waiting' }))
    expect(word()).toBe('go on')
    expect(button().hasAttribute('data-alive')).toBe(false)
    expect(button().getAttribute('aria-label')).toBe('James: James is listening for more')
  })

  test('a failure is said, in the word and to a screen reader', () => {
    addLine(store, { who: 'note', text: 'Voz: sem microfone', error: true })
    draw()
    expect(word()).toBe('failed')
    expect(button().dataset.james).toBe('error')
    expect(button().getAttribute('aria-label')).toBe('James: James is stopped by a failure')
  })

  test('the approvals waiting are counted beside what he is doing', () => {
    let parents = foldParent([], { kind: 'approval', parent: ref('a', 'tasklist'), question: 'Push?' })
    parents = foldParent(parents, { kind: 'approval', parent: ref('b', 'atlas'), question: 'Rodar?' })
    store.setState({ parents, voice: 'speaking' })
    draw()
    expect(host.querySelector('.jv-presence-need')!.textContent).toBe('2')
    expect(button().getAttribute('aria-label')).toBe('James: James is speaking, 2 approvals wait')

    act(() => store.setState({ parents: [] }))
    expect(host.querySelector('.jv-presence-need')).toBeNull()
  })

  test('his chord is shown as a key, when he has one', () => {
    draw('Ctrl+Shift+J')
    expect(host.querySelector('kbd')!.textContent).toBe('Ctrl+Shift+J')
    expect(button().title).toBe('James (Ctrl+Shift+J)')
    draw()
    expect(host.querySelector('kbd')).toBeNull()
    expect(button().title).toBe('James')
  })

  test('a line added to the conversation draws nothing again', () => {
    let draws = 0
    act(() =>
      root.render(
        <Profiler id="presence" onRender={() => void draws++}>
          <Presence store={store} />
        </Profiler>,
      ),
    )
    expect(draws).toBe(1)
    act(() => addLine(store, { who: 'james', text: 'Pronto.' }))
    act(() => addLine(store, { who: 'you', text: 'obrigado', spoken: true }))
    expect(draws).toBe(1)
    // What he is doing changing is drawn.
    act(() => store.setState({ voice: 'listening' }))
    expect(draws).toBe(2)
  })
})

describe("JamesPresence, the top bar's", () => {
  let host: HTMLElement
  let root: Root

  beforeEach(() => {
    host = document.body.appendChild(document.createElement('div'))
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    jamesStore.setState(createJarvisStore().getState())
  })

  test("takes no props: it is the app's one James, with his chord, and a click opens his panel", () => {
    act(() => root.render(<JamesPresence />))
    const button = host.querySelector('button')!
    expect(host.querySelector('kbd')!.textContent).toBe(shortcutLabel('jarvis.toggle'))
    act(() => button.click())
    expect(jamesStore.getState().open).toBe(true)
    // The chord's action flips the same store (`src/jarvis/view.tsx`): the presence follows it.
    act(() => jamesStore.setState((s) => ({ open: !s.open })))
    expect(button.getAttribute('aria-expanded')).toBe('false')

    act(() => jamesStore.setState({ voice: 'speaking' }))
    expect(host.querySelector('.jv-presence-word')!.textContent).toBe('speaking')
  })

  test('counts itself in while it is on screen, and out when it goes', () => {
    expect(presenceHosts.getState().hosts).toBe(0)
    act(() => root.render(<JamesPresence />))
    expect(presenceHosts.getState().hosts).toBe(1)
    act(() => root.render(<></>))
    expect(presenceHosts.getState().hosts).toBe(0)
  })

  test('a presence counted out twice is counted out once', () => {
    const out = hostPresence()
    const other = hostPresence()
    out()
    out()
    expect(presenceHosts.getState().hosts).toBe(1)
    other()
    expect(presenceHosts.getState().hosts).toBe(0)
  })
})

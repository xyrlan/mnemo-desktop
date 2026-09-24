import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { makeDesignMode, type DesignMode } from './design'
import { DesignCard } from './DesignCard'
import type { AgentTarget } from './grab-agent'
import { ARM_SCRIPT, TAKE_SCRIPT } from './grab-guest'

// The live wiring (Tauri, the fleet) is swapped for a Design Mode driven by a fake page, so the
// toggle and strip run against a real zustand store (#212: a selector building a new object
// each read re-renders forever, and only a live store shows it).
const live = vi.hoisted(() => ({ design: null as unknown as DesignMode, target: null as unknown as { current: AgentTarget } }))
vi.mock('./design-live', () => ({
  get design() {
    return live.design
  },
  useAgentTarget: () => live.target.current,
}))
const { DesignStrip, DesignToggle, designPane } = await import('./design-view')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ID = -2
const PICKED = JSON.stringify({
  picked: {
    page: { sanitizedUrl: 'http://localhost:3000/', viewportWidth: 1000 },
    target: { tagName: 'button', selector: 'button#save', accessibility: { accessibleName: 'Save' }, rectViewport: { x: 0, y: 0, width: 80, height: 32 } },
  },
})

let host: HTMLDivElement
let root: Root
let takes: string[]
let sent: Array<{ text: string; shot: string | null }>
let copied: string[]
/** Polls come at once; the "Sent to …" notice keeps its time. */
const fast = { set: (f: () => void, ms: number) => setTimeout(f, ms >= 1000 ? ms : 1), clear: (t: unknown) => clearTimeout(t as ReturnType<typeof setTimeout>) }

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  takes = []
  sent = []
  copied = []
  live.target = { current: { kind: 'pane', pane: 7, title: 'fix the header' } }
  live.design = makeDesignMode({
    evaluate: async (_id, s) => (s === TAKE_SCRIPT ? (takes.shift() ?? '{"armed":true}') : s === ARM_SCRIPT ? 'true' : 'true'),
    snapshot: async () => ({ mime: 'image/png', data: 'AAAA' }),
    crop: async () => 'CROP',
    save: async () => '/tmp/shot.png',
    target: () => live.target.current,
    deliver: async (t, text, shot) => {
      if (t.kind === 'none') throw new Error(t.reason)
      sent.push({ text, shot })
    },
    timers: fast,
    repaintMs: 0,
  })
})

afterEach(() => {
  // A pane left picking keeps polling, and would take the next test's answers.
  for (const id of Object.keys(live.design.store.getState().panes)) live.design.stop(Number(id))
  act(() => root.unmount())
  host.remove()
})

const card = () =>
  act(() =>
    root.render(
      createElement(DesignCard, {
        id: ID,
        design: live.design,
        target: live.target.current,
        copy: async (t: string) => void copied.push(t),
      }),
    ),
  )

/** Waits, in real time, until Design Mode in the pane satisfies `ok`. */
async function until(ok: (d: ReturnType<typeof state>) => boolean) {
  for (let i = 0; i < 200 && !ok(state()); i++) await act(() => new Promise<void>((r) => setTimeout(r, 2)))
  expect(ok(state())).toBe(true)
}
const state = () => live.design.store.getState().panes[ID]

async function pick() {
  takes.push(PICKED)
  live.design.start(ID)
  await until((d) => d?.mode === 'picked' && d.shot.state !== 'taking')
}

const text = () => host.textContent ?? ''
const button = (label: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(label) || b.getAttribute('aria-label') === label)!

function type(el: HTMLTextAreaElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
  set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

test('off, the card draws nothing', async () => {
  await card()
  expect(host.innerHTML).toBe('')
})

test('while picking it says what to do, and Stop leaves Design Mode', async () => {
  live.design.start(ID)
  await card()
  expect(text()).toContain('Design Mode')
  expect(text()).toContain('click an element')
  await act(async () => button('Stop').click())
  expect(live.design.store.getState().panes[ID]).toBeUndefined()
  expect(host.innerHTML).toBe('')
})

test('a pick shows the element, its screenshot, where it goes, and sends with the note', async () => {
  await card()
  await pick()
  expect(text()).toContain('button "Save"')
  expect(text()).toContain('button#save · 80×32')
  expect(text()).toContain('To fix the header')
  expect(host.querySelector('img')!.getAttribute('src')).toBe('data:image/png;base64,CROP')
  const area = host.querySelector('textarea')!
  expect(host.querySelector('[data-ui]')).not.toBeNull()
  await act(async () => type(area, 'Make it blue'))
  await act(async () => button('Send').click())
  await until((d) => d?.mode === 'sent')
  expect(sent).toHaveLength(1)
  expect(sent[0].shot).toBe('/tmp/shot.png')
  expect(sent[0].text).toContain('Make it blue')
  expect(text()).toContain('Sent to fix the header')
})

test('with no agent to send to, Send is off and the reason shows', async () => {
  live.target.current = { kind: 'none', reason: 'no agent is running in feature' }
  await card()
  await pick()
  expect(button('Send').disabled).toBe(true)
  expect(text()).toContain("Can't send: no agent is running in feature")
})

test('Ctrl+Enter sends, Escape leaves', async () => {
  await card()
  await pick()
  const area = host.querySelector('textarea')!
  await act(async () => void area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true })))
  await until((d) => d?.mode === 'sent')
  expect(sent).toHaveLength(1)

  await pick()
  await act(async () => void host.querySelector('textarea')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(live.design.store.getState().panes[ID]).toBeUndefined()
})

test('Copy puts the write-up on the clipboard instead; Pick another arms again', async () => {
  await card()
  await pick()
  await act(async () => type(host.querySelector('textarea')!, 'note'))
  await act(async () => button('Copy').click())
  expect(copied).toHaveLength(1)
  expect(copied[0]).toContain('note')
  expect(copied[0]).toContain('**Screenshot:** /tmp/shot.png')
  expect(text()).toContain('Copied')
  await act(async () => button('Pick another').click())
  expect(live.design.store.getState().panes[ID]).toEqual({ mode: 'picking', error: null })
})

test('a failed screenshot shows as none, and the pick can still go', async () => {
  live.design = makeDesignMode({
    evaluate: async (_id, s) => (s === TAKE_SCRIPT ? (takes.shift() ?? '{"armed":true}') : 'true'),
    snapshot: async () => Promise.reject(new Error('only on macOS')),
    crop: async () => '',
    save: async () => '',
    target: () => live.target.current,
    deliver: async (_t, text, shot) => void sent.push({ text, shot }),
    timers: fast,
    repaintMs: 0,
  })
  await card()
  await pick()
  expect(text()).toContain('No screenshot')
  expect(button('Send').disabled).toBe(false)
})

test('the toggle lights while picking and the strip follows, without re-rendering forever', async () => {
  let renders = 0
  const Probe = () => {
    renders++
    return createElement('div', null, createElement(DesignToggle, { id: ID }), createElement(DesignStrip, { id: ID }))
  }
  await act(() => root.render(createElement(Probe)))
  const toggle = () => host.querySelector<HTMLButtonElement>('.browser-design')!
  expect(toggle().getAttribute('aria-pressed')).toBe('false')
  await act(async () => toggle().click())
  expect(toggle().getAttribute('aria-pressed')).toBe('true')
  expect(toggle().className).toContain('on')
  expect(text()).toContain('Design Mode')
  // Another pane's state changing leaves this one's toggle alone.
  await act(async () => live.design.start(-9))
  await act(async () => toggle().click())
  expect(toggle().getAttribute('aria-pressed')).toBe('false')
  expect(text()).not.toContain('Design Mode')
  expect(renders).toBe(1)
})

test('the action works on the focused browser pane, else the tab’s first one', () => {
  const tab = (focused: number) => ({ tabs: [{ id: 't', root: { kind: 'split', dir: 'row', ratio: 0.5, children: [{ kind: 'leaf', pane: 1 }, { kind: 'leaf', pane: -5 }] }, focused }] as never, activeTab: 't' })
  const panes = { 1: { id: 1, view: 'terminal' }, [-5]: { id: -5, view: 'browser' } } as never
  expect(designPane({ ...tab(-5), panes })).toBe(-5)
  expect(designPane({ ...tab(1), panes })).toBe(-5)
  // Two browsers: the focused one, though it is not the first.
  const two = { tabs: [{ id: 't', root: { kind: 'split', dir: 'row', ratio: 0.5, children: [{ kind: 'leaf', pane: -3 }, { kind: 'leaf', pane: -5 }] }, focused: -5 }] as never, activeTab: 't' }
  expect(designPane({ ...two, panes: { [-3]: { id: -3, view: 'browser' }, [-5]: { id: -5, view: 'browser' } } as never })).toBe(-5)
  expect(designPane({ ...tab(1), panes: { 1: { id: 1, view: 'terminal' } } as never })).toBeNull()
  expect(designPane({ tabs: [], activeTab: '', panes })).toBeNull()
})

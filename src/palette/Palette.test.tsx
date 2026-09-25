import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (cmd: string) =>
    cmd === 'app_build_info' ? { version: '0.1.0', sha: '9f3ab21', built_at: '2026-09-15 13:49 UTC' } : {},
  ),
}))

import Palette, { shortcutKeys } from './Palette'
import { store } from '../layout/app-store'
import { register } from '../actions/registry'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// cmdk measures its list with ResizeObserver, which jsdom lacks.
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = RO
Element.prototype.scrollIntoView ??= function () {}

const ran: string[] = []
register({ id: 'test.hello', title: 'Say hello', shortcut: '⌘⇧H', run: () => void ran.push('hello') })
// An action that puts the focus somewhere of its own, as "Open file…" does with its prompt.
const field = document.createElement('input')
register({ id: 'test.field', title: 'Focus a field', run: () => field.focus() })

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  store.setState({ paletteOpen: true })
  ran.length = 0
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function render() {
  await act(async () => root.render(<Palette />))
  // The build info is fetched in an effect; let its promise settle.
  await act(async () => {})
}

// The palette is a dialog: it renders into <body>, not into the host.
const item = (title: string) => [...document.querySelectorAll<HTMLElement>('[cmdk-item]')].find((i) => i.textContent?.includes(title))

test('the about line says which build is running, so a stale bundle reads as stale', async () => {
  await render()
  expect(document.querySelector('.palette-about')?.textContent).toBe('mnemo 0.1.0 · 9f3ab21 · built 2026-09-15 13:49 UTC')
})

test('every action is listed with its shortcut as keycaps, except the palette itself', async () => {
  await render()
  const hello = item('Say hello')!
  expect([...hello.querySelectorAll('kbd kbd')].map((k) => k.textContent)).toEqual(['⌘', '⇧', 'H'])
  expect(item('Command palette')).toBeUndefined()
})

test('choosing an action closes the palette and runs it', async () => {
  await render()
  await act(async () => item('Say hello')!.click())
  expect(ran).toEqual(['hello'])
  expect(store.getState().paletteOpen).toBe(false)
})

test('its field is marked as a palette, so dictation passes it by', async () => {
  await render()
  expect(document.querySelector('[cmdk-input]')?.closest('[data-palette]')).not.toBeNull()
})

test('dismissed, the focus goes back where it was; an action that ran keeps the focus it gave', async () => {
  const terminal = document.body.appendChild(document.createElement('textarea'))
  document.body.appendChild(field)
  try {
    store.setState({ paletteOpen: false })
    await render()
    terminal.focus()
    await act(async () => store.setState({ paletteOpen: true }))
    expect(document.activeElement?.hasAttribute('cmdk-input')).toBe(true)
    await act(async () => store.setState({ paletteOpen: false }))
    // Radix hands the focus over on a timer after the content unmounts.
    await act(() => new Promise((r) => setTimeout(r, 0)))
    expect(document.activeElement).toBe(terminal)

    await act(async () => store.setState({ paletteOpen: true }))
    await act(async () => item('Focus a field')!.click())
    await act(() => new Promise((r) => setTimeout(r, 0)))
    expect(document.activeElement).toBe(field)
  } finally {
    terminal.remove()
    field.remove()
  }
})

test('closed, nothing is drawn', async () => {
  store.setState({ paletteOpen: false })
  await render()
  expect(document.querySelector('[cmdk-root]')).toBeNull()
})

test('a shortcut splits into its keys', () => {
  expect(shortcutKeys('⌘⌥←')).toEqual(['⌘', '⌥', '←'])
  expect(shortcutKeys('Ctrl+E')).toEqual(['Ctrl', 'E'])
})

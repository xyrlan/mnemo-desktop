import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { vi } from 'vitest'
import { TooltipProvider } from '@/ui'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const R = '/code/app'

// Real zustand stores behind every hook the button reads: a selector that builds a new value on
// each read loops only when React subscribes to a live store (#212).
vi.mock('../layout/app-store', async () => {
  const { createStore, useStore } = await import('zustand')
  const store = createStore(() => ({ activeWorktree: '/code/app-wt-x' as string | null, tabs: [], activeTab: '', panes: {} }))
  return { store, useApp: (sel: (s: unknown) => unknown) => useStore(store, sel) }
})
vi.mock('../fleet/store', async () => {
  const { createStore, useStore } = await import('zustand')
  const fleetStore = createStore(() => ({ repos: [{ root: '/code/app', name: 'app', worktrees: [{ path: '/code/app' }, { path: '/code/app-wt-x' }] }] }))
  return { fleetStore, useFleet: (sel: (s: unknown) => unknown) => useStore(fleetStore, sel) }
})
vi.mock('@tauri-apps/api/core', () => ({ invoke: async (cmd: string) => (cmd === 'settings_read' ? {} : null), Channel: class {} }))

import { store as layout } from '../layout/app-store'
import { uiStore } from './app-ui'
import QuickCommands from './QuickCommands'
import { readQuickCommands, writeQuickCommands } from './settings'

let root: Root
let host: HTMLDivElement
let errors: unknown[]
beforeEach(async () => {
  await writeQuickCommands({ [R]: [{ label: 'Dev', command: 'pnpm dev' }] })
  uiStore.setState({ menuOpen: false, dialog: null })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  errors = []
  vi.spyOn(console, 'error').mockImplementation((...a) => void errors.push(a))
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.restoreAllMocks()
  expect(errors.filter((e) => String(e).includes('Maximum update depth'))).toEqual([])
})

const render = () => act(() => root.render(<TooltipProvider><QuickCommands /></TooltipProvider>))
const trigger = () => host.querySelector<HTMLButtonElement>('[data-quick-commands]')!

test("the button is on for the shown worktree's repo, in live stores, without looping", () => {
  render()
  expect(trigger().disabled).toBe(false)
  expect(trigger().getAttribute('aria-label')).toBe('Quick commands')
})

test('with no worktree shown, the button is off', () => {
  ;(layout as unknown as { setState(s: object): void }).setState({ activeWorktree: null })
  render()
  expect(trigger().disabled).toBe(true)
  ;(layout as unknown as { setState(s: object): void }).setState({ activeWorktree: `${R}-wt-x` })
})

test("adding through the dialog saves to the repo's list in the settings", () => {
  render()
  act(() => uiStore.getState().openDialog({ mode: 'add' }))
  expect(document.body.textContent).toContain('Saved for app')
  const set = (el: HTMLInputElement | HTMLTextAreaElement, v: string) => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')!.set!.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  act(() => set(document.querySelector<HTMLInputElement>('#quick-command-label')!, 'Test'))
  act(() => set(document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Command"]')!, 'pnpm test'))
  act(() => [...document.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Save'))!.click())
  expect(readQuickCommands()[R]).toEqual([
    { label: 'Dev', command: 'pnpm dev' },
    { label: 'Test', command: 'pnpm test' },
  ])
  expect(uiStore.getState().dialog).toBeNull()
})

test('editing the second command, then removing it', () => {
  void writeQuickCommands({ [R]: [{ label: 'Dev', command: 'pnpm dev' }, { label: 'Test', command: 'pnpm test' }] })
  render()
  act(() => uiStore.getState().openDialog({ mode: 'edit', index: 1 }))
  expect(document.querySelector<HTMLInputElement>('#quick-command-label')!.value).toBe('Test')
  act(() => [...document.querySelectorAll('button')].find((b) => b.textContent === 'Remove')!.click())
  expect(readQuickCommands()[R]).toEqual([{ label: 'Dev', command: 'pnpm dev' }])
})

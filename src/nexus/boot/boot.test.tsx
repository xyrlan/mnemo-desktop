import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const t = vi.hoisted(() => ({ calls: [] as string[] }))
vi.mock('@tauri-apps/api/core', () => ({
  Channel: class {},
  invoke: async (cmd: string) => {
    t.calls.push(cmd)
    if (cmd === 'settings_read') return { skipPermissions: true, quickCommands: { '/r/repo-a': [{ label: 'test', command: 'pnpm test' }] } }
    return null
  },
}))
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }))
// The tools check waits for the launch's burst, which never passes here.
vi.mock('../../shell/after-startup', () => ({ afterStartup: () => new Promise(() => {}) }))

import { toast } from '@/ui'
import { settingsStore } from '../../settings/app-store'
import { SlotOutlet } from '../../shell/Slot'
import { slotEntries } from '../../shell/slots'
import { startNexusApp } from '.'
import { NexusToasts } from './Toasts'

const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))))
const toasters = () => slotEntries('overlay').filter((e) => e.component === NexusToasts)

let host: HTMLDivElement
let root: Root
beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

test('the start reads the settings once, and a second start (StrictMode, a second caller) runs nothing twice', async () => {
  const stopA = startNexusApp()
  const stopB = startNexusApp()
  await flush()
  expect(t.calls.filter((c) => c === 'settings_read')).toHaveLength(1)
  expect(settingsStore.getState()).toMatchObject({ loaded: true, skipPermissions: true })
  expect(settingsStore.getState().quickCommands).toEqual({ '/r/repo-a': [{ label: 'test', command: 'pnpm test' }] })
  expect(toasters()).toHaveLength(1)

  // Only the last stop takes the toaster out; a stop called twice counts once.
  stopA()
  stopA()
  expect(toasters()).toHaveLength(1)
  stopB()
  expect(toasters()).toHaveLength(0)

  // Started again (StrictMode's second effect): the toaster is back; the settings are not read again.
  const stopC = startNexusApp()
  await flush()
  expect(toasters()).toHaveLength(1)
  expect(t.calls.filter((c) => c === 'settings_read')).toHaveLength(1)
  stopC()
})

test('a toast lands in the toaster the Nexus mounts, in the ship\'s look', async () => {
  const stop = startNexusApp()
  await act(async () => root.render(<SlotOutlet slot="overlay" />))
  expect(host.querySelector('section')).not.toBeNull()
  act(() => void toast.error('Could not save the workspace layout', { description: 'disk full' }))
  await flush()
  const toaster = document.querySelector('[data-sonner-toaster]')
  expect(toaster?.classList.contains('nx-toaster')).toBe(true)
  // Bottom-left over the ship: the drawer, on the right, keeps its terminal's prompt in view.
  expect(toaster?.getAttribute('data-x-position')).toBe('left')
  expect(toaster?.getAttribute('data-y-position')).toBe('bottom')
  const shown = document.querySelector('[data-sonner-toast]')
  expect(shown?.textContent).toContain('Could not save the workspace layout')
  expect(shown?.getAttribute('data-type')).toBe('error')
  // Each toast can be closed.
  expect(shown?.querySelector('[data-close-button]')).not.toBeNull()
  stop()
  await flush()
  expect(host.querySelector('section')).toBeNull()
})

// The stylesheets off disk, as the Nexus scene tests read theirs: vitest hands CSS imports back empty.
type Fs = { readFileSync(path: string, encoding: string): string }

test('toasts sit over every Nexus window, confirmation and menu (60, 61, 70), at 80', async () => {
  const fs = (await import(/* @vite-ignore */ 'node:' + 'fs')) as unknown as Fs
  const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')
  const css = strip(fs.readFileSync('src/ui/sonner.css', 'utf8'))
  // theme.css pins every toaster to --z-index-toast with !important: the ship's toaster outranks
  // that rule with a class and !important of its own.
  expect(strip(fs.readFileSync('src/theme.css', 'utf8'))).toMatch(/\[data-sonner-toaster\]\s*\{[^}]*z-index:[^}]*!important/)
  expect(css).toMatch(/\[data-sonner-toaster\]\.nx-toaster\s*\{[^}]*z-index:\s*80\s*!important/)
  const ui = strip(fs.readFileSync('src/nexus/ui/ui.css', 'utf8'))
  const zs = [...ui.matchAll(/z-index:\s*(\d+)/g)].map((m) => Number(m[1]))
  expect(Math.max(...zs)).toBeLessThan(80)
})

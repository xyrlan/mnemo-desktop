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
  const shown = document.querySelector('[data-sonner-toast]')
  expect(shown?.textContent).toContain('Could not save the workspace layout')
  expect(shown?.getAttribute('data-type')).toBe('error')
  // Each toast can be closed.
  expect(shown?.querySelector('[data-close-button]')).not.toBeNull()
  stop()
  await flush()
  expect(host.querySelector('section')).toBeNull()
})

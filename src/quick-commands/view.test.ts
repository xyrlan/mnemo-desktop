import { vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: async () => null, Channel: class {} }))
// The live stores poll and spawn; this test is only about where the view mounts.
vi.mock('../layout/app-store', () => ({ store: { getState: () => ({}) }, useApp: () => null }))
vi.mock('../fleet/store', () => ({ fleetStore: { getState: () => ({ repos: [] }) }, useFleet: () => [] }))

import { all, run } from '../actions/registry'
import { slotEntries } from '../shell/slots'
import { uiStore } from './app-ui'
import QuickCommands from './QuickCommands'
import './view'

test("mounts the button in the titlebar's right cluster", () => {
  expect(slotEntries('titlebar-right').map((e) => e.component)).toContain(QuickCommands)
})

test('quick-commands.open opens the menu, and is registered once', () => {
  expect(all().filter((a) => a.id === 'quick-commands.open')).toHaveLength(1)
  run('quick-commands.open')
  expect(uiStore.getState().menuOpen).toBe(true)
})

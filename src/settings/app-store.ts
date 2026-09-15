import { invoke } from '@tauri-apps/api/core'
import { useStore } from 'zustand'
import { createSettingsStore, type Settings, type SettingsState } from './store'

export const settingsStore = createSettingsStore({
  read: () => invoke<Partial<Settings>>('settings_read'),
  write: (s) => invoke('settings_write', { value: s }),
})
export const useSettings = <T,>(sel: (s: SettingsState) => T) => useStore(settingsStore, sel)

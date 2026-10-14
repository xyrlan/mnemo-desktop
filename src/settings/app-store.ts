import { invoke } from '@tauri-apps/api/core'
import { useStore } from 'zustand'
import { toast } from '@/ui'
import { createSettingsStore, type Settings, type SettingsState } from './store'

export const settingsStore = createSettingsStore({
  read: () => invoke<Partial<Settings>>('settings_read'),
  write: (s) => invoke('settings_write', { value: s }),
})
export const useSettings = <T,>(sel: (s: SettingsState) => T) => useStore(settingsStore, sel)

// A settings file that is there and cannot be read: said once, and it stays until dismissed.
// What shows meanwhile is the defaults, and the file is left as it is.
settingsStore.subscribe((s, prev) => {
  if (s.unreadable === null) return void (prev.unreadable !== null && toast.dismiss('settings-unreadable'))
  if (s.unreadable === prev.unreadable) return
  toast.error('Your settings could not be read', {
    id: 'settings-unreadable',
    description: `${s.unreadable}. The defaults are showing, and nothing is saved until that file is fixed or moved away.`,
    duration: Infinity,
  })
})

/** `set` for a caller with no place of its own to show a failure: a toast says the change was not saved. */
export const saveSetting = <K extends keyof Settings>(key: K, value: Settings[K]): Promise<void> =>
  settingsStore
    .getState()
    .set(key, value)
    .catch((e) => void toast.error('Could not save the setting', { description: e instanceof Error ? e.message : String(e) }))

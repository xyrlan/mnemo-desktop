import { settingsStore, useSettings } from '../settings/app-store'
import type { SettingsState } from '../settings/store'
import { commandsFor, type QuickCommand, type QuickCommands } from './commands'

// `Settings['quickCommands']` is projects-persist's (wave C, in parallel with this piece): read
// and written through this one file, so nothing else here minds whether it has landed yet.
type WithQuickCommands = { quickCommands?: QuickCommands }
type SetQuickCommands = (key: 'quickCommands', value: QuickCommands) => Promise<void>

const all = (s: SettingsState): QuickCommands | undefined => (s as unknown as WithQuickCommands).quickCommands

/** Every repo's saved commands, now. */
export const readQuickCommands = (): QuickCommands => all(settingsStore.getState()) ?? {}

/** Save every repo's commands to the settings file. */
export const writeQuickCommands = (next: QuickCommands): Promise<void> => (settingsStore.getState().set as unknown as SetQuickCommands)('quickCommands', next)

/** Repo `root`'s commands, as a hook: the stored array itself, so it re-renders only when they change. */
export const useQuickCommands = (root: string | null): QuickCommand[] => useSettings((s) => commandsFor(all(s), root))

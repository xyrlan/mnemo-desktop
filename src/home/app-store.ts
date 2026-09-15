import { useStore } from 'zustand'
import { createHomeStore, type HomeActions, type HomeState } from './store'
import { tauriHome } from './client'
import { settingsStore } from '../settings/app-store'
import { store as layout } from '../layout/app-store'

export const homeStore = createHomeStore(
  tauriHome,
  () => {
    const s = settingsStore.getState()
    return { homePinned: s.homePinned, homeHidden: s.homeHidden, cloneBase: s.cloneBase }
  },
  (k, v) => settingsStore.getState().set(k, v),
  {
    get panes() {
      return layout.getState().panes
    },
    openCommandTab: (cwd, cmd, sid) => layout.getState().openCommandTab(cwd, cmd, sid),
    newTab: (cwd) => layout.getState().newTab(cwd),
    focusPane: (id) => layout.getState().focusPane(id),
  },
)
export const useHome = <T,>(sel: (s: HomeState & HomeActions) => T) => useStore(homeStore, sel)

import { createStore, type State, type Actions } from './store'
import { tauriPty } from '../pty/client'
import { useStore } from 'zustand'

/** The single live store. Kept out of store.ts so tests never import Tauri. */
export const store = createStore(tauriPty)
export const useApp = <T,>(sel: (s: State & Actions) => T) => useStore(store, sel)

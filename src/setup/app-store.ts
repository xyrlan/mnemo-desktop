import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useStore } from 'zustand'
import { makeSetupClient } from './client'
import { createSetupStore, type SetupActions, type SetupState } from './store'

/** The single live store, shared by every setup pane and the launch check.
 *  Kept out of store.ts so tests never import Tauri. */
export const setup = createSetupStore(makeSetupClient(invoke, listen))
export const useSetup = <T,>(sel: (s: SetupState & SetupActions) => T) => useStore(setup, sel)

import { invoke } from '@tauri-apps/api/core'
import { useStore } from 'zustand'
import { makeVaultClient } from './client'
import { createVaultStore, type VaultActions, type VaultState } from './store'

/** The single live store, shared by every vault pane and the palette action.
 *  Kept out of store.ts so tests never import Tauri. */
export const vault = createVaultStore(makeVaultClient(invoke))
export const useVault = <T,>(sel: (s: VaultState & VaultActions) => T) => useStore(vault, sel)

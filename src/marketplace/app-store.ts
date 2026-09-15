import { invoke } from '@tauri-apps/api/core'
import { useStore } from 'zustand'
import { makeMarketplaceClient } from './client'
import { createMarketplaceStore, type MarketplaceActions, type MarketplaceState } from './store'

/** The single live store, shared by every marketplace pane and the palette actions.
 *  Kept out of store.ts so tests never import Tauri. */
export const marketplace = createMarketplaceStore(makeMarketplaceClient(invoke))
export const useMarketplace = <T,>(sel: (s: MarketplaceState & MarketplaceActions) => T) => useStore(marketplace, sel)

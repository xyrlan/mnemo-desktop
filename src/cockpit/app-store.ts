import { useStore } from 'zustand'
import { createCockpitStore, type CockpitActions, type CockpitState } from './store'

export const cockpitStore = createCockpitStore()
export const useCockpit = <T,>(sel: (s: CockpitState & CockpitActions) => T) => useStore(cockpitStore, sel)

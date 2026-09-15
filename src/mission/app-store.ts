import { useStore } from 'zustand'
import { createMissionStore, type MissionState, type MissionActions } from './store'
import { tauriMission } from './client'

export const missionStore = createMissionStore(tauriMission)
export const useMission = <T,>(sel: (s: MissionState & MissionActions) => T) => useStore(missionStore, sel)

import { useStore } from 'zustand'
import { createMissionStore, type MissionState, type MissionActions } from './store'
import { tauriMission } from './client'
import { settingsStore } from '../settings/app-store'

export const missionStore = createMissionStore(tauriMission, () => {
  const s = settingsStore.getState()
  return { outgoing: s.outgoing, replyLanguage: s.replyLanguage }
})
export const useMission = <T,>(sel: (s: MissionState & MissionActions) => T) => useStore(missionStore, sel)

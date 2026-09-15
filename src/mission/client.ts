import { invoke } from '@tauri-apps/api/core'
import type { Snapshot, Timeline } from './types'

export interface MissionClient {
  snapshot(focusedCwd: string | undefined, withPrs: boolean): Promise<Snapshot>
  timeline(id: string, fromLine: number): Promise<Timeline>
  reply(id: string, text: string): Promise<void>
  markLooked(id: string, timelineLen: number): Promise<void>
  looked(): Promise<Record<string, number>>
}

export const tauriMission: MissionClient = {
  snapshot: (focusedCwd, withPrs) => invoke('mission_snapshot', { focusedCwd: focusedCwd ?? null, withPrs }),
  timeline: (id, fromLine) => invoke('mission_timeline', { id, fromLine }),
  reply: (id, text) => invoke('mission_reply', { id, text }),
  markLooked: (id, timelineLen) => invoke('mission_mark_looked', { id, timelineLen }),
  looked: () => invoke('mission_looked'),
}

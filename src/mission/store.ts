import { createStore as createZustand, type StoreApi } from 'zustand/vanilla'
import type { MissionClient } from './client'
import type { Snapshot } from './types'

export type MissionState = {
  snapshot: Snapshot
  looked: Record<string, number>
  sidebarOpen: boolean
  sidebarWidth: number
  polling: boolean
  lastError: string | null
  /** Per-child reply drafts and send errors. */
  drafts: Record<string, string>
  replyErrors: Record<string, string>
  sending: Record<string, boolean>
  /** Replies that left this app, newest last; shown until the child moves and in the timeline. */
  sent: Record<string, { at: number; text: string }[]>
  translating: Record<string, boolean>
}

export type MissionActions = {
  refresh(focusedCwd: string | undefined, withPrs: boolean): Promise<void>
  loadLooked(): Promise<void>
  markLooked(id: string, timelineLen: number): Promise<void>
  toggleSidebar(): void
  setSidebarWidth(w: number): void
  setDraft(id: string, text: string): void
  sendReply(id: string): Promise<boolean>
  /** Replace the draft with its English translation (via `claude -p`). */
  translateDraft(id: string): Promise<boolean>
}

export type MissionStore = StoreApi<MissionState & MissionActions>

const EMPTY: Snapshot = { repos: [], errors: [], at: '' }

export function createMissionStore(client: MissionClient): MissionStore {
  return createZustand<MissionState & MissionActions>((set, get) => ({
    snapshot: EMPTY,
    looked: {},
    sidebarOpen: true,
    sidebarWidth: 360,
    polling: false,
    lastError: null,
    drafts: {},
    replyErrors: {},
    sending: {},
    sent: {},
    translating: {},

    async refresh(focusedCwd, withPrs) {
      if (get().polling) return
      set({ polling: true })
      try {
        const snapshot = await client.snapshot(focusedCwd, withPrs)
        set({ snapshot, lastError: null })
      } catch (e) {
        set({ lastError: String(e) })
      } finally {
        set({ polling: false })
      }
    },

    async loadLooked() {
      try {
        set({ looked: await client.looked() })
      } catch (e) {
        set({ lastError: String(e) })
      }
    },

    async markLooked(id, timelineLen) {
      set((s) => ({ looked: { ...s.looked, [id]: timelineLen } }))
      try {
        await client.markLooked(id, timelineLen)
      } catch (e) {
        set({ lastError: String(e) })
      }
    },

    toggleSidebar() {
      set((s) => ({ sidebarOpen: !s.sidebarOpen }))
    },
    setSidebarWidth(w) {
      set({ sidebarWidth: Math.min(720, Math.max(240, w)) })
    },
    setDraft(id, text) {
      set((s) => ({ drafts: { ...s.drafts, [id]: text } }))
    },

    async sendReply(id) {
      const text = (get().drafts[id] ?? '').trim()
      if (!text) return false
      set((s) => ({ sending: { ...s.sending, [id]: true }, replyErrors: { ...s.replyErrors, [id]: '' } }))
      try {
        await client.reply(id, text)
        set((s) => ({
          drafts: { ...s.drafts, [id]: '' },
          sent: { ...s.sent, [id]: [...(s.sent[id] ?? []), { at: Date.now(), text }] },
        }))
        return true
      } catch (e) {
        set((s) => ({ replyErrors: { ...s.replyErrors, [id]: String(e) } }))
        return false
      } finally {
        set((s) => ({ sending: { ...s.sending, [id]: false } }))
      }
    },

    async translateDraft(id) {
      const text = (get().drafts[id] ?? '').trim()
      if (!text) return false
      set((s) => ({ translating: { ...s.translating, [id]: true }, replyErrors: { ...s.replyErrors, [id]: '' } }))
      try {
        const out = await client.translate(text)
        if (out.trim()) set((s) => ({ drafts: { ...s.drafts, [id]: out.trim() } }))
        return true
      } catch (e) {
        set((s) => ({ replyErrors: { ...s.replyErrors, [id]: String(e) } }))
        return false
      } finally {
        set((s) => ({ translating: { ...s.translating, [id]: false } }))
      }
    },
  }))
}

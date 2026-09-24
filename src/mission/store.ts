import { createStore as createZustand, type StoreApi } from 'zustand/vanilla'
import type { MissionClient } from './client'
import type { Snapshot } from './types'
import type { Settings } from '../settings/store'
import { replyLanguageFooter } from '../settings/store'

export type MissionState = {
  snapshot: Snapshot
  looked: Record<string, number>
  polling: boolean
  lastError: string | null
  /** Per-child reply drafts and send errors. */
  drafts: Record<string, string>
  replyErrors: Record<string, string>
  sending: Record<string, boolean>
  /** A reply being typed into the child's terminal (`replyAsMe`). */
  typing: Record<string, boolean>
  /** Replies that left this app, newest last; `text` is what went out, `original` what was typed,
   *  `asMe` when it was typed into the child's terminal instead of posted to its inbox. */
  sent: Record<string, Sent[]>
  translating: Record<string, boolean>
}

export type Sent = { at: number; text: string; original: string; asMe?: boolean }

export type MissionActions = {
  refresh(focusedCwd: string | undefined, withPrs: boolean): Promise<void>
  loadLooked(): Promise<void>
  markLooked(id: string, timelineLen: number): Promise<void>
  setDraft(id: string, text: string): void
  sendReply(id: string): Promise<boolean>
  /** Types the draft, exactly as written, into the child's terminal through `claude attach`, so
   *  the child reads it as its user's turn and it can approve a push or a PR. `suggested` is the
   *  child's own suggested reply: sent unedited it would be the child approving itself. */
  replyAsMe(id: string, suggested?: string | null): Promise<boolean>
  /** Replace the draft with its English translation (via `claude -p`). */
  translateDraft(id: string): Promise<boolean>
}

export type MissionStore = StoreApi<MissionState & MissionActions>

const EMPTY: Snapshot = { repos: [], errors: [], at: '' }

export type OutgoingPolicy = () => Pick<Settings, 'outgoing' | 'replyLanguage'>

export function createMissionStore(client: MissionClient, policy: OutgoingPolicy = () => ({ outgoing: 'as-typed', replyLanguage: 'unchanged' })): MissionStore {
  return createZustand<MissionState & MissionActions>((set, get) => ({
    snapshot: EMPTY,
    looked: {},
    polling: false,
    lastError: null,
    drafts: {},
    replyErrors: {},
    sending: {},
    typing: {},
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

    setDraft(id, text) {
      set((s) => ({ drafts: { ...s.drafts, [id]: text } }))
    },

    async sendReply(id) {
      const text = (get().drafts[id] ?? '').trim()
      if (!text) return false
      set((s) => ({ sending: { ...s.sending, [id]: true }, replyErrors: { ...s.replyErrors, [id]: '' } }))
      try {
        const p = policy()
        let outgoing = text
        if (p.outgoing === 'en') {
          // Silent rewrite; on failure the original goes out rather than nothing.
          try {
            const t = (await client.translate(text)).trim()
            if (t) outgoing = t
          } catch {
            /* fall through with the original */
          }
        }
        outgoing += replyLanguageFooter(p.replyLanguage)
        await client.reply(id, outgoing)
        set((s) => ({
          drafts: { ...s.drafts, [id]: '' },
          sent: { ...s.sent, [id]: [...(s.sent[id] ?? []), { at: Date.now(), text: outgoing, original: text }] },
        }))
        return true
      } catch (e) {
        set((s) => ({ replyErrors: { ...s.replyErrors, [id]: String(e) } }))
        return false
      } finally {
        set((s) => ({ sending: { ...s.sending, [id]: false } }))
      }
    },

    async replyAsMe(id, suggested) {
      const text = (get().drafts[id] ?? '').trim()
      if (!text) return false
      if (suggested && text === suggested.trim()) {
        set((s) => ({ replyErrors: { ...s.replyErrors, [id]: "this is the child's suggested reply, not yours: edit it, or send it as a message" } }))
        return false
      }
      set((s) => ({ typing: { ...s.typing, [id]: true }, replyErrors: { ...s.replyErrors, [id]: '' } }))
      try {
        // No English rewrite and no language footer: an approval reaches the child in the words typed.
        await client.typeAsMe(id, text)
        set((s) => ({
          drafts: { ...s.drafts, [id]: '' },
          sent: { ...s.sent, [id]: [...(s.sent[id] ?? []), { at: Date.now(), text, original: text, asMe: true }] },
        }))
        return true
      } catch (e) {
        set((s) => ({ replyErrors: { ...s.replyErrors, [id]: e instanceof Error ? e.message : String(e) } }))
        return false
      } finally {
        set((s) => ({ typing: { ...s.typing, [id]: false } }))
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

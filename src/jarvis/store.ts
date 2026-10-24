import { createStore, type StoreApi } from 'zustand/vanilla'
import type { BrainConfig, Heard, LlmSetup, VoicePhase } from './client'
import type { Recent } from './infer'
import type { ParentEvent, ParentRef, ParentState } from './parent'

/** What the panel shows: the conversation, the model's setup, the parents Jarvis opened and what
 *  is waiting on the maintainer. The loop (`./loop`) writes it; the panel (`./panel`) reads it. */

export type Line =
  | { id: number; at: number; who: 'you'; text: string; spoken: boolean }
  | { id: number; at: number; who: 'james'; text: string }
  /** A parent's event, as one sentence. */
  | { id: number; at: number; who: 'parent'; project: string; sessionId: string; text: string }
  /** What Jarvis is doing ("lendo git_status no mnemo"), or why it could not. */
  | { id: number; at: number; who: 'note'; text: string; error?: true }

export type Setup = { kind: 'idle' } | LlmSetup | { kind: 'error'; message: string }

/** A parent as the panel shows it: the last of its events. */
export type Parent = { ref: ParentRef; state: ParentState; summary: string | null; question: string | null }

/** What the next request answers. `ask`: a question Jarvis asked (the project, which parent, or
 *  the model's `ask_user`); the answer goes with the request that raised it. `confirm`: a take
 *  heard with low confidence whose call acts, repeated back before it runs (#506); a yes runs
 *  `tool`. */
export type Pending =
  | { kind: 'ask'; request: string; question: string }
  | { kind: 'confirm'; heard: Heard; tool: string }

export type JarvisState = {
  open: boolean
  /** Who answers requests, as `jarvis_brain` last said; null until it has. */
  brain: BrainConfig | null
  /** The local model's setup. With Claude it starts only for the screen. */
  setup: Setup
  lines: Line[]
  /** A request is being worked on. */
  busy: boolean
  voice: VoicePhase
  /** Running parents, newest first. */
  parents: Parent[]
  pending: Pending | null
  /** The project of the last request that resolved one. */
  recent: Recent
  /** The last parent Jarvis opened, for "cancela" right after. */
  delegated: { sessionId: string; project: string; at: number } | null
}

export type JarvisStore = StoreApi<JarvisState>

/** The panel keeps the last lines only; the full record is the local log. */
export const MAX_LINES = 200

export const createJarvisStore = (): JarvisStore =>
  createStore<JarvisState>(() => ({
    open: false,
    brain: null,
    setup: { kind: 'idle' },
    lines: [],
    busy: false,
    voice: 'idle',
    parents: [],
    pending: null,
    recent: null,
    delegated: null,
  }))

type NewLine = Line extends infer L ? (L extends Line ? Omit<L, 'id' | 'at'> : never) : never

let nextId = 1
export function addLine(store: JarvisStore, line: NewLine, at = Date.now()): void {
  const full = { ...line, id: nextId++, at } as Line
  store.setState((s) => ({ lines: [...s.lines, full].slice(-MAX_LINES) }))
}

/** A parent event, folded into the list of running parents. */
export function foldParent(parents: Parent[], e: ParentEvent): Parent[] {
  const id = e.parent.sessionId
  if (e.kind === 'exited') return parents.filter((p) => p.ref.sessionId !== id)
  const had = parents.find((p) => p.ref.sessionId === id)
  const base: Parent = had ?? { ref: e.parent, state: 'starting', summary: null, question: null }
  const next: Parent =
    e.kind === 'opened'
      ? base
      : e.kind === 'turn-ended'
        ? { ...base, state: 'idle', summary: e.summary, question: null }
        : { ...base, state: e.kind, question: e.question }
  return had ? parents.map((p) => (p === had ? next : p)) : [next, ...parents]
}

/** A parent event as the panel's line, in James's words. */
export function parentLine(e: ParentEvent): string {
  switch (e.kind) {
    case 'opened':
      return 'Parent aberto.'
    case 'turn-ended':
      return e.summary
    case 'asking':
      return `Pergunta: ${e.question}`
    case 'approval':
      return `Espera aprovação: ${e.question}`
    case 'exited':
      return 'Parent encerrado.'
  }
}

/** The parents waiting on an approval, oldest wait first. */
export const approvals = (s: Pick<JarvisState, 'parents'>): Parent[] => s.parents.filter((p) => p.state === 'approval').reverse()

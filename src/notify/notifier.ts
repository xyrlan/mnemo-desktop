import { createStore, type StoreApi } from 'zustand/vanilla'
import type { AgentEvent } from '../agents/events'
import type { RepoNode } from '../fleet/types'
import { alertFor, looking, paneOf, shownWorktree, type Alert } from './decide'

/** A card in the stack: one per session, the newest alert about it. */
export type Card = Alert & { id: number; pane: number | null }

export type Cards = { cards: Card[] }

/** Everything the notifier reads or does outside itself, so tests drive it without Tauri. */
export type NotifierDeps = {
  subscribe(cb: (e: AgentEvent) => void): () => void
  repos(): readonly RepoNode[]
  /** `activeWorktree` of the layout. */
  active(): string | null
  /** The panes of the shown worktree's tabs. */
  shownPanes(): readonly number[]
  focused(): boolean
  /** Calls `cb` when the shown worktree or the window's focus may have changed. */
  onLook(cb: () => void): () => void
  native(title: string, body: string): Promise<void>
  sound(): void
  switchTo(worktree: string | null, pane: number | null): void
  /** Shows the dispatched child session `sessionId` is (working in `worktree`) in its parent's
   *  Dispatch tab; false when it is no child, or the tab cannot take it. */
  openChild?(sessionId: string, worktree: string | null): boolean
  now(): number
}

/** At most this many cards; the oldest goes first. */
export const MAX_CARDS = 4
/** A finished turn's card leaves on its own after this; an ask stays until it is answered. */
export const DONE_TTL_MS = 20_000
/** Two alerts closer than this chime once. */
export const SOUND_GAP_MS = 1_500

export type Notifier = {
  cards: StoreApi<Cards>
  /** The card was clicked: show its worktree (and pane), or a dispatched child's Dispatch tab,
   *  and the card goes. */
  open(id: number): void
  dismiss(id: number): void
  stop(): void
}

/**
 * Tells you when an agent finishes its turn or starts waiting on you, unless you are looking at
 * it (the window has focus and shows its worktree): a card in the stack and a short sound, and
 * a native notification when the window is not focused — with focus, the card already says it.
 */
export function createNotifier(deps: NotifierDeps): Notifier {
  const cards = createStore<Cards>(() => ({ cards: [] }))
  const timers = new Map<number, ReturnType<typeof setTimeout>>()
  let nextId = 1
  let lastSound = -Infinity

  const drop = (keep: (c: Card) => boolean) => {
    const before = cards.getState().cards
    const after = before.filter(keep)
    if (after.length === before.length) return
    for (const c of before) if (!after.includes(c)) clearTimeout(timers.get(c.id)), timers.delete(c.id)
    cards.setState({ cards: after })
  }
  const dismiss = (id: number) => drop((c) => c.id !== id)

  const at = (pane: number | null) => ({
    focused: deps.focused(),
    shown: shownWorktree(deps.active(), deps.repos()),
    shownPanes: deps.shownPanes(),
    pane,
  })

  const onEvent = (e: AgentEvent) => {
    // It moved on — you answered it, or it is gone: what its card said is no longer so.
    if (e.kind === 'prompt' || e.kind === 'start' || e.kind === 'end') return drop((c) => c.sessionId !== e.sessionId)
    const repos = deps.repos()
    const alert = alertFor(e, repos)
    if (!alert) return
    const pane = paneOf(e.sessionId, repos)
    const where = at(pane)
    if (looking(alert, where)) return
    const card: Card = { ...alert, id: nextId++, pane }
    const next = [...cards.getState().cards.filter((c) => c.sessionId !== card.sessionId), card].slice(-MAX_CARDS)
    drop((c) => next.includes(c))
    cards.setState({ cards: next })
    if (card.kind === 'done') timers.set(card.id, setTimeout(() => dismiss(card.id), DONE_TTL_MS))
    const now = deps.now()
    if (now - lastSound >= SOUND_GAP_MS) {
      lastSound = now
      deps.sound()
    }
    if (!where.focused) void deps.native(card.repo && card.repo !== card.name ? `${card.repo} · ${card.name}` : card.name, card.message).catch((err) => console.warn('notify: no native notification', err))
  }

  // What is on screen with focus is no longer news.
  const onLook = () => {
    const now = at(null)
    drop((c) => !looking(c, { ...now, pane: c.pane }))
  }

  const offs = [deps.subscribe(onEvent), deps.onLook(onLook)]

  return {
    cards,
    dismiss,
    open(id) {
      const card = cards.getState().cards.find((c) => c.id === id)
      if (!card) return
      dismiss(id)
      if (deps.openChild?.(card.sessionId, card.worktree)) return
      if (card.worktree !== null || card.pane !== null) deps.switchTo(card.worktree, card.pane)
    },
    stop() {
      offs.forEach((off) => off())
      drop(() => false)
    },
  }
}

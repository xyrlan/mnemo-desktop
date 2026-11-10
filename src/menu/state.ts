// The one menu: what it is on, where it stands, the item in hand, and what an item is in the
// middle of (asked about, being typed, on its way, refused). One store, so there is one menu at
// a time, and opening it changes nothing else: the selection and the stage move only when an
// item is chosen (docs/superpowers/specs/2026-11-10-session-menu.md, "Rules it keeps").

import { create } from 'zustand'
import { sayOutcome } from '../command/line'
import type { Outcome } from '../world/actions'
import { keyOf, type Item, type Target } from './model'

/** Where the menu stands: at the pointer, or against the element that draws what it is on. */
export type Place = { x: number; y: number } | { box: { left: number; top: number; right: number; bottom: number } }

export interface MenuState {
  /** What the menu is on, or null when there is none. `n` counts the openings: an answer that
   *  comes back to another menu is not this one's. */
  open: { target: Target; place: Place; n: number } | null
  /** The item in hand, by its id; null is the first that can be chosen. */
  at: string | null
  /** The choice in hand of a row of choices. */
  part: number
  /** The item that was asked about and waits for the second choosing. */
  asked: string | null
  /** The item whose line is being typed, and the line. */
  typing: string | null
  draft: string
  /** The item on its way. */
  busy: string | null
  /** A refusal, in the words the action gave, under the item it was for. */
  refused: { item: string; why: string } | null
}

const REST: Omit<MenuState, 'open'> = { at: null, part: 0, asked: null, typing: null, draft: '', busy: null, refused: null }

export const menuStore = create<MenuState>(() => ({ open: null, ...REST }))

/** What had the keys before the menu took them: they go back there when it closes. */
let before: Element | null = null
let count = 0

/** Opens the menu on `target` at `place`. Another one that is open gives way. */
export function openMenu(target: Target, place: Place): void {
  if (!menuStore.getState().open) before = typeof document === 'undefined' ? null : document.activeElement
  menuStore.setState({ open: { target, place, n: ++count }, ...REST })
}

const inMenu = (el: Element | null): boolean => !!el?.closest('[data-menu-root]')

/** Closes the menu. The keys return to where they were, unless something else took them
 *  meanwhile (a panel that opened, a field that was clicked). */
export function closeMenu(): void {
  if (!menuStore.getState().open) return
  const to = before
  before = null
  const at = typeof document === 'undefined' ? null : document.activeElement
  menuStore.setState({ open: null, ...REST })
  if (to instanceof HTMLElement && to.isConnected && (!at || at === document.body || inMenu(at))) to.focus({ preventScroll: true })
}

/** Whether the menu is open on this very thing. */
export const isOpenOn = (target: Target): boolean => {
  const open = menuStore.getState().open
  return !!open && keyOf(open.target) === keyOf(target)
}

/** Puts an item in hand. Looking away from a question takes it back, and from a line being
 *  typed or a refusal too. */
export function hold(id: string, part = 0): void {
  const s = menuStore.getState()
  if (!s.open || s.busy || (s.at === id && s.part === part)) return
  menuStore.setState(s.at === id ? { part } : { at: id, part, asked: null, typing: null, refused: null })
}

export function typeLine(draft: string): void {
  menuStore.setState({ draft, refused: null })
}

/** Esc, one step: out of the line being typed, then back from the question, then closed. */
export function stepBack(): void {
  const s = menuStore.getState()
  if (s.busy) return
  if (s.typing) menuStore.setState({ typing: null })
  else if (s.asked) menuStore.setState({ asked: null })
  else closeMenu()
}

async function attempt(act: () => Outcome | Promise<Outcome>): Promise<Outcome> {
  try {
    return await act()
  } catch (e) {
    return { ok: false, why: e instanceof Error ? e.message : String(e) }
  }
}

/** Chooses an item: asks first when it ends something, opens its line when one is typed, else
 *  runs it. Done, the menu closes and the foot says what came of it; refused, the menu stays
 *  and says why, in the words the action gave. */
export async function choose(item: Item | undefined, part?: number): Promise<void> {
  const s = menuStore.getState()
  const mine = s.open?.n
  if (!s.open || !item || item.off || s.busy) return
  const which = part ?? (s.at === item.id ? s.part : 0)
  if (s.at !== item.id) menuStore.setState({ at: item.id, part: which, asked: null, typing: null, refused: null })
  else if (s.part !== which) menuStore.setState({ part: which })
  const now = menuStore.getState()

  if (item.type != null && now.typing !== item.id) {
    menuStore.setState({ typing: item.id, refused: null })
    return
  }
  const text = now.draft.trim()
  if (item.type != null && !text) return
  if (item.ask && now.asked !== item.id) {
    menuStore.setState({ asked: item.id, refused: null })
    return
  }

  menuStore.setState({ busy: item.id, refused: null })
  const out = await attempt(() => item.run({ part: item.parts?.[which]?.id, text }))
  // The menu was closed, or opened on something else, while the answer was on its way: what
  // came of it is still said, at the foot.
  const here = menuStore.getState().open?.n === mine
  if (!out.ok) {
    if (here) menuStore.setState({ busy: null, asked: null, refused: { item: item.id, why: out.why } })
    else sayOutcome(out.why, false)
    return
  }
  const said = item.says ?? item.label
  if (item.says || out.note) sayOutcome(out.note ? `${said} · ${out.note}` : said, true)
  if (here) closeMenu()
}

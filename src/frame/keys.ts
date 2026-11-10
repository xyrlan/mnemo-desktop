// The fleet-wide keys (docs/superpowers/specs/2026-11-10-recreation-design.md, "Keys"). Two
// places take keys: inside a terminal or a text field a key is typed, and the fleet is reached
// with Alt; anywhere else the same keys work bare. This file says which key a press is and what
// it does; `Frame.tsx` listens and hands it the world.

import type { Route, View } from '../world/route'
import { childrenOf, isPresent, rootOf, rosterOrder, sessionOf } from '../world/store'
import type { Pending, Session, World } from '../world/types'

export type FleetKey = 'up' | 'down' | 'left' | 'right' | 'back' | 'next' | 'answer' | 'reply' | 'orbit' | 'console' | 'score' | 'enter' | 'command' | 'escape' | 'sheet' | 'menu' | 'project'

/** Where the press landed. terminal: the session's own keys. field: a text field. control: a
 *  button or a link, which keeps its own Enter and Space. open: anywhere else. */
export type Where = 'terminal' | 'field' | 'control' | 'open'

export type Press = Pick<KeyboardEvent, 'key' | 'code' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>

/** Where an element takes keys. `.xterm` is what xterm.js draws a terminal in. */
export function whereOf(target: EventTarget | null): Where {
  const el = target instanceof Element ? target : null
  if (!el) return 'open'
  if (el.closest('.xterm, [data-live-terminal]')) return 'terminal'
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el instanceof HTMLElement && el.isContentEditable) || el.closest('[contenteditable="true"]')) return 'field'
  if (el instanceof HTMLInputElement) return ['button', 'submit', 'reset', 'checkbox'].includes(el.type) ? 'control' : 'field'
  if (el.closest('button, a[href], summary, [role="button"]')) return 'control'
  return 'open'
}

const BY_KEY: Record<string, FleetKey> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Enter: 'enter',
  Escape: 'escape',
  q: 'back',
  n: 'next',
  r: 'reply',
  h: 'orbit',
  c: 'console',
  t: 'score',
  m: 'menu',
  // The keyboard's own key for a menu, where it has one.
  ContextMenu: 'menu',
  ';': 'command',
  '?': 'sheet',
}

// ⌥ on a Mac changes the character a key types (⌥N is a dead tilde), so with Alt held the
// physical key also names it.
const BY_CODE: Record<string, FleetKey> = { KeyQ: 'back', KeyN: 'next', KeyR: 'reply', KeyH: 'orbit', KeyC: 'console', KeyT: 'score', KeyM: 'menu', Semicolon: 'command' }

/** The fleet key a press is, where it landed, or null when the press is not the frame's.
 *  Ctrl and ⌘ chords are never the frame's (the app's own chords are `src/actions/chords.ts`,
 *  and AltGr arrives as Ctrl+Alt). */
export function fleetKey(e: Press, where: Where): { key: FleetKey; digit: number } | null {
  if (e.ctrlKey || e.metaKey) return null
  const typed = where === 'terminal' || where === 'field'
  if (typed && !e.altKey && e.key !== 'Escape') return null

  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
  const letter = /^[a-z]$/.test(k)
  let key: FleetKey | undefined = BY_KEY[k]
  let digit = /^[1-9]$/.test(k) ? Number(k) : 0
  if (!key && !digit && e.altKey) {
    key = e.code === 'Slash' && e.shiftKey ? 'sheet' : BY_CODE[e.code]
    const d = /^Digit([1-9])$/.exec(e.code)
    if (d) digit = Number(d[1])
  }
  if (digit) return { key: 'answer', digit }
  // Shift+F10 is the other way a keyboard asks for a menu.
  if (k === 'F10' && e.shiftKey) return { key: 'menu', digit: 0 }
  if (!key) return null
  // `M` is the selected session's menu; with Shift, its project's.
  if (key === 'menu' && e.shiftKey && k !== 'ContextMenu') return { key: 'project', digit: 0 }
  // Shift with a letter or an arrow is somebody else's key; a sign may need Shift to be typed.
  if (e.shiftKey && (letter || k.startsWith('Arrow') || k === 'Enter' || BY_CODE[e.code] === key) && key !== 'command') return null
  if (key === 'escape') {
    // Never sent with Alt, and never taken from a terminal.
    if (e.altKey || where === 'terminal') return null
    return { key, digit: 0 }
  }
  // A button or a link in hand keeps its own Enter.
  if (key === 'enter' && where === 'control' && !e.altKey) return null
  return { key, digit: 0 }
}

/** A session's family, as left and right walk it: the root, then its children. From a session
 *  that left the present, the whole family as Score draws it. */
export function familyOf(world: World, id: string | null): Session[] {
  const s = sessionOf(world, id)
  if (!s) return []
  const root = rootOf(world, s)
  return [root, ...childrenOf(world, root, !isPresent(world, s))]
}

/** The session `by` steps from `id` in `list`. From nowhere, down is the first and up the
 *  last. `wrap`: past an end is the other end; otherwise the end holds. */
export function step<T extends { id: string }>(list: readonly T[], id: string | null, by: 1 | -1, wrap: boolean): T | null {
  if (!list.length) return null
  const at = list.findIndex((s) => s.id === id)
  if (at < 0) return by > 0 ? list[0] : list[list.length - 1]
  const to = at + by
  if (wrap) return list[(to + list.length) % list.length]
  return list[Math.max(0, Math.min(list.length - 1, to))]
}

/** How long after one Q the next still walks further back, instead of returning. */
export const WALK_MS = 1500

/** `Q`: the session he was on before. Pressed again at once, the one before that, and so on
 *  back (most recent first); after a pause it returns to where he came from. */
export function createBack() {
  let walk: { list: string[]; at: number; when: number } | null = null
  return (recent: string[], current: string | null, now: number, has: (id: string) => boolean): string | null => {
    if (walk && now - walk.when <= WALK_MS && walk.list[walk.at] === current && walk.at + 1 < walk.list.length) {
      walk = { ...walk, at: walk.at + 1, when: now }
    } else {
      // The sessions he was on, newest first, the one he is on now leading.
      const list = [...(current ? [current] : []), ...recent.filter((id) => id !== current && has(id))]
      if (list.length < 2 && current) return null
      walk = { list, at: current ? 1 : 0, when: now }
    }
    return walk.list[walk.at] ?? null
  }
}

/** What the frame needs to act on a key. `Frame.tsx` gives the real ones; a test, its own. */
export interface Fleet {
  world(): World
  route(): Route
  /** The sessions that were selected, most recent first. */
  recent(): string[]
  /** What up and down walk: the roster as it is shown now (regrouped by project after `G`),
   *  then the terminals the app holds that are no session. Without it, `rosterOrder`. */
  order?(): readonly { id: string }[]
  /** Whether `id` can still be put on stage: a session of the world, or a terminal held.
   *  Without it, a session of the world. */
  has?(id: string): boolean
  go(patch: Partial<Route>): void
  now(): number
  nextPending(world: World, route: Route): Pending | null
  answerArmed(key: number): unknown
  /** False: nothing armed takes a reply, so the key was not spent. */
  replyArmed(): boolean
  /** Puts the caret in the terminal on stage (or the box that speaks to it). `already`: it was
   *  there; `none`: the stage has nothing to type into. */
  focusTerminal(): 'focused' | 'already' | 'none'
  /** Takes the caret out of the field it is in. */
  leaveField(): void
  openCommand(): void
  /** Esc for the command line: takes back a batch asked about, else closes it. */
  escapeCommand(): void
  sheet: { isOpen(): boolean; set(open: boolean): void }
  /** Opens the menu of what is in focus or selected (`project`: of its project), where it is
   *  drawn. False: there was nothing to open it on, so the key was not spent. */
  openMenu?(of: 'session' | 'project'): boolean
  back(recent: string[], current: string | null, now: number, has: (id: string) => boolean): string | null
}

const VIEW: Partial<Record<FleetKey, View>> = { orbit: 'orbit', console: 'console', score: 'score' }

/** Does what a press means. True when the press was the frame's (and so is nobody else's). */
export function press(e: Press, where: Where, fleet: Fleet): boolean {
  const hit = fleetKey(e, where)
  // The key sheet is over everything: any key closes it, and that is all the key does.
  if (fleet.sheet.isOpen()) {
    if (e.ctrlKey || e.metaKey || ['Alt', 'Shift', 'Control', 'Meta'].includes(e.key)) return false
    fleet.sheet.set(false)
    return true
  }
  if (!hit) return false
  const world = fleet.world()
  const route = fleet.route()
  const select = (s: { id: string } | null) => s && s.id !== route.session && fleet.go({ session: s.id, pending: null })
  const has = (id: string) => fleet.has?.(id) ?? !!sessionOf(world, id)

  switch (hit.key) {
    case 'up':
    case 'down':
      select(step(fleet.order?.() ?? rosterOrder(world), route.session, hit.key === 'down' ? 1 : -1, false))
      return true
    case 'left':
    case 'right':
      select(step(familyOf(world, route.session), route.session, hit.key === 'right' ? 1 : -1, true))
      return true
    case 'back': {
      const id = fleet.back(fleet.recent(), route.session, fleet.now(), has)
      if (id && id !== route.session) fleet.go({ session: id, pending: null })
      return true
    }
    case 'next': {
      const p = fleet.nextPending(world, route)
      if (p) fleet.go({ session: p.session, pending: p.id })
      return true
    }
    case 'answer':
      void fleet.answerArmed(hit.digit)
      return true
    case 'reply':
      return fleet.replyArmed()
    case 'orbit':
    case 'console':
    case 'score':
      if (route.view !== VIEW[hit.key]) fleet.go({ view: VIEW[hit.key] })
      return true
    case 'command':
      fleet.openCommand()
      return true
    case 'sheet':
      fleet.sheet.set(true)
      return true
    case 'menu':
    case 'project':
      return fleet.openMenu?.(hit.key === 'project' ? 'project' : 'session') ?? false
    case 'enter': {
      // Outside Console, Enter opens the selection on its stage.
      if (route.view !== 'console') {
        if (!route.session) return false
        fleet.go({ view: 'console', pending: null, panel: null })
        return true
      }
      // The first Enter puts the caret in the terminal; with it there already (Alt+Enter, from
      // inside), or with nothing on stage to type into, Enter gives the stage the room, and back.
      if (fleet.focusTerminal() !== 'focused') fleet.go({ wide: !route.wide })
      return true
    }
    case 'escape': {
      if (where === 'field') fleet.leaveField()
      else if (route.command) fleet.escapeCommand()
      else if (route.pending) fleet.go({ pending: null })
      else if (route.panel) fleet.go({ panel: null })
      else if (route.wide) fleet.go({ wide: false })
      else return false
      return true
    }
  }
}

/** Puts the caret in the terminal on stage: the live terminal when the stage hosts one, else
 *  the box that speaks to the session under its drawn transcript. `own` is the stage's own way
 *  in, when it has one; without it the frame looks for the field itself. */
export function focusTerminal(root: ParentNode | null, own?: () => boolean): 'focused' | 'already' | 'none' {
  const stage = root?.querySelector('[data-stage]')
  if (!stage) return 'none'
  const at = document.activeElement
  // The caret is in the stage's terminal, or in the box that speaks to it, already.
  if (at && stage.contains(at) && !at.closest('[data-pending]') && ['terminal', 'field'].includes(whereOf(at))) return 'already'
  if (own) return own() ? 'focused' : 'none'
  const fields = [...stage.querySelectorAll<HTMLElement>('.xterm-helper-textarea, [data-live-terminal][tabindex], [data-live-terminal] [tabindex], textarea, input[type="text"], input:not([type])')]
  // A waiting card's own field is `R`'s, not Enter's.
  const target = fields.find((el) => !el.closest('[data-pending]'))
  if (!target) return 'none'
  target.focus()
  return document.activeElement === target ? 'focused' : 'none'
}

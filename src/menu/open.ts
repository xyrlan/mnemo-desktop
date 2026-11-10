// How the menu is opened: by a right-click on anything that draws a session or a project's
// name, and by a key on the selection. A view marks what it draws (`drawsSession`,
// `drawsProject`, `drawsTerminal`) and hands its right-clicks to `contextMenu`; the frame's
// keys call `menuByKey`. The menu never opens over a live terminal's own area, or in a text
// field: a right-click there is the terminal's and the field's, as it was.

import { runtimeStore } from '../runtime/current'
import type { Hosted } from '../runtime'
import { routeStore } from '../world/route'
import { sessionOf, worldStore } from '../world/store'
import { keyOf, menuOf, targetFrom, type Target } from './model'
import { openMenu, type Place } from './state'

/** What marks an element as drawing a session: spread on it (`{...drawsSession(id)}`). */
export const drawsSession = (id: string) => ({ 'data-menu': `session:${id}` })
/** What marks an element as a project's name. */
export const drawsProject = (name: string) => ({ 'data-menu': `project:${name}` })
/** What marks an element as drawing a terminal the app holds that is no session. */
export const drawsTerminal = (id: string) => ({ 'data-menu': `terminal:${id}` })

/** A live terminal's own area (`keys.ts` knows it by the same two names). */
const TERMINAL = '.xterm, [data-live-terminal]'
/** Where the webview's own menu stays: cut, copy, paste. */
const FIELD = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]'

const held = (): Hosted[] => runtimeStore.getState().runtime?.hosted() ?? []

/** What an element draws, itself or by being inside something that does. */
export function drawnAt(el: Element | null | undefined): { target: Target; el: Element } | null {
  const hit = el?.closest?.('[data-menu]') ?? null
  const target = targetFrom(hit?.getAttribute('data-menu'))
  return hit && target ? { target, el: hit } : null
}

/** Opens the menu on `target`, when it is in the world. False when it is not: nothing opens. */
export function openOn(target: Target, place: Place, hosted: readonly Hosted[] = held()): boolean {
  const menu = menuOf(worldStore.getState().world, target, hosted)
  if (!menu) return false
  openMenu(menu.target, place)
  return true
}

const boxOf = (el: Element): Place => {
  const r = el.getBoundingClientRect()
  return { box: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } }
}

type Click = { target: EventTarget | null; clientX: number; clientY: number; defaultPrevented: boolean; preventDefault(): void }

/** A view's `onContextMenu`. Opens the menu of what was right-clicked and holds the webview's
 *  own menu back; anywhere else it does nothing, and the event is whoever's it was. `on`: what
 *  the click is on, when the view knows it without a mark (a line drawn on a canvas). The
 *  context-menu key and Shift+F10 arrive here too, on the element in focus, at a point inside
 *  it. True when the menu opened. */
export function contextMenu(e: Click, on?: Target): boolean {
  if (e.defaultPrevented) return false
  const at = e.target instanceof Element ? e.target : null
  if (!at) return false
  // The menu itself is not a page either.
  if (at.closest('[data-menu-root]')) {
    e.preventDefault()
    return false
  }
  if (at.closest(TERMINAL) || at.closest(FIELD)) return false
  const hit = on ? { target: on, el: at } : drawnAt(at)
  if (!hit) return false
  const place: Place = e.clientX > 0 || e.clientY > 0 ? { x: e.clientX, y: e.clientY } : boxOf(hit.el)
  if (!openOn(hit.target, place)) return false
  e.preventDefault()
  return true
}

const inSight = (el: Element): boolean => {
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < window.innerHeight && r.left < window.innerWidth
}

/** Where `target` is drawn under `root`, for a menu opened by a key to stand against: in the
 *  view that is shown, in sight when one is, and on the stage when the keys were there. */
export function drawingOf(root: ParentNode | null, target: Target): Element | null {
  const key = keyOf(target)
  const all = [...(root?.querySelectorAll('[data-menu]') ?? [])].filter((el) => el.getAttribute('data-menu') === key && !el.closest('[inert], [data-leaving]'))
  if (!all.length) return null
  const seen = all.filter(inSight)
  const pool = seen.length ? seen : all
  const stage = document.activeElement?.closest('[data-stage]')
  return (stage && pool.find((el) => stage.contains(el))) || pool[0]
}

/** The frame's `M` (and the context-menu key, and Shift+F10): the menu of what is in focus when
 *  that draws something, else of the selected session. `project`: of its project instead. The
 *  menu stands against the place where it is drawn. False when there is nothing to open it on:
 *  the key was not spent. */
export function menuByKey(root: ParentNode | null, of: 'session' | 'project', hosted: readonly Hosted[] = held()): boolean {
  const world = worldStore.getState().world
  const focused = typeof document === 'undefined' ? null : drawnAt(document.activeElement)
  let target: Target | null = focused?.target ?? null
  let el: Element | null = focused?.el ?? null
  if (!target) {
    const id = routeStore.getState().route.session
    const s = sessionOf(world, id)
    target = s ? { kind: 'session', id: s.id } : id && hosted.some((h) => h.id === id) ? { kind: 'terminal', id } : null
  }
  if (!target) return false
  if (of === 'project' && target.kind !== 'project') {
    const name = target.kind === 'session' ? sessionOf(world, target.id)?.project : null
    if (!name) return false
    const project: Target = { kind: 'project', name }
    // Against the project's own name where the view draws it, else where its session is.
    el = drawingOf(root, project) ?? el ?? drawingOf(root, target)
    target = project
  }
  el ??= drawingOf(root, target)
  const middle: Place = { x: Math.round((typeof window === 'undefined' ? 0 : window.innerWidth) / 2), y: Math.round((typeof window === 'undefined' ? 0 : window.innerHeight) / 3) }
  return openOn(target, el ? boxOf(el) : middle, hosted)
}

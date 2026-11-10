import type { Hosted } from '../runtime'
import { runtimeStore } from '../runtime/current'
import { HOME, routeStore } from '../world/route'
import { sampleWorld } from '../world/sample'
import { worldStore } from '../world/store'
import type { Session } from '../world/types'
import { contextMenu, drawingOf, drawnAt, drawsProject, drawsSession, drawsTerminal, menuByKey, openOn } from './open'
import { closeMenu, menuStore } from './state'

const sample = sampleWorld()
const titled = (start: string): Session => sample.sessions.find((s) => s.title.startsWith(start))!
const bundle = titled('Why is the bundle')
const tenant = titled('Tenant in every cache key')
const billing = titled('Idempotent retries')
const shell: Hosted = { id: 'tab-7', kind: 'session', label: '', cwd: '/Users/you/work/atlas-api', sessionId: null, pty: 7 }

let host: HTMLElement
const opened = () => menuStore.getState().open

/** An element marked as a view marks it, with whatever is inside. */
function el(tag: string, attrs: Record<string, string> = {}, ...kids: HTMLElement[]): HTMLElement {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v)
  node.append(...kids)
  return node
}

/** A right-click on `target`, handed over as a view's root hands it. */
function rightClick(target: Element, at: { x?: number; y?: number } = {}, on?: Parameters<typeof contextMenu>[1]) {
  const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: at.x ?? 0, clientY: at.y ?? 0, button: 2 })
  Object.defineProperty(e, 'target', { value: target })
  const took = contextMenu(e, on)
  return { took, held: e.defaultPrevented }
}

const boxed = <T extends Element>(node: T, box: { left: number; top: number; width: number; height: number }): T => {
  node.getBoundingClientRect = () => ({ ...box, right: box.left + box.width, bottom: box.top + box.height, x: box.left, y: box.top, toJSON: () => box }) as DOMRect
  return node
}

beforeEach(() => {
  worldStore.setState({ world: sample, ready: true })
  routeStore.setState({ route: { ...HOME, view: 'console', session: billing.id }, recent: [] })
  runtimeStore.setState({ runtime: null })
  host = document.body.appendChild(document.createElement('div'))
})
afterEach(() => {
  closeMenu()
  host.remove()
  runtimeStore.setState({ runtime: null })
})

describe('a right-click', () => {
  test('on what draws a session opens that session’s menu at the pointer, and holds the webview’s own back', () => {
    const entry = host.appendChild(el('button', drawsSession(bundle.id), el('span')))
    expect(rightClick(entry.firstElementChild!, { x: 120, y: 340 })).toEqual({ took: true, held: true })
    expect(opened()).toMatchObject({ target: { kind: 'session', id: bundle.id }, place: { x: 120, y: 340 } })
  })

  test('opens the menu of the nearest thing drawn: a child inside its parent’s entry is the child', () => {
    const kid = el('button', drawsSession(tenant.id))
    host.appendChild(el('article', drawsSession(billing.id), kid))
    rightClick(kid, { x: 5, y: 5 })
    expect(opened()?.target).toEqual({ kind: 'session', id: tenant.id })
  })

  test('on a project’s name opens the project’s menu; on a held terminal, the terminal’s', () => {
    rightClick(host.appendChild(el('h2', drawsProject('lumen-web'))), { x: 9, y: 9 })
    expect(opened()?.target).toEqual({ kind: 'project', name: 'lumen-web' })
    runtimeStore.setState({ runtime: { canHost: () => false, Terminal: () => null, hosted: () => [shell], subscribe: () => () => {}, focus: () => false } })
    rightClick(host.appendChild(el('button', drawsTerminal('tab-7'))), { x: 9, y: 9 })
    expect(opened()?.target).toEqual({ kind: 'terminal', id: 'tab-7' })
  })

  test('never over a live terminal’s own area: that right-click is the terminal’s', () => {
    const term = el('div', { class: 'xterm' }, el('canvas'))
    const live = el('div', { 'data-live-terminal': bundle.id })
    host.appendChild(el('section', drawsSession(bundle.id), term, live))
    expect(rightClick(term.firstElementChild!, { x: 9, y: 9 })).toEqual({ took: false, held: false })
    expect(rightClick(live, { x: 9, y: 9 })).toEqual({ took: false, held: false })
    expect(opened()).toBeNull()
  })

  test('nor in a text field, which keeps cut, copy and paste', () => {
    const field = el('textarea')
    host.appendChild(el('article', drawsSession(bundle.id), field))
    expect(rightClick(field, { x: 9, y: 9 })).toEqual({ took: false, held: false })
    expect(opened()).toBeNull()
  })

  test('on nothing that is drawn it does nothing, and the event is whoever’s it was', () => {
    expect(rightClick(host.appendChild(el('div')), { x: 9, y: 9 })).toEqual({ took: false, held: false })
    expect(opened()).toBeNull()
  })

  test('on a session that is not in the world nothing opens', () => {
    expect(rightClick(host.appendChild(el('button', drawsSession('gone'))), { x: 9, y: 9 })).toEqual({ took: false, held: false })
    expect(rightClick(host.appendChild(el('text', drawsProject('–'))), { x: 9, y: 9 })).toEqual({ took: false, held: false })
    expect(opened()).toBeNull()
  })

  test('one that somebody already took is left alone', () => {
    const entry = host.appendChild(el('button', drawsSession(bundle.id)))
    const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 4, clientY: 4 })
    Object.defineProperty(e, 'target', { value: entry })
    e.preventDefault()
    expect(contextMenu(e)).toBe(false)
    expect(opened()).toBeNull()
  })

  test('on the menu itself only the webview’s own menu is held back', () => {
    openOn({ kind: 'session', id: bundle.id }, { x: 1, y: 1 })
    const was = opened()
    const inside = host.appendChild(el('div', { 'data-menu-root': '' }, el('div', drawsSession(tenant.id))))
    expect(rightClick(inside.firstElementChild!, { x: 9, y: 9 })).toEqual({ took: false, held: true })
    expect(opened()).toBe(was)
  })

  test('the keyboard’s own menu key arrives with no pointer: the menu stands against what was in focus', () => {
    const entry = boxed(host.appendChild(el('button', drawsSession(bundle.id))), { left: 10, top: 200, width: 300, height: 60 })
    rightClick(entry)
    expect(opened()?.place).toEqual({ box: { left: 10, top: 200, right: 310, bottom: 260 } })
  })

  test('a view that knows whose line was clicked says so (a line drawn on a canvas carries no mark)', () => {
    const canvas = host.appendChild(el('canvas'))
    expect(rightClick(canvas, { x: 500, y: 300 }, { kind: 'session', id: tenant.id }).took).toBe(true)
    expect(opened()).toMatchObject({ target: { kind: 'session', id: tenant.id }, place: { x: 500, y: 300 } })
  })

  test('a short id on the mark opens the whole session', () => {
    rightClick(host.appendChild(el('button', drawsSession(bundle.short))), { x: 2, y: 2 })
    expect(opened()?.target).toEqual({ kind: 'session', id: bundle.id })
  })
})

describe('what an element draws', () => {
  test('is read from the element or from what it is inside', () => {
    const inner = el('span')
    const entry = host.appendChild(el('button', drawsSession(bundle.id), inner))
    expect(drawnAt(inner)).toEqual({ target: { kind: 'session', id: bundle.id }, el: entry })
    expect(drawnAt(host)).toBeNull()
    expect(drawnAt(null)).toBeNull()
  })
})

describe('by key', () => {
  test('`M`: the selected session’s menu, standing against where it is drawn', () => {
    const entry = boxed(host.appendChild(el('button', drawsSession(billing.id))), { left: 0, top: 300, width: 400, height: 80 })
    expect(menuByKey(host, 'session')).toBe(true)
    expect(opened()).toMatchObject({ target: { kind: 'session', id: billing.id }, place: { box: { left: 0, top: 300, right: 400, bottom: 380 } } })
    void entry
  })

  test('what is in focus comes before the selection', () => {
    const entry = boxed(host.appendChild(el('button', drawsSession(bundle.id))), { left: 0, top: 100, width: 400, height: 40 })
    entry.focus()
    expect(menuByKey(host, 'session')).toBe(true)
    expect(opened()).toMatchObject({ target: { kind: 'session', id: bundle.id }, place: { box: { left: 0, top: 100, right: 400, bottom: 140 } } })
  })

  test('with nothing selected and nothing in focus the key is not spent', () => {
    routeStore.setState({ route: { ...HOME, session: null }, recent: [] })
    expect(menuByKey(host, 'session')).toBe(false)
    expect(menuByKey(host, 'project')).toBe(false)
    expect(opened()).toBeNull()
  })

  test('a selection that is not in the world opens nothing', () => {
    routeStore.setState({ route: { ...HOME, session: 'gone' }, recent: [] })
    expect(menuByKey(host, 'session')).toBe(false)
  })

  test('a session drawn nowhere in sight still has its menu, in the middle of the window', () => {
    expect(menuByKey(host, 'session')).toBe(true)
    expect(opened()).toMatchObject({ target: { kind: 'session', id: billing.id }, place: { x: Math.round(window.innerWidth / 2), y: Math.round(window.innerHeight / 3) } })
  })

  test('Shift+`M`: the menu of the selected session’s project, against the project’s name where the view draws it', () => {
    boxed(host.appendChild(el('button', drawsSession(billing.id))), { left: 0, top: 300, width: 400, height: 80 })
    expect(menuByKey(host, 'project')).toBe(true)
    expect(opened()).toMatchObject({ target: { kind: 'project', name: 'atlas-api' }, place: { box: { top: 300 } } })
    closeMenu()
    boxed(host.appendChild(el('h2', drawsProject('atlas-api'))), { left: 0, top: 40, width: 400, height: 20 })
    expect(menuByKey(host, 'project')).toBe(true)
    expect(opened()?.place).toEqual({ box: { left: 0, top: 40, right: 400, bottom: 60 } })
  })

  test('a project’s name in focus is the project’s menu for both keys', () => {
    const head = host.appendChild(el('h2', { ...drawsProject('tessera'), tabindex: '0' }))
    head.focus()
    expect(menuByKey(host, 'session')).toBe(true)
    expect(opened()?.target).toEqual({ kind: 'project', name: 'tessera' })
    closeMenu()
    head.focus()
    expect(menuByKey(host, 'project')).toBe(true)
    expect(opened()?.target).toEqual({ kind: 'project', name: 'tessera' })
  })

  test('a session with no project has no project menu', () => {
    const world = { ...sample, sessions: sample.sessions.map((s) => (s.id === billing.id ? { ...s, project: null } : s)) }
    worldStore.setState({ world, ready: true })
    expect(menuByKey(host, 'project')).toBe(false)
    expect(opened()).toBeNull()
  })

  test('a held terminal on stage has its own menu, and no project’s', () => {
    routeStore.setState({ route: { ...HOME, view: 'console', session: 'tab-7' }, recent: [] })
    expect(menuByKey(host, 'session', [])).toBe(false)
    expect(menuByKey(host, 'project', [shell])).toBe(false)
    expect(menuByKey(host, 'session', [shell])).toBe(true)
    expect(opened()?.target).toEqual({ kind: 'terminal', id: 'tab-7' })
  })
})

describe('where a session is drawn', () => {
  const at = (top: number) => ({ left: 10, top, width: 200, height: 40 })

  test('the drawing in sight comes before one that is not', () => {
    boxed(host.appendChild(el('button', drawsSession(bundle.id))), at(-500))
    const seen = boxed(host.appendChild(el('button', drawsSession(bundle.id))), at(100))
    expect(drawingOf(host, { kind: 'session', id: bundle.id })).toBe(seen)
  })

  test('a view that is leaving, or inert, is not where it is drawn', () => {
    const leaving = el('div', { 'data-leaving': 'true' }, boxed(el('button', drawsSession(bundle.id)), at(50)))
    const inert = el('div', { inert: '' }, boxed(el('button', drawsSession(bundle.id)), at(60)))
    const shown = boxed(el('button', drawsSession(bundle.id)), at(300))
    host.append(leaving, inert, shown)
    expect(drawingOf(host, { kind: 'session', id: bundle.id })).toBe(shown)
  })

  test('with the keys on the stage, the stage’s drawing is the one', () => {
    const roster = boxed(el('button', drawsSession(bundle.id)), at(50))
    const head = boxed(el('header', drawsSession(bundle.id)), at(90))
    const term = el('textarea')
    const stage = el('section', { 'data-stage': '' }, head, term)
    host.append(roster, stage)
    expect(drawingOf(host, { kind: 'session', id: bundle.id })).toBe(roster)
    term.focus()
    expect(drawingOf(host, { kind: 'session', id: bundle.id })).toBe(head)
  })

  test('nothing is found for what is not drawn, and another session’s drawing is not it', () => {
    host.appendChild(boxed(el('button', drawsSession(tenant.id)), at(50)))
    expect(drawingOf(host, { kind: 'session', id: bundle.id })).toBeNull()
    expect(drawingOf(null, { kind: 'session', id: bundle.id })).toBeNull()
  })

  test('where nothing has a size yet, the first drawing serves', () => {
    const first = host.appendChild(el('button', drawsSession(bundle.id)))
    host.appendChild(el('button', drawsSession(bundle.id)))
    expect(drawingOf(host, { kind: 'session', id: bundle.id })).toBe(first)
  })
})

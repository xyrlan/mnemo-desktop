import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { lineStore, resetLine } from '../command/line'
import { orbitStore, resetOrbit, setOrbit } from '../orbit/state'
import { actions, setActions, type Actions } from '../world/actions'
import { HOME, routeStore, type Route } from '../world/route'
import { sampleActions, sampleWorld } from '../world/sample'
import { pendingOf, worldStore } from '../world/store'
import type { Session } from '../world/types'
import { EDGE, Menu, placeMenu } from './Menu'
import { closeMenu, menuStore, openMenu } from './state'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLElement
let said: string[]
let undo: () => void
let copied: string[]

const world = () => worldStore.getState().world
const route = () => routeStore.getState().route
const titled = (start: string): Session => world().sessions.find((s) => s.title.startsWith(start))!
const menu = () => host.querySelector<HTMLElement>('[data-menu-root]')
const list = () => host.querySelector<HTMLElement>('[role="menu"]')!
const row = (id: string) => host.querySelector<HTMLElement>(`[data-menu-item="${id}"]`)!
const rows = () => [...host.querySelectorAll<HTMLElement>('[data-menu-item]')].map((el) => el.dataset.menuItem)
const inHand = () => host.querySelector<HTMLElement>('[data-menu-item][data-hand]')?.dataset.menuItem ?? null
const field = () => host.querySelector<HTMLInputElement>('.menu-type input')
const refusal = () => host.querySelector<HTMLElement>('[role="status"]')?.textContent ?? null
const footSays = () => lineStore.getState().said

/** A key pressed in the menu. False when the menu took it. */
async function key(k: string, more: KeyboardEventInit = {}, target: EventTarget = list()): Promise<boolean> {
  let free = true
  await act(async () => {
    free = target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...more }))
  })
  return free
}
const click = (el: Element) => act(async () => void (el as HTMLElement).click())

async function open(s: Session, at: { x: number; y: number } = { x: 40, y: 40 }) {
  await act(async () => openMenu({ kind: 'session', id: s.id }, at))
}
async function openProject(name: string) {
  await act(async () => openMenu({ kind: 'project', name }, { x: 40, y: 40 }))
}

/** Types into the menu's line as React hears it. */
async function type(text: string) {
  const el = field()!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, text)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

beforeEach(async () => {
  worldStore.setState({ world: sampleWorld(), ready: true })
  said = []
  undo = setActions(sampleActions(world, worldStore.getState().set, said))
  routeStore.setState({ route: { ...HOME, view: 'console', session: titled('Idempotent retries').id }, recent: [] })
  resetLine()
  resetOrbit()
  copied = []
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => void copied.push(text) } })
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  await act(async () => root.render(<Menu />))
})

afterEach(async () => {
  await act(async () => closeMenu())
  await act(async () => root.unmount())
  host.remove()
  undo()
})

/** The sample's actions with some of them answering otherwise. */
const withActions = (patch: Partial<Actions>) => {
  const back = setActions({ ...actions(), ...patch })
  const all = undo
  undo = () => {
    back()
    all()
  }
}

describe('opening it', () => {
  test('there is no menu until one is asked for', () => {
    expect(menu()).toBeNull()
  })

  test('it says whose it is, and lists what applies to that session', async () => {
    await open(titled('Why is the bundle'))
    expect(menu()?.querySelector('.menu-title')?.textContent).toBe('Why is the bundle 40% bigger')
    expect(menu()?.querySelector('.menu-sub')?.textContent).toContain('lumen-web')
    expect(rows()).toEqual(['open', 'close', 'changes', 'new-session', 'new-shell', 'copy', 'folder'])
  })

  test('it changes neither the selection nor the stage', async () => {
    const before = route()
    await open(titled('Why is the bundle'))
    await key('ArrowDown')
    await key('ArrowDown')
    expect(route()).toEqual(before)
    expect(said).toEqual([])
  })

  test('one menu at a time: opening another replaces the first, and takes nothing of it along', async () => {
    await open(titled('Why is the bundle'))
    await key('c')
    await key('Enter')
    expect(row('close').hasAttribute('data-asked')).toBe(true)
    // on another session that has the same item: the question does not travel
    await open(titled('Order status history'))
    expect(host.querySelectorAll('[data-menu-root]').length).toBe(1)
    expect(menu()?.querySelector('.menu-title')?.textContent).toBe('Order status history column')
    expect(rows()).toContain('close')
    expect(host.querySelector('[data-asked]')).toBeNull()
    expect(inHand()).toBe('open')
  })

  test('it takes the keys when it opens, and gives them back to where they were when it closes', async () => {
    const before = document.body.appendChild(document.createElement('button'))
    before.focus()
    await open(titled('Why is the bundle'))
    expect(document.activeElement).toBe(list())
    await key('Escape')
    expect(menu()).toBeNull()
    expect(document.activeElement).toBe(before)
    before.remove()
  })

  test('a project’s menu holds the project’s four', async () => {
    await openProject('lumen-web')
    expect(menu()?.querySelector('.menu-title')?.textContent).toBe('lumen-web')
    expect(rows()).toEqual(['new-session', 'new-shell', 'dispatch', 'projects'])
  })
})

describe('its keys', () => {
  test('the first item that can be chosen is in hand; down and up walk, and wrap', async () => {
    await open(titled('Why is the bundle'))
    expect(inHand()).toBe('open')
    await key('ArrowDown')
    expect(inHand()).toBe('close')
    await key('ArrowUp')
    await key('ArrowUp')
    expect(inHand()).toBe('folder')
    await key('ArrowDown')
    expect(inHand()).toBe('open')
  })

  test('an item that is switched off is passed over, and cannot be chosen', async () => {
    const s = titled('Empty state for the orders table')
    await open(s)
    expect(row('merge').getAttribute('aria-disabled')).toBe('true')
    expect(row('merge').textContent).toContain('checks still running')
    await key('ArrowDown') // answer
    await key('ArrowDown') // changes
    await key('ArrowDown') // pr
    await key('ArrowDown')
    expect(inHand()).toBe('new-session')
    await click(row('merge'))
    // not even asked about: it cannot be chosen
    expect(row('merge').hasAttribute('data-asked')).toBe(false)
    await click(row('merge'))
    expect(said).toEqual([])
    expect(menu()).not.toBeNull()
  })

  test('Home and End go to the ends; Tab walks as the arrows do', async () => {
    await open(titled('Why is the bundle'))
    await key('End')
    expect(inHand()).toBe('folder')
    await key('Home')
    expect(inHand()).toBe('open')
    await key('Tab')
    expect(inHand()).toBe('close')
    await key('Tab', { shiftKey: true })
    expect(inHand()).toBe('open')
  })

  test('Enter chooses the item in hand: Open on stage puts that session on stage and the menu is gone', async () => {
    const s = titled('Why is the bundle')
    await open(s)
    await key('Enter')
    expect(route()).toMatchObject({ view: 'console', session: s.id })
    expect(menu()).toBeNull()
  })

  test('a first letter several items share walks among them; one only one item has chooses it', async () => {
    const s = titled('Why is the bundle')
    await open(s)
    await key('c')
    expect(inHand()).toBe('close')
    await key('c')
    expect(inHand()).toBe('changes')
    await key('C')
    expect(inHand()).toBe('copy')
    await key('c')
    expect(inHand()).toBe('close')
    expect(said).toEqual([])
    expect(route().panel).toBeNull()
    // `N` is two items here: it walks. On a child, `S` is Stop alone: it chooses, which asks.
    await key('n')
    expect(inHand()).toBe('new-session')
    expect(said).toEqual([])
    await open(titled('Tenant in every cache key'))
    await key('s')
    expect(row('stop').hasAttribute('data-asked')).toBe(true)
    expect(said).toEqual([])
  })

  test('with ⌥ held the physical key names the letter', async () => {
    await open(titled('Tenant in every cache key'))
    await key('ß', { altKey: true, code: 'KeyS' })
    expect(row('stop').hasAttribute('data-asked')).toBe(true)
  })

  test('nothing under the menu hears its keys, and they do nothing else', async () => {
    const heard: string[] = []
    const hear = (e: KeyboardEvent) => void heard.push(e.key)
    window.addEventListener('keydown', hear)
    await open(titled('Why is the bundle'))
    for (const k of ['ArrowDown', 'n', '1', 'q', 'x', 'ArrowLeft']) expect(await key(k)).toBe(false)
    window.removeEventListener('keydown', hear)
    expect(heard).toEqual([])
  })

  test('the app’s own chords pass through it', async () => {
    const heard: string[] = []
    const hear = (e: KeyboardEvent) => void heard.push(e.key)
    window.addEventListener('keydown', hear)
    await open(titled('Why is the bundle'))
    expect(await key('w', { ctrlKey: true, shiftKey: true })).toBe(true)
    expect(await key('e', { metaKey: true })).toBe(true)
    window.removeEventListener('keydown', hear)
    expect(heard).toEqual(['w', 'e'])
    expect(inHand()).toBe('open')
  })

  test('the mouse puts an item in hand and chooses it, without taking the keys from the list', async () => {
    const s = titled('Why is the bundle')
    await open(s)
    await act(async () => void row('changes').dispatchEvent(new MouseEvent('pointermove', { bubbles: true })))
    expect(inHand()).toBe('changes')
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    row('changes').dispatchEvent(down)
    expect(down.defaultPrevented).toBe(true)
    await click(row('changes'))
    expect(route()).toMatchObject({ panel: 'changes', session: s.id })
  })
})

describe('what ends something is asked once, on the same item', () => {
  test('the first choosing only asks; the second closes that session, once, and the foot says so', async () => {
    const s = titled('Why is the bundle')
    await open(s)
    await key('ArrowDown')
    expect(row('close').textContent).toContain('Close session')
    await key('Enter')
    expect(said).toEqual([])
    expect(row('close').textContent).toContain('Close it, and end what runs in it?')
    await key('Enter')
    expect(said).toEqual([`close ${s.id}`])
    expect(titled('Why is the bundle').state).toBe('ended')
    expect(menu()).toBeNull()
    expect(footSays()).toEqual({ text: 'Closed', ok: true })
  })

  test('looking away takes the question back', async () => {
    await open(titled('Why is the bundle'))
    await key('ArrowDown')
    await key('Enter')
    await key('ArrowDown')
    await key('ArrowUp')
    expect(row('close').hasAttribute('data-asked')).toBe(false)
    await key('Enter')
    expect(said).toEqual([])
    expect(row('close').hasAttribute('data-asked')).toBe(true)
  })

  test('Esc takes the question back first, and only then closes the menu', async () => {
    await open(titled('Why is the bundle'))
    await key('ArrowDown')
    await key('Enter')
    await key('Escape')
    expect(menu()).not.toBeNull()
    expect(row('close').hasAttribute('data-asked')).toBe(false)
    await key('Escape')
    expect(menu()).toBeNull()
    expect(said).toEqual([])
  })

  test('a key held down does not answer the question it just asked', async () => {
    await open(titled('Tenant in every cache key'))
    await key('s')
    await key('s', { repeat: true })
    await key('Enter', { repeat: true })
    await key(' ', { repeat: true })
    expect(said).toEqual([])
    await key('s')
    expect(said).toEqual([`stop ${titled('Tenant in every cache key').id}`])
  })

  test('with the mouse it is the same: a click asks, the second does it', async () => {
    const s = titled('Tenant in every cache key')
    await open(s)
    await click(row('stop'))
    expect(said).toEqual([])
    await click(row('stop'))
    expect(said).toEqual([`stop ${s.id}`])
  })

  test('Merge is asked once, then answers its merge card with the card’s first choice', async () => {
    const s = titled('Cursor pagination')
    const card = pendingOf(world(), s.id).find((p) => p.kind === 'merge')!
    await open(s)
    await click(row('merge'))
    expect(row('merge').textContent).toContain('Merge #412?')
    expect(said).toEqual([])
    await click(row('merge'))
    expect(said).toEqual([`answer ${card.id} ${card.choices[0].key}`])
    expect(pendingOf(world(), s.id)).toEqual([])
    expect(menu()).toBeNull()
  })

  test('what only goes somewhere is not asked about', async () => {
    const s = titled('Why is the bundle')
    await open(s)
    await click(row('new-session'))
    expect(said).toEqual([`new ${s.root}`])
  })
})

describe('a refusal', () => {
  test('is said in the menu, in the words the action gave, under the item, and the menu stays', async () => {
    withActions({ stop: async () => ({ ok: false, why: 'Not stopped: it is in the middle of a commit.' }) })
    await open(titled('Tenant in every cache key'))
    await click(row('stop'))
    await click(row('stop'))
    expect(menu()).not.toBeNull()
    expect(refusal()).toContain('Not stopped: it is in the middle of a commit.')
    expect(host.querySelector('[data-menu-refused]')?.getAttribute('data-menu-refused')).toBe('stop')
    // the question is taken back with it: choosing again asks again
    expect(row('stop').hasAttribute('data-asked')).toBe(false)
    expect(footSays()).toBeNull()
  })

  test('an action that throws is a refusal too', async () => {
    withActions({
      close: async () => {
        throw new Error('the core is not answering')
      },
    })
    await open(titled('Why is the bundle'))
    await click(row('close'))
    await click(row('close'))
    expect(refusal()).toContain('the core is not answering')
    expect(menu()).not.toBeNull()
  })

  test('it goes when he looks at another item', async () => {
    withActions({ stop: async () => ({ ok: false, why: 'no' }) })
    await open(titled('Tenant in every cache key'))
    await click(row('stop'))
    await click(row('stop'))
    await key('ArrowDown')
    expect(refusal()).toBeNull()
  })

  test('one that comes back after the menu was closed is said at the foot instead', async () => {
    let answer: (o: { ok: false; why: string }) => void = () => {}
    withActions({ close: () => new Promise((resolve) => (answer = resolve)) })
    await open(titled('Why is the bundle'))
    await click(row('close'))
    await click(row('close'))
    // while it is on its way the menu takes nothing more
    expect(row('close').hasAttribute('data-busy')).toBe(true)
    await key('ArrowDown')
    expect(inHand()).toBe('close')
    await key('Escape')
    expect(menu()).not.toBeNull()
    // he clicks elsewhere: the menu goes; then the refusal arrives
    await act(async () => void document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })))
    expect(menu()).toBeNull()
    await act(async () => answer({ ok: false, why: 'It runs in another terminal.' }))
    expect(footSays()).toEqual({ text: 'It runs in another terminal.', ok: false })
  })
})

describe('Message…: a line typed in the menu', () => {
  test('the letter opens the line; Enter sends it to that child’s inbox, and the foot says so', async () => {
    const s = titled('Tenant in every cache key')
    await open(s)
    await key('m')
    expect(field()).not.toBeNull()
    expect(document.activeElement).toBe(field())
    await type('keep the old key readable')
    await key('Enter', {}, field()!)
    expect(said).toEqual([`message ${s.id} keep the old key readable`])
    expect(menu()).toBeNull()
    expect(footSays()).toEqual({ text: 'Message', ok: true })
  })

  test('an empty line sends nothing', async () => {
    await open(titled('Tenant in every cache key'))
    await key('m')
    await key('Enter', {}, field()!)
    await type('   ')
    await key('Enter', {}, field()!)
    expect(said).toEqual([])
    expect(menu()).not.toBeNull()
  })

  test('what is typed is typed: a letter in the line chooses nothing', async () => {
    await open(titled('Tenant in every cache key'))
    await key('m')
    expect(await key('s', {}, field()!)).toBe(true)
    expect(await key('ArrowDown', {}, field()!)).toBe(true)
    expect(host.querySelector('[data-asked]')).toBeNull()
    expect(inHand()).toBe('message')
  })

  test('Esc leaves the line and keeps the menu, with the keys back on the list; the next Esc closes it', async () => {
    await open(titled('Tenant in every cache key'))
    await key('m')
    await type('half a thought')
    expect(await key('Escape', {}, field()!)).toBe(false)
    expect(field()).toBeNull()
    expect(menu()).not.toBeNull()
    expect(document.activeElement).toBe(list())
    // the line is kept for when he comes back to it
    await key('m')
    expect(field()?.value).toBe('half a thought')
    await key('Escape', {}, field()!)
    await key('Escape')
    expect(menu()).toBeNull()
  })

  test('a refusal leaves the line as it was typed', async () => {
    withActions({ message: async () => ({ ok: false, why: 'It is out of reach.' }) })
    await open(titled('Tenant in every cache key'))
    await key('m')
    await type('are you there')
    await key('Enter', {}, field()!)
    expect(refusal()).toContain('It is out of reach.')
    expect(field()?.value).toBe('are you there')
  })
})

describe('Copy: a row of three', () => {
  test('Enter copies the id; right moves to the resume line, then the folder, and round', async () => {
    const s = titled('Why is the bundle')
    await open(s)
    await key('End')
    await key('ArrowUp')
    expect(inHand()).toBe('copy')
    await key('Enter')
    expect(copied).toEqual([s.id])
    expect(footSays()).toEqual({ text: 'Copied · its id', ok: true })
    expect(menu()).toBeNull()

    await open(s)
    await key('End')
    await key('ArrowUp')
    await key('ArrowRight')
    await key('Enter')
    expect(copied[1]).toBe(`claude --resume ${s.id}`)
    expect(footSays()?.text).toBe(`Copied · claude --resume ${s.id}`)

    await open(s)
    await key('End')
    await key('ArrowUp')
    await key('ArrowLeft')
    await key('Enter')
    expect(copied[2]).toBe(s.cwd)
    expect(footSays()?.text).toBe('Copied · its folder')
  })

  test('each of the three can be clicked', async () => {
    const s = titled('Why is the bundle')
    await open(s)
    await click(host.querySelector('[data-menu-part="resume"]')!)
    expect(copied).toEqual([`claude --resume ${s.id}`])
  })

  test('a clipboard that refuses is a refusal, said in the menu', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => Promise.reject(new Error('denied')) } })
    ;(document as { execCommand?: unknown }).execCommand = () => false
    await open(titled('Why is the bundle'))
    await click(host.querySelector('[data-menu-part="id"]')!)
    expect(refusal()).toContain('The clipboard refused it.')
    expect(menu()).not.toBeNull()
    delete (document as { execCommand?: unknown }).execCommand
  })
})

describe('what the other items do', () => {
  test('Answer… opens its card where the session is drawn: the view stays, at now', async () => {
    const s = titled('Webhook signature check')
    const card = pendingOf(world(), s.id)[0]
    routeStore.setState({ route: { ...route(), view: 'score', at: 1234, panel: 'memory' } })
    await open(s)
    await click(row('answer'))
    expect(route()).toMatchObject({ view: 'score', session: s.id, pending: card.id, at: null, panel: null })
    expect(menu()).toBeNull()
  })

  test('in Orbit, going to a session takes the cursor off the centre', async () => {
    const s = titled('Webhook signature check')
    routeStore.setState({ route: { ...route(), view: 'orbit' } })
    setOrbit({ core: true, vault: true })
    await open(s)
    await click(row('answer'))
    expect(orbitStore.getState()).toMatchObject({ core: false, vault: false })
    // elsewhere Orbit's own state is left alone
    routeStore.setState({ route: { ...route(), view: 'console' } })
    setOrbit({ core: true })
    await open(s)
    await click(row('answer'))
    expect(orbitStore.getState().core).toBe(true)
  })

  test('Changes opens the Changes panel for that session, and leaves another session’s card behind', async () => {
    const other = titled('Order status history')
    routeStore.setState({ route: { ...route(), session: other.id, pending: pendingOf(world(), other.id)[0].id } })
    const s = titled('Why is the bundle')
    await open(s)
    await click(row('changes'))
    expect(route()).toMatchObject({ panel: 'changes', session: s.id, pending: null })
  })

  test('Changes on the session already selected keeps its open card', async () => {
    const s = titled('Order status history')
    const card = pendingOf(world(), s.id)[0].id
    routeStore.setState({ route: { ...route(), session: s.id, pending: card } })
    await open(s)
    await click(row('changes'))
    expect(route()).toMatchObject({ panel: 'changes', session: s.id, pending: card })
  })

  test('Open pull request and Open folder open outside the app', async () => {
    const s = titled('Cursor pagination')
    await open(s)
    await click(row('pr'))
    await open(s)
    await click(row('folder'))
    expect(said).toEqual([`external ${s.prs[0].url}`, `external ${s.cwd}`])
    expect(footSays()).toBeNull()
  })

  test('New session and New shell start in the session’s project, and the foot says what the action added', async () => {
    const s = titled('Why is the bundle')
    await open(s)
    await click(row('new-session'))
    await open(s)
    await click(row('new-shell'))
    expect(said).toEqual([`new ${s.root}`, `shell ${s.root}`])
    expect(footSays()).toEqual({ text: 'New shell in lumen-web · The sample world starts no shell.', ok: true })
  })

  test('Resume here opens the session, then puts it on stage; refused, it stays where it was', async () => {
    const s = titled('Notes for the 2.5')
    worldStore.getState().set({ ...world(), sessions: world().sessions.map((x) => (x.id === s.id ? { ...x, state: 'ended', live: false, hosted: false } : x)) })
    await open(s)
    await click(row('resume'))
    expect(said).toEqual([`open ${s.id}`])
    expect(route()).toMatchObject({ view: 'console', session: s.id })

    routeStore.setState({ route: { ...route(), view: 'orbit', session: null } })
    withActions({ open: async () => ({ ok: false, why: 'Its folder is gone.' }) })
    await open(s)
    await click(row('resume'))
    expect(route()).toMatchObject({ view: 'orbit', session: null })
    expect(refusal()).toContain('Its folder is gone.')
  })

  test('a project’s items: a session and a shell there, the Missions panel, the Projects panel', async () => {
    const lumen = world().projects.find((p) => p.name === 'lumen-web')!
    await openProject('lumen-web')
    await key('Enter')
    await openProject('lumen-web')
    await key('ArrowDown')
    await key('Enter')
    expect(said).toEqual([`new ${lumen.root}`, `shell ${lumen.root}`])
    await openProject('lumen-web')
    await key('d')
    expect(route().panel).toBe('missions')
    await openProject('lumen-web')
    await key('p')
    expect(route().panel).toBe('projects')
    expect(menu()).toBeNull()
  })
})

describe('Dispatch… on a project', () => {
  const frames = (n: number) => act(async () => void (await new Promise((done) => setTimeout(done, n * 20))))

  test('brings that project’s part of the Missions panel into sight, once the panel has drawn it', async () => {
    const lumen = world().projects.find((p) => p.name === 'lumen-web')!
    const seen: string[] = []
    const panel = document.body.appendChild(document.createElement('aside'))
    panel.setAttribute('data-panel', 'missions')
    const part = (root: string) => {
      const el = panel.appendChild(document.createElement('section'))
      el.setAttribute('data-root', root)
      el.scrollIntoView = () => void seen.push(root)
    }
    part('/Users/you/work/another')
    await openProject('lumen-web')
    await key('d')
    await frames(3)
    // the panel had not drawn it yet: nothing was scrolled, and it is still looked for
    expect(seen).toEqual([])
    part(lumen.root!)
    await frames(3)
    expect(seen).toEqual([lumen.root])
    // found once, it is left alone
    await frames(3)
    expect(seen).toEqual([lumen.root])
    panel.remove()
  })

  test('asked for again, the search before it ends: the part is brought into sight once', async () => {
    const lumen = world().projects.find((p) => p.name === 'lumen-web')!
    const seen: string[] = []
    await openProject('lumen-web')
    await key('d')
    await openProject('lumen-web')
    await key('d')
    const panel = document.body.appendChild(document.createElement('aside'))
    panel.setAttribute('data-panel', 'missions')
    const el = panel.appendChild(document.createElement('section'))
    el.setAttribute('data-root', lumen.root!)
    el.scrollIntoView = () => void seen.push(lumen.root!)
    await frames(3)
    expect(seen).toEqual([lumen.root])
    panel.remove()
  })

  test('a Missions panel that was closed meanwhile is not looked into', async () => {
    const lumen = world().projects.find((p) => p.name === 'lumen-web')!
    const seen: string[] = []
    await openProject('lumen-web')
    await key('d')
    await act(async () => routeStore.getState().go({ panel: null }))
    const panel = document.body.appendChild(document.createElement('aside'))
    panel.setAttribute('data-panel', 'missions')
    const el = panel.appendChild(document.createElement('section'))
    el.setAttribute('data-root', lumen.root!)
    el.scrollIntoView = () => void seen.push(lumen.root!)
    await frames(3)
    expect(seen).toEqual([])
    panel.remove()
  })
})

describe('when it closes', () => {
  test('on a click elsewhere, and not on a click inside it', async () => {
    await open(titled('Why is the bundle'))
    await act(async () => void menu()!.querySelector('.menu-head')!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })))
    expect(menu()).not.toBeNull()
    await act(async () => void document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })))
    expect(menu()).toBeNull()
  })

  test('the keys do not go back to where they were when something else took them meanwhile', async () => {
    const before = document.body.appendChild(document.createElement('button'))
    const panel = document.body.appendChild(document.createElement('input'))
    before.focus()
    await open(titled('Why is the bundle'))
    // as a panel does when an item opens it
    await act(async () => panel.focus())
    await act(async () => closeMenu())
    expect(document.activeElement).toBe(panel)
    before.remove()
    panel.remove()
  })

  test('on a turn of the wheel elsewhere, and when the window changes size', async () => {
    await open(titled('Why is the bundle'))
    await act(async () => void document.body.dispatchEvent(new Event('wheel', { bubbles: true })))
    expect(menu()).toBeNull()
    await open(titled('Why is the bundle'))
    await act(async () => void window.dispatchEvent(new Event('resize')))
    expect(menu()).toBeNull()
  })

  test('on a change of view', async () => {
    await open(titled('Why is the bundle'))
    await act(async () => routeStore.getState().go({ view: 'score' }))
    expect(menu()).toBeNull()
  })

  test('not when the selection moves, or a panel opens, under it', async () => {
    await open(titled('Why is the bundle'))
    await act(async () => routeStore.getState().go({ session: titled('Order status history').id, panel: 'memory' } as Partial<Route>))
    expect(menu()).not.toBeNull()
  })

  test('when its session leaves the world', async () => {
    const s = titled('Why is the bundle')
    await open(s)
    await act(async () => worldStore.getState().set({ ...world(), sessions: world().sessions.filter((x) => x.id !== s.id) }))
    expect(menu()).toBeNull()
    expect(menuStore.getState().open).toBeNull()
  })

  test('it follows the world while it is open: an item that stops applying goes', async () => {
    const s = titled('Tenant in every cache key')
    await open(s)
    expect(rows()).toContain('stop')
    await act(async () => worldStore.getState().set({ ...world(), sessions: world().sessions.map((x) => (x.id === s.id ? { ...x, state: 'ended', live: false } : x)) }))
    expect(rows()).not.toContain('stop')
    expect(menu()).not.toBeNull()
  })
})

describe('it never leaves the window’s edges', () => {
  const room = { w: 1000, h: 700 }
  const size = { w: 300, h: 400 }
  const inside = (at: { left: number; top: number }) => at.left >= EDGE && at.top >= EDGE && at.left + size.w <= room.w - EDGE && at.top + size.h <= room.h - EDGE

  test('at the pointer it opens down and to the right', () => {
    expect(placeMenu({ x: 100, y: 120 }, size, room)).toEqual({ left: 100, top: 120 })
  })

  test('near the right edge it opens to the left of the pointer, near the foot upward', () => {
    expect(placeMenu({ x: 900, y: 120 }, size, room)).toEqual({ left: 600, top: 120 })
    expect(placeMenu({ x: 100, y: 600 }, size, room)).toEqual({ left: 100, top: 200 })
    expect(placeMenu({ x: 995, y: 695 }, size, room)).toEqual({ left: 692, top: 292 })
  })

  test('wherever it is asked for, all of it is inside', () => {
    for (const x of [-50, 0, 3, 150, 500, 850, 997, 1000, 1200])
      for (const y of [-50, 0, 3, 150, 350, 550, 697, 700, 900]) {
        expect(inside(placeMenu({ x, y }, size, room))).toBe(true)
        expect(inside(placeMenu({ box: { left: x, top: y, right: x + 200, bottom: y + 40 } }, size, room))).toBe(true)
      }
  })

  test('against an element it stands under it, or over it where there is no room under', () => {
    expect(placeMenu({ box: { left: 40, top: 100, right: 440, bottom: 160 } }, size, room)).toEqual({ left: 64, top: 162 })
    expect(placeMenu({ box: { left: 40, top: 520, right: 440, bottom: 580 } }, size, room)).toEqual({ left: 64, top: 118 })
    // a small thing (a body in Orbit) is not stood off from
    expect(placeMenu({ box: { left: 500, top: 100, right: 520, bottom: 120 } }, size, room)).toEqual({ left: 505, top: 122 })
  })

  test('a window smaller than the menu still shows its top left corner', () => {
    expect(placeMenu({ x: 50, y: 50 }, size, { w: 200, h: 200 })).toEqual({ left: EDGE, top: EDGE })
  })

  test('the menu drawn is put where it was asked for', async () => {
    await open(titled('Why is the bundle'), { x: 40, y: 60 })
    expect(menu()!.style.transform).toBe('translate(40px, 60px)')
  })
})

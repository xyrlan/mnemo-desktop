import libRs from '../../src-tauri/src/lib.rs?raw'
import { actionForKey, actionFromMenu, installKeys, listKey, makeDedupe } from './keys'

const ev = (key: string, o: Partial<KeyboardEvent> = {}) =>
  ({ key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...o }) as KeyboardEvent

test('mac bindings', () => {
  expect(actionForKey(ev('t', { metaKey: true }), 'mac')).toBe('tab.new')
  expect(actionForKey(ev('d', { metaKey: true }), 'mac')).toBe('pane.split.row')
  expect(actionForKey(ev('D', { metaKey: true, shiftKey: true }), 'mac')).toBe('pane.split.col')
  expect(actionForKey(ev('W', { metaKey: true, shiftKey: true }), 'mac')).toBe('tab.close')
  expect(actionForKey(ev('w', { metaKey: true }), 'mac')).toBe('pane.close')
  expect(actionForKey(ev('ArrowLeft', { metaKey: true, altKey: true }), 'mac')).toBe('focus.left')
  expect(actionForKey(ev('3', { metaKey: true }), 'mac')).toBe('tab.go.3')
  expect(actionForKey(ev('{', { metaKey: true, shiftKey: true }), 'mac')).toBe('tab.prev')
  expect(actionForKey(ev('k', { metaKey: true }), 'mac')).toBe('palette.open')
  expect(actionForKey(ev('b', { metaKey: true }), 'mac')).toBe('mission.toggle-sidebar')
  expect(actionForKey(ev('H', { metaKey: true, shiftKey: true }), 'mac')).toBe('home.show')
  expect(actionForKey(ev('B', { metaKey: true, shiftKey: true }), 'mac')).toBe('cockpit.open')
  expect(actionForKey(ev('C', { metaKey: true, shiftKey: true }), 'mac')).toBe('pane.toggle-face')
  expect(actionForKey(ev('t', { ctrlKey: true }), 'mac')).toBeNull()
  expect(actionForKey(ev('c', { metaKey: true }), 'mac')).toBeNull()
})

test('other platforms use ctrl', () => {
  expect(actionForKey(ev('t', { ctrlKey: true }), 'other')).toBe('tab.new')
  expect(actionForKey(ev('t', { metaKey: true }), 'other')).toBeNull()
})

test('list keys: plain arrows, Enter, r, a and Esc; nothing with a modifier or while typing', () => {
  const on = (tagName: string, o: { isContentEditable?: boolean } = {}) => ({ target: { tagName, ...o } as unknown as EventTarget })
  expect(listKey(ev('ArrowDown'))).toBe('down')
  expect(listKey(ev('ArrowUp', on('DIV')))).toBe('up')
  expect(listKey(ev('Enter', on('DIV')))).toBe('open')
  expect(listKey(ev('r'))).toBe('reply')
  expect(listKey(ev('a'))).toBe('attach')
  expect(listKey(ev('Escape'))).toBe('close')
  expect(listKey(ev('x'))).toBeNull()
  // Modified chords belong to actionForKey.
  expect(listKey(ev('a', { metaKey: true }))).toBeNull()
  expect(listKey(ev('ArrowDown', { ctrlKey: true }))).toBeNull()
  expect(listKey(ev('R', { shiftKey: true }))).toBeNull()
  // Typing a reply is typing.
  expect(listKey(ev('r', on('TEXTAREA')))).toBeNull()
  expect(listKey(ev('ArrowDown', on('INPUT')))).toBeNull()
  expect(listKey(ev('a', on('DIV', { isContentEditable: true })))).toBeNull()
  // A focused button runs itself on Enter; letters still reach the list.
  expect(listKey(ev('Enter', on('BUTTON')))).toBeNull()
  expect(listKey(ev('a', on('BUTTON')))).toBe('attach')
})

test('a menu event carries its action id', () => {
  expect(actionFromMenu({ id: 'palette.open' })).toBe('palette.open')
  expect(actionFromMenu({ id: '' })).toBeNull()
  expect(actionFromMenu({ id: 3 })).toBeNull()
  expect(actionFromMenu({})).toBeNull()
  expect(actionFromMenu(null)).toBeNull()
  expect(actionFromMenu('palette.open')).toBeNull()
})

test('the second source for the same action inside the window is dropped', () => {
  let t = 0
  const fire = makeDedupe(50, () => t)
  expect(fire('pane.close', 'key')).toBe(true)
  t = 49
  expect(fire('pane.close', 'menu')).toBe(false)
  t = 100
  expect(fire('pane.close', 'menu')).toBe(true)
  t = 110
  expect(fire('pane.close', 'key')).toBe(false)
  t = 160
  expect(fire('pane.close', 'key')).toBe(true)
})

test('dedupe spares repeats, other actions, and anything past the window', () => {
  let t = 0
  const fire = makeDedupe(50, () => t)
  expect(fire('tab.next', 'key')).toBe(true)
  t = 10
  expect(fire('tab.next', 'key')).toBe(true)
  t = 20
  expect(fire('tab.prev', 'menu')).toBe(true)
  t = 30
  expect(fire('tab.new', 'key')).toBe(true)
  t = 80
  expect(fire('tab.new', 'menu')).toBe(true)
})

test('a dropped echo does not restart the window for the next key repeat', () => {
  let t = 0
  const fire = makeDedupe(50, () => t)
  expect(fire('tab.next', 'key')).toBe(true)
  t = 30
  expect(fire('tab.next', 'menu')).toBe(false)
  t = 60
  expect(fire('tab.next', 'key')).toBe(true)
})

describe('installKeys', () => {
  const setup = () => {
    const ran: string[] = []
    let emit: (payload: unknown) => void = () => {}
    const off = vi.fn()
    const listen = vi.fn((event: string, cb: (p: never) => void) => {
      expect(event).toBe('app://action')
      emit = cb as (payload: unknown) => void
      return Promise.resolve(off)
    })
    const uninstall = installKeys('mac', { listen: listen as never, runAction: (id) => ran.push(id) })
    const press = (key: string, o: KeyboardEventInit = {}) =>
      window.dispatchEvent(new KeyboardEvent('keydown', { key, metaKey: true, cancelable: true, ...o }))
    return { ran, emit: (p: unknown) => emit(p), off, uninstall, press }
  }

  test('app://action runs the registry action', () => {
    const { ran, emit, uninstall } = setup()
    emit({ id: 'palette.open' })
    emit({ nope: true })
    emit({ id: 'pane.close' })
    expect(ran).toEqual(['palette.open', 'pane.close'])
    uninstall()
  })

  test('a keydown followed by its menu echo runs once', () => {
    const { ran, emit, press, uninstall } = setup()
    expect(press('k')).toBe(false)
    emit({ id: 'palette.open' })
    expect(ran).toEqual(['palette.open'])
    uninstall()
  })

  test('uninstall removes the keydown handler and the event listener', async () => {
    const { ran, off, press, uninstall } = setup()
    uninstall()
    await Promise.resolve()
    await Promise.resolve()
    expect(press('t')).toBe(true)
    expect(ran).toEqual([])
    expect(off).toHaveBeenCalledTimes(1)
  })

  test('without a Tauri event bus the keydown path still works', () => {
    const ran: string[] = []
    const listen = () => {
      throw new Error('no __TAURI_INTERNALS__')
    }
    const uninstall = installKeys('mac', { listen: listen as never, runAction: (id) => ran.push(id) })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 't', metaKey: true }))
    expect(ran).toEqual(['tab.new'])
    uninstall()
  })
})

test('every native menu accelerator in lib.rs maps to the same action as its keydown', () => {
  const block = libRs.slice(libRs.indexOf('// -- menu --'), libRs.indexOf('app.set_menu('))
  expect(block.length).toBeGreaterThan(0)
  const items = [...block.matchAll(/\("([\w.-]+)",\s*"[^"]*",\s*"(CmdOrCtrl[^"]*)"\)/g)].map((m) => [m[1], m[2]] as const)
  const shifted: Record<string, string> = { '[': '{', ']': '}' }
  const named: Record<string, string> = { Left: 'ArrowLeft', Right: 'ArrowRight', Up: 'ArrowUp', Down: 'ArrowDown' }
  const toEvent = (accel: string) => {
    const parts = accel.split('+')
    const key = parts.pop()!
    const shiftKey = parts.includes('Shift')
    return ev(named[key] ?? (shiftKey ? (shifted[key] ?? key.toUpperCase()) : key.toLowerCase()), {
      metaKey: true,
      shiftKey,
      altKey: parts.includes('Alt'),
    })
  }
  const ids = items.map(([id]) => id)
  expect(new Set(ids).size).toBe(ids.length)
  expect(ids.sort()).toEqual(
    [
      'tab.new', 'tab.prev', 'tab.next', 'tab.close', 'pane.split.row', 'pane.split.col', 'pane.close', 'palette.open',
      'mission.toggle-sidebar', 'home.show', 'pane.toggle-face', 'focus.left', 'focus.right', 'focus.up', 'focus.down',
      ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `tab.go.${n}`),
    ].sort(),
  )
  for (const [id, accel] of items) expect([accel, actionForKey(toEvent(accel), 'mac')]).toEqual([accel, id])
})

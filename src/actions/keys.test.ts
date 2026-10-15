import libRs from '../../src-tauri/src/lib.rs?raw'
import { actionForKey, actionFromMenu, installKeys, makeDedupe } from './keys'

const ev = (key: string, o: Partial<KeyboardEvent> = {}) =>
  ({ key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...o }) as KeyboardEvent

test("mac bindings: ⌘W and ⇧⌘W close, ⌘E dictates, and nothing else is the app's", () => {
  expect(actionForKey(ev('w', { metaKey: true }), 'mac')).toBe('pane.close')
  expect(actionForKey(ev('W', { metaKey: true, shiftKey: true }), 'mac')).toBe('tab.close')
  expect(actionForKey(ev('e', { metaKey: true }), 'mac')).toBe('dictation.toggle')
  // The workbench's chords went with it (#459).
  for (const [key, o] of [
    ['t', { metaKey: true }],
    ['d', { metaKey: true }],
    ['k', { metaKey: true }],
    ['0', { metaKey: true }],
    ['3', { metaKey: true }],
    ['3', { ctrlKey: true }],
    ['b', { metaKey: true }],
    ['G', { metaKey: true, shiftKey: true }],
    ['C', { metaKey: true, shiftKey: true }],
    ['ArrowLeft', { metaKey: true, altKey: true }],
  ] as const)
    expect([key, actionForKey(ev(key, o), 'mac')]).toEqual([key, null])
  expect(actionForKey(ev('t', { ctrlKey: true }), 'mac')).toBeNull()
  expect(actionForKey(ev('c', { metaKey: true }), 'mac')).toBeNull()
})

test('other platforms leave plain Ctrl to the shell and bind Ctrl+Shift (#329)', () => {
  const ctrl = { ctrlKey: true }
  const ctrlShift = { ctrlKey: true, shiftKey: true }
  const altShift = { altKey: true, shiftKey: true }
  // The shell's keys: delete word, EOF, kill line, clear, end of line, history, tmux's prefix.
  for (const k of ['w', 'd', 'k', 'l', 'e', 'n', 'b', 't', 'j', 'c', 'v', '1', '9']) expect([k, actionForKey(ev(k, ctrl), 'other')]).toEqual([k, null])
  expect(actionForKey(ev('W', ctrlShift), 'other')).toBe('pane.close')
  expect(actionForKey(ev('E', ctrlShift), 'other')).toBe('dictation.toggle')
  // What sat on Ctrl+Shift and would collide moved to Alt+Shift.
  expect(actionForKey(ev('W', altShift), 'other')).toBe('tab.close')
  // The terminal's copy and paste, and what the workbench had, are not the app's.
  for (const k of ['C', 'V', 'T', 'K', 'D']) expect([k, actionForKey(ev(k, ctrlShift), 'other')]).toEqual([k, null])
  expect(actionForKey(ev('2', { altKey: true }), 'other')).toBeNull()
  // AltGr arrives as Ctrl+Alt: the letter it types on A is typed.
  expect(actionForKey(ev('ą', { ctrlKey: true, altKey: true, code: 'KeyA' }), 'other')).toBeNull()
  expect(actionForKey(ev('ArrowLeft', { ctrlKey: true, altKey: true }), 'other')).toBeNull()
  expect(actionForKey(ev('t', { metaKey: true }), 'other')).toBeNull()
})

test('a menu event carries its action id', () => {
  expect(actionFromMenu({ id: 'dictation.toggle' })).toBe('dictation.toggle')
  expect(actionFromMenu({ id: '' })).toBeNull()
  expect(actionFromMenu({ id: 3 })).toBeNull()
  expect(actionFromMenu({})).toBeNull()
  expect(actionFromMenu(null)).toBeNull()
  expect(actionFromMenu('dictation.toggle')).toBeNull()
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
    emit({ id: 'dictation.toggle' })
    emit({ nope: true })
    emit({ id: 'pane.close' })
    expect(ran).toEqual(['dictation.toggle', 'pane.close'])
    uninstall()
  })

  test('a keydown followed by its menu echo runs once', () => {
    const { ran, emit, press, uninstall } = setup()
    expect(press('e')).toBe(false)
    emit({ id: 'dictation.toggle' })
    expect(ran).toEqual(['dictation.toggle'])
    uninstall()
  })

  test('uninstall removes the keydown handler and the event listener', async () => {
    const { ran, off, press, uninstall } = setup()
    uninstall()
    await Promise.resolve()
    await Promise.resolve()
    expect(press('w')).toBe(true)
    expect(ran).toEqual([])
    expect(off).toHaveBeenCalledTimes(1)
  })

  test('off a Mac a plain Ctrl key is neither run nor cancelled, so the terminal under it gets it', () => {
    const ran: string[] = []
    const uninstall = installKeys('other', { listen: (() => Promise.resolve(() => {})) as never, runAction: (id) => ran.push(id) })
    const press = (key: string, o: KeyboardEventInit) => window.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true, ...o }))
    // dispatchEvent answers true when nothing cancelled the key.
    for (const key of ['w', 'd', 'k', 'c', 'v', '1']) expect([key, press(key, { ctrlKey: true })]).toEqual([key, true])
    expect(ran).toEqual([])
    expect(press('W', { ctrlKey: true, shiftKey: true })).toBe(false)
    expect(ran).toEqual(['pane.close'])
    uninstall()
  })

  test('without a Tauri event bus the keydown path still works', () => {
    const ran: string[] = []
    const listen = () => {
      throw new Error('no __TAURI_INTERNALS__')
    }
    const uninstall = installKeys('mac', { listen: listen as never, runAction: (id) => ran.push(id) })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', metaKey: true }))
    expect(ran).toEqual(['dictation.toggle'])
    uninstall()
  })
})

test('every native menu accelerator in lib.rs maps to the same action as its keydown', () => {
  const block = libRs.slice(libRs.indexOf('// -- menu --'), libRs.indexOf('app.set_menu('))
  expect(block.length).toBeGreaterThan(0)
  const items = [...block.matchAll(/\("([\w.-]+)",\s*"[^"]*",\s*"((?:CmdOrCtrl|Ctrl)[^"]*)"\)/g)].map((m) => [m[1], m[2]] as const)
  const shifted: Record<string, string> = { '[': '{', ']': '}' }
  const named: Record<string, string> = { Left: 'ArrowLeft', Right: 'ArrowRight', Up: 'ArrowUp', Down: 'ArrowDown' }
  const toEvent = (accel: string) => {
    const parts = accel.split('+')
    const key = parts.pop()!
    const shiftKey = parts.includes('Shift')
    if (parts[0] === 'Ctrl') return ev(key, { ctrlKey: true })
    return ev(named[key] ?? (shiftKey ? (shifted[key] ?? key.toUpperCase()) : key.toLowerCase()), {
      metaKey: true,
      shiftKey,
      altKey: parts.includes('Alt'),
    })
  }
  const ids = items.map(([id]) => id)
  expect(new Set(ids).size).toBe(ids.length)
  expect(ids.sort()).toEqual(['dictation.toggle', 'pane.close', 'tab.close'])
  for (const [id, accel] of items) expect([accel, actionForKey(toEvent(accel), 'mac')]).toEqual([accel, id])
})

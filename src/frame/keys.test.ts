import { nextPending } from '../pending'
import { HOME, type Route } from '../world/route'
import { sampleWorld } from '../world/sample'
import { childrenOf, pendingInOrder, rosterOrder } from '../world/store'
import type { World } from '../world/types'
import { WALK_MS, createBack, familyOf, fleetKey, focusTerminal, press, whereOf, type Fleet, type Press, type Where } from './keys'

const world = sampleWorld()
const order = rosterOrder(world)

const key = (k: string, more: Partial<Press> = {}): Press => ({ key: k, code: '', altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...more })
const alt = (k: string, code = '', more: Partial<Press> = {}): Press => key(k, { altKey: true, code, ...more })
const named = (e: Press, where: Where) => fleetKey(e, where)?.key ?? null

describe('which key a press is', () => {
  test('anywhere but a terminal or a field, the keys of the table work bare', () => {
    const table: [string, string][] = [
      ['ArrowUp', 'up'],
      ['ArrowDown', 'down'],
      ['ArrowLeft', 'left'],
      ['ArrowRight', 'right'],
      ['q', 'back'],
      ['n', 'next'],
      ['r', 'reply'],
      ['h', 'orbit'],
      ['c', 'console'],
      ['t', 'score'],
      ['Enter', 'enter'],
      [';', 'command'],
      ['Escape', 'escape'],
    ]
    for (const [k, name] of table) expect([k, named(key(k), 'open')]).toEqual([k, name])
    expect(fleetKey(key('7'), 'open')).toEqual({ key: 'answer', digit: 7 })
    expect(named(key('x'), 'open')).toBeNull()
    expect(named(key('0'), 'open')).toBeNull()
  })

  test('inside a terminal a bare key is the session’s, and Alt reaches the fleet', () => {
    for (const k of ['n', 'q', 'c', '3', 'ArrowDown', 'Enter', ';']) {
      expect([k, named(key(k), 'terminal')]).toEqual([k, null])
      expect([k, named(alt(k), 'terminal')]).not.toEqual([k, null])
    }
  })

  test('a text field is typed into the same way', () => {
    expect(named(key('n'), 'field')).toBeNull()
    expect(named(key('1'), 'field')).toBeNull()
    expect(named(alt('n'), 'field')).toBe('next')
    expect(fleetKey(alt('2'), 'field')).toEqual({ key: 'answer', digit: 2 })
  })

  test('Esc is never taken from a terminal, and never sent with Alt', () => {
    expect(named(key('Escape'), 'terminal')).toBeNull()
    expect(named(alt('Escape'), 'terminal')).toBeNull()
    expect(named(alt('Escape'), 'open')).toBeNull()
    expect(named(key('Escape'), 'field')).toBe('escape')
  })

  test('on a Mac ⌥ changes the character, so the physical key names it', () => {
    expect(named(alt('Dead', 'KeyN'), 'terminal')).toBe('next')
    expect(named(alt('œ', 'KeyQ'), 'terminal')).toBe('back')
    expect(named(alt('ç', 'KeyC'), 'terminal')).toBe('console')
    expect(named(alt('…', 'Semicolon'), 'terminal')).toBe('command')
    expect(fleetKey(alt('£', 'Digit3'), 'terminal')).toEqual({ key: 'answer', digit: 3 })
    // without Alt the physical key says nothing: a layout that types another letter there keeps it
    expect(named(key('ñ', { code: 'KeyN' }), 'open')).toBeNull()
  })

  test('the character wins over the physical key: `;` wherever a layout has it', () => {
    expect(named(key(';', { code: 'Slash' }), 'open')).toBe('command')
    expect(named(key(';', { code: 'Comma', shiftKey: true }), 'open')).toBe('command')
  })

  test('Ctrl and ⌘ chords, and AltGr (Ctrl+Alt), are never the frame’s', () => {
    expect(named(key('n', { ctrlKey: true }), 'open')).toBeNull()
    expect(named(key('n', { metaKey: true }), 'open')).toBeNull()
    expect(named(alt('q', 'KeyQ', { ctrlKey: true }), 'terminal')).toBeNull()
  })

  test('Shift with a letter, an arrow or Enter is somebody else’s key', () => {
    expect(named(key('N', { shiftKey: true }), 'open')).toBeNull()
    expect(named(key('ArrowDown', { shiftKey: true }), 'open')).toBeNull()
    expect(named(key('Enter', { shiftKey: true }), 'open')).toBeNull()
    expect(named(alt('Dead', 'KeyN', { shiftKey: true }), 'terminal')).toBeNull()
    expect(named(key('?', { shiftKey: true }), 'open')).toBe('sheet')
    expect(named(alt('¿', 'Slash', { shiftKey: true }), 'terminal')).toBe('sheet')
  })

  test('a button in hand keeps its own Enter; Alt+Enter is still the fleet’s', () => {
    expect(named(key('Enter'), 'control')).toBeNull()
    expect(named(alt('Enter'), 'control')).toBe('enter')
    expect(named(key('n'), 'control')).toBe('next')
  })
})

describe('where a press landed', () => {
  const inBody = (html: string): Element => {
    document.body.innerHTML = html
    return document.querySelector('[data-here]')!
  }
  afterEach(() => (document.body.innerHTML = ''))

  test('a terminal, a field, a control, or open ground', () => {
    expect(whereOf(inBody('<div class="xterm"><textarea data-here class="xterm-helper-textarea"></textarea></div>'))).toBe('terminal')
    expect(whereOf(inBody('<div data-live-terminal="a"><div data-here tabindex="0"></div></div>'))).toBe('terminal')
    expect(whereOf(inBody('<input data-here type="text">'))).toBe('field')
    expect(whereOf(inBody('<textarea data-here></textarea>'))).toBe('field')
    expect(whereOf(inBody('<div contenteditable="true"><p data-here>x</p></div>'))).toBe('field')
    expect(whereOf(inBody('<button><span data-here>go</span></button>'))).toBe('control')
    expect(whereOf(inBody('<input data-here type="checkbox">'))).toBe('control')
    expect(whereOf(inBody('<section data-here></section>'))).toBe('open')
    expect(whereOf(null)).toBe('open')
  })

  test('Enter finds the terminal on stage, or the box that speaks to the session', () => {
    document.body.innerHTML = '<nav><input id="other"></nav><section data-stage><div data-pending="question"><input id="card"></div><textarea id="say"></textarea></section>'
    // from a field that is not the stage's (the command line, say), Enter still goes in
    document.querySelector<HTMLElement>('#other')!.focus()
    expect(focusTerminal(document)).toBe('focused')
    expect(document.activeElement?.id).toBe('say')
    expect(focusTerminal(document)).toBe('already')

    document.body.innerHTML = '<section data-stage><div class="xterm"><textarea class="xterm-helper-textarea" id="term"></textarea></div><textarea id="say"></textarea></section>'
    expect(focusTerminal(document)).toBe('focused')
    expect(document.activeElement?.id).toBe('term')
  })

  test('the stage’s own way in is used when it has one, and its answer is the frame’s', () => {
    document.body.innerHTML = '<section data-stage><textarea id="say"></textarea><input id="other"></section>'
    let asked = 0
    expect(focusTerminal(document, () => (asked++, true))).toBe('focused')
    expect(focusTerminal(document, () => (asked++, false))).toBe('none')
    expect(asked).toBe(2)
    // it was the stage's to place the caret: the frame did not
    expect(document.activeElement).toBe(document.body)
    // with the caret already in the stage's box the stage is not asked again
    document.querySelector<HTMLElement>('#say')!.focus()
    expect(focusTerminal(document, () => (asked++, true))).toBe('already')
    expect(asked).toBe(2)
  })

  test('the caret in a waiting card’s field is not in the terminal', () => {
    document.body.innerHTML = '<section data-stage><div data-pending="question"><input id="card"></div><textarea id="say"></textarea></section>'
    document.querySelector<HTMLElement>('#card')!.focus()
    expect(focusTerminal(document)).toBe('focused')
    expect(document.activeElement?.id).toBe('say')
  })

  test('a stage with nothing to type into, or only a waiting card’s field, has no terminal', () => {
    document.body.innerHTML = '<section data-stage><div data-pending="question"><input id="card"></div><pre>a transcript</pre></section>'
    expect(focusTerminal(document)).toBe('none')
    expect(document.activeElement).toBe(document.body)
    document.body.innerHTML = '<main></main>'
    expect(focusTerminal(document)).toBe('none')
  })
})

/** A fleet over the sample world, whose route is a plain object the test reads. */
function fleetOn(start: Partial<Route> = {}, w: World = world) {
  const state = { route: { ...HOME, ...start } as Route, recent: [] as string[], sheet: false, answered: [] as number[], replied: 0, takesReply: true, left: 0, opened: 0, escaped: 0, focus: 'focused' as ReturnType<Fleet['focusTerminal']>, now: 0 }
  const fleet: Fleet = {
    world: () => w,
    route: () => state.route,
    recent: () => state.recent,
    go: (patch) => {
      state.route = { ...state.route, ...patch }
      if (state.route.session && state.recent[0] !== state.route.session) state.recent = [state.route.session, ...state.recent.filter((id) => id !== state.route.session)]
    },
    now: () => state.now,
    nextPending,
    answerArmed: (n) => void state.answered.push(n),
    replyArmed: () => (state.replied++, state.takesReply),
    focusTerminal: () => state.focus,
    leaveField: () => void state.left++,
    openCommand: () => void state.opened++,
    escapeCommand: () => void state.escaped++,
    sheet: { isOpen: () => state.sheet, set: (open) => void (state.sheet = open) },
    back: createBack(),
  }
  const hit = (k: string, where: Where = 'open', more: Partial<Press> = {}) => press(key(k, more), where, fleet)
  return { state, fleet, hit }
}

describe('what the keys do', () => {
  test('down and up walk the roster’s order, and stop at its ends', () => {
    const { state, hit } = fleetOn()
    const seen: (string | null)[] = []
    for (let i = 0; i < order.length + 2; i++) {
      expect(hit('ArrowDown')).toBe(true)
      seen.push(state.route.session)
    }
    expect(seen.slice(0, order.length)).toEqual(order.map((s) => s.id))
    expect(seen.slice(-2)).toEqual([order.at(-1)!.id, order.at(-1)!.id])
    hit('ArrowUp')
    expect(state.route.session).toBe(order.at(-2)!.id)
    state.route.session = order[0].id
    hit('ArrowUp')
    expect(state.route.session).toBe(order[0].id)
  })

  test('from no selection, up is the last session', () => {
    const { state, hit } = fleetOn()
    hit('ArrowUp')
    expect(state.route.session).toBe(order.at(-1)!.id)
  })

  test('moving to another session closes the card that was open', () => {
    const { state, hit } = fleetOn({ session: order[0].id, pending: 'something' })
    hit('ArrowDown')
    expect(state.route).toMatchObject({ session: order[1].id, pending: null })
  })

  test('left and right walk the family on stage, the parent then each child, and wrap', () => {
    const parent = order.find((s) => childrenOf(world, s).length > 2)!
    const family = [parent, ...childrenOf(world, parent)]
    expect(familyOf(world, family[2].id).map((s) => s.id)).toEqual(family.map((s) => s.id))

    const { state, hit } = fleetOn({ session: family[1].id })
    hit('ArrowRight')
    expect(state.route.session).toBe(family[2].id)
    for (let i = 3; i <= family.length; i++) hit('ArrowRight')
    expect(state.route.session).toBe(family[0].id)
    hit('ArrowLeft')
    expect(state.route.session).toBe(family.at(-1)!.id)
  })

  test('N walks what waits in roster order, opening each card on its session, and wraps', () => {
    const { state, hit } = fleetOn()
    const waiting = pendingInOrder(world)
    const seen: [string | null, string | null][] = []
    for (let i = 0; i <= waiting.length; i++) {
      hit('n')
      seen.push([state.route.session, state.route.pending])
    }
    expect(seen).toEqual([...waiting, waiting[0]].map((p) => [p.session, p.id]))
  })

  test('N with nothing waiting changes nothing, and is still the frame’s key', () => {
    const { state, hit } = fleetOn({ session: order[0].id }, { ...world, pending: [] })
    expect(hit('n')).toBe(true)
    expect(state.route).toMatchObject({ session: order[0].id, pending: null })
  })

  test('a digit answers the open waiting item; R answers it in words', () => {
    const { state, hit } = fleetOn()
    hit('2')
    hit('9')
    hit('r')
    expect(state.answered).toEqual([2, 9])
    expect(state.replied).toBe(1)
  })

  test('R with nothing that takes a reply is not spent: it is left to whoever else wants it', () => {
    const { state, hit } = fleetOn()
    expect(hit('r')).toBe(true)
    state.takesReply = false
    expect(hit('r')).toBe(false)
    expect(state.replied).toBe(2)
  })

  test('H, C and T change the view and keep the selection', () => {
    const { state, hit } = fleetOn({ session: order[3].id, view: 'orbit' })
    hit('t')
    expect(state.route).toMatchObject({ view: 'score', session: order[3].id })
    hit('c')
    expect(state.route).toMatchObject({ view: 'console', session: order[3].id })
    hit('h')
    expect(state.route).toMatchObject({ view: 'orbit', session: order[3].id })
  })

  test('Enter outside Console opens the selection on its stage; with none it is not the frame’s', () => {
    const { state, hit } = fleetOn({ view: 'score', session: order[2].id, pending: 'x' })
    expect(hit('Enter')).toBe(true)
    expect(state.route).toMatchObject({ view: 'console', session: order[2].id, pending: null })
    expect(fleetOn({ view: 'orbit' }).hit('Enter')).toBe(false)
  })

  test('Enter in Console goes into the terminal; again, it gives the terminal the room, and back', () => {
    const { state, hit } = fleetOn({ view: 'console', session: order[0].id })
    hit('Enter')
    expect(state.route.wide).toBe(false)
    state.focus = 'already'
    hit('Enter', 'terminal', { altKey: true })
    expect(state.route.wide).toBe(true)
    hit('Enter', 'terminal', { altKey: true })
    expect(state.route.wide).toBe(false)
  })

  test('`;` opens the command line and `?` the key sheet', () => {
    const { state, hit } = fleetOn()
    hit(';')
    expect(state.opened).toBe(1)
    hit('?', 'open', { shiftKey: true })
    expect(state.sheet).toBe(true)
  })

  test('any key closes the key sheet, and does nothing else', () => {
    const { state, hit } = fleetOn({ session: order[0].id })
    state.sheet = true
    expect(hit('ArrowDown')).toBe(true)
    expect(state.sheet).toBe(false)
    expect(state.route.session).toBe(order[0].id)
    // a modifier on its way down is not a key
    state.sheet = true
    expect(hit('Alt', 'open', { altKey: true })).toBe(false)
    expect(state.sheet).toBe(true)
  })

  test('Esc leaves one thing at a time: a field, the command line, a card, a panel, the wide stage', () => {
    const { state, hit } = fleetOn({ command: true, pending: 'p', panel: 'memory', wide: true })
    expect(hit('Escape', 'field')).toBe(true)
    expect([state.left, state.escaped]).toEqual([1, 0])
    hit('Escape')
    expect(state.escaped).toBe(1)
    state.route.command = false
    hit('Escape')
    expect(state.route).toMatchObject({ pending: null, panel: 'memory', wide: true })
    hit('Escape')
    expect(state.route).toMatchObject({ panel: null, wide: true })
    hit('Escape')
    expect(state.route.wide).toBe(false)
    // with nothing open it is not the frame's key: a view may use it
    expect(hit('Escape')).toBe(false)
  })

  test('a bare key typed in a terminal is not the frame’s, and nothing moves', () => {
    const { state, hit } = fleetOn({ session: order[0].id })
    expect(hit('n', 'terminal')).toBe(false)
    expect(hit('ArrowDown', 'terminal')).toBe(false)
    expect(state.route).toMatchObject({ session: order[0].id, pending: null })
  })
})

describe('Q, the session he was on before', () => {
  const has = () => true

  test('returns to where he came from, and back again', () => {
    const back = createBack()
    expect(back(['b', 'a'], 'b', 0, has)).toBe('a')
    // long after, with the route's own list now leading with a
    expect(back(['a', 'b'], 'a', 60_000, has)).toBe('b')
  })

  test('pressed again at once it goes further back, most recent first', () => {
    const back = createBack()
    expect(back(['d', 'c', 'b', 'a'], 'd', 0, has)).toBe('c')
    // the route's list reorders as he goes; the walk keeps the order it started with
    expect(back(['c', 'd', 'b', 'a'], 'c', 400, has)).toBe('b')
    expect(back(['b', 'c', 'd', 'a'], 'b', 800, has)).toBe('a')
  })

  test('a pause ends the walk: the next Q returns instead of going further', () => {
    const back = createBack()
    expect(back(['c', 'b', 'a'], 'c', 0, has)).toBe('b')
    expect(back(['b', 'c', 'a'], 'b', WALK_MS + 1, has)).toBe('c')
  })

  test('moving by another key ends the walk too', () => {
    const back = createBack()
    expect(back(['c', 'b', 'a'], 'c', 0, has)).toBe('b')
    // he pressed down and is on x now
    expect(back(['x', 'b', 'c', 'a'], 'x', 300, has)).toBe('b')
  })

  test('a session that left the world is skipped; with nowhere to go back to, nothing', () => {
    const back = createBack()
    expect(back(['c', 'gone', 'a'], 'c', 0, (id) => id !== 'gone')).toBe('a')
    expect(createBack()(['c'], 'c', 0, has)).toBeNull()
    expect(createBack()([], null, 0, has)).toBeNull()
  })

  test('through the keys: Q selects it', () => {
    const { state, hit } = fleetOn()
    state.route.session = order[4].id
    state.recent = [order[4].id, order[1].id]
    hit('q')
    expect(state.route.session).toBe(order[1].id)
  })
})

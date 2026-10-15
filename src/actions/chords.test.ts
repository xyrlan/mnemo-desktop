import { actionForChord, boundActions, chordFor, shortcutKeys, shortcutLabel, type Platform } from './chords'

type Ev = { key: string; code: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }
type Mods = Pick<Ev, 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>

const NONE: Mods = { metaKey: false, ctrlKey: false, altKey: false, shiftKey: false }
const ALL_MODS: Mods[] = Array.from({ length: 16 }, (_, n) => ({ metaKey: !!(n & 1), ctrlKey: !!(n & 2), altKey: !!(n & 4), shiftKey: !!(n & 8) }))

/** Every key a chord could sit on, as a US keyboard reports it with and without Shift, and the
 *  letters AltGr or ⌥ type on the A key. */
const KEYS: [key: string, code: string][] = [
  ...'abcdefghijklmnopqrstuvwxyz'.split('').flatMap((l): [string, string][] => [
    [l, `Key${l.toUpperCase()}`],
    [l.toUpperCase(), `Key${l.toUpperCase()}`],
  ]),
  ...'123456789'.split('').map((d): [string, string] => [d, `Digit${d}`]),
  ...'!@#$%^&*('.split('').map((c, i): [string, string] => [c, `Digit${i + 1}`]),
  ['0', 'Digit0'],
  ['[', 'BracketLeft'],
  ['{', 'BracketLeft'],
  [']', 'BracketRight'],
  ['}', 'BracketRight'],
  ['ArrowLeft', 'ArrowLeft'],
  ['ArrowRight', 'ArrowRight'],
  ['ArrowUp', 'ArrowUp'],
  ['ArrowDown', 'ArrowDown'],
  ['å', 'KeyA'],
  ['ą', 'KeyA'],
  ['á', 'KeyA'],
  ['€', 'KeyE'],
  ['Enter', 'Enter'],
  ['Tab', 'Tab'],
  [' ', 'Space'],
]

const says = (m: Mods) => (['ctrlKey', 'metaKey', 'altKey', 'shiftKey'] as const).filter((k) => m[k]).map((k) => k.replace('Key', '')).join('+') || 'none'

/** What a Mac binds now (#459): ⌘W and ⇧⌘W close what is on top of the Nexus, ⌘E dictates. The
 *  workbench's chords went with it. */
function expected(e: Ev): string | null {
  if (!e.metaKey || e.altKey) return null
  const k = e.key.toLowerCase()
  if (k === 'w') return e.shiftKey ? 'tab.close' : 'pane.close'
  if (k === 'e' && !e.shiftKey) return 'dictation.toggle'
  return null
}

test('a Mac binds ⌘W, ⇧⌘W and ⌘E, and nothing else: every key under every set of modifiers', () => {
  const now: string[] = []
  const want: string[] = []
  for (const mods of ALL_MODS)
    for (const [key, code] of KEYS) {
      const e = { key, code, ...mods }
      now.push(`${says(mods)} ${key} -> ${actionForChord(e, 'mac')}`)
      want.push(`${says(mods)} ${key} -> ${expected(e)}`)
    }
  expect(now).toEqual(want)
  expect([...new Set(KEYS.flatMap(([key, code]) => ALL_MODS.map((m) => expected({ key, code, ...m }))))].filter(Boolean).sort()).toEqual(boundActions().sort())
})

test('a Mac prints them', () => {
  const printed = Object.fromEntries(boundActions().map((id) => [id, shortcutLabel(id, 'mac')]))
  expect(printed).toEqual({ 'pane.close': '⌘W', 'tab.close': '⌘⇧W', 'dictation.toggle': '⌘E' })
})

describe('off a Mac', () => {
  test('no plain Ctrl+letter and no Ctrl+digit is the app’s: the shell gets them', () => {
    const taken = KEYS.map(([key, code]) => [key, actionForChord({ key, code, ...NONE, ctrlKey: true }, 'other')]).filter(([, id]) => id)
    expect(taken).toEqual([])
  })

  test('no key alone, and none with Shift alone, is the app’s', () => {
    for (const mods of [NONE, { ...NONE, shiftKey: true }])
      expect(KEYS.filter(([key, code]) => actionForChord({ key, code, ...mods }, 'other'))).toEqual([])
  })

  test('AltGr, which arrives as Ctrl+Alt, never fires a chord', () => {
    const altGr = ALL_MODS.filter((m) => m.ctrlKey && m.altKey)
    expect(altGr).toHaveLength(4)
    const fired = altGr.flatMap((mods) => KEYS.filter(([key, code]) => actionForChord({ key, code, ...mods }, 'other')).map(([key]) => `${says(mods)} ${key}`))
    expect(fired).toEqual([])
    for (const id of boundActions()) expect([id, !!(chordFor(id, 'other')!.ctrl && chordFor(id, 'other')!.alt)]).toEqual([id, false])
  })

  test('Ctrl+Shift+C and Ctrl+Shift+V are left to the terminal’s copy and paste', () => {
    for (const [key, code] of [['C', 'KeyC'], ['V', 'KeyV'], ['c', 'KeyC'], ['v', 'KeyV']])
      expect(actionForChord({ key, code, ...NONE, ctrlKey: true, shiftKey: true }, 'other')).toBeNull()
  })

  test('every action a Mac binds has a chord, and this is the table', () => {
    const printed = Object.fromEntries(boundActions().map((id) => [id, shortcutLabel(id, 'other')]))
    expect(printed).toEqual({
      // ⌘ key → Ctrl+Shift+key.
      'pane.close': 'Ctrl+Shift+W',
      'dictation.toggle': 'Ctrl+Shift+E',
      // ⌘⇧ key → Alt+Shift+key where Ctrl+Shift+key is taken.
      'tab.close': 'Alt+Shift+W',
    })
  })
})

/** The keydown a person makes by pressing what a label prints, read from the label alone. */
function pressed(label: string[], platform: Platform): Ev {
  const mods: Record<string, keyof Mods> =
    platform === 'mac' ? { '⌘': 'metaKey', '⌃': 'ctrlKey', '⌥': 'altKey', '⇧': 'shiftKey' } : { Win: 'metaKey', Ctrl: 'ctrlKey', Alt: 'altKey', Shift: 'shiftKey' }
  const e: Ev = { key: '', code: '', ...NONE }
  const cap = label[label.length - 1]
  for (const m of label.slice(0, -1)) {
    expect(Object.keys(mods)).toContain(m)
    e[mods[m]] = true
  }
  const arrows: Record<string, string> = { '←': 'ArrowLeft', '→': 'ArrowRight', '↑': 'ArrowUp', '↓': 'ArrowDown' }
  if (arrows[cap]) return { ...e, key: arrows[cap], code: arrows[cap] }
  if (/^[A-Z]$/.test(cap)) {
    // ⌥ on a Mac types another letter on the key ("å" for A); Shift types the capital.
    const key = platform === 'mac' && e.altKey ? 'å' : e.shiftKey ? cap : cap.toLowerCase()
    return { ...e, key, code: `Key${cap}` }
  }
  if (/^[0-9]$/.test(cap)) return { ...e, key: e.shiftKey ? ')!@#$%^&*('[Number(cap)] : cap, code: `Digit${cap}` }
  if (cap === '[' || cap === ']') return { ...e, key: e.shiftKey ? (cap === '[' ? '{' : '}') : cap, code: cap === '[' ? 'BracketLeft' : 'BracketRight' }
  throw new Error(`a label names a key this test cannot press: ${cap}`)
}

describe.each(['mac', 'other'] as const)('on %s', (platform) => {
  test('pressing what an action’s label prints runs that action', () => {
    expect(boundActions()).toHaveLength(3)
    for (const id of boundActions()) {
      const label = shortcutKeys(id, platform)
      expect([id, label.join(' '), actionForChord(pressed(label, platform), platform)]).toEqual([id, label.join(' '), id])
    }
  })

  test('no two actions print the same keys', () => {
    const labels = boundActions().map((id) => shortcutLabel(id, platform))
    expect(new Set(labels).size).toBe(labels.length)
  })

  test('an action with no chord prints none', () => {
    expect(shortcutLabel('nexus.toggle', platform)).toBeUndefined()
    expect(shortcutKeys('nexus.toggle', platform)).toEqual([])
  })
})

// A chord written out by hand is a label its binding can leave behind: every printed shortcut
// of an app action comes from the table. Read as text, comments apart.
test('no source file writes an app chord out by hand', () => {
  const files = import.meta.glob('../**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
  expect(Object.keys(files).length).toBeGreaterThan(200)
  // Not app actions: the keys the desktop MCP parses (`drive`), and the component gallery's samples.
  const own = ['../mcp/drive.ts', '../ui/gallery.tsx']
  const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  const found = Object.entries(files)
    .filter(([path]) => !/\.test\.tsx?$/.test(path) && !path.endsWith('/actions/chords.ts') && !own.includes(path))
    .flatMap(([path, src]) => [...code(src).matchAll(/[⌘⌥⌃⇧]+[A-Za-z0-9←→↑↓[\]]|\b(?:Ctrl|Alt)\+(?:Shift\+)?[A-Z0-9]\b/g)].map((m) => `${path}: ${m[0]}`))
  expect(found).toEqual([])
  // And nothing registers an action with a label of its own.
  const labelled = Object.entries(files)
    .filter(([path]) => !/\.test\.tsx?$/.test(path))
    .flatMap(([path, src]) => [...code(src).matchAll(/register\w*\(\{[^}]*\bshortcut\s*:/g)].map(() => path))
  expect(labelled).toEqual([])
})

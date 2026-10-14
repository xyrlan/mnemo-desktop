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

/** `actionForKey` as it stood before the chord table (1331d3b), Mac branch and all: what a Mac
 *  must still bind, key for key. */
function before(e: Ev, platform: Platform): string | null {
  const k = e.key.toLowerCase()
  if (/^[1-9]$/.test(k) && !e.shiftKey) {
    if (platform === 'mac' && e.ctrlKey && !e.metaKey && !e.altKey) return `tab.go.${k}`
    if (platform === 'other' && e.altKey && !e.ctrlKey && !e.metaKey) return `tab.go.${k}`
  }
  const mod = platform === 'mac' ? e.metaKey : e.ctrlKey
  if (!mod) return null
  if (e.altKey && !e.shiftKey) {
    const m: Record<string, string> = { arrowleft: 'focus.left', arrowright: 'focus.right', arrowup: 'focus.up', arrowdown: 'focus.down', a: 'floating-terminal.toggle' }
    return m[e.code === 'KeyA' ? 'a' : k] ?? null
  }
  if (e.altKey) return null
  if (e.shiftKey) {
    const m: Record<string, string> = { d: 'pane.split.col', w: 'tab.close', b: 'tab.new-browser', g: 'diff.open', c: 'pane.toggle-face', '[': 'tab.prev', '{': 'tab.prev', ']': 'tab.next', '}': 'tab.next' }
    return m[k] ?? null
  }
  if (/^[1-9]$/.test(k)) return `worktree.go.${k}`
  const m: Record<string, string> = { t: 'tab.new', d: 'pane.split.row', w: 'pane.close', e: 'dictation.toggle', k: 'palette.open', j: 'worktree.jump', n: 'workspace.new', b: 'sidebar.toggle-left', l: 'sidebar.toggle-right' }
  return m[k] ?? null
}

test('a Mac binds exactly what it did: every key under every set of modifiers', () => {
  const now: string[] = []
  const then: string[] = []
  for (const mods of ALL_MODS)
    for (const [key, code] of KEYS) {
      const e = { key, code, ...mods }
      now.push(`${says(mods)} ${key} -> ${actionForChord(e, 'mac')}`)
      then.push(`${says(mods)} ${key} -> ${before(e, 'mac')}`)
    }
  expect(now).toEqual(then)
  // The oracle is no blank: it names every action the table does.
  expect([...new Set(KEYS.flatMap(([key, code]) => ALL_MODS.map((m) => before({ key, code, ...m }, 'mac'))))].filter(Boolean).sort()).toEqual(boundActions().sort())
})

test('a Mac prints exactly what it did', () => {
  const printed = Object.fromEntries(boundActions().map((id) => [id, shortcutLabel(id, 'mac')]))
  expect(printed).toEqual({
    'tab.new': '⌘T',
    'pane.split.row': '⌘D',
    'pane.split.col': '⌘⇧D',
    'pane.close': '⌘W',
    'tab.close': '⌘⇧W',
    'tab.prev': '⌘⇧[',
    'tab.next': '⌘⇧]',
    'focus.left': '⌘⌥←',
    'focus.right': '⌘⌥→',
    'focus.up': '⌘⌥↑',
    'focus.down': '⌘⌥↓',
    'pane.toggle-face': '⌘⇧C',
    'palette.open': '⌘K',
    'sidebar.toggle-left': '⌘B',
    'sidebar.toggle-right': '⌘L',
    'worktree.jump': '⌘J',
    'workspace.new': '⌘N',
    'tab.new-browser': '⌘⇧B',
    'diff.open': '⌘⇧G',
    'floating-terminal.toggle': '⌘⌥A',
    'dictation.toggle': '⌘E',
    ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].flatMap((n) => [[`worktree.go.${n}`, `⌘${n}`], [`tab.go.${n}`, `⌃${n}`]])),
  })
})

describe('off a Mac', () => {
  test('no plain Ctrl+letter and no Ctrl+digit is the app’s: the shell gets them', () => {
    const taken = KEYS.map(([key, code]) => [key, actionForChord({ key, code, ...NONE, ctrlKey: true }, 'other')]).filter(([, id]) => id)
    expect(taken).toEqual([])
    // Before the table, these were: the defect of #329.
    expect(before({ key: 'w', code: 'KeyW', ...NONE, ctrlKey: true }, 'other')).toBe('pane.close')
    expect(before({ key: 'd', code: 'KeyD', ...NONE, ctrlKey: true }, 'other')).toBe('pane.split.row')
    expect(before({ key: '1', code: 'Digit1', ...NONE, ctrlKey: true }, 'other')).toBe('worktree.go.1')
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
    // The letter a Polish or US-International layout types on AltGr+A toggled the floating terminal.
    expect(before({ key: 'ą', code: 'KeyA', ...NONE, ctrlKey: true, altKey: true }, 'other')).toBe('floating-terminal.toggle')
    for (const id of boundActions()) expect([id, !!(chordFor(id, 'other')!.ctrl && chordFor(id, 'other')!.alt)]).toEqual([id, false])
  })

  test('Ctrl+Shift+C and Ctrl+Shift+V are left to the terminal’s copy and paste', () => {
    for (const [key, code] of [['C', 'KeyC'], ['V', 'KeyV'], ['c', 'KeyC'], ['v', 'KeyV']])
      expect(actionForChord({ key, code, ...NONE, ctrlKey: true, shiftKey: true }, 'other')).toBeNull()
    expect(before({ key: 'C', code: 'KeyC', ...NONE, ctrlKey: true, shiftKey: true }, 'other')).toBe('pane.toggle-face')
  })

  test('every action a Mac binds still has a chord, and this is the table', () => {
    const printed = Object.fromEntries(boundActions().map((id) => [id, shortcutLabel(id, 'other')]))
    expect(printed).toEqual({
      // ⌘ key → Ctrl+Shift+key.
      'tab.new': 'Ctrl+Shift+T',
      'pane.split.row': 'Ctrl+Shift+D',
      'pane.close': 'Ctrl+Shift+W',
      'dictation.toggle': 'Ctrl+Shift+E',
      'palette.open': 'Ctrl+Shift+K',
      'worktree.jump': 'Ctrl+Shift+J',
      'workspace.new': 'Ctrl+Shift+N',
      'sidebar.toggle-left': 'Ctrl+Shift+B',
      'sidebar.toggle-right': 'Ctrl+Shift+L',
      ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => [`worktree.go.${n}`, `Ctrl+Shift+${n}`])),
      // ⌘⇧ key → Alt+Shift+key where Ctrl+Shift+key is now taken, or is the terminal's copy.
      'pane.split.col': 'Alt+Shift+D',
      'tab.close': 'Alt+Shift+W',
      'tab.new-browser': 'Alt+Shift+B',
      'pane.toggle-face': 'Alt+Shift+C',
      // ⌘⇧ key stays on Ctrl+Shift+key where that is free.
      'diff.open': 'Ctrl+Shift+G',
      'tab.prev': 'Ctrl+Shift+[',
      'tab.next': 'Ctrl+Shift+]',
      // ⌘⌥ key: Ctrl+Alt is AltGr.
      'focus.left': 'Alt+Shift+←',
      'focus.right': 'Alt+Shift+→',
      'focus.up': 'Alt+Shift+↑',
      'focus.down': 'Alt+Shift+↓',
      'floating-terminal.toggle': 'Ctrl+Shift+A',
      // ⌃ digit → Alt+digit, as before.
      ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => [`tab.go.${n}`, `Alt+${n}`])),
    })
  })

  test('a digit chord follows the physical key: Shift types "!" on it, and AZERTY needs Shift for the digit', () => {
    expect(actionForChord({ key: '!', code: 'Digit1', ...NONE, ctrlKey: true, shiftKey: true }, 'other')).toBe('worktree.go.1')
    expect(actionForChord({ key: '1', code: 'Digit1', ...NONE, ctrlKey: true, shiftKey: true }, 'other')).toBe('worktree.go.1')
    expect(actionForChord({ key: '&', code: 'Digit1', ...NONE, altKey: true }, 'other')).toBe('tab.go.1')
    expect(actionForChord({ key: '2', code: 'Digit2', ...NONE, altKey: true }, 'other')).toBe('tab.go.2')
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
  if (/^[1-9]$/.test(cap)) return { ...e, key: e.shiftKey ? '!@#$%^&*('[Number(cap) - 1] : cap, code: `Digit${cap}` }
  if (cap === '[' || cap === ']') return { ...e, key: e.shiftKey ? (cap === '[' ? '{' : '}') : cap, code: cap === '[' ? 'BracketLeft' : 'BracketRight' }
  throw new Error(`a label names a key this test cannot press: ${cap}`)
}

describe.each(['mac', 'other'] as const)('on %s', (platform) => {
  test('pressing what an action’s label prints runs that action', () => {
    expect(boundActions().length).toBeGreaterThan(30)
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
    expect(shortcutLabel('pane.close-others', platform)).toBeUndefined()
    expect(shortcutKeys('pane.close-others', platform)).toEqual([])
  })
})

// A chord written out by hand is a label its binding can leave behind: every printed shortcut
// of an app action comes from the table. Read as text, comments apart.
test('no source file writes an app chord out by hand', () => {
  const files = import.meta.glob('../**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
  expect(Object.keys(files).length).toBeGreaterThan(200)
  // Not app actions: a view's own key, said per platform where it is printed (`pr-pane`), the
  // keys the desktop MCP parses (`drive`), and the component gallery's samples.
  const own = ['../home/pr-pane.tsx', '../mcp/drive.ts', '../ui/gallery.tsx']
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

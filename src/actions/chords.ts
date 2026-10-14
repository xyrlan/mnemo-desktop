/** The one table of app chords: `actionForKey` binds from it and every printed shortcut is
 *  drawn from it, so a label cannot name a key that does something else. */

export type Platform = 'mac' | 'other'

export function detectPlatform(): Platform {
  return typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac') ? 'mac' : 'other'
}

/** `key` is `KeyboardEvent.key`, lower-cased. `code`, when named, also matches the physical
 *  key: for a key whose character moves with the modifiers (⌥A types "å", Shift+1 types "!"). */
export type Chord = { meta?: true; ctrl?: true; alt?: true; shift?: true; key: string; code?: string }

type Binding = { mac: Chord; other: Chord }

// A Mac has ⌘, which no shell reads. Elsewhere the shell owns plain Ctrl (Ctrl+W, Ctrl+D,
// Ctrl+K…) and AltGr arrives as Ctrl+Alt, so no chord here is plain Ctrl or holds Ctrl with Alt:
//   ⌘ key    → Ctrl+Shift+key  (as Windows Terminal and VS Code do)
//   ⌘⇧ key   → Alt+Shift+key   where Ctrl+Shift+key is now taken (D, W, B) or is the terminal's
//              copy (C); Ctrl+Shift+key where it is free (G, [, ])
//   ⌘⌥ key   → Alt+Shift+arrow, Ctrl+Shift+A
//   ⌃ digit  → Alt+digit
const mod = (key: string): Binding => ({ mac: { meta: true, key }, other: { ctrl: true, shift: true, key } })
const modShift = (key: string, other: Chord): Binding => ({ mac: { meta: true, shift: true, key }, other })
const focus = (key: string): Binding => ({ mac: { meta: true, alt: true, key }, other: { alt: true, shift: true, key } })

const BINDINGS: Record<string, Binding> = {
  'tab.new': mod('t'),
  'pane.split.row': mod('d'),
  'pane.close': mod('w'),
  'dictation.toggle': mod('e'),
  'palette.open': mod('k'),
  'worktree.jump': mod('j'),
  'workspace.new': mod('n'),
  'sidebar.toggle-left': mod('b'),
  'sidebar.toggle-right': mod('l'),
  'pane.split.col': modShift('d', { alt: true, shift: true, key: 'd' }),
  'tab.close': modShift('w', { alt: true, shift: true, key: 'w' }),
  'tab.new-browser': modShift('b', { alt: true, shift: true, key: 'b' }),
  'pane.toggle-face': modShift('c', { alt: true, shift: true, key: 'c' }),
  'diff.open': modShift('g', { ctrl: true, shift: true, key: 'g' }),
  'tab.prev': modShift('[', { ctrl: true, shift: true, key: '[' }),
  'tab.next': modShift(']', { ctrl: true, shift: true, key: ']' }),
  'focus.left': focus('arrowleft'),
  'focus.right': focus('arrowright'),
  'focus.up': focus('arrowup'),
  'focus.down': focus('arrowdown'),
  'floating-terminal.toggle': { mac: { meta: true, alt: true, key: 'a', code: 'KeyA' }, other: { ctrl: true, shift: true, key: 'a' } },
}
for (let n = 1; n <= 9; n++) {
  const key = String(n)
  // With Shift the digit row types "!", "@"…, and some layouts need Shift for the digit itself.
  BINDINGS[`worktree.go.${n}`] = { mac: { meta: true, key }, other: { ctrl: true, shift: true, key, code: `Digit${n}` } }
  BINDINGS[`tab.go.${n}`] = { mac: { ctrl: true, key }, other: { alt: true, key, code: `Digit${n}` } }
}

/** What Shift makes of a key on a US layout. */
const SHIFTED: Record<string, string> = { '[': '{', ']': '}' }

type KeyEvent = Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>

function matches(c: Chord, e: KeyEvent, platform: Platform): boolean {
  if (e.metaKey !== !!c.meta || e.altKey !== !!c.alt || e.shiftKey !== !!c.shift) return false
  // A Mac's ⌘ chords have always fired with ⌃ held too.
  if (e.ctrlKey !== !!c.ctrl && !(platform === 'mac' && c.meta)) return false
  const k = e.key.toLowerCase()
  return k === c.key || (c.shift && k === SHIFTED[c.key]) || (c.code !== undefined && e.code === c.code)
}

export function actionForChord(e: KeyEvent, platform: Platform): string | null {
  for (const id in BINDINGS) if (matches(BINDINGS[id][platform], e, platform)) return id
  return null
}

export function chordFor(id: string, platform: Platform = detectPlatform()): Chord | null {
  return BINDINGS[id]?.[platform] ?? null
}

/** Every action that has a chord. */
export function boundActions(): string[] {
  return Object.keys(BINDINGS)
}

const KEYCAPS: Record<string, string> = { arrowleft: '←', arrowright: '→', arrowup: '↑', arrowdown: '↓' }

/** A chord as its keycaps: `['⌘', '⇧', 'D']` on a Mac, `['Alt', 'Shift', 'D']` elsewhere. */
export function chordKeys(c: Chord, platform: Platform = detectPlatform()): string[] {
  const mac = platform === 'mac'
  const mods = [c.ctrl && (mac ? '⌃' : 'Ctrl'), c.meta && (mac ? '⌘' : 'Win'), c.alt && (mac ? '⌥' : 'Alt'), c.shift && (mac ? '⇧' : 'Shift')]
  return [...mods.filter((m): m is string => !!m), KEYCAPS[c.key] ?? c.key.toUpperCase()]
}

/** The keycaps of the action's chord, or none when it has no chord. */
export function shortcutKeys(id: string, platform: Platform = detectPlatform()): string[] {
  const c = chordFor(id, platform)
  return c ? chordKeys(c, platform) : []
}

/** The action's chord as one string, `⌘⇧D` or `Alt+Shift+D`; undefined when it has none. */
export function shortcutLabel(id: string, platform: Platform = detectPlatform()): string | undefined {
  const keys = shortcutKeys(id, platform)
  return keys.length ? keys.join(platform === 'mac' ? '' : '+') : undefined
}

import type { State } from '../layout/store'
import type { Entry } from './client'

/** POSIX-style path helpers. The Rust side is the authority on what may be read;
 *  these only shape what the user typed into an absolute path. */

export function basename(p: string): string {
  const trimmed = p.replace(/\/+$/, '')
  return trimmed.slice(trimmed.lastIndexOf('/') + 1) || '/'
}

export function dirname(p: string): string {
  const trimmed = p.replace(/\/+$/, '')
  const i = trimmed.lastIndexOf('/')
  return i <= 0 ? '/' : trimmed.slice(0, i)
}

export function join(dir: string, name: string): string {
  return dir.endsWith('/') ? dir + name : `${dir}/${name}`
}

/** Collapses `.`, `..` and repeated slashes of an absolute path. */
export function normalize(p: string): string {
  const out: string[] = []
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') out.pop()
    else out.push(seg)
  }
  return '/' + out.join('/')
}

/** `~` expands to home, an absolute path stays, anything else is relative to `base`. */
export function resolvePath(input: string, base: string, home: string): string {
  const s = input.trim()
  if (s === '~' || s.startsWith('~/')) return normalize(home + s.slice(1))
  if (s.startsWith('/')) return normalize(s)
  return normalize(join(base, s))
}

export type LanguageInfo = { id: string; extensions?: string[]; filenames?: string[] }

/** Exact filename match wins (Dockerfile, Makefile), then the longest matching extension. */
export function languageFor(path: string, languages: LanguageInfo[]): string {
  const name = basename(path)
  const lower = name.toLowerCase()
  for (const l of languages) {
    if (l.filenames?.some((f) => f.toLowerCase() === lower)) return l.id
  }
  let best: { id: string; len: number } | null = null
  for (const l of languages) {
    for (const ext of l.extensions ?? []) {
      if (lower.endsWith(ext.toLowerCase()) && (!best || ext.length > best.len)) best = { id: l.id, len: ext.length }
    }
  }
  return best?.id ?? 'plaintext'
}

/** The tree's default root: the focused terminal's cwd, else any terminal cwd in the
 *  active tab (an editor that just opened as a split is itself focused), else home. */
export function defaultRoot(state: Pick<State, 'tabs' | 'activeTab' | 'panes'>, home: string): string {
  const tab = state.tabs.find((t) => t.id === state.activeTab)
  if (!tab) return home
  const focused = state.panes[tab.focused]
  if (focused?.view === 'terminal' && focused.cwd) return focused.cwd
  const other = Object.values(state.panes).find(
    (p) => p.view === 'terminal' && p.cwd && containsPane(tab.root, p.id),
  )
  return other?.cwd ?? home
}

function containsPane(n: State['tabs'][number]['root'], id: number): boolean {
  return n.kind === 'leaf' ? n.pane === id : containsPane(n.children[0], id) || containsPane(n.children[1], id)
}

const HIDDEN = new Set(['.git', '.DS_Store'])

export function visibleEntries(entries: Entry[]): Entry[] {
  return entries.filter((e) => !HIDDEN.has(e.name))
}

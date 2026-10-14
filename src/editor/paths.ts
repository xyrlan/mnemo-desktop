import type { State } from '../layout/store'
import type { Entry } from './client'
import { basename, dirname, isAbsolute, isWindowsPath, norm } from '../path/path'

/** What the user typed, shaped into an absolute path. The Rust side is the authority on what may
 *  be read. Comparing and naming paths is `src/path/path.ts`'s; a Windows path (`C:\…`, `C:/…`,
 *  `\\?\C:\…`) comes out in git's spelling, `C:/Users/me/a.ts`, which Windows reads as well. */

export { basename, dirname }

export function join(dir: string, name: string): string {
  return (isWindowsPath(dir) ? /[\\/]$/ : /\/$/).test(dir) ? dir + name : `${dir}/${name}`
}

/** Collapses `.`, `..` and repeated separators of an absolute path; `..` stops at the root. */
export function normalize(p: string): string {
  const win = isWindowsPath(p)
  const n = win ? norm(p) : p
  // A drive (`C:`) or a share (`//server/share`) is the root a Windows path cannot climb out of.
  const root = win ? (/^[A-Z]:/.test(n) ? n.slice(0, 2) : n.split('/').slice(0, 4).join('/')) : ''
  const out: string[] = []
  for (const seg of n.slice(root.length).split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') out.pop()
    else out.push(seg)
  }
  return root + '/' + out.join('/')
}

/** `~` expands to home, an absolute path stays, anything else is relative to `base`. */
export function resolvePath(input: string, base: string, home: string): string {
  const s = input.trim()
  if (s === '~' || s.startsWith('~/') || (isWindowsPath(home) && s.startsWith('~\\'))) return normalize(join(home, s.slice(2)))
  if (isAbsolute(s)) return normalize(s)
  return normalize(join(base, s))
}

/** What "Open file…" offers to type on: the root and a separator, in the root's own spelling. */
export function prefill(root: string): string {
  if (/[\\/]$/.test(root)) return root
  return isWindowsPath(root) && root.includes('\\') ? `${root}\\` : `${root}/`
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

/** The default root: the focused terminal's cwd, else any terminal cwd in the
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

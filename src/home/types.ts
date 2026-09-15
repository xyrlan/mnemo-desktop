/** Mirrors `src-tauri/src/home.rs`. */
export type Live = 'here' | 'bg' | 'elsewhere'
export type HomeSession = { id: string; title: string; cwd: string; last_at: number; transcript: boolean; live: Live | null; kind: string }
/** `unresolved`: under a folder macOS guards, grouped by its history path without running git
 *  (see `mission::is_protected`); selecting it resolves it. */
export type HomeRepo = { root: string; name: string; last_at: number; pinned: boolean; hidden: boolean; unresolved: boolean; sessions: HomeSession[] }
export type HomeSnapshot = { repos: HomeRepo[]; clone_base: string; errors: string[] }

export const EMPTY: HomeSnapshot = { repos: [], clone_base: '', errors: [] }

type PaneLike = { id: number; sessionId?: string }

export function paneForSession(panes: Record<number, PaneLike>, sessionId: string): number | null {
  for (const p of Object.values(panes)) if (p.sessionId === sessionId) return p.id
  return null
}

export type Click =
  | { kind: 'focus'; pane: number }
  | { kind: 'command'; cmd: string; sessionId: string }
  | { kind: 'nothing'; why: string }

export const ELSEWHERE = 'aberta em outro terminal'
export const NO_TRANSCRIPT = 'transcript não encontrado'

/** Never fork: a live session is focused or attached, only a dead one is resumed. */
export function whatClickDoes(s: HomeSession, panes: Record<number, PaneLike>): Click {
  if (s.live === 'here') {
    const pane = paneForSession(panes, s.id)
    return pane === null ? { kind: 'nothing', why: ELSEWHERE } : { kind: 'focus', pane }
  }
  if (s.live === 'bg') return { kind: 'command', cmd: `claude attach ${s.id}`, sessionId: s.id }
  if (s.live === 'elsewhere') return { kind: 'nothing', why: ELSEWHERE }
  if (!s.transcript) return { kind: 'nothing', why: NO_TRANSCRIPT }
  return { kind: 'command', cmd: `claude --resume ${s.id}`, sessionId: s.id }
}

export function visibleRepos(repos: HomeRepo[], filter: string, showHidden: boolean): HomeRepo[] {
  const q = filter.trim().toLowerCase()
  return repos.filter((r) => (showHidden || !r.hidden) && (!q || r.name.toLowerCase().includes(q) || r.root.toLowerCase().includes(q)))
}

/** `<base>/<name>` for `owner/repo`, an https URL, or an ssh URL; null when blank. */
export function cloneDest(base: string, spec: string): string | null {
  const s = spec.trim()
  if (!s) return null
  const name = s.replace(/\/+$/, '').split(/[/:]/).pop()?.replace(/\.git$/, '')
  return name ? `${base.replace(/\/+$/, '')}/${name}` : null
}

export function relTime(ms: number, now = Date.now()): string {
  if (!ms) return ''
  const m = Math.round(Math.max(0, now - ms) / 60000)
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 48) return `${h}h`
  return `${Math.round(h / 24)}d`
}

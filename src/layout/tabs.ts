import type { HomeSnapshot } from '../home/types'

/** Home's title for a session (its first real prompt, else its `claude agents` name). */
export function sessionTitle(home: HomeSnapshot, sessionId: string): string | undefined {
  for (const r of home.repos ?? []) {
    const s = r.sessions.find((x) => x.id === sessionId) ?? r.children.find((x) => x.id === sessionId)
    if (s) return s.title || s.agent || undefined
  }
  return undefined
}

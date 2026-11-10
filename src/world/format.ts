import type { SessionState, TokenRow } from './types'

/** A state is a shape first, so it survives a grey screen. */
export const GLYPH: Record<SessionState, string> = { need: '◆', working: '●', ready: '▲', stalled: '✕', idle: '○', ended: '·' }
export const WORD: Record<SessionState, string> = { need: 'needs you', working: 'working', ready: 'ready to merge', stalled: 'stalled', idle: 'your turn', ended: 'ended' }

/** 1234 → "1.2k", 3400000 → "3.4M". */
export function tokens(n: number | null | undefined): string {
  if (n == null) return '–'
  if (n < 1000) return String(Math.round(n))
  if (n < 1e6) return (n / 1e3).toFixed(n < 1e4 ? 1 : 0) + 'k'
  if (n < 1e9) return (n / 1e6).toFixed(n < 1e7 ? 1 : 0) + 'M'
  return (n / 1e9).toFixed(1) + 'B'
}

/** Everything a token row counted: input + output + both caches. */
export const sum = (t: TokenRow | null | undefined): number => (t ? t.input + t.output + t.cacheRead + t.cacheCreation : 0)

/** "40s", "4m", "2h", "3d" from `at` to `now`. */
export function age(at: number | null | undefined, now: number): string {
  if (at == null) return ''
  const s = Math.max(0, (now - at) / 1000)
  if (s < 90) return Math.round(s) + 's'
  if (s < 5400) return Math.round(s / 60) + 'm'
  if (s < 129600) return Math.round(s / 3600) + 'h'
  return Math.round(s / 86400) + 'd'
}

/** A home directory, shortened for the eye. */
export const tilde = (path: string | null | undefined): string => (path ?? '').replace(/\\/g, '/').replace(/^(?:[A-Za-z]:)?\/(?:Users|home)\/[^/]+/, '~')

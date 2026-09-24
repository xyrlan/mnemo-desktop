// adapted from stablyai/orca src/renderer/src/components/cmd-j/palette-session-age.ts
/** Bare compact "how long ago" for the row's age badge: "<1m", "5m", "3h", "2d". */
export function formatAge(lastActiveAt: number | null, now: number): string | undefined {
  if (!lastActiveAt) return undefined
  const deltaMs = now - lastActiveAt
  // Why not "now": the badge feeds `aria-label="Last active … ago"`, and "Last active now ago"
  // reads wrong — keep the token numeric like the other buckets.
  if (deltaMs < 60_000) return '<1m'
  const minutes = Math.floor(deltaMs / 60_000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

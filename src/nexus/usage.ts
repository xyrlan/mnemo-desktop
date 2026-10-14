/** The Nexus's own use, for the measure that credits it (spec Q26): `{event: 'nexus.open'}` when
 *  the drawer opens, and `{event: 'nexus.visible', ms}` for the time it stayed on screen with the
 *  window focused, at least every `BEAT_MS` while open and once more on close. Rows go to
 *  `~/.mnemo-desktop/usage.jsonl` through `usage_log`; nothing leaves the machine.
 *
 *  Returns the stop the drawer calls when it closes. Stub until the `interact` piece lands. */
export const BEAT_MS = 30_000

export function startNexusUsage(_log: (row: Record<string, unknown>) => void, _now: () => number): () => void {
  return () => {}
}

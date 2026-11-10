// Keeping objects the same when what they say is the same. The core answers every poll with
// fresh JSON; a view must not be handed a new object for a session whose data did not change.

/** `next`, built out of `prev`'s own objects wherever the two say the same thing: `prev`
 *  itself when nothing differs at all. Plain JSON-shaped values only (objects, arrays,
 *  primitives). Neither argument is changed. */
export function share<T>(prev: unknown, next: T): T {
  if (Object.is(prev, next)) return next
  if (prev === null || next === null || typeof prev !== 'object' || typeof next !== 'object') return next
  if (Array.isArray(next)) {
    if (!Array.isArray(prev)) return next
    let same = prev.length === next.length
    const out = new Array<unknown>(next.length)
    for (let i = 0; i < next.length; i++) {
      out[i] = share(prev[i], next[i])
      if (out[i] !== prev[i]) same = false
    }
    return (same ? prev : out) as T
  }
  if (Array.isArray(prev)) return next
  const before = prev as Record<string, unknown>
  const after = next as Record<string, unknown>
  const keys = Object.keys(after)
  let same = Object.keys(before).length === keys.length
  const out: Record<string, unknown> = {}
  for (const k of keys) {
    out[k] = share(before[k], after[k])
    if (out[k] !== before[k] || !(k in before)) same = false
  }
  return (same ? prev : out) as T
}

/** `share` for a list whose rows are told apart by an id and may change places: each row is
 *  matched to the one of the same id, wherever it stood. */
export function shareBy<T>(prev: readonly T[] | undefined, next: T[], id: (row: T) => string): T[] {
  if (!prev) return next
  const before = new Map(prev.map((row) => [id(row), row]))
  let same = prev.length === next.length
  const out = next.map((row, i) => {
    const kept = share(before.get(id(row)), row)
    if (kept !== prev[i]) same = false
    return kept
  })
  return same ? (prev as T[]) : out
}

/** One row of `mnemo stale --json`. */
export type StaleRow = { slug: string; reason: string; path: string | null }

const SLUG_KEYS = ['slug', 'rule', 'id', 'name']
const REASON_KEYS = ['reason', 'why', 'status', 'detail', 'message']
const LIST_KEYS = ['stale', 'findings', 'rules', 'results', 'items']
/** `page` is where mnemo 1.7's `findings` put the rule's path. */
const PATH_KEYS = ['path', 'page']

const str = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : null)

/** mnemo 1.7's `missing`: the paths a rule cites that are gone at HEAD, `moved_to` when found
 *  elsewhere. Null when the row has none. */
function missingText(v: unknown): string | null {
  if (!Array.isArray(v)) return null
  const cited = v
    .map((m) => {
      if (typeof m === 'string') return m
      if (!m || typeof m !== 'object') return null
      const o = m as Record<string, unknown>
      const path = str(o.path) ?? str(o.span)
      const moved = str(o.moved_to)
      return path && (moved ? `${path} (now ${moved})` : path)
    })
    .filter((x): x is string => !!x)
  if (!cited.length) return null
  return `cites ${cited.length === 1 ? 'a file' : 'files'} gone at HEAD: ${cited.join(', ')}`
}

function row(v: unknown): StaleRow | null {
  if (typeof v === 'string') return { slug: v, reason: '', path: null }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const o = v as Record<string, unknown>
  const pick = (keys: string[]) => keys.map((k) => str(o[k])).find((x) => !!x) ?? null
  const path = pick(PATH_KEYS)
  const slug = pick(SLUG_KEYS) ?? path
  if (!slug) return null
  const used = new Set([...SLUG_KEYS, ...PATH_KEYS])
  // No reason field: say what else the row carries, `key value` pairs of its scalars.
  const reason =
    pick(REASON_KEYS) ??
    missingText(o.missing) ??
    Object.entries(o)
      .filter(([k, x]) => !used.has(k) && str(x) !== null)
      .map(([k, x]) => `${k} ${str(x)}`)
      .join(' · ')
  return { slug, reason, path }
}

/** The rows `mnemo stale --json` printed, or null when stdout is not that JSON. Takes a bare
 *  list or an object holding one (`{"stale": [...]}`), since the shape is mnemo's to change. */
export function parseStale(stdout: string): StaleRow[] | null {
  let raw: unknown
  try {
    raw = JSON.parse(stdout)
  } catch {
    return null
  }
  let list: unknown = raw
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>
    list = LIST_KEYS.map((k) => o[k]).find(Array.isArray) ?? Object.values(o).find(Array.isArray)
  }
  if (!Array.isArray(list)) return null
  return list.map(row).filter((r): r is StaleRow => !!r)
}

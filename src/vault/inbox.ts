/** `mnemo inbox` has no `--json`: this parses the plain text the CLI already prints
 *  (`docs/contracts/round18.md`, inbox-review). */

export type InboxRow = { key: string; reason: string; ageDays: number; description: string }

export type InboxListing = {
  /** Staged pages in the order `mnemo inbox` printed them. */
  rows: InboxRow[]
  /** The header or empty-queue line, verbatim, for display above the rows. */
  summary: string
  /** Staged for other projects, only nonzero without `--all`. */
  other: number
}

const HEADER = /^\d+ staged pages? .* in shared\/_inbox\/ /
const EMPTY_FOR_PROJECT = /^nothing staged for .+ — (\d+) page/
const ROW = /^\s*(\S+)\s+(\S+)\s+(\d+)d\s+(.*)$/
const OTHER = /\((\d+) more staged for other projects/

/** Rows plus the header line; a queue with nothing staged has no rows and the empty line
 *  as its summary. Unrecognised output (no vault, a refusal) is an empty listing. */
export function parseInboxListing(stdout: string): InboxListing {
  const lines = stdout.split('\n')
  const header = lines.find((l) => HEADER.test(l))
  if (!header) {
    const empty = lines.find((l) => l.trim().startsWith('nothing staged'))
    const m = empty ? EMPTY_FOR_PROJECT.exec(empty) : null
    return { rows: [], summary: empty?.trim() ?? '', other: m ? Number(m[1]) : 0 }
  }
  const rows: InboxRow[] = []
  for (const line of lines) {
    const m = ROW.exec(line)
    if (m) rows.push({ key: m[1], reason: m[2], ageDays: Number(m[3]), description: m[4].trim() })
  }
  const otherLine = lines.find((l) => OTHER.test(l))
  const otherMatch = otherLine ? OTHER.exec(otherLine) : null
  return { rows, summary: header.trim(), other: otherMatch ? Number(otherMatch[1]) : 0 }
}

export type InboxStats = {
  staged: number
  medianAgeDays: number | null
  oldestAgeDays: number | null
  windowDays: number
  offered: number
  promoted: number
  dropped: number
  resolved: number
  /** Only present once a judge-held page has expired unreviewed (#429/#430). */
  expired: number | null
  restored: number | null
  /** Null until a page has been both offered and decided. */
  medianDecisionDays: number | null
}

const DAY = '(?:—|(-?\\d+(?:\\.\\d+)?)d)'
const STATS_HEAD = new RegExp(`^(\\d+) staged in shared/_inbox/ \\(median ${DAY}, oldest ${DAY}\\)$`)
const STATS_WINDOW = /^last (\d+) days: (\d+) offered at session start, (\d+) promoted, (\d+) dropped \((\d+) resolved\)$/
const STATS_EXPIRED = /^held pages expired unreviewed: (\d+), restored: (\d+)/
const STATS_DECISION = /^median offer → decision: (?:(-?\d+(?:\.\d+)?)d|no page has been both offered and decided yet)$/

/** `null` when the text does not look like `mnemo inbox --stats` (a refusal, no vault). */
export function parseInboxStats(stdout: string): InboxStats | null {
  const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean)
  const head = lines.find((l) => STATS_HEAD.test(l))
  const window = lines.find((l) => STATS_WINDOW.test(l))
  if (!head || !window) return null
  const h = STATS_HEAD.exec(head)!
  const w = STATS_WINDOW.exec(window)!
  const expiredLine = lines.find((l) => STATS_EXPIRED.test(l))
  const e = expiredLine ? STATS_EXPIRED.exec(expiredLine) : null
  const decisionLine = lines.find((l) => STATS_DECISION.test(l))
  const d = decisionLine ? STATS_DECISION.exec(decisionLine) : null
  return {
    staged: Number(h[1]),
    medianAgeDays: h[2] ? Number(h[2]) : null,
    oldestAgeDays: h[3] ? Number(h[3]) : null,
    windowDays: Number(w[1]),
    offered: Number(w[2]),
    promoted: Number(w[3]),
    dropped: Number(w[4]),
    resolved: Number(w[5]),
    expired: e ? Number(e[1]) : null,
    restored: e ? Number(e[2]) : null,
    medianDecisionDays: d?.[1] ? Number(d[1]) : null,
  }
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/

/** `--show KEY` prints the staged file raw: frontmatter block (verbatim) and body. No
 *  frontmatter block is not an error — a page that somehow lost its `---` fence still reads. */
export function splitFrontmatter(raw: string): { frontmatter: string; body: string } {
  const m = FRONTMATTER.exec(raw)
  return m ? { frontmatter: m[1], body: m[2] } : { frontmatter: '', body: raw }
}

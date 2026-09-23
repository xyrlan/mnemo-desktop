import type { CSSProperties } from 'react'
import type { DiffHunk } from '../types'
import '../../home/home.css'

/** Lines shown before an Edit/Write diff folds (spec Q4). */
export const DIFF_FOLD = 20

type Row = { key: string; kind: 'hunk'; text: string } | { key: string; kind: 'add' | 'del' | 'ctx' | 'note'; old: number | null; new: number | null; text: string }

/** `structuredPatch` hunks as rows, numbered from each hunk's start. */
export function diffRows(hunks: DiffHunk[]): Row[] {
  const rows: Row[] = []
  hunks.forEach((h, i) => {
    rows.push({ key: `h${i}`, kind: 'hunk', text: `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@` })
    let o = h.oldStart
    let n = h.newStart
    h.lines.forEach((l, j) => {
      const sign = l[0]
      const text = l.slice(1)
      const key = `${i}.${j}`
      if (sign === '+') rows.push({ key, kind: 'add', old: null, new: n++, text })
      else if (sign === '-') rows.push({ key, kind: 'del', old: o++, new: null, text })
      else if (sign === '\\') rows.push({ key, kind: 'note', old: null, new: null, text: l })
      else rows.push({ key, kind: 'ctx', old: o++, new: n++, text })
    })
  })
  return rows
}

export function diffCounts(hunks: DiffHunk[]): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  for (const h of hunks)
    for (const l of h.lines) {
      if (l[0] === '+') additions++
      else if (l[0] === '-') deletions++
    }
  return { additions, deletions }
}

/** The diff an Edit or Write made, in the review diff's look (`src/home/review/`). Folds past
 *  `DIFF_FOLD` changed-or-context lines; `open` shows them all. */
export function DiffBody({ hunks, open, onToggle }: { hunks: DiffHunk[]; open: boolean; onToggle: () => void }) {
  const rows = diffRows(hunks)
  const lines = rows.filter((r) => r.kind !== 'hunk').length
  let left = open ? Infinity : DIFF_FOLD
  const shown: Row[] = []
  for (const r of rows) {
    if (left <= 0) break
    shown.push(r)
    if (r.kind !== 'hunk') left--
  }
  const top = Math.max(0, ...rows.map((r) => (r.kind === 'hunk' ? 0 : Math.max(r.old ?? 0, r.new ?? 0))))
  const style = { '--rv-num': `${Math.max(3, String(top).length)}ch` } as CSSProperties
  return (
    <div className="rv-body cv-diff" style={style}>
      {shown.map((r) =>
        r.kind === 'hunk' ? (
          <div key={r.key} className="rv-hunk">
            {r.text}
          </div>
        ) : (
          <div key={r.key} className={`rv-line rv-${r.kind}`}>
            <span className="rv-num">{r.old ?? ''}</span>
            <span className="rv-num">{r.new ?? ''}</span>
            <span className="rv-sign">{r.kind === 'add' ? '+' : r.kind === 'del' ? '-' : ''}</span>
            <span className="rv-text">{r.text}</span>
          </div>
        ),
      )}
      {lines > DIFF_FOLD && (
        <button className="cv-more" onClick={onToggle}>
          {open ? 'fold' : `show all ${lines} lines`}
        </button>
      )}
    </div>
  )
}

/** A line diff for the quick-diff popover: the lines of `a` and `b` in order, each kept (` `),
 *  removed (`-`) or added (`+`), cut to hunks with `context` kept lines around each change. */

export type DiffLine = { sign: ' ' | '-' | '+'; text: string }
export type Hunk = { lines: DiffLine[]; skipped: number }

/** Past this many cells (lines × lines between the first and last change) the middle is drawn as
 *  removed then added: still every line, with no pairing. */
const MAX_CELLS = 4_000_000

export function lineDiff(a: string, b: string): DiffLine[] {
  const A = a === '' ? [] : a.split('\n')
  const B = b === '' ? [] : b.split('\n')
  let start = 0
  while (start < A.length && start < B.length && A[start] === B[start]) start++
  let endA = A.length
  let endB = B.length
  while (endA > start && endB > start && A[endA - 1] === B[endB - 1]) {
    endA--
    endB--
  }
  const out: DiffLine[] = A.slice(0, start).map((text) => ({ sign: ' ', text }))
  const n = endA - start
  const m = endB - start
  if (n * m > MAX_CELLS) {
    for (let i = start; i < endA; i++) out.push({ sign: '-', text: A[i] })
    for (let j = start; j < endB; j++) out.push({ sign: '+', text: B[j] })
  } else {
    // Longest common subsequence of the middle, row by row from the end.
    const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[start + i] === B[start + j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1])
    let i = 0
    let j = 0
    while (i < n && j < m) {
      if (A[start + i] === B[start + j]) {
        out.push({ sign: ' ', text: A[start + i] })
        i++
        j++
      } else if (L[i + 1][j] >= L[i][j + 1]) out.push({ sign: '-', text: A[start + i++] })
      else out.push({ sign: '+', text: B[start + j++] })
    }
    while (i < n) out.push({ sign: '-', text: A[start + i++] })
    while (j < m) out.push({ sign: '+', text: B[start + j++] })
  }
  for (let i = endA; i < A.length; i++) out.push({ sign: ' ', text: A[i] })
  return out
}

/** The changed lines with `context` kept lines around each; `skipped`: kept lines left out before
 *  the hunk. */
export function hunks(lines: DiffLine[], context = 3): Hunk[] {
  const keep = new Uint8Array(lines.length)
  lines.forEach((l, i) => {
    if (l.sign === ' ') return
    for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++) keep[k] = 1
  })
  const out: Hunk[] = []
  let skipped = 0
  let cur: Hunk | null = null
  lines.forEach((l, i) => {
    if (!keep[i]) {
      skipped++
      cur = null
      return
    }
    if (!cur) {
      cur = { lines: [], skipped }
      out.push(cur)
      skipped = 0
    }
    cur.lines.push(l)
  })
  return out
}

export const counts = (lines: DiffLine[]) => ({ added: lines.filter((l) => l.sign === '+').length, removed: lines.filter((l) => l.sign === '-').length })

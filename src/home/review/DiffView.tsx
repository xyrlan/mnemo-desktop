import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { initiallyOpen, isGenerated, PAGE, totals, type FileDiff, type FileStatus, type Review } from './types'

const STATUS: Record<FileStatus, [string, string]> = {
  added: ['A', 'added'],
  deleted: ['D', 'deleted'],
  renamed: ['R', 'renamed'],
  modified: ['M', 'modified'],
}

/** A request to show one file: its path, and a counter so picking the same file twice
 *  scrolls to it twice. */
export type Focus = { path: string; n: number }

export function Counts({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <span className="rv-counts">
      <span className="rv-plus">+{additions}</span> <span className="rv-minus">−{deletions}</span>
    </span>
  )
}

/** The sidebar's list of changed files; a pick opens that file in the diff and scrolls to it. */
export function FileList({ files, onPick }: { files: FileDiff[]; onPick: (path: string) => void }) {
  return (
    <ul className="rv-list">
      {files.map((f) => {
        const slash = f.path.lastIndexOf('/')
        return (
          <li key={f.path}>
            <button className="rv-list-row" title={f.path} onClick={() => onPick(f.path)}>
              <span className={`rv-status rv-${f.status}`} title={STATUS[f.status][1]}>
                {STATUS[f.status][0]}
              </span>
              <span className="rv-list-name">
                {f.path.slice(slash + 1)}
                {slash > 0 && <span className="rv-list-dir"> {f.path.slice(0, slash)}</span>}
              </span>
              <Counts additions={f.additions} deletions={f.deletions} />
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/** One file's hunks, `shown` diff lines of them: a file of thousands draws a page at a time. */
function FileBody({ file, shown, onMore, unread }: { file: FileDiff; shown: number; onMore: () => void; unread: boolean }) {
  if (file.binary) return <div className="rv-msg">binary file, not shown</div>
  const kept = file.hunks.reduce((s, h) => s + h.lines.length, 0)
  // Without a diff the list came from `gh pr view`: no hunks is then not "no change".
  if (!kept && unread) return <div className="rv-msg">gh gave no diff to show; it is on GitHub</div>
  if (!kept && !file.truncated) return <div className="rv-msg">no content change</div>
  // Wide enough for the largest line number either side reaches.
  const last = file.hunks.at(-1)?.lines ?? []
  const top = Math.max(0, ...last.map((l) => Math.max(l.old ?? 0, l.new ?? 0)))
  const style = { '--rv-num': `${Math.max(3, String(top).length)}ch` } as CSSProperties
  let left = shown
  const rows = []
  for (const [i, h] of file.hunks.entries()) {
    if (left <= 0) break
    rows.push(
      <div key={`h${i}`} className="rv-hunk">
        {h.header}
      </div>,
    )
    for (const [j, l] of h.lines.slice(0, left).entries()) {
      rows.push(
        <div key={`${i}.${j}`} className={`rv-line rv-${l.kind}`}>
          <span className="rv-num">{l.old ?? ''}</span>
          <span className="rv-num">{l.new ?? ''}</span>
          <span className="rv-sign">{l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ''}</span>
          <span className="rv-text">
            {l.text}
            {l.cut && (
              <span className="rv-cut" title="the rest of this line is not shown">
                …
              </span>
            )}
          </span>
        </div>,
      )
    }
    left -= h.lines.length
  }
  const rest = kept - shown
  return (
    <div className="rv-body" style={style}>
      {rows}
      {rest > 0 && (
        <button className="hm-link rv-more" onClick={onMore}>
          show {Math.min(rest, PAGE)} more of {rest} lines
        </button>
      )}
      {rest <= 0 && file.truncated && <div className="rv-msg">the rest of this file is past what the view reads; it is on GitHub</div>}
    </div>
  )
}

/** The change, file by file. Files open while they fit in the opening budget; the rest start
 *  folded, so a PR of thousands of lines draws in the time a small one does. */
export default function DiffView({ review, focus, onGithub }: { review: Review; focus: Focus | null; onGithub: () => void }) {
  const [open, setOpen] = useState(() => initiallyOpen(review.files))
  const [shown, setShown] = useState<Record<string, number>>({})
  const sections = useRef(new Map<string, HTMLElement>())

  useEffect(() => {
    if (!focus) return
    setOpen((o) => (o.has(focus.path) ? o : new Set(o).add(focus.path)))
    sections.current.get(focus.path)?.scrollIntoView?.({ block: 'start' })
  }, [focus])

  const toggle = (path: string) =>
    setOpen((o) => {
      const next = new Set(o)
      if (!next.delete(path)) next.add(path)
      return next
    })
  const t = totals(review.files)
  return (
    <div className="rv">
      <div className="rv-bar">
        <span>
          {t.files} {t.files === 1 ? 'file' : 'files'}
        </span>
        <Counts additions={t.additions} deletions={t.deletions} />
        {review.base && (
          <span className="hm-muted rv-refs">
            {review.base} ← {review.head}
          </span>
        )}
      </div>
      {review.diff_error && (
        <div className="rv-warn">
          <span>gh gave no diff: {review.diff_error}</span>
          <button className="hm-btn" onClick={onGithub}>
            Read it on GitHub
          </button>
        </div>
      )}
      {review.truncated && !review.diff_error && <div className="rv-warn">This diff is longer than the view reads. The files it stops at say so.</div>}
      <div className="rv-files">
        {review.files.map((f) => {
          const isOpen = open.has(f.path)
          return (
            <section
              key={f.path}
              className="rv-file"
              data-path={f.path}
              ref={(el) => {
                if (el) sections.current.set(f.path, el)
                else sections.current.delete(f.path)
              }}
            >
              <button className="rv-file-head" aria-expanded={isOpen} onClick={() => toggle(f.path)}>
                <span className="rv-caret">{isOpen ? '▾' : '▸'}</span>
                <span className={`rv-status rv-${f.status}`} title={STATUS[f.status][1]}>
                  {STATUS[f.status][0]}
                </span>
                <span className="rv-path">{f.old_path ? `${f.old_path} → ${f.path}` : f.path}</span>
                {!isOpen && isGenerated(f.path) && <span className="hm-agent">generated</span>}
                <Counts additions={f.additions} deletions={f.deletions} />
              </button>
              {isOpen && (
                <FileBody
                  file={f}
                  shown={shown[f.path] ?? PAGE}
                  unread={!!review.diff_error}
                  onMore={() => setShown((s) => ({ ...s, [f.path]: (s[f.path] ?? PAGE) + PAGE }))}
                />
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}

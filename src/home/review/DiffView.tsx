// adapted from stablyai/orca src/renderer/src/components/pull-request-page/files/toolbar.tsx and
// page/tabs-shell.tsx (the files tab's toolbar, file sections and empty states; MIT, 122b8c25)
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { ChevronDown, ExternalLink, TriangleAlert } from 'lucide-react'
import { Badge, Button } from '@/ui'
import { cn } from '@/ui/cn'
import { initiallyOpen, isGenerated, PAGE, totals, type FileDiff, type FileStatus, type Review } from './types'

/** Orca's status letters and tones (the Source Control panel's). */
const STATUS: Record<FileStatus, { letter: string; label: string; tone: string }> = {
  added: { letter: 'A', label: 'added', tone: 'text-status-success' },
  deleted: { letter: 'D', label: 'deleted', tone: 'text-destructive' },
  renamed: { letter: 'R', label: 'renamed', tone: 'text-primary' },
  modified: { letter: 'M', label: 'modified', tone: 'text-status-warning' },
}

function Status({ status }: { status: FileStatus }) {
  const s = STATUS[status]
  return (
    <span className={cn('rv-status w-3 shrink-0 text-center font-mono text-[10px] font-bold', s.tone)} title={s.label}>
      {s.letter}
    </span>
  )
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

/** The side column's list of changed files; a pick opens that file in the diff and scrolls to it. */
export function FileList({ files, onPick }: { files: FileDiff[]; onPick: (path: string) => void }) {
  return (
    <ul className="rv-list flex flex-col">
      {files.map((f) => {
        const slash = f.path.lastIndexOf('/')
        return (
          <li key={f.path}>
            <button
              type="button"
              className="rv-list-row flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left text-xs text-foreground transition-colors hover:bg-accent/60"
              title={f.path}
              onClick={() => onPick(f.path)}
            >
              <Status status={f.status} />
              <span className="rv-list-name min-w-0 flex-1 truncate">
                {f.path.slice(slash + 1)}
                {slash > 0 && <span className="rv-list-dir text-[11px] text-muted-foreground"> {f.path.slice(0, slash)}</span>}
              </span>
              <Counts additions={f.additions} deletions={f.deletions} />
            </button>
          </li>
        )
      })}
    </ul>
  )
}

const MSG = 'rv-msg px-3 py-2 text-xs text-muted-foreground'

/** One file's hunks, `shown` diff lines of them: a file of thousands draws a page at a time. */
function FileBody({ file, shown, onMore, unread }: { file: FileDiff; shown: number; onMore: () => void; unread: boolean }) {
  if (file.binary) return <div className={MSG}>binary file, not shown</div>
  const kept = file.hunks.reduce((s, h) => s + h.lines.length, 0)
  // Without a diff the list came from `gh pr view`: no hunks is then not "no change".
  if (!kept && unread) return <div className={MSG}>gh gave no diff to show; it is on GitHub</div>
  if (!kept && !file.truncated) return <div className={MSG}>no content change</div>
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
        <button
          type="button"
          className="rv-more block w-full border-t border-border/60 px-3 py-1.5 text-left font-sans text-xs text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
          onClick={onMore}
        >
          show {Math.min(rest, PAGE)} more of {rest} lines
        </button>
      )}
      {rest <= 0 && file.truncated && <div className={cn(MSG, 'font-sans')}>the rest of this file is past what the view reads; it is on GitHub</div>}
    </div>
  )
}

/** A warning strip under the toolbar: why the view shows less than the PR has. */
function Warn({ children }: { children: ReactNode }) {
  return (
    <div className="rv-warn flex flex-none items-center gap-3 border-b border-status-warning-border bg-status-warning-background px-4 py-2 text-xs text-status-warning">
      <TriangleAlert className="size-3.5 shrink-0" />
      {children}
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
    <div className="rv flex min-h-0 flex-1 flex-col">
      <div className="rv-bar flex flex-none items-center gap-3 border-b border-border bg-background px-4 py-1.5 text-xs">
        <span className="text-muted-foreground">
          {t.files} {t.files === 1 ? 'file' : 'files'}
        </span>
        <Counts additions={t.additions} deletions={t.deletions} />
      </div>
      {review.diff_error && (
        <Warn>
          <span className="min-w-0 flex-1">gh gave no diff: {review.diff_error}</span>
          <Button type="button" variant="outline" size="xs" onClick={onGithub}>
            <ExternalLink />
            Read it on GitHub
          </Button>
        </Warn>
      )}
      {review.truncated && !review.diff_error && (
        <Warn>
          <span>This diff is longer than the view reads. The files it stops at say so.</span>
        </Warn>
      )}
      <div className="rv-files flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-4 pt-3 pb-6 scrollbar-sleek">
        {review.files.map((f) => {
          const isOpen = open.has(f.path)
          return (
            <section
              key={f.path}
              className="rv-file flex-none overflow-clip rounded-lg border border-border/60 bg-card shadow-xs"
              data-path={f.path}
              ref={(el) => {
                if (el) sections.current.set(f.path, el)
                else sections.current.delete(f.path)
              }}
            >
              <button
                type="button"
                className={cn(
                  'rv-file-head sticky -top-3 z-[1] flex w-full items-center gap-2 bg-muted/60 px-3 py-1.5 text-left text-xs text-foreground backdrop-blur-sm transition-colors hover:bg-muted',
                  isOpen && 'border-b border-border/60',
                )}
                aria-expanded={isOpen}
                onClick={() => toggle(f.path)}
              >
                <ChevronDown className={cn('size-3 shrink-0 text-muted-foreground transition-transform', !isOpen && '-rotate-90')} />
                <Status status={f.status} />
                <span className="rv-path min-w-0 flex-1 truncate font-mono text-[12px]">{f.old_path ? `${f.old_path} → ${f.path}` : f.path}</span>
                {!isOpen && isGenerated(f.path) && (
                  <Badge variant="outline" className="rv-generated h-4 px-1.5 text-[10px] font-normal text-muted-foreground">
                    generated
                  </Badge>
                )}
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

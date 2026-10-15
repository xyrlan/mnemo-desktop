import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ChangeList, ChangedFile, DiffClient, FileSides } from '../../diff/client'
import { basename } from '../../path/path'
import { pollWhileShown } from '../../shell/while-shown'
import { counts, hunks, lineDiff } from './line-diff'

/** The files a session changed, as chips under its header, and the quick diff a chip opens. Both
 *  read the session's worktree against the repo's default branch, as the child's Diff does: a
 *  child commits as it goes, so its commits count. */

/** How often the chips are read again while their tab is shown. */
export const CHANGES_MS = 10_000
/** Chips drawn before the rest fold into `+N`. */
const MAX_CHIPS = 12

export function useChanges(diff: DiffClient, worktree: string | null, shown: boolean): { list: ChangeList | null; error: string | null } {
  const [list, setList] = useState<ChangeList | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!worktree || !shown) return
    let live = true
    const stop = pollWhileShown(async () => {
      try {
        const l = await diff.files(worktree, '')
        if (live) {
          setList(l)
          setError(null)
        }
      } catch (e) {
        if (live) setError(String(e))
      }
    }, CHANGES_MS)
    return () => {
      live = false
      stop()
    }
  }, [diff, worktree, shown])
  return { list, error }
}

export type DiffAsk = { worktree: string; file: ChangedFile; anchor: { left: number; bottom: number } }

export function Chips({ list, error, picked, onPick }: { list: ChangeList | null; error: string | null; picked: string | null; onPick(file: ChangedFile, el: HTMLElement): void }) {
  if (error) return <div className="truncate px-3 py-1 text-[11px] text-muted-foreground" title={error}>Changed files unavailable: {error}</div>
  if (!list) return <div className="px-3 py-1 text-[11px] text-muted-foreground">Reading changed files…</div>
  if (!list.files.length) return <div className="px-3 py-1 text-[11px] text-muted-foreground">No file changed yet</div>
  const more = list.files.length - MAX_CHIPS + (list.truncated ? 1 : 0)
  return (
    <div className="flex flex-wrap items-center gap-1 px-3 py-1 text-[11px]" data-drawer-changes="">
      <span className="text-muted-foreground">changed:</span>
      {list.files.slice(0, MAX_CHIPS).map((f) => (
        <button
          key={f.path}
          type="button"
          data-file-chip={f.path}
          aria-pressed={picked === f.path}
          title={`${f.path}: quick diff`}
          className="rounded-sm border border-border px-1.5 text-foreground hover:border-ring aria-pressed:border-ring aria-pressed:bg-accent"
          onClick={(e) => onPick(f, e.currentTarget)}
        >
          {basename(f.path)}
          {f.additions !== null && <span className="ml-1 text-muted-foreground">+{f.additions}</span>}
          {f.deletions !== null && <span className="ml-0.5 text-muted-foreground">−{f.deletions}</span>}
        </button>
      ))}
      {more > 0 && <span className="text-muted-foreground">+{list.truncated ? `${more - 1}…` : more}</span>}
    </div>
  )
}

/** One file's diff, in a popover under its chip. Esc, a click outside it, or its button closes it. */
export function QuickDiff({ diff, ask, onClose }: { diff: DiffClient; ask: DiffAsk; onClose(): void }) {
  const { worktree, file } = ask
  const [sides, setSides] = useState<FileSides | null>(null)
  const [error, setError] = useState<string | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const [left, setLeft] = useState(ask.anchor.left)

  useEffect(() => {
    let live = true
    setSides(null)
    setError(null)
    diff.sides(worktree, file.path, file.oldPath, '').then(
      (s) => live && setSides(s),
      (e) => live && setError(String(e)),
    )
    return () => {
      live = false
    }
  }, [diff, worktree, file.path, file.oldPath])

  // Kept inside the window.
  useLayoutEffect(() => {
    const w = box.current?.offsetWidth ?? 0
    setLeft(Math.max(8, Math.min(window.innerWidth - w - 8, ask.anchor.left)))
  }, [ask.anchor.left])

  useEffect(() => {
    const down = (e: MouseEvent) => {
      const t = e.target as Element | null
      if (box.current?.contains(t) || t?.closest?.('[data-file-chip]')) return
      onClose()
    }
    document.addEventListener('mousedown', down)
    return () => document.removeEventListener('mousedown', down)
  }, [onClose])

  const lines = sides && !sides.binary && !sides.tooLarge ? lineDiff(sides.original, sides.modified) : null
  const n = lines ? counts(lines) : null
  return (
    <div
      ref={box}
      data-quick-diff={file.path}
      role="dialog"
      aria-label={`Diff of ${file.path}`}
      className="fixed z-popover flex max-h-[62vh] w-[min(640px,90vw)] flex-col overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-lg"
      style={{ left, top: ask.anchor.bottom + 6 }}
    >
      <div className="flex items-baseline gap-2 border-b border-border px-3 py-1.5 text-xs">
        <b className="shrink-0">{basename(file.path)}</b>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{file.path}</span>
        {n && (
          <span className="shrink-0">
            <span className="text-state-done">+{n.added}</span> <span className="text-destructive">−{n.removed}</span>
          </span>
        )}
        <button type="button" className="shrink-0 rounded-sm border border-border px-1 text-[10px] text-muted-foreground hover:text-foreground" onClick={onClose}>
          esc
        </button>
      </div>
      <div className="min-h-0 overflow-auto py-1 font-mono text-[12px]">
        {error && <p className="px-3 py-2 text-muted-foreground">{error}</p>}
        {!error && !sides && <p className="px-3 py-2 text-muted-foreground">Reading the diff…</p>}
        {sides && (sides.binary || sides.tooLarge) && <p className="px-3 py-2 text-muted-foreground">{sides.binary ? 'A binary file: no line diff.' : 'Too large for a quick diff.'}</p>}
        {lines && !lines.some((l) => l.sign !== ' ') && <p className="px-3 py-2 text-muted-foreground">No line changed.</p>}
        {lines &&
          hunks(lines).map((h, i) => (
            <div key={i}>
              {h.skipped > 0 && <div className="px-3 pt-2 text-[10px] text-muted-foreground">⋯ {h.skipped} unchanged</div>}
              {h.lines.map((l, j) => (
                <div
                  key={j}
                  className={
                    l.sign === '+'
                      ? 'min-h-[1.4em] whitespace-pre bg-state-done/10 px-3'
                      : l.sign === '-'
                        ? 'min-h-[1.4em] whitespace-pre bg-destructive/10 px-3'
                        : 'min-h-[1.4em] whitespace-pre px-3 text-muted-foreground'
                  }
                >
                  <i className="inline-block w-[2ch] not-italic opacity-60">{l.sign === ' ' ? '' : l.sign}</i>
                  {l.text}
                </div>
              ))}
            </div>
          ))}
      </div>
    </div>
  )
}

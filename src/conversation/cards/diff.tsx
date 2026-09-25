// adapted from stablyai/orca src/renderer/src/components/native-chat/NativeChatDiffCard.tsx
import { useMemo } from 'react'
import { ChevronRight, FilePen, FilePlus2 } from 'lucide-react'
import { cn } from '@/ui/cn'
import type { DiffHunk } from '../types'
import { useCards } from './context'
import { CopyButton } from './copy'

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

/** `+12 -3`, each side only when it counts. */
export function DiffCounts({ additions, deletions }: { additions: number; deletions: number }) {
  if (!additions && !deletions) return null
  return (
    <span className="shrink-0 font-mono text-[11px] tabular-nums" aria-label={`${additions} added, ${deletions} removed`}>
      {additions > 0 && <span className="text-status-success">+{additions}</span>}
      {additions > 0 && deletions > 0 && ' '}
      {deletions > 0 && <span className="text-destructive">-{deletions}</span>}
    </span>
  )
}

const baseName = (path: string) => path.split(/[\\/]/).at(-1) || path

/** What the card says the change is. `proposed`: asked for, not made yet (a permission prompt
 *  is about it), so its line numbers are only where the snippet starts. */
export type DiffVerb = 'edited' | 'added' | 'proposed'
const VERB: Record<DiffVerb, string> = { edited: 'Edited file', added: 'Added file', proposed: 'Wants to edit' }

/** One file an agent edited: verb header, name with counts and a copy of the patch, and the
 *  unified rows in a scrolling box. Opens with the run that holds it; its header folds it. */
export function DiffCard({ filePath, hunks, verb, k, open: dflt = true }: { filePath: string; hunks: DiffHunk[]; verb: DiffVerb; k: string; open?: boolean }) {
  const { isOpen, toggle } = useCards()
  const open = isOpen(k, dflt)
  const rows = useMemo(() => diffRows(hunks), [hunks])
  const { additions, deletions } = diffCounts(hunks)
  const patch = useMemo(() => hunks.flatMap((h) => h.lines).join('\n'), [hunks])
  const hasBody = rows.some((r) => r.kind !== 'hunk')
  const numbered = verb !== 'proposed'
  const widest = numbered ? Math.max(0, ...rows.map((r) => (r.kind === 'hunk' ? 0 : ((r.kind === 'del' ? r.old : r.new) ?? 0)))) : 0
  const gutter = numbered ? Math.max(3, String(widest).length + 1) : 0
  const Icon = verb === 'added' ? FilePlus2 : FilePen
  return (
    <div className="cv-diff my-1 overflow-hidden rounded-md border border-border" data-verb={verb}>
      <button
        type="button"
        onClick={() => hasBody && toggle(k)}
        className={cn('group/diff-card flex w-full items-center gap-1.5 px-2 py-1 text-left', hasBody ? 'cursor-pointer hover:bg-accent/30' : 'cursor-default')}
        aria-expanded={hasBody ? open : undefined}
      >
        <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="shrink-0 text-[11px] text-muted-foreground group-hover/diff-card:text-foreground/80">{VERB[verb]}</span>
        {hasBody && <ChevronRight className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} aria-hidden />}
      </button>
      <div className="flex items-center gap-1.5 border-t border-border bg-accent/40 px-2 py-1">
        <span className="min-w-0 truncate font-mono text-[11px] font-medium text-foreground" title={filePath}>
          {baseName(filePath)}
        </span>
        <DiffCounts additions={additions} deletions={deletions} />
        <CopyButton text={patch} label="Copy diff" className="ml-auto" />
      </div>
      {hasBody && open && (
        // Focusable so the rows scroll from the keyboard.
        <div tabIndex={0} className="scrollbar-sleek max-h-72 overflow-auto font-mono text-[11px] leading-relaxed focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:outline-none focus-visible:ring-inset">
          {rows.map((r) =>
            r.kind === 'hunk' ? (
              // Between two regions of the file only: the first needs no break before it.
              r.key !== 'h0' && (
              <div key={r.key} role="separator" aria-label="Lines not shown" className="cv-diff-gap border-y border-border/60 bg-accent/30 py-0.5 text-center text-muted-foreground select-none">
                ⋯
              </div>
              )
            ) : (
              <div key={r.key} className={cn('cv-diff-row flex items-start', `cv-diff-${r.kind}`, r.kind === 'add' && 'bg-emerald-500/10', r.kind === 'del' && 'bg-rose-500/10')}>
                {gutter > 0 && (
                  <span
                    className={cn('shrink-0 pr-1.5 text-right text-muted-foreground tabular-nums select-none', r.kind === 'add' ? 'bg-emerald-500/15' : r.kind === 'del' ? 'bg-rose-500/15' : 'bg-accent/40')}
                    style={{ width: `${gutter}ch` }}
                    aria-hidden
                  >
                    {(r.kind === 'del' ? r.old : r.new) ?? ''}
                  </span>
                )}
                <span className={cn('w-3 shrink-0 text-center select-none', r.kind === 'add' && 'text-status-success', r.kind === 'del' && 'text-destructive')} aria-hidden>
                  {r.kind === 'add' ? '+' : r.kind === 'del' ? '-' : ' '}
                </span>
                <span className={cn('min-w-0 pr-2 break-words whitespace-pre-wrap', r.kind === 'note' ? 'text-muted-foreground italic' : 'text-foreground/85')}>{r.text}</span>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  )
}

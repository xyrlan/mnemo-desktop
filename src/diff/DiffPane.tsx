import { lazy, Suspense, useEffect, useMemo, useState, type ComponentType } from 'react'
import type { StoreApi } from 'zustand/vanilla'
import { useStore } from 'zustand'
import { Columns2, GitCommitHorizontal, GitCompareArrows, MessageSquare, RotateCw, Rows2, SendHorizontal } from 'lucide-react'
import { Button } from '@/ui'
import { cn } from '@/ui/cn'
import type { PaneViewProps } from '../panes/registry'
import type { ChangedFile } from './client'
import type { DiffEditorProps } from './DiffEditor'
import { sidesKey, type DiffState } from './store'
import './diff.css'

/** Monaco loads with the first diff shown, never at boot. */
const LazyDiffEditor: ComponentType<DiffEditorProps> = lazy(() => import('./DiffEditor'))

const LETTER: Record<ChangedFile['status'], { letter: string; tone: string; label: string }> = {
  added: { letter: 'A', tone: 'text-status-success', label: 'added' },
  untracked: { letter: 'U', tone: 'text-status-success', label: 'untracked' },
  modified: { letter: 'M', tone: 'text-status-warning', label: 'modified' },
  deleted: { letter: 'D', tone: 'text-destructive', label: 'deleted' },
  renamed: { letter: 'R', tone: 'text-primary', label: 'renamed' },
  conflicted: { letter: '!', tone: 'text-destructive', label: 'conflicted' },
}

const baseOf = (p: string) => p.slice(p.lastIndexOf('/') + 1)
const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
const folderName = (p: string) => baseOf(p.replace(/\/+$/, '')) || p

export type DiffPaneProps = PaneViewProps & {
  store: StoreApi<DiffState>
  /** The Commit… button: the commit composer for the worktree shown. */
  onCommit(): void
}

function FileRow({ file, notes, on, onPick }: { file: ChangedFile; notes: number; on: boolean; onPick(): void }) {
  const s = LETTER[file.status]
  const dir = dirOf(file.path)
  return (
    <button
      type="button"
      data-file={file.path}
      aria-current={on || undefined}
      title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
      onClick={onPick}
      className={cn(
        'flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-[13px] text-foreground hover:bg-accent/60',
        on && 'bg-accent',
      )}
    >
      <span className={cn('w-3 shrink-0 text-center font-mono text-[11px] font-semibold', s.tone)} aria-label={s.label}>
        {s.letter}
      </span>
      <span className="min-w-0 flex-1 truncate">
        <span className={cn(file.status === 'deleted' && 'line-through decoration-muted-foreground/60')}>{baseOf(file.path)}</span>
        {dir && <span className="ml-1.5 text-[11px] text-muted-foreground">{dir}</span>}
      </span>
      {notes > 0 && (
        <span className="flex shrink-0 items-center gap-0.5 text-[11px] text-primary" title={`${notes} ${notes === 1 ? 'note' : 'notes'}`}>
          <MessageSquare className="size-3" />
          {notes}
        </span>
      )}
      {file.binary ? (
        <span className="shrink-0 text-[11px] text-muted-foreground">bin</span>
      ) : (
        <span className="shrink-0 font-mono text-[11px] tabular-nums">
          {file.additions ? <span className="text-status-success">+{file.additions}</span> : null}
          {file.deletions ? <span className="ml-1 text-destructive">−{file.deletions}</span> : null}
        </span>
      )}
    </button>
  )
}

function Notice({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'muted' | 'error' }) {
  return (
    <div className={cn('flex h-full items-center justify-center p-6 text-center text-[13px]', tone === 'error' ? 'text-destructive' : 'text-muted-foreground')}>
      <div className="max-w-md">{children}</div>
    </div>
  )
}

/** A worktree's uncommitted changes, file by file, with notes for its agent: the files on the
 *  left, the chosen one's diff on the right. Notes are written on lines of the diff and go to the
 *  worktree's agent together, in one message; Commit… opens the commit composer. */
export function DiffPane({ props, store, onCommit }: DiffPaneProps) {
  const worktree = typeof props.worktree === 'string' ? props.worktree : ''
  const changes = useStore(store, (s) => s.changes[worktree])
  const allComments = useStore(store, (s) => s.comments)
  const sent = useStore(store, (s) => s.sent[worktree])
  const [picked, setPicked] = useState<string | null>(null)
  // Inline first: a pane beside two sidebars is rarely wide enough for two columns of code.
  const [sideBySide, setSideBySide] = useState(false)

  const files = changes?.list?.files
  const file = files?.find((f) => f.path === picked) ?? files?.[0] ?? null
  const sides = useStore(store, (s) => (file ? s.sides[sidesKey(worktree, file.path)] : undefined))
  const comments = useMemo(() => allComments.filter((c) => c.worktreeId === worktree), [allComments, worktree])
  const notesByFile = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of comments) m.set(c.filePath, (m.get(c.filePath) ?? 0) + 1)
    return m
  }, [comments])

  useEffect(() => {
    if (!worktree) return
    void store.getState().load(worktree)
    // An agent works while the diff is open: coming back to the window reads the changes again.
    const again = () => void store.getState().load(worktree)
    window.addEventListener('focus', again)
    return () => window.removeEventListener('focus', again)
  }, [store, worktree])

  // A re-read list hands a new but equal file, so the file is keyed by its paths; its sides are
  // dropped on every re-read, and read again here.
  const fileKey = file ? `${file.path}\0${file.oldPath ?? ''}` : null
  const unread = sides === undefined
  useEffect(() => {
    if (!file || !worktree) return
    void store.getState().loadSides(worktree, file.path, file.oldPath)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, worktree, fileKey, unread])

  if (!worktree) {
    return (
      <div className="pane-body diff-pane" data-ui>
        <Notice>No worktree is open: pick one in the sidebar, then open its changes.</Notice>
      </div>
    )
  }

  const totals = (files ?? []).reduce((t, f) => ({ add: t.add + (f.additions ?? 0), del: t.del + (f.deletions ?? 0) }), { add: 0, del: 0 })
  const st = store.getState()
  const loading = changes?.loading ?? true

  let body: React.ReactNode
  if (changes?.error && !changes.list) body = <Notice tone="error">Could not read the changes: {changes.error}</Notice>
  else if (!files) body = <Notice>Reading the changes…</Notice>
  else if (!file) body = <Notice>No uncommitted changes in {folderName(worktree)}.</Notice>
  else if (sides?.error) body = <Notice tone="error">Could not read {file.path}: {sides.error}</Notice>
  else if (!sides?.data) body = <Notice>Reading {baseOf(file.path)}…</Notice>
  else if (sides.data.binary || file.binary) body = <Notice>{file.path} is a binary file: no text diff to show.</Notice>
  else if (sides.data.tooLarge) body = <Notice>{file.path} is too large to diff here.</Notice>
  else
    body = (
      <Suspense fallback={<Notice>Loading the editor…</Notice>}>
        <LazyDiffEditor
          worktree={worktree}
          file={file}
          sides={sides.data}
          sideBySide={sideBySide}
          comments={comments}
          onAdd={(n) => st.addComment({ worktreeId: worktree, filePath: file.path, ...n })}
          onDelete={(id) => st.deleteComment(id)}
          onUpdate={async (id, text) => {
            st.updateComment(id, text)
            return true
          }}
          onSend={(id) => void st.send(worktree, [id])}
        />
      </Suspense>
    )

  return (
    <div className="pane-body diff-pane flex flex-col bg-background text-foreground" data-ui>
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
        <GitCompareArrows className="size-4 shrink-0 text-muted-foreground" />
        <span className="shrink-0 text-[13px] font-medium">Changes</span>
        <span className="min-w-0 truncate text-[12px] text-muted-foreground" title={worktree}>
          {folderName(worktree)}
        </span>
        {files && files.length > 0 && (
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
            {files.length} {files.length === 1 ? 'file' : 'files'}
            {totals.add > 0 && <span className="ml-1.5 text-status-success">+{totals.add}</span>}
            {totals.del > 0 && <span className="ml-1 text-destructive">−{totals.del}</span>}
          </span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground hover:text-foreground"
            aria-label={sideBySide ? 'Show inline' : 'Show side by side'}
            title={sideBySide ? 'Show inline' : 'Show side by side'}
            onClick={() => setSideBySide((v) => !v)}
          >
            {sideBySide ? <Rows2 /> : <Columns2 />}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground hover:text-foreground"
            aria-label="Refresh"
            title="Read the changes again"
            onClick={() => void st.load(worktree)}
          >
            <RotateCw className={cn(loading && 'animate-spin')} />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="xs"
            data-action="send-notes"
            disabled={comments.length === 0 || sent?.sending}
            title="Send every note to this worktree's agent, in one message"
            onClick={() => void st.send(worktree)}
          >
            <SendHorizontal />
            {sent?.sending ? 'Sending…' : `Send ${comments.length} ${comments.length === 1 ? 'note' : 'notes'}`}
          </Button>
          <Button type="button" variant="default" size="xs" data-action="commit" disabled={!files?.length} onClick={onCommit}>
            <GitCommitHorizontal />
            Commit…
          </Button>
        </div>
      </div>
      {(sent?.ok || sent?.error || changes?.list?.truncated || (changes?.error && changes.list)) && (
        <div role="status" className="shrink-0 border-b border-border px-3 py-1 text-[12px]">
          {sent?.error && <div className="text-destructive">{sent.error}</div>}
          {sent?.ok && <div className="text-muted-foreground">{sent.ok}</div>}
          {changes?.error && changes.list && <div className="text-destructive">Could not read the changes again: {changes.error}</div>}
          {changes?.list?.truncated && <div className="text-muted-foreground">Only the first {changes.list.files.length} changed files are listed.</div>}
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        {files && files.length > 0 && (
          <div className="diff-files w-64 shrink-0 overflow-y-auto border-r border-border p-1" role="list" aria-label="Changed files">
            {files.map((f) => (
              <FileRow key={f.path} file={f} notes={notesByFile.get(f.path) ?? 0} on={f.path === file?.path} onPick={() => setPicked(f.path)} />
            ))}
          </div>
        )}
        <div className="relative min-w-0 flex-1">{body}</div>
      </div>
    </div>
  )
}

import { Suspense, useEffect, useRef, useState, type JSX, type ReactNode } from 'react'
import type { StoreApi } from 'zustand/vanilla'
import { diffStore } from '../../../diff/app-store'
import type { ChangedFile } from '../../../diff/client'
import type { Target } from '../../../diff/deliver'
import { escapeOwner } from '../../../diff/esc'
import { LazyDiffEditor } from '../../../diff/lazy-editor'
import type { DiffState } from '../../../diff/store'
import { useDiffView } from '../../../diff/use-diff-view'
import { basename } from '../../../path/path'
import '../../ui/ui.css'
import './changes.css'

/** What `openWindow('changes', …)` passes: the robot, its worktree (`child.cwd`) and its label. */
export type ChangesWindowProps = { robotId: string; worktree: string; label: string; close: () => void }

/** The base a child's changes are read against: the repo's default branch, as the drawer's chips
 *  and the child's diff read them. A child commits as it goes, so its commits count. */
const BASE = ''

const STATUS: Record<ChangedFile['status'], { letter: string; label: string }> = {
  added: { letter: 'A', label: 'added' },
  untracked: { letter: 'U', label: 'untracked' },
  modified: { letter: 'M', label: 'modified' },
  deleted: { letter: 'D', label: 'deleted' },
  renamed: { letter: 'R', label: 'renamed' },
  conflicted: { letter: '!', label: 'conflicted' },
}

const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`

/** Whether reading the changes failed because the worktree is no longer there: its folder is
 *  gone (git cannot start in it) or is no longer a git tree. */
export function isGone(error: string): boolean {
  return /^git: |not a git repository|no such file or directory|os error (2|3|267)\b|cannot change to/i.test(error)
}

/** The Changes window (spec Q7): a robot's worktree against its base, file by file, and the notes
 *  for the agent written on its lines. The notes go to this robot, as a reply, one at a time or
 *  all together. */
export function ChangesWindow({ robotId, worktree, label }: ChangesWindowProps): JSX.Element {
  return <ChangesView store={diffStore} robotId={robotId} worktree={worktree} label={label} />
}

/** `ChangesWindow` on any diff store (tests hand their own). */
export function ChangesView({ store, robotId, worktree, label }: { store: StoreApi<DiffState>; robotId: string; worktree: string; label: string }): JSX.Element {
  const root = useRef<HTMLDivElement>(null)
  const { changes, files, file, pick, comments, notesByFile, sent, totals, loading, shown } = useDiffView(store, worktree, BASE)
  const [sideBySide, setSideBySide] = useState(false)
  const to: Target = { kind: 'mission', id: robotId, label: label || robotId }

  // Here, on `window` in the capture phase, Esc typed in a note drops the draft before anything else
  // hears it, and the window stays.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !root.current?.contains(e.target as Node)) return
      const cancel = escapeOwner(e.target)
      if (!cancel) return
      e.preventDefault()
      e.stopPropagation()
      cancel()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  const st = store.getState()
  const name = basename(worktree)
  const against = changes?.list?.base?.split(' @ ')[0] || 'its base'

  let body: ReactNode
  if (!worktree) body = <Notice>{label || robotId} has no worktree to read.</Notice>
  else if (shown.kind === 'error' && isGone(shown.error))
    body = (
      <Notice title={shown.error}>
        The worktree is gone: <code>{worktree}</code> is no longer there, so there is nothing to diff.
      </Notice>
    )
  else if (shown.kind === 'error') body = <Notice tone="error">Could not read the changes: {shown.error}</Notice>
  else if (shown.kind === 'reading') body = <Notice>Reading the changes…</Notice>
  else if (shown.kind === 'none') body = <Notice>No change in {name} against {against}.</Notice>
  else if (shown.kind === 'file-error') body = <Notice tone="error">Could not read {shown.file.path}: {shown.error}</Notice>
  else if (shown.kind === 'reading-file') body = <Notice>Reading {basename(shown.file.path)}…</Notice>
  else if (shown.kind === 'binary') body = <Notice>{shown.file.path} is a binary file: no text diff to show.</Notice>
  else if (shown.kind === 'too-large') body = <Notice>{shown.file.path} is too large to diff here.</Notice>
  else {
    const { file: f, sides } = shown
    body = (
      <Suspense fallback={<Notice>Loading the editor…</Notice>}>
        <LazyDiffEditor
          worktree={worktree}
          file={f}
          sides={sides}
          sideBySide={sideBySide}
          comments={comments}
          onAdd={(n) => st.addComment({ worktreeId: worktree, filePath: f.path, ...n })}
          onDelete={(id) => st.deleteComment(id)}
          onUpdate={async (id, text) => {
            st.updateComment(id, text)
            return true
          }}
          onSend={(id) => void st.send(worktree, [id], to)}
        />
      </Suspense>
    )
  }

  const status = [
    sent?.error && { tone: 'error', text: sent.error },
    sent?.ok && { tone: 'ok', text: sent.ok },
    changes?.error && changes.list && { tone: 'error', text: `Could not read the changes again: ${changes.error}` },
    changes?.list?.truncated && { tone: 'muted', text: `Only the first ${changes.list.files.length} changed files are listed.` },
  ].filter((x): x is { tone: string; text: string } => !!x)

  return (
    <div ref={root} className="nx-changes" data-nx-changes="" data-robot={robotId}>
      <div className="nx-changes-bar">
        <span className="nx-changes-label">{label || robotId}</span>
        <span className="nx-changes-tree" title={worktree}>
          {name}
        </span>
        {changes?.list?.base && (
          <span className="nx-muted" title="The merge base every file is compared to">
            vs {changes.list.base}
          </span>
        )}
        {files && files.length > 0 && (
          <span className="nx-changes-totals">
            {plural(files.length, 'file')}
            {totals.add > 0 && <span data-tone="add"> +{totals.add}</span>}
            {totals.del > 0 && <span data-tone="del"> −{totals.del}</span>}
          </span>
        )}
        <span className="nx-changes-tools">
          <button type="button" className="nx-btn" aria-pressed={sideBySide} title={sideBySide ? 'Show inline' : 'Show side by side'} onClick={() => setSideBySide((v) => !v)}>
            {sideBySide ? 'INLINE' : 'SIDE BY SIDE'}
          </button>
          <button type="button" className="nx-btn" data-action="refresh" title="Read the changes again" disabled={!worktree || loading} onClick={() => void st.load(worktree, BASE)}>
            {loading ? 'READING…' : 'REFRESH'}
          </button>
          <button
            type="button"
            className="nx-btn"
            data-tone="go"
            data-action="send-notes"
            disabled={comments.length === 0 || sent?.sending}
            title={`Send every note to ${to.label}, in one message`}
            onClick={() => void st.send(worktree, undefined, to)}
          >
            {sent?.sending ? 'SENDING…' : `SEND ${plural(comments.length, 'note').toUpperCase()}`}
          </button>
        </span>
      </div>
      {status.length > 0 && (
        <div className="nx-changes-status" role="status">
          {status.map((s) => (
            <div key={s.text} data-tone={s.tone}>
              {s.text}
            </div>
          ))}
        </div>
      )}
      <div className="nx-changes-main">
        {files && files.length > 0 && (
          <div className="nx-changes-files" role="list" aria-label="Changed files">
            {files.map((f) => (
              <FileRow key={f.path} file={f} notes={notesByFile.get(f.path) ?? 0} on={f.path === file?.path} onPick={() => pick(f.path)} />
            ))}
          </div>
        )}
        <div className="nx-changes-diff">{body}</div>
      </div>
    </div>
  )
}

function FileRow({ file, notes, on, onPick }: { file: ChangedFile; notes: number; on: boolean; onPick(): void }) {
  const s = STATUS[file.status]
  const dir = dirOf(file.path)
  return (
    <button
      type="button"
      className="nx-changes-file"
      data-file={file.path}
      data-status={file.status}
      aria-current={on || undefined}
      title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
      onClick={onPick}
    >
      <span className="nx-changes-letter" aria-label={s.label}>
        {s.letter}
      </span>
      <span className="nx-changes-path">
        <span className="nx-changes-base">{basename(file.path)}</span>
        {dir && <span className="nx-changes-dir">{dir}</span>}
      </span>
      {notes > 0 && (
        <span className="nx-changes-notes" title={plural(notes, 'note')}>
          ✎{notes}
        </span>
      )}
      {file.binary ? (
        <span className="nx-muted">bin</span>
      ) : (
        <span className="nx-changes-count">
          {file.additions ? <span data-tone="add">+{file.additions}</span> : null}
          {file.deletions ? <span data-tone="del">−{file.deletions}</span> : null}
        </span>
      )}
    </button>
  )
}

function Notice({ children, tone, title }: { children: ReactNode; tone?: 'error'; title?: string }) {
  return (
    <div className="nx-changes-notice" data-tone={tone} title={title}>
      <div>{children}</div>
    </div>
  )
}

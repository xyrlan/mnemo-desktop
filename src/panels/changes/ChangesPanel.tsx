// The Changes panel: what the selected session's worktree changed against its base, file by
// file, and the diff of each. A note is written on a line (click its number) and the notes go
// to the session as one reply. The diff is drawn here in the terminal's own typeface rather
// than in an editor: it opens at once, in the panel's identity, and reads top to bottom.

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import type { StoreApi } from 'zustand/vanilla'
import { diffStore } from '../../diff/app-store'
import type { ChangedFile, FileSides } from '../../diff/client'
import { getDiffCommentLineLabel, type DiffComment } from '../../diff/comment'
import { formatDiffComments } from '../../diff/format'
import type { DiffState } from '../../diff/store'
import { useDiffView } from '../../diff/use-diff-view'
import { Figure, Kbd, Label, StateMark } from '../../ds'
import { basename } from '../../path/path'
import { actions } from '../../world/actions'
import { tilde } from '../../world/format'
import { select, useRoute } from '../../world/route'
import { rosterOrder, sessionOf, useWorld } from '../../world/store'
import type { Session } from '../../world/types'
import { plural } from '../projects/model'
import { absolute, actOf, blocksOf, capped, dirOf, isGone, linesOf, movedFile, notesByLine, pairsOf, quoteOf, rangeOf, STATUS, type Block, type Line } from './model'
import './changes.css'

/** The base a session's changes are read against: the repo's default branch, as the ship's
 *  window read a child's. A session commits as it goes, so its commits count. */
const BASE = ''

const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)

type Said = { tone: 'ok' | 'bad'; text: string }

/** The panel on the app's diff store. */
export function ChangesPanel() {
  return <ChangesView store={diffStore} />
}

/** The panel on any diff store (tests hand their own). */
export function ChangesView({ store }: { store: StoreApi<DiffState> }) {
  const id = useRoute((r) => r.session)
  const session = useWorld((w) => sessionOf(w, id))
  if (!session) return <Chooser />
  if (!session.cwd) return <p className="mn-changes-notice">{session.title} has no folder to read changes in.</p>
  return <Changes key={session.id} store={store} session={session} worktree={session.cwd} />
}

/** No session is selected: the ones that can be read, to pick from. */
function Chooser() {
  const world = useWorld((w) => w)
  const sessions = useMemo(() => rosterOrder(world).filter((s) => s.cwd), [world])
  if (!sessions.length) return <p className="mn-changes-notice">No session to read changes from yet.</p>
  return (
    <div className="mn-changes-chooser" data-changes-chooser="">
      <Label>Whose changes?</Label>
      {sessions.map((s) => (
        <button key={s.id} type="button" className="mn-changes-pick" data-role={s.role} onClick={() => select(s.id)}>
          <Figure id={s.id} size={22} />
          <StateMark state={s.state} />
          <span className="mn-changes-pick-title">{s.title}</span>
          <span className="mn-changes-pick-where mn-mono">{s.branch ?? tilde(s.cwd)}</span>
        </button>
      ))}
    </div>
  )
}

function Changes({ store, session, worktree }: { store: StoreApi<DiffState>; session: Session; worktree: string }) {
  const root = useRef<HTMLDivElement>(null)
  const { changes, files, file, pick, comments, notesByFile, totals, loading, shown } = useDiffView(store, worktree, BASE)
  const [sideBySide, setSideBySide] = useState(false)
  const [said, setSaid] = useState<Said | null>(null)
  const [sending, setSending] = useState(false)
  const st = store.getState()

  useEffect(() => root.current?.focus({ preventScroll: true }), [])

  useEffect(() => {
    if (!file) return
    const el = [...(root.current?.querySelectorAll<HTMLElement>('[data-file]') ?? [])].find((x) => x.dataset.file === file.path)
    el?.scrollIntoView?.({ block: 'nearest' })
  }, [file])

  /** The notes go to the session as one reply; the ones that went are dropped. */
  async function send(ids?: readonly string[]) {
    const notes = comments.filter((c) => !ids || ids.includes(c.id))
    if (!notes.length || sending) return
    setSending(true)
    setSaid(null)
    try {
      const out = await actions().reply(session.id, formatDiffComments(notes))
      if (!out.ok) return setSaid({ tone: 'bad', text: `The ${notes.length === 1 ? 'note was' : 'notes were'} not sent: ${out.why}` })
      for (const n of notes) st.deleteComment(n.id)
      setSaid({ tone: 'ok', text: `Sent ${plural(notes.length, 'note')} to ${session.title}.` })
    } finally {
      setSending(false)
    }
  }

  function open(f: ChangedFile) {
    const at = absolute(changes?.list?.root || worktree, f.path)
    void actions()
      .external(at)
      .then((out) => {
        if (!out.ok) setSaid({ tone: 'bad', text: `${f.path} did not open: ${out.why}` })
      })
  }

  function onKeyDown(e: KeyboardEvent) {
    if (typing(e.target)) return
    const act = actOf(e)
    if (!act) return
    e.preventDefault()
    e.stopPropagation()
    if (act.kind === 'move') {
      const next = movedFile(files ?? [], file?.path ?? null, act.by)
      if (next) pick(next)
    } else if (act.kind === 'layout') setSideBySide((v) => !v)
    else if (act.kind === 'read') void st.load(worktree, BASE)
    else if (act.kind === 'open') file && open(file)
    else void send()
  }

  const name = basename(worktree)
  const against = changes?.list?.base?.split(' @ ')[0] || 'its base'

  let body: ReactNode
  if (shown.kind === 'error' && isGone(shown.error))
    body = (
      <Notice title={shown.error}>
        The worktree is gone: <code className="mn-mono">{tilde(worktree)}</code> is no longer there, so there is nothing to diff.
      </Notice>
    )
  else if (shown.kind === 'error') body = <Notice tone="bad">Could not read the changes: {shown.error}</Notice>
  else if (shown.kind === 'reading') body = <Notice>Reading the changes…</Notice>
  else if (shown.kind === 'none') body = <Notice>No change in {name} against {against}.</Notice>
  else if (shown.kind === 'file-error') body = <Notice tone="bad">Could not read {shown.file.path}: {shown.error}</Notice>
  else if (shown.kind === 'reading-file') body = <Notice>Reading {basename(shown.file.path)}…</Notice>
  else if (shown.kind === 'binary') body = <Notice>{shown.file.path} is a binary file: no text diff to show.</Notice>
  else if (shown.kind === 'too-large') body = <Notice>{shown.file.path} is too large to diff here.</Notice>
  else
    body = (
      <FileDiff
        key={shown.file.path}
        file={shown.file}
        sides={shown.sides}
        sideBySide={sideBySide}
        comments={comments}
        onOpen={() => open(shown.file)}
        onRest={() => root.current?.focus({ preventScroll: true })}
        onAdd={(n) => st.addComment({ worktreeId: worktree, filePath: shown.file.path, ...n })}
        onDelete={(noteId) => st.deleteComment(noteId)}
        onSend={(noteId) => void send([noteId])}
      />
    )

  const status = [
    said,
    changes?.error && changes.list ? { tone: 'bad' as const, text: `Could not read the changes again: ${changes.error}` } : null,
    changes?.list?.truncated ? { tone: 'ok' as const, text: `Only the first ${changes.list.files.length} changed files are listed.` } : null,
  ].filter((x): x is Said => !!x)

  return (
    <div ref={root} className="mn-changes" data-changes="" data-session={session.id} tabIndex={-1} onKeyDown={onKeyDown}>
      <header className="mn-changes-bar">
        <Figure id={session.id} size={30} />
        <div className="mn-changes-who">
          <span className="mn-changes-session">{session.title}</span>
          <span className="mn-changes-where mn-mono" title={worktree}>
            {session.branch ? `${session.branch} · ` : ''}
            {name}
            {changes?.list?.base ? ` · against ${changes.list.base}` : ''}
          </span>
        </div>
        {files && files.length > 0 && (
          <span className="mn-changes-totals mn-num">
            {plural(files.length, 'file')}
            {totals.add > 0 && <span data-sign="+"> +{totals.add}</span>}
            {totals.del > 0 && <span data-sign="-"> −{totals.del}</span>}
          </span>
        )}
        <span className="mn-changes-tools">
          <button type="button" className="mn-changes-btn" aria-pressed={sideBySide} onClick={() => setSideBySide((v) => !v)}>
            <Kbd>V</Kbd> {sideBySide ? 'Inline' : 'Side by side'}
          </button>
          <button type="button" className="mn-changes-btn" data-action="refresh" disabled={loading} onClick={() => void st.load(worktree, BASE)}>
            <Kbd>U</Kbd> {loading ? 'Reading…' : 'Read again'}
          </button>
          <button type="button" className="mn-changes-btn" data-tone="go" data-action="send-notes" disabled={comments.length === 0 || sending} title={`Send every note to ${session.title}, in one message`} onClick={() => void send()}>
            <Kbd>S</Kbd> {sending ? 'Sending…' : `Send ${plural(comments.length, 'note')}`}
          </button>
        </span>
      </header>
      {status.map((s) => (
        <p key={s.text} className="mn-changes-said" data-tone={s.tone} role={s.tone === 'bad' ? 'alert' : 'status'}>
          {s.text}
        </p>
      ))}
      <div className="mn-changes-main">
        {files && files.length > 0 && (
          <div className="mn-changes-files" role="group" aria-label="Changed files">
            {files.map((f) => (
              <FileRow key={f.path} file={f} notes={notesByFile.get(f.path) ?? 0} on={f.path === file?.path} onPick={() => pick(f.path)} />
            ))}
          </div>
        )}
        <div className="mn-changes-diff">{body}</div>
      </div>
    </div>
  )
}

function FileRow({ file, notes, on, onPick }: { file: ChangedFile; notes: number; on: boolean; onPick(): void }) {
  const s = STATUS[file.status]
  const dir = dirOf(file.path)
  return (
    <button type="button" className="mn-changes-file" data-file={file.path} data-status={file.status} aria-current={on || undefined} title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path} onClick={onPick}>
      <span className="mn-changes-letter" aria-label={s.word} title={s.word}>
        {s.letter}
      </span>
      <span className="mn-changes-path">
        <span className="mn-changes-base">{basename(file.path)}</span>
        {dir && <span className="mn-changes-dir">{dir}</span>}
      </span>
      {notes > 0 && (
        <span className="mn-changes-notes">{plural(notes, 'note')}</span>
      )}
      {file.binary ? (
        <span className="mn-changes-count">bin</span>
      ) : (
        <span className="mn-changes-count mn-num">
          {file.additions ? <span data-sign="+">+{file.additions}</span> : null}
          {file.deletions ? <span data-sign="-">−{file.deletions}</span> : null}
        </span>
      )}
    </button>
  )
}

function Notice({ children, tone, title }: { children: ReactNode; tone?: 'bad'; title?: string }) {
  return (
    <div className="mn-changes-notice" data-tone={tone} title={title}>
      {children}
    </div>
  )
}

type NoteDraft = { startLine?: number; lineNumber: number }

type DiffProps = {
  file: ChangedFile
  sides: FileSides
  sideBySide: boolean
  comments: readonly DiffComment[]
  onOpen(): void
  /** A note was kept or dropped: the keys go back to the panel. */
  onRest(): void
  onAdd(note: { lineNumber: number; startLine?: number; body: string; quote: string }): void
  onDelete(id: string): void
  onSend(id: string): void
}

/** One file's diff: its blocks of lines, the folds between them, and its notes under their
 *  lines. A deleted file has no working side, so it takes no notes. */
function FileDiff({ file, sides, sideBySide, comments, onOpen, onRest, onAdd, onDelete, onSend }: DiffProps) {
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set())
  const [draft, setDraft] = useState<NoteDraft | null>(null)
  const [anchor, setAnchor] = useState<number | null>(null)
  const lines = useMemo(() => linesOf(sides.original, sides.modified), [sides])
  const notes = useMemo(() => notesByLine(comments, file.path), [comments, file.path])
  const noted = useMemo(() => new Set([...notes.keys(), ...(draft ? [draft.lineNumber] : [])]), [notes, draft])
  const all = useMemo(() => blocksOf(lines, noted, open), [lines, noted, open])
  const { blocks, left } = useMemo(() => capped(all.blocks), [all])
  const drawn = new Set(blocks.flatMap((b) => b.lines.map((l) => l.now)))
  const adrift = [...notes.entries()].filter(([n]) => !drawn.has(n)).flatMap(([, list]) => list)

  const unfold = (fold: number) => setOpen((o) => new Set([...o, fold]))

  /** A click on a line's number starts a note there; with shift, one over the range from the
   *  line last clicked. */
  function note(line: number, e: MouseEvent) {
    setDraft(rangeOf(anchor, line, e.shiftKey))
    if (!e.shiftKey) setAnchor(line)
  }

  const under = (l: Line | null): ReactNode => {
    if (!l || l.now === null) return null
    const here = notes.get(l.now) ?? []
    const writing = draft?.lineNumber === l.now
    if (!here.length && !writing) return null
    return (
      <div className="mn-changes-under">
        {here.map((c) => (
          <NoteCard key={c.id} note={c} onDelete={() => onDelete(c.id)} onSend={() => onSend(c.id)} />
        ))}
        {writing && draft && (
          <Composer
            draft={draft}
            onCancel={() => {
              setDraft(null)
              onRest()
            }}
            onSave={(body) => {
              onAdd({ ...draft, body, quote: quoteOf(lines, draft.startLine ?? draft.lineNumber, draft.lineNumber) })
              setDraft(null)
              onRest()
            }}
          />
        )}
      </div>
    )
  }

  const inRange = (l: Line | null) => !!draft && !!l && l.now !== null && l.now >= (draft.startLine ?? draft.lineNumber) && l.now <= draft.lineNumber

  /** A line's number on the working side is where a note starts; a removed line has none. */
  const number = ({ now }: Line) =>
    now !== null ? (
      <button type="button" className="mn-changes-n" aria-label={`Note on line ${now}`} title="Write a note for the session on this line (shift: through this line)" onClick={(e) => note(now, e)}>
        {now}
      </button>
    ) : (
      <span className="mn-changes-n" />
    )

  const fold = (n: number, at: number) =>
    n > 0 && (
      <button type="button" className="mn-changes-fold" data-fold={at} onClick={() => unfold(at)}>
        ⋯ {plural(n, 'unchanged line')} · show
      </button>
    )

  const block = (b: Block) =>
    sideBySide
      ? pairsOf(b.lines).map((p, i) => (
          <div key={`${b.fold}:${i}`} className="mn-changes-pairrow">
            <div className="mn-changes-pair" data-noted={inRange(p.right) || undefined}>
              <span className="mn-changes-n">{p.left && p.left.sign !== '+' ? p.left.old : ''}</span>
              <span className="mn-changes-code" data-sign={p.left && p.left.sign === '-' ? '-' : undefined} data-void={!p.left || undefined}>
                {p.left?.text ?? ''}
              </span>
              {p.right ? number(p.right) : <span className="mn-changes-n" />}
              <span className="mn-changes-code" data-sign={p.right && p.right.sign === '+' ? '+' : undefined} data-void={!p.right || undefined}>
                {p.right?.text ?? ''}
              </span>
            </div>
            {under(p.right)}
          </div>
        ))
      : b.lines.map((l) => (
          <div key={l.at} className="mn-changes-linerow">
            <div className="mn-changes-line" data-sign={l.sign === ' ' ? undefined : l.sign} data-noted={inRange(l) || undefined}>
              <span className="mn-changes-n">{l.old ?? ''}</span>
              {number(l)}
              <i className="mn-changes-sign" aria-hidden>
                {l.sign === ' ' ? '' : l.sign === '-' ? '−' : '+'}
              </i>
              <span className="mn-changes-code">{l.text}</span>
            </div>
            {under(l)}
          </div>
        ))

  return (
    <div className="mn-changes-filediff" data-diff={file.path} data-layout={sideBySide ? 'split' : 'inline'}>
      <div className="mn-changes-filehead">
        <span className="mn-changes-letter" data-status={file.status}>
          {STATUS[file.status].letter}
        </span>
        <span className="mn-changes-filepath mn-mono">
          {file.oldPath && <span className="mn-changes-old">{file.oldPath} → </span>}
          {file.path}
        </span>
        <Label>{STATUS[file.status].word}</Label>
        <span className="mn-changes-count mn-num">
          {all.added > 0 && <span data-sign="+">+{all.added}</span>}
          {all.removed > 0 && <span data-sign="-">−{all.removed}</span>}
        </span>
        <button type="button" className="mn-changes-btn" onClick={onOpen}>
          <Kbd>O</Kbd> Open
        </button>
      </div>
      <div className="mn-changes-lines mn-mono">
        {all.added === 0 && all.removed === 0 && <p className="mn-changes-quiet">No line changed.</p>}
        {blocks.map((b) => (
          <div key={b.fold + ':' + (b.lines[0]?.at ?? 0)} className="mn-changes-block">
            {fold(b.skipped, b.fold)}
            {block(b)}
          </div>
        ))}
        {left === 0 && fold(all.tail, all.tailFold)}
        {left > 0 && <p className="mn-changes-quiet">{plural(left, 'more line')} of this file are not drawn here. Open it to read the rest.</p>}
      </div>
      {adrift.length > 0 && (
        <div className="mn-changes-adrift">
          <Label>Notes on lines that are no longer here</Label>
          {adrift.map((c) => (
            <NoteCard key={c.id} note={c} onDelete={() => onDelete(c.id)} onSend={() => onSend(c.id)} />
          ))}
        </div>
      )}
    </div>
  )
}

function NoteCard({ note, onDelete, onSend }: { note: DiffComment; onDelete(): void; onSend(): void }) {
  return (
    <div className="mn-changes-note" data-note={note.id}>
      <Label>{getDiffCommentLineLabel(note)}</Label>
      <p className="mn-changes-notebody">{note.body}</p>
      <button type="button" className="mn-changes-link" onClick={onSend}>
        send
      </button>
      <button type="button" className="mn-changes-link" aria-label="Delete this note" onClick={onDelete}>
        ×
      </button>
    </div>
  )
}

/** Where a note is written: Enter keeps it, Shift+Enter breaks the line, Esc drops it. */
function Composer({ draft, onSave, onCancel }: { draft: NoteDraft; onSave(body: string): void; onCancel(): void }) {
  const [body, setBody] = useState('')
  return (
    <div className="mn-changes-note" data-composer="">
      <Label>{getDiffCommentLineLabel(draft)}</Label>
      <textarea
        autoFocus
        rows={Math.min(6, Math.max(1, body.split('\n').length))}
        aria-label={`Note on ${getDiffCommentLineLabel(draft).toLowerCase()}`}
        placeholder="A note for the session"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            // The note is dropped; the panel stays.
            e.preventDefault()
            e.stopPropagation()
            onCancel()
          } else if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            if (body.trim()) onSave(body.trim())
          }
        }}
      />
      <span className="mn-changes-hint">
        <Kbd>Enter</Kbd> keep <Kbd>Esc</Kbd> drop
      </span>
    </div>
  )
}

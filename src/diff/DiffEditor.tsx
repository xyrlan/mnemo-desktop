import { useCallback, useEffect, useRef, useState } from 'react'
import type { editor as MonacoEditor } from 'monaco-editor'
import { monaco } from '../editor/monaco'
import { languageFor } from '../editor/paths'
import { cssVar } from '../theme'
import type { ChangedFile, FileSides } from './client'
import type { DiffComment } from './comment'
import { DiffCommentPopover } from './DiffCommentPopover'
import { getDiffCommentPopoverLeft, getDiffCommentPopoverTop } from './popover-position'
import { useDiffCommentDecorator } from './useDiffCommentDecorator'

/** What the diff pane hands its editor. Loaded lazily with Monaco (`DiffPane`), so a stand-in with
 *  the same props takes its place in tests. */
export type DiffEditorProps = {
  worktree: string
  file: ChangedFile
  sides: FileSides
  sideBySide: boolean
  /** The worktree's notes; the editor shows the ones on `file`. */
  comments: readonly DiffComment[]
  onAdd(note: { lineNumber: number; startLine?: number; body: string; quote: string }): void
  onDelete(id: string): void
  onUpdate(id: string, body: string): Promise<boolean>
  onSend(id: string): void
}

type Composer = { lineNumber: number; startLine?: number; top: number; left?: number }

let modelSeq = 0

/** Monaco's diff editor over one file's two sides, with Orca's notes on the working side: a "+"
 *  in the gutter (or a drag down it for a range) opens the composer, and each note shows as a
 *  card under its line. A deleted file has no working side, so it takes no notes. */
export default function DiffEditor({ worktree, file, sides, sideBySide, comments, onAdd, onDelete, onUpdate, onSend }: DiffEditorProps) {
  const frame = useRef<HTMLDivElement>(null)
  const host = useRef<HTMLDivElement>(null)
  const [diff, setDiff] = useState<MonacoEditor.IStandaloneDiffEditor | null>(null)
  const [modified, setModified] = useState<MonacoEditor.ICodeEditor | null>(null)
  const [modelKey, setModelKey] = useState('')
  const [composer, setComposer] = useState<Composer | null>(null)

  useEffect(() => {
    if (!host.current) return
    const ed = monaco.editor.createDiffEditor(host.current, {
      theme: 'mnemo',
      readOnly: true,
      originalEditable: false,
      automaticLayout: true,
      renderSideBySide: sideBySide,
      // The toggle in the header says which layout shows; Monaco switching by itself would make it lie.
      useInlineViewWhenSpaceIsLimited: false,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      renderOverviewRuler: false,
      glyphMargin: true,
      fontFamily: cssVar('--font-mono'),
      fontSize: parseInt(cssVar('--font-size'), 10) || 13,
      fontLigatures: false,
    })
    setDiff(ed)
    setModified(ed.getModifiedEditor())
    return () => {
      const model = ed.getModel()
      ed.setModel(null)
      model?.original.dispose()
      model?.modified.dispose()
      ed.dispose()
      setDiff(null)
      setModified(null)
    }
    // Created once; `sideBySide` is applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    diff?.updateOptions({ renderSideBySide: sideBySide })
  }, [diff, sideBySide])

  useEffect(() => {
    if (!diff) return
    const language = languageFor(file.path, monaco.languages.getLanguages())
    const original = monaco.editor.createModel(sides.original, language)
    const next = monaco.editor.createModel(sides.modified, language)
    const prev = diff.getModel()
    diff.setModel({ original, modified: next })
    prev?.original.dispose()
    prev?.modified.dispose()
    setModelKey(`${file.path}#${++modelSeq}`)
    setComposer(null)
  }, [diff, file.path, sides])

  const lineHeight = useCallback(
    () => (modified ? (modified.getOption(monaco.editor.EditorOption.lineHeight) as number) : 19),
    [modified],
  )

  // The composer rides its line while the diff scrolls under it.
  const composerLine = composer?.lineNumber ?? null
  useEffect(() => {
    if (!modified || composerLine === null) return
    const sub = modified.onDidScrollChange(() => {
      const top = getDiffCommentPopoverTop(modified, composerLine, lineHeight())
      if (top !== null) setComposer((c) => (c ? { ...c, top } : c))
    })
    return () => sub.dispose()
  }, [modified, composerLine, lineHeight])

  useDiffCommentDecorator({
    editor: modified,
    monacoModelIdentity: modelKey,
    filePath: file.path,
    worktreeId: worktree,
    comments: comments as DiffComment[],
    commentableLineNumbers: file.status === 'deleted' ? EMPTY : undefined,
    pendingCommentTarget: composer,
    onAddCommentClick: ({ lineNumber, startLine, top }) => {
      const left = modified ? getDiffCommentPopoverLeft(modified, frame.current) : null
      setComposer({ lineNumber, startLine, top, left: left ?? undefined })
    },
    onDeleteComment: onDelete,
    onUpdateComment: onUpdate,
    onSendComment: onSend,
  })

  return (
    <div ref={frame} className="diff-editor-frame">
      <div ref={host} className="diff-editor-host" />
      {composer && (
        <DiffCommentPopover
          key={`${composer.startLine ?? composer.lineNumber}-${composer.lineNumber}`}
          lineNumber={composer.lineNumber}
          startLine={composer.startLine}
          top={composer.top}
          left={composer.left}
          lineHeight={lineHeight()}
          onCancel={() => setComposer(null)}
          onSubmit={async (body) => {
            const model = modified?.getModel()
            const from = composer.startLine ?? composer.lineNumber
            const quote = model
              ? Array.from({ length: composer.lineNumber - from + 1 }, (_, i) => model.getLineContent(from + i)).join('\n')
              : ''
            onAdd({ lineNumber: composer.lineNumber, startLine: composer.startLine, body, quote })
            setComposer(null)
          }}
        />
      )}
    </div>
  )
}

const EMPTY: readonly number[] = []

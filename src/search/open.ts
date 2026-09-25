import type { Store } from '../layout/store'
import type { SearchFileResult, SearchMatch } from './client'

/** The part of a Monaco editor a reveal uses. */
export type EditorLike = {
  getContainerDomNode(): HTMLElement
  getModel(): { getLineCount(): number } | null
  setSelection(range: Range): void
  revealRangeInCenter(range: Range): void
  focus(): void
}

type Range = { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }

/** How long a reveal waits for the editor to load the file. */
export const REVEAL_TIMEOUT_MS = 5000
const POLL_MS = 40

/** The editor pane showing `path` with its file loaded. The editor pane takes no line to open
 *  at, so the reveal finds it the way it draws itself: its header names the path, and the
 *  `loading…` cover is gone once the buffer is that file's. */
export function editorShowing(editors: EditorLike[], path: string): EditorLike | undefined {
  return editors.find((ed) => {
    const pane = ed.getContainerDomNode().closest('.editor-pane')
    return !!pane && pane.querySelector('.editor-path')?.getAttribute('title') === path && !pane.querySelector('.editor-empty') && ed.getModel() !== null
  })
}

let latest = 0

/** Once an editor shows `path`, selects the match and scrolls it to the middle. A newer reveal
 *  cancels this one; resolves whether it revealed. */
export async function revealWhenShown(
  path: string,
  match: Pick<SearchMatch, 'line' | 'column' | 'matchLength'>,
  editors: () => Promise<EditorLike[]>,
  timeoutMs = REVEAL_TIMEOUT_MS,
): Promise<boolean> {
  const mine = ++latest
  const until = Date.now() + timeoutMs
  for (;;) {
    if (mine !== latest) return false
    const ed = editorShowing(await editors(), path)
    if (mine !== latest) return false
    if (ed) {
      const line = Math.min(match.line, ed.getModel()?.getLineCount() ?? match.line)
      const range = { startLineNumber: line, startColumn: match.column, endLineNumber: line, endColumn: match.column + match.matchLength }
      ed.setSelection(range)
      ed.revealRangeInCenter(range)
      ed.focus()
      return true
    }
    if (Date.now() >= until) return false
    await new Promise((r) => setTimeout(r, POLL_MS))
  }
}

const liveEditors = () => import('../editor/monaco').then((m) => m.monaco.editor.getEditors() as unknown as EditorLike[])

/** Opens a result's file as a preview tab rooted at the searched worktree, at the match. */
export function openMatch(app: Store, root: string, file: SearchFileResult, match: SearchMatch, editors: () => Promise<EditorLike[]> = liveEditors): Promise<boolean> {
  const name = file.relativePath.slice(file.relativePath.lastIndexOf('/') + 1)
  app.getState().openView('editor', { path: file.filePath, root }, 'auto', name, { preview: true })
  return revealWhenShown(file.filePath, match, editors)
}

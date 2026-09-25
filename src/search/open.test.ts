import type { Store } from '../layout/store'
import { editorShowing, openMatch, revealWhenShown, type EditorLike } from './open'

afterEach(() => {
  document.body.innerHTML = ''
})

/** An editor pane as the editor draws it: a header naming the path, and a cover while loading. */
function pane(path: string, loading = false) {
  const root = document.body.appendChild(document.createElement('div'))
  root.className = 'pane-body editor-pane'
  root.innerHTML = `<div class="editor-head"><span class="editor-path" title="${path}"></span></div><div class="editor-code"><div class="editor-monaco"></div>${loading ? '<div class="editor-empty">loading…</div>' : ''}</div>`
  const calls: string[] = []
  const ed: EditorLike & { calls: string[] } = {
    calls,
    getContainerDomNode: () => root.querySelector<HTMLElement>('.editor-monaco')!,
    getModel: () => ({ getLineCount: () => 50 }),
    setSelection: (r) => void calls.push(`select ${r.startLineNumber}:${r.startColumn}-${r.endLineNumber}:${r.endColumn}`),
    revealRangeInCenter: (r) => void calls.push(`reveal ${r.startLineNumber}`),
    focus: () => void calls.push('focus'),
  }
  return { root, ed }
}

describe('opening a match', () => {
  it('finds the editor showing the file once it has loaded', () => {
    const other = pane('/r/other.ts')
    const loading = pane('/r/a.ts', true)
    expect(editorShowing([other.ed, loading.ed], '/r/a.ts')).toBeUndefined()
    loading.root.querySelector('.editor-empty')!.remove()
    expect(editorShowing([other.ed, loading.ed], '/r/a.ts')).toBe(loading.ed)
    const noModel = { ...loading.ed, getModel: () => null }
    expect(editorShowing([noModel], '/r/a.ts')).toBeUndefined()
  })

  it('selects the match and scrolls to it when the editor is ready', async () => {
    const p = pane('/r/a.ts', true)
    setTimeout(() => p.root.querySelector('.editor-empty')!.remove(), 60)
    expect(await revealWhenShown('/r/a.ts', { line: 12, column: 5, matchLength: 3 }, async () => [p.ed])).toBe(true)
    expect(p.ed.calls).toEqual(['select 12:5-12:8', 'reveal 12', 'focus'])
  })

  it('gives up after the timeout, and a newer reveal cancels an older one', async () => {
    const p = pane('/r/a.ts', true)
    expect(await revealWhenShown('/r/a.ts', { line: 1, column: 1, matchLength: 1 }, async () => [p.ed], 50)).toBe(false)
    const older = revealWhenShown('/r/a.ts', { line: 1, column: 1, matchLength: 1 }, async () => [p.ed])
    const b = pane('/r/b.ts')
    expect(await revealWhenShown('/r/b.ts', { line: 2, column: 1, matchLength: 1 }, async () => [p.ed, b.ed])).toBe(true)
    expect(await older).toBe(false)
    expect(p.ed.calls).toEqual([])
  })

  it('opens the file as a preview in an editor rooted at the searched worktree', async () => {
    const opened: unknown[] = []
    const app = { getState: () => ({ openView: (...a: unknown[]) => void opened.push(a) }) } as unknown as Store
    const p = pane('/r/src/a.ts')
    const file = { filePath: '/r/src/a.ts', relativePath: 'src/a.ts', matches: [] }
    expect(await openMatch(app, '/r', file, { line: 3, column: 2, matchLength: 4, lineContent: '' }, async () => [p.ed])).toBe(true)
    expect(opened).toEqual([['editor', { path: '/r/src/a.ts', root: '/r' }, 'auto', 'a.ts', { preview: true }]])
    expect(p.ed.calls[0]).toBe('select 3:2-3:6')
  })
})

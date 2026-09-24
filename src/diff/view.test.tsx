import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { vi } from 'vitest'
import type { DiffEditorProps } from './DiffEditor'

const WT = '/code/app-wt-feature'

/** Every command the view sent, with its arguments; the diff's answers. */
const ipc = vi.hoisted(() => ({ sent: [] as { cmd: string; args: Record<string, unknown> }[] }))
vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
    ipc.sent.push({ cmd, args })
    if (cmd === 'worktree_diff_files')
      return {
        root: args.worktree,
        truncated: false,
        files: [
          { path: 'src/a.ts', oldPath: null, status: 'modified', additions: 3, deletions: 1, binary: false },
          { path: 'img/logo.png', oldPath: null, status: 'added', additions: null, deletions: null, binary: true },
          { path: 'README.md', oldPath: null, status: 'deleted', additions: 0, deletions: 2, binary: false },
        ],
      }
    if (cmd === 'worktree_diff_file') return { original: `old ${args.file}`, modified: `new ${args.file}`, binary: false, tooLarge: false }
    if (cmd === 'home_snapshot') return { repos: [], clone_base: '', errors: [], protected: 0 }
    if (cmd === 'mission_snapshot') return { repos: [], errors: [], at: '' }
    if (cmd === 'worktree_list') return []
    return null
  },
  Channel: class {},
}))
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: async () => null }))
/** Monaco does not run in jsdom: a stand-in with the editor's props takes its place. */
const editor = vi.hoisted(() => ({ last: null as DiffEditorProps | null }))
vi.mock('./DiffEditor', () => ({
  default: (p: DiffEditorProps) => {
    editor.last = p
    return (
      <div data-editor={p.file.path} data-modified={p.sides.modified} data-notes={p.comments.length} data-side-by-side={String(p.sideBySide)}>
        <button type="button" onClick={() => p.onAdd({ lineNumber: 2, body: 'rename this', quote: 'const x' })}>
          stand-in add
        </button>
      </div>
    )
  },
}))

import { paneView } from '../panes/registry'
import { all, register } from '../actions/registry'
import { store as appStore } from '../layout/app-store'
import { diffStore, openDiff } from './view'
import { ENTER_DELAY_MS, pasteOf } from './deliver'
import { formatDiffComments } from './format'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let r: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  r = createRoot(host)
  ipc.sent = []
  editor.last = null
  diffStore.setState({ changes: {}, sides: {}, comments: [], sent: {} })
})
afterEach(() => {
  act(() => r.unmount())
  host.remove()
})

async function settle() {
  for (let i = 0; i < 6; i++) await act(async () => void (await new Promise((res) => setTimeout(res, 0))))
}
async function render(worktree: string = WT) {
  const View = paneView('diff')!
  await act(async () => r.render(<View id={-7} props={{ worktree }} />))
  await settle()
}
const button = (text: string | RegExp) =>
  [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => (typeof text === 'string' ? b.textContent?.trim() === text : text.test(b.textContent ?? '')))
const click = async (el: Element | null | undefined) => {
  await act(async () => void el!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  await settle()
}
const status = () => host.querySelector('[role="status"]')?.textContent ?? ''

test('registers the diff view and diff.open, which opens one Changes tab for the shown worktree', async () => {
  expect(paneView('diff')).toBeDefined()
  const a = all().find((x) => x.id === 'diff.open')!
  expect(a).toBeDefined()
  act(() => appStore.setState({ activeWorktree: WT }))
  const diffs = () => Object.values(appStore.getState().panes).filter((p) => p.view === 'diff')
  const before = diffs().length
  act(() => void a.run())
  expect(diffs()).toHaveLength(before + 1)
  const opened = diffs().at(-1)!
  expect(opened.props).toEqual({ worktree: WT })
  act(() => void appStore.getState().openView('tasks', {}, 'tab', 'Tasks'))
  act(() => openDiff())
  expect(diffs()).toHaveLength(before + 1)
  const st = appStore.getState()
  expect(st.tabs.find((t) => t.id === st.activeTab)?.focused).toBe(opened.id)
})

test('lists the changed files and shows the first one’s diff; picking another shows its', async () => {
  await render()
  expect(ipc.sent.filter((x) => x.cmd === 'worktree_diff_files').map((x) => x.args)).toEqual([{ worktree: WT }])
  expect([...host.querySelectorAll('[data-file]')].map((e) => e.getAttribute('data-file'))).toEqual(['src/a.ts', 'img/logo.png', 'README.md'])
  expect(host.textContent).toContain('3 files')
  expect(host.querySelector('[data-editor]')?.getAttribute('data-modified')).toBe('new src/a.ts')

  await click(host.querySelector('[data-file="README.md"]'))
  expect(host.querySelector('[data-editor]')?.getAttribute('data-editor')).toBe('README.md')
  expect(ipc.sent.filter((x) => x.cmd === 'worktree_diff_file').map((x) => x.args.file)).toEqual(['src/a.ts', 'README.md'])

  await click(host.querySelector('[data-file="img/logo.png"]'))
  expect(host.querySelector('[data-editor]')).toBeNull()
  expect(host.textContent).toContain('img/logo.png is a binary file')
})

test('the layout toggle switches the diff between side by side and inline', async () => {
  await render()
  expect(host.querySelector('[data-editor]')?.getAttribute('data-side-by-side')).toBe('false')
  await click(host.querySelector('[aria-label="Show side by side"]'))
  expect(host.querySelector('[data-editor]')?.getAttribute('data-side-by-side')).toBe('true')
  await click(host.querySelector('[aria-label="Show inline"]'))
  expect(host.querySelector('[data-editor]')?.getAttribute('data-side-by-side')).toBe('false')
})

test('refresh reads the list and the shown file again', async () => {
  await render()
  ipc.sent = []
  await click(host.querySelector('[aria-label="Refresh"]'))
  expect(ipc.sent.map((x) => x.cmd)).toEqual(['worktree_diff_files', 'worktree_diff_file'])
})

test('a note written in the editor is counted, and Send types every note into the worktree’s Claude pane', async () => {
  await render()
  expect(button(/^Send 0 notes$/)?.disabled).toBe(true)
  await click(button('stand-in add'))
  await click(button('stand-in add'))
  expect(host.querySelector('[data-editor]')?.getAttribute('data-notes')).toBe('2')
  expect(host.querySelector('[data-file="src/a.ts"]')?.textContent).toContain('2')
  const notes = diffStore.getState().comments
  expect(notes.map((n) => [n.filePath, n.lineNumber, n.quote])).toEqual([
    ['src/a.ts', 2, 'const x'],
    ['src/a.ts', 2, 'const x'],
  ])

  // A terminal running Claude in the worktree.
  act(() => appStore.setState((s) => ({ panes: { ...s.panes, 41: { id: 41, view: 'terminal', cwd: WT, sessionId: 'sess', title: 'claude' } } })))
  await click(button('Send 2 notes'))
  await act(async () => void (await new Promise((res) => setTimeout(res, ENTER_DELAY_MS + 50))))
  const writes = ipc.sent.filter((x) => x.cmd === 'pty_write').map((x) => x.args)
  expect(writes).toEqual([
    { id: 41, data: pasteOf(formatDiffComments(notes)) },
    { id: 41, data: '\r' },
  ])
  expect(diffStore.getState().comments).toEqual([])
  expect(status()).toContain('Sent 2 notes to claude.')
})

test('with no agent in the worktree the notes stay and the reason shows', async () => {
  await render('/code/nowhere')
  await click(button('stand-in add'))
  await click(button('Send 1 note'))
  expect(status()).toMatch(/No agent runs in this worktree/)
  expect(diffStore.getState().comments).toHaveLength(1)
})

test('Commit… runs commit.open, and says so when no commit composer is there', async () => {
  await render()
  if (!all().some((a) => a.id === 'commit.open')) {
    await click(button('Commit…'))
    expect(status()).toContain('The commit composer is not available')
    let ran = 0
    register({ id: 'commit.open', title: 'Commit', run: () => void ran++ })
    await click(button('Commit…'))
    expect(ran).toBe(1)
  }
})

test('a clean worktree says so, and Commit… is off', async () => {
  diffStore.setState({ changes: { [WT]: { list: { root: WT, truncated: false, files: [] }, loading: false, error: null } } })
  const load = diffStore.getState().load
  diffStore.setState({ load: async () => {} })
  try {
    await render()
    expect(host.textContent).toContain('No uncommitted changes in app-wt-feature.')
    expect(button('Commit…')?.disabled).toBe(true)
  } finally {
    diffStore.setState({ load })
  }
})

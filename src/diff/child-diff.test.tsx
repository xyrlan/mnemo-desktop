import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { vi } from 'vitest'
import type { DiffEditorProps } from './DiffEditor'

const WT = '/code/app-wt-child'

const ipc = vi.hoisted(() => ({ sent: [] as { cmd: string; args: Record<string, unknown> }[] }))
vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
    ipc.sent.push({ cmd, args })
    if (cmd === 'worktree_diff_files')
      return {
        root: args.worktree,
        truncated: false,
        base: args.base === undefined ? null : 'main @ 1a2b3c4',
        files: [{ path: 'src/a.ts', oldPath: null, status: 'modified', additions: 3, deletions: 1, binary: false }],
      }
    if (cmd === 'worktree_diff_file') return { original: 'old', modified: 'new', binary: false, tooLarge: false }
    if (cmd === 'home_snapshot') return { repos: [], clone_base: '', errors: [], protected: 0 }
    if (cmd === 'mission_snapshot') return { repos: [], errors: [], at: '' }
    if (cmd === 'worktree_list') return []
    return null
  },
  Channel: class {},
}))
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: async () => null }))
vi.mock('./DiffEditor', () => ({
  default: (p: DiffEditorProps) => (
    <div data-editor={p.file.path}>
      <button type="button" onClick={() => p.onAdd({ lineNumber: 1, body: 'note', quote: 'x' })}>
        stand-in add
      </button>
    </div>
  ),
}))

import { ChildDiff } from './ChildDiff'
import { diffStore } from './view'
import { scopeOf } from './store'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let r: Root
beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  r = createRoot(host)
  ipc.sent = []
  diffStore.setState({ changes: {}, sides: {}, comments: [], sent: {} })
})
afterEach(() => {
  act(() => r.unmount())
  host.remove()
})
async function settle() {
  for (let i = 0; i < 6; i++) await act(async () => void (await new Promise((res) => setTimeout(res, 0))))
}

test('with no base it asks for the default branch and shows what the files are compared to', async () => {
  await act(async () => r.render(<ChildDiff worktree={WT} />))
  await settle()
  expect(ipc.sent.find((s) => s.cmd === 'worktree_diff_files')!.args).toEqual({ worktree: WT, base: '' })
  expect(ipc.sent.find((s) => s.cmd === 'worktree_diff_file')!.args).toMatchObject({ worktree: WT, file: 'src/a.ts', base: '' })
  expect(host.textContent).toContain('Branch changes')
  expect(host.textContent).toContain('vs main @ 1a2b3c4')
  expect(host.querySelector('[data-editor="src/a.ts"]')).not.toBeNull()
  expect(host.querySelector('[data-action="commit"]')).toBeNull()
})

test('a base is passed through, and its changes stay apart from the uncommitted ones', async () => {
  await act(async () => r.render(<ChildDiff worktree={WT} base="develop" />))
  await settle()
  expect(ipc.sent.find((s) => s.cmd === 'worktree_diff_files')!.args).toEqual({ worktree: WT, base: 'develop' })
  const s = diffStore.getState()
  expect(s.changes[scopeOf(WT, 'develop')].list?.files).toHaveLength(1)
  expect(s.changes[WT]).toBeUndefined()
})

test('a note written on the child diff is kept for the worktree, where the send goes', async () => {
  await act(async () => r.render(<ChildDiff worktree={WT} />))
  await settle()
  const stand = [...host.querySelectorAll('button')].find((b) => b.textContent === 'stand-in add')!
  await act(async () => stand.click())
  expect(diffStore.getState().comments).toMatchObject([{ worktreeId: WT, filePath: 'src/a.ts', body: 'note' }])
  expect(host.textContent).toContain('Send 1 note')
})

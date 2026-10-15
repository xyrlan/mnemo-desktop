import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { vi } from 'vitest'
import type { DiffEditorProps } from '../../../diff/DiffEditor'

const WT = '/code/mnemo-wt-682'

/** Every command the window sent; the diff's answers, which a test may swap. */
const ipc = vi.hoisted(() => ({
  sent: [] as { cmd: string; args: Record<string, unknown> }[],
  files: null as null | ((args: Record<string, unknown>) => unknown),
}))
vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
    ipc.sent.push({ cmd, args })
    if (cmd === 'worktree_diff_files') {
      if (ipc.files) return ipc.files(args)
      return {
        root: args.worktree,
        truncated: false,
        base: 'main @ 1a2b3c4',
        files: [
          { path: 'src/a.ts', oldPath: null, status: 'modified', additions: 3, deletions: 1, binary: false },
          { path: 'docs/b.md', oldPath: null, status: 'added', additions: 5, deletions: 0, binary: false },
        ],
      }
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
/** Monaco does not run in jsdom: a stand-in with the editor's props, and a note's textarea that
 *  owns Esc as the real composer's does. */
const editor = vi.hoisted(() => ({ cancelled: 0 }))
vi.mock('../../../diff/DiffEditor', async () => {
  const { ownEscape } = await import('../../../diff/esc')
  return {
    default: (p: DiffEditorProps) => (
      <div data-editor={p.file.path} data-side-by-side={String(p.sideBySide)} data-notes={p.comments.length}>
        <button type="button" data-stand="add" onClick={() => p.onAdd({ lineNumber: 2, body: 'rename this', quote: 'const x' })} />
        <button type="button" data-stand="send" onClick={() => p.onSend(p.comments[0].id)} />
        <textarea data-stand="composer" ref={(el) => void (el && ownEscape(el, () => void editor.cancelled++))} />
      </div>
    ),
  }
})

import { WindowHost } from '../../ui/Window'
import { closeWindow, openWindow, windowStore } from '../../ui/windows'
import { diffStore } from '../../../diff/app-store'
import { formatDiffComments } from '../../../diff/format'
import { ChangesWindow } from './index'
import { isGone } from './ChangesWindow'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let r: Root
beforeEach(() => {
  host = document.body.appendChild(document.createElement('div'))
  r = createRoot(host)
  ipc.sent = []
  ipc.files = null
  editor.cancelled = 0
  diffStore.setState({ changes: {}, sides: {}, comments: [], sent: {} })
})
afterEach(() => {
  act(() => r.unmount())
  host.remove()
  closeWindow()
})
async function settle() {
  for (let i = 0; i < 6; i++) await act(async () => void (await new Promise((res) => setTimeout(res, 0))))
}
// The window is drawn at the end of `<body>`, not in the root's box.
const $ = (sel: string) => document.querySelector<HTMLElement>(sel)
const click = (sel: string) => act(async () => $(sel)!.click())
async function open(params: Record<string, unknown> = { robotId: 'c682', worktree: WT, label: '#682' }) {
  await act(async () => r.render(<WindowHost />))
  await act(async () => openWindow('changes', params))
  await settle()
}

test('opened by id, it reads the robot worktree against its base and shows the first file', async () => {
  await open()
  expect($('[data-nx-window] .nx-window-title')!.textContent).toBe('Changes')
  expect($('[data-nx-changes]')!.dataset.robot).toBe('c682')
  expect($('.nx-changes-bar')!.textContent).toContain('#682')
  expect($('.nx-changes-bar')!.textContent).toContain('mnemo-wt-682')
  expect($('.nx-changes-bar')!.textContent).toContain('vs main @ 1a2b3c4')
  expect($('.nx-changes-bar')!.textContent).toContain('2 files +8 −1')
  expect(ipc.sent.find((s) => s.cmd === 'worktree_diff_files')!.args).toEqual({ worktree: WT, base: '' })
  expect(ipc.sent.find((s) => s.cmd === 'worktree_diff_file')!.args).toMatchObject({ worktree: WT, file: 'src/a.ts', base: '' })
  expect($('[data-editor="src/a.ts"]')).not.toBeNull()
  expect($('[data-file="src/a.ts"]')!.getAttribute('aria-current')).toBe('true')
})

test('a file picked from the list is the one shown; side by side is a toggle', async () => {
  await open()
  await click('[data-file="docs/b.md"]')
  await settle()
  expect($('[data-editor="docs/b.md"]')).not.toBeNull()
  expect($('[data-file="docs/b.md"]')!.getAttribute('aria-current')).toBe('true')
  expect($('[data-editor]')!.dataset.sideBySide).toBe('false')
  await click('.nx-changes-tools .nx-btn[aria-pressed]')
  expect($('[data-editor]')!.dataset.sideBySide).toBe('true')
})

test('the notes go to this robot as one reply, and leave once sent', async () => {
  await open()
  await click('[data-stand="add"]')
  await click('[data-stand="add"]')
  expect($('[data-action="send-notes"]')!.textContent).toBe('SEND 2 NOTES')
  expect($('[data-file="src/a.ts"] .nx-changes-notes')!.textContent).toBe('✎2')
  const notes = diffStore.getState().comments
  await click('[data-action="send-notes"]')
  await settle()
  expect(ipc.sent.filter((s) => s.cmd === 'mission_reply').map((s) => s.args)).toEqual([{ id: 'c682', text: formatDiffComments(notes) }])
  expect(diffStore.getState().comments).toEqual([])
  expect($('.nx-changes-status')!.textContent).toBe('Sent 2 notes to #682.')
  expect(($('[data-action="send-notes"]') as HTMLButtonElement).disabled).toBe(true)
})

test("a note's own send goes to this robot too", async () => {
  await open()
  await click('[data-stand="add"]')
  const [note] = diffStore.getState().comments
  await click('[data-stand="send"]')
  await settle()
  expect(ipc.sent.filter((s) => s.cmd === 'mission_reply').map((s) => s.args)).toEqual([{ id: 'c682', text: formatDiffComments([note]) }])
})

test('Esc in a note drops the draft and leaves the window open; Esc elsewhere closes it', async () => {
  await open()
  await act(async () => void $('[data-stand="composer"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(editor.cancelled).toBe(1)
  expect(windowStore.getState().open?.id).toBe('changes')
  await act(async () => void $('[data-file="src/a.ts"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(editor.cancelled).toBe(1)
  expect(windowStore.getState().open).toBeNull()
})

test('a worktree with no change says so', async () => {
  ipc.files = (args) => ({ root: args.worktree, truncated: false, base: 'main @ 1a2b3c4', files: [] })
  await open()
  expect($('.nx-changes-diff')!.textContent).toBe('No change in mnemo-wt-682 against main.')
  expect($('.nx-changes-files')).toBeNull()
})

test('a worktree that is gone says so; another failure shows its reason', async () => {
  ipc.files = () => Promise.reject('git: No such file or directory (os error 2)')
  await open()
  expect($('.nx-changes-diff')!.textContent).toBe(`The worktree is gone: ${WT} is no longer there, so there is nothing to diff.`)

  act(() => r.unmount())
  r = createRoot(host)
  diffStore.setState({ changes: {}, sides: {}, comments: [], sent: {} })
  ipc.files = () => Promise.reject('git status: fatal: index file corrupt')
  await open()
  expect($('.nx-changes-diff')!.textContent).toBe('Could not read the changes: git status: fatal: index file corrupt')
})

test('a robot without a worktree reads nothing and says so', async () => {
  await act(async () => r.render(<ChangesWindow robotId="c9" worktree="" label="#9" close={() => {}} />))
  await settle()
  expect(host.textContent).toContain('#9 has no worktree to read.')
  expect(ipc.sent.some((s) => s.cmd === 'worktree_diff_files')).toBe(false)
})

test('isGone tells a missing tree from other failures, on every platform', () => {
  expect(isGone('git: No such file or directory (os error 2)')).toBe(true)
  expect(isGone('git: The directory name is invalid. (os error 267)')).toBe(true)
  expect(isGone('git rev-parse --show-toplevel: fatal: not a git repository (or any of the parent directories): .git')).toBe(true)
  expect(isGone('git status: fatal: index file corrupt')).toBe(false)
  expect(isGone('git diff: fatal: bad revision')).toBe(false)
})

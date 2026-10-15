import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { vi } from 'vitest'

/** The disk behind the `fs_*` commands, keyed by the path the pane was given, plus every write. */
const disk = vi.hoisted(() => ({ files: new Map<string, string>(), writes: [] as { path: string; contents: string }[] }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: async (cmd: string, args: Record<string, unknown>) => fake(cmd, args) }))
vi.mock('@tauri-apps/api/path', () => ({ homeDir: async () => '/home/me' }))

/** The real Monaco's models; the editor widget is a stand-in that keeps its model and its ⌘S. */
const ui = vi.hoisted(() => ({ save: null as null | (() => void), model: null as unknown }))
vi.mock('./monaco', async () => {
  const real = await import('monaco-editor/editor/editor.api.js')
  const create = () => ({
    addCommand: (_key: number, run: () => void) => void (ui.save = run),
    setModel: (m: unknown) => void (ui.model = m),
    focus: () => {},
    dispose: () => {},
  })
  return { monaco: { ...real, editor: { ...real.editor, create } } }
})

import type { editor as MonacoEditor } from 'monaco-editor'
import { paneView } from '../panes/registry'
import './view'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** `fs.rs` as the front end sees it: a write that names the content it was loaded from is
 *  refused when the disk no longer holds it (unless it already holds what is written). */
function fake(cmd: string, a: Record<string, unknown>): unknown {
  const path = a.path as string
  const stamp = (text: string) => `#${text}`
  const has = disk.files.has(path)
  const text = disk.files.get(path) ?? ''
  if (cmd === 'fs_read') {
    if (!has) throw `${path}: No such file or directory`
    return text
  }
  if (cmd === 'fs_load') {
    if (!has) throw `${path}: No such file or directory`
    return { text, stamp: stamp(text) }
  }
  if (cmd === 'fs_write') {
    const contents = a.contents as string
    const expected = a.expected as string | null | undefined
    if (expected != null) {
      if (!has) return { status: 'gone' }
      if (stamp(text) !== expected && text !== contents) return { status: 'changed' }
    }
    disk.files.set(path, contents)
    disk.writes.push({ path, contents })
    return { status: 'written', stamp: stamp(contents) }
  }
  throw `unexpected command ${cmd}`
}

const FILE = '/home/me/proj/a.ts'
let host: HTMLDivElement
let r: Root
let pane = 9000

beforeEach(() => {
  disk.files.clear()
  disk.writes = []
  ui.save = null
  ui.model = null
  host = document.createElement('div')
  document.body.appendChild(host)
  r = createRoot(host)
})
afterEach(() => {
  act(() => r.unmount())
  host.remove()
})

async function settle() {
  for (let i = 0; i < 6; i++) await act(async () => void (await new Promise((res) => setTimeout(res, 0))))
}
/** Opens `FILE` in a fresh pane and waits for its buffer. */
async function open(): Promise<MonacoEditor.ITextModel> {
  const View = paneView('editor')!
  const id = ++pane
  await act(async () => r.render(<View id={id} props={{ path: FILE, root: '/home/me/proj' }} />))
  await vi.waitFor(async () => {
    await settle()
    expect(ui.model).not.toBeNull()
  }, 15_000)
  return ui.model as MonacoEditor.ITextModel
}
/** Types `text` at the start of line `line`, as a person would. */
const type = (model: MonacoEditor.ITextModel, line: number, text: string) =>
  act(() => void model.pushEditOperations([], [{ range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 }, text }], () => null))
const save = async () => {
  await act(async () => ui.save!())
  await settle()
}
const button = (text: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === text)
const click = async (text: string) => {
  const b = button(text)
  expect(b, `a "${text}" button`).toBeDefined()
  await act(async () => void b!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  await settle()
}

test('a save after an agent rewrote the file does not undo the agent’s change, and says so', async () => {
  disk.files.set(FILE, 'const a = 1\nconst b = 2\n')
  const model = await open()
  // An agent rewrites the file while the buffer sits in another tab: same size, right away.
  disk.files.set(FILE, 'const a = 9\nconst b = 2\n')
  type(model, 2, '// mine\n')
  await save()
  expect(disk.files.get(FILE)).toBe('const a = 9\nconst b = 2\n')
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('changed on disk')
}, 30_000)

test('reload takes the disk’s version and keeps the edits one undo away', async () => {
  disk.files.set(FILE, 'one\n')
  const model = await open()
  disk.files.set(FILE, 'two\n')
  type(model, 1, 'mine ')
  await save()
  await click('reload')
  const now = ui.model as MonacoEditor.ITextModel
  expect(now.getValue()).toBe('two\n')
  expect(host.querySelector('.editor-dirty')).toBeNull()
  expect(host.querySelector('[role="alert"]')).toBeNull()
  act(() => void now.undo())
  expect(now.getValue()).toBe('mine one\n')
  // The disk now holds what the buffer was reloaded from, so saving the edits asks nothing.
  await save()
  expect(disk.files.get(FILE)).toBe('mine one\n')
  expect(host.querySelector('[role="alert"]')).toBeNull()
}, 30_000)

test('overwrite writes the edits and keeps the disk’s version one undo away', async () => {
  disk.files.set(FILE, 'one\n')
  const model = await open()
  disk.files.set(FILE, 'two\n')
  type(model, 1, 'mine ')
  await save()
  await click('overwrite')
  expect(disk.files.get(FILE)).toBe('mine one\n')
  expect(host.querySelector('[role="alert"]')).toBeNull()
  expect(host.querySelector('.editor-dirty')).toBeNull()
  act(() => void model.undo())
  expect(model.getValue()).toBe('two\n')
}, 30_000)

test('a file deleted on disk is not recreated by a save until asked to', async () => {
  disk.files.set(FILE, 'one\n')
  const model = await open()
  disk.files.delete(FILE)
  type(model, 1, 'mine ')
  await save()
  expect(disk.files.has(FILE)).toBe(false)
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('deleted or moved')
  await click('save anyway')
  expect(disk.files.get(FILE)).toBe('mine one\n')
  expect(host.querySelector('[role="alert"]')).toBeNull()
}, 30_000)

test('a save over a file nobody else touched writes the buffer, BOM and CRLF kept, and asks nothing', async () => {
  disk.files.set(FILE, '﻿one\r\ntwo\r\n')
  const model = await open()
  type(model, 2, 'mine ')
  await save()
  expect(disk.writes).toEqual([{ path: FILE, contents: '﻿one\r\nmine two\r\n' }])
  expect(host.querySelector('[role="alert"]')).toBeNull()
  expect(host.querySelector('.editor-dirty')).toBeNull()
  // And again: the second save is checked against what the first one wrote.
  type(model, 1, 'x')
  await save()
  expect(disk.files.get(FILE)).toBe('﻿xone\r\nmine two\r\n')
  expect(host.querySelector('[role="alert"]')).toBeNull()
}, 30_000)

test('reload takes the disk’s BOM and line endings with its text, so the next save keeps them', async () => {
  const cases: [string, string, string][] = [
    ['﻿one\r\n', 'two\n', 'xtwo\n'],
    ['one\n', '﻿two\r\n', '﻿xtwo\r\n'],
  ]
  for (const [before, after, saved] of cases) {
    disk.files.set(FILE, before)
    const model = await open()
    disk.files.set(FILE, after)
    type(model, 1, 'mine ')
    await save()
    await click('reload')
    type(ui.model as MonacoEditor.ITextModel, 1, 'x')
    await save()
    expect(disk.files.get(FILE)).toBe(saved)
    expect(host.querySelector('[role="alert"]')).toBeNull()
  }
}, 30_000)

test('a second save while the first is in flight is not taken for an outside change', async () => {
  disk.files.set(FILE, 'one\n')
  const model = await open()
  type(model, 1, 'a')
  // No await between them: the second is sent before the first's reply.
  await act(async () => {
    ui.save!()
    type(model, 1, 'b')
    ui.save!()
  })
  await settle()
  expect(disk.files.get(FILE)).toBe('baone\n')
  expect(host.querySelector('[role="alert"]')).toBeNull()
}, 30_000)

test('the disk’s version kept by overwrite saves back with one BOM, not two', async () => {
  disk.files.set(FILE, '﻿one\n')
  const model = await open()
  disk.files.set(FILE, '﻿two\n')
  type(model, 1, 'mine ')
  await save()
  await click('overwrite')
  expect(disk.files.get(FILE)).toBe('﻿mine one\n')
  act(() => void model.undo())
  await save()
  expect(disk.files.get(FILE)).toBe('﻿two\n')
}, 30_000)

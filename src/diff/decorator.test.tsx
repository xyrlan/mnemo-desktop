import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { vi } from 'vitest'
import type { editor as MonacoEditor } from 'monaco-editor'

// The decorator reaches Monaco only for these constants; the editor itself is Orca's fake.
vi.mock('monaco-editor', () => ({
  Range: class {
    startLineNumber: number
    endLineNumber: number
    constructor(a: number, _b: number, c: number) {
      this.startLineNumber = a
      this.endLineNumber = c
    }
  },
  editor: { MouseTargetType: { GUTTER_LINE_NUMBERS: 3 }, EditorOption: { lineHeight: 66 } },
}))

import { useDiffCommentDecorator } from './useDiffCommentDecorator'
import { createFakeDiffCommentEditor, FAKE_LINE_HEIGHT_PX, type FakeDiffCommentEditor } from './editor-test-fixture'
import type { DiffComment } from './comment'
import type { DiffCommentLineTarget } from './line-range'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const WT = '/code/app'
const note = (over: Partial<DiffComment>): DiffComment => ({ id: 'n1', worktreeId: WT, filePath: 'a.ts', lineNumber: 4, body: 'look', createdAt: 0, ...over })

type Calls = { add: { lineNumber: number; startLine?: number; top: number }[]; deleted: string[]; sentIds: string[] }

let host: HTMLDivElement
let root: Root
let fake: FakeDiffCommentEditor
let calls: Calls

function Harness(p: { comments: DiffComment[]; pending?: DiffCommentLineTarget | null; commentable?: number[] }) {
  useDiffCommentDecorator({
    editor: fake.editor as MonacoEditor.ICodeEditor,
    monacoModelIdentity: 'm1',
    filePath: 'a.ts',
    worktreeId: WT,
    comments: p.comments,
    commentableLineNumbers: p.commentable,
    pendingCommentTarget: p.pending ?? null,
    onAddCommentClick: (a) => void calls.add.push(a),
    onDeleteComment: (id) => void calls.deleted.push(id),
    onUpdateComment: async () => true,
    onSendComment: (id) => void calls.sentIds.push(id),
  })
  return null
}

const render = (p: Parameters<typeof Harness>[0]) => act(() => root.render(<Harness {...p} />))

/** A pointer event jsdom can dispatch: it has no PointerEvent. */
function pointer(type: string, init: { clientY: number; clientX?: number; target?: EventTarget }) {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: init.clientX ?? 10, clientY: init.clientY })
  Object.defineProperty(e, 'pointerId', { value: 1 })
  Object.defineProperty(e, 'pointerType', { value: 'mouse' })
  ;(init.target ?? fake.domNode).dispatchEvent(e)
}

const flush = () => act(async () => void (await new Promise((r) => requestAnimationFrame(() => r(null)))))

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  fake = createFakeDiffCommentEditor({ lineCount: 50 })
  calls = { add: [], deleted: [], sentIds: [] }
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  fake.domNode.remove()
})

test('hovering a line shows the "+", and pressing it opens the composer on that line', async () => {
  await render({ comments: [] })
  const plus = fake.domNode.querySelector<HTMLButtonElement>('.orca-diff-comment-add-btn')!
  expect(plus.style.display).toBe('none')
  act(() => fake.emitMouseMove(5))
  expect(plus.style.display).toBe('flex')
  pointer('pointerdown', { clientY: fake.clientYForLine(5), target: plus })
  pointer('pointerup', { clientY: fake.clientYForLine(5), target: document })
  expect(calls.add).toEqual([{ lineNumber: 5, startLine: undefined, top: 5 * FAKE_LINE_HEIGHT_PX }])
})

test('a drag down the gutter opens the composer on the range', async () => {
  await render({ comments: [] })
  pointer('pointerdown', { clientY: fake.clientYForLine(3) })
  pointer('pointermove', { clientY: fake.clientYForLine(6), target: document })
  await flush()
  expect(fake.decorations()).toEqual([expect.objectContaining({ startLine: 3, endLine: 6, className: 'orca-diff-comment-range-highlight' })])
  pointer('pointerup', { clientY: fake.clientYForLine(6), target: document })
  expect(calls.add).toEqual([expect.objectContaining({ lineNumber: 6, startLine: 3 })])
})

test('a line that takes no notes shows no "+"', async () => {
  await render({ comments: [], commentable: [] })
  const plus = fake.domNode.querySelector<HTMLButtonElement>('.orca-diff-comment-add-btn')!
  act(() => fake.emitMouseMove(5))
  expect(plus.style.display).toBe('none')
})

test('the open composer keeps its lines lit', async () => {
  await render({ comments: [], pending: { lineNumber: 9, startLine: 7 } })
  expect(fake.decorations()).toEqual([expect.objectContaining({ startLine: 7, endLine: 9 })])
  await render({ comments: [], pending: null })
  expect(fake.decorations()).toEqual([])
})

test('each note of this file shows as a card under its line, and goes when the note does', async () => {
  const mine = note({ id: 'a', lineNumber: 4, body: 'rename this' })
  const other = note({ id: 'b', filePath: 'b.ts' })
  const elsewhere = note({ id: 'c', worktreeId: '/other' })
  await render({ comments: [mine, other, elsewhere] })
  await act(async () => {})
  const zones = [...fake.zones.values()]
  expect(zones.map((z) => z.afterLineNumber)).toEqual([4])
  const card = zones[0].domNode
  expect(card.textContent).toContain('rename this')
  expect(card.textContent).toContain('line 4')

  act(() => card.querySelector<HTMLButtonElement>('[aria-label="Send this note to the agent"]')!.click())
  act(() => card.querySelector<HTMLButtonElement>('[aria-label="Delete note"]')!.click())
  expect(calls.sentIds).toEqual(['a'])
  expect(calls.deleted).toEqual(['a'])

  await render({ comments: [other] })
  expect(fake.zones.size).toBe(0)
})

test('an edited note re-renders in its zone rather than a new one', async () => {
  await render({ comments: [note({ body: 'first' })] })
  await act(async () => {})
  const [id] = fake.zones.keys()
  await render({ comments: [note({ body: 'second' })] })
  await act(async () => {})
  expect([...fake.zones.keys()]).toEqual([id])
  expect(fake.zones.get(id)!.domNode.textContent).toContain('second')
})

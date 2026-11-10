import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { vi } from 'vitest'

// The panel's default store is the app's, which reaches for the core as it loads. These tests
// hand the view a store of their own; nothing here should reach the core.
vi.mock('@tauri-apps/api/core', () => ({ invoke: async (cmd: string) => Promise.reject(new Error(`the core was asked for ${cmd}`)), Channel: class {} }))
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }))

import type { ChangeList, DiffClient, FileSides } from '../../diff/client'
import { createDiffStore } from '../../diff/store'
import { NO_ACTIONS, setActions, type Actions, type Outcome } from '../../world/actions'
import { HOME, routeStore } from '../../world/route'
import { sampleWorld } from '../../world/sample'
import { rosterOrder, worldStore } from '../../world/store'
import { ChangesView } from './ChangesPanel'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// The sample world's child that waits on a permission: its worktree is what the panel reads.
const world = sampleWorld()
const child = world.sessions.find((s) => s.title.startsWith('Webhook signature check'))!
const WT = child.cwd!

const FILES: ChangeList = {
  root: '/work/atlas-api-wt-webhook',
  truncated: false,
  base: 'main @ 1a2b3c4',
  files: [
    { path: 'src/a.ts', oldPath: null, status: 'modified', additions: 2, deletions: 1, binary: false },
    { path: 'docs/b.md', oldPath: null, status: 'added', additions: 2, deletions: 0, binary: false },
    { path: 'src/gone.ts', oldPath: null, status: 'deleted', additions: 0, deletions: 1, binary: false },
  ],
}
const lines = (n: number, change: Record<number, string> = {}) => Array.from({ length: n }, (_, i) => change[i + 1] ?? `line ${i + 1}`).join('\n') + '\n'
const SIDES: Record<string, FileSides> = {
  // Line 10 changed and line 30 added at the end: two blocks, a fold between them.
  'src/a.ts': { original: lines(29), modified: lines(30, { 10: 'line ten, changed' }), binary: false, tooLarge: false },
  'docs/b.md': { original: '', modified: 'first\nsecond\n', binary: false, tooLarge: false },
  'src/gone.ts': { original: 'bye\n', modified: '', binary: false, tooLarge: false },
}

type Rig = { store: ReturnType<typeof createDiffStore>; read: string[]; replies: [string, string][]; opened: string[] }
let undo = () => {}
let root: Root | null = null

function rig(over: Partial<DiffClient> = {}, reply: Outcome = { ok: true }): Rig {
  const read: string[] = []
  const replies: [string, string][] = []
  const opened: string[] = []
  const client: DiffClient = {
    files: async (worktree, base) => (read.push(`files ${worktree} ${JSON.stringify(base)}`), FILES),
    sides: async (_worktree, file) => (read.push(`sides ${file}`), SIDES[file]),
    ...over,
  }
  let n = 0
  const store = createDiffStore({ client, target: () => null, deliver: { reply: async () => {}, write: async () => {} }, storage: null, now: () => 1000, newId: () => `note-${++n}` })
  const acts: Actions = { ...NO_ACTIONS, reply: async (id, text) => (replies.push([id, text]), reply), external: async (target) => (opened.push(target), { ok: true }) }
  undo = setActions(acts)
  return { store, read, replies, opened }
}

const settle = () => act(async () => void (await new Promise((res) => setTimeout(res, 0))))
async function mount(r: Rig, session: string | null = child.id) {
  worldStore.getState().set(world)
  routeStore.setState({ route: { ...HOME, session, panel: 'changes' }, recent: [] })
  const host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  await act(async () => root!.render(<ChangesView store={r.store} />))
  await settle()
  await settle()
}
afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  undo()
  document.body.innerHTML = ''
})

const panel = () => document.querySelector<HTMLElement>('[data-changes]')!
const files = () => [...document.querySelectorAll('[data-file]')].map((e) => e.getAttribute('data-file'))
const shown = () => document.querySelector('[data-diff]')?.getAttribute('data-diff')
const current = () => document.querySelector('[data-file][aria-current]')?.getAttribute('data-file')
const code = () => [...document.querySelectorAll('.mn-changes-line')].map((e) => `${e.getAttribute('data-sign') ?? ' '} ${e.querySelector('.mn-changes-code')!.textContent}`)
const numberOn = (n: number) => document.querySelector<HTMLElement>(`button[aria-label="Note on line ${n}"]`)
async function press(key: string, init: KeyboardEventInit = {}) {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  await act(async () => void (document.activeElement ?? panel()).dispatchEvent(e))
  await settle()
  return e
}
const click = async (el: Element | null | undefined, init: MouseEventInit = {}) => {
  await act(async () => void el!.dispatchEvent(new MouseEvent('click', { bubbles: true, ...init })))
  await settle()
}
const write = (value: string) =>
  act(async () => {
    const area = document.querySelector<HTMLTextAreaElement>('[data-composer] textarea')!
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(area, value)
    area.dispatchEvent(new Event('input', { bubbles: true }))
  })
async function note(line: number, body: string, init: MouseEventInit = {}) {
  await click(numberOn(line), init)
  await write(body)
  await press('Enter')
}

test('the selected session\'s worktree is read against the default branch: its files in the order given, the first one shown', async () => {
  const r = rig()
  await mount(r)
  expect(r.read[0]).toBe(`files ${WT} ""`)
  expect(files()).toEqual(['src/a.ts', 'docs/b.md', 'src/gone.ts'])
  expect([current(), shown()]).toEqual(['src/a.ts', 'src/a.ts'])
  expect(panel().textContent).toContain(child.title)
  expect(panel().textContent).toContain('against main @ 1a2b3c4')
  expect(panel().textContent).toContain('3 files +4 −2')
})

test('the diff shows each change with the lines around it, and says how many lines it left out', async () => {
  await mount(rig())
  expect(code()).toEqual([
    '  line 7',
    '  line 8',
    '  line 9',
    '- line 10',
    '+ line ten, changed',
    '  line 11',
    '  line 12',
    '  line 13',
    '  line 27',
    '  line 28',
    '  line 29',
    '+ line 30',
  ])
  expect([...document.querySelectorAll('[data-fold]')].map((f) => f.textContent)).toEqual(['⋯ 6 unchanged lines · show', '⋯ 13 unchanged lines · show'])
  // The lines left out come back when asked for.
  await click(document.querySelectorAll('[data-fold]')[1])
  expect(code().length).toBe(25)
  expect(code()).toContain('  line 20')
})

test('the arrows walk the files and stop at the ends; each file\'s sides are read when it is shown', async () => {
  const r = rig()
  await mount(r)
  await press('ArrowUp')
  expect(shown()).toBe('src/a.ts')
  await press('ArrowDown')
  expect([current(), shown()]).toEqual(['docs/b.md', 'docs/b.md'])
  expect(code()).toEqual(['+ first', '+ second'])
  await press('ArrowDown')
  await press('ArrowDown')
  expect(shown()).toBe('src/gone.ts')
  expect(r.read.filter((x) => x.startsWith('sides'))).toEqual(['sides src/a.ts', 'sides docs/b.md', 'sides src/gone.ts'])
})

test('V lays the diff side by side, the removed line beside the one that replaced it, and back', async () => {
  await mount(rig())
  await press('v')
  expect(document.querySelector('[data-diff]')!.getAttribute('data-layout')).toBe('split')
  const pair = [...document.querySelectorAll('.mn-changes-pair')].find((p) => p.textContent!.includes('line ten, changed'))!
  expect([...pair.querySelectorAll('.mn-changes-code')].map((c) => [c.getAttribute('data-sign'), c.textContent])).toEqual([
    ['-', 'line 10'],
    ['+', 'line ten, changed'],
  ])
  await press('v')
  expect(document.querySelector('[data-diff]')!.getAttribute('data-layout')).toBe('inline')
})

test('a note is written on a line by its number: it is kept with the line it quotes, shown under it, and counted on its file', async () => {
  const r = rig()
  await mount(r)
  await note(10, 'say why this changed')
  expect(r.store.getState().comments).toEqual([{ id: 'note-1', worktreeId: WT, filePath: 'src/a.ts', lineNumber: 10, body: 'say why this changed', quote: 'line ten, changed', createdAt: 1000 }])
  const card = document.querySelector('[data-note="note-1"]')!
  expect(card.textContent).toContain('Line 10')
  expect(card.textContent).toContain('say why this changed')
  // Under its line: the card follows line 10's row.
  expect(card.closest('.mn-changes-linerow')!.querySelector('.mn-changes-code')!.textContent).toBe('line ten, changed')
  expect(document.querySelector('[data-file="src/a.ts"]')!.textContent).toContain('1 note')
  expect(document.querySelector('[data-composer]')).toBeNull()
})

test('with shift the note runs from the line it was started on, and quotes every line of it', async () => {
  const r = rig()
  await mount(r)
  await click(numberOn(11))
  await press('Escape')
  await note(13, 'these three', { shiftKey: true })
  expect(r.store.getState().comments[0]).toMatchObject({ startLine: 11, lineNumber: 13, quote: 'line 11\nline 12\nline 13' })
  expect(document.querySelector('[data-note]')!.textContent).toContain('Lines 11-13')
})

test('Esc while a note is written drops the draft and goes no further: the panel stays open', async () => {
  const r = rig()
  await mount(r)
  await click(numberOn(10))
  await write('half a thought')
  const seen: string[] = []
  const onWindow = (e: Event) => void seen.push((e as KeyboardEvent).key)
  window.addEventListener('keydown', onWindow)
  const e = await press('Escape')
  window.removeEventListener('keydown', onWindow)
  expect(e.defaultPrevented).toBe(true)
  expect(seen).toEqual([])
  expect(document.querySelector('[data-composer]')).toBeNull()
  expect(r.store.getState().comments).toEqual([])
})

test('a deleted file has no working side, so it takes no notes', async () => {
  await mount(rig())
  await press('ArrowDown')
  await press('ArrowDown')
  expect(shown()).toBe('src/gone.ts')
  expect(code()).toEqual(['- bye'])
  expect(document.querySelector('button[aria-label^="Note on line"]')).toBeNull()
})

test('S sends every note of the worktree to the session as one reply, and the notes that went are dropped', async () => {
  const r = rig()
  await mount(r)
  await note(10, 'say why this changed')
  await press('ArrowDown')
  await note(2, 'second thought')
  await press('s')
  expect(r.replies.length).toBe(1)
  expect(r.replies[0][0]).toBe(child.id)
  expect(r.replies[0][1]).toContain('2 notes')
  expect(r.replies[0][1]).toContain('src/a.ts — line 10\n> line ten, changed\nsay why this changed')
  expect(r.replies[0][1]).toContain('docs/b.md — line 2\n> second\nsecond thought')
  expect(r.store.getState().comments).toEqual([])
  expect(document.querySelector('[role="status"]')!.textContent).toContain(`Sent 2 notes to ${child.title}.`)
})

test('a reply that is refused keeps the notes and says why', async () => {
  const r = rig({}, { ok: false, why: 'its input box holds a draft' })
  await mount(r)
  await note(10, 'say why this changed')
  await press('s')
  expect(r.store.getState().comments.length).toBe(1)
  expect(document.querySelector('[role="alert"]')!.textContent).toContain('The note was not sent: its input box holds a draft')
  expect(document.querySelector('[data-note="note-1"]')).not.toBeNull()
})

test('one note is sent by itself from its card, and the others stay', async () => {
  const r = rig()
  await mount(r)
  await note(10, 'first')
  await note(12, 'second')
  await click([...document.querySelectorAll('[data-note="note-2"] button')].find((b) => b.textContent === 'send'))
  expect(r.replies.length).toBe(1)
  expect(r.replies[0][1]).toContain('second')
  expect(r.replies[0][1]).not.toContain('first')
  expect(r.store.getState().comments.map((c) => c.id)).toEqual(['note-1'])
})

test('S with no note sends nothing', async () => {
  const r = rig()
  await mount(r)
  await press('s')
  expect(r.replies).toEqual([])
})

test('O opens the file shown, by its place in the worktree', async () => {
  const r = rig()
  await mount(r)
  await press('ArrowDown')
  await press('o')
  expect(r.opened).toEqual(['/work/atlas-api-wt-webhook/docs/b.md'])
})

test('U reads the changes again', async () => {
  const r = rig()
  await mount(r)
  const before = r.read.filter((x) => x.startsWith('files')).length
  await press('u')
  expect(r.read.filter((x) => x.startsWith('files')).length).toBe(before + 1)
})

test('a worktree with no change says so against its base; one that is gone says that', async () => {
  await mount(rig({ files: async () => ({ ...FILES, files: [] }) }))
  expect(panel().textContent).toContain('No change in atlas-api-wt-webhook against main.')
  await act(async () => root?.unmount())
  document.body.innerHTML = ''
  await mount(rig({ files: async () => Promise.reject(new Error('git: No such file or directory (os error 2)')) }))
  expect(panel().textContent).toContain('The worktree is gone')
})

test('with no session selected the panel asks whose changes, in the roster\'s order; picking one reads its worktree', async () => {
  const r = rig()
  await mount(r, null)
  expect(r.read).toEqual([])
  const picks = [...document.querySelectorAll('[data-changes-chooser] button')]
  expect(picks.map((p) => p.querySelector('.mn-changes-pick-title')!.textContent)).toEqual(rosterOrder(world).filter((s) => s.cwd).map((s) => s.title))
  await click(picks.find((p) => p.textContent!.includes(child.title)))
  expect(routeStore.getState().route.session).toBe(child.id)
  expect(r.read[0]).toBe(`files ${WT} ""`)
  expect(shown()).toBe('src/a.ts')
})

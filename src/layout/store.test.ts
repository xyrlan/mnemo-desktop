import { createStore } from './store'
import type { PtyClient } from '../pty/client'

function fakePty(opts: { failSpawn?: boolean; promptBeforeResolve?: boolean } = {}): PtyClient & { killed: number[]; outputs: Record<number, (b: Uint8Array) => void> } {
  let next = 1
  const killed: number[] = []
  const outputs: Record<number, (b: Uint8Array) => void> = {}
  return {
    killed,
    outputs,
    spawn: async ({ onOutput }) => {
      if (opts.failSpawn) throw new Error('boom')
      const id = next++
      outputs[id] = onOutput
      if (opts.promptBeforeResolve) onOutput(new Uint8Array([36, 32])) // "$ " before invoke resolves
      return id
    },
    write: async () => {},
    resize: async () => {},
    kill: async (id) => {
      killed.push(id)
    },
    onExit: async () => () => {},
  }
}

test('boot creates one tab with one pane', async () => {
  const s = createStore(fakePty())
  await s.getState().newTab()
  const st = s.getState()
  expect(st.tabs).toHaveLength(1)
  expect(st.tabs[0].root).toEqual({ kind: 'leaf', pane: 1 })
  expect(st.tabs[0].focused).toBe(1)
  expect(st.panes[1]).toEqual({ id: 1, cwd: undefined })
})

test('split focuses the new pane and inherits cwd', async () => {
  const s = createStore(fakePty())
  await s.getState().newTab()
  s.getState().setCwd(1, '/work')
  await s.getState().split('row')
  const t = s.getState().tabs[0]
  expect(t.focused).toBe(2)
  expect(t.root.kind).toBe('split')
  expect(s.getState().panes[2].cwd).toBe('/work')
})

test('closing the last pane of the last tab opens a fresh tab', async () => {
  const pty = fakePty()
  const s = createStore(pty)
  await s.getState().newTab()
  await s.getState().closePane()
  const st = s.getState()
  expect(pty.killed).toEqual([1])
  expect(st.tabs).toHaveLength(1)
  expect(st.tabs[0].root).toEqual({ kind: 'leaf', pane: 2 })
  expect(st.panes[1]).toBeUndefined()
})

test('closing a pane in a split promotes the sibling and focuses it', async () => {
  const s = createStore(fakePty())
  await s.getState().newTab()
  await s.getState().split('row')
  await s.getState().closePane()
  const t = s.getState().tabs[0]
  expect(t.root).toEqual({ kind: 'leaf', pane: 1 })
  expect(t.focused).toBe(1)
})

test('closing a whole tab activates the previous one', async () => {
  const s = createStore(fakePty())
  await s.getState().newTab()
  await s.getState().newTab()
  await s.getState().closePane()
  const st = s.getState()
  expect(st.tabs).toHaveLength(1)
  expect(st.activeTab).toBe(st.tabs[0].id)
})

test('goToTab and cycle', async () => {
  const s = createStore(fakePty())
  await s.getState().newTab()
  await s.getState().newTab()
  expect(s.getState().activeTab).toBe(s.getState().tabs[1].id)
  s.getState().goToTab(0)
  expect(s.getState().activeTab).toBe(s.getState().tabs[0].id)
  s.getState().cycleTab(-1)
  expect(s.getState().activeTab).toBe(s.getState().tabs[1].id)
  s.getState().goToTab(7)
  expect(s.getState().activeTab).toBe(s.getState().tabs[1].id)
})

test('setCwd and setTitle update the pane record', async () => {
  const s = createStore(fakePty())
  await s.getState().newTab()
  s.getState().setCwd(1, '/tmp')
  s.getState().setTitle(1, 'vim')
  expect(s.getState().panes[1]).toEqual({ id: 1, cwd: '/tmp', title: 'vim' })
})

test('paneExited marks the pane', async () => {
  const s = createStore(fakePty())
  await s.getState().newTab()
  s.getState().paneExited(1, 0)
  expect(s.getState().panes[1].exitCode).toBe(0)
})

test('output reaches the attached sink', async () => {
  const pty = fakePty()
  const s = createStore(pty)
  await s.getState().newTab()
  const got: Uint8Array[] = []
  s.getState().attachSink(1, (b) => got.push(b))
  pty.outputs[1](new Uint8Array([104, 105]))
  expect(got).toHaveLength(1)
})

test('spawn failure renders an error pane and never calls kill with a negative id', async () => {
  const pty = fakePty({ failSpawn: true })
  const s = createStore(pty)
  await s.getState().newTab()
  const st = s.getState()
  expect(st.tabs[0].root).toEqual({ kind: 'leaf', pane: -1 })
  expect(st.panes[-1].error).toContain('boom')
  await s.getState().closePane()
  expect(pty.killed).toEqual([])
})

test('output before the pane attaches is buffered, including bytes sent before spawn resolves', async () => {
  const pty = fakePty({ promptBeforeResolve: true })
  const s = createStore(pty)
  await s.getState().newTab()
  pty.outputs[1](new Uint8Array([104, 105]))
  const got: number[] = []
  s.getState().attachSink(1, (b) => got.push(...b))
  expect(got).toEqual([36, 32, 104, 105])
  pty.outputs[1](new Uint8Array([33]))
  expect(got).toEqual([36, 32, 104, 105, 33])
})

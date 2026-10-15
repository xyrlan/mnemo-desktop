import type { PaneId, PtyClient } from '../pty/client'
import { DETACH_KEY } from '../cockpit/prompt'
import { createPopoutStore, endLeftovers, STORAGE_KEY, type PopoutDeps } from './store'

/** A pty client that records what is done to which PTY, in order. */
function fakePty(opts: { spawnFails?: boolean } = {}) {
  let next = 50
  const log: string[] = []
  const exits: Record<PaneId, (code: number | null) => void> = {}
  const outputs: Record<PaneId, (b: Uint8Array) => void> = {}
  let release: (() => void) | null = null
  const pty: PtyClient & { hold(): void } = {
    hold: () => {
      const gate = new Promise<void>((r) => (release = r))
      const spawn = pty.spawn
      pty.spawn = async (o) => (await gate, spawn(o))
    },
    async spawn({ onOutput }) {
      if (opts.spawnFails) throw new Error('no pty')
      const id = next++
      outputs[id] = onOutput
      log.push(`spawn ${id}`)
      return id
    },
    write: async (id, data) => void log.push(`write ${id} ${JSON.stringify(data)}`),
    resize: async () => {},
    kill: async (id) => void log.push(`kill ${id}`),
    onExit: async (id, cb) => {
      exits[id] = cb
      return () => {}
    },
  }
  return { pty, log, exits, outputs, release: () => release?.() }
}

function make(p: PtyClient, storage: Storage | null = null) {
  const sinks: Record<PaneId, (b: Uint8Array) => void> = {}
  const deps: PopoutDeps = {
    pty: p,
    shell: () => 'posix',
    sinkOf: (id) => sinks[id],
    watchSinks: () => () => {},
    forgetSink: (id) => void delete sinks[id],
    storage,
    viewport: () => ({ width: 1440, height: 900 }),
  }
  return { store: createPopoutStore(deps), sinks }
}

const work = { id: 'b0b0b0b0', account_env: { config_dir: '/Users/me/.claude-work' } }

beforeEach(() => localStorage.clear())

test('a child pops out as `claude attach` on its own account, in a PTY of its own', async () => {
  const f = fakePty()
  const { store } = make(f.pty)
  await store.getState().openChild(work, 'fix the build')
  expect(store.getState().popups).toMatchObject([{ key: 'child:b0b0b0b0', kind: 'attach', title: 'fix the build', pty: 50 }])
  expect(f.log).toEqual(['spawn 50', `write 50 ${JSON.stringify('exec env CLAUDE_CONFIG_DIR=/Users/me/.claude-work claude attach b0b0b0b0\r')}`])
})

test('closing an attach popup detaches and ends only its own PTY: the child is never stopped', async () => {
  const f = fakePty()
  const { store } = make(f.pty)
  store.getState().openPane(7, 'a pane')
  await store.getState().openChild(work, 'child')
  f.log.length = 0
  await store.getState().close('child:b0b0b0b0')
  expect(f.log).toEqual([`write 50 ${JSON.stringify(DETACH_KEY)}`, 'kill 50'])
  expect(f.log.join('\n')).not.toMatch(/claude stop|kill 7/)
  expect(store.getState().popups.map((p) => p.key)).toEqual(['pane:7'])
})

test('closing a pane popup ends nothing: the pane keeps its session', async () => {
  const f = fakePty()
  const { store } = make(f.pty)
  store.getState().openPane(7, 'a pane')
  await store.getState().close('pane:7')
  expect(f.log).toEqual([])
  expect(store.getState().popups).toEqual([])
})

test('an attach closed while its PTY starts is detached as soon as it has one', async () => {
  const f = fakePty()
  f.pty.hold()
  const { store } = make(f.pty)
  const opening = store.getState().openChild('c2c2c2c2', 'child')
  await store.getState().close('child:c2c2c2c2')
  f.release()
  await opening
  expect(f.log).toEqual(['spawn 50', `write 50 ${JSON.stringify(DETACH_KEY)}`, 'kill 50'])
  expect(store.getState().popups).toEqual([])
})

test('an attach that ends by itself takes its popup with it', async () => {
  const f = fakePty()
  const { store } = make(f.pty)
  await store.getState().openChild('c2c2c2c2', 'child')
  f.exits[50](0)
  expect(store.getState().popups).toEqual([])
  expect(store.getState().held()).toEqual([])
})

test('several popups at once, each its own session; one asked again is raised, not opened twice', async () => {
  const f = fakePty()
  const { store, sinks } = make(f.pty)
  store.getState().openPane(7, 'seven')
  store.getState().openPane(8, 'eight')
  await store.getState().openChild('c2c2c2c2', 'child')
  await store.getState().openChild('d3d3d3d3', 'other child')
  expect(store.getState().popups.map((p) => [p.key, p.pty])).toEqual([
    ['pane:7', 7],
    ['pane:8', 8],
    ['child:c2c2c2c2', 50],
    ['child:d3d3d3d3', 51],
  ])
  // Each attach's output reaches its own view.
  const got: Record<number, string> = { 50: '', 51: '' }
  sinks[50] = (b) => (got[50] += new TextDecoder().decode(b))
  sinks[51] = (b) => (got[51] += new TextDecoder().decode(b))
  f.outputs[50](new TextEncoder().encode('first'))
  f.outputs[51](new TextEncoder().encode('second'))
  expect(got).toEqual({ 50: 'first', 51: 'second' })

  store.getState().openPane(7, 'seven')
  await store.getState().openChild('c2c2c2c2', 'child')
  expect(store.getState().popups.map((p) => p.key)).toEqual(['pane:8', 'child:d3d3d3d3', 'pane:7', 'child:c2c2c2c2'])
  expect(f.log.filter((l) => l.startsWith('spawn'))).toHaveLength(2)
  // Each opens down and to the left of the one before, so none hides another.
  const lefts = store.getState().popups.map((p) => p.bounds.left)
  expect(new Set(lefts).size).toBe(4)
})

test('a pane closed under its popup takes the popup with it', () => {
  const { store } = make(fakePty().pty)
  store.getState().openPane(7, 'seven')
  store.getState().paneGone(7)
  expect(store.getState().popups).toEqual([])
})

test('a spawn that fails says so in the popup', async () => {
  const { store } = make(fakePty({ spawnFails: true }).pty)
  await store.getState().openChild('c2c2c2c2', 'child')
  expect(store.getState().popups[0]).toMatchObject({ pty: null, error: 'Error: no pty' })
})

test('the attaches a reloaded page left are detached at the next load, and only those', async () => {
  const f = fakePty()
  const { store } = make(f.pty, localStorage)
  await store.getState().openChild('c2c2c2c2', 'child')
  expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual([50])

  const after = fakePty()
  expect(endLeftovers({ pty: after.pty, storage: localStorage })).toEqual([50])
  await new Promise((r) => setTimeout(r, 0))
  expect(after.log).toEqual([`write 50 ${JSON.stringify(DETACH_KEY)}`, 'kill 50'])
  expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
})

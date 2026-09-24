import type { PaneId, PtyClient } from '../pty/client'
import type { PtyInfo, SessionClient } from '../terminal/sessions'
import { createFloatingStore, createRouter, hideFrom, STORAGE_KEY, type FloatingDeps } from './store'

const flush = () => new Promise((r) => setTimeout(r, 0))
const bytes = (s: string) => new TextEncoder().encode(s)
const text = (chunks: Uint8Array[]) => chunks.map((c) => new TextDecoder().decode(c)).join('')

function memoryStorage(): Storage {
  const m = new Map<string, string>()
  return {
    get length() {
      return m.size
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, v),
  }
}

/** A core with shells: spawn, kill, exits and output driven by the test. */
function fakeCore(opts: { held?: PtyInfo[]; failSpawn?: boolean } = {}) {
  let next = 10
  const spawned: { id: PaneId; cwd?: string }[] = []
  const killed: PaneId[] = []
  const outputs = new Map<PaneId, (b: Uint8Array) => void>()
  const exits = new Map<PaneId, () => void>()
  const held = [...(opts.held ?? [])]
  const attached: PaneId[] = []
  const pty: PtyClient = {
    async spawn({ cwd, onOutput }) {
      if (opts.failSpawn) throw new Error('no shell')
      const id = next++
      spawned.push({ id, cwd })
      outputs.set(id, onOutput)
      onOutput(bytes(`prompt${id}$ `)) // before the spawn resolves, as a real prompt often is
      return id
    },
    write: async () => {},
    resize: async () => {},
    kill: async (id) => void killed.push(id),
    onExit: async (id, cb) => {
      exits.set(id, () => cb(0))
      return () => {}
    },
  }
  const sessions: SessionClient = {
    list: async () => held,
    async attach(id, onOutput) {
      attached.push(id)
      outputs.set(id, onOutput)
      return bytes(`screen${id}|`)
    },
  }
  return { pty, sessions, spawned, killed, attached, out: (id: PaneId, s: string) => outputs.get(id)!(bytes(s)), exit: (id: PaneId) => exits.get(id)!() }
}

/** The layout store's sinks, as the terminal view attaches them. */
function fakeSinks() {
  const sinks = new Map<PaneId, (b: Uint8Array) => void>()
  const watchers = new Set<() => void>()
  return {
    sinkOf: (id: PaneId) => sinks.get(id),
    watchSinks: (cb: () => void) => (watchers.add(cb), () => void watchers.delete(cb)),
    forgetSink: (id: PaneId) => void sinks.delete(id),
    attach(id: PaneId) {
      const got: Uint8Array[] = []
      sinks.set(id, (b) => void got.push(b))
      for (const w of watchers) w()
      return got
    },
    has: (id: PaneId) => sinks.has(id),
  }
}

function setup(opts: { held?: PtyInfo[]; failSpawn?: boolean; storage?: Storage; viewport?: { width: number; height: number } } = {}) {
  const core = fakeCore(opts)
  const sinks = fakeSinks()
  const storage = opts.storage ?? memoryStorage()
  const viewport = { width: 1440, height: 900, ...opts.viewport }
  const deps: FloatingDeps = { pty: core.pty, sessions: core.sessions, ...sinks, storage, viewport: () => viewport }
  const store = createFloatingStore(deps)
  return { core, sinks, storage, viewport, store, s: () => store.getState() }
}

describe('the floating terminal store', () => {
  it("opens on the active worktree's own shell, started in its folder, and keeps it when hidden", async () => {
    const { store, s, core } = setup()
    s().setWhere('/code/app', '/code/app')
    expect(core.spawned).toEqual([]) // nothing starts until the panel opens
    s().toggle()
    expect(s().open).toBe(true)
    expect(s().shells['/code/app']).toEqual({ key: '/code/app', pty: null, cwd: '/code/app' })
    await flush()
    expect(core.spawned).toEqual([{ id: 10, cwd: '/code/app' }])
    expect(s().shells['/code/app'].pty).toBe(10)
    s().toggle()
    expect(s().open).toBe(false)
    s().toggle()
    await flush()
    expect(core.spawned).toHaveLength(1)
    expect(store.getState().shells['/code/app'].pty).toBe(10)
  })

  it('follows the active worktree while open, each keeping its shell', async () => {
    const { s, core } = setup()
    s().setWhere('/code/app', '/code/app')
    s().show()
    await flush()
    s().setWhere('/code/site', '/code/site')
    await flush()
    expect(core.spawned.map((x) => x.cwd)).toEqual(['/code/app', '/code/site'])
    s().setWhere('/code/app', '/code/app')
    await flush()
    expect(core.spawned).toHaveLength(2)
    // Closed, a switch starts nothing.
    s().hide()
    s().setWhere('/code/other', '/code/other')
    await flush()
    expect(core.spawned).toHaveLength(2)
    expect(Object.keys(s().shells).sort()).toEqual(['/code/app', '/code/site'])
  })

  it("draws a shell's output in its view, what came before the view first", async () => {
    const { s, core, sinks } = setup()
    s().show()
    await flush()
    core.out(10, 'ls\r\n')
    const got = sinks.attach(10)
    expect(text(got)).toBe('prompt10$ ls\r\n')
    core.out(10, 'a b c')
    expect(text(got)).toBe('prompt10$ ls\r\na b c')
  })

  it('hands a view mounted twice in a row (StrictMode) what the first one got', () => {
    let sink: ((b: Uint8Array) => void) | undefined
    const router = createRouter(() => sink)
    router.route(1, bytes('one'))
    const first: Uint8Array[] = []
    sink = (b) => void first.push(b)
    router.refresh([1])
    const second: Uint8Array[] = []
    sink = (b) => void second.push(b)
    router.refresh([1])
    expect(text(first)).toBe('one')
    expect(text(second)).toBe('one')
    // Live output reached a view: the next one starts from what comes next.
    router.route(1, bytes('two'))
    const third: Uint8Array[] = []
    sink = (b) => void third.push(b)
    router.refresh([1])
    expect(text(third)).toBe('')
  })

  it('closes when the shown shell exits, and opens on a new one next time', async () => {
    const { s, core, sinks, storage } = setup()
    s().setWhere('/code/app', '/code/app')
    s().show()
    await flush()
    sinks.attach(10)
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!).ptys).toEqual({ '/code/app': 10 })
    core.exit(10)
    expect(s().open).toBe(false)
    expect(s().shells).toEqual({})
    expect(sinks.has(10)).toBe(false)
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!).ptys).toEqual({})
    s().show()
    await flush()
    expect(s().shells['/code/app'].pty).toBe(11)
  })

  it("stays open when a worktree's shell not shown exits", async () => {
    const { s, core } = setup()
    s().setWhere('/a', '/a')
    s().show()
    await flush()
    s().setWhere('/b', '/b')
    await flush()
    core.exit(10)
    expect(s().open).toBe(true)
    expect(Object.keys(s().shells)).toEqual(['/b'])
  })

  it('attaches again to the shell a worktree had before a reload, its screen first', async () => {
    const storage = memoryStorage()
    storage.setItem(STORAGE_KEY, JSON.stringify({ bounds: null, maximized: false, ptys: { '/code/app': 7 } }))
    const { s, core, sinks } = setup({ storage, held: [{ id: 7, cwd: '/code/app', pid: 1, alive: true }] })
    s().setWhere('/code/app', '/code/app')
    s().show()
    await flush()
    expect(core.spawned).toEqual([])
    expect(core.attached).toEqual([7])
    expect(s().shells['/code/app'].pty).toBe(7)
    core.out(7, 'later')
    expect(text(sinks.attach(7))).toBe('screen7|later')
  })

  it("starts a new shell when the remembered one has ended, killing it if it is dead", async () => {
    const storage = memoryStorage()
    storage.setItem(STORAGE_KEY, JSON.stringify({ ptys: { '/code/app': 7, '/code/site': 8 } }))
    const { s, core } = setup({ storage, held: [{ id: 7, cwd: '/code/app', pid: 1, alive: false }] })
    s().setWhere('/code/app', '/code/app')
    s().show()
    await flush()
    expect(core.killed).toEqual([7])
    expect(core.attached).toEqual([])
    expect(s().shells['/code/app'].pty).toBe(10)
    // Pruning forgets the one the core no longer holds at all.
    await s().prune()
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!).ptys).toEqual({ '/code/app': 10 })
  })

  it('prunes, at load, the remembered shells that ended, keeping the live ones', async () => {
    const storage = memoryStorage()
    storage.setItem(STORAGE_KEY, JSON.stringify({ ptys: { '/a': 7, '/b': 8, '/c': 9 } }))
    const { s, core } = setup({
      storage,
      held: [
        { id: 7, cwd: '/a', pid: 1, alive: true },
        { id: 8, cwd: '/b', pid: 2, alive: false },
      ],
    })
    await s().prune()
    expect(core.killed).toEqual([8])
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!).ptys).toEqual({ '/a': 7 })
    expect(s().held()).toEqual([7])
  })

  it('shows why a shell could not start, and tries again', async () => {
    const { s, store } = setup({ failSpawn: true })
    s().show()
    await flush()
    expect(s().shells[''].error).toContain('no shell')
    const before = store.getState().shells['']
    s().show()
    expect(store.getState().shells['']).not.toBe(before)
    await flush()
    expect(s().shells[''].error).toContain('no shell')
  })

  it('hides the floating shells from the workspace restore, which would adopt them as tabs', async () => {
    const { s, core } = setup({ held: [{ id: 3, cwd: '/x', pid: 1, alive: true }] })
    s().show()
    await flush()
    const all: PtyInfo[] = [
      { id: 3, cwd: '/x', pid: 1, alive: true },
      { id: 10, cwd: '/y', pid: 2, alive: true },
    ]
    const hidden = hideFrom({ list: async () => all, attach: core.sessions.attach }, () => s().held())
    expect((await hidden.list()).map((i) => i.id)).toEqual([3])
  })
})

describe('where the floating panel sits', () => {
  it('opens bottom-right, and remembers where it was dragged by its corner', () => {
    const { s, storage, viewport } = setup()
    expect(s().bounds).toEqual({ left: 496, top: 256, width: 920, height: 560 })
    s().preview({ left: 20, top: 60, width: 600, height: 400 })
    expect(s().bounds).toEqual({ left: 20, top: 60, width: 600, height: 400 })
    expect(JSON.parse(storage.getItem(STORAGE_KEY) ?? '{}').bounds).toBeUndefined() // a preview is not remembered
    s().commit()
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!).bounds).toEqual({ anchorX: 'left', anchorY: 'top', offsetX: 20, offsetY: 60, width: 600, height: 400 })
    // The next page puts it back.
    const again = setup({ storage })
    expect(again.s().bounds).toEqual({ left: 20, top: 60, width: 600, height: 400 })
    // A preview off screen is clamped onto it.
    s().preview({ left: -500, top: -500, width: 600, height: 400 })
    expect(s().bounds).toEqual({ left: 8, top: 36, width: 600, height: 400 })
    void viewport
  })

  it('keeps its corner when the window resizes', () => {
    const { s, viewport } = setup()
    s().preview({ left: 800, top: 400, width: 600, height: 400 })
    s().commit()
    viewport.width = 1920
    viewport.height = 1080
    s().reconcile()
    expect(s().bounds).toEqual({ left: 1920 - 600 - 40, top: 1080 - 400 - 100, width: 600, height: 400 })
  })

  it('maximizes and restores, remembering which across a reload', () => {
    const { s, storage } = setup()
    s().preview({ left: 20, top: 60, width: 600, height: 400 })
    s().commit()
    s().toggleMaximized()
    expect(s().maximized).toBe(true)
    expect(s().bounds).toEqual({ left: 12, top: 36, width: 1416, height: 828 })
    // Maximized, it neither drags nor forgets where it was.
    s().preview({ left: 300, top: 300, width: 500, height: 300 })
    expect(s().bounds.left).toBe(12)
    const again = setup({ storage })
    expect(again.s().maximized).toBe(true)
    expect(again.s().bounds.left).toBe(12)
    s().toggleMaximized()
    expect(s().bounds).toEqual({ left: 20, top: 60, width: 600, height: 400 })
    expect(setup({ storage }).s().maximized).toBe(false)
  })

  it('reads nothing from unreadable storage', () => {
    const storage = memoryStorage()
    storage.setItem(STORAGE_KEY, '{nope')
    const { s } = setup({ storage })
    expect(s().maximized).toBe(false)
    expect(s().bounds.width).toBe(920)
  })
})

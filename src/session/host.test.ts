import type { PaneId, PtyClient } from '../pty/client'
import { DETACH_KEY } from '../cockpit/prompt'
import { createSessionHost, endLeftovers, sessionKey, STORAGE_KEY } from './host'

/** A pty client that records what is done to which PTY, in order. `hold` keeps every spawn from
 *  then on waiting until `release` lets them go. */
function fakePty(opts: { spawnFails?: boolean } = {}) {
  let next = 50
  const log: string[] = []
  const exits: Record<PaneId, (code: number | null) => void> = {}
  const outputs: Record<PaneId, (b: Uint8Array) => void> = {}
  let gate: Promise<void> | null = null
  let open: (() => void) | null = null
  const pty: PtyClient = {
    async spawn({ onOutput }) {
      if (gate) await gate
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
      return () => void log.push(`unlisten ${id}`)
    },
  }
  return {
    pty,
    log,
    exits,
    outputs,
    hold: () => (gate = new Promise((r) => (open = r))),
    release: () => open?.(),
  }
}

function make(p: PtyClient, storage: Storage | null = null) {
  const fed: Record<PaneId, string> = {}
  const forgotten: PaneId[] = []
  const host = createSessionHost({
    pty: p,
    shell: () => 'posix',
    feed: (id, b) => void (fed[id] = (fed[id] ?? '') + new TextDecoder().decode(b)),
    forget: (id) => void forgotten.push(id),
    storage,
  })
  return { host, s: () => host.getState(), fed, forgotten }
}

const work = { id: 'b0b0b0b0', account_env: { config_dir: '/Users/me/.claude-work' } }
const attach = (id: PaneId, child: string) => `write ${id} ${JSON.stringify(`exec claude attach ${child}\r`)}`
const settle = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => localStorage.clear())

test('a child is held as `claude attach` on its own account, in a PTY of its own', async () => {
  const f = fakePty()
  const { s } = make(f.pty)
  expect(s().hold({ child: work }, 'popout')).toBe('child:b0b0b0b0')
  expect(s().sessions['child:b0b0b0b0']).toEqual({ key: 'child:b0b0b0b0', kind: 'attach', pty: null, by: ['popout'] })
  await settle()
  expect(s().sessions['child:b0b0b0b0'].pty).toBe(50)
  expect(f.log).toEqual(['spawn 50', `write 50 ${JSON.stringify('exec env CLAUDE_CONFIG_DIR=/Users/me/.claude-work claude attach b0b0b0b0\r')}`])
})

test('a pane\'s session starts nothing and its let-go ends nothing', async () => {
  const f = fakePty()
  const { s } = make(f.pty)
  expect(s().hold({ pane: 7 }, 'popout')).toBe('pane:7')
  expect(s().sessions['pane:7']).toMatchObject({ kind: 'pane', pty: 7 })
  await s().release('pane:7', 'popout')
  expect(f.log).toEqual([])
  expect(s().sessions).toEqual({})
})

test('two presentations share one attach; only the last let-go detaches it, and never stops the child', async () => {
  const f = fakePty()
  const { s, forgotten } = make(f.pty)
  const key = s().hold({ child: 'c2c2c2c2' }, 'popout')
  expect(s().hold({ child: 'c2c2c2c2' }, 'drawer')).toBe(key)
  await settle()
  expect(f.log.filter((l) => l.startsWith('spawn'))).toEqual(['spawn 50'])
  await s().release(key, 'popout')
  expect(f.log).toEqual(['spawn 50', attach(50, 'c2c2c2c2')])
  expect(s().sessions[key].by).toEqual(['drawer'])
  await s().release(key, 'drawer')
  expect(f.log.slice(2)).toEqual([`write 50 ${JSON.stringify(DETACH_KEY)}`, 'unlisten 50', 'kill 50'])
  expect(f.log.join('\n')).not.toMatch(/claude stop/)
  expect(forgotten).toEqual([50])
  expect(s().held()).toEqual([])
})

test('an attach let go of while its PTY starts is detached as soon as it has one', async () => {
  const f = fakePty()
  f.hold()
  const { s } = make(f.pty)
  const key = s().hold({ child: 'c2c2c2c2' }, 'popout')
  await s().release(key, 'popout')
  f.release()
  await settle()
  expect(f.log).toEqual(['spawn 50', `write 50 ${JSON.stringify(DETACH_KEY)}`, 'unlisten 50', 'kill 50'])
  expect(s().sessions).toEqual({})
  expect(s().held()).toEqual([])
})

test('closed while it starts and opened again, the first attach is detached and the second is the one shown', async () => {
  const f = fakePty()
  f.hold()
  const { s } = make(f.pty)
  const key = s().hold({ child: 'c2c2c2c2' }, 'popout')
  await s().release(key, 'popout')
  s().hold({ child: 'c2c2c2c2' }, 'popout')
  f.release()
  await settle()
  await settle()
  // One attach typed, into the PTY shown; the other detached and ended.
  expect(f.log.filter((l) => l.includes('claude attach'))).toEqual([attach(51, 'c2c2c2c2')])
  expect(f.log).toContain('kill 50')
  expect(f.log).not.toContain('kill 51')
  expect(s().sessions[key].pty).toBe(51)
  expect(s().held()).toEqual([51])
})

test('an attach that ends by itself takes its session with it, and its exit listener', async () => {
  const f = fakePty()
  const { s, forgotten } = make(f.pty)
  s().hold({ child: 'c2c2c2c2' }, 'popout')
  await settle()
  f.exits[50](0)
  await settle()
  expect(s().sessions).toEqual({})
  expect(s().held()).toEqual([])
  expect(forgotten).toEqual([50])
  expect(f.log).toContain('unlisten 50')
})

test('an attach\'s output goes to its views, also what it printed before its id was known', async () => {
  const f = fakePty()
  const p: PtyClient = {
    ...f.pty,
    spawn: async (o) => {
      o.onOutput(new TextEncoder().encode('early '))
      return f.pty.spawn(o)
    },
  }
  const { s, fed } = make(p)
  s().hold({ child: 'c2c2c2c2' }, 'popout')
  await settle()
  f.outputs[50](new TextEncoder().encode('late'))
  expect(fed[50]).toBe('early late')
})

test('a pane closed takes its session from every holder', () => {
  const { s } = make(fakePty().pty)
  s().hold({ pane: 7 }, 'popout')
  s().hold({ pane: 7 }, 'drawer')
  s().paneGone(7)
  expect(s().sessions).toEqual({})
})

test('a spawn that fails says so in the session', async () => {
  const { s } = make(fakePty({ spawnFails: true }).pty)
  s().hold({ child: 'c2c2c2c2' }, 'popout')
  await settle()
  expect(s().sessions['child:c2c2c2c2']).toMatchObject({ pty: null, error: 'Error: no pty' })
})

test('the attaches a reloaded page left are detached at the next load, and only those; one list for every presentation', async () => {
  const f = fakePty()
  const { s } = make(f.pty, localStorage)
  s().hold({ child: 'c2c2c2c2' }, 'popout')
  s().hold({ child: 'd3d3d3d3' }, 'drawer')
  await settle()
  expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual([50, 51])

  const after = fakePty()
  expect(endLeftovers({ pty: after.pty, storage: localStorage })).toEqual([50, 51])
  await settle()
  expect(after.log).toEqual([`write 50 ${JSON.stringify(DETACH_KEY)}`, `write 51 ${JSON.stringify(DETACH_KEY)}`, 'kill 50', 'kill 51'])
  expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
})

test('a session\'s key names it, whoever holds it', () => {
  expect(sessionKey({ pane: 3 })).toBe('pane:3')
  expect(sessionKey({ child: work })).toBe('child:b0b0b0b0')
  expect(sessionKey({ child: 'c2c2c2c2' })).toBe('child:c2c2c2c2')
})

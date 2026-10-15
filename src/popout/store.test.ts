import type { PaneId, PtyClient } from '../pty/client'
import { DETACH_KEY } from '../cockpit/prompt'
import { createSessionHost } from '../session/host'
import { BY, createPopoutStore } from './store'

/** A pty client that records what is done to which PTY, in order. */
function fakePty() {
  let next = 50
  const log: string[] = []
  const exits: Record<PaneId, (code: number | null) => void> = {}
  const pty: PtyClient = {
    async spawn() {
      const id = next++
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
  return { pty, log, exits }
}

function make() {
  const f = fakePty()
  const host = createSessionHost({ pty: f.pty, shell: () => 'posix', feed: () => {}, forget: () => {}, storage: null })
  const store = createPopoutStore({ host, viewport: () => ({ width: 1440, height: 900 }) })
  return { ...f, host, store, s: () => store.getState() }
}

const settle = () => new Promise((r) => setTimeout(r, 0))

test('a popup holds its session in the host under its own name, and lets go of it when closed', async () => {
  const { s, host, log } = make()
  s().openPane(7, 'a pane')
  s().openChild('c2c2c2c2', 'child')
  await settle()
  expect(s().popups.map((p) => [p.key, p.title])).toEqual([
    ['pane:7', 'a pane'],
    ['child:c2c2c2c2', 'child'],
  ])
  expect(host.getState().sessions['child:c2c2c2c2']).toMatchObject({ pty: 50, by: [BY] })
  log.length = 0
  await s().close('child:c2c2c2c2')
  expect(log).toEqual([`write 50 ${JSON.stringify(DETACH_KEY)}`, 'kill 50'])
  await s().close('pane:7')
  expect(log).toHaveLength(2)
  expect(s().popups).toEqual([])
  expect(host.getState().sessions).toEqual({})
})

test('a session another presentation still holds outlives its popup', async () => {
  const { s, host, log } = make()
  s().openChild('c2c2c2c2', 'child')
  host.getState().hold({ child: 'c2c2c2c2' }, 'drawer')
  await settle()
  await s().close('child:c2c2c2c2')
  expect(log.filter((l) => l.startsWith('kill'))).toEqual([])
  expect(host.getState().sessions['child:c2c2c2c2'].by).toEqual(['drawer'])
})

test('a session the host no longer has takes its popup: an attach that ended, a pane closed', async () => {
  const { s, host, exits } = make()
  s().openPane(7, 'seven')
  s().openChild('c2c2c2c2', 'child')
  await settle()
  exits[50](0)
  await settle()
  expect(s().popups.map((p) => p.key)).toEqual(['pane:7'])
  host.getState().paneGone(7)
  expect(s().popups).toEqual([])
})

test('several popups at once; one asked again is raised, not opened twice', async () => {
  const { s, log } = make()
  s().openPane(7, 'seven')
  s().openPane(8, 'eight')
  s().openChild('c2c2c2c2', 'child')
  s().openChild('d3d3d3d3', 'other child')
  await settle()
  s().openPane(7, 'seven')
  s().openChild('c2c2c2c2', 'child')
  expect(s().popups.map((p) => p.key)).toEqual(['pane:8', 'child:d3d3d3d3', 'pane:7', 'child:c2c2c2c2'])
  expect(log.filter((l) => l.startsWith('spawn'))).toHaveLength(2)
  // Each opens down and to the left of the one before, so none hides another.
  const lefts = s().popups.map((p) => p.bounds.left)
  expect(new Set(lefts).size).toBe(4)
})

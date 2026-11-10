// The five system panels as the host has them: each registered from its own folder, in the
// order the host lists panels, opened by the route and closed by Esc.

const t = vi.hoisted(() => ({ fleet: { repos: [{ root: '/Users/you/work/lumen-web', name: 'lumen-web', worktrees: [] }] } }))

// A core that answers nothing: every panel must still open, and say what it could not read.
vi.mock('@tauri-apps/api/core', () => ({ Channel: class {}, invoke: async () => null }))
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }))
vi.mock('../../fleet/store', () => ({ useFleet: <T,>(sel: (f: typeof t.fleet) => T): T => sel(t.fleet) }))

import { go, routeStore, type PanelId } from '../../world/route'
import { Panels, panels } from '../index'
import { draw, flush, key } from './testing'

const MINE: PanelId[] = ['memory', 'learned', 'accounts', 'setup', 'settings']
const mine = () => panels().filter((p) => MINE.includes(p.id))

beforeAll(async () => {
  await vi.waitFor(() => expect(mine()).toHaveLength(MINE.length))
})
afterEach(() => go({ panel: null }))

test('the host lists the five, in its own order, each with a title and a line on what it is for', () => {
  expect(mine().map((p) => p.id)).toEqual(MINE)
  expect(mine().map((p) => p.title)).toEqual(['Memory', 'Learned', 'Accounts', 'Setup', 'Settings'])
  for (const p of mine()) expect(p.hint).toBeTruthy()
})

test('Memory is the wide one; the others take the side', () => {
  expect(mine().map((p) => p.size ?? 'side')).toEqual(['wide', 'side', 'side', 'side', 'side'])
})

test.each(MINE)('the route opens %s, it draws with no core to answer it, and Esc closes it', async (id) => {
  go({ panel: id })
  const undraw = await draw(<Panels />)
  await flush()
  const sheet = document.querySelector(`[data-panel="${id}"]`)!
  expect(sheet).not.toBeNull()
  expect(sheet.querySelector(`[data-${id}-panel]`)).not.toBeNull()
  await key('Escape')
  expect(routeStore.getState().route.panel).toBeNull()
  expect(document.querySelector('[data-panel]')).toBeNull()
  await undraw()
})

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { PtyInfo } from '../terminal/sessions'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// The live layout store, the mission snapshot, the pty client and the terminal pane reach Tauri
// and xterm: stand-ins.
const { log, held } = vi.hoisted(() => ({ log: [] as string[], held: [] as PtyInfo[] }))
vi.mock('../pty/client', () => ({
  tauriPty: {
    spawn: async () => (log.push('spawn 60'), 60),
    write: async (id: number, d: string) => void log.push(`write ${id} ${JSON.stringify(d)}`),
    resize: async () => {},
    kill: async (id: number) => void log.push(`kill ${id}`),
    onExit: async () => () => {},
  },
}))
vi.mock('../pty/typed', async (orig) => ({ ...(await orig<object>()), paneShell: () => 'posix' }))
vi.mock('../layout/app-store', async () => {
  const { createStore } = await import('zustand')
  const store = createStore(() => ({
    panes: {
      3: { id: 3, view: 'terminal', cwd: '/code/app', title: 'claude' },
      4: { id: 4, view: 'terminal', cwd: '/code/site', sessionId: 'sess-in-pane' },
      5: { id: 5, view: 'terminal', exitCode: 0 },
      6: { id: 6, view: 'editor' },
    } as Record<number, unknown>,
    sinks: {} as Record<number, unknown>,
  }))
  return { store }
})
vi.mock('../mission/app-store', async () => {
  const { createStore } = await import('zustand')
  const child = (id: string, live: boolean, session_id: string | null = null) => ({ id, live, session_id, name: `child ${id}`, state: 'working', tempo: 'active' })
  const snapshot = { parents: [{ session_id: 'p', children: [child('c1', true), child('c2', false), child('c3', true, 'sess-in-pane')] }] }
  return { missionStore: createStore(() => ({ snapshot })) }
})
vi.mock('../mission/types', async (orig) => ({
  ...(await orig<object>()),
  allChildren: (snap: { parents: { children: unknown[] }[] }) => snap.parents.flatMap((p) => p.children),
}))
vi.mock('../terminal/view', async () => {
  const { provideSessions } = await import('../terminal/sessions')
  provideSessions({ list: async () => [...held], attach: async () => new Uint8Array() })
  return { default: ({ id, props }: { id: number; props: Record<string, unknown> }) => <div data-stub-terminal={id} data-over={String(props.over === true)} /> }
})

import { all, run } from '../actions/registry'
import { slotEntries } from '../shell/slots'
import { providedSessions } from '../terminal/sessions'
import { store as layout } from '../layout/app-store'
import { DETACH_KEY } from '../cockpit/prompt'

let popouts: typeof import('./view').popouts
beforeAll(async () => {
  localStorage.setItem('mnemo.popout.v1', '[44]')
  await act(async () => {
    popouts = (await import('./view')).popouts
  })
}, 60_000)

const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))))

it('offers ⌘K entries for each live terminal pane and each live child in no pane', () => {
  const titles = all().filter((a) => a.id.startsWith('popout.')).map((a) => [a.id, a.title])
  expect(titles).toEqual([
    ['popout.pane.3', 'Pop out: claude'],
    ['popout.pane.4', 'Pop out: site'],
    ['popout.child.c1', 'Pop out child: child c1 (active)'],
  ])
})

it('ends the attach a reloaded page left, and keeps every attach out of what the workspace restore adopts', async () => {
  expect(log).toEqual([`write 44 ${JSON.stringify(DETACH_KEY)}`, 'kill 44'])
  log.length = 0
  await act(async () => run('popout.child.c1'))
  await flush()
  held.push({ id: 7, cwd: '/x', pid: 1, alive: true }, { id: 44, cwd: '/x', pid: 2, alive: true }, { id: 60, cwd: '/x', pid: 3, alive: true })
  expect((await providedSessions()!.list()).map((i) => i.id)).toEqual([7])
  await act(async () => popouts.getState().close('child:c1'))
  expect(log.slice(-2)).toEqual([`write 60 ${JSON.stringify(DETACH_KEY)}`, 'kill 60'])
})

it('draws each popup over the app, a pane over its pane and an attach alone; closed by its button', async () => {
  expect(slotEntries('overlay')).toHaveLength(1)
  const Overlay = slotEntries('overlay')[0].component
  const host = document.body.appendChild(document.createElement('div'))
  await act(async () => createRoot(host).render(<Overlay />))
  await act(async () => run('popout.pane.3'))
  await act(async () => run('popout.child.c1'))
  await flush()
  const views = [...host.querySelectorAll<HTMLElement>('[data-stub-terminal]')].map((e) => [e.dataset.stubTerminal, e.dataset.over])
  expect(views).toEqual([
    ['3', 'true'],
    ['60', 'false'],
  ])
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Close popup of claude"]')!.click())
  expect(popouts.getState().popups.map((p) => p.key)).toEqual(['child:c1'])
  expect(log.filter((l) => l.startsWith('kill 3'))).toEqual([])
  // A pane closed under its popup takes the popup with it.
  await act(async () => run('popout.pane.4'))
  await act(async () => layout.setState({ panes: {} }))
  expect(popouts.getState().popups.map((p) => p.key)).toEqual(['child:c1'])
})

import { act } from 'react'
import type { PtyInfo } from '../terminal/sessions'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// The live layout store, the pty client and the terminal pane reach Tauri and xterm: stand-ins.
const spawned: (string | undefined)[] = []
vi.mock('../pty/client', () => ({
  tauriPty: {
    async spawn({ cwd }: { cwd?: string }) {
      spawned.push(cwd)
      return 40 + spawned.length
    },
    write: async () => {},
    resize: async () => {},
    kill: async () => {},
    onExit: async () => () => {},
  },
}))
vi.mock('../layout/app-store', async () => {
  const { createStore } = await import('zustand')
  const store = createStore(() => ({ activeWorktree: '/code/app' as string | null, activeTab: 't1', sinks: {} as Record<number, unknown> }))
  return { store }
})
vi.mock('../layout/cwd', () => ({ cwdForNewShell: () => '/home/selected' }))
// The terminal view offers the core's terminals as it loads: the core here holds one.
const held: PtyInfo[] = [{ id: 5, cwd: '/code/app', pid: 1, alive: true }]
vi.mock('../terminal/view', async () => {
  const { provideSessions } = await import('../terminal/sessions')
  provideSessions({ list: async () => [...held], attach: async () => new Uint8Array() })
  return { default: ({ id }: { id: number }) => <div data-stub-terminal={id} /> }
})

import { all, run } from '../actions/registry'
import { slotEntries } from '../shell/slots'
import { providedSessions } from '../terminal/sessions'
import { store as layout } from '../layout/app-store'

let floating: typeof import('./view').floating
beforeAll(async () => {
  await act(async () => {
    floating = (await import('./view')).floating
  })
}, 60_000)

const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))))

it('registers floating-terminal.toggle, and mounts the panel and its titlebar button', async () => {
  expect(all().filter((a) => a.id === 'floating-terminal.toggle')).toHaveLength(1)
  expect(slotEntries('overlay')).toHaveLength(1)
  expect(slotEntries('titlebar-right')).toHaveLength(1)
  await act(async () => run('floating-terminal.toggle'))
  await flush()
  expect(floating.getState().open).toBe(true)
  expect(spawned).toEqual(['/code/app'])
  await act(async () => run('floating-terminal.toggle'))
  expect(floating.getState().open).toBe(false)
})

it('keeps the floating shells out of what the workspace restore adopts', async () => {
  held.push({ id: 41, cwd: '/code/app', pid: 2, alive: true })
  expect((await providedSessions()!.list()).map((i) => i.id)).toEqual([5])
})

it('follows the active worktree; with none, where a new shell would start', async () => {
  await act(async () => layout.setState({ activeWorktree: '/code/site' }))
  expect(floating.getState().where).toEqual({ key: '/code/site', cwd: '/code/site' })
  await act(async () => layout.setState({ activeWorktree: null, activeTab: '' }))
  expect(floating.getState().where).toEqual({ key: '', cwd: '/home/selected' })
})

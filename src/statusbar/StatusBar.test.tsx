import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { vi } from 'vitest'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const fleet = { repos: [{ root: '/a', name: 'a', worktrees: [{ path: '/a', name: 'a', branch: null, kind: 'main', pr: null, unread: false, agents: [{ state: 'working' }, { state: 'needs-you' }] }] }] }
vi.mock('../fleet/store', () => ({ useFleet: (sel: (f: unknown) => unknown) => sel(fleet) }))
vi.mock('../layout/app-store', () => ({ useApp: (sel: (s: unknown) => unknown) => sel({ tabs: [{ id: 't', root: { kind: 'leaf', pane: 1 }, focused: 1 }], activeTab: 't', panes: { 1: { id: 1, view: 'terminal', sessionId: 's1', cwd: '/a' } } }) }))
vi.mock('../mission/app-store', () => ({
  useMission: (sel: (s: unknown) => unknown) => sel({ snapshot: { repos: [{ name: 'a', parents: [{ session_id: 's1', cwd: '/a', tokens: 210000, children_tokens: 640000 }], missions: [], children: [] }] } }),
}))
vi.mock('../pulse/app-store', () => ({ usePulse: (sel: (s: unknown) => unknown) => sel({ counts: { 1: 3 } }) }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import StatusBar from './StatusBar'

const client = { level: async () => ({ root: '/v', pages: 10, rules_fired: 4, fires: 20, fired_recent: 1, dormant: 0, label_only: 0, inbox: 0, error: null }), best: async (xp: number) => xp }

test('shows tokens, pulse count, agents by state and the vault level', async () => {
  const host = document.createElement('div')
  await act(async () => {
    createRoot(host).render(<StatusBar client={client} />)
  })
  const text = (id: string) => host.querySelector(`[data-testid="${id}"]`)?.textContent ?? ''
  expect(text('sb-tokens')).toBe('parent 210k · children 640k')
  expect(text('sb-pulse')).toContain('3')
  expect(text('sb-agents')).toContain('1 need you')
  expect(text('sb-agents')).toContain('1 working')
  expect(text('sb-level')).toBe('lv 0')
})

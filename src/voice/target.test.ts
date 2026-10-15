import { beforeEach, expect, it, vi } from 'vitest'

// The app's session host, as a plain store: the real one loads the terminal view.
vi.mock('../session/app-host', async () => {
  const { createStore } = await import('zustand/vanilla')
  return { sessionHost: createStore(() => ({ sessions: {} as Record<string, { key: string; kind: 'pane' | 'attach'; pty: number | null; by: string[] }> })) }
})

import { nexusStore } from '../nexus/store'
import { sessionHost } from '../session/app-host'
import { dictationTarget } from './target'

beforeEach(() => {
  document.body.innerHTML = ''
  nexusStore.setState({ open: true, tabs: [], activeTab: null, collapsed: false })
  sessionHost.setState({ sessions: {} })
})

it("reads the app's drawer and session host: the active tab's terminal, else nowhere", () => {
  expect(dictationTarget()).toBeNull()
  sessionHost.setState({ sessions: { 'child:r1': { key: 'child:r1', kind: 'attach', pty: 12, by: ['nexus-drawer'] } } })
  nexusStore.getState().putTab({ id: 'r1', kind: 'robot', key: 'child:r1', readOnly: null, label: 'r1', sessionId: 'r1', cwd: null })
  expect(dictationTarget()).toEqual({ kind: 'pty', pane: 12 })
  nexusStore.getState().setCollapsed(true)
  expect(dictationTarget()).toBeNull()
})

it("reads the page's focus: the bridge's prompt", () => {
  document.body.innerHTML = '<div data-fleet-prompt=""><input></div>'
  const prompt = document.querySelector('input')!
  prompt.focus()
  expect(dictationTarget()).toEqual({ kind: 'field', el: prompt })
})

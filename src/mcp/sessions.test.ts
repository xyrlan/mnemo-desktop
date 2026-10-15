import { describe, expect, it } from 'vitest'
import type { Pane } from '../layout/store'
import type { DrawerTab } from '../nexus/store'
import type { HostedSession } from '../session/host'
import { sessionsOf, type Sources } from './sessions'

const tab = (t: Partial<DrawerTab> & Pick<DrawerTab, 'id' | 'kind'>): DrawerTab => ({ key: null, readOnly: null, label: t.id, sessionId: null, cwd: null, ...t })
const hosted = (key: string, pty: number | null, error?: string): HostedSession => ({ key, kind: key.startsWith('pane:') ? 'pane' : 'attach', pty, by: ['nexus-drawer'], ...(error ? { error } : {}) })

function sources(over: Partial<Sources> = {}): Sources {
  const panes: Record<number, Pane> = {
    1: { id: 1, view: 'terminal', cwd: '/repo/now', title: 'claude', sessionId: 'sess-new', offscreen: true },
    2: { id: 2, view: 'terminal', cwd: '/repo', offscreen: true, exitCode: 1 },
    3: { id: 3, view: 'terminal', cwd: '/workbench' },
    7: { id: 7, view: 'terminal', cwd: '/repo/b', title: 'zsh', offscreen: true },
    [-1]: { id: -1, view: 'browser', offscreen: true },
  }
  return {
    tabs: [
      tab({ id: 'cap', kind: 'captain', key: 'pane:1', label: 'fix the build', sessionId: 'sess-old', cwd: '/repo' }),
      tab({ id: 'bot', kind: 'robot', key: 'child:5a', label: 'robot 5a', cwd: '/repo/.wt/5a', sessionId: '5a' }),
      tab({ id: 'starting', kind: 'robot', key: 'child:6b', label: 'robot 6b' }),
      tab({ id: 'read-only', kind: 'captain', readOnly: 'it runs outside the app', label: 'elsewhere' }),
      tab({ id: 'gone', kind: 'session', key: 'pane:9', label: 'shell' }),
    ],
    activeTab: 'cap',
    collapsed: false,
    open: true,
    hosted: { 'pane:1': hosted('pane:1', 1), 'child:5a': hosted('child:5a', 40), 'child:6b': hosted('child:6b', null) },
    panes,
    ...over,
  }
}

describe('sessionsOf', () => {
  it('lists the drawer tabs in order, then the offscreen terminals no tab shows', () => {
    expect(sessionsOf(sources())).toEqual([
      // What the pane says now wins over what the tab knew as it opened.
      { pane: 1, kind: 'captain', tab: 'cap', label: 'fix the build', title: 'claude', cwd: '/repo/now', sessionId: 'sess-new', shown: true },
      // A child's attach is no pane: what the tab knew.
      { pane: 40, kind: 'robot', tab: 'bot', label: 'robot 5a', cwd: '/repo/.wt/5a', sessionId: '5a', shown: false },
      { kind: 'robot', tab: 'starting', label: 'robot 6b', shown: false, note: 'its terminal is starting' },
      { kind: 'captain', tab: 'read-only', label: 'elsewhere', shown: false, note: 'it runs outside the app' },
      { kind: 'session', tab: 'gone', label: 'shell', shown: false, note: 'its session has ended' },
      { pane: 2, kind: 'pane', label: 'terminal', cwd: '/repo', shown: false, exitCode: 1 },
      { pane: 7, kind: 'pane', label: 'zsh', cwd: '/repo/b', shown: false },
    ])
  })

  it('a workbench pane is no session of the Nexus unless a tab shows it', () => {
    expect(sessionsOf(sources()).map((s) => s.pane)).not.toContain(3)
    const shown = sources({ tabs: [tab({ id: 'cap', kind: 'captain', key: 'pane:3' })], hosted: { 'pane:3': hosted('pane:3', 3) } })
    expect(sessionsOf(shown)[0]).toMatchObject({ pane: 3, cwd: '/workbench' })
  })

  it('says why an attach has no terminal', () => {
    const failed = sources({ hosted: { ...sources().hosted, 'child:6b': hosted('child:6b', null, 'claude attach failed') } })
    expect(sessionsOf(failed)[2].note).toBe('claude attach failed')
  })

  it('is shown only while the drawer shows its tab', () => {
    const shown = (over: Partial<Sources>) => sessionsOf(sources(over)).filter((s) => s.shown).map((s) => s.tab)
    expect(shown({})).toEqual(['cap'])
    expect(shown({ activeTab: 'bot' })).toEqual(['bot'])
    expect(shown({ collapsed: true })).toEqual([])
    expect(shown({ open: false })).toEqual([])
  })
})

// The Setup panel on the setup store. `tools_status` and the installs are answered here; a
// terminal is asked of the app's route, which a test sets.

import type { ToolStatus } from '../../setup/tools'

const t = vi.hoisted(() => ({
  calls: [] as string[],
  rows: [] as unknown[],
  latest: 'v1.12.0' as string | Error,
  install: null as null | { resolve(tag: string): void; reject(why: string): void },
  on: {} as Record<string, ((e: { payload: unknown }) => void)[]>,
}))

vi.mock('@tauri-apps/api/core', () => ({
  Channel: class {},
  invoke: async (cmd: string) => {
    t.calls.push(cmd)
    switch (cmd) {
      case 'tools_status':
        return t.rows
      case 'tools_mnemo_latest':
        if (t.latest instanceof Error) throw t.latest
        return t.latest
      case 'tools_install_mnemo':
        return new Promise<string>((resolve, reject) => (t.install = { resolve, reject }))
      case 'tools_add_to_path':
        return 'added 2 folders to your PATH; open a new terminal to see them'
    }
    return null
  },
}))
vi.mock('@tauri-apps/api/event', () => ({
  listen: async (name: string, h: (e: { payload: unknown }) => void) => {
    ;(t.on[name] ??= []).push(h)
    return () => (t.on[name] = t.on[name].filter((x) => x !== h))
  },
}))

import { act } from 'react'
import { setNexusRoutes, type NexusRoutes } from '../../nexus/outside'
import { setup } from '../../setup/app-store'
import { IDLE_RUN, NOT_ASKED } from '../../setup/store'
import { installRoute, currentOs } from '../../setup/tools'
import { go, routeStore } from '../../world/route'
import { button, click, draw, flush, texts } from '../memory/testing'
import { SetupPanel, shownTools, summary } from './Setup'

const tool = (name: ToolStatus['name'], found = true, more: Partial<ToolStatus> = {}): ToolStatus => ({ name, path: found ? `/opt/tools/bin/${name}` : null, version: found ? `${name} 1.0.0` : null, managed: false, ...more })
const ALL = [tool('git'), tool('claude'), tool('mnemo'), tool('gh')]

const term = { opened: [] as { command: string; label: string }[], refuse: null as string | null }
const routes: NexusRoutes = {
  terminal: async (_cwd, command, label) => {
    if (term.refuse) throw new Error(term.refuse)
    term.opened.push({ command, label })
  },
  page: async () => {},
  pages: () => {},
}

let undraw: (() => Promise<void>) | null = null
let unroute: () => void
const open = async (rows: ToolStatus[]) => {
  t.rows = rows
  undraw = await draw(<SetupPanel />)
  await flush()
}
const state = (name: string) => document.querySelector(`[data-tool="${name}"]`)!.getAttribute('data-state')

beforeEach(() => {
  t.calls.length = 0
  t.latest = 'v1.12.0'
  t.install = null
  t.on = {}
  term.opened = []
  term.refuse = null
  setup.setState({ rows: null, checking: false, statusError: null, mnemo: IDLE_RUN, path: IDLE_RUN, latest: NOT_ASKED })
  unroute = setNexusRoutes(routes)
  go({ panel: 'setup' })
})
afterEach(async () => {
  await undraw?.()
  undraw = null
  unroute()
  go({ panel: null })
})

describe('what the panel says first', () => {
  test('names what is missing that the app needs', () => {
    expect(summary([tool('git'), tool('claude', false), tool('mnemo', false), tool('gh', false)])).toEqual({ missing: ['claude', 'mnemo'], text: 'claude and mnemo are missing, and the app needs them. One press each installs them.' })
    expect(summary([tool('git'), tool('claude'), tool('mnemo', false), tool('gh')]).text).toBe('mnemo is missing, and the app needs it. One press each installs it.')
  })

  test('with everything found, says so', () => {
    expect(summary(ALL)).toEqual({ missing: [], text: 'Everything is in place.' })
  })

  test('with only an optional tool missing, says what the app needs is in place', () => {
    expect(summary([tool('git'), tool('claude'), tool('mnemo'), tool('gh', false)]).text).toBe('claude and mnemo are in place: all the app needs.')
  })

  test('a Grok account makes grok needed, as its row says', () => {
    expect(summary([tool('git'), tool('claude'), tool('grok', false, { needed: true }), tool('mnemo'), tool('gh')]).missing).toEqual(['grok'])
  })
})

test('grok is listed once the status has a row for it, in the order the app lists its tools', () => {
  expect(shownTools(ALL)).toEqual(['git', 'claude', 'mnemo', 'gh'])
  expect(shownTools([...ALL, tool('grok', false)])).toEqual(['git', 'claude', 'grok', 'mnemo', 'gh'])
})

test('opened, it checks the tools and says each one’s state as a word', async () => {
  await open([tool('git'), tool('claude', false), tool('mnemo'), tool('gh', false)])
  expect(t.calls.filter((c) => c === 'tools_status')).toHaveLength(1)
  expect([state('git'), state('claude'), state('mnemo'), state('gh')]).toEqual(['found', 'needed', 'found', 'missing'])
  expect(texts('.setup-tool .setup-state')).toEqual(['found', 'missing · needed', 'found', 'missing · optional'])
})

test('a missing tool installs in a terminal, one press, and the panel gives way to it', async () => {
  await open([tool('git', false), tool('claude'), tool('mnemo'), tool('gh')])
  await click(button('Install git'))
  expect(term.opened).toEqual([{ command: installRoute('git', currentOs()).command, label: 'Install git' }])
  expect(routeStore.getState().route.panel).toBeNull()
})

test('a terminal that would not open is said, and the panel stays', async () => {
  await open([tool('git'), tool('claude', false), tool('mnemo'), tool('gh')])
  term.refuse = 'no terminal host yet'
  await click(button('Install Claude Code'))
  expect(document.querySelector('[role=alert]')!.textContent).toBe('▲Could not open a terminal: no terminal host yet×')
  expect(routeStore.getState().route.panel).toBe('setup')
})

test('mnemo installs inside the app: its lines show as they come, then the tools are checked again', async () => {
  await open([tool('git'), tool('claude'), tool('mnemo', false), tool('gh')])
  await click(button('Install mnemo'))
  expect(button('Installing…')!.disabled).toBe(true)
  await act(async () => t.on['tools-install'].forEach((h) => h({ payload: { tool: 'mnemo', message: 'downloading mnemo v1.12.0…' } })))
  await act(async () => t.on['tools-install'].forEach((h) => h({ payload: { tool: 'gh', message: 'not this one' } })))
  expect(document.querySelector('[data-tool="mnemo"] .sp-out')!.textContent).toBe('downloading mnemo v1.12.0…')
  t.rows = ALL
  await act(async () => t.install!.resolve('v1.12.0'))
  await flush()
  expect(document.querySelector('.setup-run')!.textContent).toContain('mnemo v1.12.0 installed')
  expect(state('mnemo')).toBe('found')
  expect(t.calls.filter((c) => c === 'tools_status')).toHaveLength(2)
})

test('an install that failed says what failed', async () => {
  await open([tool('git'), tool('claude'), tool('mnemo', false), tool('gh')])
  await click(button('Install mnemo'))
  await act(async () => t.install!.reject('the checksum did not match'))
  await flush()
  const run = document.querySelector('.setup-run')!
  expect(run.getAttribute('data-tone')).toBe('bad')
  expect(run.textContent).toContain('installing mnemo failed')
  expect(run.textContent).toContain('the checksum did not match')
})

describe('the mnemo the app installed', () => {
  const managed = (version: string) => [tool('git'), tool('claude'), tool('mnemo', true, { managed: true, version }), tool('gh')]

  test('is offered the newer release, and only a newer one', async () => {
    await open(managed('mnemo 1.11.2'))
    expect(button('Update to v1.12.0')).toBeDefined()
    await undraw!()
    setup.setState({ latest: NOT_ASKED })
    await open(managed('mnemo 1.12.0'))
    expect(button(/^Update to/)).toBeUndefined()
    expect(document.querySelector('[data-tool="mnemo"]')!.textContent).toContain('the latest release')
  })

  test('a mnemo found on PATH is not the app’s to update: GitHub is not asked', async () => {
    await open(ALL)
    expect(t.calls).not.toContain('tools_mnemo_latest')
    expect(button(/^Update to/)).toBeUndefined()
  })

  test('Check again asks the tools and the release once more', async () => {
    await open(managed('mnemo 1.11.2'))
    t.calls.length = 0
    await click(button('Check again'))
    expect(t.calls).toEqual(['tools_status', 'tools_mnemo_latest'])
  })
})

test('Add to PATH says what changed', async () => {
  await open(ALL)
  await click(button('Add to PATH'))
  expect(document.querySelector('.setup-ok')!.textContent).toContain('added 2 folders to your PATH')
})

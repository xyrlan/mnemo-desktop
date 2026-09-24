import { describe, expect, it, vi } from 'vitest'
import { leaf, type Node } from '../layout/tree'
import type { Pane, Tab } from '../layout/store'
import { callTool, listPanes, MAX_LINES, type BrowserBridge, type ToolDeps } from './tools'

const split = (a: Node, b: Node): Node => ({ kind: 'split', dir: 'row', ratio: 0.5, children: [a, b] })

function deps(over: Partial<ToolDeps> = {}): ToolDeps {
  const tabs: Tab[] = [
    { id: 'tab-1', root: split(leaf(1), leaf(-1)), focused: -1 },
    { id: 'tab-2', root: leaf(2), focused: 2 },
  ]
  const panes: Record<number, Pane> = {
    1: { id: 1, view: 'terminal', cwd: '/repo', title: 'zsh', sessionId: 'abc' },
    [-1]: { id: -1, view: 'browser', props: { url: 'https://start.test/' }, title: 'Start' },
    2: { id: 2, view: 'terminal', exitCode: 0 },
  }
  const bridge: BrowserBridge = {
    url: (id) => (id === -1 ? 'https://now.test/' : undefined),
    read: vi.fn(async (id) => `page ${id}`),
    snapshot: vi.fn(async () => ({ mime: 'image/png', data: 'iVBOR' })),
  }
  return {
    state: () => ({ tabs, activeTab: 'tab-2', panes }),
    readBuffer: (id) => (id === 1 ? ['$ ls', 'a', 'b', ''] : undefined),
    browser: () => bridge,
    ...over,
  }
}

const textOf = (c: Awaited<ReturnType<typeof callTool>>) => (c[0].type === 'text' ? c[0].text : '')

describe('desktop_list_panes', () => {
  it('lists every pane in tab order with where it is and what it shows', () => {
    expect(listPanes(deps())).toEqual([
      { pane: 1, view: 'terminal', title: 'zsh', cwd: '/repo', tab: 1, activeTab: false, focused: false, sessionId: 'abc' },
      { pane: -1, view: 'browser', title: 'Start', url: 'https://now.test/', tab: 1, activeTab: false, focused: true },
      { pane: 2, view: 'terminal', tab: 2, activeTab: true, focused: true, exitCode: 0 },
    ])
  })

  it('falls back to the url the pane opened on', () => {
    const d = deps({ browser: () => undefined })
    expect(listPanes(d)[1].url).toBe('https://start.test/')
  })

  it('answers as JSON text', async () => {
    expect(JSON.parse(textOf(await callTool(deps(), 'desktop_list_panes')))).toHaveLength(3)
  })
})

describe('desktop_terminal_read', () => {
  it('returns the last lines of the buffer', async () => {
    expect(textOf(await callTool(deps(), 'desktop_terminal_read', { pane: 1, lines: 2 }))).toBe('a\nb')
    expect(textOf(await callTool(deps(), 'desktop_terminal_read', { pane: '1' }))).toBe('$ ls\na\nb')
  })

  it('clamps lines and rejects nonsense', async () => {
    const readBuffer = vi.fn(() => Array.from({ length: MAX_LINES + 10 }, (_, i) => `l${i}`))
    const out = textOf(await callTool(deps({ readBuffer }), 'desktop_terminal_read', { pane: 1, lines: 1e9 }))
    expect(out.split('\n')).toHaveLength(MAX_LINES)
    await expect(callTool(deps(), 'desktop_terminal_read', { pane: 1, lines: 'many' })).rejects.toThrow(/lines/)
    await expect(callTool(deps(), 'desktop_terminal_read', {})).rejects.toThrow(/pane/)
  })

  it('names the right tool when pointed at a browser pane, and unknown panes', async () => {
    await expect(callTool(deps(), 'desktop_terminal_read', { pane: -1 })).rejects.toThrow(/browser pane.*desktop_browser_read/)
    await expect(callTool(deps(), 'desktop_terminal_read', { pane: 99 })).rejects.toThrow(/no pane 99/)
  })

  it('says so when the terminal view is not mounted', async () => {
    await expect(callTool(deps(), 'desktop_terminal_read', { pane: 2 })).rejects.toThrow(/not on screen/)
  })
})

describe('browser tools', () => {
  it('reads the page through the bridge', async () => {
    expect(textOf(await callTool(deps(), 'desktop_browser_read', { pane: -1 }))).toBe('page -1')
  })

  it('snapshots browser panes as image content, and only those', async () => {
    expect(await callTool(deps(), 'desktop_pane_snapshot', { pane: -1 })).toEqual([
      { type: 'image', data: 'iVBOR', mimeType: 'image/png' },
    ])
    await expect(callTool(deps(), 'desktop_pane_snapshot', { pane: 1 })).rejects.toThrow(/terminal pane.*desktop_terminal_read/)
  })

  it('rejects unknown tools', async () => {
    await expect(callTool(deps(), 'desktop_rm_rf', {})).rejects.toThrow(/unknown tool/)
  })
})

describe('desktop_app_drive', () => {
  it('answers the drive result as JSON text', async () => {
    const drive = vi.fn(async () => ({ ok: false, error: 'no element matches "#x"' }))
    const out = await callTool(deps({ drive }), 'desktop_app_drive', { action: 'click', selector: '#x' })
    expect(drive).toHaveBeenCalledWith({ action: 'click', selector: '#x' })
    expect(JSON.parse(textOf(out))).toEqual({ ok: false, error: 'no element matches "#x"' })
  })

  it('does not exist without a drive, as in a release build', async () => {
    await expect(callTool(deps(), 'desktop_app_drive', { action: 'eval', js: '1' })).rejects.toThrow(/only exists in a debug build/)
  })
})

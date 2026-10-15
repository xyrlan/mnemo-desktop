import { describe, expect, it, vi } from 'vitest'
import { callTool, MAX_LINES, type ToolDeps } from './tools'
import type { McpSession } from './sessions'

function deps(over: Partial<ToolDeps> = {}): ToolDeps {
  const sessions: McpSession[] = [
    { pane: 1, kind: 'captain', tab: 'cap-1', label: 'fix the build', cwd: '/repo', sessionId: 'abc', shown: true },
    { kind: 'robot', tab: 'bot-2', label: 'robot', shown: false, note: 'its terminal is starting' },
    { pane: 2, kind: 'pane', label: 'terminal', shown: false, exitCode: 0 },
  ]
  return {
    sessions: () => sessions,
    read: async (id) => (id === 1 ? ['$ ls', 'a', 'b', ''] : undefined),
    ...over,
  }
}

const textOf = (c: Awaited<ReturnType<typeof callTool>>) => (c[0].type === 'text' ? c[0].text : '')

describe('desktop_list_panes', () => {
  it('answers the sessions as JSON text', async () => {
    expect(JSON.parse(textOf(await callTool(deps(), 'desktop_list_panes')))).toEqual(deps().sessions())
  })
})

describe('desktop_terminal_read', () => {
  it('returns the last lines of the terminal', async () => {
    expect(textOf(await callTool(deps(), 'desktop_terminal_read', { pane: 1, lines: 2 }))).toBe('a\nb')
    expect(textOf(await callTool(deps(), 'desktop_terminal_read', { pane: '1' }))).toBe('$ ls\na\nb')
  })

  it('clamps lines and rejects nonsense', async () => {
    const read = vi.fn(async () => Array.from({ length: MAX_LINES + 10 }, (_, i) => `l${i}`))
    const out = textOf(await callTool(deps({ read }), 'desktop_terminal_read', { pane: 1, lines: 1e9 }))
    expect(out.split('\n')).toHaveLength(MAX_LINES)
    await expect(callTool(deps(), 'desktop_terminal_read', { pane: 1, lines: 'many' })).rejects.toThrow(/lines/)
    await expect(callTool(deps(), 'desktop_terminal_read', {})).rejects.toThrow(/pane/)
  })

  it('reads only the terminal of a session', async () => {
    const read = vi.fn(deps().read)
    await expect(callTool(deps({ read }), 'desktop_terminal_read', { pane: 99 })).rejects.toThrow(/no session has pane 99.*desktop_list_panes/)
    expect(read).not.toHaveBeenCalled()
  })

  it('says so when the terminal has nothing to read yet', async () => {
    await expect(callTool(deps(), 'desktop_terminal_read', { pane: 2 })).rejects.toThrow(/nothing to read yet/)
  })

  it('says an empty terminal is empty', async () => {
    expect(textOf(await callTool(deps({ read: async () => ['', ''] }), 'desktop_terminal_read', { pane: 2 }))).toBe('(the terminal is empty)')
  })
})

describe('tools that went', () => {
  it('the browser tools and anything else are unknown', async () => {
    for (const tool of ['desktop_browser_read', 'desktop_pane_snapshot', 'desktop_rm_rf']) {
      await expect(callTool(deps(), tool, { pane: 1 })).rejects.toThrow(/unknown tool/)
    }
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

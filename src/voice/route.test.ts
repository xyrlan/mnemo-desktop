import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { Pane } from '../layout/store'
import type { HostedSession } from '../session/host'
import type { DrawerTab } from '../nexus/store'
import { insert, resolveTarget, withSeparator, type Sinks, type Where } from './route'

const shell = (id: number, extra: Partial<Pane> = {}): Pane => ({ id, view: 'terminal', ...extra })
const tab = (id: string, key: string | null): DrawerTab => ({ id, kind: 'captain', key, readOnly: key ? null : 'ended', label: id, sessionId: null, cwd: null })

/** The Nexus open, its drawer showing tab `active` of `tabs`; `sessions` by key, PTY by session. */
function where(o: {
  open?: boolean
  collapsed?: boolean
  tabs?: DrawerTab[]
  active?: string | null
  sessions?: Record<string, number | null>
  panes?: Pane[]
  /** The workbench's active tab's focused pane. */
  focused?: number
}): Where {
  const sessions = Object.fromEntries(
    Object.entries(o.sessions ?? {}).map(([key, pty]): [string, HostedSession] => [key, { key, kind: key.startsWith('pane:') ? 'pane' : 'attach', pty, by: ['nexus-drawer'] }]),
  )
  const focused = o.focused ?? 0
  return {
    nexus: { open: o.open ?? true, collapsed: o.collapsed ?? false, tabs: o.tabs ?? [], activeTab: o.active ?? o.tabs?.[0]?.id ?? null },
    sessions,
    layout: { tabs: [{ id: 't1', root: { kind: 'leaf', pane: focused }, focused }], activeTab: 't1', panes: Object.fromEntries((o.panes ?? []).map((p) => [p.id, p])) },
  }
}

/** The drawer showing captain `c1`'s pane 7 and robot `r1`'s attach, PTY 12. */
const drawer = (extra: Parameters<typeof where>[0] = {}) =>
  where({ tabs: [tab('c1', 'pane:7'), tab('r1', 'child:r1')], sessions: { 'pane:7': 7, 'child:r1': 12 }, panes: [{ ...shell(7), offscreen: true }], ...extra })

/** An element under `parent` from `html`, appended to the page. */
function put(html: string, parent: HTMLElement = document.body) {
  const el = document.createElement('div')
  el.innerHTML = html
  parent.appendChild(el)
  return el
}

const XTERM = '<div class="xterm"><textarea class="xterm-helper-textarea"></textarea></div>'

function sinks(): Sinks & { writePty: ReturnType<typeof vi.fn> } {
  return { writePty: vi.fn(async () => {}) }
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('resolveTarget', () => {
  it("types into the drawer's active terminal with nothing focused, or its own terminal focused", () => {
    expect(resolveTarget(null, drawer())).toEqual({ kind: 'pty', pane: 7 })
    expect(resolveTarget(document.body, drawer({ active: 'r1' }))).toEqual({ kind: 'pty', pane: 12 })
    const aside = put(`<aside data-nexus-drawer="">${XTERM}</aside>`)
    expect(resolveTarget(aside.querySelector('textarea'), drawer())).toEqual({ kind: 'pty', pane: 7 })
  })

  it("types into the bridge's prompt when it has focus, the drawer open or not", () => {
    const prompt = put('<div data-fleet-prompt=""><form><input aria-label="Orders for the fleet"></form></div>').querySelector('input')!
    expect(resolveTarget(prompt, drawer())).toEqual({ kind: 'field', el: prompt })
    expect(resolveTarget(prompt, where({}))).toEqual({ kind: 'field', el: prompt })
  })

  it('types into any other focused text field or contenteditable, not passwords or read-only fields', () => {
    put(`<textarea id="comment"></textarea><input id="q"><div id="ce" contenteditable="true"></div><input id="pw" type="password"><textarea id="ro" readonly></textarea>`)
    const byId = (id: string) => document.getElementById(id)!
    expect(resolveTarget(byId('comment'), drawer())).toEqual({ kind: 'field', el: byId('comment') })
    expect(resolveTarget(byId('q'), drawer())).toEqual({ kind: 'field', el: byId('q') })
    expect(resolveTarget(byId('ce'), drawer())).toEqual({ kind: 'editable', el: byId('ce') })
    // Not typeable: the drawer's terminal, as with nothing focused.
    expect(resolveTarget(byId('pw'), drawer())).toEqual({ kind: 'pty', pane: 7 })
    expect(resolveTarget(byId('ro'), where({}))).toBeNull()
  })

  it('has nowhere to type with no drawer tab, the drawer collapsed, or the tab showing no terminal', () => {
    expect(resolveTarget(null, where({}))).toBeNull()
    expect(resolveTarget(null, drawer({ collapsed: true }))).toBeNull()
    // A conversation shown read-only; an attach still starting.
    expect(resolveTarget(null, where({ tabs: [tab('c2', null)] }))).toBeNull()
    expect(resolveTarget(null, where({ tabs: [tab('r2', 'child:r2')], sessions: { 'child:r2': null } }))).toBeNull()
    // The session went from the host before its tab did.
    expect(resolveTarget(null, where({ tabs: [tab('c1', 'pane:7')] }))).toBeNull()
  })

  it("has nowhere to type into a pane whose shell exited or failed", () => {
    expect(resolveTarget(null, drawer({ panes: [shell(7, { exitCode: 0, offscreen: true })] }))).toBeNull()
    expect(resolveTarget(null, drawer({ panes: [shell(7, { error: 'spawn failed', offscreen: true })] }))).toBeNull()
  })

  it('a palette field is for choosing: the drawer gets the text', () => {
    const cmdk = put('<div data-palette><input id="cmdk"></div>').querySelector('input')!
    expect(resolveTarget(cmdk, drawer())).toEqual({ kind: 'pty', pane: 7 })
  })

  it("never types into the workbench's pane while the Nexus is open", () => {
    const pane = put(XTERM)
    pane.className = 'pane'
    pane.dataset.pane = '3'
    const w = where({ panes: [shell(3)], focused: 3 })
    expect(resolveTarget(pane.querySelector('textarea'), w)).toBeNull()
    expect(resolveTarget(null, w)).toBeNull()
  })

  it("the Nexus closed (until wave 2b): the workbench's focused terminal", () => {
    const pane = put(XTERM)
    pane.className = 'pane'
    pane.dataset.pane = '3'
    const w = drawer({ open: false, panes: [shell(3), shell(5)], focused: 5 })
    expect(resolveTarget(pane.querySelector('textarea'), w)).toEqual({ kind: 'pty', pane: 3 })
    expect(resolveTarget(null, w)).toEqual({ kind: 'pty', pane: 5 })
    expect(resolveTarget(null, drawer({ open: false, panes: [{ id: -1, view: 'browser' }], focused: -1 }))).toBeNull()
  })
})

describe('insert', () => {
  it('writes to the PTY without a trailing newline', async () => {
    const s = sinks()
    expect(await insert({ kind: 'pty', pane: 7 }, 'git status', s)).toBe(true)
    expect(s.writePty).toHaveBeenCalledWith(7, 'git status')
  })

  it('inserts at the caret of a text field and fires input', async () => {
    document.body.innerHTML = '<textarea>hello  there</textarea>'
    const ta = document.querySelector('textarea')!
    ta.setSelectionRange(5, 5)
    const onInput = vi.fn()
    ta.addEventListener('input', onInput)
    expect(await insert({ kind: 'field', el: ta }, 'big', sinks())).toBe(true)
    expect(ta.value).toBe('hello big  there')
    expect(ta.selectionStart).toBe(9)
    expect(onInput).toHaveBeenCalledOnce()
  })

  it('replaces the selection', async () => {
    document.body.innerHTML = '<input value="say WORD now">'
    const input = document.querySelector('input')!
    input.setSelectionRange(4, 8)
    await insert({ kind: 'field', el: input }, 'this', sinks())
    expect(input.value).toBe('say this now')
  })

  it('drops text for a detached target, and an empty transcript', async () => {
    const s = sinks()
    const gone = document.createElement('textarea')
    expect(await insert({ kind: 'field', el: gone }, 'x', s)).toBe(false)
    expect(await insert({ kind: 'pty', pane: 1 }, '', s)).toBe(false)
    expect(s.writePty).not.toHaveBeenCalled()
  })
})

describe('withSeparator', () => {
  it('adds a space only between two words', () => {
    expect(withSeparator('', 'Hi')).toBe('Hi')
    expect(withSeparator('word', 'next')).toBe(' next')
    expect(withSeparator('word ', 'next')).toBe('next')
    expect(withSeparator('line\n', 'next')).toBe('next')
    expect(withSeparator('word', ', then')).toBe(', then')
  })
})

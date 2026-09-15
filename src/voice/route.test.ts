import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { Pane } from '../layout/store'
import { insert, resolveTarget, withSeparator, type Layout, type Sinks } from './route'

function layout(focused: number, panes: Pane[]): Layout {
  return {
    tabs: [{ id: 't1', root: { kind: 'leaf', pane: focused }, focused }],
    activeTab: 't1',
    panes: Object.fromEntries(panes.map((p) => [p.id, p])),
  }
}

const shell = (id: number, extra: Partial<Pane> = {}): Pane => ({ id, view: 'terminal', ...extra })

/** A pane leaf as SplitView renders it, holding `inner`. */
function pane(id: number, inner: string) {
  const el = document.createElement('div')
  el.className = 'pane'
  el.dataset.pane = String(id)
  el.innerHTML = inner
  document.body.appendChild(el)
  return el
}

function sinks(): Sinks & { writePty: ReturnType<typeof vi.fn>; typeInMonaco: ReturnType<typeof vi.fn> } {
  return { writePty: vi.fn(async () => {}), typeInMonaco: vi.fn(async () => true) }
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('resolveTarget', () => {
  it('routes a focused terminal to its PTY', () => {
    const el = pane(3, '<div class="xterm"><textarea class="xterm-helper-textarea"></textarea></div>')
    const ta = el.querySelector('textarea')!
    expect(resolveTarget(ta, layout(3, [shell(3)]))).toEqual({ kind: 'pty', pane: 3 })
  })

  it("routes a text field to itself, even inside a terminal pane's overlay", () => {
    const el = pane(3, '<textarea class="reply"></textarea>')
    const ta = el.querySelector('textarea')!
    expect(resolveTarget(ta, layout(3, [shell(3)]))).toEqual({ kind: 'field', el: ta })
  })

  it('routes the sidebar reply field and plain inputs, not passwords or read-only fields', () => {
    document.body.innerHTML = `<textarea id="reply"></textarea><input id="q"><input id="pw" type="password"><textarea id="ro" readonly></textarea>`
    const l = layout(-1, [{ id: -1, view: 'mission' }])
    const byId = (id: string) => document.getElementById(id)!
    expect(resolveTarget(byId('reply'), l)).toEqual({ kind: 'field', el: byId('reply') })
    expect(resolveTarget(byId('q'), l)).toEqual({ kind: 'field', el: byId('q') })
    expect(resolveTarget(byId('pw'), l)).toEqual({ kind: 'none' })
    expect(resolveTarget(byId('ro'), l)).toEqual({ kind: 'none' })
  })

  it("routes Monaco's hidden textarea to the editor, not to a field", () => {
    const el = pane(-2, '<div class="monaco-editor"><textarea class="inputarea"></textarea></div>')
    const ed = el.querySelector<HTMLElement>('.monaco-editor')!
    expect(resolveTarget(el.querySelector('textarea'), layout(-2, [{ id: -2, view: 'editor' }]))).toEqual({ kind: 'monaco', el: ed })
  })

  it('falls back to the focused pane when the palette input or nothing has focus', () => {
    document.body.innerHTML = '<div class="palette-overlay"><input id="cmdk"></div>'
    const l = layout(5, [shell(5)])
    expect(resolveTarget(document.getElementById('cmdk'), l)).toEqual({ kind: 'pty', pane: 5 })
    expect(resolveTarget(document.body, l)).toEqual({ kind: 'pty', pane: 5 })
    const el = pane(-2, '<div class="monaco-editor"></div>')
    expect(resolveTarget(document.body, layout(-2, [{ id: -2, view: 'editor' }]))).toEqual({
      kind: 'monaco',
      el: el.firstElementChild,
    })
  })

  it('has nowhere to type into an exited or failed shell, or a browser pane', () => {
    expect(resolveTarget(null, layout(4, [shell(4, { exitCode: 0 })]))).toEqual({ kind: 'none' })
    expect(resolveTarget(null, layout(4, [shell(4, { error: 'spawn failed' })]))).toEqual({ kind: 'none' })
    expect(resolveTarget(null, layout(-1, [{ id: -1, view: 'browser' }]))).toEqual({ kind: 'none' })
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

  it('hands Monaco to its sink and drops text for a detached or missing target', async () => {
    const s = sinks()
    const ed = pane(-2, '<div class="monaco-editor"></div>').firstElementChild as HTMLElement
    expect(await insert({ kind: 'monaco', el: ed }, 'x', s)).toBe(true)
    expect(s.typeInMonaco).toHaveBeenCalledWith(ed, 'x')
    const gone = document.createElement('textarea')
    expect(await insert({ kind: 'field', el: gone }, 'x', s)).toBe(false)
    expect(await insert({ kind: 'none' }, 'x', s)).toBe(false)
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

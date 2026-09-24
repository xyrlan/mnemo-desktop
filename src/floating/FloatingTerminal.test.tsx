import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { TooltipProvider } from '@/ui'
import type { PaneViewProps } from '../panes/registry'
import type { PtyClient } from '../pty/client'
import { FloatingTerminal, FloatingTerminalToggle } from './FloatingTerminal'
import { createFloatingStore, STORAGE_KEY, type FloatingStore } from './store'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// Popper-positioned content (the tooltips) is never opened here: see src/ui/primitives.test.tsx.

const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 20))))

let spawnFails = false
function liveStore(): FloatingStore {
  let next = 10
  const pty: PtyClient = {
    async spawn() {
      if (spawnFails) throw new Error('no shell')
      return next++
    },
    write: async () => {},
    resize: async () => {},
    kill: async () => {},
    onExit: async () => () => {},
  }
  return createFloatingStore({
    pty,
    sessions: null,
    sinkOf: () => undefined,
    watchSinks: () => () => {},
    forgetSink: () => {},
    storage: localStorage,
    viewport: () => ({ width: 1440, height: 900 }),
  })
}

/** Stands in for the terminal pane: counts its renders, and has the xterm's input to focus. */
let renders = 0
function StubTerminal({ id }: PaneViewProps) {
  renders++
  return (
    <div data-stub-terminal={id}>
      <textarea aria-label={`shell ${id}`} />
    </div>
  )
}

let store: FloatingStore
let host: HTMLElement
beforeEach(async () => {
  localStorage.clear()
  spawnFails = false
  renders = 0
  store = liveStore()
  store.getState().setWhere('/code/app', '/code/app')
  host = document.body.appendChild(document.createElement('div'))
  await act(async () =>
    createRoot(host).render(
      <TooltipProvider>
        <button type="button">outside</button>
        <FloatingTerminalToggle store={store} />
        <FloatingTerminal store={store} terminal={StubTerminal} />
      </TooltipProvider>,
    ),
  )
})
afterEach(() => {
  document.body.innerHTML = ''
})

const panel = () => host.querySelector<HTMLElement>('[data-floating-terminal]')!
const titlebar = () => host.querySelector<HTMLElement>('[data-floating-terminal-titlebar]')!
const byLabel = (label: string) => host.querySelector<HTMLElement>(`[aria-label="${label}"]`)!
/** jsdom has no PointerEvent; React reads a mouse event of the same name alike. */
const pointer = (el: Element, type: string, x: number, y: number) =>
  act(async () => void el.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 })))
const openIt = async () => {
  await act(async () => byLabel('Toggle floating terminal').click())
  await flush()
}

describe('the floating terminal', () => {
  it('is hidden and holds no shell until toggled', () => {
    expect(panel().getAttribute('aria-hidden')).toBe('true')
    expect(panel().hasAttribute('inert')).toBe(true)
    expect(host.querySelector('[data-stub-terminal]')).toBeNull()
    expect(byLabel('Toggle floating terminal').getAttribute('aria-pressed')).toBe('false')
    // New UI outside the old views' reset (`src/theme.css`).
    expect(panel().hasAttribute('data-ui')).toBe(true)
  })

  it("opens over the app on the worktree's shell, which takes the keyboard, and gives it back when closed", async () => {
    const outside = host.querySelector<HTMLButtonElement>('button')!
    outside.focus()
    await openIt()
    expect(panel().getAttribute('aria-hidden')).toBe('false')
    expect(panel().style.visibility).toBe('visible')
    expect(byLabel('Toggle floating terminal').getAttribute('aria-pressed')).toBe('true')
    expect(host.querySelector('[data-stub-terminal]')!.getAttribute('data-stub-terminal')).toBe('10')
    expect(titlebar().textContent).toContain('Terminal')
    expect(titlebar().textContent).toContain('app')
    expect(document.activeElement).toBe(byLabel('shell 10'))
    // A live store selected without building new objects: a handful of renders, not a loop (#212).
    expect(renders).toBeLessThan(5)
    await act(async () => byLabel('Minimize floating terminal').click())
    expect(panel().getAttribute('aria-hidden')).toBe('true')
    expect(document.activeElement).toBe(outside)
    // Hidden, the shell stays mounted with its screen.
    expect(host.querySelector('[data-stub-terminal="10"]')).not.toBeNull()
  })

  it('moves when its titlebar is dragged, and remembers where', async () => {
    await openIt()
    const start = { ...store.getState().bounds }
    await pointer(titlebar(), 'pointerdown', 600, 300)
    await pointer(titlebar(), 'pointermove', 500, 250)
    expect(panel().style.left).toBe(`${start.left - 100}px`)
    expect(panel().style.top).toBe(`${start.top - 50}px`)
    expect(localStorage.getItem(STORAGE_KEY)).not.toContain('anchorX')
    await pointer(titlebar(), 'pointerup', 500, 250)
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).bounds).toMatchObject({ anchorX: 'right', anchorY: 'bottom', width: start.width })
  })

  it('does not move when the press is on a titlebar button', async () => {
    await openIt()
    const start = { ...store.getState().bounds }
    const button = byLabel('Maximize floating terminal')
    await pointer(button, 'pointerdown', 600, 300)
    await pointer(titlebar(), 'pointermove', 500, 250)
    await pointer(titlebar(), 'pointerup', 500, 250)
    expect(store.getState().bounds).toEqual(start)
  })

  it('resizes from an edge', async () => {
    await openIt()
    const start = { ...store.getState().bounds }
    const se = host.querySelector('[data-resize-edge="se"]')!
    await pointer(se, 'pointerdown', 100, 100)
    await pointer(se, 'pointermove', 60, 80)
    await pointer(se, 'pointerup', 60, 80)
    expect(store.getState().bounds).toEqual({ ...start, width: start.width - 40, height: start.height - 20 })
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).bounds.width).toBe(start.width - 40)
  })

  it('maximizes from its button or a double-click on the titlebar, and restores', async () => {
    await openIt()
    const start = { ...store.getState().bounds }
    await act(async () => byLabel('Maximize floating terminal').click())
    expect(panel().style.left).toBe('12px')
    expect(host.querySelector('[data-resize-edge]')).toBeNull()
    expect(byLabel('Restore floating terminal').getAttribute('aria-pressed')).toBe('true')
    await act(async () => void titlebar().dispatchEvent(new MouseEvent('dblclick', { bubbles: true, button: 0 })))
    expect(store.getState().bounds).toEqual(start)
    expect(host.querySelector('[data-resize-edge]')).not.toBeNull()
  })

  it("keeps each worktree's shell mounted, showing the active one's", async () => {
    await openIt()
    await act(async () => store.getState().setWhere('/code/site', '/code/site'))
    await flush()
    const shells = [...host.querySelectorAll<HTMLElement>('[data-floating-shell]')]
    expect(shells.map((s) => [s.getAttribute('data-floating-shell'), s.classList.contains('hidden')])).toEqual([
      ['10', true],
      ['11', false],
    ])
    expect(titlebar().textContent).toContain('site')
  })

  it('says why a shell could not start, and tries again', async () => {
    spawnFails = true
    await openIt()
    expect(panel().textContent).toContain('Could not start a shell: Error: no shell')
    spawnFails = false
    const retry = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Try again')!
    await act(async () => retry.click())
    await flush()
    expect(panel().textContent).not.toContain('Could not start')
    expect(host.querySelector('[data-stub-terminal="10"]')).not.toBeNull()
  })
})

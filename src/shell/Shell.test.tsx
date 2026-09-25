import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: async () => null, Channel: class {} }))
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }))
// The workbench has its own tests; here it is the box the columns sit around, drawing the ends
// of the window's top band where its top groups' rows would.
vi.mock('./Workbench', async () => {
  const { createElement } = await import('react')
  return {
    default: ({ lead, trail }: { lead?: unknown; trail?: unknown }) =>
      createElement('div', { 'data-top-row': '' }, createElement('span', { 'data-start': '' }, lead as never), createElement('span', { 'data-end': '' }, trail as never)),
  }
})

import Shell from './Shell'
import { mountInSlot, resetSlots } from './slots'
import { DEFAULTS, shellStore } from './store'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  resetSlots()
  shellStore.setState(DEFAULTS)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function render() {
  await act(async () => root.render(<Shell ready notice={null} onDismissNotice={() => {}} />))
}
const q = <T extends Element = HTMLElement>(sel: string) => host.querySelector<T>(sel)
const column = (side: 'left' | 'right') => q(`[data-shell-column="${side}"]`)
const toggles = (label: string) => [...host.querySelectorAll<HTMLButtonElement>(`button[aria-label="${label}"]`)]
const mouse = (type: string, target: EventTarget, x: number) =>
  act(() => void target.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: 10, bubbles: true, cancelable: true, button: 0 })))

const Left = () => <nav data-left>workspaces</nav>
const Right = () => <aside data-right>memory</aside>

const start = () => q('[data-top-row] [data-start]')!
const end = () => q('[data-top-row] [data-end]')!

test('with nothing mounted: the app’s name at the start of the top row, and the status bar’s strip; no columns, no toggles', async () => {
  await render()
  expect(start().textContent).toContain('mnemo')
  // No titlebar row of its own: the workbench's top groups' rows are the window's top band.
  expect(q('[data-shell-titlebar]')).toBeNull()
  expect(column('left')).toBeNull()
  expect(column('right')).toBeNull()
  expect(toggles('Toggle sidebar')).toHaveLength(0)
  expect(toggles('Toggle right sidebar')).toHaveLength(0)
  const status = q('[data-shell-slot="status-bar"]')!
  expect(status.className).toContain('h-6')
  expect(status.childElementCount).toBe(0)
})

test('each slot draws where Orca has it', async () => {
  mountInSlot('left-sidebar', Left)
  mountInSlot('right-sidebar', Right)
  mountInSlot('titlebar-right', () => <div data-cluster>cluster</div>)
  mountInSlot('status-bar', () => <footer data-status>bar</footer>)
  mountInSlot('overlay', () => <div data-drawer>drawer</div>)
  await render()
  expect(column('left')!.querySelector('[data-shell-slot="left-sidebar"] [data-left]')).not.toBeNull()
  expect(column('right')!.querySelector('[data-shell-slot="right-sidebar"] [data-right]')).not.toBeNull()
  // The right cluster ends the top-right group's row.
  expect(end().querySelector('[data-shell-slot="titlebar-right"] [data-cluster]')).not.toBeNull()
  expect(start().childElementCount).toBe(0)
  expect(q('[data-shell-slot="status-bar"] [data-status]')).not.toBeNull()
  // Overlays are drawn after the shell, not inside any of its columns.
  const overlay = q('[data-drawer]')!
  expect(q('[data-shell]')!.contains(overlay)).toBe(false)
  // The order on screen: left column, then the workbench, then the right column.
  const row = column('left')!.parentElement!
  expect([...row.children].map((c) => (c as HTMLElement).dataset.shellColumn ?? 'center')).toEqual(['left', 'center', 'right'])
})

test('the left column is the sidebar’s width; closed, it is 0 wide and inert, its component still mounted, and its controls move to the top-left row', async () => {
  let mounts = 0
  let unmounts = 0
  function Counted() {
    useEffect(() => {
      mounts++
      return () => void unmounts++
    }, [])
    return <nav>workspaces</nav>
  }
  mountInSlot('left-sidebar', Counted)
  await render()
  const left = column('left')!
  expect(left.style.width).toBe('280px')
  expect(left.hasAttribute('inert')).toBe(false)
  expect(left.querySelector('.titlebar-left')?.textContent).toContain('mnemo')
  expect(start().textContent).not.toContain('mnemo')

  act(() => toggles('Toggle sidebar')[0].click())
  expect(shellStore.getState().leftOpen).toBe(false)
  expect(left.style.width).toBe('0px')
  expect(left.hasAttribute('inert')).toBe(true)
  expect(left.querySelector('[data-sidebar-resize-handle]')).toBeNull()
  expect(start().textContent).toContain('mnemo')
  expect([mounts, unmounts]).toEqual([1, 0])

  // The row's copy of the toggle opens it again.
  const inRow = start().querySelector<HTMLButtonElement>('button[aria-label="Toggle sidebar"]')!
  act(() => inRow.click())
  expect(start().textContent).not.toContain('mnemo')
  expect(left.style.width).toBe('280px')
  expect([mounts, unmounts]).toEqual([1, 0])
})

test('the right sidebar’s toggle ends the top-right row, after the cluster, only while it is closed', async () => {
  mountInSlot('right-sidebar', Right)
  mountInSlot('titlebar-right', () => <div data-cluster>cluster</div>)
  await render()
  expect(column('right')!.style.width).toBe('320px')
  expect(toggles('Toggle right sidebar')).toHaveLength(0)
  act(() => shellStore.getState().toggleRight())
  expect(column('right')!.style.width).toBe('0px')
  expect(column('right')!.hasAttribute('inert')).toBe(true)
  expect(q('[data-right]')).not.toBeNull()
  const [cluster, toggle] = [end().querySelector('[data-cluster]')!, end().querySelector('button[aria-label="Toggle right sidebar"]')!]
  expect(cluster.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  act(() => toggles('Toggle right sidebar')[0].click())
  expect(shellStore.getState().rightOpen).toBe(true)
  expect(toggles('Toggle right sidebar')).toHaveLength(0)
})

test('dragging the left seam resizes the sidebar, and the width is kept on release', async () => {
  mountInSlot('left-sidebar', Left)
  await render()
  const handle = column('left')!.querySelector('[data-sidebar-resize-handle]')!
  mouse('mousedown', handle, 280)
  expect(document.querySelector('[data-sidebar-resize-overlay]')).not.toBeNull()
  mouse('mousemove', window, 330)
  // Not stored mid-drag: only the column follows the pointer.
  expect(shellStore.getState().leftWidth).toBe(280)
  mouse('mouseup', window, 330)
  expect(shellStore.getState().leftWidth).toBe(330)
  expect(column('left')!.style.width).toBe('330px')
  expect(document.documentElement.style.getPropertyValue('--workspace-sidebar-live-width')).toBe('330px')
  expect(document.querySelector('[data-sidebar-resize-overlay]')).toBeNull()
  expect(document.body.style.cursor).toBe('')

  // Past the bound, it stops at Orca's 500.
  mouse('mousedown', column('left')!.querySelector('[data-sidebar-resize-handle]')!, 330)
  mouse('mousemove', window, 2000)
  mouse('mouseup', window, 2000)
  expect(shellStore.getState().leftWidth).toBe(500)
})

test('dragging the right edge leftwards widens the right sidebar, up to what leaves the workbench room', async () => {
  mountInSlot('left-sidebar', Left)
  mountInSlot('right-sidebar', Right)
  await render()
  const edge = () => column('right')!.querySelector('[data-sidebar-resize-handle]')!
  mouse('mousedown', edge(), 900)
  mouse('mousemove', window, 820)
  mouse('mouseup', window, 820)
  expect(shellStore.getState().rightWidth).toBe(400)
  // jsdom's window is 1024 wide: 1024 − 280 (left) − 320 (workbench) = 424 at most.
  mouse('mousedown', edge(), 820)
  mouse('mousemove', window, 0)
  mouse('mouseup', window, 0)
  expect(window.innerWidth).toBe(1024)
  expect(shellStore.getState().rightWidth).toBe(424)
  expect(column('right')!.style.width).toBe('424px')
})

test('a stored right width wider than the window allows is drawn narrower, and kept', async () => {
  mountInSlot('right-sidebar', Right)
  shellStore.setState({ rightWidth: 900 })
  await render()
  // The left slot is empty, so no left column takes room: 1024 − 320 = 704.
  expect(column('right')!.style.width).toBe('704px')
  expect(shellStore.getState().rightWidth).toBe(900)
})

test('Orca’s window-chrome variables are 0: the window keeps its native title bar', async () => {
  await render()
  const shell = q('[data-shell]')!
  for (const v of ['--window-controls-width', '--window-controls-height', '--mac-traffic-lights-width', '--collapsed-sidebar-header-width']) {
    expect(shell.style.getPropertyValue(v)).toBe('0px')
  }
})

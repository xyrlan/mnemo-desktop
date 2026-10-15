import { act, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { NexusMenu } from './Menu'
import type { MenuItem } from './menus'
import { WindowHost } from './Window'
import { confirm, ConfirmHost } from './confirm'
import { closeWindow, openWindow, registerWindow, windowStore } from './windows'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mount = async (el: ReactElement) => {
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  await act(async () => root.render(el))
  return () => act(async () => root.unmount())
}
const key = (k: string) => act(async () => void document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })))

afterEach(() => {
  closeWindow()
  document.body.innerHTML = ''
})

test('a menu runs the item Enter lands on, skipping a disabled one, and closes first', async () => {
  const ran: string[] = []
  let closed = 0
  const items: MenuItem[] = [
    { id: 'off', label: 'Off', disabled: true, run: () => void ran.push('off') },
    { id: 'open', label: 'Open', run: () => void ran.push('open') },
    { id: 'close', label: 'Close', danger: true, run: () => void ran.push('close') },
  ]
  const unmount = await mount(<NexusMenu x={10} y={10} head="mnemo" items={items} onClose={() => closed++} />)
  expect(document.querySelector('[data-nx-menu]')!.textContent).toContain('mnemo')
  await key('ArrowDown')
  await key('Enter')
  expect(ran).toEqual(['close'])
  expect(closed).toBe(1)
  await unmount()
})

test('Esc and a click outside close a menu', async () => {
  let closed = 0
  const unmount = await mount(<NexusMenu x={0} y={0} items={[]} onClose={() => closed++} />)
  expect(document.querySelector('[data-nx-menu]')!.textContent).toContain('nothing to do here')
  await key('Escape')
  await act(async () => void document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
  expect(closed).toBe(2)
  await unmount()
})

test('the host draws the open window in the ship frame; Esc and the backdrop close it', async () => {
  const off = registerWindow({ id: 'missions', title: 'Missions', render: (p) => <p data-body="">repo {String(p.root)}</p> })
  const unmount = await mount(<WindowHost />)
  expect(document.querySelector('[data-nx-window]')).toBeNull()
  await act(async () => openWindow('missions', { root: '/r' }))
  expect(document.querySelector('[data-nx-window] .nx-window-title')!.textContent).toBe('Missions')
  expect(document.querySelector('[data-body]')!.textContent).toBe('repo /r')
  await key('Escape')
  expect(windowStore.getState().open).toBeNull()
  await act(async () => openWindow('missions'))
  await act(async () => void document.querySelector('[data-nx-backdrop]')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
  expect(windowStore.getState().open).toBeNull()
  off()
  await unmount()
})

test('a confirmation over a window: Esc answers it and leaves the window open; the button goes ahead', async () => {
  const off = registerWindow({ id: 'accounts', title: 'Accounts', render: () => null })
  const unmount = await mount(
    <>
      <WindowHost />
      <ConfirmHost />
    </>,
  )
  await act(async () => openWindow('accounts'))
  let first!: Promise<boolean>
  await act(async () => void (first = confirm({ title: 'Remove work?', body: 'Its sign-in is deleted.', confirm: 'Remove', danger: true })))
  expect(document.querySelector('[data-nx-confirm]')!.textContent).toContain('Its sign-in is deleted.')
  await key('Escape')
  expect(await first).toBe(false)
  expect(document.querySelector('[data-nx-confirm]')).toBeNull()
  expect(windowStore.getState().open?.id).toBe('accounts')
  let second!: Promise<boolean>
  await act(async () => void (second = confirm({ title: 'Merge #382?', confirm: 'Merge' })))
  const go = [...document.querySelectorAll<HTMLButtonElement>('[data-nx-confirm] button')].find((b) => b.textContent === 'Merge')!
  expect(go.dataset.tone).toBe('go')
  await act(async () => go.click())
  expect(await second).toBe(true)
  off()
  await unmount()
})

test('a second ask answers the first with no', async () => {
  const first = confirm({ title: 'A?', confirm: 'A' })
  const second = confirm({ title: 'B?', confirm: 'B' })
  expect(await first).toBe(false)
  const unmount = await mount(<ConfirmHost />)
  expect(document.querySelector('[data-nx-confirm]')!.textContent).toContain('B?')
  await key('Escape')
  expect(await second).toBe(false)
  await unmount()
})

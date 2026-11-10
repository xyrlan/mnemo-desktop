import { act, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
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

test('a confirmation over a window: Esc answers it and leaves the window open; the button goes ahead', async () => {
  const off = registerWindow({ id: 'accounts', title: 'Accounts', render: () => null })
  const unmount = await mount(<ConfirmHost />)
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

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui'
import Shell from './Shell'
import { mountInSlot, resetSlots, slotEntries } from './slots'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  resetSlots()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const render = () => act(async () => root.render(<Shell />))

test('the shell draws the overlay slot and nothing of its own: no columns, bars or workbench (#459)', async () => {
  mountInSlot('overlay', () => <div data-nexus="">ship</div>)
  mountInSlot('overlay', () => <div data-stack="">cards</div>)
  await render()
  expect([...host.children].map((c) => c.getAttribute('data-nexus') ?? c.getAttribute('data-stack'))).toEqual(['', ''])
  expect(host.querySelector('[data-shell], [data-shell-main], [data-shell-column], [data-shell-slot], [inert]')).toBeNull()
})

test('it starts nothing and mounts no toaster of its own: the Nexus does, as it mounts', async () => {
  await render()
  expect(slotEntries('overlay')).toEqual([])
  expect(host.querySelector('section')).toBeNull()
})

test('a Radix tooltip in an overlay has its provider: the dictation indicator’s throws without one', async () => {
  mountInSlot('overlay', () => (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" data-tip="">dictate</button>
      </TooltipTrigger>
      <TooltipContent>⌘E</TooltipContent>
    </Tooltip>
  ))
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  await render()
  expect(host.querySelector('[data-tip]')).not.toBeNull()
  expect(host.querySelector('[role="alert"]')).toBeNull()
  error.mockRestore()
})

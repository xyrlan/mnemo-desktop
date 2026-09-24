import { act } from 'react'
import { mountInSlot } from './shell'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// The shell piece is written beside this one; which of these runs says whether it has landed.
const hasShell = Object.keys(import.meta.glob('../shell/slots.ts')).length > 0

test.runIf(hasShell)('with the shell here, the dashboard mounts through it', async () => {
  const shell = Object.values(import.meta.glob<{ mountInSlot: unknown }>('../shell/slots.ts', { eager: true }))[0]
  expect(mountInSlot).toBe(shell.mountInSlot)
})

test.skipIf(hasShell)('until the shell lands, a component gets a root of its own at the end of <body>, and leaves with it', async () => {
  const Probe = () => <p data-probe>here</p>
  let unmount = () => {}
  await act(async () => {
    unmount = mountInSlot('overlay', Probe)
  })
  expect(document.body.lastElementChild!.querySelector('[data-probe]')!.textContent).toBe('here')
  await act(async () => unmount())
  expect(document.querySelector('[data-probe]')).toBeNull()
  expect(document.body.children).toHaveLength(0)
})

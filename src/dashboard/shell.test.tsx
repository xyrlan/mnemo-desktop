import { mountInSlot } from './shell'
import { mountInSlot as shellMount } from '../shell/slots'

test('the dashboard mounts through the shell', () => {
  expect(mountInSlot).toBe(shellMount)
})

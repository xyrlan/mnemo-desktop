// The seam to the wave-B `shell` piece. Before it lands the sidebar mounts nowhere and reads the
// shell's defaults; once `src/shell/` is on the branch, this holds it to the contract's names, so
// a rename there fails here instead of leaving the sidebar silently unmounted.
import { mountInSlot, shellFound, useShell } from './shell'

const shellFiles = Object.keys(import.meta.glob(['../shell/slots.{ts,tsx}', '../shell/store.{ts,tsx}']))

test('the shell’s mountInSlot and useShell are found as the contract names them, or stood in for', () => {
  if (shellFiles.length > 0) {
    expect(shellFound).toEqual({ slots: true, store: true })
    return
  }
  expect(shellFound).toEqual({ slots: false, store: false })
  const unmount = mountInSlot('left-sidebar', () => null)
  expect(unmount).toBeTypeOf('function')
  unmount()
  // Outside a render: the stand-in is a plain read of the defaults, not a React hook.
  expect(useShell((s) => [s.leftOpen, s.leftWidth])).toEqual([true, 280])
})

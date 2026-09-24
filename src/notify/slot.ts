import { createElement, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'

/** The shell's `mountInSlot` (`src/shell/slots.ts`, the wave-B `shell` piece). */
export type MountInSlot = (slot: 'overlay', component: ComponentType) => () => void

// Found by glob, not imported, so this piece builds before the shell lands: a glob that matches
// nothing is `{}`, where an import of a missing file fails the build.
const shell = import.meta.glob<{ mountInSlot?: MountInSlot }>('../shell/slots.ts', { eager: true })

/** Until the shell is there: its own root on `<body>`. The stack is `fixed`, so where it sits in
 *  the tree does not change where it draws. */
export const ownRoot: MountInSlot = (_slot, Component) => {
  const host = document.createElement('div')
  host.dataset.notifyHost = ''
  document.body.appendChild(host)
  const root = createRoot(host)
  root.render(createElement(Component))
  return () => {
    root.unmount()
    host.remove()
  }
}

export const mountInSlot: MountInSlot = Object.values(shell)[0]?.mountInSlot ?? ownRoot

import { createElement, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'

/** The shell's overlay slot. `mountInSlot` comes from `src/shell/slots.ts`, which the shell
 *  piece of wave B delivers alongside this one; until it is in the tree, the dialog mounts in a
 *  root of its own on `<body>` (it portals there anyway). Once both have landed, this file can
 *  become `export { mountInSlot } from '../shell/slots'`. */
type MountInSlot = (slot: 'overlay', component: ComponentType) => () => void

const shell = Object.values(import.meta.glob<{ mountInSlot?: MountInSlot }>('../shell/slots.ts', { eager: true }))[0]

function ownRoot(_: 'overlay', component: ComponentType): () => void {
  const host = document.createElement('div')
  host.dataset.onboardingHost = ''
  document.body.appendChild(host)
  const root = createRoot(host)
  root.render(createElement(component))
  return () => {
    root.unmount()
    host.remove()
  }
}

export const mountInSlot: MountInSlot = shell?.mountInSlot ?? ownRoot

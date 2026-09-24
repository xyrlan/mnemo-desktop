import { createElement, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'

/** The dashboard's one seam to the `shell` piece (wave-B contract): `mountInSlot` from
 *  `src/shell/slots.ts`, and the left sidebar's open width from `src/shell/store.ts`, which the
 *  drawer opens beside.
 *
 *  Both pieces are written in parallel, so the shell is looked up rather than imported: a glob
 *  that matches nothing is `{}`, where a plain import of a file not there yet fails the build.
 *  Once the shell has landed this can become two plain imports. */

export type ShellSlot = 'left-sidebar' | 'right-sidebar' | 'status-bar' | 'titlebar-tabs' | 'titlebar-right' | 'overlay'

type Slots = { mountInSlot(slot: ShellSlot, component: ComponentType): () => void }
type ShellState = { leftOpen: boolean; leftWidth: number }
type Store = { useShell<T>(sel: (s: ShellState) => T): T }

const slots = Object.values(import.meta.glob<Slots>('../shell/slots.ts', { eager: true }))[0]
const store = Object.values(import.meta.glob<Store>('../shell/store.ts', { eager: true }))[0]

/** Before the shell exists, a component gets a root of its own at the end of `<body>`, which is
 *  all the `overlay` slot is for a drawer that portals itself anyway. */
function mountAlone(_slot: ShellSlot, component: ComponentType): () => void {
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  root.render(createElement(component))
  return () => {
    root.unmount()
    host.remove()
  }
}

export const mountInSlot: Slots['mountInSlot'] = slots?.mountInSlot ?? mountAlone

const noSidebar = () => 0
/** Where the left sidebar ends, in px: its width while open, else 0. Fixed at load, so it is
 *  always the same hook. */
export const useLeftEdge: () => number = store?.useShell ? () => store.useShell((s) => (s.leftOpen ? s.leftWidth : 0)) : noSidebar

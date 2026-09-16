/** Fills every `VaultLevelSlot` the sidebar mounts. The slot belongs to `src/cockpit/`; this
 *  module never imports it. It finds the slot by its `data-vault-level-slot` attribute, renders
 *  into a child of its own, and marks the slot `vl-filled` so the sidebar hides its placeholder. */
import type { ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'

export const SLOT_SELECTOR = '[data-vault-level-slot]'
export const FILLED = 'vl-filled'

/** Watches `scope` for slots coming and going; resolves to a stop that unmounts everything. */
export function fillSlots(scope: Element, render: () => ReactNode): () => void {
  const mounted = new Map<Element, { root: Root; host: HTMLElement }>()

  const sync = () => {
    for (const slot of scope.querySelectorAll(SLOT_SELECTOR)) {
      if (mounted.has(slot)) continue
      const host = document.createElement('div')
      host.className = 'vl-host'
      slot.appendChild(host)
      slot.classList.add(FILLED)
      const root = createRoot(host)
      root.render(render())
      mounted.set(slot, { root, host })
    }
    for (const [slot, { root, host }] of mounted) {
      if (slot.isConnected && host.isConnected) continue
      mounted.delete(slot)
      // Unmounting synchronously inside a React commit warns; the next task is soon enough.
      queueMicrotask(() => root.unmount())
    }
  }

  sync()
  const observer = new MutationObserver(sync)
  observer.observe(scope, { childList: true, subtree: true })
  return () => {
    observer.disconnect()
    for (const [slot, { root, host }] of mounted) {
      root.unmount()
      host.remove()
      slot.classList.remove(FILLED)
    }
    mounted.clear()
  }
}

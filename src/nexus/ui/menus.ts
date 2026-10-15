import type { Ship } from '../ship-types'

/** What was right-clicked on the ship. `id`: a captain's or a robot's id; a deck's or a dock's root. */
export type MenuTarget = { kind: 'captain' | 'robot' | 'deck' | 'dock'; id: string } | { kind: 'systems'; id: '' }

/** One line of a menu. `run` does it; the menu closes first. `danger` marks what ends something. */
export type MenuItem = {
  id: string
  label: string
  hint?: string
  danger?: boolean
  disabled?: boolean
  run(): void | Promise<void>
}

/** What the Nexus lends a menu: `open` opens a figure's drawer tab, as a click on it does. */
export type MenuContext = { open(id: string): void }

/** A piece's contribution to the menus: the items it offers for a target, or none. */
export type MenuProvider = (target: MenuTarget, ship: Ship, ctx: MenuContext) => MenuItem[]

const providers: MenuProvider[] = []

/** Adds a provider (a piece's `view.ts` does, at import). Returns the unregister. */
export function registerMenu(provider: MenuProvider): () => void {
  providers.push(provider)
  return () => {
    const i = providers.indexOf(provider)
    if (i >= 0) providers.splice(i, 1)
  }
}

/** Every provider's items for a target, in registration order. A provider that throws offers none. */
export function menuFor(target: MenuTarget, ship: Ship, ctx: MenuContext): MenuItem[] {
  return providers.flatMap((p) => {
    try {
      return p(target, ship, ctx)
    } catch {
      return []
    }
  })
}

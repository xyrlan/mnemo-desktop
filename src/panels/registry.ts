// The panels that exist. Kept apart from the host (`./index.tsx`) because the host imports
// every panel folder and every panel imports `registerPanel`: with the registry in the host,
// a panel's module ran before the host's own body and `registerPanel` threw (the two panel
// pieces each worked around it, 2026-11-10). This file imports nothing of the host.

import type { ComponentType } from 'react'
import type { PanelId } from '../world/route'

export interface PanelSpec {
  id: PanelId
  title: string
  /** A line under the title: what the panel is for. */
  hint?: string
  /** `wide`: a panel that needs the room (a diff, the vault's pages). */
  size?: 'side' | 'wide'
  Component: ComponentType
}

const ORDER: PanelId[] = ['projects', 'missions', 'changes', 'memory', 'learned', 'accounts', 'setup', 'settings']

// Made on first use, in a function declaration, so a panel that registers while a module cycle
// is still being evaluated finds it: a `const` here would not exist yet at that moment.
function registry(): Map<PanelId, PanelSpec> {
  const g = globalThis as { __mnemoPanels?: Map<PanelId, PanelSpec> }
  return (g.__mnemoPanels ??= new Map())
}

export function registerPanel(spec: PanelSpec): void {
  registry().set(spec.id, spec)
}

export function panelOf(id: PanelId | null | undefined): PanelSpec | undefined {
  return id ? registry().get(id) : undefined
}

/** The panels that exist, in the order the command line and the top bar list them. */
export function panels(): PanelSpec[] {
  return ORDER.map((id) => registry().get(id)).filter((p): p is PanelSpec => !!p)
}

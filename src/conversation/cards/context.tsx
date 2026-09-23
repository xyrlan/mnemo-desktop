import { createContext, useContext } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { openRule } from '../../pulse/open'
import { makeVaultClient, type Invoke } from '../../vault/client'
import type { RunResult } from '../../vault/types'
import type { ImageRef } from '../types'

/** What a rule chip does: open the rule in the vault pane, or disable it (`mnemo
 *  disable-rule`). A context rather than props so tests (and a later host) can swap them. */
export type RuleActions = { open(slug: string): void; veto(slug: string): Promise<RunResult> }

let vaultClient: ReturnType<typeof makeVaultClient> | null = null
export const tauriRuleActions: RuleActions = {
  open: (slug) => void openRule(slug),
  veto: (slug) => (vaultClient ??= makeVaultClient(invoke as Invoke)).run('disable-rule', [slug], ''),
}
export const RuleActionsContext = createContext<RuleActions>(tauriRuleActions)

/** `running`, `disabled`, or what `mnemo disable-rule` said when it failed. */
export type Veto = { state: 'running' } | { state: 'disabled' } | { state: 'failed'; message: string }

/** State a card keeps outside itself, so it survives the list unmounting it off screen. */
export type CardsState = {
  rules: RuleActions
  vetoes: Record<string, Veto>
  veto(slug: string): void
  isOpen(key: string): boolean
  toggle(key: string): void
  openImage(img: ImageRef): void
  onOpenTerminal?: () => void
}

export const CardsContext = createContext<CardsState | null>(null)

export function useCards(): CardsState {
  const c = useContext(CardsContext)
  if (!c) throw new Error('a conversation card outside ConversationView')
  return c
}

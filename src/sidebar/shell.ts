import type React from 'react'

/** What the sidebar takes from the wave-B `shell` piece (docs/superpowers/contracts/2026-09-24-orca-redesign-b.md),
 *  which is being built beside this one: `mountInSlot` from `src/shell/slots.ts` and `useShell`
 *  from `src/shell/store.ts`, with the contract's types copied here.
 *
 *  The glob finds those files once they are on the branch, so merging the two pieces wires the
 *  sidebar in with no edit here. Until then it is mounted nowhere and reads the shell's defaults.
 *  Once `shell` is on main this file can shrink to the two re-exports:
 *
 *    export { mountInSlot, type ShellSlot } from '../shell/slots'
 *    export { useShell, type ShellState } from '../shell/store'
 */

export type ShellSlot = 'left-sidebar' | 'right-sidebar' | 'status-bar' | 'titlebar-tabs' | 'titlebar-right' | 'overlay'

export type ShellState = {
  leftOpen: boolean
  rightOpen: boolean
  leftWidth: number
  rightWidth: number
  toggleLeft(): void
  toggleRight(): void
  setLeftWidth(px: number): void
  setRightWidth(px: number): void
}

type SlotsModule = { mountInSlot?: (slot: ShellSlot, component: React.ComponentType) => () => void }
type StoreModule = { useShell?: <T>(sel: (s: ShellState) => T) => T }

const slots = Object.values(import.meta.glob<SlotsModule>('../shell/slots.{ts,tsx}', { eager: true }))[0]
const store = Object.values(import.meta.glob<StoreModule>('../shell/store.{ts,tsx}', { eager: true }))[0]

const DEFAULTS: ShellState = {
  leftOpen: true,
  rightOpen: true,
  leftWidth: 280,
  rightWidth: 320,
  toggleLeft() {},
  toggleRight() {},
  setLeftWidth() {},
  setRightWidth() {},
}

/** Which of the two the glob found: a test holds the shell to the contract's names once it lands. */
export const shellFound = { slots: typeof slots?.mountInSlot === 'function', store: typeof store?.useShell === 'function' }

export const mountInSlot: (slot: ShellSlot, component: React.ComponentType) => () => void =
  slots?.mountInSlot ?? (() => () => {})

export const useShell: <T>(sel: (s: ShellState) => T) => T = store?.useShell ?? ((sel) => sel(DEFAULTS))

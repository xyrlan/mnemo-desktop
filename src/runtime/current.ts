// The runtime that is running, if one is. `./index` answers from it; `./live` sets it. Kept in a
// file of its own, which imports nothing of the app, so the contract's module stays as light as
// the placeholder it replaced: a view's test that imports `canHost` loads no terminal.

import type { ComponentType } from 'react'
import { createStore } from 'zustand/vanilla'
import type { Session } from '../world/types'
import type { Hosted } from './hosting'

export interface Runtime {
  canHost(session: Session): boolean
  /** `LiveTerminal`'s body. */
  Terminal: ComponentType<{ sessionId: string; active: boolean }>
  /** Every terminal the app holds: sessions, shells, commands. */
  hosted(): Hosted[]
  /** Hears what `canHost` and `hosted` answer change. */
  subscribe(fn: () => void): () => void
  /** Gives the keyboard to the terminal on stage; false when there is none. */
  focus(): boolean
}

export const runtimeStore = createStore<{ runtime: Runtime | null }>(() => ({ runtime: null }))

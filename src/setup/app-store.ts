import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useEffect } from 'react'
import { useStore } from 'zustand'
import { makeSetupClient } from './client'
import { createSetupStore, type SetupActions, type SetupState } from './store'
import { managedMnemo } from './tools'

/** The single live store, shared by every setup pane and the launch check.
 *  Kept out of store.ts so tests never import Tauri. */
export const setup = createSetupStore(makeSetupClient(invoke, listen))
export const useSetup = <T,>(sel: (s: SetupState & SetupActions) => T) => useStore(setup, sel)

/** Check again, as both setup screens' button does it: the tools, then, for the mnemo the app
 *  installed, GitHub's latest release once more. A click is the one time it is asked again. */
export async function checkAgain(): Promise<void> {
  const rows = await setup.getState().check()
  if (managedMnemo(rows)) await setup.getState().lookForUpdate(true)
}

/** Asks GitHub once per run, from whichever setup screen first shows the mnemo the app installed. */
export function useLookForUpdate(): void {
  const managed = useSetup((s) => managedMnemo(s.rows))
  useEffect(() => {
    if (managed) void setup.getState().lookForUpdate()
  }, [managed])
}

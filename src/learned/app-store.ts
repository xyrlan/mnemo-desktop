import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useStore } from 'zustand'
import { makeLearnedClient } from './client'
import { createLearnedStore, type LearnedActions, type LearnedState } from './store'

export const learnedClient = makeLearnedClient(invoke, listen)

/** The single live store: the run it starts outlives every pane that shows it.
 *  Kept out of store.ts so tests never import Tauri. */
export const learned = createLearnedStore(learnedClient)
export const useLearned = <T,>(sel: (s: LearnedState & LearnedActions) => T) => useStore(learned, sel)

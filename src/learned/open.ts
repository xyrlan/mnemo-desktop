import { store } from '../layout/app-store'
import { learned } from './app-store'
import { showLearned } from './launch'

/** Opens the review of the repo `cwd` is in: the vault inbox's button and the palette. */
export function reviewWhatWasLearned(cwd: string | undefined) {
  showLearned(store)
  void learned.getState().openCwd(cwd)
}

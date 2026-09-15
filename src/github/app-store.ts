import { useStore } from 'zustand'
import { createGithubStore, type GithubActions, type GithubState } from './store'
import { tauriGithub } from './client'

export const githubStore = createGithubStore(tauriGithub)
export const useGithub = <T,>(sel: (s: GithubState & GithubActions) => T) => useStore(githubStore, sel)

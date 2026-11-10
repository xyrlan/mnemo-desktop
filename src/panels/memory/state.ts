// What the Memory panel keeps of its own while the app runs, and the stores it reads. The ship's
// window kept these inside its view files (`nexus/windows/memory/`: the tab, the picked repo, the
// feed's store, the level's hook); they are here now, and the window's copies are left alone.

import { invoke } from '@tauri-apps/api/core'
import { useEffect, useMemo, useState } from 'react'
import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import { homeStore } from '../../home/app-store'
import { learnedClient } from '../../learned/app-store'
import { getMemoryFeed } from '../../memory/client'
import { useKnownRepos } from '../../nexus/repos'
import { createMemoryStore, type MemoryStore } from '../../rightbar/memory'
import { pollWhileShown } from '../../shell/while-shown'
import { vault } from '../../vault/app-store'
import { agentForCwd } from '../../vault/search'
import { makeLevelClient, type LevelClient } from '../../vaultlevel/client'
import { levelOf, xpOf, type Progress } from '../../vaultlevel/level'
import { pickRepo, type MemoryTab, type Repo } from './model'

type PanelState = {
  tab: MemoryTab
  /** The repo the Memory and Learned panels read for; null until one is picked: the first repo
   *  the app knows stands in. */
  repo: string | null
  /** The project the rules table is narrowed to; null shows every project's. */
  project: string | null
}

/** The tab, the repo and the project, kept while the app runs: a panel closed and opened again
 *  is where it was left. */
export const memoryPanel = createStore<PanelState>(() => ({ tab: 'activity', repo: null, project: null }))

export const showTab = (tab: MemoryTab) => memoryPanel.setState({ tab })
export const chooseRepo = (root: string) => memoryPanel.setState({ repo: root, project: null })
export const chooseProject = (project: string | null) => memoryPanel.setState({ project })

/** Every repo the app knows (the fleet's, Home's, the saved projects) and the one the Memory
 *  and Learned panels read for. Asks for Home's list when nothing has read it yet. */
export function useRepo(): { repos: Repo[]; repo: Repo | null } {
  const repos = useKnownRepos()
  const chosen = useStore(memoryPanel, (s) => s.repo)
  useEffect(() => {
    const home = homeStore.getState()
    if (!home.snapshot.repos.length && !home.loading) void home.load()
  }, [])
  return useMemo(() => ({ repos, repo: pickRepo(repos, chosen) }), [repos, chosen])
}

/** The agent mnemo files `cwd`'s rules under, from the tree when it was read, else from the
 *  agents the rules table has named. */
export function useCurrentAgent(cwd: string): string | undefined {
  const tree = useStore(vault, (s) => s.tree)
  const agents = useStore(vault, (s) => s.agents)
  return useMemo(
    () => agentForCwd(cwd || undefined, tree.length ? tree : agents.map((name) => ({ name, kind: name === 'shared' ? ('shared' as const) : ('repo' as const) }))),
    [cwd, tree, agents],
  )
}

/** The feed of the repo the panel is on: the last briefing, what fired, what was learned, what
 *  waits. Its own store, so what it read is there when the panel opens again. */
export const memoryFeed: MemoryStore = createMemoryStore({
  feed: getMemoryFeed,
  project: (cwd) => learnedClient.project(cwd),
  step: (step, target, keys) => learnedClient.step(step, target, keys),
})

/** How often the feed and the level are read again while the panel shows. */
export const REFRESH_MS = 30_000

const liveLevel = makeLevelClient(invoke)

/** The vault's level, read now and every `pollMs` while the window shows. It reads the best xp
 *  ever recorded, so it never falls. Null until the first read; `'none'` when the vault cannot
 *  be read. */
export function useVaultLevel(client: LevelClient = liveLevel, pollMs = REFRESH_MS): Progress | 'none' | null {
  const [level, setLevel] = useState<Progress | 'none' | null>(null)
  useEffect(() => {
    let live = true
    const tick = async () => {
      try {
        const v = await client.level()
        if (!live) return
        if (!v || v.error) return setLevel('none')
        const best = await client.best(xpOf(v))
        if (live) setLevel(levelOf(best))
      } catch (e) {
        console.warn('memory: vault level not read', e)
      }
    }
    const stop = pollWhileShown(tick, pollMs)
    return () => {
      live = false
      stop()
    }
  }, [client, pollMs])
  return level
}

/** What Esc closes inside the panel, innermost first; false leaves Esc to the panel itself. */
export function innerEscape(tab: MemoryTab): boolean {
  const s = vault.getState()
  if (tab === 'inbox') {
    if (!s.inboxSelected) return false
    s.closeInboxShown()
    return true
  }
  if (tab === 'rules' || tab === 'pages') {
    if (s.selected) s.deselect()
    else if (tab === 'rules' && s.filter) s.setFilter('')
    else if (tab === 'pages' && s.query) s.setQuery('')
    else return false
    return true
  }
  return false
}

/** Opens the page at `path` in the Pages tab. */
export function readPage(path: string): void {
  showTab('pages')
  void vault.getState().select(path)
}

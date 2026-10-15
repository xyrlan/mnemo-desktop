import type { JSX } from 'react'
import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import { useVault, vault } from '../../../vault/app-store'
import { agentForCwd } from '../../../vault/search'
import { openWindow } from '../../ui/windows'
import { Activity } from './Activity'
import { Health } from './Health'
import { Inbox } from './Inbox'
import { Pages } from './Pages'
import { RunLog } from './RunLog'
import { RepoPicker, short, Tabs, useInnerEscape } from './kit'
import { useRepo } from './repo'
import './memory.css'

export type MemoryTab = 'activity' | 'health' | 'pages' | 'inbox'

const TABS = [
  ['activity', 'Activity'],
  ['health', 'Health'],
  ['pages', 'Pages'],
  ['inbox', 'Inbox'],
] as const

/** The tab the window shows, kept while the app runs. */
export const memoryTab = createStore<{ tab: MemoryTab }>(() => ({ tab: 'activity' }))
const setTab = (tab: MemoryTab) => memoryTab.setState({ tab })

/** What Esc closes inside the window, innermost first; false leaves Esc to the window. */
export function innerEscape(tab: MemoryTab): boolean {
  const s = vault.getState()
  if (tab === 'inbox') {
    if (!s.inboxSelected) return false
    s.closeInboxShown()
    return true
  }
  if (tab === 'health' || tab === 'pages') {
    if (s.selected) s.deselect()
    else if (tab === 'health' && s.filter) s.setFilter('')
    else if (tab === 'pages' && s.query) s.setQuery('')
    else return false
    return true
  }
  return false
}

/** The SYSTEMS menu's Memory (spec Q8): what the vault view and the right sidebar's Memory panel
 *  showed. For the repo picked at the top: what happened lately, the rules by heat and what needs
 *  review, the vault's pages by agent, and the inbox, with their actions and what they printed. */
export function MemoryWindow(_: { close: () => void }): JSX.Element {
  const tab = useStore(memoryTab, (s) => s.tab)
  const { repos, repo } = useRepo()
  const tree = useVault((s) => s.tree)
  const agents = useVault((s) => s.agents)
  const root = useVault((s) => s.health?.root ?? null)
  const cwd = repo?.root ?? ''
  // The table never reads the tree: its agents name the repo's agent too.
  const current = agentForCwd(cwd || undefined, tree.length ? tree : agents.map((name) => ({ name, kind: name === 'shared' ? 'shared' : 'repo' })))
  useInnerEscape(() => innerEscape(memoryTab.getState().tab))

  const read = (path: string) => {
    setTab('pages')
    void vault.getState().select(path)
  }
  return (
    <div className="nx-mem" data-memory-window="">
      <div className="nx-mem-head">
        <Tabs tabs={TABS} on={tab} onPick={setTab} label="Memory" />
        <RepoPicker repos={repos} repo={repo} />
        {root && (
          <span className="nx-muted nx-mem-root" title={root}>
            vault {short(root)}
          </span>
        )}
      </div>
      <div className="nx-mem-body">
        {tab === 'activity' && <Activity cwd={repo?.root ?? null} onRead={read} onInbox={() => setTab('inbox')} />}
        {tab === 'health' && <Health cwd={cwd} current={current} onInbox={() => setTab('inbox')} />}
        {tab === 'pages' && <Pages cwd={cwd} current={current} />}
        {tab === 'inbox' && <Inbox cwd={cwd} onLearned={() => openWindow('learned')} />}
      </div>
      <RunLog />
    </div>
  )
}

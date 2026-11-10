// The Memory panel: the vault. For the repo picked at its head: what mnemo did there lately,
// the rules by project with what wants review, the vault's pages by agent, and the inbox; under
// them, what the vault can be asked to do and what each run printed.

import { useStore } from 'zustand'
import { XP_PER_LEVEL } from '../../vaultlevel/level'
import { Ring } from '../../ds'
import { useVault } from '../../vault/app-store'
import { Activity } from './Activity'
import { Inbox } from './Inbox'
import { RepoPicker, short, Tabs, useInnerEscape } from './kit'
import type { MemoryTab } from './model'
import { Pages } from './Pages'
import { Rules } from './Rules'
import { RunBar, RunLog } from './RunLog'
import { chooseRepo, innerEscape, memoryFeed, memoryPanel, showTab, useCurrentAgent, useRepo, useVaultLevel } from './state'
import './memory.css'

/** The vault's level and how far into the next one, as a ring; `no vault` when none can be read. */
function VaultLevel() {
  const level = useVaultLevel()
  if (level === null) return null
  if (level === 'none') {
    return (
      <span className="sp-dim" data-vault-level="none">
        no vault
      </span>
    )
  }
  return (
    <span className="memory-level" data-vault-level={level.level}>
      <Ring value={level.fraction} size={30}>
        <i className="memory-level-core" />
      </Ring>
      <span>
        <span className="memory-level-n mn-num">LV {level.level}</span>
        <span className="sp-dim memory-sub mn-num">
          {level.into}/{XP_PER_LEVEL} to {level.level + 1}
        </span>
      </span>
    </span>
  )
}

export function MemoryPanel() {
  const tab = useStore(memoryPanel, (s) => s.tab)
  const { repos, repo } = useRepo()
  const root = useVault((s) => s.health?.root ?? null)
  const rules = useVault((s) => (s.rulesLoaded ? s.rules.length : null))
  const staged = useStore(memoryFeed, (s) => s.feed?.inbox.length ?? null)
  const cwd = repo?.root ?? ''
  const current = useCurrentAgent(cwd)
  useInnerEscape(() => innerEscape(memoryPanel.getState().tab))

  const tabs = [
    { id: 'activity', name: 'Activity' },
    { id: 'rules', name: 'Rules', count: rules, tone: 'memory' },
    { id: 'pages', name: 'Pages' },
    { id: 'inbox', name: 'Inbox', count: staged, tone: 'need' },
  ] as const
  return (
    <div className="memory sp-root" tabIndex={-1} data-memory-panel="" data-tab={tab}>
      <div className="memory-head">
        <Tabs<MemoryTab> tabs={tabs} on={tab} onPick={showTab} label="Memory" />
        <RepoPicker repos={repos} repo={repo} onPick={chooseRepo} />
        <span className="sp-end memory-vault">
          {root && <span className="sp-dim sp-mono">vault {short(root)}</span>}
          <VaultLevel />
        </span>
      </div>
      <div className="memory-body">
        {tab === 'activity' && <Activity cwd={repo?.root ?? null} />}
        {tab === 'rules' && <Rules cwd={cwd} current={current} />}
        {tab === 'pages' && <Pages cwd={cwd} current={current} />}
        {tab === 'inbox' && <Inbox cwd={cwd} />}
      </div>
      <div className="memory-foot">
        <RunLog />
        <RunBar cwd={cwd} />
      </div>
    </div>
  )
}

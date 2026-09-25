/** The right sidebar's Checks tab. It has no pane view: it lives in `view.tsx` because App
 *  imports every `src/*\/view.tsx`, and that import is where it registers its tab. */
import React, { useMemo } from 'react'
import { ListChecks } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { invoke } from '@tauri-apps/api/core'
import { toast } from '@/ui'
import { register } from '../actions/registry'
import { store as layout, useApp } from '../layout/app-store'
import { fleetStore, useFleet } from '../fleet/store'
import { missionStore, useMission } from '../mission/app-store'
import { tauriMission } from '../mission/client'
import { allChildren } from '../mission/types'
import { ptyPid, tauriPty } from '../pty/client'
import { settingsStore } from '../settings/app-store'
import { shellStore } from '../shell/store'
import { agentCommand } from '../shell/Workbench'
import { openCommit } from '../commit/open'
import { registerRightbarPanel } from '../rightbar/panels'
import { currentWorktree, pickRightbarTab } from '../source-control/live'
import type { Where } from '../browser/grab-agent'
import { destinationOf, sendToAgent, type AgentDeps, type Destination } from './agent'
import { tauriChecks } from './client'
import { ChecksPanel, type Notify } from './ChecksPanel'
import { useLiveChecks } from './live'
import { createChecksStore } from './store'

/** The single live store: what it read survives the tab being switched away and back. */
const checks = createChecksStore(tauriChecks)

/** Design Mode's view of the app (`design-live.ts`), for `worktree`. */
const where = (worktree: string): Where => {
  const s = layout.getState()
  return { worktree, panes: s.panes, repos: fleetStore.getState().repos, children: allChildren(missionStore.getState().snapshot) }
}

const agent: AgentDeps = {
  where,
  sinks: {
    writePty: (pane, data) => tauriPty.write(pane, data),
    reply: (id, t) => tauriMission.reply(id, t),
    paneRunsClaude: async (pane) => {
      const pid = await ptyPid(pane).catch(() => null)
      return pid !== null && (await invoke<boolean>('chrome_claude_running', { panePid: pid }).catch(() => false))
    },
    goToPane: (pane) => layout.getState().goToPane(pane),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  },
  // What "Launch agent" types in an empty worktree, Settings' permission toggle included.
  start: (worktree) => layout.getState().openCommandTab(worktree, agentCommand((settingsStore.getState() as { skipPermissions?: boolean }).skipPermissions)),
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
}

const notify: Notify = { ok: (t) => void toast.success(t), fail: (t) => void toast.error(t) }

/** Where a send would go now, kept current as agents come and go. */
function useDestination(worktree: string | null): Destination {
  const panes = useApp((s) => s.panes)
  const repos = useFleet((f) => f.repos)
  const snapshot = useMission((s) => s.snapshot)
  return useMemo(
    () => (worktree ? destinationOf({ worktree, panes, repos, children: allChildren(snapshot) }) : { kind: 'none', reason: 'no worktree is open' }),
    [worktree, panes, repos, snapshot],
  )
}

function LiveChecks(): React.JSX.Element {
  const view = useApp(useShallow((s) => ({ activeWorktree: s.activeWorktree, activeTab: s.activeTab, tabs: s.tabs, panes: s.panes })))
  const repos = useFleet((f) => f.repos)
  const worktree = currentWorktree(view, repos)
  useLiveChecks(worktree, checks)
  return (
    <ChecksPanel
      worktree={worktree}
      store={checks}
      destination={useDestination(worktree)}
      onSend={(wt, text) => sendToAgent(wt, text, agent)}
      onOpenUrl={(url, title) => layout.getState().openView('browser', { url }, 'auto', title)}
      onCreatePr={openCommit}
      notify={notify}
    />
  )
}

/** After Source Control (400), as Orca orders its right sidebar. */
export const CHECKS_ORDER = 500
const TITLE = 'Checks'

const unregister = registerRightbarPanel({ id: 'checks', title: TITLE, icon: ListChecks, order: CHECKS_ORDER, panel: LiveChecks })

register({
  id: 'checks.show',
  title: 'Checks (CI, pull request, review comments)',
  run: () => {
    if (!shellStore.getState().rightOpen) shellStore.getState().toggleRight()
    pickRightbarTab(TITLE)
  },
})
import.meta.hot?.dispose(unregister)

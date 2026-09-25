import { useMemo } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { toast } from '@/ui'
import { store as layout, useApp } from '../layout/app-store'
import { fleetStore, useFleet } from '../fleet/store'
import { missionStore, useMission } from '../mission/app-store'
import { tauriMission } from '../mission/client'
import { allChildren } from '../mission/types'
import { ptyPid, tauriPty } from '../pty/client'
import type { Where } from '../browser/grab-agent'
import { tauriChecks } from '../checks/client'
import { ChecksPanel, type Notify } from '../checks/ChecksPanel'
import { useLiveChecks } from '../checks/live'
import { createChecksStore } from '../checks/store'
import { destinationOf, sendToAgent, type AgentDeps, type Destination } from '../checks/agent'

/** The detail's Checks: the child's PR and its CI, as the right sidebar's Checks tab shows a
 *  worktree's. A send (Fix, a review comment) goes to the child. Merging is the parent session's
 *  (spec, *Not in this work*), and so is a PR the child has not opened: the panel's merge, ready
 *  and "Create pull request" controls are hidden here (`dispatch.css`). */

/** Its own store: what it read stays when the detail switches child and back. */
const checks = createChecksStore(tauriChecks)

const where = (worktree: string): Where => ({ worktree, panes: layout.getState().panes, repos: fleetStore.getState().repos, children: allChildren(missionStore.getState().snapshot) })

/** A child's worktree has its child: nothing is started there when it is not running. */
const NOT_RUNNING = 'the child is not running: nothing reaches it'

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
  start: () => Promise.reject(new Error(NOT_RUNNING)),
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
}

const notify: Notify = { ok: (t) => void toast.success(t), fail: (t) => void toast.error(t) }

export function ChildChecks({ worktree }: { worktree: string }) {
  const panes = useApp((s) => s.panes)
  const repos = useFleet((f) => f.repos)
  const snapshot = useMission((s) => s.snapshot)
  const destination = useMemo<Destination>(() => {
    const d = destinationOf({ worktree, panes, repos, children: allChildren(snapshot) })
    return d.kind === 'start' ? { kind: 'none', reason: NOT_RUNNING } : d
  }, [worktree, panes, repos, snapshot])
  useLiveChecks(worktree, checks)
  return (
    <div className="dispatch-checks flex min-h-0 flex-1 flex-col">
      <ChecksPanel
        worktree={worktree}
        store={checks}
        destination={destination}
        onSend={(wt, text) => sendToAgent(wt, text, agent)}
        onOpenUrl={(url, title) => layout.getState().openView('browser', { url }, 'auto', title)}
        onCreatePr={() => {}}
        notify={notify}
      />
    </div>
  )
}

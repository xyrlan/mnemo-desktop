import { useMemo } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { store as layout, useApp } from '../layout/app-store'
import { fleetStore, useFleet } from '../fleet/store'
import { missionStore, useMission } from '../mission/app-store'
import { tauriMission } from '../mission/client'
import { allChildren } from '../mission/types'
import { tauriPty } from '../pty/client'
import { makeDesignMode } from './design'
import { deliver, resolveAgent, type AgentTarget } from './grab-agent'
import { cropShot, type Snapshot } from './grab-shot'

/** The app's one Design Mode, wired to the panes' webviews, the fleet and the terminals. The
 *  logic is `makeDesignMode` (`design.ts`), which tests drive without Tauri. */

function where() {
  const s = layout.getState()
  return { worktree: s.activeWorktree, panes: s.panes, repos: fleetStore.getState().repos, children: allChildren(missionStore.getState().snapshot) }
}

export const design = makeDesignMode({
  // The same page eval and snapshot the desktop MCP reads panes with (mcp.rs).
  evaluate: (id, script) => invoke<string>('mcp_browser_eval', { id, script }),
  snapshot: (id) => invoke<Snapshot>('mcp_browser_snapshot', { id }),
  crop: (snap, p) => cropShot(snap, p.target.rectViewport, p.page.viewportWidth),
  save: (id, png) => invoke<string>('browser_save_shot', { id, data: png }),
  target: () => resolveAgent(where()),
  deliver: (target, text, shot) =>
    deliver(target, text, shot, {
      writePty: (pane, data) => tauriPty.write(pane, data),
      reply: (id, t) => tauriMission.reply(id, t),
      goToPane: (pane) => layout.getState().goToPane(pane),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    }),
})

/** Where Send would go now, kept current as agents come and go. */
export function useAgentTarget(): AgentTarget {
  const worktree = useApp((s) => s.activeWorktree)
  const panes = useApp((s) => s.panes)
  const repos = useFleet((f) => f.repos)
  const snapshot = useMission((s) => s.snapshot)
  return useMemo(() => resolveAgent({ worktree, panes, repos, children: allChildren(snapshot) }), [worktree, panes, repos, snapshot])
}

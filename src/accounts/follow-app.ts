import { invoke } from '@tauri-apps/api/core'
import { store as layout } from '../layout/app-store'
import { ptyPid, tauriPty } from '../pty/client'
import { readBuffer } from '../terminal/buffer'
import type { FollowEnv } from './store'

/** Matches a hook's or a row's id against the pane's: `claude agents` may give the first eight
 *  characters only. */
const same = (a: string, b: string) => a === b || (a.length >= 8 && b.startsWith(a)) || (b.length >= 8 && a.startsWith(b))

/** The fleet and the mission snapshot, loaded the first time a switch asks: importing them starts
 *  their polling, which nothing that only reads the accounts should pay for. */
const fleet = () => import('../fleet/store').then((m) => m.fleetStore.getState())
const mission = () => import('../mission/app-store').then((m) => m.missionStore.getState().snapshot)

/** What the follower reads and types in the app: the layout's terminal panes, their screens and
 *  PTYs, the fleet's agent states and the mission snapshot's children. */
export const appFollow: FollowEnv = {
  panes: () =>
    Object.values(layout.getState().panes).flatMap((p) =>
      p.view === 'terminal' && p.id > 0 && p.exitCode === undefined && !p.error && p.sessionId ? [{ id: p.id, sessionId: p.sessionId }] : [],
    ),
  lines: readBuffer,
  write: (pane, data) => tauriPty.write(pane, data),
  runsClaude: async (pane) => {
    const pid = await ptyPid(pane).catch(() => null)
    return pid !== null && (await invoke<boolean>('chrome_claude_running', { panePid: pid }).catch(() => false))
  },
  busy: async (sessionId) =>
    (await fleet()).repos.some((r) =>
      r.worktrees.some((w) => w.agents.some((a) => same(a.sessionId, sessionId) && (a.state === 'working' || a.state === 'needs-you'))),
    ),
  child: async (sessionId) => {
    const snap = await mission()
    // Not read yet: a pane attached to a child cannot be told from a session of its own.
    if (!snap.at) return null
    return snap.repos.some((r) => r.children.some((c) => (c.session_id && same(c.session_id, sessionId)) || same(c.id, sessionId)))
  },
  resumed: (pane, sessionId) => layout.getState().setSessionId(pane, sessionId),
  windows: typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => Date.now(),
}

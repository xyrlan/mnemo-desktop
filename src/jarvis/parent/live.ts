/** `ParentDeps` as the app runs them. Loaded the first time a parent is needed (`createParents`):
 *  importing the drawer and the stores starts their work, which nothing that only names the types
 *  should pay for. */

import { invoke } from '@tauri-apps/api/core'
import { homeDir } from '@tauri-apps/api/path'
import { accountsStore } from '../../accounts/store'
import { DEFAULT_AGENT, type Agent } from '../../agent/active'
import { kindOf } from '../../agent/kind'
import { chatPty } from '../../chat-input/pty'
import { paneRunsClaude } from '../../chrome/running'
import { tauriConversation } from '../../conversation/client'
import { store as layout } from '../../layout/app-store'
import { envOfAccount } from '../../mission/account'
import { missionStore } from '../../mission/app-store'
import { endSession, openSession, paneOf } from '../../nexus/drawer/open'
import type { Host } from './index'
import type { ParentDeps } from './parents'

/** The account a parent on `host` runs on: the active one when it is that host's, else the default
 *  account for Claude (always a Claude one), else the first of the host's. */
function agentFor(host: Host): Agent | null {
  const state = accountsStore.getState().state
  const accounts = state?.accounts ?? []
  const active = accounts.find((a) => a.id === state?.active)
  const pick =
    (active && kindOf(active.kind) === host ? active : null) ??
    accounts.find((a) => kindOf(a.kind) === host && (host !== 'claude' || a.isDefault)) ??
    accounts.find((a) => kindOf(a.kind) === host)
  if (pick) return envOfAccount(pick)
  return host === 'claude' ? DEFAULT_AGENT : null
}

/** The config's `host` (`jarvis.json` in the app's dir, `jarvis.rs`'s `config_path`): the seam has
 *  no command for a section, so the file is read as the editor reads one (`fs_read`). A debug build
 *  keeps its own dir (`app_dir.rs`). No file, or no host in it, is none. */
async function defaultHost(): Promise<Host | null> {
  const home = (await homeDir()).replace(/[\\/]+$/, '')
  const dir = import.meta.env.DEV ? '.mnemo-desktop-dev' : '.mnemo-desktop'
  let text: string
  try {
    text = await invoke<string>('fs_read', { path: `${home}/${dir}/jarvis.json` })
  } catch {
    return null
  }
  const host = (JSON.parse(text) as { host?: unknown }).host
  return host === 'claude' || host === 'grok' ? host : null
}

/** A UUID for `--session-id`, also where the page is not a secure context. */
function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

export const liveDeps: ParentDeps = {
  openSession,
  paneOf,
  endSession,
  runsAgent: paneRunsClaude,
  sendPrompt: (pane, text) => chatPty.sendPrompt(pane, text),
  answerApproval: (pane, allow) => chatPty.answerApproval(pane, allow),
  agentFor,
  defaultHost,
  rows() {
    const s = missionStore.getState().snapshot
    const at = Number(s.at)
    return { rows: s.repos.flatMap((r) => r.parents), at: s.at && Number.isFinite(at) ? at * 1000 : null }
  },
  onRows: (cb) => missionStore.subscribe((s, p) => void (s.snapshot !== p.snapshot && cb())),
  paneAlive(pane) {
    const p = layout.getState().panes[pane]
    return !!p && p.exitCode === undefined && !p.error
  },
  onPanes: (cb) => layout.subscribe((s, p) => void (s.panes !== p.panes && cb())),
  follow: (sessionId, cwd, onEvent, source) => tauriConversation.follow(sessionId, cwd, 200, onEvent, source),
  newId,
  now: Date.now,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
}

import { invoke } from '@tauri-apps/api/core'
import type { PaneId } from '../layout/tree'
import { ptyPid } from '../pty/client'

/** Whether an agent CLI runs under terminal pane `pane`'s shell this moment, Claude Code or Grok
 *  Build's TUI (`or_grok` in `chrome.rs`): the gate before keys are typed into it
 *  (`chrome_claude_running`). False once the shell has exited.
 *
 *  It rejects when the app cannot tell (the process table could not be read, or `claude agents`
 *  answered on no account): that is neither
 *  "running" nor "no longer running", and the person is told it as what it is. */
export async function paneRunsClaude(pane: PaneId): Promise<boolean> {
  const pid = await ptyPid(pane).catch(() => null)
  if (pid === null) return false
  try {
    return await invoke<boolean>('chrome_claude_running', { panePid: pid })
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e)
    throw new Error(`Cannot tell whether Claude is running in that terminal (${why}): nothing was sent`)
  }
}

/** What runs in terminal pane `pane` now (`chrome_pane_runs`, #460): `idle`, its shell is at its
 *  prompt (whatever it left in the background, as powerlevel10k's `gitstatusd`), so no Claude runs
 *  there whatever `claude agents` says; `claude`, a Claude Code session runs there; `other`, a
 *  program has the terminal that `claude agents` does not list as a Claude (another program, or a
 *  Claude still starting); `unknown`, a program has it and nobody could say what. A shell that has
 *  exited is idle.
 *
 *  `claude` is any agent CLI's session, Grok Build's TUI included, and there is no `grok`: what the
 *  drawer does with a pane (keep it as a session's, never end it, never resume it a second time)
 *  is the same for both, and the CLI a session runs on is the row's own (`account_env.kind`) or the
 *  pane's (`Pane.agent`), never what runs in its terminal. */
export type PaneRuns = 'idle' | 'claude' | 'other' | 'unknown'

export async function paneRuns(pane: PaneId): Promise<PaneRuns> {
  const pid = await ptyPid(pane).then(
    (p) => p,
    () => undefined,
  )
  if (pid === null) return 'idle'
  if (pid === undefined) return 'unknown'
  return invoke<PaneRuns>('chrome_pane_runs', { panePid: pid }).catch((): PaneRuns => 'unknown')
}

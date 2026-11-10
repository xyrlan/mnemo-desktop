// `claude stop` on a child's own account. The ship typed it into a drawer tab and left the tab
// open for the maintainer to read. Here it is typed into a terminal of its own that ends with the
// command, so its exit says how it went: a stop that worked leaves nothing behind, and one that
// did not keeps its terminal, where what it printed can be read.

import { stopCmd } from '../mission/account'
import type { ChildSession } from '../mission/types'
import { thenLeave, type Shell } from '../pty/typed'
import type { Did } from './actions'

/** How long the stop gets to end before its terminal is left to the maintainer. */
export const STOP_WAIT_MS = 20_000

export type StopDeps = {
  /** The shell a terminal the app just spawned runs. */
  shell(): Shell
  /** Runs `command` in a terminal the app holds, started in `root`; the terminal's pane. */
  run(root: string, command: string, label: string): Promise<number | null>
  /** The pane's exit code once its shell has ended, or `'running'` after `ms`. */
  exited(pane: number, ms: number): Promise<number | null | 'running'>
  /** Ends the pane and forgets its terminal. */
  end(pane: number): Promise<void>
}

export const stopLabel = (child: Pick<ChildSession, 'id'>) => `stop · ${child.id}`

export async function stopChild(d: StopDeps, root: string, child: ChildSession): Promise<Did> {
  const shell = d.shell()
  const pane = await d.run(root, thenLeave(stopCmd(child, shell), shell), stopLabel(child))
  if (pane === null) return { ok: true, why: 'The stop was typed in a terminal here.' }
  const code = await d.exited(pane, STOP_WAIT_MS)
  if (code === 'running') return { ok: true, why: `The stop was typed and has not ended yet: its terminal (${stopLabel(child)}) is kept.` }
  if (code !== 0) return { ok: false, why: `the stop exited ${code ?? 'on a signal'}: its terminal (${stopLabel(child)}) is kept` }
  await d.end(pane).catch(() => {})
  return { ok: true, why: '' }
}

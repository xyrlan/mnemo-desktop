import { store as layout } from '../layout/app-store'
import { PROMPT_DELAY_MS } from '../layout/store'
import { tauriPty } from '../pty/client'
import type { ChildSession } from '../mission/types'
import { attachCmd, stopCmd } from '../mission/account'

/** Runs `cmd` in a new terminal in the group below the tab you are in (made when there is none),
 *  in `cwd`: the Dispatch tab stays in view above it. A button of the tab was just clicked, so the
 *  tab you are in is the Dispatch tab. (`terminal-cmd` would put it over the tab instead: its
 *  placeholder's group is gone by the time the terminal lands.) */
export async function runBelow(cmd: string, cwd: string) {
  const before = new Set(Object.keys(layout.getState().panes))
  await layout.getState().split('col', cwd)
  const pane = Object.keys(layout.getState().panes)
    .map(Number)
    .find((p) => p > 0 && !before.has(String(p)))
  if (pane !== undefined) setTimeout(() => void tauriPty.write(pane, `${cmd}\n`), PROMPT_DELAY_MS)
}

/** Take over: `claude attach` to the child on its own account, under the tab. */
export const takeOver = (c: ChildSession) => runBelow(attachCmd(c), c.cwd)
/** Stop: `claude stop` the child on its own account, under the tab. */
export const stopChild = (c: ChildSession) => runBelow(stopCmd(c), c.cwd)

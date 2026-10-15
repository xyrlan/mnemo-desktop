/** The desktop MCP's tools as the app runs them: the Nexus's sessions, read from the drawer, the
 *  session host and the layout store (the session registry). */
import { store as layout } from '../layout/app-store'
import { DEFAULT_COLS, DEFAULT_ROWS } from '../layout/store'
import { nexusStore } from '../nexus/store'
import { sessionHost } from '../session/app-host'
import { readBuffer } from '../terminal/buffer'
import { sessionsOf, type McpSession } from './sessions'
import { readUnseen, terminalReader, xtermEmulator } from './unseen'

/** What `desktop_list_panes` lists: the drawer's tabs, then the terminals the app runs that no tab
 *  shows. */
export function listSessions(): McpSession[] {
  const n = nexusStore.getState()
  return sessionsOf({
    tabs: n.tabs,
    activeTab: n.activeTab,
    collapsed: n.collapsed,
    open: n.open,
    hosted: sessionHost.getState().sessions,
    panes: layout.getState().panes,
  })
}

/** What `desktop_terminal_read` reads: any terminal of a session, shown or not. */
export const readTerminal = terminalReader({
  shown: readBuffer,
  unseen: (id) => layout.getState().panes[id]?.offscreen === true,
  readUnseen: (id) => readUnseen(id, { layout, emulator: xtermEmulator, cols: DEFAULT_COLS, rows: DEFAULT_ROWS, timeoutMs: 5_000 }),
})

import { invoke } from '@tauri-apps/api/core'
import { toast } from '@/ui'
import { homeStore } from '../../home/app-store'
import { sessionAgent } from '../../home/types'
import { commandsFor } from '../../quick-commands/commands'
import { settingsStore } from '../../settings/app-store'
import { runAction } from '../command/actions'
import { endSession, openSession, paneOf } from '../drawer/open'
import { nexusStore } from '../store'
import type { Ship } from '../ship-types'
import { confirm } from '../ui/confirm'
import type { MenuContext, MenuItem, MenuTarget } from '../ui/menus'
import { openWindow } from '../ui/windows'
import { makeShipMenu, type MenuDeps } from './menu'

/** Repo `root`'s saved commands, as PROJECTS finds them (`commandsFor`). */
const savedCommands = (root: string) => commandsFor(settingsStore.getState().quickCommands, root)

/** The menus' paths, the app's own. */
export const appMenuDeps: MenuDeps = {
  openSession,
  paneOf,
  // Home lists every session of every account, Grok's with their home.
  agentOf: (id) => sessionAgent(homeStore.getState().snapshot, id),
  endSession,
  confirm,
  runAction,
  openWindow,
  // The system browser (Q6: a link opens outside the app), as a browser pane's ↗ does.
  openUrl: (url) => invoke<void>('browser_open_external', { url }),
  copy: (text) => navigator.clipboard.writeText(text),
  savedCommands,
  log: (events) => nexusStore.getState().appendLog(events),
  say: (text, error) => void (error ? toast.error(text) : toast(text)),
}

const provider = makeShipMenu(appMenuDeps)

/** The ship's right-click menus: a captain's, a robot's, a deck's or a dock's. */
export function shipMenu(target: MenuTarget, ship: Ship, ctx: MenuContext): MenuItem[] {
  return provider(target, ship, ctx)
}

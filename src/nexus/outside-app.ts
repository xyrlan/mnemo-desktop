import { invoke } from '@tauri-apps/api/core'
import { externalUrl } from '../browser/open'
import { openSession } from './drawer/open'
import { setNexusRoutes } from './outside'
import { nexusStore } from './store'
import { openWindow } from './ui/windows'
import { memoryTab } from './windows/memory/MemoryWindow'
import { inTerminal } from './windows/setup/terminal'

/** The Nexus's routes for what the workbench's paths open while it is open (`./outside`): a
 *  terminal in a drawer tab, a page in the system browser, the vault's pages in Memory. */
export const unsetNexusRoutes = setNexusRoutes(
  {
    terminal: (cwd, command, label) => (cwd ? openSession({ kind: 'command', root: cwd, command, label }) : inTerminal(command, label)),
    async page(url) {
      const target = externalUrl(url)
      if (!target) throw new Error(`not a web page: ${url}`)
      await invoke<void>('browser_open_external', { url: target })
    },
    pages() {
      memoryTab.setState({ tab: 'pages' })
      openWindow('memory')
    },
  },
  () => nexusStore.getState().open,
)

import.meta.hot?.dispose(unsetNexusRoutes)

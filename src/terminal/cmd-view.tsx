import { useEffect } from 'react'
import { registerPaneView, type PaneViewProps } from '../panes/registry'
import { store } from '../layout/app-store'
import TerminalPane from './view'

/** A terminal pane that types one command on open (used for `claude attach <id>`).
 *  It is a normal terminal afterwards. */
function TerminalCmd(p: PaneViewProps) {
  const cmd = String(p.props.cmd ?? '')
  useEffect(() => {
    // The pane has a negative synthetic id (openView); swap it for a real PTY pane
    // by replacing this leaf with a terminal split and typing the command.
    const s = store.getState()
    const tab = s.tabs.find((t) => t.id === s.activeTab)
    if (!tab) return
    void (async () => {
      await s.split('row')
      const fresh = store.getState().tabs.find((t) => t.id === tab.id)?.focused
      if (fresh && fresh > 0) {
        const { tauriPty } = await import('../pty/client')
        // Give the shell a moment to print its prompt before the command lands.
        window.setTimeout(() => void tauriPty.write(fresh, cmd + '\n'), 700)
      }
      // Close this placeholder pane (focus back to it first).
      store.getState().focusPane(p.id)
      void store.getState().closePane()
    })()
  }, [cmd, p.id])
  return <div className="pane-message">opening {cmd}…</div>
}

registerPaneView('terminal-cmd', TerminalCmd)
export { TerminalPane }

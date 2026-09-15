import { useEffect } from 'react'
import { registerPaneView, type PaneViewProps } from '../panes/registry'
import { store } from '../layout/app-store'
import TerminalPane from './view'

/** A terminal pane that types one command on open (used for `claude attach <id>`).
 *  It is a normal terminal afterwards. */
function TerminalCmd(p: PaneViewProps) {
  const cmd = String(p.props.cmd ?? '')
  useEffect(() => {
    // The pane has a negative synthetic id (openView); open a real terminal tab that types
    // the command, then close this placeholder.
    const s = store.getState()
    const sessionId = typeof p.props.sessionId === 'string' ? p.props.sessionId : undefined
    void s.openCommandTab(s.panes[p.id]?.cwd, cmd, sessionId)
    s.focusPane(p.id)
    void s.closePane()
  }, [cmd, p.id])
  return <div className="pane-message">opening {cmd}…</div>
}

registerPaneView('terminal-cmd', TerminalCmd)
export { TerminalPane }

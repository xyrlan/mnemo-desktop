import { registerPaneView } from '../panes/registry'
import { register } from '../actions/registry'
import { store } from '../layout/app-store'
import Cockpit from './Cockpit'
import { JobLog } from './JobLog'

registerPaneView('cockpit', Cockpit)
// A job's log promoted out of its drawer: the same log, not a second run.
registerPaneView('job-log', ({ props }) => (
  <div className="pane-body cockpit">
    <JobLog id={String(props.job)} />
  </div>
))

export const openCockpit = () => store.getState().openView('cockpit', {}, 'auto', 'cockpit')

register({ id: 'cockpit.open', title: 'Open cockpit (what needs you)', shortcut: '⌘⇧B', run: openCockpit })

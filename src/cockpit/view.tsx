import { registerPaneView } from '../panes/registry'
import { JobLog } from './JobLog'

// A job's log in a pane of its own (the PR view's merge opens it): the same log, not a second run.
registerPaneView('job-log', ({ props }) => (
  <div className="pane-body job-log">
    <JobLog id={String(props.job)} />
  </div>
))

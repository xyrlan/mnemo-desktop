import { registerPaneView } from '../panes/registry'
import { register } from '../actions/registry'
import { store } from '../layout/app-store'
import Cockpit from './Cockpit'

registerPaneView('cockpit', Cockpit)

export const openCockpit = () => store.getState().openView('cockpit', {}, 'auto', 'cockpit')

register({ id: 'cockpit.open', title: 'Open cockpit (what needs you)', shortcut: '⌘⇧B', run: openCockpit })

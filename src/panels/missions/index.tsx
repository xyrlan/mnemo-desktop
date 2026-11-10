import { register } from '../projects/register'
import { MissionsPanel } from './MissionsPanel'

export { MissionsPanel }

register({ id: 'missions', title: 'Missions', hint: 'Issues and pull requests, what you dispatched, what can land', Component: MissionsPanel })

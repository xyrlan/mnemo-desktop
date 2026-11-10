import { register } from '../projects/register'
import { ChangesPanel } from './ChangesPanel'

export { ChangesPanel }

register({ id: 'changes', title: 'Changes', hint: 'What the selected session changed, file by file', size: 'wide', Component: ChangesPanel })

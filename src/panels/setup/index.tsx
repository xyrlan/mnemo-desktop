import { register } from '../memory/register'
import { SetupPanel } from './Setup'

export { SetupPanel }

register({ id: 'setup', title: 'Setup', hint: 'what the app runs, where it found it, and installing what is missing', Component: SetupPanel })

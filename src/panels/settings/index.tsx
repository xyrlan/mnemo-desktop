import { register } from '../memory/register'
import { SettingsPanel } from './Settings'

export { SettingsPanel }

register({ id: 'settings', title: 'Settings', hint: 'saved as you choose', Component: SettingsPanel })

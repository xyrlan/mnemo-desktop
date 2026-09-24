/** Onboarding mounts itself in the shell's overlay slot and gives ⌘K a way back to it. The launch
 *  checks that open it live with what they check: `src/setup/view.tsx` and `src/learned/view.tsx`. */
import { register } from '../actions/registry'
import { mountInSlot } from '../shell/slots'
import { onboarding } from './app-store'
import { Onboarding } from './Onboarding'

mountInSlot('overlay', Onboarding)

register({ id: 'onboarding.open', title: 'Onboarding: setup, then what mnemo learned', run: () => onboarding.getState().show('setup') })

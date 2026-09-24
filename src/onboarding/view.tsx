/** Onboarding mounts itself in the shell's overlay slot and gives ⌘K a way back to it. The launch
 *  checks that open it live with what they check: `src/setup/view.tsx` and `src/learned/view.tsx`. */
import { register } from '../actions/registry'
import { onboarding } from './app-store'
import { Onboarding } from './Onboarding'
import { mountInSlot } from './slot'

// Once per app run, not once per hot reload: a second mount would draw a second dialog.
const hot = import.meta.hot?.data as { onboardingMounted?: boolean } | undefined
if (!hot?.onboardingMounted) {
  if (hot) hot.onboardingMounted = true
  mountInSlot('overlay', Onboarding)
}

register({ id: 'onboarding.open', title: 'Onboarding: setup, then what mnemo learned', run: () => onboarding.getState().show('setup') })

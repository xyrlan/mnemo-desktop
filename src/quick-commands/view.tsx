// Quick commands mount themselves (App.tsx imports every `src/*/view.tsx`): the button in the
// shell's `titlebar-right` slot, and `quick-commands.open` for the palette.
import { all, register } from '../actions/registry'
import { mountInSlot } from '../shell/slots'
import { uiStore } from './app-ui'
import QuickCommands from './QuickCommands'

// The registry has no unregister: a hot reload must not add the action a second time.
if (!all().some((a) => a.id === 'quick-commands.open')) {
  register({ id: 'quick-commands.open', title: 'Quick commands', run: () => uiStore.getState().setMenuOpen(true) })
}
const unmount = mountInSlot('titlebar-right', QuickCommands)
import.meta.hot?.dispose(unmount)

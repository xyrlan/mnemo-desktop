// The left sidebar mounts itself (App.tsx imports every `src/*/view.tsx`): into the shell's
// `left-sidebar` slot, with `worktree.go.1` … `worktree.go.9` registered for the keymap.
import LeftSidebar from './Sidebar'
import { registerSidebarActions } from './actions'
import { mountInSlot } from './upstream'

registerSidebarActions()
const unmount = mountInSlot('left-sidebar', LeftSidebar)
import.meta.hot?.dispose(unmount)

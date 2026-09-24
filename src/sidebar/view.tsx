// The left sidebar mounts itself (App.tsx imports every `src/*/view.tsx`): into the shell's
// `left-sidebar` slot, its dialogs into the `overlay`, with `worktree.go.1` … `worktree.go.9` and
// `worktree.cleanup` registered for the keymap.
import LeftSidebar from './Sidebar'
import ArchiveOverlay from './ArchiveOverlay'
import { registerSidebarActions } from './actions'
import { mountInSlot } from './upstream'

registerSidebarActions()
const unmountSidebar = mountInSlot('left-sidebar', LeftSidebar)
const unmountOverlay = mountInSlot('overlay', ArchiveOverlay)
import.meta.hot?.dispose(() => {
  unmountSidebar()
  unmountOverlay()
})

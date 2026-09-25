// The left sidebar mounts itself (App.tsx imports every `src/*/view.tsx`): into the shell's
// `left-sidebar` slot, its dialogs into the `overlay`, with `worktree.go.1` … `worktree.go.9` and
// `worktree.cleanup` registered for the keymap. Its cards draw with the Dispatch tab's routes.
import LeftSidebar from './Sidebar'
import ArchiveOverlay from './ArchiveOverlay'
import { registerSidebarActions } from './actions'
import { DispatchContext, dispatchRoutes } from './dispatch'
import { mountInSlot } from './upstream'

function RoutedSidebar() {
  return (
    <DispatchContext.Provider value={dispatchRoutes}>
      <LeftSidebar />
    </DispatchContext.Provider>
  )
}

registerSidebarActions()
const unmountSidebar = mountInSlot('left-sidebar', RoutedSidebar)
const unmountOverlay = mountInSlot('overlay', ArchiveOverlay)
import.meta.hot?.dispose(() => {
  unmountSidebar()
  unmountOverlay()
})

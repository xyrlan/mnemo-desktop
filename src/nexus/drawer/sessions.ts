import type { StoreApi } from 'zustand/vanilla'
import type { Target } from '../../mission/account'
import type { PaneId } from '../../pty/client'
import { sessionKey, type SessionHost, type SessionKey, type SessionRef } from '../../session/host'
import type { DrawerTab, NexusState } from '../store'

/** The drawer as a presentation of the session host (`src/session/host.ts`): a tab holds its
 *  session from the click that opens it to the × that closes it. Collapsing, hiding a tab or
 *  closing the Nexus lets nothing go. Holds and releases happen here, in actions, never in a
 *  view's effects: StrictMode runs those twice, and each run would start an attach. */

/** The name the drawer holds its sessions under. */
export const BY = 'nexus-drawer'

/** What a tab's terminal view calls itself (`props.name`): `owners[pty].name` says whether it owns
 *  the session. */
export const viewName = (tabId: string) => `${BY}:${tabId}`

export type Drawer = {
  /** Opens `tab`, holding `ref` for it; a figure that has a tab already is shown. A tab that showed
   *  a conversation read-only takes the live session once there is one, and a tab showing a pane
   *  takes the other pane it is given (a captain resumed in a new pane after its Claude exited in
   *  the tab's), in its place, letting the old one go. */
  open(tab: DrawerTab, ref: SessionRef | null): void
  /** Closes tab `id` and lets its session go; a pane's session no tab shows any more is handed to
   *  `Workbench.letGo`. */
  close(id: string): Promise<void>
  /** Expands or collapses; the tabs stay held. */
  toggle(): void
  /** *Open as tab*: tab `id`'s session in the workbench, the Nexus closed. A pane's session is
   *  revealed in its pane, and the tab keeps it. A child's attach is let go and the child attached
   *  in a workbench tab instead: one attach, not two. */
  reveal(id: string, child: Target | null): Promise<void>
  dispose(): void
}

/** What *open as tab* does in the workbench. */
export type Workbench = {
  goToPane(id: PaneId): void
  /** `claude attach` to the child on its account, in a new tab. */
  attach(child: Target): void
  closeNexus(): void
  /** Pane `pane`'s session is shown by no tab any more: an offscreen pane with nothing to come
   *  back to ends (`start.ts`). */
  letGo?(pane: PaneId): void
}

export function createDrawer(host: SessionHost, store: StoreApi<NexusState>, workbench: Workbench): Drawer {
  // A session the host no longer has (its pane closed, its attach ended) takes its tab.
  const unwatch = host.subscribe((h) => {
    for (const t of store.getState().tabs) if (t.key !== null && !h.sessions[t.key]) store.getState().removeTab(t.id)
  })
  /** No tab shows session `key` any more: it is let go. Another tab may show the same session (a
   *  captain's pane opened from two figures): it keeps it. */
  async function letGo(key: SessionKey | null) {
    if (key === null || store.getState().tabs.some((t) => t.key === key)) return
    const session = host.getState().sessions[key]
    await host.getState().release(key, BY)
    if (session?.kind === 'pane' && session.pty !== null) workbench.letGo?.(session.pty)
  }

  const drawer: Drawer = {
    open(tab, ref) {
      const had = store.getState().tabs.find((t) => t.id === tab.id)
      const moved = had?.key?.startsWith('pane:') && ref !== null && 'pane' in ref && sessionKey(ref) !== had.key
      if (had && !moved && (had.key !== null || ref === null)) return store.getState().activateTab(tab.id)
      const key = ref ? host.getState().hold(ref, BY) : null
      store.getState().putTab({ ...tab, key, readOnly: key === null ? tab.readOnly : null })
      if (moved) void letGo(had.key)
    },

    async close(id) {
      const tab = store.getState().tabs.find((t) => t.id === id)
      if (!tab) return
      store.getState().removeTab(id)
      await letGo(tab.key)
    },

    toggle() {
      const s = store.getState()
      if (s.tabs.length) s.setCollapsed(!s.collapsed)
    },

    async reveal(id, child) {
      const tab = store.getState().tabs.find((t) => t.id === id)
      const session = tab?.key ? host.getState().sessions[tab.key] : undefined
      if (!tab || !session) return
      if (session.kind === 'pane' && session.pty !== null) {
        workbench.closeNexus()
        workbench.goToPane(session.pty)
        return
      }
      if (session.kind !== 'attach' || child === null) return
      workbench.closeNexus()
      await drawer.close(id)
      workbench.attach(child)
    },

    dispose: unwatch,
  }
  return drawer
}

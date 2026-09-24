import { subscribeAgentEvents } from '../agents/events'
import { notifyAgent } from '../agents/notify'
import { fleetStore } from '../fleet/store'
import { store as layout } from '../layout/app-store'
import { leaves } from '../layout/tree'
import { mountInSlot } from '../shell/slots'
import { NotificationStack } from './NotificationStack'
import { createNotifier } from './notifier'
import { chime } from './sound'

// Imported by `App.tsx`'s view glob: the one notifier of the app run, and its stack in the shell.

let focused = typeof document !== 'undefined' && document.hasFocus()

export const notifier = createNotifier({
  subscribe: subscribeAgentEvents,
  repos: () => fleetStore.getState().repos,
  active: () => layout.getState().activeWorktree,
  shownPanes: () => layout.getState().tabs.flatMap((t) => leaves(t.root)),
  focused: () => focused,
  onLook(cb) {
    const onFocus = () => ((focused = true), cb())
    const onBlur = () => void (focused = false)
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)
    const offs = [
      layout.subscribe((s, p) => void ((s.activeWorktree !== p.activeWorktree || s.tabs !== p.tabs) && cb())),
      fleetStore.subscribe((s, p) => void (s.repos !== p.repos && cb())),
    ]
    return () => {
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('blur', onBlur)
      offs.forEach((off) => off())
    }
  },
  native: notifyAgent,
  sound: () => chime(),
  switchTo(worktree, pane) {
    void (async () => {
      if (worktree !== null) {
        await layout.getState().switchWorktree(worktree)
        fleetStore.getState().markRead(worktree)
      }
      if (pane !== null) layout.getState().goToPane(pane)
    })()
  },
  now: () => Date.now(),
})

function Notifications() {
  return <NotificationStack notifier={notifier} />
}

mountInSlot('overlay', Notifications)

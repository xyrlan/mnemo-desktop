import { subscribeAgentEvents } from '../agents/events'
import { notifyAgent } from '../agents/notify'
import { fleetStore, subscribePolledMoves } from '../fleet/store'
import { missionStore } from '../mission/app-store'
import { openFigure } from '../nexus/outside'
import { nexusStore } from '../nexus/store'
import { mountInSlot } from '../shell/slots'
import { figureOf, shownSession } from './decide'
import { NotificationStack } from './NotificationStack'
import { createNotifier } from './notifier'
import { chime } from './sound'

// Imported by `App.tsx`'s view glob: the one notifier of the app run, and its stack in the shell.

let focused = typeof document !== 'undefined' && document.hasFocus()

export const notifier = createNotifier({
  subscribe: subscribeAgentEvents,
  polled: subscribePolledMoves,
  repos: () => fleetStore.getState().repos,
  shown: () => shownSession(nexusStore.getState(), fleetStore.getState().repos),
  focused: () => focused,
  onLook(cb) {
    const onFocus = () => ((focused = true), cb())
    const onBlur = () => void (focused = false)
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)
    const offs = [
      nexusStore.subscribe((s, p) => void ((s.open !== p.open || s.collapsed !== p.collapsed || s.activeTab !== p.activeTab || s.tabs !== p.tabs) && cb())),
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
  // Its figure in the Nexus (Q14): a dispatched child's robot, else its captain. What it said is
  // seen once it is on screen.
  open(sessionId, worktree) {
    if (openFigure(figureOf(missionStore.getState().snapshot, sessionId)) && worktree !== null) fleetStore.getState().markRead(worktree)
  },
  now: () => Date.now(),
})

function Notifications() {
  return <NotificationStack notifier={notifier} />
}

mountInSlot('overlay', Notifications)

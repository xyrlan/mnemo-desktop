import { register } from '../actions/registry'
import { store as layout } from '../layout/app-store'
import { fleetStore } from '../fleet/store'
import { missionStore } from '../mission/app-store'
import { dispatchRoutes, openChildSession } from '../sidebar/dispatch'
import { AgentDashboardDrawer } from './AgentDashboardDrawer'
import { mountInSlot, useLeftEdge } from './shell'
import { dashboardStore } from './store'

const openChild = (sessionId: string) => openChildSession(dispatchRoutes, missionStore.getState().snapshot, sessionId)

/** The dashboard as the app mounts it: `App.tsx` imports every `src/<dir>/view.tsx`, and this one
 *  puts the drawer in the shell's overlay slot and gives the app `dashboard.toggle` (the left
 *  sidebar's Agent Dashboard entry runs it). A dispatched child's card opens its parent's
 *  Dispatch tab. */
function Dashboard() {
  const leftEdge = useLeftEdge()
  return <AgentDashboardDrawer fleet={fleetStore} layout={layout.getState} openChild={openChild} leftEdge={leftEdge} />
}

register({ id: 'dashboard.toggle', title: 'Agent dashboard', run: () => dashboardStore.getState().toggle() })

mountInSlot('overlay', Dashboard)

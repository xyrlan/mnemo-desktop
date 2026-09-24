import { register } from '../actions/registry'
import { store as layout } from '../layout/app-store'
import { fleetStore } from '../fleet/store'
import { AgentDashboardDrawer } from './AgentDashboardDrawer'
import { mountInSlot, useLeftEdge } from './shell'
import { dashboardStore } from './store'

/** The dashboard as the app mounts it: `App.tsx` imports every `src/<dir>/view.tsx`, and this one
 *  puts the drawer in the shell's overlay slot and gives the app `dashboard.toggle` (the left
 *  sidebar's Agent Dashboard entry runs it). */
function Dashboard() {
  const leftEdge = useLeftEdge()
  return <AgentDashboardDrawer fleet={fleetStore} layout={layout.getState} leftEdge={leftEdge} />
}

register({ id: 'dashboard.toggle', title: 'Agent dashboard', run: () => dashboardStore.getState().toggle() })

mountInSlot('overlay', Dashboard)

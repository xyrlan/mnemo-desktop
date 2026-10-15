import { registerWindow } from '../../ui/windows'
import { MissionsWindow } from './MissionsWindow'

/** MISSIONS in the ship's bar opens it (`openWindow('missions', { root? })`). */
registerWindow({
  id: 'missions',
  title: 'Missions',
  width: 920,
  render: (params, close, ctx) => <MissionsWindow root={typeof params.root === 'string' ? params.root : undefined} close={close} open={ctx.open} />,
})

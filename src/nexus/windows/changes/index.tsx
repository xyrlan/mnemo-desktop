import { registerWindow } from '../../ui/windows'
import { ChangesWindow } from './ChangesWindow'

export { ChangesWindow, type ChangesWindowProps } from './ChangesWindow'

const text = (v: unknown) => (typeof v === 'string' ? v : '')

/** A robot's menu and its drawer tab open it: `openWindow('changes', { robotId, worktree, label })`.
 *  As wide as the screen allows, since a diff reads in long lines. */
registerWindow({
  id: 'changes',
  title: 'Changes',
  width: 1280,
  render: (p, close) => <ChangesWindow robotId={text(p.robotId)} worktree={text(p.worktree)} label={text(p.label)} close={close} />,
})

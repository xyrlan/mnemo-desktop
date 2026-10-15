import { registerWindow } from '../../ui/windows'
import { LearnedWindow } from './LearnedWindow'

export { LearnedWindow }

registerWindow({ id: 'learned', title: 'What mnemo learned', group: 'systems', order: 20, width: 760, render: (_, close) => <LearnedWindow close={close} /> })

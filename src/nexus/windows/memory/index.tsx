import { registerWindow } from '../../ui/windows'
import { MemoryWindow } from './MemoryWindow'

export { MemoryWindow }

registerWindow({ id: 'memory', title: 'Memory', group: 'systems', order: 10, width: 1120, render: (_, close) => <MemoryWindow close={close} /> })

import { MemoryPanel } from './Memory'
import { register } from './register'

export { MemoryPanel }

register({ id: 'memory', title: 'Memory', hint: 'the vault: what mnemo holds, gave and learned', size: 'wide', Component: MemoryPanel })

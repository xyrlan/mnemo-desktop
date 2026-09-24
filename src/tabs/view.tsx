import type { ComponentType } from 'react'
import TabStrip from './TabStrip'

type ShellSlots = { mountInSlot?: (slot: 'titlebar-tabs', component: ComponentType) => () => void }

// The strip lives in the titlebar, in the `titlebar-tabs` slot the shell exposes
// (`mountInSlot` from src/shell/slots.ts). Found through a glob rather than imported: the shell
// is built beside this piece, and until it lands the glob finds nothing and nothing mounts,
// where a static import of a missing module would break the build. Once it lands it mounts
// with no edit on either side.
const shell = Object.values(import.meta.glob<ShellSlots>('../shell/slots.ts', { eager: true }))[0]
shell?.mountInSlot?.('titlebar-tabs', TabStrip)

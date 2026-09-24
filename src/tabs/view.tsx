import { mountInSlot } from '../shell/slots'
import TabStrip from './TabStrip'

// The strip lives in the titlebar, in the shell's `titlebar-tabs` slot.
mountInSlot('titlebar-tabs', TabStrip)

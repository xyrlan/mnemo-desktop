import { mountInSlot } from '../shell/slots'
import StatusBar from './StatusBar'

/** Puts the status bar in the shell's `status-bar` slot; returns the unmount. */
export const mountStatusBar = () => mountInSlot('status-bar', StatusBar)

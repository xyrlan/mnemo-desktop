/** Mounts the pet in the shell's overlay slot. Imported by `App.tsx`'s glob. */
import { mountInSlot } from '../shell/slots'
import Pet from './Pet'

mountInSlot('overlay', Pet)

import { mountInSlot } from '../shell/slots'
import { nextFront } from './flag'
import { Frame } from './Frame'

// `App.tsx` imports every `src/<dir>/view.tsx`. The new front takes the overlay slot when the
// flag asks for it; `src/nexus/view.tsx` stands down on the same flag.
if (nextFront()) mountInSlot('overlay', Frame)

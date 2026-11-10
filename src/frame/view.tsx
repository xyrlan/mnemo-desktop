import { mountInSlot } from '../shell/slots'
import { NewFront } from './Guard'
import { presenceIn, setJames } from './james'

// `App.tsx` imports every `src/<dir>/view.tsx`: this one puts the frame in the overlay slot.
// James's presence is the overlays piece's; the glob wires it in where that piece is.
setJames(presenceIn(import.meta.glob('../jarvis/panel/index.ts', { eager: true })))
mountInSlot('overlay', NewFront)

import { mountInSlot } from '../shell/slots'
import { nextFront } from './flag'
import { NewFront } from './Guard'
import { presenceIn, setJames } from './james'

// `App.tsx` imports every `src/<dir>/view.tsx`. The new front takes the overlay slot unless
// the flag asks for the ship; `src/nexus/view.tsx` stands down on the same flag.
if (nextFront()) {
  // James's presence is the overlays piece's. Where that piece is not on the branch the glob
  // finds nothing and the top bar has no James; once it is, this wires itself.
  setJames(presenceIn(import.meta.glob('../jarvis/panel/index.ts', { eager: true })))
  mountInSlot('overlay', NewFront)
}

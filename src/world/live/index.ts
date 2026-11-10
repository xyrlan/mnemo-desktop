// The live world: this machine's sessions, put together from what the core answers. Not built
// yet: it says so, and the frame shows the words.

import { EMPTY } from '../store'
import type { World } from '../types'

/** Start keeping the world current and hand each new one to `set`. Returns how to stop. */
export function startLive(set: (world: World) => void): () => void {
  set({ ...EMPTY, at: Date.now(), errors: ['The live world is not built yet: open with ?world=sample.'] })
  return () => {}
}

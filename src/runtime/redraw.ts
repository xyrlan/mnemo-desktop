// `canHost` is read in a render, and a view draws again only when the world or the route does.
// Its answer can change with neither: the runtime has just started (the stage was drawn first,
// with a transcript), or a terminal was found to run nothing. When the answer for the session on
// stage changes while that session stays on stage, the world is handed over again as it is: the
// same sessions, so nothing is rebuilt, and whoever reads the world looks again. A view that
// hears the runtime itself (`useCanHost`) needs none of this.

import type { Session } from '../world/types'

export type RedrawDeps = {
  /** The session on Console's stage, if one is. */
  staged(): Session | undefined
  canHost(session: Session): boolean
  /** Hands the world over again, unchanged. */
  again(): void
}

/** Returns the look to run whenever what `canHost` answers may have changed. */
export function createRedraw(d: RedrawDeps): () => void {
  // Before the first look nothing could be hosted, whoever was on stage.
  let id: string | null | undefined
  let can = false
  return () => {
    const s = d.staged()
    const now = s ? d.canHost(s) : false
    const same = id === undefined || (s?.id ?? null) === id
    const flipped = now !== can
    id = s?.id ?? null
    can = now
    // Another session came on stage: the route's change draws it.
    if (same && flipped) d.again()
  }
}

/** What a card's click opens: the session on Console's stage. The runtime sets how a figure
 *  opens when the world is live (`src/runtime/live.ts`), and where nothing did (the sample
 *  world, or a runtime not up yet) a session the world knows is put on stage here. */
export type OpenDeps = {
  /** Opens the session's figure as the runtime does (`openFigure`); false when it cannot. */
  figure(): boolean
  /** The world's id for the session, or null when the world does not have it. */
  known(): string | null
  /** Puts a session on the stage (`openOnStage`). */
  stage(id: string): void
}

/** Opens the session. False when there was nothing to open. */
export function openSession({ figure, known, stage }: OpenDeps): boolean {
  if (figure()) return true
  const id = known()
  if (id === null) return false
  stage(id)
  return true
}

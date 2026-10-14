import type { Archive, Nexus, Robot } from './types'

/** What a click does (spec Q15): a nexus shows its session's terminal (a dead one offers
 *  `claude --resume`; one alive outside the app is only named, never opened twice); a robot is
 *  `claude attach`ed; an archive opens its project's Memory panel. The drawer closes after.
 *
 *  Stubs until the `interact` piece lands. */
export function openNexus(_nexus: Nexus): void {}

export function openRobot(_robot: Robot): void {}

export function openArchive(_root: string, _archive: Archive): void {}

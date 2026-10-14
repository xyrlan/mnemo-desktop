import type { Snapshot } from '../mission/types'
import type { ArchiveCounts, World } from './types'

/** The snapshot as a world (spec Q5, Q12, Q18, Q25): one territory per repo, one nexus per live
 *  session that is not a dispatched child (and per dead parent whose children still live), one robot
 *  per child that has not left. Pure: the same inputs give the same world.
 *
 *  Stub until the `world` piece lands: an empty world. */
export function buildWorld(_snap: Snapshot, archives: ArchiveCounts, now: number): World {
  return { territories: [], universal: { pages: archives.universal, tier: 0 }, at: now }
}

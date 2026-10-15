import { useMemo } from 'react'
import { useStore } from 'zustand'
import { useFleet } from '../fleet/store'
import { homeStore } from '../home/app-store'
import { isFolded, type HomeRepo } from '../home/types'
import { basename, samePath } from '../path/path'
import { settingsStore } from '../settings/app-store'

/** A repo the Nexus can start a session in, or read the memory of. */
export type KnownRepo = { root: string; name: string }

/** Every repo the Nexus knows, once each, compared as paths: the fleet's (the ship's decks and
 *  docks) first, then those PROJECTS lists (Home's, neither hidden nor a folded protected folder),
 *  then the saved projects Home has not read yet (one just added). `/new`, Memory and What mnemo
 *  learned all pick from it, so a repo PROJECTS shows is one each of them takes. */
export function knownRepos(fleet: readonly KnownRepo[], home: readonly HomeRepo[], projects: readonly string[]): KnownRepo[] {
  const out: KnownRepo[] = []
  const add = (r: KnownRepo) => {
    if (!out.some((o) => samePath(o.root, r.root))) out.push({ root: r.root, name: r.name })
  }
  for (const r of fleet) add(r)
  for (const r of home) if (!r.hidden && !isFolded(r)) add(r)
  for (const root of projects) if (root) add({ root, name: basename(root) || root })
  return out
}

/** `knownRepos` of the app's fleet, Home and settings, kept current. */
export function useKnownRepos(): KnownRepo[] {
  const fleet = useFleet((f) => f.repos)
  const home = useStore(homeStore, (s) => s.snapshot.repos)
  const projects = useStore(settingsStore, (s) => s.projects)
  return useMemo(() => knownRepos(fleet, home, projects), [fleet, home, projects])
}

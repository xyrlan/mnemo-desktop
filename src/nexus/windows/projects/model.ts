import type { HomeRepo, HomeSession, Live } from '../../../home/types'

/** A session live in a repo, as its row lists it: a captain (a session started in the repo) or a
 *  robot (a dispatched child in a worktree beside it). */
export type LiveSession = { id: string; title: string; live: Live; robot: boolean }

/** Every session live in `repo`, its own and its children's, newest first. */
export function liveSessions(repo: HomeRepo): LiveSession[] {
  const live = (s: HomeSession, robot: boolean): LiveSession[] => (s.live ? [{ id: s.id, title: s.agent || s.title || s.id.slice(0, 8), live: s.live, robot }] : [])
  const at = new Map<string, number>()
  for (const s of [...repo.sessions, ...repo.children]) at.set(s.id, s.last_at)
  return [...repo.sessions.flatMap((s) => live(s, false)), ...repo.children.flatMap((s) => live(s, true))].sort((a, b) => (at.get(b.id) ?? 0) - (at.get(a.id) ?? 0))
}

/** Where a live session runs, in a word or two. */
export const WHERE: Record<Live, string> = { here: 'in the app', bg: 'background', elsewhere: 'another terminal' }

/** The folder clones land in: the setting when the person chose one, else the default Home reads. */
export const cloneBase = (setting: string | null, snapshotBase: string): string => setting || snapshotBase

/** The command that clones `spec` (`owner/repo`, an https or ssh URL) to `dest`, as Home ran it. */
export const cloneCommand = (spec: string, dest: string): string => `gh repo clone ${spec.trim()} ${dest}`

/** `projects` with `root` saved, and `hidden` with it shown again: what adding a repo changes.
 *  Each is null when it needs no write. */
export function added(root: string, projects: readonly string[], hidden: readonly string[]): { projects: string[] | null; hidden: string[] | null } {
  return {
    projects: projects.includes(root) ? null : [...projects, root],
    hidden: hidden.includes(root) ? hidden.filter((h) => h !== root) : null,
  }
}

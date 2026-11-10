import { samePath } from '../../path/path'

/** The repos a worktree setup command can still be added for: those the app knows that have
 *  none yet, compared as paths (one folder reaches the app spelt three ways on Windows). */
export function addable<R extends { root: string }>(repos: readonly R[], repoSetup: Record<string, string>): R[] {
  const taken = Object.keys(repoSetup)
  return repos.filter((r) => !taken.some((t) => samePath(t, r.root)))
}

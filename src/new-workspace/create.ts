import type { WorktreeInfo } from '../worktrees/client'

/** What Create turns into a workspace. `name` is what was typed (made a branch name here), and
 *  empty `base` / `setup` mean "none". */
export type CreateInput = {
  repo: string
  name: string
  base: string
  setup: string
  skipPermissions: boolean
  issue?: { number: number; title: string }
}

export type CreateDeps = {
  createWorktree(repo: string, name: string, opts: { base?: string; setup?: string }): Promise<WorktreeInfo>
  switchWorktree(path: string): Promise<void>
  openCommandTab(cwd: string, cmd: string): Promise<void>
  /** Remembers `setup` (trimmed, possibly empty) as the repo's setup command. */
  saveSetup(repo: string, setup: string): void
  /** Resolves once setup output is being listened for: a quick setup can end before
   *  `createWorktree` returns, and its lines must not be lost. */
  listenSetup(): Promise<void>
  /** A setup job started in the new tree: show its progress. */
  trackSetup(job: string, tree: { path: string; name: string }): void
  /** Ask the fleet again, so the new tree's card shows without waiting for the next poll. */
  refresh(): void
}

/** The branch and folder suffix a typed name becomes: one path segment git accepts as a branch
 *  (`<repo>-wt-<name>`), spaces as dashes, anything else dropped. Empty when nothing is left. */
export function workspaceName(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9._-]/g, '')
    .replace(/\.{2,}/g, '.')
    .replace(/-{2,}/g, '-')
    .replace(/\.lock$/i, '')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 60)
    .replace(/[.-]+$/g, '')
}

/** A workspace named after an issue: `42-fix-the-login-loop`, the title cut at a word. */
export function nameForIssue(issue: { number: number; title: string }): string {
  const words = issue.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean)
  let slug = ''
  for (const w of words) {
    if ((slug + '-' + w).length > 40) break
    slug = slug ? `${slug}-${w}` : w
  }
  return slug ? `${issue.number}-${slug}` : `issue-${issue.number}`
}

/** The first `workspace-N` none of `taken` (the repo's branches and tree names) already is. */
export function defaultName(taken: readonly string[]): string {
  const used = new Set(taken)
  for (let n = 1; ; n++) if (!used.has(`workspace-${n}`)) return `workspace-${n}`
}

/** Where `worktree.rs` puts the tree: the sibling `<repo>-wt-<name>` of the main checkout. */
export const treePath = (root: string, name: string) => `${root.replace(/[\\/]+$/, '')}-wt-${name}`

/** An issue's title as a prompt that reads the same in zsh, bash, PowerShell and cmd.exe inside
 *  double quotes: every character any of them would expand or end the string on is dropped. */
export function issuePrompt(issue: { number: number; title: string }): string {
  const title = issue.title.replace(/[\r\n]+/g, ' ').replace(/["`$\\!%^]/g, '').replace(/\s+/g, ' ').trim()
  return `Work on GitHub issue #${issue.number}: ${title}. Read it first with gh issue view ${issue.number}.`
}

/** The line typed into the new workspace's terminal. */
export function claudeCommand(skipPermissions: boolean, issue?: { number: number; title: string }): string {
  const words = ['claude']
  if (skipPermissions) words.push('--dangerously-skip-permissions')
  if (issue) words.push(`"${issuePrompt(issue)}"`)
  return words.join(' ')
}

/** Create: the worktree (starting the repo's setup in it), then switch to it and open a terminal
 *  running `claude` there. Rejects with the backend's reason when the tree cannot be made; the
 *  setup command is remembered for the repo either way, since it was typed on purpose. */
export async function createWorkspace(deps: CreateDeps, input: CreateInput): Promise<WorktreeInfo> {
  const name = workspaceName(input.name)
  if (!name) throw new Error('Name the workspace with letters, digits, dots, dashes or underscores.')
  const setup = input.setup.trim()
  const base = input.base.trim()
  deps.saveSetup(input.repo, setup)
  if (setup) await deps.listenSetup()
  const tree = await deps.createWorktree(input.repo, name, { ...(base ? { base } : {}), ...(setup ? { setup } : {}) })
  if (tree.setupJob) deps.trackSetup(tree.setupJob, { path: tree.path, name })
  await deps.switchWorktree(tree.path)
  await deps.openCommandTab(tree.path, claudeCommand(input.skipPermissions, input.issue))
  deps.refresh()
  return tree
}

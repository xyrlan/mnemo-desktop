// adapted from stablyai/orca components/right-sidebar/checks-panel/check-details-model.ts and
// lib/fix-checks-agent-launch.ts (the Fix prompt)
import type { Check, CheckDetails, ChecksPr, ChecksView, Comment, MergeMethod, Thread } from './client'

export type Counts = { passing: number; failing: number; pending: number }

export function countChecks(checks: readonly Check[]): Counts {
  const c: Counts = { passing: 0, failing: 0, pending: 0 }
  for (const k of checks) {
    if (k.verdict === 'fail') c.failing++
    else if (k.verdict === 'pending') c.pending++
    else c.passing++
  }
  return c
}

export const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

/** A job's or a step's conclusion that means it went wrong. */
export const isFailure = (conclusion: string | null | undefined) =>
  conclusion === 'failure' || conclusion === 'timed_out' || conclusion === 'startup_failure' || conclusion === 'cancelled' || conclusion === 'action_required'

/** Orca's words for where a check stands. */
export function statusLabel(c: { status: string; conclusion: string | null }): string {
  switch (c.conclusion) {
    case 'success':
      return 'Successful'
    case 'failure':
      return 'Failed'
    case 'cancelled':
      return 'Cancelled'
    case 'timed_out':
      return 'Timed out'
    case 'action_required':
      return 'Action required'
    case 'startup_failure':
      return 'Failed to start'
    case 'neutral':
      return 'Neutral'
    case 'skipped':
      return 'Skipped'
    case 'stale':
      return 'Stale'
  }
  if (c.status === 'queued') return 'Queued'
  if (c.status === 'in_progress') return 'In progress'
  return 'Pending'
}

/** Why a merge is not offered now, or null when it is: `checks.rs`'s gate, read ahead so the
 *  button can say it. The gate runs again at the moment of the merge. */
export function mergeBlock(pr: ChecksPr, checks: readonly Check[]): string | null {
  if (pr.state === 'merged') return 'Already merged'
  if (pr.state === 'closed') return 'The pull request is closed'
  if (pr.state === 'draft') return 'A draft: mark it ready for review first'
  if (pr.mergeable === 'CONFLICTING') return `It conflicts with ${pr.base}: resolve that first`
  if (!checks.length) return 'No checks ran on its head, so nothing says it is green'
  const c = countChecks(checks)
  if (c.failing) return `${plural(c.failing, 'check')} failing`
  if (c.pending) return `${plural(c.pending, 'check')} still running`
  return null
}

export const METHOD_LABEL: Record<MergeMethod, string> = {
  squash: 'Squash and merge',
  merge: 'Create a merge commit',
  rebase: 'Rebase and merge',
}

/** How often the tab reads the PR again while it is open: sooner while a check runs. */
export const POLL_RUNNING_MS = 15_000
export const POLL_IDLE_MS = 60_000

export function pollDelay(view: ChecksView | null | undefined): number {
  return view?.pr?.state !== 'merged' && view?.pr?.state !== 'closed' && view?.checks.some((c) => c.verdict === 'pending') ? POLL_RUNNING_MS : POLL_IDLE_MS
}

/** A check's details are read again once it changes (a job that finished, a re-run). */
export const detailsKey = (c: Pick<Check, 'url' | 'status' | 'conclusion'>) => `${c.url ?? ''}#${c.status}:${c.conclusion ?? ''}`

/** `3m ago`, `2h ago`, `4d ago`, then the date. */
export function relativeTime(iso: string, now: number): string {
  const at = Date.parse(iso)
  if (Number.isNaN(at)) return ''
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`
  if (s < 30 * 86_400) return `${Math.floor(s / 86_400)}d ago`
  return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

/** Log text a Fix prompt carries at most, over every failing check. */
export const PROMPT_LOG_BUDGET = 24_000

/** The last `max` characters of `text`, starting on a whole line. */
export function tailOf(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(text.length - max)
  const nl = cut.indexOf('\n')
  return nl >= 0 ? cut.slice(nl + 1) : cut
}

export type Failing = { check: Check; details: CheckDetails | null; error?: string | null }

const prRef = (pr: ChecksPr) => `pull request #${pr.number} (${pr.head} → ${pr.base})`

/** What Fix sends the worktree's agent: each failing check with its failed step, annotations
 *  and log tail, and what to do about them. */
export function fixPrompt(pr: ChecksPr, failing: readonly Failing[]): string {
  const withLog = failing.filter((f) => f.details?.logTail).length
  const perLog = Math.floor(PROMPT_LOG_BUDGET / Math.max(1, withLog))
  const names = failing.map((f) => f.check.name).join(', ')
  const parts = [
    `The CI checks of ${prRef(pr)} are failing: ${names}.`,
    'Find out why from what follows, fix it in this worktree, run the failing checks locally where you can, then commit and push the fix.',
  ]
  for (const { check, details, error } of failing) {
    const lines = [`## ${check.name}: ${statusLabel(details ?? check).toLowerCase()}`]
    if (check.workflow) lines.push(`Workflow: ${check.workflow}`)
    if (check.description) lines.push(`Says: ${check.description}`)
    if (check.url) lines.push(`Link: ${check.url}`)
    if (!check.jobId) {
      lines.push('It did not run on GitHub Actions: its details are on the page it links to.')
    } else if (!details) {
      lines.push(`Its job could not be read${error ? ` (${error})` : ''}.`)
    } else {
      const steps = details.steps.filter((s) => isFailure(s.conclusion)).map((s) => s.name)
      if (steps.length) lines.push(`Failed step: ${steps.join(', ')}`)
      const notes = details.annotations.filter((a) => a.level !== 'notice')
      if (notes.length) {
        lines.push('Annotations:')
        for (const a of notes) lines.push(`- ${a.path}${a.line ? `:${a.line}` : ''} (${a.level})${a.title ? ` ${a.title}:` : ''} ${a.message}`)
      }
      if (details.logTail) lines.push('Log tail:', '```text', tailOf(details.logTail, perLog), '```')
      else if (details.logError) lines.push(`Its log could not be read (${details.logError}).`)
    }
    if (check.jobId) lines.push(`Full log: gh run view --job ${check.jobId} --log-failed`)
    parts.push(lines.join('\n'))
  }
  return parts.join('\n\n')
}

const said = (c: Comment) => `@${c.author}: ${c.body.trim()}`

/** What "send to agent" sends for a review thread: where it is, the code, every comment. */
export function threadPrompt(pr: ChecksPr, t: Thread): string {
  const at = `${t.path}${t.line ? `:${t.line}` : ''}`
  const parts = [`A review comment on ${prRef(pr)}, on ${at}${t.outdated ? ' (the code has changed since)' : ''}:`]
  const hunk = t.comments[0]?.diffHunk
  if (hunk) parts.push(['```diff', hunk, '```'].join('\n'))
  parts.push(t.comments.map(said).join('\n\n'))
  const link = t.comments[0]?.url
  parts.push(`Address it in this worktree.${link ? ` (${link})` : ''}`)
  return parts.join('\n\n')
}

const VERDICT: Record<string, string> = { APPROVED: 'approved', CHANGES_REQUESTED: 'changes requested', COMMENTED: 'a review' }

/** What "send to agent" sends for a comment on the conversation, or a review's own text. */
export function commentPrompt(pr: ChecksPr, c: Comment): string {
  const kind = c.review ? `A review of ${prRef(pr)} by @${c.author} (${VERDICT[c.review] ?? c.review.toLowerCase()}):` : `A comment on ${prRef(pr)} by @${c.author}:`
  return [kind, c.body.trim(), `Address it in this worktree.${c.url ? ` (${c.url})` : ''}`].join('\n\n')
}

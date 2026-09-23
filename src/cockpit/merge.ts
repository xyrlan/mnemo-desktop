import type { Pr } from '../mission/types'
import { cockpitStore } from './app-store'
import { runStep, type StepResult } from './job'

/** A merge from the app lands only what the maintainer would have merged by hand. `gh pr merge`
 *  gates on nothing here (mnemo-desktop has no branch protection: #27 and #30 landed with a red
 *  Windows job), so the app reads the PR itself at the moment of the merge, per check, and merges
 *  only that head: GitHub refuses the merge if a commit lands between the read and the merge.
 *  A draft is marked ready as part of the confirmed merge, then read again. A refusal keeps gh's
 *  own reason, and the app never adds `--admin`. "Merged" is said only once GitHub says so. */

/** One entry of a `statusCheckRollup`: a check run (`conclusion`) or a commit status (`state`). */
export type Check = { name?: string; context?: string; status?: string | null; conclusion?: string | null; state?: string | null }

const FAILED = new Set(['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'STALE'])
const PASSED = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED'])

/** `check_verdict` in mission.rs, rule for rule; `check-verdicts.json` pins both. A conclusion
 *  this does not know is never a pass. */
export function checkVerdict(c: Check): 'pass' | 'fail' | 'pending' {
  const conclusion = c.conclusion ?? ''
  const state = c.state ?? ''
  if (FAILED.has(conclusion) || state === 'FAILURE' || state === 'ERROR') return 'fail'
  if (PASSED.has(conclusion) || (conclusion === '' && state === 'SUCCESS')) return 'pass'
  return 'pending'
}

/** `gh pr view <n> --json` with these fields. */
export const VIEW_FIELDS = 'number,state,isDraft,headRefOid,statusCheckRollup'
export type PrRead = { number: number; state: string; isDraft: boolean; headRefOid: string; statusCheckRollup: Check[] | null }

export type Gate = { ok: true; sha: string; passed: number } | { ok: false; reason: string }

const checkName = (c: Check) => c.name || c.context || 'a check'
const count = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

/** Whether `r` may be merged: open, with checks, every one of them passed. A draft passes the
 *  gate; the merge marks it ready first. */
export function gate(r: PrRead): Gate {
  if (r.state === 'MERGED') return { ok: false, reason: `PR #${r.number} was already merged on GitHub` }
  if (r.state !== 'OPEN') return { ok: false, reason: `PR #${r.number} is ${r.state.toLowerCase()}` }
  const checks = r.statusCheckRollup ?? []
  if (!checks.length) return { ok: false, reason: 'no checks ran on its head, so nothing says it is green' }
  const failed = checks.filter((c) => checkVerdict(c) === 'fail').map(checkName)
  if (failed.length) return { ok: false, reason: `${count(failed.length, 'check')} failed: ${failed.join(', ')}` }
  const pending = checks.filter((c) => checkVerdict(c) === 'pending').map(checkName)
  if (pending.length) return { ok: false, reason: `${count(pending.length, 'check')} not finished: ${pending.join(', ')}` }
  return { ok: true, sha: r.headRefOid, passed: checks.length }
}

/** The key of the row that offers the merge (`needs.ts`), so the map's merge, the row's and the
 *  PR view's are one job, and the row finds its log. */
export const mergeKey = (root: string, pr: Pr) => `ready:${root}#${pr.number}`

/** The merge itself, pinned to the head whose checks were read. Never `--admin`. */
export const mergeArgv = (pr: Pr, sha: string) => ['gh', 'pr', 'merge', String(pr.number), '--squash', '--match-head-commit', sha]

/** What the merge button does, for its hover title. */
export const mergePlan = (pr: Pr) =>
  `reads every check of PR #${pr.number}, then ${pr.draft ? `gh pr ready ${pr.number} && ` : ''}gh pr merge ${pr.number} --squash --match-head-commit <the head it read>`

/** gh's reason for refusing, from what it printed on stderr: its first line, without the mark. */
export function ghReason(r: Pick<StepResult, 'err' | 'out' | 'code'>): string {
  const line = [...r.err, ...r.out].map((l) => l.trim()).find(Boolean)
  return line ? line.replace(/^[X!✗]\s+/, '') : `gh exited ${r.code ?? 'on a signal'} without saying why`
}

/** Why a merge stopped before `gh pr merge` ran. */
class Refused extends Error {}

/** Merges `pr` as the row `mergeKey(root, pr)`'s job: nothing while that job still runs. Every
 *  outcome ends the job, and every one but a merged PR ends it failed, with the reason. */
export async function mergeChecked(root: string, pr: Pr) {
  const key = mergeKey(root, pr)
  const store = cockpitStore.getState
  if (!store().jobStart(key, `merge · PR #${pr.number}`)) return
  const say = (line: string) => store().jobLine(key, { stream: 'app', line })
  const n = String(pr.number)

  const read = async (step: string): Promise<PrRead> => {
    const r = await runStep(`${key}:${step}`, root, ['gh', 'pr', 'view', n, '--json', VIEW_FIELDS])
    if (r.code !== 0) throw new Refused(`could not read PR #${n}: ${ghReason(r)}`)
    try {
      return JSON.parse(r.out.join('\n')) as PrRead
    } catch {
      throw new Refused(`could not read PR #${n}: gh printed no JSON`)
    }
  }
  const passes = (r: PrRead, was?: string) => {
    const g = gate(r)
    if (!g.ok) throw new Refused(g.reason)
    if (was && g.sha !== was) throw new Refused(`its head moved to ${g.sha.slice(0, 7)} while it was being marked ready`)
    say(`PR #${n} at ${g.sha.slice(0, 7)}: ${count(g.passed, 'check')} passed`)
    return g.sha
  }

  try {
    const before = await read('read')
    let sha = passes(before)
    if (before.isDraft) {
      say(`PR #${n} is a draft: marking it ready for review`)
      const ready = await runStep(`${key}:ready`, root, ['gh', 'pr', 'ready', n], key)
      if (ready.code !== 0) throw new Refused(`could not mark it ready: ${ghReason(ready)}`)
      try {
        sha = passes(await read('reread'), sha)
      } catch (e) {
        throw e instanceof Refused ? new Refused(`marked ready, but ${e.message}`) : e
      }
    }
    const merge = await runStep(`${key}:merge`, root, mergeArgv(pr, sha), key)
    if (merge.code !== 0) return store().jobExit(key, merge.code, `not merged: ${ghReason(merge)}`)
    // gh exits 0 on a PR it only queued; the row says merged once GitHub does.
    let after: PrRead
    try {
      after = await read('check')
    } catch (e) {
      return store().jobExit(key, 0, `gh said it merged, but reading it back failed (${e instanceof Error ? e.message : e})`)
    }
    if (after.state !== 'MERGED') return store().jobExit(key, 0, `gh exited 0, but PR #${n} is still ${after.state.toLowerCase()}: not merged`)
    say(`PR #${n} is merged`)
    store().jobExit(key, 0)
  } catch (e) {
    store().jobFailed(key, `not merged: ${e instanceof Error ? e.message : String(e)}`)
  }
}

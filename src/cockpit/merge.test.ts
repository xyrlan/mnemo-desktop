import { vi } from 'vitest'
import verdicts from '../../src-tauri/fixtures/check-verdicts.json'

/** A fake `gh` behind `job_run`: `answer` says what each argv prints and how it exits, and the
 *  answer arrives as `job.rs` would send it, lines then the exit, after `invoke` returned. */
type Answer = { out?: string[]; err?: string[]; code?: number | null }
const gh = vi.hoisted(() => ({
  runs: [] as { id: string; argv: string[] }[],
  on: {} as Record<string, (e: { payload: unknown }) => void>,
  answer: (_argv: string[]): Answer => ({}),
  refuse: null as string | null,
}))
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (cmd: string, args: { id: string; cwd: string; argv: string[] }) => {
    if (cmd !== 'job_run') return
    if (gh.refuse) throw gh.refuse
    gh.runs.push({ id: args.id, argv: args.argv })
    const a = gh.answer(args.argv)
    setTimeout(() => {
      for (const line of a.out ?? []) gh.on['job-line']({ payload: { id: args.id, stream: 'out', line } })
      for (const line of a.err ?? []) gh.on['job-line']({ payload: { id: args.id, stream: 'err', line } })
      gh.on['job-exit']({ payload: { id: args.id, code: a.code === undefined ? 0 : a.code } })
    }, 0)
  }),
}))
vi.mock('@tauri-apps/api/event', () => ({
  listen: async (name: string, h: (e: { payload: unknown }) => void) => {
    gh.on[name] = h
    return () => {}
  },
}))

import { checkVerdict, gate, mergeKey, type Check, type PrRead } from './merge'
import { mergePr } from './actions'
import { cockpitStore } from './app-store'
import { jobState } from './store'
import type { Pr } from '../mission/types'

const ROOT = '/Users/me/github/mnemo-desktop'
const pr: Pr = { number: 49, url: 'https://github.com/me/mnemo-desktop/pull/49', state: 'OPEN', head: 'fix/issue-40', ci: 'pass' }
const KEY = mergeKey(ROOT, pr)
const SHA = 'd8cf2cfee7962c28fcd7fcc0d3ee2420bea832a8'
const green: Check[] = [
  { name: 'test (macos-latest)', conclusion: 'SUCCESS' },
  { name: 'test (ubuntu-latest)', conclusion: 'SUCCESS' },
  { name: 'test (windows-latest)', conclusion: 'SUCCESS' },
]
const view = (over: Partial<PrRead> = {}): PrRead => ({ number: 49, state: 'OPEN', isDraft: false, headRefOid: SHA, statusCheckRollup: green, ...over })

/** gh as a script: each `gh pr view` answers the next read, in order; merge and ready answer as given. */
function script({ reads, merge = {}, ready = {} }: { reads: PrRead[]; merge?: Answer; ready?: Answer }) {
  const queue = [...reads]
  gh.answer = (argv) => {
    const [, , verb] = argv
    if (verb === 'view') return { out: [JSON.stringify(queue.shift() ?? reads.at(-1))] }
    if (verb === 'merge') return merge
    if (verb === 'ready') return ready
    return { code: 127 }
  }
}

const job = () => cockpitStore.getState().jobs[KEY]
const verbs = () => gh.runs.map((r) => r.argv.slice(2, 3)[0])
/** Runs `mergePr` to its end. */
async function merge(p: Pr = pr) {
  mergePr(ROOT, p)
  await vi.waitFor(() => expect(job()?.running).toBe(false))
}

beforeEach(() => {
  gh.runs = []
  gh.refuse = null
  cockpitStore.setState({ drawer: null, jobs: {} })
})

test('each check verdict is the one mission.rs gives the same check', () => {
  // The same table pins `check_verdict` in mission.rs.
  for (const { check, verdict } of verdicts) expect([check, checkVerdict(check as Check)]).toEqual([check, verdict])
})

test('the gate passes an open PR only when it has checks and every one of them passed', () => {
  expect(gate(view())).toEqual({ ok: true, sha: SHA, passed: 3 })
  // PR #27: two green jobs and one red Windows job is not green, whatever gh pr merge says.
  const red = view({ statusCheckRollup: [green[0], green[1], { name: 'test (windows-latest)', conclusion: 'FAILURE' }] })
  expect(gate(red)).toEqual({ ok: false, reason: '1 check failed: test (windows-latest)' })
  expect(gate(view({ statusCheckRollup: [green[0], { name: 'lint', status: 'IN_PROGRESS', conclusion: '' }] }))).toEqual({ ok: false, reason: '1 check not finished: lint' })
  expect(gate(view({ statusCheckRollup: [] })).ok).toBe(false)
  expect(gate(view({ statusCheckRollup: null })).ok).toBe(false)
  expect(gate(view({ state: 'CLOSED' }))).toEqual({ ok: false, reason: 'PR #49 is closed' })
  expect(gate(view({ state: 'MERGED' }))).toEqual({ ok: false, reason: 'PR #49 was already merged on GitHub' })
  // A draft passes the gate; the merge marks it ready first.
  expect(gate(view({ isDraft: true })).ok).toBe(true)
})

test('a green PR merges pinned to the head whose checks were read, and is merged once GitHub says so', async () => {
  script({ reads: [view(), view({ state: 'MERGED' })], merge: { err: ['✓ Squashed and merged pull request #49'] } })
  await merge()
  expect(gh.runs.map((r) => r.argv)).toEqual([
    ['gh', 'pr', 'view', '49', '--json', 'number,state,isDraft,headRefOid,statusCheckRollup'],
    ['gh', 'pr', 'merge', '49', '--squash', '--match-head-commit', SHA],
    ['gh', 'pr', 'view', '49', '--json', 'number,state,isDraft,headRefOid,statusCheckRollup'],
  ])
  expect(jobState(job())).toBe('ok')
  // The log is the row's: what the gate read, what gh said, and the verdict.
  expect(job().lines).toEqual([
    { stream: 'app', line: 'PR #49 at d8cf2cf: 3 checks passed' },
    { stream: 'err', line: '✓ Squashed and merged pull request #49' },
    { stream: 'app', line: 'PR #49 is merged' },
  ])
  // Success is silence: no drawer.
  expect(cockpitStore.getState().drawer).toBeNull()
})

test('a check that went red since the snapshot stops the merge before gh pr merge runs', async () => {
  // The row said green (`pr.ci`); the read at merge time is what counts.
  script({ reads: [view({ statusCheckRollup: [green[0], { name: 'test (windows-latest)', conclusion: 'FAILURE' }] })] })
  await merge()
  expect(verbs()).toEqual(['view'])
  expect(jobState(job())).toBe('failed')
  expect(job().error).toBe('not merged: 1 check failed: test (windows-latest)')
  expect(cockpitStore.getState().drawer).toBe(KEY)
})

test('a PR with no checks, or one still running, is not merged', async () => {
  script({ reads: [view({ statusCheckRollup: [] })] })
  await merge()
  expect(job().error).toBe('not merged: no checks ran on its head, so nothing says it is green')
  gh.runs = []
  script({ reads: [view({ statusCheckRollup: [{ name: 'test (windows-latest)', status: 'QUEUED', conclusion: null }] })] })
  await merge()
  expect(verbs()).toEqual(['view'])
  expect(job().error).toBe('not merged: 1 check not finished: test (windows-latest)')
})

test('a draft is marked ready as part of the confirmed merge, read again, then merged', async () => {
  script({ reads: [view({ isDraft: true }), view(), view({ state: 'MERGED' })], ready: { err: ['✓ Pull request #49 is marked as "ready for review"'] } })
  await merge({ ...pr, draft: true })
  expect(verbs()).toEqual(['view', 'ready', 'view', 'merge', 'view'])
  expect(gh.runs[1].argv).toEqual(['gh', 'pr', 'ready', '49'])
  expect(gh.runs[3].argv).toEqual(['gh', 'pr', 'merge', '49', '--squash', '--match-head-commit', SHA])
  expect(jobState(job())).toBe('ok')
  expect(job().lines.map((l) => l.line)).toContain('PR #49 is a draft: marking it ready for review')
})

test('a draft whose checks are not green is never marked ready', async () => {
  script({ reads: [view({ isDraft: true, statusCheckRollup: [{ name: 'ci', conclusion: 'FAILURE' }] })] })
  await merge({ ...pr, draft: true })
  expect(verbs()).toEqual(['view'])
  expect(job().error).toBe('not merged: 1 check failed: ci')
})

test('a draft marked ready is not merged when its head moved or a check started meanwhile', async () => {
  script({ reads: [view({ isDraft: true }), view({ headRefOid: 'aaaaaaa1111' })] })
  await merge({ ...pr, draft: true })
  expect(verbs()).toEqual(['view', 'ready', 'view'])
  expect(job().error).toBe('not merged: marked ready, but its head moved to aaaaaaa while it was being marked ready')
  gh.runs = []
  script({ reads: [view({ isDraft: true }), view({ statusCheckRollup: [...green, { name: 'on ready', status: 'QUEUED', conclusion: null }] })] })
  await merge({ ...pr, draft: true })
  expect(verbs()).toEqual(['view', 'ready', 'view'])
  expect(job().error).toBe('not merged: marked ready, but 1 check not finished: on ready')
})

test("a refused merge keeps gh's reason and is never retried with --admin", async () => {
  const policy = [
    'X Pull request xyrlan/mnemo#51 is not mergeable: the base branch policy prohibits the merge.',
    'To have the pull request merged after all the requirements have been met, add the `--auto` flag.',
    'To use administrator privileges to immediately merge the pull request, add the `--admin` flag.',
  ]
  script({ reads: [view()], merge: { err: policy, code: 1 } })
  await merge()
  expect(verbs()).toEqual(['view', 'merge'])
  expect(gh.runs.flatMap((r) => r.argv)).not.toContain('--admin')
  expect(jobState(job())).toBe('failed')
  expect(job().code).toBe(1)
  expect(job().error).toBe('not merged: Pull request xyrlan/mnemo#51 is not mergeable: the base branch policy prohibits the merge.')
  // gh's whole answer is in the log.
  expect(job().lines.filter((l) => l.stream === 'err').map((l) => l.line)).toEqual(policy)
})

test('gh exiting 0 on a PR that did not merge is never reported merged', async () => {
  // A merge queue: gh queues it and exits 0.
  script({ reads: [view(), view()] })
  await merge()
  expect(verbs()).toEqual(['view', 'merge', 'view'])
  expect(jobState(job())).toBe('failed')
  expect(job().error).toBe('gh exited 0, but PR #49 is still open: not merged')
})

test('a merge that cannot read the PR, or cannot start gh, fails with the reason', async () => {
  gh.answer = () => ({ err: ['GraphQL: Could not resolve to a PullRequest with the number of 49.'], code: 1 })
  await merge()
  expect(job().error).toBe('not merged: could not read PR #49: GraphQL: Could not resolve to a PullRequest with the number of 49.')
  gh.refuse = 'gh not found in PATH'
  await merge()
  expect(job().error).toBe('not merged: gh not found in PATH')
})

test('a second press while the merge runs starts nothing', async () => {
  script({ reads: [view(), view({ state: 'MERGED' })] })
  mergePr(ROOT, pr)
  mergePr(ROOT, pr)
  await vi.waitFor(() => expect(job()?.running).toBe(false))
  expect(verbs()).toEqual(['view', 'merge', 'view'])
})

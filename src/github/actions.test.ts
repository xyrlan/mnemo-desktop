import { vi } from 'vitest'

/** Every `job_run` a test asked for, and what `job.rs` would emit back. */
const jobs = vi.hoisted(() => ({ runs: [] as { id: string; cwd: string; argv: string[] }[], on: {} as Record<string, (e: { payload: unknown }) => void>, refuse: null as string | null }))
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (cmd: string, args?: unknown) => {
    if (cmd === 'job_run') {
      if (jobs.refuse) throw jobs.refuse
      return void jobs.runs.push(args as never)
    }
    return {}
  }),
}))
vi.mock('@tauri-apps/api/event', () => ({
  listen: async (name: string, h: (e: { payload: unknown }) => void) => {
    jobs.on[name] = h
    return () => {}
  },
}))
const emit = (name: 'job-line' | 'job-exit', payload: unknown) => jobs.on[name]({ payload })

import { store as layout } from '../layout/app-store'
import { cockpitStore } from '../cockpit/app-store'
import { dispatchContract, dispatchIssue, dispatchIssues, dispatchKey, resumeChildren } from './actions'

const typed: [string | undefined, string][] = []
const flush = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  typed.length = 0
  jobs.runs = []
  jobs.refuse = null
  layout.setState({ openCommandTab: async (cwd, cmd) => void typed.push([cwd, cmd]) })
  cockpitStore.setState({ drawer: null, jobs: {} })
})

test('dispatchIssue runs the single-issue command headless, unchanged', async () => {
  dispatchIssue('/repo', 45)
  await flush()
  expect(jobs.runs).toEqual([{ id: dispatchKey('/repo', [45]), cwd: '/repo', argv: ['mnemo', 'dispatch', '45'] }])
  expect(typed).toEqual([])
})

test('dispatchIssues runs every issue in one command, in the order given, and opens its drawer', async () => {
  const key = dispatchKey('/repo', [3, 1, 2])
  dispatchIssues('/repo', [3, 1, 2])
  await flush()
  expect(jobs.runs).toEqual([{ id: key, cwd: '/repo', argv: ['mnemo', 'dispatch', '3', '1', '2'] }])
  expect(cockpitStore.getState().drawer).toBe(key)
  expect(cockpitStore.getState().jobs[key]?.title).toBe('dispatch · #3, #1, #2')
})

test('dispatchIssues appends --model, --effort and --may when given', async () => {
  dispatchIssues('/repo', [1], { model: 'opus', effort: 'high', may: 'pr' })
  await flush()
  expect(jobs.runs).toEqual([{ id: dispatchKey('/repo', [1]), cwd: '/repo', argv: ['mnemo', 'dispatch', '1', '--model', 'opus', '--effort', 'high', '--may', 'pr'] }])
})

test('dispatchIssues only appends the flags actually given', async () => {
  dispatchIssues('/repo', [1, 2], { effort: 'low' })
  await flush()
  expect(jobs.runs).toEqual([{ id: dispatchKey('/repo', [1, 2]), cwd: '/repo', argv: ['mnemo', 'dispatch', '1', '2', '--effort', 'low'] }])
})

test('dispatchIssues does nothing for an empty selection', async () => {
  dispatchIssues('/repo', [])
  await flush()
  expect(jobs.runs).toEqual([])
  expect(cockpitStore.getState().drawer).toBeNull()
})

test('a refused dispatch (a contract the parser rejects) fails the job and its drawer shows why', async () => {
  jobs.refuse = 'contract has no piece'
  const key = dispatchKey('/repo', [1])
  dispatchIssues('/repo', [1])
  await flush()
  expect(cockpitStore.getState().jobs[key]?.error).toBe('contract has no piece')
  expect(cockpitStore.getState().drawer).toBe(key)
})

test('dispatchContract runs --contract <path> and opens its drawer', async () => {
  dispatchContract('/repo', 'docs/contracts/round18.md', { model: 'sonnet' })
  await flush()
  expect(jobs.runs).toEqual([{ id: 'dispatch:/repo#contract:docs/contracts/round18.md', cwd: '/repo', argv: ['mnemo', 'dispatch', '--contract', 'docs/contracts/round18.md', '--model', 'sonnet'] }])
  expect(cockpitStore.getState().drawer).toBe('dispatch:/repo#contract:docs/contracts/round18.md')
})

test('resumeChildren runs `mnemo resume` in the repo and opens its drawer', async () => {
  resumeChildren('/repo')
  await flush()
  expect(jobs.runs).toEqual([{ id: 'resume:/repo', cwd: '/repo', argv: ['mnemo', 'resume'] }])
  expect(cockpitStore.getState().drawer).toBe('resume:/repo')
})

test('a running dispatch streams its lines into the job store, and success stays in its drawer', async () => {
  const key = dispatchKey('/repo', [1])
  dispatchIssues('/repo', [1])
  await flush()
  emit('job-line', { id: key, stream: 'out', line: 'child abc123 on feat/x/1' })
  emit('job-line', { id: key, stream: 'out', line: 'attach: claude --resume abc123' })
  emit('job-exit', { id: key, code: 0 })
  const job = cockpitStore.getState().jobs[key]
  expect(job?.lines).toEqual([
    { stream: 'out', line: 'child abc123 on feat/x/1' },
    { stream: 'out', line: 'attach: claude --resume abc123' },
  ])
  expect(job?.code).toBe(0)
  // Success is not silence here: dispatch's output is the point, so the drawer we opened stays.
  expect(cockpitStore.getState().drawer).toBe(key)
})

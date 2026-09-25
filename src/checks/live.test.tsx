import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { ChecksClient, ChecksView } from './client'
import { GREEN, VIEW, WT } from './fixtures'
import { FRESH_MS, useLiveChecks } from './live'
import { createChecksStore } from './store'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let reads: string[]
let answer: ChecksView
let hidden: boolean
let now: number
const client: ChecksClient = {
  read: async (wt) => {
    reads.push(wt)
    return answer
  },
  details: async () => {
    throw new Error('not here')
  },
  merge: async () => ({ merged: false, message: '' }),
  ready: async () => {},
}

const delay = (v: ChecksView | null) => (v?.checks.some((c) => c.verdict === 'pending') ? 1_000 : 10_000)
const isHidden = () => hidden

let host: HTMLElement
let root: Root
beforeEach(() => {
  vi.useFakeTimers()
  reads = []
  answer = VIEW
  hidden = false
  now = 0
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
})

function Probe({ worktree, store }: { worktree: string | null; store: ReturnType<typeof createChecksStore> }) {
  useLiveChecks(worktree, store, { delay, hidden: isHidden })
  return null
}

const tick = async (ms: number) =>
  act(async () => {
    now += ms
    await vi.advanceTimersByTimeAsync(ms)
  })

test('the PR is read on showing, again sooner while a check runs, and no more once the tab goes', async () => {
  const store = createChecksStore(client, () => now)
  await act(async () => root.render(<Probe worktree={WT} store={store} />))
  expect(reads).toEqual([WT])
  await tick(1_000)
  expect(reads.length).toBe(2)
  // Every check done: the pace slows.
  answer = GREEN
  await tick(1_000)
  expect(reads.length).toBe(3)
  await tick(5_000)
  expect(reads.length).toBe(3)
  await tick(5_000)
  expect(reads.length).toBe(4)

  act(() => root.render(<Probe worktree={null} store={store} />))
  await tick(60_000)
  expect(reads.length).toBe(4)
})

test('a tab shown again right after a read shows it without reading again', async () => {
  const store = createChecksStore(client, () => now)
  await act(async () => root.render(<Probe worktree={WT} store={store} />))
  act(() => root.render(<Probe worktree={null} store={store} />))
  await tick(FRESH_MS - 1_000)
  await act(async () => root.render(<Probe worktree={WT} store={store} />))
  expect(reads).toEqual([WT])
})

test('nothing is read while the window is hidden; coming back reads at once', async () => {
  answer = GREEN
  const store = createChecksStore(client, () => now)
  await act(async () => root.render(<Probe worktree={WT} store={store} />))
  hidden = true
  await tick(30_000)
  expect(reads.length).toBe(1)
  hidden = false
  await act(async () => {
    window.dispatchEvent(new Event('focus'))
    await vi.advanceTimersByTimeAsync(0)
  })
  expect(reads.length).toBe(2)
})

test('another worktree is read as soon as it is the one shown', async () => {
  const store = createChecksStore(client, () => now)
  await act(async () => root.render(<Probe worktree={WT} store={store} />))
  await act(async () => root.render(<Probe worktree="/code/other" store={store} />))
  expect(reads).toEqual([WT, '/code/other'])
})

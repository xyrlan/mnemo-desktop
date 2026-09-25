import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { TooltipProvider } from '@/ui'
import type { Destination, Sent } from './agent'
import type { CheckDetails, ChecksClient, ChecksView, MergeMethod } from './client'
import { ChecksPanel, type ChecksPanelProps } from './ChecksPanel'
import { GREEN, PR, TAIL, VIEW, WINDOWS, WINDOWS_DETAILS, WT } from './fixtures'
import { createChecksStore } from './store'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const NOW = Date.parse('2026-09-24T17:10:00Z')
const AGENT: Destination = { kind: 'agent', target: { kind: 'pane', pane: 7, title: 'fix the checks' } }

let calls: string[]
let readAnswer: ChecksView | string
let details: Record<string, CheckDetails>
let mergeRefusal: string | null
const client: ChecksClient = {
  read: async (wt) => {
    calls.push(`read ${wt}`)
    if (typeof readAnswer === 'string') throw readAnswer
    return readAnswer
  },
  details: async (_wt, url) => {
    calls.push(`details ${url}`)
    const d = details[url]
    if (!d) throw 'gh: Not Found (HTTP 404)'
    return d
  },
  merge: async (_wt, n, method: MergeMethod, sha) => {
    calls.push(`merge ${n} ${method} ${sha}`)
    if (mergeRefusal) throw mergeRefusal
    return { merged: true, message: `Merged PR #${n}` }
  },
  ready: async (_wt, n) => void calls.push(`ready ${n}`),
}

let host: HTMLElement
let root: Root
let sent: [string, string][]
let notes: string[]
let opened: [string, string][]
let created: string[]

beforeEach(() => {
  calls = []
  readAnswer = VIEW
  details = { [WINDOWS.url!]: WINDOWS_DETAILS }
  mergeRefusal = null
  sent = []
  notes = []
  opened = []
  created = []
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function show(opts: { view?: ChecksView | string | null; worktree?: string | null; destination?: Destination; send?: (wt: string, text: string) => Promise<Sent> } = {}) {
  const store = createChecksStore(client, () => NOW)
  const worktree = opts.worktree === undefined ? WT : opts.worktree
  if (opts.view !== null && worktree) {
    readAnswer = opts.view ?? VIEW
    await store.getState().load(worktree)
    calls = []
  }
  const props: ChecksPanelProps = {
    worktree,
    store,
    destination: opts.destination ?? AGENT,
    onSend:
      opts.send ??
      (async (wt, text) => {
        sent.push([wt, text])
        return { title: 'fix the checks', started: false }
      }),
    onOpenUrl: (url, title) => void opened.push([url, title]),
    onCreatePr: (wt) => void created.push(wt),
    notify: { ok: (t) => void notes.push(`ok: ${t}`), fail: (t) => void notes.push(`fail: ${t}`) },
    now: NOW,
  }
  await act(async () =>
    root.render(
      <TooltipProvider>
        <ChecksPanel {...props} />
      </TooltipProvider>,
    ),
  )
  return store
}

const $ = <T extends Element = HTMLElement>(sel: string) => host.querySelector<T>(sel)
const $$ = (sel: string) => Array.from(host.querySelectorAll<HTMLElement>(sel))
const text = () => host.textContent ?? ''
const click = async (el: Element | null) => {
  if (!el) throw new Error('nothing to click')
  await act(async () => {
    ;(el as HTMLElement).click()
    await new Promise((r) => setTimeout(r, 0))
  })
}
const button = (label: string) => $$('button').find((b) => b.textContent?.trim() === label) ?? null

test('with no worktree it says to pick one; before the first read it spins', async () => {
  await show({ worktree: null })
  expect(text()).toContain('No workspace selected')
  await show({ view: null })
  expect($('[role="status"][aria-label="Loading checks"]')).not.toBeNull()
})

test('a first read that fails says why and offers to try again', async () => {
  await show({ view: 'gh not found in PATH (brew install gh)' })
  expect(text()).toContain('Checks unavailable')
  expect(text()).toContain('gh not found in PATH')
  readAnswer = VIEW
  await click(button('Retry'))
  expect(calls).toEqual([`read ${WT}`])
  expect($('[data-pr-header]')).not.toBeNull()
})

test('a detached HEAD has no PR to show', async () => {
  await show({ view: { ...VIEW, branch: null, pr: null } })
  expect(text()).toContain('HEAD is detached')
})

test('a branch with no PR says so and offers to open one', async () => {
  await show({ view: { ...VIEW, pr: null, checks: [], threads: [], comments: [] } })
  expect(text()).toContain('No pull request')
  expect(text()).toContain('feat/checks has no pull request on GitHub.')
  await click($('[data-create-pr]'))
  expect(created).toEqual([WT])
  await click(button('Refresh'))
  expect(calls).toEqual([`read ${WT}`])
})

test('the header shows the PR, its state and where it goes, and opens it on GitHub', async () => {
  await show()
  const header = $('[data-pr-header]')!
  expect(header.textContent).toContain('#240')
  expect(header.textContent).toContain('open')
  expect(header.textContent).toContain(PR.title)
  expect(header.textContent).toContain('feat/checks → main')
  expect(header.textContent).toContain('by xyrlan')
  expect(header.textContent).toContain('+412')
  expect(header.textContent).toContain('Changes requested')
  expect(header.textContent).toContain('Updated 7m ago')
  await click(button('#240'))
  expect(opened).toEqual([[PR.url, 'PR #240']])
  await click($('button[aria-label="Refresh"]'))
  expect(calls).toEqual([`read ${WT}`])
})

test('checks list failing first, with counts, and each opens its page', async () => {
  await show()
  expect($$('[data-check]').map((r) => [r.dataset.check, r.dataset.verdict])).toEqual([
    ['test (windows-latest)', 'fail'],
    ['test (ubuntu-latest)', 'pending'],
    ['test (macos-latest)', 'pass'],
    ['vercel', 'pass'],
  ])
  const summary = $('[data-checks-list] > button')!
  expect(summary.textContent).toContain('2 passing')
  expect(summary.textContent).toContain('1 failing')
  expect(summary.textContent).toContain('1 pending')
  expect($('[data-check="test (ubuntu-latest)"]')!.textContent).toContain('In progress')
  await click($('[data-check="vercel"] button[aria-label="Open check details"]'))
  expect(opened).toEqual([['https://vercel.com/o/app/abc', 'vercel']])
  // Opening the page does not expand the row.
  expect($('[data-check-details]')).toBeNull()
  await click(summary)
  expect($$('[data-check]')).toEqual([])
})

test('a failing check opens on its failed step, annotations and log tail', async () => {
  await show()
  await click($('[data-check="test (windows-latest)"] [role="button"]'))
  expect(calls).toEqual([`details ${WINDOWS.url}`])
  const d = $('[data-check-details="test (windows-latest)"]')!
  expect(d.textContent).toContain('Failed steps')
  expect(d.textContent).toContain('Run cargo test --manifest-path src-tauri/Cargo.toml')
  expect(d.textContent).not.toContain('Run pnpm build')
  expect(d.textContent).toContain('.github:445')
  expect(d.textContent).toContain('Process completed with exit code 1.')
  expect(d.querySelector('[data-log-tail] pre')?.textContent).toBe(TAIL)
  // Closed and opened again: read once.
  await click($('[data-check="test (windows-latest)"] [role="button"]'))
  expect($('[data-check-details]')).toBeNull()
  await click($('[data-check="test (windows-latest)"] [role="button"]'))
  expect(calls).toEqual([`details ${WINDOWS.url}`])
})

test('a check whose job cannot be read says why and retries; one off Actions points to its page', async () => {
  details = {}
  await show()
  await click($('[data-check="test (windows-latest)"] [role="button"]'))
  expect($('[data-check-details] [role="alert"]')?.textContent).toContain('gh: Not Found (HTTP 404)')
  details = { [WINDOWS.url!]: WINDOWS_DETAILS }
  await click(button('Retry'))
  expect($('[data-log-tail]')).not.toBeNull()

  await click($('[data-check="vercel"] [role="button"]'))
  const v = $('[data-check-details="vercel"]')!
  expect(v.textContent).toContain('Deployment has completed')
  expect(v.textContent).toContain('did not run on GitHub Actions')
  await click(Array.from(v.querySelectorAll('button')).find((b) => b.textContent === 'Open it')!)
  expect(opened).toEqual([['https://vercel.com/o/app/abc', 'vercel']])
  expect(calls.filter((c) => c.includes('vercel'))).toEqual([])
})

test('Fix sends the failing checks with their logs to the agent, and says where it went', async () => {
  await show()
  const fix = $<HTMLButtonElement>('[data-fix]')!
  expect(fix.title).toBe('Send the failing checks and their logs to fix the checks')
  expect($('[data-triage]')!.textContent).toContain('1 failing check')
  await click(fix)
  expect(sent.length).toBe(1)
  expect(sent[0][0]).toBe(WT)
  expect(sent[0][1]).toContain('## test (windows-latest): failed')
  expect(sent[0][1]).toContain(TAIL)
  expect(notes).toEqual(['ok: Sent the failing checks to fix the checks'])
})

test('Fix with no agent starts one, and says so while it waits', async () => {
  let release!: (s: Sent) => void
  const store = await show({ destination: { kind: 'start' }, send: () => new Promise((r) => (release = r)) })
  expect($<HTMLButtonElement>('[data-fix]')!.title).toBe('Start an agent in this workspace and send it the failing checks and their logs')
  await click($('[data-fix]'))
  expect($('[data-fix]')!.textContent).toBe('Starting agent…')
  expect($<HTMLButtonElement>('[data-fix]')!.disabled).toBe(true)
  // Every other send and write waits for it.
  expect($<HTMLButtonElement>('[data-send="PRRT_1"]')!.disabled).toBe(true)
  await act(async () => release({ title: 'claude', started: true }))
  expect(notes).toEqual(['ok: Started an agent and sent it the failing checks'])
  expect(store.getState().busy[WT]).toBeNull()
})

test('with nowhere to send, Fix and send say why and do nothing', async () => {
  await show({ destination: { kind: 'none', reason: 'asker is waiting on a permission prompt: answer it first' } })
  const fix = $<HTMLButtonElement>('[data-fix]')!
  expect(fix.disabled).toBe(true)
  expect(fix.title).toBe('asker is waiting on a permission prompt: answer it first')
  expect($<HTMLButtonElement>('[data-send="PRRT_1"]')!.disabled).toBe(true)
})

test('a failed send says why', async () => {
  await show({
    send: async () => {
      throw new Error('fix the checks is no longer running in that terminal: nothing was sent')
    },
  })
  await click($('[data-fix]'))
  expect(notes).toEqual(['fail: fix the checks is no longer running in that terminal: nothing was sent'])
})

test('review threads and comments read, unresolved first, each sendable to the agent', async () => {
  await show()
  const threads = $$('[data-thread]')
  expect(threads.map((t) => t.dataset.thread)).toEqual(['PRRT_1', 'PRRT_2'])
  expect(threads[0].textContent).toContain('src-tauri/src/checks.rs:42')
  expect(threads[0].textContent).toContain('This runs `gh` with no timeout')
  expect(threads[0].textContent).toContain('Good catch, will add one.')
  expect(threads[0].querySelector('pre')?.textContent).toContain('fn gh(args')
  // Resolved: folded, marked.
  expect(threads[1].textContent).toContain('Resolved')
  expect(threads[1].textContent).toContain('Outdated')
  expect(threads[1].textContent).not.toContain('Typo in the label.')
  await click(threads[1].querySelector('button[aria-expanded]'))
  expect($('[data-thread="PRRT_2"]')!.textContent).toContain('Typo in the label.')

  const comments = $$('[data-comment]')
  expect(comments.map((c) => c.textContent)).toEqual([expect.stringContaining('changes requested'), expect.stringContaining('Does this still build on Windows?')])
  expect($('[data-comments] > button')!.textContent).toContain('4')

  await click($('[data-send="PRRT_1"]'))
  expect(sent[0][1]).toMatch(/^A review comment on pull request #240/)
  expect(sent[0][1]).toContain('src-tauri/src/checks.rs:42')
  await click(comments[1].querySelector('[data-send]'))
  expect(sent[1][1]).toMatch(/^A comment on pull request #240 \(feat\/checks → main\) by @octo-reviewer/)
  expect(notes).toEqual(['ok: Sent the review comment to fix the checks', 'ok: Sent the comment to fix the checks'])
})

test('threads that could not be read say so, and the rest stands', async () => {
  await show({ view: { ...VIEW, threads: [], comments: [], threadsError: 'HTTP 502' } })
  expect($('[data-comments]')!.textContent).toContain('Review threads could not be read: HTTP 502')
  await show({ view: { ...VIEW, threads: [], comments: [] } })
  expect($('[data-comments]')!.textContent).toContain('No comments')
})

test('merge waits while a check fails, and says why', async () => {
  await show()
  const merge = $<HTMLButtonElement>('[data-merge]')!
  expect(merge.disabled).toBe(true)
  expect(merge.title).toBe('1 check failing')
  expect($('[data-merge-block]')!.textContent).toBe('Merge waits: 1 check failing.')
})

test('a green PR merges after a confirm, pinned to the head shown', async () => {
  const store = await show({ view: GREEN })
  const merge = $<HTMLButtonElement>('[data-merge]')!
  expect(merge.disabled).toBe(false)
  expect(merge.textContent).toBe('Squash and merge')
  expect(merge.title).toContain(PR.headSha.slice(0, 7))
  await click(merge)
  expect(calls).toEqual([])
  expect($('[data-merge-confirm]')!.textContent).toContain('Squash and merge #240 into main?')
  await click(button('Cancel'))
  expect($('[data-merge-confirm]')).toBeNull()
  await click($('[data-merge]'))
  readAnswer = { ...GREEN, pr: { ...PR, state: 'merged' } }
  await click(button('Merge'))
  expect(calls).toEqual([`merge 240 squash ${PR.headSha}`, `read ${WT}`])
  expect(notes).toEqual(['ok: Merged PR #240'])
  expect(store.getState().trees[WT].view?.pr?.state).toBe('merged')
  // Merged: no actions and no triage left.
  expect($('[data-pr-actions]')).toBeNull()
  expect($('[data-triage]')).toBeNull()
})

test('a merge GitHub refuses says why', async () => {
  mergeRefusal = 'Not merged: its head moved to abc1234 since it was shown: look at the checks again'
  await show({ view: GREEN })
  await click($('[data-merge]'))
  await click(button('Merge'))
  expect(notes).toEqual(['fail: Not merged: its head moved to abc1234 since it was shown: look at the checks again'])
})

test('only the methods the repository allows are offered', async () => {
  await show({ view: { ...GREEN, mergeMethods: ['rebase'] } })
  expect($('[data-merge]')!.textContent).toBe('Rebase and merge')
  expect($('button[aria-label="Merge method"]')).toBeNull()
})

test('a draft is marked ready from here, and merges only after', async () => {
  await show({ view: { ...GREEN, pr: { ...PR, state: 'draft' } } })
  expect($<HTMLButtonElement>('[data-merge]')!.disabled).toBe(true)
  expect($<HTMLButtonElement>('[data-merge]')!.title).toBe('A draft: mark it ready for review first')
  readAnswer = GREEN
  await click($('[data-ready]'))
  expect(calls).toEqual(['ready 240', `read ${WT}`])
  expect(notes).toEqual(['ok: PR #240 is ready for review'])
  expect($('[data-ready]')).toBeNull()
})

test('a conflicting PR says what blocks it', async () => {
  await show({ view: { ...GREEN, pr: { ...PR, mergeable: 'CONFLICTING' } } })
  expect($('[data-triage]')!.textContent).toContain('Conflicts block this PR')
  expect($<HTMLButtonElement>('[data-merge]')!.title).toBe('It conflicts with main: resolve that first')
})

test('a refresh that fails keeps the PR on screen under the error', async () => {
  const store = await show()
  readAnswer = 'gh: HTTP 502'
  await act(async () => store.getState().load(WT))
  expect($('[role="alert"]')!.textContent).toBe('Could not refresh: gh: HTTP 502')
  expect($('[data-pr-header]')).not.toBeNull()
})

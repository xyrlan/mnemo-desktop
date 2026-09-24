import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { vi } from 'vitest'

import type { HomeRepo, HomeSession, HomeSnapshot, Pr } from './types'

/** Every webview command the view sent, as `<cmd> <id> [url]`. */
const sent: string[] = []
/** What `review_pr` answers next, and every read asked of it as `<root>#<n>`. */
let answer: () => Promise<unknown> = async () => review()
const reads: string[] = []
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd.startsWith('browser_')) sent.push(`${cmd} ${args?.id}${args?.url ? ` ${args.url}` : ''}${cmd.endsWith('set_bounds') ? ` w=${args?.w}` : ''}`)
    if (cmd === 'review_pr') {
      reads.push(`${args?.root}#${args?.number}`)
      return answer()
    }
    return undefined
  }),
}))
/** The merge is the cockpit's (`mergePr`, owned by pr-rows); only that it is called, and with
 *  what, is this view's. */
const merged: [string, unknown][] = []
vi.mock('../cockpit/actions', async (orig) => ({
  ...(await orig<typeof import('../cockpit/actions')>()),
  mergePr: (root: string, pr: unknown) => void merged.push([root, pr]),
}))

import PrPane, { PR_WEBVIEW } from './pr-pane'
import { homeStore } from './app-store'
import { store as layout } from '../layout/app-store'
import { cockpitStore } from '../cockpit/app-store'
import { mergeKey } from '../cockpit/actions'
import type { FileDiff, Review } from './review/types'
import type { Pr as MissionPr } from '../mission/types'
import { PAGE } from './review/types'

/** A file of `n` context-free added lines, numbered from 1. */
const file = (path: string, n: number, o: Partial<FileDiff> = {}): FileDiff => ({
  path,
  old_path: null,
  status: 'modified',
  additions: n,
  deletions: 0,
  binary: false,
  hunks: n ? [{ header: `@@ -0,0 +1,${n} @@`, lines: Array.from({ length: n }, (_, i) => ({ kind: 'add' as const, old: null, new: i + 1, text: `line ${i + 1}` })) }] : [],
  lines: n,
  ...o,
})
const review = (o: Partial<Review> = {}): Review => ({
  head: 'feat/pr-view',
  base: 'main',
  state: 'OPEN',
  draft: false,
  files: [
    {
      path: 'src/a.rs',
      old_path: null,
      status: 'modified',
      additions: 1,
      deletions: 1,
      binary: false,
      lines: 3,
      hunks: [
        {
          header: '@@ -10,2 +10,2 @@ fn run()',
          lines: [
            { kind: 'ctx', old: 10, new: 10, text: 'one' },
            { kind: 'del', old: 11, new: null, text: 'two' },
            { kind: 'add', old: null, new: 11, text: 'deux' },
          ],
        },
      ],
    },
    file('docs/new.md', 2, { status: 'added' }),
  ],
  diff_error: null,
  truncated: false,
  ...o,
})

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const sess = (o: Partial<HomeSession> & { id: string }): HomeSession => ({
  title: o.id,
  cwd: '/gh/a',
  last_at: 1,
  transcript: true,
  live: null,
  kind: 'background',
  agent: null,
  ...o,
})
const pr = (o: Partial<Pr> = {}): Pr => ({
  number: 372,
  title: 'the PR view',
  state: 'open',
  checks: 'none',
  child: null,
  url: 'https://github.com/o/a/pull/372',
  ...o,
})
const repo = (o: Partial<HomeRepo> = {}): HomeRepo => ({
  root: '/gh/a',
  name: 'a',
  last_at: 1,
  pinned: false,
  hidden: false,
  unresolved: false,
  sessions: [],
  children: [],
  ...o,
})
const snapOf = (repos: HomeRepo[]): HomeSnapshot => ({ repos, clone_base: '/gh', errors: [], protected: 0 })

let host: HTMLDivElement
let root: Root
/** The grace period `makeWebviews` waits before destroying a released webview. */
const GRACE = 300
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  sent.length = 0
  reads.length = 0
  merged.length = 0
  answer = async () => review()
  cockpitStore.setState({ jobs: {} })
  homeStore.setState({ snapshot: snapOf([]), openedPr: null, notice: null })
})
afterEach(async () => {
  // Past the grace period, so the module-level webview registry is empty for the next test.
  await act(async () => root.unmount())
  await act(async () => void vi.advanceTimersByTime(GRACE))
  host.remove()
  vi.useRealTimers()
})

const render = async (opened: { repo: string; pr: Pr }) => {
  await act(async () => root.render(<PrPane opened={opened} />))
}
const text = (sel: string) => host.querySelector(sel)?.textContent
const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === label)

test('a PR with no child still opens: number, title, checks and draft, and no child section', async () => {
  homeStore.setState({ snapshot: snapOf([repo({ prs: [pr({ checks: 'fail', state: 'draft' })] })]) })
  await render({ repo: '/gh/a', pr: pr() })
  expect(text('.hm-pr-title .hm-num')).toBe('#372')
  expect(text('.hm-pr-title')).toBe('the PR view#372')
  // The fresh snapshot wins over the row that was clicked: checks move while the view is open.
  expect(host.querySelector('.hm-checks')?.getAttribute('data-checks')).toBe('fail')
  expect(text('.hm-pr-head .hm-pr-state')).toBe('Draft')
  expect(text('.hm-pr-checks')).toBe('Checkschecks fail')
  // No child section at all, and never an empty slot where the actions were.
  expect(host.querySelector('.hm-pr-child')).toBeNull()
  expect(host.querySelector('.hm-pr-acts')).toBeNull()
})

test('a live child is named, taken over, and stopped only after a second click', async () => {
  const typed: [string | undefined, string][] = []
  const prev = layout.getState()
  layout.setState({ openCommandTab: async (cwd, cmd) => void typed.push([cwd, cmd]) })
  try {
    const kid = sess({ id: 'cccc1111-9f', title: 'Work on issue #3', live: 'bg' })
    homeStore.setState({ snapshot: snapOf([repo({ prs: [pr({ child: 'cccc1111' })], children: [kid] })]) })
    await render({ repo: '/gh/a', pr: pr({ child: 'cccc1111' }) })
    expect(text('.hm-pr-kid .hm-session-title')).toBe('Work on issue #3')
    expect(text('.hm-pr-kid .hm-live')).toBe('running in the background')
    act(() => button('Take over')!.click())
    expect(typed).toEqual([['/gh/a', 'claude attach cccc1111-9f']])
    // One click only arms the stop; the second runs it.
    act(() => button('Stop')!.click())
    expect(typed).toHaveLength(1)
    expect(button('really stop?')).toBeTruthy()
    act(() => button('really stop?')!.click())
    expect(typed[1]).toEqual(['/gh/a', 'claude stop cccc1111-9f'])
  } finally {
    layout.setState({ openCommandTab: prev.openCommandTab })
  }
})

test('a finished child can be resumed but not stopped; one this snapshot lost is only named', async () => {
  homeStore.setState({ snapshot: snapOf([repo({ prs: [pr({ child: 'dead1111' })], children: [sess({ id: 'dead1111-x' })] })]) })
  await render({ repo: '/gh/a', pr: pr({ child: 'dead1111' }) })
  expect(text('.hm-pr-kid .hm-live')).toBe('finished')
  expect(button('Resume')).toBeTruthy()
  expect(button('Stop')).toBeUndefined()

  homeStore.setState({ snapshot: snapOf([repo({ prs: [pr({ child: 'gone2222' })] })]) })
  await act(async () => root.render(<PrPane opened={{ repo: '/gh/a', pr: pr({ child: 'gone2222' }) }} />))
  expect(text('.hm-pr-kid')).toBe('child gone2222, not in this snapshot')
  expect(text('.hm-pr-child')).toBe('Opened bychild gone2222, not in this snapshot')
  expect(host.querySelector('.hm-pr-acts')).toBeNull()
})

test('the breadcrumb and ⌘← pop back to the stream', async () => {
  homeStore.setState({ snapshot: snapOf([repo({ prs: [pr()] })]), openedPr: { repo: '/gh/a', pr: pr() } })
  await render({ repo: '/gh/a', pr: pr() })
  expect(text('.hm-pr-crumbs')).toBe('a·PR #372')
  // New UI inside the old views' root opts out of their element styles.
  expect(host.querySelector('.hm-pr-view')!.hasAttribute('data-ui')).toBe(true)
  act(() => host.querySelector<HTMLButtonElement>('.hm-pr-back')!.click())
  expect(homeStore.getState().openedPr).toBeNull()

  homeStore.setState({ openedPr: { repo: '/gh/a', pr: pr() } })
  act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', metaKey: true })))
  expect(homeStore.getState().openedPr).toBeNull()
})

test('the view holds one webview, on an id the layout cannot reach, and releases it when it goes', async () => {
  expect(PR_WEBVIEW).toBeLessThan(-1000)
  homeStore.setState({ snapshot: snapOf([repo({ prs: [pr()] })]) })
  await render({ repo: '/gh/a', pr: pr() })
  expect(sent).toEqual([`browser_create ${PR_WEBVIEW} https://github.com/o/a/pull/372`])

  await act(async () => root.unmount())
  root = createRoot(host)
  // Hidden at once, destroyed once the grace period a remount would have used is over.
  expect(sent[1]).toBe(`browser_set_bounds ${PR_WEBVIEW} w=0`)
  await act(async () => void vi.advanceTimersByTime(GRACE))
  expect(sent[2]).toBe(`browser_destroy ${PR_WEBVIEW}`)
  expect(sent).toHaveLength(3)
})

test('a different PR opened inside the grace period is navigated to, not left on the old page', async () => {
  homeStore.setState({ snapshot: snapOf([repo({ prs: [pr(), pr({ number: 373, url: 'https://github.com/o/a/pull/373' })] })]) })
  await render({ repo: '/gh/a', pr: pr() })
  await act(async () => root.unmount())
  root = createRoot(host)
  await render({ repo: '/gh/a', pr: pr({ number: 373, url: 'https://github.com/o/a/pull/373' }) })
  await act(async () => void vi.advanceTimersByTime(GRACE))
  expect(sent).toEqual([
    `browser_create ${PR_WEBVIEW} https://github.com/o/a/pull/372`,
    `browser_set_bounds ${PR_WEBVIEW} w=0`,
    `browser_set_bounds ${PR_WEBVIEW} w=0`,
    `browser_navigate ${PR_WEBVIEW} https://github.com/o/a/pull/373`,
  ])
})

const tab = (mode: 'diff' | 'github') => host.querySelector<HTMLButtonElement>(`[role=tab][data-mode=${mode}]`)!
/** Radix tabs switch on mousedown, not click. */
const pickTab = (mode: 'diff' | 'github') => act(() => void tab(mode).dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })))
const lines = () => host.querySelectorAll('.rv-line').length

test('the change is read natively by default, from the repo root, beside the lens', async () => {
  homeStore.setState({ snapshot: snapOf([repo({ prs: [pr()] })]) })
  await render({ repo: '/gh/a', pr: pr() })
  expect(reads).toEqual(['/gh/a#372'])
  expect(tab('diff').getAttribute('aria-selected')).toBe('true')
  expect(text('[data-mode=diff]')).toBe('Files changed2')
  // The webview loads behind the diff at zero size; the diff is what is on screen.
  expect(host.querySelector<HTMLElement>('.hm-pr-page')!.hidden).toBe(true)
  expect(text('.rv-bar')).toBe('2 files+3 −1')
  expect(text('.hm-pr-refs')).toBe('mainfeat/pr-view')
  const heads = [...host.querySelectorAll('.rv-file-head .rv-path')].map((e) => e.textContent)
  expect(heads).toEqual(['src/a.rs', 'docs/new.md'])
  expect(text('.rv-hunk')).toBe('@@ -10,2 +10,2 @@ fn run()')
  const first = [...host.querySelectorAll('.rv-file')[0].querySelectorAll('.rv-line')].map((l) => [l.className, l.textContent])
  expect(first).toEqual([
    ['rv-line rv-ctx', '1010one'],
    ['rv-line rv-del', '11-two'],
    ['rv-line rv-add', '11+deux'],
  ])
  // The side column lists the same files.
  expect([...host.querySelectorAll('.hm-pr-files .rv-list-name')].map((e) => e.textContent)).toEqual(['a.rs src', 'new.md docs'])
})

test('GitHub is one tab away, on the webview that was loading behind the diff', async () => {
  homeStore.setState({ snapshot: snapOf([repo({ prs: [pr()] })]) })
  await render({ repo: '/gh/a', pr: pr() })
  expect(sent).toEqual([`browser_create ${PR_WEBVIEW} https://github.com/o/a/pull/372`])
  pickTab('github')
  expect(host.querySelector<HTMLElement>('.hm-pr-page')!.hidden).toBe(false)
  expect(host.querySelector('.rv')).toBeNull()
  // Switching never makes a second webview.
  expect(sent.filter((c) => c.startsWith('browser_create'))).toHaveLength(1)
  pickTab('diff')
  expect(host.querySelector('.rv')).toBeTruthy()
})

test('a diff of thousands draws a bounded page, and the rest is a click away', async () => {
  const big = [file('src/small.ts', 40), file('src/huge.ts', 3000), file('src/after.ts', 30), file('pnpm-lock.yaml', 12)]
  answer = async () => review({ files: big })
  homeStore.setState({ snapshot: snapOf([repo({ prs: [pr()] })]) })
  await render({ repo: '/gh/a', pr: pr() })
  // The huge file does not fit the opening budget; the small ones around it do. A lock file
  // starts folded whatever its size.
  const open = [...host.querySelectorAll('.rv-file-head')].map((h) => h.getAttribute('aria-expanded'))
  expect(open).toEqual(['true', 'false', 'true', 'false'])
  expect(lines()).toBe(70)
  expect(text('.rv-file:nth-child(4) .rv-generated')).toBe('generated')

  // Opened by hand, it draws one page, then one more per click.
  act(() => host.querySelectorAll<HTMLButtonElement>('.rv-file-head')[1].click())
  expect(lines()).toBe(70 + PAGE)
  const more = () => host.querySelector<HTMLButtonElement>('.rv-more')!
  expect(more().textContent).toBe(`show ${PAGE} more of ${3000 - PAGE} lines`)
  act(() => more().click())
  expect(lines()).toBe(70 + 2 * PAGE)
})

test('picking a file in the side column opens it in the diff', async () => {
  answer = async () => review({ files: [file('a.ts', 10), file('huge.ts', 3000)] })
  homeStore.setState({ snapshot: snapOf([repo({ prs: [pr()] })]) })
  await render({ repo: '/gh/a', pr: pr() })
  pickTab('github')
  act(() => host.querySelectorAll<HTMLButtonElement>('.rv-list-row')[1].click())
  // Back on the diff, with that file open.
  expect(tab('diff').getAttribute('aria-selected')).toBe('true')
  expect(host.querySelectorAll('.rv-file-head')[1].getAttribute('aria-expanded')).toBe('true')
})

test('a read gh refused says why, and offers another try or GitHub', async () => {
  answer = async () => {
    throw 'gh not found in PATH (brew install gh)'
  }
  homeStore.setState({ snapshot: snapOf([repo({ prs: [pr()] })]) })
  await render({ repo: '/gh/a', pr: pr() })
  expect(text('.rv-error')).toBe('gh not found in PATH (brew install gh)')
  // Nothing to merge without the PR's head.
  expect(button('Merge')!.disabled).toBe(true)
  answer = async () => review()
  await act(async () => button('Try again')!.click())
  expect(reads).toHaveLength(2)
  expect(host.querySelectorAll('.rv-file')).toHaveLength(2)

  answer = async () => review({ files: [file('big.lock', 0, { additions: 30000 })], diff_error: 'diff exceeded the maximum number of lines (20000)' })
  await act(async () => host.querySelector<HTMLButtonElement>('.hm-pr-reload')!.click())
  expect(text('.rv-warn span')).toBe('gh gave no diff: diff exceeded the maximum number of lines (20000)')
  expect(button('Merge')!.disabled).toBe(false)
  // The file list came from `gh pr view`: opening a file never claims it did not change.
  act(() => host.querySelector<HTMLButtonElement>('.rv-file-head')!.click())
  expect(text('.rv-msg')).toBe('gh gave no diff to show; it is on GitHub')
  act(() => button('Read it on GitHub')!.click())
  expect(tab('github').getAttribute('aria-selected')).toBe('true')
})

test('merge goes through mergePr, only on the second click, and says what its job said', async () => {
  homeStore.setState({ snapshot: snapOf([repo({ prs: [pr({ checks: 'pass' })] })]) })
  await render({ repo: '/gh/a', pr: pr() })
  act(() => button('Merge')!.click())
  expect(merged).toEqual([])
  act(() => button('really merge?')!.click())
  const target: MissionPr = { number: 372, url: 'https://github.com/o/a/pull/372', state: 'OPEN', head: 'feat/pr-view', ci: 'pass' }
  expect(merged).toEqual([['/gh/a', target]])

  // The job is the cockpit row's, by its key: a merge run there reads here too.
  const key = mergeKey('/gh/a', target)
  act(() => void cockpitStore.getState().jobStart(key, 'merge · PR #372'))
  expect(text('.hm-pr-merge-state')).toBe('merging…')
  expect(button('Merge')!.disabled).toBe(true)
  act(() => {
    cockpitStore.getState().jobLine(key, { stream: 'err', line: 'X Pull request o/a#372 is not mergeable: the base branch policy prohibits the merge.' })
    cockpitStore.getState().jobExit(key, 1)
  })
  // Refused is refused, in gh's words, and the button is back.
  expect(text('.hm-pr-merge-state')).toBe('merge failed ✗')
  expect(button('log')).toBeTruthy()
  expect(text('.hm-pr-merge-why')).toBe('X Pull request o/a#372 is not mergeable: the base branch policy prohibits the merge.')
  expect(button('Merge')!.disabled).toBe(false)
})

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { vi } from 'vitest'

import type { HomeRepo, HomeSession, HomeSnapshot, Pr } from './types'

/** Every webview command the view sent, as `<cmd> <id> [url]`. */
const sent: string[] = []
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd.startsWith('browser_')) sent.push(`${cmd} ${args?.id}${args?.url ? ` ${args.url}` : ''}${cmd.endsWith('set_bounds') ? ` w=${args?.w}` : ''}`)
    return undefined
  }),
}))

import PrPane, { PR_WEBVIEW } from './pr-pane'
import { homeStore } from './app-store'
import { store as layout } from '../layout/app-store'

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
  expect(text('.hm-pr-head .hm-num')).toBe('#372')
  expect(text('.hm-pr-title')).toBe('the PR view')
  // The fresh snapshot wins over the row that was clicked: checks move while the view is open.
  expect(text('.hm-checks')).toBe('✗')
  expect(text('.hm-pr-head .hm-agent')).toBe('draft')
  expect(text('.hm-pr-checks')).toBe('checks fail')
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
  expect(host.querySelector('.hm-pr-acts')).toBeNull()
})

test('the breadcrumb and ⌘← pop back to the stream', async () => {
  homeStore.setState({ snapshot: snapOf([repo({ prs: [pr()] })]), openedPr: { repo: '/gh/a', pr: pr() } })
  await render({ repo: '/gh/a', pr: pr() })
  expect(text('.hm-pr-crumbs')).toBe('‹ a/PR #372')
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

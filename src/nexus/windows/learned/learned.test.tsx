import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

// Synthetic: the repos are this one and `mnemo`, the paths under a made-up home.
const t = vi.hoisted(() => ({
  calls: [] as [string, Record<string, unknown> | undefined][],
  answers: {} as Record<string, string[]>,
  on: {} as Record<string, ((e: { payload: unknown }) => void)[]>,
  fleet: {
    repos: [
      { root: '/Users/you/code/mnemo-desktop', name: 'mnemo-desktop', worktrees: [] },
      { root: '/Users/you/code/mnemo', name: 'mnemo', worktrees: [] },
    ],
  },
}))

const page = (key: string, type: string, name: string) => ({ key, type, name, description: `about ${name}`, excerpt: `${name}, in full.`, staged_at: '2026-10-14T10:00:00', expires_at: '2026-10-28T10:00:00' })
const EMPTY = JSON.stringify({ project: 'mnemo-desktop', origin: 'backfill', pages: [] })
const LISTING = JSON.stringify({
  project: 'mnemo-desktop',
  origin: 'backfill',
  pages: [page('project/mnemo-desktop__one-cargo-target', 'project', 'One cargo target'), page('feedback/mnemo-desktop__run-git-yourself', 'feedback', 'Run git yourself'), page('feedback/mnemo-desktop__answer-in-english', 'feedback', 'Answer in English')],
})
const DRY = JSON.stringify({ project: 'mnemo-desktop', sessions: 12, calls_estimate: 5, api_price_estimate_usd: null })

vi.mock('@tauri-apps/api/core', () => ({
  Channel: class {},
  invoke: async (cmd: string, args?: Record<string, unknown>) => {
    t.calls.push([cmd, args])
    if (cmd === 'install_review_project') {
      const cwd = args!.cwd as string
      return { project: cwd.split('/').pop(), root: cwd }
    }
    if (cmd === 'install_review_step') {
      const step = args!.step as string
      if (step === 'promote') return { stdout: JSON.stringify({ promoted: args!.keys, failed: [] }), stderr: '', code: 0 }
      if (step === 'drop') return { stdout: JSON.stringify({ dropped: args!.keys, failed: [] }), stderr: '', code: 0 }
      const stdout = t.answers[step]?.shift()
      return stdout === undefined ? { stdout: '', stderr: 'no answer', code: 1 } : { stdout, stderr: '', code: 0 }
    }
    if (cmd === 'install_review_run') return `install-review:${args!.project}`
    return null
  },
}))
vi.mock('@tauri-apps/api/event', () => ({
  listen: async (name: string, h: (e: { payload: unknown }) => void) => {
    ;(t.on[name] ??= []).push(h)
    return () => (t.on[name] = t.on[name].filter((x) => x !== h))
  },
}))
// A stable object: a fresh array per call would loop the renders.
vi.mock('../../../fleet/store', () => ({ useFleet: <T,>(sel: (f: typeof t.fleet) => T): T => sel(t.fleet) }))

import { closeWindow, openWindow, windowStore } from '../../ui/windows'
import { WindowHost } from '../../ui/Window'
import { ConfirmHost } from '../../ui/confirm'
import { learned } from '../../../learned/app-store'
import { repoChoice } from '../memory/repo'
import { memoryTab } from '../memory/MemoryWindow'
import '../memory/index'
import './index'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))))
const click = async (el: Element | null | undefined) => {
  expect(el).toBeTruthy()
  await act(async () => void (el as HTMLElement).click())
  await flush()
}
const button = (text: string | RegExp, within: ParentNode = document) =>
  [...within.querySelectorAll('button')].find((b) => (typeof text === 'string' ? b.textContent === text : text.test(b.textContent ?? '')))
const emit = (name: string, payload: unknown) => act(async () => (t.on[name] ?? []).forEach((h) => h({ payload })))
const win = () => document.querySelector('[data-learned-window]')!
const steps = (step: string) => t.calls.filter(([c, a]) => c === 'install_review_step' && a!.step === step).map(([, a]) => a!)

let root: Root
beforeEach(async () => {
  t.calls.length = 0
  t.answers = {}
  repoChoice.setState({ root: null })
  learned.setState({ phase: { kind: 'idle' }, target: null, pages: [], checked: {}, expanded: {} })
  const host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  await act(async () =>
    root.render(
      <>
        <WindowHost />
        <ConfirmHost />
      </>,
    ),
  )
})
afterEach(async () => {
  await act(async () => closeWindow())
  await act(async () => root.unmount())
  document.body.innerHTML = ''
})

const open = async () => {
  await act(async () => openWindow('learned'))
  await flush()
}

test('asks before reading, shows the run, then the checklist; a decision that drops is confirmed', async () => {
  t.answers = { list: [EMPTY, LISTING], 'dry-run': [DRY] }
  await open()
  // The picked repo is the first the app knows.
  expect(t.calls.find(([c]) => c === 'install_review_project')![1]).toEqual({ cwd: '/Users/you/code/mnemo-desktop' })
  expect(win().textContent).toContain('mnemo can read your last 12 sessions in mnemo-desktop')
  expect(t.calls.some(([c]) => c === 'install_review_run')).toBe(false)

  await click(button('Read my history', win()))
  expect(t.calls.some(([c]) => c === 'install_review_run')).toBe(true)
  await emit('job-line', { id: 'install-review:mnemo-desktop', stream: 'out', line: JSON.stringify({ event: 'harvest', done: 3, of: 12 }) })
  expect(win().querySelector('[aria-label="reading sessions"]')!.getAttribute('aria-valuenow')).toBe('25')
  await emit('job-exit', { id: 'install-review:mnemo-desktop', code: 0 })
  await flush()

  expect(win().textContent).toContain('mnemo learned 3 pages from your history')
  expect([...win().querySelectorAll('[data-type]')].map((s) => s.getAttribute('data-type'))).toEqual(['project', 'feedback'])
  await click(button('▸Answer in Englishabout Answer in English', win()))
  expect(win().textContent).toContain('Answer in English, in full.')
  await act(async () => win().querySelector<HTMLInputElement>('[aria-label="keep Answer in English"]')!.click())

  await click(button('Keep selected (2)', win()))
  expect(document.querySelector('[data-nx-confirm]')!.textContent).toContain('Keep 2, drop 1?')
  await click(button('Cancel', document.querySelector('[data-nx-confirm]')!))
  expect(steps('promote')).toEqual([])
  await click(button('Keep selected (2)', win()))
  await click(button('Keep selected', document.querySelector('[data-nx-confirm]')!))
  expect(steps('promote')[0].keys).toEqual(['project/mnemo-desktop__one-cargo-target', 'feedback/mnemo-desktop__run-git-yourself'])
  expect(steps('drop')[0].keys).toEqual(['feedback/mnemo-desktop__answer-in-english'])
  expect(win().textContent).toContain('Kept 2, dropped 1.')
  // The window stays over the ship.
  expect(windowStore.getState().open?.id).toBe('learned')
})

test('keeping everything asks nothing; picking another repo looks at it', async () => {
  t.answers = { list: [LISTING, EMPTY], 'dry-run': [JSON.stringify({ project: 'mnemo', sessions: 0, calls_estimate: 0 })] }
  await open()
  await click(button('Keep selected (3)', win()))
  expect(document.querySelector('[data-nx-confirm]')).toBeNull()
  expect(steps('promote')[0].keys).toHaveLength(3)

  const select = win().querySelector<HTMLSelectElement>('select[aria-label=Repo]')!
  await act(async () => {
    select.value = '/Users/you/code/mnemo'
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await flush()
  expect(t.calls.filter(([c]) => c === 'install_review_project').at(-1)![1]).toEqual({ cwd: '/Users/you/code/mnemo' })
  expect(win().textContent).toContain('Nothing to review in mnemo')
})

test('a question already on screen is kept when the window opens; Inbox opens Memory on its inbox', async () => {
  learned.getState().ask({ project: 'mnemo', root: '/Users/you/code/mnemo' }, { project: 'mnemo', sessions: 4, callsEstimate: 2, priceUsd: null })
  await open()
  expect(t.calls.some(([c]) => c === 'install_review_project')).toBe(false)
  expect(win().textContent).toContain('your last 4 sessions in mnemo')
  await click(button('Not now', win()))
  expect(win().textContent).toContain('Nothing was read.')

  await click(button('Inbox', win()))
  expect(windowStore.getState().open?.id).toBe('memory')
  expect(memoryTab.getState().tab).toBe('inbox')
})

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { vi } from 'vitest'
import type { HomeSnapshot } from '../../home/types'

/** What Home and the missions answer, what `fs_list` finds in a folder, and every command sent. */
const ipc = vi.hoisted(() => ({
  sent: [] as string[],
  snapshot: null as unknown,
  mission: null as unknown,
  dirs: {} as Record<string, string[]>,
}))
vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (cmd: string, args?: Record<string, unknown>) => {
    ipc.sent.push(cmd)
    if (cmd === 'home_snapshot') return ipc.snapshot
    if (cmd === 'mission_snapshot') return ipc.mission
    if (cmd === 'fs_list') {
      const names = ipc.dirs[String(args?.dir)]
      if (!names) throw new Error('No such file or directory (os error 2)')
      return names.map((name) => ({ name, is_dir: false }))
    }
    return null
  },
}))
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }))

import { shipped } from '../../cockpit/fixtures'
import { issue, snapWithIssues } from '../../github/fixtures'
import { homeStore } from '../../home/app-store'
import { EMPTY } from '../../home/types'
import { missionStore } from '../../mission/app-store'
import { NO_ACTIONS, setActions, type Actions, type DispatchOptions, type Outcome } from '../../world/actions'
import { HOME, routeStore } from '../../world/route'
import { MissionsPanel } from './MissionsPanel'
import { launchStore, NO_FLAGS } from './store'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// The cockpit fixtures' mnemo repo: its child `c0ffee01` is on `fix/issue-40`, so #40 is in
// flight; its contract `round4` can land.
const ROOT = shipped.root
const NOTES = '/Users/me/notes'
const repo = (root: string, name: string, over: Partial<HomeSnapshot['repos'][number]> = {}): HomeSnapshot['repos'][number] => ({ root, name, last_at: 0, pinned: false, hidden: false, unresolved: false, sessions: [], children: [], ...over })
const home: HomeSnapshot = {
  ...EMPTY,
  repos: [
    repo(ROOT, 'mnemo', {
      issues: [issue({ number: 1, title: 'first' }), issue({ number: 2, title: 'second', labels: ['ui'] }), issue({ number: 3, title: 'third' }), issue({ number: 40, title: 'dispatched issue' })],
      prs: [{ number: 12, title: 'api', state: 'open', checks: 'pass', child: 'c0ffee01', url: 'https://github.com/me/mnemo/pull/12' }],
    }),
    repo(NOTES, 'notes', { issues: [issue({ number: 7, title: 'notes issue', url: 'https://github.com/me/notes/issues/7' })] }),
  ],
}

type Asked = { dispatch: [string, number[], DispatchOptions | undefined][]; contract: [string, string, DispatchOptions | undefined][]; land: [string, string][]; external: string[] }
let asked: Asked
let answers: Partial<Record<'dispatch' | 'land', Outcome>>
let undo = () => {}
let host: HTMLDivElement
let r: Root

beforeEach(() => {
  asked = { dispatch: [], contract: [], land: [], external: [] }
  answers = {}
  const acts: Actions = {
    ...NO_ACTIONS,
    dispatch: async (root, issues, options) => (asked.dispatch.push([root, issues, options]), answers.dispatch ?? { ok: true }),
    dispatchContract: async (root, path, options) => (asked.contract.push([root, path, options]), { ok: true }),
    land: async (root, feature) => (asked.land.push([root, feature]), answers.land ?? { ok: true }),
    external: async (target) => (asked.external.push(target), { ok: true }),
  }
  undo = setActions(acts)
  ipc.sent = []
  ipc.snapshot = home
  ipc.mission = snapWithIssues
  ipc.dirs = {}
  homeStore.setState({ snapshot: EMPTY, loading: false, github: 'idle', githubAt: null })
  missionStore.setState({ snapshot: { repos: [], errors: [], at: '' }, polling: false })
  launchStore.setState({ launches: [], flags: NO_FLAGS })
  routeStore.setState({ route: { ...HOME, panel: 'missions' }, recent: [] })
})
afterEach(async () => {
  await unmount()
  undo()
  document.body.innerHTML = ''
})

const settle = () => act(async () => void (await new Promise((res) => setTimeout(res, 0))))
async function mount() {
  host = document.body.appendChild(document.createElement('div'))
  r = createRoot(host)
  await act(async () => r.render(<MissionsPanel />))
  await settle()
  await settle()
}
async function unmount() {
  await act(async () => r?.unmount())
}

const panel = () => document.querySelector<HTMLElement>('[data-missions]')!
const cursor = () => document.querySelector('[data-row][data-on]')?.getAttribute('data-row')
const picked = () => [...document.querySelectorAll('[data-row][data-picked]')].map((e) => e.getAttribute('data-row')!.split('#')[1])
const foot = () => document.querySelector<HTMLElement>('[role="toolbar"]')
const launches = () => [...document.querySelectorAll<HTMLElement>('[data-launch]')]
async function press(key: string, init: KeyboardEventInit = {}) {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  await act(async () => void (document.activeElement ?? panel()).dispatchEvent(e))
  await settle()
  return e
}
/** The cursor moved onto the row whose key ends with `tail` (`#2`), from wherever it is. */
async function goTo(tail: string) {
  for (let i = 0; i < 20 && !cursor()?.endsWith(tail); i++) await press('ArrowDown')
  expect(cursor()?.endsWith(tail)).toBe(true)
}
const click = async (el: Element | null | undefined, init: MouseEventInit = {}) => {
  await act(async () => void el!.dispatchEvent(new MouseEvent('click', { bubbles: true, ...init })))
  await settle()
}

test('opening reads the sessions, then GitHub, then the missions; the cursor starts on the first row, a mission', async () => {
  await mount()
  expect(ipc.sent.filter((c) => c === 'home_snapshot' || c === 'home_refresh_github' || c === 'mission_snapshot').slice(0, 2)).toContain('home_snapshot')
  expect(ipc.sent).toContain('home_refresh_github')
  expect(ipc.sent).toContain('mission_snapshot')
  expect([...document.querySelectorAll('[data-row]')].map((e) => e.getAttribute('data-row'))).toEqual([
    `mission:${ROOT}#round4`,
    `issue:${ROOT}#1`,
    `issue:${ROOT}#2`,
    `issue:${ROOT}#3`,
    `issue:${ROOT}#40`,
    `pr:${ROOT}#12`,
    `issue:${NOTES}#7`,
  ])
  expect(cursor()).toBe(`mission:${ROOT}#round4`)
})

test('Space picks the issue under the cursor, Enter dispatches the picked ones in order with the flags as set, and the launch is listed', async () => {
  await mount()
  await goTo('#3')
  await press(' ')
  await press('ArrowUp')
  await press('ArrowUp')
  await press(' ')
  expect(picked()).toEqual(['1', '3'])
  expect(foot()!.textContent).toContain('#1, #3')
  // M three times is opus, E once is low, Y once is pr, V twice is sonnet.
  for (const k of ['m', 'm', 'm', 'e', 'y', 'v', 'v']) await press(k)
  expect(foot()!.textContent).toContain('opus · low · may pr · advisor sonnet')
  await press('Enter')
  expect(asked.dispatch).toEqual([[ROOT, [1, 3], { model: 'opus', effort: 'low', may: 'pr', advisor: 'sonnet' }]])
  expect(picked()).toEqual([])
  expect(foot()).toBeNull()
  expect(launches().map((l) => l.textContent)).toEqual([expect.stringContaining('#1, #3')])
  expect(launches()[0].textContent).toContain('opus · low · may pr · advisor sonnet')
})

test('with every flag off, a dispatch carries none', async () => {
  await mount()
  await goTo('#2')
  await press(' ')
  await press('Enter')
  expect(asked.dispatch).toEqual([[ROOT, [2], {}]])
})

test('Enter with nothing picked dispatches nothing', async () => {
  await mount()
  await goTo('#2')
  await press('Enter')
  expect(asked.dispatch).toEqual([])
  expect(launches()).toEqual([])
})

test('an issue already in flight says what works on it, cannot be picked, and opens its session on stage', async () => {
  await mount()
  await goTo('#40')
  await press(' ')
  await press('d')
  expect(picked()).toEqual([])
  expect(foot()).toBeNull()
  const row = document.querySelector(`[data-row="issue:${ROOT}#40"]`)!
  expect(row.textContent).toContain('child active')
  expect(row.querySelector('[role="checkbox"]')).toBeNull()
  await click(row.querySelector('.mn-missions-flight'))
  const route = routeStore.getState().route
  expect([route.view, route.session, route.panel]).toEqual(['console', 'c0ffee01', null])
})

test('shift with Space takes every dispatchable issue from the last pick through this one', async () => {
  await mount()
  await goTo('#1')
  await press(' ')
  await goTo('#3')
  await press(' ', { shiftKey: true })
  expect(picked()).toEqual(['1', '2', '3'])
  await press('Enter')
  expect(asked.dispatch[0][1]).toEqual([1, 2, 3])
})

test('D takes the issue under the cursor alone, whatever was picked', async () => {
  await mount()
  await goTo('#1')
  await press(' ')
  await goTo('#3')
  await press('d')
  expect(picked()).toEqual(['3'])
  await press('Enter')
  expect(asked.dispatch).toEqual([[ROOT, [3], {}]])
})

test('a batch belongs to one repo: a pick in another starts a fresh one', async () => {
  await mount()
  await goTo('#1')
  await press(' ')
  await goTo('#7')
  await press(' ')
  expect(picked()).toEqual(['7'])
  await press('Enter')
  expect(asked.dispatch).toEqual([[NOTES, [7], {}]])
})

test('Esc drops what is picked and the panel stays; with nothing armed it is left to the host, which closes it', async () => {
  await mount()
  await goTo('#1')
  await press(' ')
  const first = await press('Escape')
  expect(first.defaultPrevented).toBe(true)
  expect(picked()).toEqual([])
  const second = await press('Escape')
  expect(second.defaultPrevented).toBe(false)
})

test('L arms the landing of a mission whose pieces are in; nothing lands until Enter', async () => {
  await mount()
  expect(cursor()).toBe(`mission:${ROOT}#round4`)
  await press('l')
  expect(asked.land).toEqual([])
  expect(foot()!.getAttribute('data-armed')).toBe('land')
  expect(foot()!.textContent).toContain('round4')
  await press('Enter')
  expect(asked.land).toEqual([[ROOT, 'round4']])
  expect(asked.dispatch).toEqual([])
  expect(foot()).toBeNull()
  expect(launches()[0].textContent).toContain('land round4')
})

test('a landing that is refused says why in its row', async () => {
  answers.land = { ok: false, why: 'the rehearsal found a conflict in feat/round4/docs' }
  await mount()
  await press('l')
  await press('Enter')
  expect(launches()[0].textContent).toContain('the rehearsal found a conflict in feat/round4/docs')
  expect(launches()[0].getAttribute('data-state')).toBe('stalled')
})

test('L on a mission whose pieces are not all in says so and lands nothing; so does L where there is no mission', async () => {
  ipc.mission = { ...snapWithIssues, repos: snapWithIssues.repos.map((g) => ({ ...g, missions: g.missions.map((m) => ({ ...m, landable: false })) })) }
  await mount()
  expect(cursor()).toBe(`mission:${ROOT}#round4`)
  expect(document.querySelector('[data-landable]')).toBeNull()
  await press('l')
  await press('Enter')
  expect(foot()).toBeNull()
  expect(asked.land).toEqual([])
  expect(document.querySelector('[role="status"]')!.textContent).toContain('No mission here is ready to land.')
  await goTo('#7')
  await press('l')
  await press('Enter')
  expect(asked.land).toEqual([])
})

test('P lists the repo\'s contracts, newest first, on the first not dispatched yet; Enter dispatches it with the flags', async () => {
  // round4 is the newest and was dispatched already: the picker starts on the one after it.
  ipc.dirs[`${ROOT}/docs/contracts`] = ['round2.md', 'round4.md', 'round3.md', 'notes.txt']
  await mount()
  await press('v')
  await press('p')
  const files = [...document.querySelectorAll('[data-contract-picker] [role="radio"]')]
  expect(files.map((f) => f.querySelector('.mn-missions-text')!.textContent)).toEqual(['docs/contracts/round4.md', 'docs/contracts/round3.md', 'docs/contracts/round2.md'])
  expect(files[0].textContent).toContain('dispatched · 3 pieces')
  expect(files.map((f) => f.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false'])
  await press('Enter')
  expect(asked.contract).toEqual([[ROOT, 'docs/contracts/round3.md', { advisor: 'haiku' }]])
  expect(document.querySelector('[data-contract-picker]')).toBeNull()
  expect(launches()[0].textContent).toContain('contract docs/contracts/round3.md')
})

test('a contract dispatched before asks again before it starts every piece over', async () => {
  ipc.dirs[`${ROOT}/docs/contracts`] = ['round4.md']
  await mount()
  await press('p')
  await click(document.querySelector('[data-contract-picker] [role="radio"]'))
  await press('Enter')
  expect(asked.contract).toEqual([])
  expect(document.querySelector('[data-contract-picker] [role="alert"]')!.textContent).toContain('already dispatched as “round4” (3 pieces)')
  await press('Enter')
  expect(asked.contract).toEqual([[ROOT, 'docs/contracts/round4.md', {}]])
})

test('what was launched is kept while the app runs: the panel closed and opened again still lists it, with how it went', async () => {
  answers.dispatch = { ok: false, why: 'the same dispatch is already running' }
  await mount()
  await goTo('#2')
  await press(' ')
  await press('Enter')
  await unmount()
  await mount()
  expect(launches().length).toBe(1)
  expect(launches()[0].textContent).toContain('#2')
  expect(launches()[0].textContent).toContain('the same dispatch is already running')
  await click(launches()[0].querySelector('[aria-label="Forget #2"]'))
  expect(launches()).toEqual([])
})

test('a launch follows the snapshot: once its issue has a child, the row says how the child is doing', async () => {
  await mount()
  // #40 is the issue the fixture's child works on: launched from here, its row reads the child.
  launchStore.setState({ launches: [{ id: 9, kind: 'issues', root: ROOT, repo: 'mnemo', issues: [40], path: null, feature: null, options: {}, at: Date.now(), outcome: { ok: true } }] })
  await settle()
  expect(launches()[0].textContent).toContain('#40 child active')
  expect(launches()[0].getAttribute('data-state')).toBe('working')
})

test('O opens the row under the cursor in the browser', async () => {
  await mount()
  await goTo('#12')
  await press('o')
  await goTo('#7')
  await press('o')
  expect(asked.external).toEqual(['https://github.com/me/mnemo/pull/12', 'https://github.com/me/notes/issues/7'])
})

test('a repo\'s chip keeps the list to that repo, and the filter to what matches', async () => {
  await mount()
  await click([...document.querySelectorAll('[role="radiogroup"][aria-label="Repo"] [role="radio"]')].find((b) => b.textContent?.startsWith('notes')))
  expect([...document.querySelectorAll('[data-row]')].map((e) => e.getAttribute('data-row'))).toEqual([`issue:${NOTES}#7`])
  expect(cursor()).toBe(`issue:${NOTES}#7`)
})

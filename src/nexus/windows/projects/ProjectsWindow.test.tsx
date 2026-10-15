import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createStore } from 'zustand/vanilla'
import type { HomeRepo, HomeSession, HomeSnapshot } from '../../../home/types'
import { createSettingsStore, type Settings } from '../../../settings/store'
import type { SessionSpec } from '../../drawer/open'
import { ProjectsDepsContext, type ProjectsDeps } from './deps'
import { ProjectsWindow } from './ProjectsWindow'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const session = (id: string, live: HomeSession['live'], title = `session ${id}`): HomeSession => ({
  id,
  title,
  cwd: '/gh/mnemo',
  last_at: 1,
  transcript: true,
  live,
  kind: 'interactive',
  agent: null,
})
const repo = (name: string, extra: Partial<HomeRepo> = {}): HomeRepo => ({
  root: `/gh/${name}`,
  name,
  last_at: 1,
  pinned: false,
  hidden: false,
  unresolved: false,
  sessions: [],
  children: [],
  ...extra,
})
const SNAP: HomeSnapshot = {
  repos: [
    repo('mnemo-desktop', { sessions: [session('c1', 'here', 'tidy the bar'), session('c2', null, 'an ended one')], children: [session('r1', 'bg', 'issue 42')] }),
    repo('mnemo'),
    repo('old', { hidden: true }),
  ],
  clone_base: '/gh',
  errors: [],
  protected: 0,
}

type Rig = {
  deps: ProjectsDeps
  opened: SessionSpec[]
  written: Partial<Settings>[]
  close(): void
  closed: () => number
  loads: () => number
}

async function rig(settings: Partial<Settings> = {}, over: Partial<ProjectsDeps> = {}): Promise<Rig> {
  const opened: SessionSpec[] = []
  const written: Partial<Settings>[] = []
  let loads = 0
  let closed = 0
  const home = createStore<{ snapshot: HomeSnapshot; loading: boolean; load(): Promise<void> }>(() => ({
    snapshot: SNAP,
    loading: false,
    load: async () => void loads++,
  }))
  const store = createSettingsStore({ read: async () => settings, write: async (s) => void written.push(s) })
  await store.getState().load()
  const deps: ProjectsDeps = {
    home,
    settings: store,
    pickFolder: async () => '/gh/picked/sub',
    registerRepo: async () => '/gh/picked',
    openSession: async (spec) => void opened.push(spec),
    ...over,
  }
  return { deps, opened, written, close: () => void closed++, closed: () => closed, loads: () => loads }
}

let root: Root | null = null
async function mount(r: Rig) {
  const host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  await act(async () =>
    root!.render(
      <ProjectsDepsContext.Provider value={r.deps}>
        <ProjectsWindow close={r.close} />
      </ProjectsDepsContext.Provider>,
    ),
  )
}
afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  document.body.innerHTML = ''
})

const row = (name: string) => document.querySelector<HTMLElement>(`[data-project-root="/gh/${name}"]`)
const button = (scope: ParentNode, text: string) => {
  const b = [...scope.querySelectorAll('button')].find((x) => x.textContent?.trim() === text || x.getAttribute('aria-label') === text)
  if (!b) throw new Error(`no button ${text}`)
  return b
}
const click = (b: HTMLElement) => act(async () => b.click())
const type = (input: HTMLInputElement, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
const input = (label: string) => document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!

test('every repo the app knows is a row, with its name, its path and the sessions live in it; it reads them fresh as it opens', async () => {
  const r = await rig()
  await mount(r)
  expect(r.loads()).toBe(1)
  const rows = [...document.querySelectorAll('[data-project-root]')].map((e) => e.getAttribute('data-project-root'))
  expect(rows).toEqual(['/gh/mnemo-desktop', '/gh/mnemo'])
  const live = row('mnemo-desktop')!.querySelector('[data-project-live]')!.textContent
  expect(live).toContain('tidy the bar')
  expect(live).toContain('in the app')
  expect(live).toContain('issue 42')
  expect(live).toContain('background')
  expect(live).not.toContain('an ended one')
  expect(row('mnemo')!.textContent).toContain('/gh/mnemo')
  expect(row('mnemo')!.textContent).toContain('no session live')
})

test('a hidden repo waits behind its fold', async () => {
  await mount(await rig())
  expect(row('old')).toBeNull()
  await click(button(document, '1 hidden repo · show'))
  expect(row('old')).not.toBeNull()
})

test('the filter narrows the rows by name or path', async () => {
  await mount(await rig())
  await type(input('Filter repos'), 'desk')
  expect(document.querySelectorAll('[data-project-root]').length).toBe(1)
  await type(input('Filter repos'), 'nothing-like-it')
  expect(document.body.textContent).toContain('No repo matches.')
})

test('New session starts claude in the repo and Terminal a shell, each in a drawer tab, the window closing', async () => {
  const r = await rig()
  await mount(r)
  await click(button(row('mnemo')!, 'New session'))
  await click(button(row('mnemo-desktop')!, 'Terminal'))
  expect(r.opened).toEqual([
    { kind: 'claude', root: '/gh/mnemo' },
    { kind: 'shell', root: '/gh/mnemo-desktop' },
  ])
  expect(r.closed()).toBe(2)
})

test('a saved command runs with one click, in its repo', async () => {
  const r = await rig({ quickCommands: { '/gh/mnemo': [{ label: 'test', command: 'pnpm test' }] } })
  await mount(r)
  expect(row('mnemo-desktop')!.querySelector('[data-project-commands]')!.textContent).not.toContain('test')
  await click(button(row('mnemo')!, '▶ test'))
  expect(r.opened).toEqual([{ kind: 'command', root: '/gh/mnemo', command: 'pnpm test', label: 'test' }])
  expect(r.closed()).toBe(1)
})

test('a saved command is added to its repo, and Save waits for a label and a command', async () => {
  const r = await rig({ quickCommands: { '/gh/mnemo': [{ label: 'test', command: 'pnpm test' }] } })
  await mount(r)
  await click(button(row('mnemo')!, '+ saved command'))
  await type(input('Command label'), ' build ')
  expect(button(row('mnemo')!, 'Save').disabled).toBe(true)
  await type(input('Command'), 'pnpm build  ')
  await click(button(row('mnemo')!, 'Save'))
  expect(r.deps.settings.getState().quickCommands['/gh/mnemo']).toEqual([
    { label: 'test', command: 'pnpm test' },
    { label: 'build', command: 'pnpm build' },
  ])
  expect(r.written.at(-1)!.quickCommands).toEqual(r.deps.settings.getState().quickCommands)
  expect(input('Command label')).toBeNull()
  expect(row('mnemo')!.textContent).toContain('▶ build')
  expect(r.opened).toEqual([])
})

test('a saved command is removed, and a repo left with none drops out of the setting', async () => {
  const r = await rig({ quickCommands: { '/gh/mnemo': [{ label: 'test', command: 'pnpm test' }], '/gh/mnemo-desktop': [{ label: 'dev', command: 'pnpm dev' }, { label: 'lint', command: 'pnpm lint' }] } })
  await mount(r)
  await click(button(row('mnemo-desktop')!, 'Remove lint'))
  expect(r.deps.settings.getState().quickCommands['/gh/mnemo-desktop']).toEqual([{ label: 'dev', command: 'pnpm dev' }])
  await click(button(row('mnemo')!, 'Remove test'))
  expect(r.deps.settings.getState().quickCommands).toEqual({ '/gh/mnemo-desktop': [{ label: 'dev', command: 'pnpm dev' }] })
  expect(r.opened).toEqual([])
})

test('a command that could not be saved says so', async () => {
  const r = await rig()
  r.deps.settings.setState({ set: async () => Promise.reject(new Error('disk full')) })
  await mount(r)
  await click(button(row('mnemo')!, '+ saved command'))
  await type(input('Command label'), 'test')
  await type(input('Command'), 'pnpm test')
  await click(button(row('mnemo')!, 'Save'))
  expect(document.querySelector('[role="alert"]')!.textContent).toContain('disk full')
})

test('Add saves the picked folder’s repo as a project, shown again if hidden, and starts nothing', async () => {
  const r = await rig({ projects: ['/gh/mnemo'], homeHidden: ['/gh/picked'] })
  await mount(r)
  await click(button(document, 'Add'))
  expect(r.deps.settings.getState().projects).toEqual(['/gh/mnemo', '/gh/picked'])
  expect(r.deps.settings.getState().homeHidden).toEqual([])
  expect(r.loads()).toBe(2)
  expect(r.opened).toEqual([])
  expect(r.closed()).toBe(0)
})

test('Open folder saves the repo and starts claude in it', async () => {
  const r = await rig()
  await mount(r)
  await click(button(document, 'Open folder'))
  expect(r.deps.settings.getState().projects).toEqual(['/gh/picked'])
  expect(r.opened).toEqual([{ kind: 'claude', root: '/gh/picked' }])
  expect(r.closed()).toBe(1)
})

test('a cancelled pick does nothing, and a folder that is not a repo says why', async () => {
  const cancelled = await rig({}, { pickFolder: async () => null })
  await mount(cancelled)
  await click(button(document, 'Open folder'))
  expect(cancelled.opened).toEqual([])
  expect(document.querySelector('[role="alert"]')).toBeNull()
  await act(async () => root?.unmount())

  const refused = await rig({}, { registerRepo: async () => Promise.reject('not a git repository') })
  await mount(refused)
  await click(button(document, 'Open folder'))
  expect(document.querySelector('[role="alert"]')!.textContent).toContain('/gh/picked/sub: not a git repository')
  expect(refused.deps.settings.getState().projects).toEqual([])
  expect(refused.opened).toEqual([])
  await click(button(document, 'Dismiss'))
  expect(document.querySelector('[role="alert"]')).toBeNull()
})

test('Clone runs gh repo clone into the clone base in a drawer tab and saves the repo', async () => {
  const r = await rig({ cloneBase: '/code' })
  await mount(r)
  expect(button(document, 'Clone').disabled).toBe(true)
  await type(input('Repo to clone'), 'https://github.com/owner/mnemo.git')
  expect(document.body.textContent).toContain('into /code/mnemo')
  await click(button(document, 'Clone'))
  expect(r.opened).toEqual([{ kind: 'command', root: '/code', command: 'gh repo clone https://github.com/owner/mnemo.git /code/mnemo', label: 'clone mnemo' }])
  expect(r.deps.settings.getState().projects).toEqual(['/code/mnemo'])
  expect(r.closed()).toBe(1)
})

test('with no clone base chosen, a clone lands in the default one', async () => {
  const r = await rig()
  await mount(r)
  await type(input('Repo to clone'), 'owner/mnemo')
  await click(button(document, 'Clone'))
  expect(r.opened[0]).toMatchObject({ root: '/gh', command: 'gh repo clone owner/mnemo /gh/mnemo' })
})

test('with no repo known, the window says what to do first', async () => {
  const r = await rig()
  r.deps.home.setState({ snapshot: { ...SNAP, repos: [] } })
  await mount(r)
  expect(document.body.textContent).toContain('No repos yet. Add a folder or clone one.')
})

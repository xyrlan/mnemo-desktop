import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createStore } from 'zustand/vanilla'
import type { HomeRepo, HomeSession, HomeSnapshot } from '../../home/types'
import { createSettingsStore, type Settings } from '../../settings/store'
import { NO_ACTIONS, setActions, type Actions, type Outcome } from '../../world/actions'
import { HOME, routeStore } from '../../world/route'
import type { ProjectsDeps } from './deps'
import { ProjectsDepsContext } from './deps'
import { actOf, cursorOf, moved } from './model'
import { ProjectsPanel } from './ProjectsPanel'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const session = (id: string, live: HomeSession['live'], title = `session ${id}`): HomeSession => ({ id, title, cwd: '/gh/atlas', last_at: 1, transcript: true, live, kind: 'interactive', agent: null })
const repo = (name: string, extra: Partial<HomeRepo> = {}): HomeRepo => ({ root: `/gh/${name}`, name, last_at: 1, pinned: false, hidden: false, unresolved: false, sessions: [], children: [], ...extra })
const SNAP: HomeSnapshot = {
  repos: [repo('atlas', { sessions: [session('c1', 'here', 'tidy the bar'), session('c2', null, 'an ended one')], children: [session('r1', 'bg', 'issue 42')] }), repo('lumen'), repo('tessera'), repo('old', { hidden: true })],
  clone_base: '/gh',
  errors: [],
  protected: 0,
}
const QUICK = { '/gh/lumen': [{ label: 'dev', command: 'pnpm dev' }, { label: 'test', command: 'pnpm test' }] }

type Rig = {
  deps: ProjectsDeps
  /** Every action asked, as `name root …`. */
  asked: string[]
  /** Every command run in a terminal. */
  ran: { root: string; command: string; label: string }[]
  written: Partial<Settings>[]
  loads: () => number
}

/** `answers`: what an action answers, by name; a plain yes otherwise. */
async function rig(settings: Partial<Settings> = { quickCommands: QUICK }, answers: Partial<Record<'newSession' | 'newShell' | 'run', Outcome>> = {}, over: Partial<ProjectsDeps> = {}): Promise<Rig> {
  const asked: string[] = []
  const ran: Rig['ran'] = []
  const written: Partial<Settings>[] = []
  let loads = 0
  const home = createStore<{ snapshot: HomeSnapshot; loading: boolean; load(): Promise<void> }>(() => ({ snapshot: SNAP, loading: false, load: async () => void loads++ }))
  const store = createSettingsStore({ read: async () => settings, write: async (s) => void written.push(s) })
  await store.getState().load()
  const acts: Actions = {
    ...NO_ACTIONS,
    newSession: async (root) => (asked.push(`session ${root}`), answers.newSession ?? { ok: true }),
    newShell: async (root) => (asked.push(`shell ${root}`), answers.newShell ?? { ok: true }),
  }
  undo = setActions(acts)
  const deps: ProjectsDeps = {
    home,
    settings: store,
    pickFolder: async () => '/gh/picked/sub',
    registerRepo: async () => '/gh/picked',
    run: async (root, command, label) => (ran.push({ root, command, label }), answers.run ?? { ok: true }),
    ...over,
  }
  return { deps, asked, ran, written, loads: () => loads }
}

let root: Root | null = null
let undo = () => {}
async function mount(r: Rig) {
  routeStore.setState({ route: { ...HOME, panel: 'projects' }, recent: [] })
  const host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  await act(async () =>
    root!.render(
      <ProjectsDepsContext.Provider value={r.deps}>
        <ProjectsPanel />
      </ProjectsDepsContext.Provider>,
    ),
  )
}
afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  undo()
  document.body.innerHTML = ''
})

const panel = () => document.querySelector<HTMLElement>('[data-projects]')!
const row = (name: string) => document.querySelector<HTMLElement>(`[data-project-root="/gh/${name}"]`)
const cursor = () => document.querySelector('[data-on]')?.getAttribute('data-project-root')
const open = () => routeStore.getState().route.panel
const said = () => document.querySelector('.mn-projects-said')?.textContent ?? ''
/** A key pressed where the focus is (the list, unless a field took it). Returns the event. */
async function press(key: string, init: KeyboardEventInit = {}) {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  await act(async () => void (document.activeElement ?? panel()).dispatchEvent(e))
  return e
}
const type = (input: HTMLInputElement, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
const input = (label: string) => document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!
const button = (scope: ParentNode, text: string) => {
  const b = [...scope.querySelectorAll('button')].find((x) => x.textContent?.trim().endsWith(text) || x.getAttribute('aria-label') === text)
  if (!b) throw new Error(`no button ${text}`)
  return b
}
const click = (el: HTMLElement) => act(async () => el.click())

describe('what a key does', () => {
  test('each thing a repo starts is one key, and a modifier leaves the key to someone else', () => {
    expect(actOf({ key: 'Enter' })).toEqual({ kind: 'session' })
    expect(actOf({ key: 's' })).toEqual({ kind: 'shell' })
    expect(actOf({ key: 'S' })).toEqual({ kind: 'shell' })
    expect(actOf({ key: '1' })).toEqual({ kind: 'command', index: 0 })
    expect(actOf({ key: '9' })).toEqual({ kind: 'command', index: 8 })
    expect(actOf({ key: '0' })).toBeNull()
    expect(actOf({ key: 's', ctrlKey: true })).toBeNull()
    expect(actOf({ key: 'Enter', altKey: true })).toBeNull()
    expect(actOf({ key: 'n' })).toBeNull()
  })

  test('the cursor walks the rows and stops at the ends; one that is no longer listed lands on the first', () => {
    const roots = ['a', 'b', 'c']
    expect(moved(roots, 'a', 1)).toBe('b')
    expect(moved(roots, 'c', 1)).toBe('c')
    expect(moved(roots, 'a', -1)).toBe('a')
    expect(moved(roots, 'gone', 1)).toBe('a')
    expect(moved([], 'a', 1)).toBeNull()
    expect(cursorOf(roots, null)).toBe('a')
    expect(cursorOf(roots, 'gone')).toBe('a')
    expect(cursorOf(roots, 'c')).toBe('c')
  })
})

test('every repo the app knows is a row in Home\'s order, read fresh as the panel opens; the cursor starts on the first', async () => {
  const r = await rig()
  await mount(r)
  expect(r.loads()).toBe(1)
  expect([...document.querySelectorAll('[data-project-root]')].map((e) => e.getAttribute('data-project-root'))).toEqual(['/gh/atlas', '/gh/lumen', '/gh/tessera'])
  expect(cursor()).toBe('/gh/atlas')
  const live = row('atlas')!.querySelector('[data-project-live]')!.textContent
  expect(live).toContain('tidy the bar')
  expect(live).toContain('issue 42')
  expect(live).not.toContain('an ended one')
  expect(row('lumen')!.textContent).toContain('no session live')
})

test('Enter starts a session in the repo under the cursor, and a plain yes closes the panel', async () => {
  const r = await rig()
  await mount(r)
  await press('ArrowDown')
  expect(cursor()).toBe('/gh/lumen')
  await press('Enter')
  expect(r.asked).toEqual(['session /gh/lumen'])
  expect(open()).toBeNull()
})

test('S starts a shell there; a refusal is said in place and the panel stays', async () => {
  const r = await rig(undefined, { newShell: { ok: false, why: 'no terminal can be hosted here' } })
  await mount(r)
  await press('ArrowDown')
  await press('ArrowDown')
  await press('s')
  expect(r.asked).toEqual(['shell /gh/tessera'])
  expect(said()).toContain('Shell in tessera: no terminal can be hosted here')
  expect(document.querySelector('[role="alert"]')).not.toBeNull()
  expect(open()).toBe('projects')
})

test('an answer that comes with a note is said and the panel stays, as in the sample world', async () => {
  const r = await rig(undefined, { newSession: { ok: true, note: 'The sample world starts no session.' } })
  await mount(r)
  await press('Enter')
  expect(said()).toContain('New session in atlas: The sample world starts no session.')
  expect(open()).toBe('projects')
})

test('a digit runs the saved command at that place, in the repo, under its label', async () => {
  const r = await rig()
  await mount(r)
  await press('ArrowDown')
  await press('2')
  expect(r.ran).toEqual([{ root: '/gh/lumen', command: 'pnpm test', label: 'test' }])
  expect(open()).toBeNull()
})

test('a digit with no command behind it runs nothing and says so', async () => {
  const r = await rig()
  await mount(r)
  await press('ArrowDown')
  await press('3')
  expect(r.ran).toEqual([])
  expect(said()).toContain('lumen has no saved command 3.')
  expect(open()).toBe('projects')
})

test('a key the panel takes does not go on to the frame; one it does not take does', async () => {
  const r = await rig()
  await mount(r)
  const seen: string[] = []
  const onWindow = (e: Event) => void seen.push((e as KeyboardEvent).key)
  window.addEventListener('keydown', onWindow)
  await press('ArrowDown')
  await press('n')
  window.removeEventListener('keydown', onWindow)
  expect(seen).toEqual(['n'])
})

test('what is typed in the filter is text: it narrows the rows and starts nothing', async () => {
  const r = await rig()
  await mount(r)
  await press('/')
  expect(document.activeElement).toBe(input('Filter repos'))
  await press('s')
  await press('1')
  expect(r.asked).toEqual([])
  expect(r.ran).toEqual([])
  await type(input('Filter repos'), 'tess')
  expect([...document.querySelectorAll('[data-project-root]')].map((e) => e.getAttribute('data-project-root'))).toEqual(['/gh/tessera'])
  // The cursor was on a row the filter dropped: the keys act on the first one listed.
  expect(cursor()).toBe('/gh/tessera')
  await type(input('Filter repos'), 'nothing-like-it')
  expect(document.body.textContent).toContain('No repo matches “nothing-like-it”.')
})

test('Esc in the filter clears it and gives the keys back to the list, and the panel stays open', async () => {
  const r = await rig()
  await mount(r)
  await press('/')
  await type(input('Filter repos'), 'tess')
  const e = await press('Escape')
  expect(e.defaultPrevented).toBe(true)
  expect(input('Filter repos').value).toBe('')
  expect(document.activeElement).toBe(panel())
  await press('Enter')
  expect(r.asked).toEqual(['session /gh/atlas'])
})

test('+ writes a saved command for the repo, and it runs from the next digit', async () => {
  const r = await rig()
  await mount(r)
  await press('ArrowDown')
  await press('+')
  await type(input('Command label'), 'lint')
  await type(input('Command'), 'pnpm lint --fix')
  await click(button(row('lumen')!, 'Save'))
  expect(r.written.at(-1)!.quickCommands).toEqual({ '/gh/lumen': [...QUICK['/gh/lumen'], { label: 'lint', command: 'pnpm lint --fix' }] })
  expect(document.activeElement).toBe(panel())
  await press('3')
  expect(r.ran).toEqual([{ root: '/gh/lumen', command: 'pnpm lint --fix', label: 'lint' }])
})

test('a saved command is removed from its row', async () => {
  const r = await rig()
  await mount(r)
  await click(button(row('lumen')!, 'Remove dev'))
  expect(r.written.at(-1)!.quickCommands).toEqual({ '/gh/lumen': [{ label: 'test', command: 'pnpm test' }] })
})

test('A adds a picked folder as a project, shown again if it was hidden, and starts nothing', async () => {
  const r = await rig({ projects: ['/gh/atlas'], homeHidden: ['/gh/picked', '/gh/other'] })
  await mount(r)
  await press('a')
  expect(r.written.map((w) => w.projects).at(-1)).toEqual(['/gh/atlas', '/gh/picked'])
  expect(r.written.at(-1)!.homeHidden).toEqual(['/gh/other'])
  expect(r.loads()).toBe(2)
  expect(r.asked).toEqual([])
  expect(said()).toContain('Added picked.')
})

test('O adds the folder and starts a session in it', async () => {
  const r = await rig()
  await mount(r)
  await press('o')
  expect(r.written.at(-1)!.projects).toEqual(['/gh/picked'])
  expect(r.asked).toEqual(['session /gh/picked'])
})

test('a folder that is not a repository is said, and nothing is saved', async () => {
  const r = await rig(undefined, {}, { registerRepo: async () => Promise.reject(new Error('not a git repository')) })
  await mount(r)
  await press('a')
  expect(said()).toContain('/gh/picked/sub: not a git repository')
  expect(r.written).toEqual([])
})

test('a clone is saved as a project and run in the clone base, where it says it will land', async () => {
  const r = await rig()
  await mount(r)
  await press('g')
  expect(document.activeElement).toBe(input('Repo to clone'))
  await type(input('Repo to clone'), 'example/quill-docs')
  expect(document.body.textContent).toContain('into /gh/quill-docs')
  await click(button(document, 'Clone'))
  expect(r.written.at(-1)!.projects).toEqual(['/gh/quill-docs'])
  expect(r.ran).toEqual([{ root: '/gh', command: 'gh repo clone example/quill-docs /gh/quill-docs', label: 'clone quill-docs' }])
})

test('a live session opens on stage: Console, that session, the panel closed', async () => {
  const r = await rig()
  await mount(r)
  await click(button(row('atlas')!, 'issue 42child'))
  const route = routeStore.getState().route
  expect([route.view, route.session, route.panel]).toEqual(['console', 'r1', null])
})

test('a hidden repo waits behind its fold', async () => {
  await mount(await rig())
  expect(row('old')).toBeNull()
  await click(button(document, '1 hidden repo · show'))
  expect(row('old')).not.toBeNull()
})

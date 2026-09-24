import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import Composer, { type ComposerProps } from './Composer'
import SetupProgress, { DONE_LINGER_MS } from './SetupProgress'
import { createSetupStore } from './setup'
import { closeNewWorkspace, composerStore, openNewWorkspace } from './open'
import type { CreateInput } from './create'
import type { ProjectOption } from './match'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// The project field's list is a popover: it is never focused or opened here (no layout in jsdom,
// so floating-ui re-positions forever). The preview scenario shows it.

const projects: ProjectOption[] = [
  { id: '/gh/app', displayName: 'app', detail: '/gh/app', mainBranch: 'main', taken: ['main', 'workspace-1'] },
  { id: '/gh/lib', displayName: 'lib', detail: '/gh/lib', mainBranch: 'trunk', taken: [] },
]

let root: Root | null = null

async function mount(over: Partial<ComposerProps> = {}) {
  const created: CreateInput[] = []
  const dispatched: [string, number][] = []
  const skips: boolean[] = []
  const props: ComposerProps = {
    projects,
    defaultProject: '/gh/app',
    skipPermissions: true,
    onSkipPermissionsChange: (v) => void skips.push(v),
    setupFor: (r) => (r === '/gh/lib' ? 'make deps' : ''),
    onCreate: async (i) => void created.push(i),
    onDispatch: (r, n) => void dispatched.push([r, n]),
    ...over,
  }
  const host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  await act(async () => root!.render(<Composer {...props} />))
  return { created, dispatched, skips }
}

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')
const nameInput = () => document.getElementById(document.querySelector('label[for$="-name"]')!.getAttribute('for')!) as HTMLInputElement
const button = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith(text)) as HTMLButtonElement

async function type(input: HTMLInputElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => {
    set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const click = (el: HTMLElement) => act(async () => el.click())
const key = (el: EventTarget, init: KeyboardEventInit) => act(async () => void el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })))

afterEach(async () => {
  await act(async () => {
    closeNewWorkspace()
    root?.unmount()
  })
  root = null
  document.body.innerHTML = ''
})

test('closed until opened, then a dialog with the name focused', async () => {
  await mount()
  expect(dialog()).toBeNull()
  await act(async () => openNewWorkspace())
  expect(dialog()?.textContent).toContain('New workspace')
  expect(document.activeElement).toBe(nameInput())
  expect(nameInput().placeholder).toBe('workspace-2')
  expect(dialog()!.textContent).toContain('Branch workspace-2 in /gh/app-wt-workspace-2')
})

test('Create with nothing typed makes the default workspace in the preselected project, then closes', async () => {
  const { created } = await mount()
  await act(async () => openNewWorkspace())
  await click(button('Create'))
  expect(created).toEqual([{ repo: '/gh/app', name: 'workspace-2', base: '', setup: '', skipPermissions: true, issue: undefined }])
  expect(composerStore.getState().request).toBeNull()
  expect(dialog()).toBeNull()
})

test('the request picks the project, whose setup command fills Advanced; Enter in the name creates', async () => {
  const { created } = await mount()
  await act(async () => openNewWorkspace({ repo: '/gh/lib' }))
  expect(dialog()!.textContent).toContain('setup runs')
  await click(button('Advanced'))
  const setup = document.getElementById(document.querySelector('label[for$="-setup"]')!.getAttribute('for')!) as HTMLInputElement
  expect(setup.value).toBe('make deps')
  await type(setup, 'make all')
  const base = document.getElementById(document.querySelector('label[for$="-base"]')!.getAttribute('for')!) as HTMLInputElement
  expect(base.placeholder).toContain('trunk')
  await type(base, 'v2')
  await type(nameInput(), 'my feature')
  expect(dialog()!.textContent).toContain('Branch my-feature in /gh/lib-wt-my-feature')
  await key(nameInput(), { key: 'Enter' })
  expect(created).toEqual([{ repo: '/gh/lib', name: 'my-feature', base: 'v2', setup: 'make all', skipPermissions: true, issue: undefined }])
})

test('⌘↵ creates from anywhere in the dialog', async () => {
  const { created } = await mount()
  await act(async () => openNewWorkspace())
  await key(window, { key: 'Enter', metaKey: true })
  expect(created).toHaveLength(1)
})

test('a name with nothing usable disables Create and says why', async () => {
  const { created } = await mount()
  await act(async () => openNewWorkspace())
  await type(nameInput(), '///')
  expect(button('Create').disabled).toBe(true)
  expect(dialog()!.textContent).toContain('Use letters, digits')
  await key(nameInput(), { key: 'Enter' })
  expect(created).toEqual([])
})

test('a refusal stays in the dialog as an alert, and Create can be tried again', async () => {
  let tries = 0
  await mount({
    onCreate: async () => {
      tries++
      throw new Error('a worktree already exists at /gh/app-wt-workspace-2')
    },
  })
  await act(async () => openNewWorkspace())
  await click(button('Create'))
  expect(document.querySelector('[role="alert"]')?.textContent).toBe('a worktree already exists at /gh/app-wt-workspace-2')
  expect(dialog()).not.toBeNull()
  expect(button('Create').disabled).toBe(false)
  await click(button('Create'))
  expect(tries).toBe(2)
})

test('the skip-permissions switch shows the command claude will run and changes the setting', async () => {
  const { skips } = await mount({ skipPermissions: false })
  await act(async () => openNewWorkspace())
  const sw = document.querySelector<HTMLButtonElement>('[role="switch"]')!
  expect(sw.getAttribute('aria-checked')).toBe('false')
  expect(document.querySelector('[data-testid="agent-command"]')?.textContent).toBe('claude')
  await click(sw)
  expect(skips).toEqual([true])
})

test('opened from an issue: named after it, and Dispatch runs the dispatch instead', async () => {
  const { created, dispatched } = await mount()
  await act(async () => openNewWorkspace({ repo: '/gh/lib', issue: { number: 12, title: 'Crash on start' } }))
  expect(nameInput().value).toBe('12-crash-on-start')
  expect(dialog()!.textContent).toContain('#12')
  await click(button('Dispatch'))
  expect(dispatched).toEqual([['/gh/lib', 12]])
  expect(created).toEqual([])
  expect(dialog()).toBeNull()
})

test('without an issue there is no Dispatch', async () => {
  await mount()
  await act(async () => openNewWorkspace())
  expect(button('Dispatch')).toBeUndefined()
})

test('the issue rides along into Create', async () => {
  const { created } = await mount()
  await act(async () => openNewWorkspace({ issue: { number: 3, title: 'T' } }))
  await click(button('Create'))
  expect(created[0]).toMatchObject({ repo: '/gh/app', name: '3-t', issue: { number: 3, title: 'T' } })
})

test('with no projects, Create is off and the dialog says to add one', async () => {
  await mount({ projects: [], defaultProject: null })
  await act(async () => openNewWorkspace())
  expect(button('Create').disabled).toBe(true)
  expect(dialog()!.textContent).toContain('Add a project before creating a workspace.')
})

test('an added project is picked, and waited for until the fleet lists it', async () => {
  const props: Partial<ComposerProps> = { onAddProject: async () => '/gh/new' }
  await mount(props)
  await act(async () => openNewWorkspace())
  await click(document.querySelector<HTMLButtonElement>('button[aria-label="Add project"]')!)
  expect(dialog()!.textContent).toContain('Reading /gh/new…')
  expect(button('Create').disabled).toBe(true)
})

test('a second open starts the form over', async () => {
  await mount()
  await act(async () => openNewWorkspace())
  await type(nameInput(), 'draft')
  await act(async () => openNewWorkspace())
  expect(nameInput().value).toBe('')
})

describe('setup cards', () => {
  const ID = 'worktree-setup:/gh/app-wt-a'

  async function mountCards() {
    const store = createSetupStore()
    const opened: string[] = []
    const host = document.body.appendChild(document.createElement('div'))
    root = createRoot(host)
    await act(async () => root!.render(<SetupProgress store={store} onOpen={(p) => void opened.push(p)} />))
    return { store, opened }
  }
  const card = () => document.querySelector<HTMLElement>('[data-setup-state]')

  test('a tracked run shows its latest line, and a click opens its worktree', async () => {
    const { store, opened } = await mountCards()
    await act(async () => store.getState().line(ID, 'ignored until tracked'))
    expect(card()).toBeNull()
    await act(async () => {
      store.getState().track(ID, { path: '/gh/app-wt-a', name: 'a' })
      store.getState().line(ID, 'Progress: resolved 10')
    })
    expect(card()!.dataset.setupState).toBe('running')
    expect(card()!.textContent).toContain('Setting up a')
    expect(card()!.textContent).toContain('Progress: resolved 10')
    expect(card()!.textContent).not.toContain('ignored until tracked')
    await click(card()!.querySelector('button')!)
    expect(opened).toEqual(['/gh/app-wt-a'])
  })

  test('a failed run stays with its last lines and exit code until dismissed', async () => {
    vi.useFakeTimers()
    try {
      const { store } = await mountCards()
      await act(async () => {
        store.getState().track(ID, { path: '/gh/app-wt-a', name: 'a' })
        for (const l of ['1', '2', '3', '4', '5']) store.getState().line(ID, l)
        store.getState().exit(ID, 1)
      })
      expect(card()!.dataset.setupState).toBe('failed')
      expect(card()!.textContent).toContain('exit 1')
      const lines = [...card()!.querySelectorAll('button > div')].slice(1).map((d) => d.textContent)
      expect(lines).toEqual(['2', '3', '4', '5'])
      await act(async () => void vi.advanceTimersByTime(DONE_LINGER_MS * 2))
      expect(card()).not.toBeNull()
      await click(card()!.querySelector<HTMLElement>('button[aria-label="Dismiss"]')!)
      expect(card()).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  test('a finished run goes away by itself', async () => {
    vi.useFakeTimers()
    try {
      const { store } = await mountCards()
      await act(async () => {
        store.getState().track(ID, { path: '/gh/app-wt-a', name: 'a' })
        store.getState().exit(ID, 0)
      })
      expect(card()!.dataset.setupState).toBe('done')
      await act(async () => void vi.advanceTimersByTime(DONE_LINGER_MS - 1))
      expect(card()).not.toBeNull()
      await act(async () => void vi.advanceTimersByTime(1))
      expect(card()).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})

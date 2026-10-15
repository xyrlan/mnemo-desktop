import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { settingsStore } from '../../../settings/app-store'
import { DEFAULTS, type Settings } from '../../../settings/store'
import { WindowHost } from '../../ui/Window'
import { closeWindow, openWindow, windowsIn } from '../../ui/windows'
import './index'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** The settings file and what was written to it; `refuse` names a command that rejects. */
const file = vi.hoisted(() => ({ saved: {} as Record<string, unknown>, writes: [] as Record<string, unknown>[], refuse: {} as Record<string, string> }))
vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (cmd: string, args?: { value?: Record<string, unknown> }) => {
    if (file.refuse[cmd]) throw new Error(file.refuse[cmd])
    if (cmd === 'settings_read') return file.saved
    if (cmd === 'settings_write') return void file.writes.push(args!.value!)
    return null
  },
}))
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }))
const dialog = vi.hoisted(() => ({ answer: null as string | null }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: async () => dialog.answer }))

let unmount: () => Promise<void>

async function render(saved: Partial<Settings> = {}) {
  file.saved = saved
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  await act(async () => root.render(<WindowHost />))
  await act(async () => openWindow('settings'))
  await act(async () => new Promise((r) => setTimeout(r, 0)))
  unmount = () => act(async () => root.unmount())
}

beforeEach(() => {
  settingsStore.setState({ ...DEFAULTS, loaded: false, unreadable: null })
  file.writes = []
  file.refuse = {}
  dialog.answer = null
})
afterEach(async () => {
  await unmount?.()
  closeWindow()
  document.body.innerHTML = ''
})

const win = () => document.querySelector<HTMLElement>('[data-nx-window]')!
const setting = (id: string) => win().querySelector<HTMLElement>(`[data-setting="${id}"]`)!
const pressed = (id: string) => [...setting(id).querySelectorAll('button[aria-pressed="true"]')].map((b) => b.textContent)
const press = (id: string, text: string) =>
  act(async () => {
    ;[...setting(id).querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === text)!.click()
    await new Promise((r) => setTimeout(r, 0))
  })
const type = (el: HTMLInputElement | HTMLSelectElement, text: string) =>
  act(async () => {
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, text)
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
const submit = (form: HTMLFormElement) =>
  act(async () => {
    form.requestSubmit()
    await new Promise((r) => setTimeout(r, 0))
  })

test('Settings is the last of the three SYSTEMS windows', () => {
  const w = windowsIn('systems').find((d) => d.id === 'settings')!
  expect(w.title).toBe('Settings')
  expect(w.order).toBe(50)
})

test('each setting a person chooses is there with what it does, showing what is saved', async () => {
  await render({ outgoing: 'en', outgoingChosen: true, replyLanguage: 'pt', skipPermissions: false })
  expect([...win().querySelectorAll('[data-setting]')].map((s) => s.getAttribute('data-setting'))).toEqual(['outgoing', 'replyLanguage', 'skipPermissions', 'cloneBase', 'repoSetup'])
  for (const s of win().querySelectorAll('[data-setting]')) expect(s.querySelector('.nx-muted')!.textContent!.length).toBeGreaterThan(20)
  expect(pressed('outgoing')).toEqual(['In English'])
  expect(pressed('replyLanguage')).toEqual(['Portuguese'])
  expect(pressed('skipPermissions')).toEqual(['Off'])
  // Nothing internal: Home's order, the saved commands, the issue filters, the launch screen.
  for (const k of ['homePinned', 'homeHidden', 'quickCommands', 'issueLabels', 'projects', 'nexusAtLaunch', 'outgoingChosen']) expect(win().querySelector(`[data-setting="${k}"]`)).toBeNull()
})

test('a choice is saved as it is made, the whole file written', async () => {
  await render()
  await press('outgoing', 'In English')
  await press('replyLanguage', 'English')
  await press('skipPermissions', 'Off')
  expect(file.writes.map((w) => [w.outgoing, w.outgoingChosen, w.replyLanguage, w.skipPermissions])).toEqual([
    ['en', true, 'unchanged', true],
    ['en', true, 'en', true],
    ['en', true, 'en', false],
  ])
  expect(pressed('skipPermissions')).toEqual(['Off'])
})

test('a write that fails is said under its setting', async () => {
  await render()
  file.refuse.settings_write = 'disk full'
  await press('replyLanguage', 'Portuguese')
  expect(setting('replyLanguage').querySelector('[role="alert"]')!.textContent).toBe('Not saved: disk full')
  expect(setting('outgoing').querySelector('[role="alert"]')).toBeNull()
})

test('a file that cannot be read is said, and nothing is written over it', async () => {
  file.refuse.settings_read = 'settings.json: expected value at line 1'
  await render()
  expect(win().querySelector('.nx-set-banner')!.textContent).toContain('settings.json: expected value at line 1')
  await press('outgoing', 'In English')
  expect(file.writes).toEqual([])
  expect(setting('outgoing').querySelector('[role="alert"]')!.textContent).toContain('settings.json: expected value')
})

test('the clone folder is typed and saved, or chosen, and emptied back to the default', async () => {
  await render()
  const input = setting('cloneBase').querySelector<HTMLInputElement>('input')!
  expect(input.placeholder).toBe("the app's default")
  await type(input, '/Users/me/src')
  await submit(input.form!)
  expect(file.writes.at(-1)!.cloneBase).toBe('/Users/me/src')
  dialog.answer = '/Users/me/code'
  await press('cloneBase', 'Choose…')
  expect(file.writes.at(-1)!.cloneBase).toBe('/Users/me/code')
  expect(input.value).toBe('/Users/me/code')
  await type(input, '  ')
  await submit(input.form!)
  expect(file.writes.at(-1)!.cloneBase).toBeNull()
})

test('a repo’s worktree setup is changed, removed, and added for a repo the app knows', async () => {
  await render({ repoSetup: { '/r/mnemo': 'pnpm install' }, projects: ['/r/mnemo', '/r/mnemo-desktop'] })
  const row = setting('repoSetup').querySelector<HTMLElement>('[data-repo="/r/mnemo"]')!
  expect(row.textContent).toContain('mnemo')
  await type(row.querySelector('input')!, 'pnpm i --frozen-lockfile')
  await submit(row.querySelector('form')!)
  expect(file.writes.at(-1)!.repoSetup).toEqual({ '/r/mnemo': 'pnpm i --frozen-lockfile' })
  // The add offers only the repos with none.
  const select = setting('repoSetup').querySelector<HTMLSelectElement>('select')!
  expect([...select.options].map((o) => o.value)).toEqual(['', '/r/mnemo-desktop'])
  await type(select, '/r/mnemo-desktop')
  await type(select.form!.querySelector('input')!, 'pnpm install')
  await submit(select.form!)
  expect(file.writes.at(-1)!.repoSetup).toEqual({ '/r/mnemo': 'pnpm i --frozen-lockfile', '/r/mnemo-desktop': 'pnpm install' })
  await act(async () => setting('repoSetup').querySelector<HTMLButtonElement>('[aria-label="Remove the setup command for mnemo"]')!.click())
  await act(async () => new Promise((r) => setTimeout(r, 0)))
  expect(file.writes.at(-1)!.repoSetup).toEqual({ '/r/mnemo-desktop': 'pnpm install' })
})

test('the shell new terminals start is chosen on Windows only', async () => {
  await render()
  expect(win().querySelector('[data-setting="windowsShell"]')).toBeNull()
})

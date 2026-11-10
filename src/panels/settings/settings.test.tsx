// The Settings panel on the settings store. `settings_read` and `settings_write` are answered
// here; every path is made up.

import type { Settings } from '../../settings/store'

const t = vi.hoisted(() => ({
  file: {} as Record<string, unknown> | string,
  written: [] as Record<string, unknown>[],
  refuseWrite: null as string | null,
  shells: null as unknown,
  picked: null as string | null,
  language: [] as string[],
  fleet: {
    repos: [
      { root: 'C:/Users/you/work/lumen-web', name: 'lumen-web', worktrees: [] },
      { root: 'C:/Users/you/work/atlas-api', name: 'atlas-api', worktrees: [] },
    ],
  },
}))

vi.mock('@tauri-apps/api/core', () => ({
  Channel: class {},
  invoke: async (cmd: string, args?: Record<string, unknown>) => {
    switch (cmd) {
      case 'settings_read':
        if (typeof t.file === 'string') throw t.file
        return t.file
      case 'settings_write':
        if (t.refuseWrite) throw t.refuseWrite
        t.written.push(args!.value as Record<string, unknown>)
        return null
      case 'pty_shells':
        return t.shells
      case 'voice_set_language':
        t.language.push(args!.language as string)
        return null
      case 'app_build_info':
        return { version: '0.8.0', sha: '9f3ab21', built_at: '2026-11-09 13:49 UTC' }
      case 'app_newer_release':
        return { version: '0.9.0', url: 'https://example.org/releases/0.9.0', told: true }
      case 'home_snapshot':
        return { repos: [], clone_base: '', errors: [], protected: 0 }
    }
    return null
  },
}))
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: async () => t.picked }))
vi.mock('../../fleet/store', () => ({ useFleet: <T,>(sel: (f: typeof t.fleet) => T): T => sel(t.fleet) }))

import { settingsStore } from '../../settings/app-store'
import { DEFAULTS } from '../../settings/store'
import { button, click, draw, flush, texts, type } from '../memory/testing'
import { addable } from './model'
import { SettingsPanel } from './Settings'

const setting = (id: string) => document.querySelector(`[data-setting="${id}"]`)!
const pressed = (id: string) => setting(id).querySelector('[aria-pressed=true]')?.textContent
const last = () => t.written.at(-1) as Partial<Settings>

let undraw: (() => Promise<void>) | null = null
const open = async (file: Record<string, unknown> | string = {}) => {
  t.file = file
  undraw = await draw(<SettingsPanel />)
  await flush()
}
beforeEach(() => {
  t.written = []
  t.refuseWrite = null
  t.shells = null
  t.picked = null
  t.language = []
  settingsStore.setState({ ...DEFAULTS, loaded: false, unreadable: null })
})
afterEach(async () => {
  await undraw?.()
  undraw = null
})

test('opened, it reads the settings file and shows what it holds', async () => {
  await open({ outgoing: 'en', outgoingChosen: true, replyLanguage: 'pt', skipPermissions: false })
  expect([pressed('outgoing'), pressed('replyLanguage'), pressed('skipPermissions')]).toEqual(['In English', 'Portuguese', 'Off'])
})

test('a choice is saved as it is made: the whole file is written with it', async () => {
  await open({ replyLanguage: 'pt', cloneBase: '/Users/you/work' })
  await click(button('English', setting('replyLanguage')))
  expect(pressed('replyLanguage')).toBe('English')
  expect(t.written).toHaveLength(1)
  expect(last().replyLanguage).toBe('en')
  // What was not touched is written as it was.
  expect(last().cloneBase).toBe('/Users/you/work')
  expect(last().skipPermissions).toBe(true)
})

test('the choice already made writes nothing', async () => {
  await open({ replyLanguage: 'pt' })
  await click(button('Portuguese', setting('replyLanguage')))
  expect(t.written).toEqual([])
})

test('a setting that could not be saved says why under itself, and nowhere else', async () => {
  await open()
  t.refuseWrite = 'the disk is full'
  await click(button('Off', setting('skipPermissions')))
  expect(setting('skipPermissions').querySelector('[role=alert]')!.textContent).toBe('▲ Not saved: the disk is full')
  expect(document.querySelectorAll('[role=alert]')).toHaveLength(1)
})

test('a settings file that cannot be read is said, and a choice is refused rather than written over it', async () => {
  await open('settings.json: expected a value at line 3')
  expect(document.querySelector('.sp-notice[role=alert]')!.textContent).toContain('settings.json: expected a value at line 3. The defaults are showing, and nothing is saved until that file is fixed or moved away.')
  await click(button('In English', setting('outgoing')))
  expect(t.written).toEqual([])
  expect(setting('outgoing').querySelector('[role=alert]')!.textContent).toContain('Not saved')
})

test('the dictation language is this machine’s: it goes to the voice backend, not the settings file', async () => {
  await open()
  await click(button('Any', setting('dictationLanguage')))
  expect(t.language).toEqual(['auto'])
  expect(t.written).toEqual([])
  expect(pressed('dictationLanguage')).toBe('Any')
})

describe('where a clone lands', () => {
  test('a folder typed is saved on Enter, and emptied goes back to the app’s default', async () => {
    await open({ cloneBase: '/Users/you/work' })
    const field = () => setting('cloneBase').querySelector('input')!
    expect(button('Save', setting('cloneBase'))).toBeUndefined()
    await type(field(), '/Users/you/code')
    await click(button('Save', setting('cloneBase')))
    expect(last().cloneBase).toBe('/Users/you/code')
    await type(field(), '   ')
    await click(button('Save', setting('cloneBase')))
    expect(last().cloneBase).toBeNull()
  })

  test('a folder chosen is saved at once', async () => {
    await open()
    t.picked = '/Users/you/elsewhere'
    await click(button('Choose…'))
    expect(last().cloneBase).toBe('/Users/you/elsewhere')
  })
})

describe('the worktree setup commands', () => {
  const file = { repoSetup: { 'C:/Users/you/work/lumen-web': 'pnpm install' } }

  test('each repo that has one is listed with it, and only the others can be added', async () => {
    await open(file)
    expect(texts('[data-repo] .sp-name')).toEqual(['lumen-web'])
    expect(texts('[data-setting="repoSetup"] option')).toEqual(['a repo…', 'atlas-api'])
  })

  test('a command is added for a repo, trimmed', async () => {
    await open(file)
    const select = setting('repoSetup').querySelector('select')!
    select.value = 'C:/Users/you/work/atlas-api'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    await flush()
    await type(setting('repoSetup').querySelector('[aria-label="Setup command"]'), '  uv sync ')
    await click(button('Add'))
    expect(last().repoSetup).toEqual({ 'C:/Users/you/work/lumen-web': 'pnpm install', 'C:/Users/you/work/atlas-api': 'uv sync' })
  })

  test('a command is removed only on a second press', async () => {
    await open(file)
    await click(button('Remove the setup command for lumen-web'))
    expect(t.written).toEqual([])
    await click(button('Remove the setup command for lumen-web'))
    expect(last().repoSetup).toEqual({})
  })

  test('a repo the app knows by another spelling of its path is not offered twice', () => {
    const repos = [{ root: 'C:\\Users\\you\\work\\lumen-web' }, { root: 'c:/Users/you/work/atlas-api/' }, { root: 'C:/Users/you/work/tessera' }]
    expect(addable(repos, { 'C:/Users/you/work/lumen-web': 'pnpm install', 'C:/Users/you/work/atlas-api': 'uv sync' })).toEqual([repos[2]])
  })
})

test('the shell a new terminal starts is offered where there is more than one, and choosing writes it', async () => {
  const ua = vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')
  const shell = (id: string, label: string) => ({ id, label, kind: 'cmd', path: `C:/shells/${id}.exe` })
  t.shells = { shells: [shell('cmd', 'cmd'), shell('pwsh', 'PowerShell 7')], current: 'cmd', kind: 'cmd' }
  await open()
  expect(pressed('windowsShell')).toBe('cmd')
  await click(button('PowerShell 7'))
  expect(last().windowsShell).toBe('pwsh')
  ua.mockRestore()
})

test('the about line names the build that is running, with a newer release beside it', async () => {
  await open()
  const about = document.querySelector('[data-about]')!
  expect(about.querySelector('span')!.textContent).toBe('mnemo 0.8.0 · 9f3ab21 · built 2026-11-09 13:49 UTC')
  expect(button('0.9.0 is out', about)).toBeDefined()
})

describe('Classic interface', () => {
  test('is one button, and it shows the ship: nothing is written to the settings file', async () => {
    let shown = 0
    t.file = {}
    undraw = await draw(<SettingsPanel classic={() => (shown++, null)} />)
    await flush()
    expect(setting('classic').querySelector('.settings-name')!.textContent).toBe('Classic interface')
    expect(setting('classic').querySelector('.settings-what')!.textContent).toContain('your sessions and their terminals stay as they are')
    await click(button('Show the classic interface', setting('classic')))
    expect(shown).toBe(1)
    expect(t.written).toEqual([])
    expect(setting('classic').querySelector('[role=alert]')).toBeNull()
  })

  test('a switch that could not be kept says why under itself', async () => {
    t.file = {}
    undraw = await draw(<SettingsPanel classic={() => 'The choice could not be kept: storage is full'} />)
    await flush()
    await click(button('Show the classic interface', setting('classic')))
    expect(setting('classic').querySelector('[role=alert]')!.textContent).toBe('▲ Not saved: The choice could not be kept: storage is full')
  })
})

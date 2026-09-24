import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ToolName, ToolStatus } from './tools'

const t = vi.hoisted(() => ({
  calls: [] as string[],
  status: [] as ToolStatus[],
  install: null as null | (() => Promise<string>),
  path: null as null | (() => Promise<string>),
  on: {} as Record<string, (e: { payload: unknown }) => void>,
}))
vi.mock('@tauri-apps/api/core', () => ({
  Channel: class {},
  invoke: async (cmd: string) => {
    t.calls.push(cmd)
    if (cmd === 'tools_status') return t.status
    if (cmd === 'tools_install_mnemo') return t.install!()
    if (cmd === 'tools_add_to_path') return t.path!()
    if (cmd === 'gh_auth') return { installed: false, logged: false, login: null, scopes: [] }
    return undefined
  },
}))
vi.mock('@tauri-apps/api/event', () => ({
  listen: async (name: string, h: (e: { payload: unknown }) => void) => {
    t.on[name] = h
    return () => delete t.on[name]
  },
}))

const tool = (name: ToolName, path: string | null, over: Partial<ToolStatus> = {}): ToolStatus => ({ name, path, version: path && `${name} 1.0`, managed: false, ...over })
const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))))
const click = (el: Element | null | undefined) => act(() => void (el as HTMLElement).click())
const button = (root: Element, text: string) => [...root.querySelectorAll('button')].find((b) => b.textContent === text)
const row = (root: Element, name: ToolName) => root.querySelector(`[data-tool="${name}"]`)!
const typed: [string | undefined, string][] = []

let host: HTMLDivElement
let root: Root
const platform = (p: string) => Object.defineProperty(navigator, 'platform', { value: p, configurable: true })

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

// The first launch: nothing restored, claude and mnemo missing. The import is the launch.
test('at launch with claude and mnemo missing, onboarding opens at setup once the workspace is back', async () => {
  t.status = [tool('git', '/usr/bin/git'), tool('gh', null), tool('claude', null), tool('mnemo', null)]
  const { store } = await import('../layout/app-store')
  const { onboarding } = await import('../onboarding/app-store')
  await import('./view')
  await flush()
  expect(onboarding.getState().open).toBe(false)
  await act(() => store.getState().restore({}))
  await flush()
  expect(onboarding.getState()).toMatchObject({ open: true, step: 'setup' })
  // A dialog, not a pane: the workspace stays as it was restored.
  expect(store.getState().tabs).toHaveLength(0)

  const { all } = await import('../actions/registry')
  const action = all().find((a) => a.id === 'setup.open')!
  expect(action).toBeTruthy()
  // From the palette, with the dialog closed: the same dialog, at setup.
  onboarding.getState().close()
  await act(() => action.run())
  expect(onboarding.getState()).toMatchObject({ open: true, step: 'setup' })
  expect(Object.values(store.getState().panes).filter((p) => p.view === 'setup')).toHaveLength(0)
  onboarding.getState().close()
})

describe('the pane', () => {
  beforeEach(async () => {
    platform('MacIntel')
    t.calls.length = 0
    typed.length = 0
    const { store } = await import('../layout/app-store')
    store.setState({
      tabs: [{ id: 'tab-s', root: { kind: 'leaf', pane: -50 }, focused: -50 }],
      activeTab: 'tab-s',
      panes: { [-50]: { id: -50, view: 'setup', props: {} } },
      openCommandTab: async (cwd, cmd) => void typed.push([cwd, cmd]),
    })
    const { setup } = await import('./app-store')
    const { IDLE_RUN } = await import('./store')
    setup.setState({ rows: null, statusError: null, mnemo: IDLE_RUN, path: IDLE_RUN })
    t.status = [
      tool('git', '/usr/bin/git', { version: 'git version 2.39.5' }),
      tool('gh', null),
      tool('claude', null),
      tool('mnemo', '/Users/me/.mnemo-desktop/tools/mnemo/mnemo', { version: 'mnemo 1.6.0', managed: true }),
    ]
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  const render = async () => {
    await import('./view')
    const { paneView } = await import('../panes/registry')
    const Pane = paneView('setup')!
    await act(async () => root.render(<Pane id={-50} props={{}} />))
    await flush()
  }

  test('lists git, claude, mnemo and gh: found or missing, path, version, and who manages it', async () => {
    await render()
    expect(t.calls).toEqual(['tools_status'])
    expect([...host.querySelectorAll('.su-tool')].map((r) => [r.getAttribute('data-tool'), r.querySelector('.su-state')?.textContent])).toEqual([
      ['git', 'found'],
      ['claude', 'missing'],
      ['mnemo', 'found'],
      ['gh', 'missing'],
    ])
    expect(row(host, 'git').querySelector('.su-path')?.textContent).toBe('/usr/bin/git')
    expect(row(host, 'git').querySelector('.su-version')?.textContent).toBe('git version 2.39.5')
    expect(row(host, 'git').querySelector('.su-badge')).toBeNull()
    expect(row(host, 'mnemo').querySelector('.su-badge')?.textContent).toBe('managed by the app')
    expect(row(host, 'claude').querySelector('.su-path')).toBeNull()
    // Found tools get no install button; nothing ran without a click.
    expect(button(row(host, 'git'), 'Install git')).toBeUndefined()
    expect(button(row(host, 'mnemo'), 'Install mnemo')).toBeUndefined()
    expect(typed).toEqual([])
  })

  test('Install Claude Code types this OS’s native installer into a new terminal tab', async () => {
    await render()
    await click(button(row(host, 'claude'), 'Install Claude Code'))
    expect(typed).toEqual([[undefined, 'curl -fsSL https://claude.ai/install.sh | bash && ~/.local/bin/claude']])
    platform('Win32')
    await act(async () => root.render(<div />))
    await render()
    await click(button(row(host, 'claude'), 'Install Claude Code'))
    expect(typed[1]).toEqual([undefined, 'curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd && "%USERPROFILE%\\.local\\bin\\claude.exe"'])
    expect(row(host, 'claude').querySelector('code')?.textContent).toBe('curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd')
  })

  test('a missing gh or git gets this OS’s route, and brew only on a Mac', async () => {
    t.status = t.status.map((r) => (r.name === 'git' ? tool('git', null) : r))
    await render()
    await click(button(row(host, 'gh'), 'Install gh'))
    await click(button(row(host, 'git'), 'Install git'))
    expect(typed.map(([, c]) => c)).toEqual(['brew install gh', 'xcode-select --install'])
    platform('Win32')
    await act(async () => root.render(<div />))
    await render()
    await click(button(row(host, 'gh'), 'Install gh'))
    await click(button(row(host, 'git'), 'Install git'))
    expect(typed.slice(2).map(([, c]) => c)).toEqual(['winget install --id GitHub.cli -e --source winget', 'winget install --id Git.Git -e --source winget'])
    expect(host.textContent).not.toContain('brew')
  })

  test('Install mnemo shows its tools-install lines and its error', async () => {
    t.status = t.status.map((r) => (r.name === 'mnemo' ? tool('mnemo', null) : r))
    let fail!: (e: string) => void
    t.install = () => new Promise((_, rej) => (fail = rej))
    await render()
    await click(button(row(host, 'mnemo'), 'Install mnemo'))
    await flush()
    expect(t.calls).toContain('tools_install_mnemo')
    expect(button(row(host, 'mnemo'), 'installing…')?.disabled).toBe(true)
    await act(() => t.on['tools-install']({ payload: { tool: 'mnemo', message: 'downloading mnemo-v1.6.0-darwin-arm64.tar.gz' } }))
    await act(() => t.on['tools-install']({ payload: { tool: 'mnemo', message: 'checksum does not match' } }))
    expect(row(host, 'mnemo').querySelector('.su-output pre')?.textContent).toBe('downloading mnemo-v1.6.0-darwin-arm64.tar.gz\nchecksum does not match')
    await act(async () => fail('the download does not match its .sha256: nothing was installed'))
    await flush()
    expect(row(host, 'mnemo').querySelector('.su-output-head')?.textContent).toBe('installing mnemo failed')
    expect(row(host, 'mnemo').querySelector('pre.su-error')?.textContent).toBe('the download does not match its .sha256: nothing was installed')
    expect(button(row(host, 'mnemo'), 'Install mnemo')?.disabled).toBe(false)
  })

  test('a successful mnemo install checks again, and the row shows it found', async () => {
    t.status = t.status.map((r) => (r.name === 'mnemo' ? tool('mnemo', null) : r))
    t.install = async () => {
      t.status = t.status.map((r) => (r.name === 'mnemo' ? tool('mnemo', '/m/mnemo', { managed: true }) : r))
      return 'v1.6.0'
    }
    await render()
    await click(button(row(host, 'mnemo'), 'Install mnemo'))
    await flush()
    expect(t.calls).toEqual(['tools_status', 'tools_install_mnemo', 'tools_status'])
    expect(row(host, 'mnemo').querySelector('.su-state')?.textContent).toBe('found')
    expect(row(host, 'mnemo').querySelector('.su-output-head')?.textContent).toBe('mnemo v1.6.0 installed')
  })

  test('Check again asks tools_status; Add to PATH shows its sentence', async () => {
    t.path = async () => 'Added ~/.mnemo-desktop/tools/mnemo and ~/.local/bin to PATH in ~/.zshrc.'
    await render()
    t.status = t.status.map((r) => (r.name === 'claude' ? tool('claude', '/Users/me/.local/bin/claude') : r))
    await click(button(host, 'Check again'))
    await flush()
    expect(t.calls).toEqual(['tools_status', 'tools_status'])
    expect(row(host, 'claude').querySelector('.su-path')?.textContent).toBe('/Users/me/.local/bin/claude')
    await click(button(host, 'Add to PATH'))
    await flush()
    expect(t.calls).toContain('tools_add_to_path')
    expect(host.querySelector('.su-ok')?.textContent).toBe('Added ~/.mnemo-desktop/tools/mnemo and ~/.local/bin to PATH in ~/.zshrc.')
  })

  test('a failed check says why', async () => {
    t.status = 'unknown command tools_status' as never
    await render()
    expect(host.querySelector('.su-status-error')?.textContent).toContain('could not check the tools')
  })
})

test('Home’s account corner offers winget, not brew, on Windows', async () => {
  platform('Win32')
  const { default: Account } = await import('../github/Account')
  const el = document.createElement('div')
  const r = createRoot(el)
  await act(async () => r.render(<Account />))
  await flush()
  expect(el.querySelector('code')?.textContent).toBe('winget install --id GitHub.cli -e --source winget')
  expect(el.textContent).not.toContain('brew')
  act(() => r.unmount())
  platform('MacIntel')
})

import { vi } from 'vitest'

/** Every place that types a command at a background child types it on the child's own account:
 *  Approve (`cockpit/approve.ts`), the Dispatch tab's Take over and Stop (`dispatch/run.ts`), and
 *  the mission pane's attach (`rows.tsx`). */

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => ({})) }))
const written: [number, string][] = []
vi.mock('../pty/client', () => ({
  tauriPty: {
    spawn: async () => 1,
    write: async (pane: number, data: string) => void written.push([pane, data]),
    resize: async () => {},
    kill: async () => {},
    onExit: async () => () => {},
  },
}))

import { answerPrompt, answerStore } from '../cockpit/approve'
import { stopChild, takeOver } from '../dispatch/run'
import { PROMPT_DELAY_MS } from '../layout/store'
import { store as appStore } from '../layout/app-store'
import { attachChild } from './rows'
import { child } from './fixtures'

const onWork = child({ id: 'b0b0b0b0', session_id: 'b0b0b0b0-1', cwd: '/r-wt-1', account: 'work', account_env: { config_dir: '/Users/me/.claude-work' } })
const onDefault = child({ id: 'a1a1a1a1', cwd: '/r-wt-2', account: 'default', account_env: { config_dir: null } })
const PROMPT = ['Do you want to proceed?', '❯ 1. Yes', '  2. No']

let commands: [string | undefined, string][]
let views: { cmd: unknown; title: string | undefined }[]

beforeEach(() => {
  commands = []
  views = []
  written.length = 0
  answerStore.setState({ answers: {} })
  appStore.setState({
    tabs: [],
    activeTab: '',
    panes: {},
    openCommandTab: async (cwd, cmd) => {
      commands.push([cwd, cmd])
      appStore.setState((s) => ({ panes: { ...s.panes, 8: { id: 8, view: 'terminal', cwd } } }))
    },
    openView: (_view, props, _place, title) => void views.push({ cmd: props?.cmd, title }),
    split: async () => {
      const id = 20 + Object.keys(appStore.getState().panes).length
      appStore.setState((s) => ({ panes: { ...s.panes, [id]: { id, view: 'terminal' } } }))
    },
  })
})

test("Approve opens the attach on the child's account", async () => {
  const a = await answerPrompt(onWork, 'yes', { read: () => PROMPT, write: async () => {}, sleep: async () => {}, timeoutMs: 100 })
  expect(a.phase).toBe('sent')
  expect(commands).toEqual([['/r-wt-1', 'env CLAUDE_CONFIG_DIR=/Users/me/.claude-work claude attach b0b0b0b0']])
})

test("Take over and Stop under the Dispatch tab run on the child's account", async () => {
  vi.useFakeTimers()
  try {
    await takeOver(onWork)
    await stopChild(onDefault)
    await vi.advanceTimersByTimeAsync(PROMPT_DELAY_MS)
  } finally {
    vi.useRealTimers()
  }
  expect(written.map(([, d]) => d)).toEqual([
    'env CLAUDE_CONFIG_DIR=/Users/me/.claude-work claude attach b0b0b0b0\n',
    'env -u CLAUDE_CONFIG_DIR claude stop a1a1a1a1\n',
  ])
})

test("the mission pane's attach runs on the child's account; an id alone is typed as before", () => {
  attachChild(onWork, 'split-col')
  attachChild('c2c2c2c2')
  expect(views).toEqual([
    { cmd: 'env CLAUDE_CONFIG_DIR=/Users/me/.claude-work claude attach b0b0b0b0', title: 'attach b0b0b0b0' },
    { cmd: 'claude attach c2c2c2c2', title: 'attach c2c2c2c2' },
  ])
})

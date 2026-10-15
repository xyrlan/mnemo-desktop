import { vi } from 'vitest'

/** Every place that types a command at a background child types it on the child's own account:
 *  Approve (`cockpit/approve.ts`), in its hidden attach and in the drawer tab it opens to answer by
 *  hand. The drawer's own attach is the session host's (`session/host.ts`). */

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => ({})) }))

import { answerPrompt, answerStore } from '../cockpit/approve'
import { setNexusRoutes } from '../nexus/outside'
import { child } from './fixtures'

const onWork = child({ id: 'b0b0b0b0', session_id: 'b0b0b0b0-1', cwd: '/r-wt-1', account: 'work', account_env: { config_dir: '/Users/me/.claude-work' } })
const PROMPT = ['Do you want to proceed?', '❯ 1. Yes', '  2. No']

let commands: [string | undefined, string][]
let unset: () => void

beforeEach(() => {
  commands = []
  answerStore.setState({ answers: {} })
  unset = setNexusRoutes({ terminal: async (cwd, cmd) => void commands.push([cwd, cmd]), page: async () => {}, pages: () => {} })
})

afterEach(() => unset())

/** A hidden attach that shows `screen` once the attach is typed. */
function attach(screen: string[]) {
  const keys: string[] = []
  let shown = ['~/ $ ']
  const session = {
    lines: () => shown,
    write: async (data: string) => {
      keys.push(data)
      shown = data.startsWith('exec ') ? screen : ['❯ ']
    },
    exited: () => false,
    close: async () => {},
  }
  return { keys, session }
}

const quick = { waitingFor: async () => 'permission prompt', sleep: async () => {}, timeoutMs: 100, stepMs: 100 }

test("Approve presses the key in a hidden attach on the child's account", async () => {
  const { keys, session } = attach(PROMPT)
  const a = await answerPrompt(onWork, 'yes', { ...quick, open: async () => session })
  expect(a.phase).toBe('sent')
  expect(keys.slice(0, 2)).toEqual(['exec env CLAUDE_CONFIG_DIR=/Users/me/.claude-work claude attach b0b0b0b0\r', '1'])
  expect(commands).toEqual([])
})

test("an answer that cannot be pressed opens the attach in a drawer tab, on the child's account", async () => {
  const { session } = attach(['Attaching…'])
  const a = await answerPrompt(onWork, 'yes', { ...quick, open: async () => session })
  expect(a.phase).toBe('error')
  expect(commands).toEqual([['/r-wt-1', 'env CLAUDE_CONFIG_DIR=/Users/me/.claude-work claude attach b0b0b0b0']])
})

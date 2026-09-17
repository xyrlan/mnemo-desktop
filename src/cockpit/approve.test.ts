import { vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => ({})) }))

import { answerPane, answerPrompt, answerStore, detachAnswer, DETACH_KEY, keyFor, promptOptions } from './approve'
import { store as appStore } from '../layout/app-store'
import { child } from '../mission/fixtures'

/** The bottom of `claude attach 987fb657` parked on a Bash prompt, as xterm reads it back
 *  (captured 2026-09-15 from a real `claude --bg` child). */
const PROMPT = [
  '⏺ Running 1 shell command…',
  '  ⎿  $ touch approve-probe.txt && ls -la',
  '────────────────────────────────────────',
  ' Bash command',
  ' Tip: auto mode handles these prompts for you — choose "switch to auto mode" below',
  '',
  '   touch approve-probe.txt && ls -la',
  '   Create file and list directory',
  '',
  ' │ Claude requested permissions to edit /Users/me/probe/approve-probe.txt which is a sensitive file.',
  '',
  ' Do you want to proceed?',
  ' ❯ 1. Yes',
  '   2. Yes, and always allow access to /Users/me/probe from this project',
  '   3. Yes, and switch to auto mode · auto mode handles these prompts for you',
  '   4. No',
  '',
  ' Esc to cancel · Tab to amend',
  '',
  '',
]

const BASH = [' Do you want to proceed?', ' ❯ 1. Yes', "   2. Yes, and don't ask again for touch commands in /Users/me/probe", '   3. No, and tell Claude what to do differently (esc)', '']

test('promptOptions reads the numbered list at the bottom of the screen', () => {
  expect(promptOptions(PROMPT)).toEqual([
    { n: 1, text: 'Yes' },
    { n: 2, text: 'Yes, and always allow access to /Users/me/probe from this project' },
    { n: 3, text: 'Yes, and switch to auto mode · auto mode handles these prompts for you' },
    { n: 4, text: 'No' },
  ])
  expect(promptOptions(BASH)?.map((o) => o.n)).toEqual([1, 2, 3])
})

test('promptOptions finds nothing in a shell, a numbered plan, or a prompt scrolled far up', () => {
  expect(promptOptions(['~/probe $ ls', 'approve-probe.txt', '~/probe $ '])).toBeNull()
  expect(promptOptions(['Plan:', '1. read the file', '2. edit it', '❯ '])).toBeNull()
  expect(promptOptions([...PROMPT, ...Array.from({ length: 60 }, (_, i) => `line ${i}`)])).toBeNull()
})

test('keyFor picks the digit of the option; Esc denies when no option says No; null when not offered', () => {
  const p = promptOptions(PROMPT)!
  expect(keyFor(p, 'yes')).toBe('1')
  expect(keyFor(p, 'always')).toBe('2')
  expect(keyFor(p, 'no')).toBe('4')
  const b = promptOptions(BASH)!
  expect(keyFor(b, 'always')).toBe('2')
  expect(keyFor(b, 'no')).toBe('3')
  const bare = [{ n: 1, text: 'Yes' }, { n: 2, text: 'Yes, and switch to auto mode' }]
  expect(keyFor(bare, 'always')).toBeNull()
  expect(keyFor(bare, 'no')).toBe('\x1b')
})

const probe = child({ id: '987fb657', session_id: '987fb657-a6c1', cwd: '/Users/me/probe', tempo: 'blocked', needs: 'approve Bash: touch approve-probe.txt && ls -la', waiting_for: 'permission prompt' })

let typed: [string | undefined, string, string | undefined][]

beforeEach(() => {
  typed = []
  answerStore.setState({ answers: {} })
  appStore.setState({
    tabs: [],
    activeTab: '',
    panes: {},
    // Like the real one: a new tab whose terminal is tagged with the session.
    openCommandTab: async (cwd, cmd, sessionId) => {
      typed.push([cwd, cmd, sessionId])
      const id = 7 + typed.length
      appStore.setState((s) => ({
        tabs: [...s.tabs, { id: `tab-${id}`, root: { kind: 'leaf', pane: id }, focused: id }],
        activeTab: `tab-${id}`,
        panes: { ...s.panes, [id]: { id, view: 'terminal', cwd, sessionId } },
      }))
    },
  })
})

const deps = (screens: (string[] | undefined)[]) => {
  const writes: [number, string][] = []
  let i = 0
  return {
    writes,
    read: vi.fn(() => screens[Math.min(i++, screens.length - 1)]),
    write: async (pane: number, data: string) => void writes.push([pane, data]),
    sleep: async () => {},
    timeoutMs: 1000,
  }
}

test('Approve opens claude attach in the child cwd, waits for the prompt, and presses its key', async () => {
  const d = deps([undefined, ['Attaching…'], PROMPT])
  const a = await answerPrompt(probe, 'yes', d)
  expect(typed).toEqual([['/Users/me/probe', 'claude attach 987fb657', '987fb657-a6c1']])
  expect(d.writes).toEqual([[8, '1']])
  expect(a).toMatchObject({ phase: 'sent', choice: 'yes', pane: 8 })
  expect(answerStore.getState().answers['987fb657'].phase).toBe('sent')
  expect(answerPane('987fb657')).toBe(8)

  // The pane still shows the prompt (say the key was lost): Deny reuses it, no second attach.
  const again = deps([PROMPT])
  await answerPrompt(probe, 'no', again)
  expect(typed).toHaveLength(1)
  expect(again.writes).toEqual([[8, '4']])

  detachAnswer('987fb657', again.write)
  expect(again.writes.at(-1)).toEqual([8, DETACH_KEY])
  expect(answerPane('987fb657')).toBeNull()
})

test('an attach pane back at its shell is not typed into: a fresh attach is opened', async () => {
  await answerPrompt(probe, 'yes', deps([PROMPT]))
  const d = deps([['~/probe $ '], ['~/probe $ '], PROMPT])
  await answerPrompt(probe, 'no', d)
  expect(typed).toHaveLength(2)
  expect(d.writes).toEqual([[9, '4']])
})

test('no prompt in time, or no always-allow option: an error, nothing typed, the pane left open', async () => {
  const d = deps([['Attaching…']])
  d.timeoutMs = -1
  const a = await answerPrompt(probe, 'yes', d)
  expect(a.phase).toBe('error')
  expect(a.error).toContain('did not appear')
  expect(d.writes).toEqual([])
  expect(appStore.getState().panes[8]).toBeDefined()

  const bare = deps([[' ❯ 1. Yes', '   2. No', '']])
  const b = await answerPrompt(probe, 'always', bare)
  expect(b.phase).toBe('error')
  expect(b.error).toContain("don't ask again")
  expect(bare.writes).toEqual([])
})

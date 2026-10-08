import { vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => ({})) }))

import { answerPrompt, answerStore } from './approve'
import { DETACH_KEY, keyFor, promptOnScreen, promptOptions } from './prompt'
import type { AttachSession } from '../mission/as-me'
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

test('promptOnScreen reads what the prompt asks: its box, not the conversation above it', () => {
  const p = promptOnScreen(PROMPT)!
  expect(p.options).toHaveLength(4)
  expect(p.asks).toContain('touch approve-probe.txt && ls -la')
  expect(p.asks).toContain('Bash command')
  expect(p.asks).not.toContain('⎿')
})

const RULE = '─'.repeat(40)
/** The same child once the prompt took its answer: the call runs, the input box is back. */
const AFTER = ['⏺ Bash(touch approve-probe.txt && ls -la)', '  ⎿  approve-probe.txt', '', RULE, '❯ ', RULE]
/** A prompt for another call than the card shows. */
const OTHER = PROMPT.map((l) => l.replace('touch approve-probe.txt && ls -la', 'rm -rf build'))
/** The card's call, on a prompt that offers no "don't ask again". */
const BARE = [RULE, ' Bash command', '', '   touch approve-probe.txt && ls -la', '', ' Do you want to proceed?', ' ❯ 1. Yes', '   2. No', '']

const probe = child({ id: '987fb657', session_id: '987fb657-a6c1', cwd: '/Users/me/probe', tempo: 'blocked', needs: 'approve Bash: touch approve-probe.txt && ls -la', waiting_for: 'permission prompt' })

/** A hidden `claude attach` that draws `start` once the attach is typed, and `next(key)` after a key. */
function fakeAttach(start: string[], next: (key: string) => string[] | null = () => null) {
  const writes: string[] = []
  let screen: string[] = ['~/ $ ']
  let exited = false
  let closed = false
  const session: AttachSession = {
    lines: () => screen,
    write: async (data) => {
      writes.push(data)
      if (data === DETACH_KEY) exited = true
      else if (writes.length === 1) screen = start
      else screen = next(data) ?? screen
    },
    exited: () => exited,
    close: async () => {
      closed = true
    },
  }
  return { session, writes, closed: () => closed }
}

const quick = { sleep: async () => {}, timeoutMs: 50, stepMs: 50, waitingFor: async () => 'permission prompt' }

let typed: [string | undefined, string, string | undefined][]

beforeEach(() => {
  typed = []
  answerStore.setState({ answers: {} })
  appStore.setState({
    tabs: [],
    activeTab: '',
    panes: {},
    openCommandTab: async (cwd, cmd, sessionId) => void typed.push([cwd, cmd, sessionId]),
  })
})

test('Allow presses the prompt\'s key in a hidden attach, and leaves it once the prompt is gone: no terminal opens', async () => {
  const a = fakeAttach(PROMPT, (key) => (key === '1' ? AFTER : null))
  const answer = await answerPrompt(probe, 'yes', { ...quick, open: async () => a.session })
  expect(a.writes).toEqual(['exec claude attach 987fb657\r', '1', DETACH_KEY])
  expect(a.closed()).toBe(true)
  expect(answer).toMatchObject({ phase: 'sent', choice: 'yes' })
  expect(answerStore.getState().answers['987fb657'].phase).toBe('sent')
  expect(typed).toEqual([])
})

test('Deny and "don\'t ask again" press their own options', async () => {
  const deny = fakeAttach(PROMPT, (key) => (key === '4' ? AFTER : null))
  expect(await answerPrompt(probe, 'no', { ...quick, open: async () => deny.session })).toMatchObject({ phase: 'sent' })
  expect(deny.writes.slice(1, 2)).toEqual(['4'])
  const always = fakeAttach(PROMPT, (key) => (key === '2' ? AFTER : null))
  expect(await answerPrompt(probe, 'always', { ...quick, open: async () => always.session })).toMatchObject({ phase: 'sent' })
  expect(always.writes.slice(1, 2)).toEqual(['2'])
})

test('a prompt for another call than the card shows: nothing is pressed, and the attach opens in a terminal to answer by hand', async () => {
  const a = fakeAttach(OTHER)
  const answer = await answerPrompt(probe, 'yes', { ...quick, open: async () => a.session })
  expect(a.writes).toEqual(['exec claude attach 987fb657\r', DETACH_KEY])
  expect(answer.phase).toBe('error')
  expect(answer.error).toContain('not the one')
  expect(typed).toEqual([['/Users/me/probe', 'claude attach 987fb657', '987fb657-a6c1']])
})

test('no prompt in time: nothing is pressed, and the attach opens in a terminal', async () => {
  const a = fakeAttach(['Attaching…'])
  const answer = await answerPrompt(probe, 'yes', { ...quick, open: async () => a.session })
  expect(a.writes).toEqual(['exec claude attach 987fb657\r', DETACH_KEY])
  expect(answer.phase).toBe('error')
  expect(typed).toHaveLength(1)
})

test('"don\'t ask again" on a prompt that does not offer it: nothing is pressed, no terminal', async () => {
  const a = fakeAttach(BARE)
  const answer = await answerPrompt(probe, 'always', { ...quick, open: async () => a.session })
  expect(a.writes).toEqual(['exec claude attach 987fb657\r', DETACH_KEY])
  expect(answer.error).toContain("don't ask again")
  expect(typed).toEqual([])
})

test('a child parked on something else, or showing a question: no key, no terminal', async () => {
  let opened = 0
  const question = await answerPrompt(probe, 'yes', { ...quick, waitingFor: async () => 'input needed', open: async () => (opened++, fakeAttach(PROMPT).session) })
  expect(question.phase).toBe('error')
  expect(opened).toBe(0)

  const dialog = ['Which colour?', '', '❯ 1. Yes', '  2. No', '  3. Type something.', RULE, '  4. Chat about this']
  const a = fakeAttach(dialog)
  const shown = await answerPrompt(probe, 'yes', { ...quick, open: async () => a.session })
  expect(shown.error).toContain('question')
  expect(a.writes).toEqual(['exec claude attach 987fb657\r', DETACH_KEY])
  expect(typed).toEqual([])
})

test('a card that only knows the child waits on a prompt answers the prompt on screen', async () => {
  const bare = child({ id: '987fb657', cwd: '/Users/me/probe', needs: null, waiting_for: 'permission prompt' })
  const a = fakeAttach(OTHER, (key) => (key === '1' ? AFTER : null))
  expect(await answerPrompt(bare, 'yes', { ...quick, open: async () => a.session })).toMatchObject({ phase: 'sent' })
  expect(a.writes).toEqual(['exec claude attach 987fb657\r', '1', DETACH_KEY])
})

test('a second click while the first answer is on its way does nothing', async () => {
  answerStore.setState({ answers: { '987fb657': { choice: 'yes', phase: 'attaching', at: 1 } } })
  let opened = 0
  const again = await answerPrompt(probe, 'no', { ...quick, open: async () => (opened++, fakeAttach(PROMPT).session) })
  expect(again).toMatchObject({ phase: 'attaching', choice: 'yes' })
  expect(opened).toBe(0)
})

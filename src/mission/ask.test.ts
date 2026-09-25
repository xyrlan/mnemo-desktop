import { vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => null) }))

import { answerQuestion, answerQuestionOther, questionOnScreen, stillAsking, type Question } from './ask'
import type { AttachSession } from './as-me'
import { DETACH_KEY } from '../cockpit/approve'

/** The bottom of `claude attach` on a child parked on AskUserQuestion, as Claude Code draws the
 *  dialog: a header, the question, numbered options with their descriptions, the "Type
 *  something." row it always adds, and "Chat about this" under a rule. NOT captured from a live
 *  attach: the probe was refused in this session (see the PR), so these are drawn from the
 *  dialog's layout and must be checked against a real screen. */
const RULE = '─'.repeat(100)
const colour = (answered = false) => [
  '⏺ I need one thing from you first.',
  '',
  RULE,
  ` ${answered ? '☒' : '☐'} Colour`,
  '',
  'Which colour do you prefer?',
  '',
  '❯ 1. Red',
  '     A warm colour',
  '  2. Green',
  '     The colour of go',
  '  3. Blue',
  '  4. Type something.',
  RULE,
  '  5. Chat about this',
  '',
  'Enter to select · ↑/↓ to navigate · Esc to cancel',
]
const COLOUR = colour()

/** The second question of the same dialog: the same kind of options, another question. */
const SIZE = [
  RULE,
  ' ← ☒ Colour  ☐ Size  ✔ Submit →',
  '',
  'Which size?',
  '',
  '❯ 1. Red',
  '  2. Green',
  '  3. Type something.',
  RULE,
  'Enter to select · Esc to cancel',
]

/** The review a dialog of several questions ends on. */
const REVIEW = [
  RULE,
  ' ← ☒ Colour  ☒ Size  ✔ Submit →',
  '',
  'Review your answers',
  '',
  ' ● Which colour do you prefer?',
  '   → Red',
  '',
  'Ready to submit your answers?',
  '',
  '❯ 1. Submit answers',
  '  2. Cancel',
]

/** The idle input box after the dialog closed. */
const IDLE = ['⏺ User answered Claude\'s questions:', '  ⎿  · Which colour do you prefer? → Red', '', '✻ Thinking…', '', RULE, '❯ ', RULE, '  -- INSERT --']

/** A Bash permission prompt: `1` would allow it. */
const PROMPT = [RULE, ' Bash command', '', '   rm -rf build', '', ' Do you want to proceed?', ' ❯ 1. Yes', '   2. No', '', ' Esc to cancel']

test('questionOnScreen reads the options, skipping their descriptions, and the row that takes words', () => {
  const q = questionOnScreen(COLOUR) as Question
  expect(q.kind).toBe('question')
  expect(q.options).toEqual([
    { n: 1, text: 'Red' },
    { n: 2, text: 'Green' },
    { n: 3, text: 'Blue' },
  ])
  expect(q.other).toBe(4)
  expect(q.multi).toBe(false)
  expect(q.sig).toContain('Which colour do you prefer?')
})

test('questionOnScreen tells a question from a permission prompt, the input box, and a review', () => {
  expect(questionOnScreen(PROMPT)).toBeNull()
  expect(questionOnScreen(IDLE)).toBeNull()
  expect(questionOnScreen(['~ $ exec claude attach abc', 'Attaching…'])).toBeNull()
  expect(questionOnScreen(REVIEW)).toMatchObject({ kind: 'review', submit: 1 })
  // Options that are ticked take several answers: a digit does not answer them.
  const ticks = COLOUR.map((l) => l.replace(/(\d)\. (Red|Green|Blue)/, '$1. [ ] $2'))
  expect(questionOnScreen(ticks)).toMatchObject({ kind: 'question', multi: true })
})

test('stillAsking holds while the words are typed into the last row, and not once the next question shows', () => {
  const q = questionOnScreen(COLOUR) as Question
  expect(stillAsking(COLOUR.map((l) => (l.includes('Type something') ? '❯ 4. purple, please' : l)), q)).toBe(true)
  expect(stillAsking(colour(true), q)).toBe(false)
  expect(stillAsking(SIZE, q)).toBe(false)
  expect(stillAsking(IDLE, q)).toBe(false)
})

/** A fake attach whose screen follows the keys: `screens[key]` is what a key leads to. */
function fakeAttach(start: string[], next: (key: string, screen: string[]) => string[] | null = () => null, drawAfter = 1) {
  const writes: string[] = []
  let screen: string[] = ['~/ $ ']
  let polls = 0
  let exited = false
  let closed = false
  const session: AttachSession = {
    lines: () => {
      polls++
      if (writes.length === 1 && polls > drawAfter) screen = start
      return screen
    },
    write: async (data) => {
      writes.push(data)
      if (data === DETACH_KEY) exited = true
      else if (writes.length > 1) screen = next(data, screen) ?? screen
    },
    exited: () => exited,
    close: async () => {
      closed = true
    },
  }
  return { session, writes, closed: () => closed }
}

const quick = { sleep: async () => {}, timeoutMs: 50, stepMs: 50, waitingFor: async () => 'input needed' }

test('answerQuestion presses the option\'s number, waits for the dialog to close, then detaches', async () => {
  const a = fakeAttach(COLOUR, (key) => (key === '2' ? IDLE : null))
  await answerQuestion('c7bb555c', 1, { ...quick, open: async () => a.session })
  expect(a.writes).toEqual(['exec claude attach c7bb555c\r', '2', DETACH_KEY])
  expect(a.closed()).toBe(true)
})

test('answerQuestion takes the next question showing as the answer taken, and submits the review after the last', async () => {
  const first = fakeAttach(COLOUR, (key) => (key === '1' ? SIZE : null))
  await answerQuestion('c7bb555c', 0, { ...quick, open: async () => first.session })
  expect(first.writes).toEqual(['exec claude attach c7bb555c\r', '1', DETACH_KEY])

  const last = fakeAttach(SIZE, (key, screen) => (screen === SIZE && key === '2' ? REVIEW : screen === REVIEW && key === '1' ? IDLE : null))
  await answerQuestion('c7bb555c', 1, { ...quick, open: async () => last.session })
  expect(last.writes).toEqual(['exec claude attach c7bb555c\r', '2', '1', DETACH_KEY])
})

test('answerQuestion never attaches unless the child says it waits for input', async () => {
  const open = vi.fn()
  await expect(answerQuestion('c7bb555c', 0, { ...quick, waitingFor: async () => 'permission prompt', open })).rejects.toThrow('permission prompt, not a question')
  await expect(answerQuestion('c7bb555c', 0, { ...quick, waitingFor: async () => null, open })).rejects.toThrow('not asking a question now')
  expect(open).not.toHaveBeenCalled()
})

test('answerQuestion types nothing on a permission prompt, a review, or an option the dialog does not have', async () => {
  for (const [screen, why, index] of [
    [PROMPT, 'permission prompt', 0],
    [REVIEW, 'on its review', 0],
    [COLOUR, 'has 3 options, not 5', 4],
  ] as const) {
    const a = fakeAttach([...screen])
    await expect(answerQuestion('c7bb555c', index, { ...quick, open: async () => a.session })).rejects.toThrow(why)
    expect(a.writes).toEqual(['exec claude attach c7bb555c\r', DETACH_KEY])
    expect(a.closed()).toBe(true)
  }
})

test('answerQuestion refuses a question that takes several answers', async () => {
  const a = fakeAttach(COLOUR.map((l) => l.replace(/(\d)\. (Red|Green|Blue)/, '$1. [ ] $2')))
  await expect(answerQuestion('c7bb555c', 0, { ...quick, open: async () => a.session })).rejects.toThrow('several answers')
  expect(a.writes).toEqual(['exec claude attach c7bb555c\r', DETACH_KEY])
})

test('answerQuestion says so when the dialog did not take the key', async () => {
  const a = fakeAttach(COLOUR)
  await expect(answerQuestion('c7bb555c', 0, { ...quick, open: async () => a.session })).rejects.toThrow('the question took the answer did not happen')
  expect(a.writes.at(-1)).toBe(DETACH_KEY)
})

test('answerQuestionOther picks the words row, types them on one line, and presses Enter once they show', async () => {
  const typing = (words: string) => COLOUR.map((l) => (l.includes('Type something') ? `❯ 4. ${words}` : l))
  const a = fakeAttach(COLOUR, (key, screen) => {
    if (key === '4') return typing('')
    if (key === '\r') return IDLE
    if (screen !== COLOUR) return typing(key)
    return null
  })
  await answerQuestionOther('c7bb555c', 'purple,\nplease', { ...quick, open: async () => a.session })
  expect(a.writes).toEqual(['exec claude attach c7bb555c\r', '4', 'purple, please', '\r', DETACH_KEY])
})

test('answerQuestionOther does not press Enter when the words never showed', async () => {
  const a = fakeAttach(COLOUR)
  await expect(answerQuestionOther('c7bb555c', 'purple', { ...quick, open: async () => a.session })).rejects.toThrow('the words showed')
  expect(a.writes).not.toContain('\r')
  await expect(answerQuestionOther('c7bb555c', ' \n ', { ...quick })).rejects.toThrow('nothing to send')
})

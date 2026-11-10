import { KEY_GAP_MS, SUBMIT_GAP_MS } from '../chat-input/pty'
import { answerInWords, pickOption, pressPermission, sameOption, sendPrompt, type PaneDeps } from './pane-keys'

const RULE = '─'.repeat(60)

/** Claude Code's permission prompt, as a terminal draws it. */
const PERMISSION = [
  '● I will run the suite.',
  RULE,
  ' Bash command',
  '',
  '   cd /Users/you/work/atlas-api && npm test',
  '   Run the suite',
  '',
  ' Do you want to proceed?',
  ' ❯ 1. Yes',
  "   2. Yes, and don't ask again for npm test commands in /Users/you/work/atlas-api",
  '   3. No, and tell Claude what to do differently (esc)',
]
const CARD = 'Bash: cd /Users/you/work/atlas-api && npm test'

/** Its multiple-choice dialog. */
const QUESTION = [
  RULE,
  ' Backfill the new column online in batches, or take a short maintenance window?',
  '',
  ' ❯ 1. Online, in batches (Recommended)',
  '      No downtime; the backfill runs for about 40 minutes.',
  '   2. Maintenance window',
  '   3. Type something.',
  '   4. Chat about this',
]

const box = (text: string, status = '  ? for shortcuts') => ['● Done.', RULE, `❯ ${text}`, RULE, status]

function pane(lines: string[] | undefined, runs: boolean | Error = true) {
  const did: string[] = []
  const d: PaneDeps = {
    screen: async () => lines,
    async runsClaude() {
      if (runs instanceof Error) throw runs
      return runs
    },
    write: async (id, data) => void did.push(`write ${id} ${JSON.stringify(data)}`),
    prompt: async (id, text) => void did.push(`prompt ${id} ${text}`),
    sleep: async (ms) => void did.push(`sleep ${ms}`),
  }
  return { d, did }
}

describe('a permission prompt in a terminal of the app', () => {
  test.each([
    ['yes', '1'],
    ['always', '2'],
    ['no', '3'],
  ] as const)('%s presses the key of that option', async (choice, key) => {
    const { d, did } = pane(PERMISSION)
    await pressPermission(d, 7, choice, CARD)
    expect(did).toEqual([`write 7 "${key}"`])
  })

  test('the prompt on screen must be the one the card shows', async () => {
    const { d, did } = pane(PERMISSION)
    await expect(pressPermission(d, 7, 'yes', 'Bash: git push origin main')).rejects.toThrow('not the one this card shows')
    expect(did).toEqual([])
  })

  test('a card that knows only that it waits presses the prompt that is there', async () => {
    const { d, did } = pane(PERMISSION)
    await pressPermission(d, 7, 'yes', null)
    expect(did).toEqual(['write 7 "1"'])
  })

  test('nothing is pressed on a question, on no prompt, or in a terminal that runs nothing', async () => {
    const asking = pane(QUESTION)
    await expect(pressPermission(asking.d, 7, 'yes', null)).rejects.toThrow('a question, not a permission prompt')
    const idle = pane(box(''))
    await expect(pressPermission(idle.d, 7, 'yes', null)).rejects.toThrow('No permission prompt is on its screen')
    const ended = pane(PERMISSION, false)
    await expect(pressPermission(ended.d, 7, 'yes', CARD)).rejects.toThrow('Nothing runs in its terminal')
    const unknown = pane(PERMISSION, new Error('Cannot tell whether Claude is running in that terminal'))
    await expect(pressPermission(unknown.d, 7, 'yes', CARD)).rejects.toThrow('Cannot tell')
    const unread = pane(undefined)
    await expect(pressPermission(unread.d, 7, 'yes', CARD)).rejects.toThrow('could not be read')
    expect([...asking.did, ...idle.did, ...ended.did, ...unknown.did, ...unread.did]).toEqual([])
  })

  test('"always" is refused where the prompt does not offer it', async () => {
    const { d, did } = pane([RULE, ' Edit file', '   src/a.ts', ' ❯ 1. Yes', '   2. No'])
    await expect(pressPermission(d, 7, 'always', null)).rejects.toThrow('does not offer')
    expect(did).toEqual([])
  })
})

describe('a question in a terminal of the app', () => {
  test("an option is picked by its digit, when it is the card's", async () => {
    const { d, did } = pane(QUESTION)
    await pickOption(d, 7, 1, 'Maintenance window')
    expect(did).toEqual(['write 7 "2"'])
  })

  test('another question on screen is not answered', async () => {
    const { d, did } = pane(QUESTION)
    await expect(pickOption(d, 7, 1, 'Skip the backfill')).rejects.toThrow('not the one this card shows')
    await expect(pickOption(d, 7, 4, 'A fifth')).rejects.toThrow('has 2 options, not 5')
    expect(did).toEqual([])
  })

  test('a digit is never pressed on a permission prompt', async () => {
    const { d, did } = pane(PERMISSION)
    await expect(pickOption(d, 7, 0, 'Yes')).rejects.toThrow('a permission prompt, not a question')
    await expect(answerInWords(d, 7, 'do it online')).rejects.toThrow('a permission prompt, not a question')
    expect(did).toEqual([])
  })

  test('in words: the "Type something." row, the words on one line, then Enter', async () => {
    const { d, did } = pane(QUESTION)
    await answerInWords(d, 7, 'online,\nbut pause at night')
    expect(did).toEqual(['write 7 "3"', `sleep ${KEY_GAP_MS}`, 'write 7 "online, but pause at night"', `sleep ${SUBMIT_GAP_MS}`, 'write 7 "\\r"'])
  })

  test('an option cut short on screen is still the card\'s', () => {
    expect(sameOption('Online, in batches (Recomm…', 'Online, in batches (Recommended)')).toBe(true)
    expect(sameOption('Online,  in batches (recommended)', 'Online, in batches (Recommended)')).toBe(true)
    expect(sameOption('Maintenance window', 'Online, in batches (Recommended)')).toBe(false)
    expect(sameOption('', 'Online')).toBe(false)
  })
})

describe('a turn typed into a terminal of the app', () => {
  test('goes in when the input box is on screen and empty', async () => {
    const { d, did } = pane(box(''))
    await sendPrompt(d, 7, 'run the suite again')
    expect(did).toEqual(['prompt 7 run the suite again'])
  })

  test('nothing is typed into a box that holds a draft', async () => {
    const { d, did } = pane(box('half a thought'))
    await expect(sendPrompt(d, 7, 'run the suite again')).rejects.toThrow('already holds "half a thought"')
    expect(did).toEqual([])
  })

  test('nor while a dialog is up, in vim NORMAL mode, with no box, or as a ! command', async () => {
    const cases: [string[], string, string][] = [
      [PERMISSION, 'continue', 'answer it first'],
      [QUESTION, 'continue', 'answer it first'],
      [box('', '  -- NORMAL --'), 'continue', 'vim NORMAL'],
      [['$ npm test', 'ok'], 'continue', 'input box is not on screen'],
      [box(''), '!rm -rf .', 'would run as a shell command'],
      [box(''), '   ', 'Nothing to send'],
    ]
    for (const [lines, text, why] of cases) {
      const { d, did } = pane(lines)
      await expect(sendPrompt(d, 7, text)).rejects.toThrow(why)
      expect(did).toEqual([])
    }
  })
})

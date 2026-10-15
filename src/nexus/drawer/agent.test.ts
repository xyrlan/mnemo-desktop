import { BACKSPACE, CLEAR_LINE, ENTER, ESC, promptBytes } from '../../chat-input/pty'
import { attachAgent, sessionAgent, statusOf, type AgentSinks } from './agent'
import { captainOf, child, INPUT, NORMAL, parent, PERMISSION, QUESTION, robotOf, SHELL } from './fixtures'

function sinks(screen: { lines: string[] | undefined }) {
  const typed: string[] = []
  const s: AgentSinks = {
    pane: {
      sendPrompt: async (p, t) => void typed.push(`pane ${p} prompt ${t}`),
      sendBash: async (p, c) => void typed.push(`pane ${p} bash ${c}`),
      answerApproval: async (p, a) => void typed.push(`pane ${p} ${a ? 'allow' : 'deny'}`),
      answerQuestion: async (p, i) => void typed.push(`pane ${p} answer ${i}`),
    },
    attach: { writePty: async (p, d) => void typed.push(`write ${p} ${JSON.stringify(d)}`), screen: () => screen.lines, sleep: async () => {} },
  }
  return { s, typed }
}

test('a pane’s session is answered through the pane’s own sinks, a child’s attach through its PTY; none without a terminal', async () => {
  const screen = { lines: INPUT }
  const { s, typed } = sinks(screen)
  await sessionAgent({ kind: 'pane', pty: 7 }, s)!.send('hi')
  await sessionAgent({ kind: 'pane', pty: 7 }, s)!.bash!('ls')
  await sessionAgent({ kind: 'attach', pty: 60 }, s)!.send('hi')
  expect(typed).toEqual(['pane 7 prompt hi', 'pane 7 bash ls', `write 60 ${JSON.stringify(CLEAR_LINE)}`, `write 60 ${JSON.stringify(BACKSPACE)}`, `write 60 ${JSON.stringify(promptBytes('hi') + ENTER)}`])
  expect(sessionAgent({ kind: 'attach', pty: 60 }, s)!.bash).toBeUndefined()
  expect(sessionAgent({ kind: 'attach', pty: null }, s)).toBeUndefined()
  expect(sessionAgent({ kind: 'attach', pty: 60, error: 'no claude' }, s)).toBeUndefined()
  expect(sessionAgent(undefined, s)).toBeUndefined()
})

test('a message is typed into an attach only onto Claude Code’s input box', async () => {
  const screen: { lines: string[] | undefined } = { lines: PERMISSION }
  const { s, typed } = sinks(screen)
  const agent = attachAgent(60, s.attach)
  // Enter on a permission prompt picks "Yes"; on the shell it runs the words.
  await expect(agent.send('hi')).rejects.toThrow('It waits on a dialog, not a message: answer that first. Nothing was sent')
  screen.lines = QUESTION
  await expect(agent.send('hi')).rejects.toThrow('It waits on a dialog')
  screen.lines = SHELL
  await expect(agent.send('hi')).rejects.toThrow('Claude Code is not on screen in that attach: nothing was sent')
  screen.lines = undefined
  await expect(agent.send('hi')).rejects.toThrow('Claude Code is not on screen')
  screen.lines = NORMAL
  await expect(agent.send('hi')).rejects.toThrow('vim NORMAL mode')
  expect(typed).toEqual([])
  screen.lines = INPUT
  await agent.send('hi')
  expect(typed.at(-1)).toBe(`write 60 ${JSON.stringify(promptBytes('hi') + ENTER)}`)
})

test('an approval is typed only onto a permission prompt, an option only onto a question of one pick', async () => {
  const screen = { lines: INPUT }
  const { s, typed } = sinks(screen)
  const agent = attachAgent(60, s.attach)
  await expect(agent.allow()).rejects.toThrow('No permission prompt is on screen: nothing was sent')
  await expect(agent.answer(0)).rejects.toThrow('No question is on screen: nothing was sent')
  screen.lines = PERMISSION
  await agent.allow()
  await agent.deny()
  await expect(agent.answer(0)).rejects.toThrow('No question is on screen')
  screen.lines = QUESTION
  await agent.answer(1)
  screen.lines = [...QUESTION.slice(0, 4), ' ❯ 1. [ ] 42%', '   2. [ ] 50%', '   3. Type something.']
  await expect(agent.answer(0)).rejects.toThrow('It asks for several picks: answer it in the terminal')
  expect(typed).toEqual(['write 60 "1"', `write 60 ${JSON.stringify(ESC)}`, 'write 60 "2"'])
})

test('each write checks the screen its own keys land on, one write at a time', async () => {
  const screen = { lines: PERMISSION }
  const { s, typed } = sinks(screen)
  let release = () => {}
  const held = new Promise<void>((r) => (release = r))
  const writePty = s.attach.writePty
  const agent = attachAgent(60, {
    ...s.attach,
    // The approval's key is read by Claude Code, which then shows its input box again.
    writePty: async (p, d) => {
      await held
      await writePty(p, d)
      screen.lines = INPUT
    },
  })
  const allow = agent.allow()
  const send = agent.send('next')
  // Asked while the prompt is still up, the message waits for the approval to land.
  release()
  await allow
  await send
  expect(typed).toEqual(['write 60 "1"', `write 60 ${JSON.stringify(CLEAR_LINE)}`, `write 60 ${JSON.stringify(BACKSPACE)}`, `write 60 ${JSON.stringify(promptBytes('next') + ENTER)}`])
})

test('the status the conversation is given: a robot’s from its child, a captain’s from its parent', () => {
  expect(statusOf(null)).toBeUndefined()
  expect(statusOf({ kind: 'robot', robot: robotOf({ child: child({ waiting_for: 'permission prompt' }) }), deck: null })).toEqual({ busy: false, waiting: 'permission' })
  expect(statusOf({ kind: 'robot', robot: robotOf(), deck: null })).toEqual({ busy: true, waiting: null })
  const cap = (over: Parameters<typeof parent>[0]) => statusOf({ kind: 'captain', captain: captainOf({ parent: parent(over) }), place: null })
  expect(cap({ status: 'busy' })).toEqual({ busy: true, waiting: null, parked: false })
  expect(cap({ status: 'waiting', waiting_for: 'permission prompt' })).toEqual({ busy: false, waiting: 'permission', parked: false })
  expect(cap({ status: 'waiting', waiting_for: 'input needed' })).toEqual({ busy: false, waiting: 'question', parked: false })
  // A dialog the conversation has no card for: the foot sends it to the terminal.
  expect(cap({ status: 'waiting', waiting_for: 'dialog open' })).toEqual({ busy: false, waiting: null, parked: true })
  expect(statusOf({ kind: 'captain', captain: captainOf({ parent: null }), place: null })).toBeUndefined()
})

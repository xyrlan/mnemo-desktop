import { describe, expect, it } from 'vitest'
import { answerText, makeChatPty, optionKey, promptBytes, SEND_GAP_MS, SUBMIT_GAP_MS, KEY_GAP_MS, type PtySinks } from './pty'

type Step = ['write', number, string] | ['sleep', number] | ['ask', number]

function rig(runsClaude: boolean | ((pane: number) => boolean) = true) {
  const steps: Step[] = []
  const sinks: PtySinks = {
    writePty: async (pane, data) => void steps.push(['write', pane, data]),
    paneRunsClaude: async (pane) => {
      steps.push(['ask', pane])
      return typeof runsClaude === 'function' ? runsClaude(pane) : runsClaude
    },
    sleep: (ms) => {
      steps.push(['sleep', ms])
      return Promise.resolve()
    },
  }
  return { steps, pty: makeChatPty(sinks), sinks }
}

describe('promptBytes', () => {
  it('pastes every prompt, one line or several, so its Enter can follow at once', () => {
    expect(promptBytes('fix the bug')).toBe('\x1b[200~fix the bug\x1b[201~')
    expect(promptBytes('one\ntwo')).toBe('\x1b[200~one\ntwo\x1b[201~')
    expect(promptBytes('one\r\ntwo\rthree')).toBe('\x1b[200~one\ntwo\nthree\x1b[201~')
  })

  it('drops the keys a pasted escape would press, and cannot close the paste early', () => {
    expect(promptBytes('a\x1b[201~b\x07c')).toBe('\x1b[200~a[201~bc\x1b[201~')
    expect(promptBytes('a\n\x1b[201~\rrm -rf /')).toBe('\x1b[200~a\n[201~\nrm -rf /\x1b[201~')
  })
})

describe('optionKey and answerText', () => {
  it('numbers options from 1, as Claude shows them', () => {
    expect(optionKey(0)).toBe('1')
    expect(optionKey(3)).toBe('4')
    expect(optionKey(8)).toBe('9')
  })

  it('refuses an option no single key picks', () => {
    expect(() => optionKey(9)).toThrow(/1 to 9/)
    expect(() => optionKey(-1)).toThrow()
    expect(() => optionKey(1.5)).toThrow()
  })

  it('makes words one line with nothing that presses a key', () => {
    expect(answerText('  deep\npurple\t\x1b[A ')).toBe('deep purple [A')
  })
})

describe('makeChatPty', () => {
  it('sends a prompt: clears the line and leaves shell mode, a key at a time, then pastes it with its Enter', async () => {
    const { steps, pty } = rig()
    await pty.sendPrompt(3, 'hello')
    expect(steps).toEqual([
      ['ask', 3],
      ['write', 3, '\x15'],
      ['sleep', SEND_GAP_MS],
      ['write', 3, '\x7f'],
      ['sleep', SEND_GAP_MS],
      ['write', 3, '\x1b[200~hello\x1b[201~\r'],
    ])
  })

  it('pastes a prompt of several lines as one', async () => {
    const { steps, pty } = rig()
    await pty.sendPrompt(3, 'a\nb')
    expect(steps.at(-1)).toEqual(['write', 3, '\x1b[200~a\nb\x1b[201~\r'])
  })

  it('waits far less than it did: 100 ms of gaps where 650 were', async () => {
    const { steps, pty } = rig()
    await pty.sendPrompt(3, 'hello')
    expect(steps.reduce((ms, s) => (s[0] === 'sleep' ? ms + s[1] : ms), 0)).toBeLessThanOrEqual(100)
  })

  it('runs a shell command through `!` typed alone, then the command pasted with its Enter', async () => {
    const { steps, pty } = rig()
    await pty.sendBash(3, 'git status')
    expect(steps).toEqual([
      ['ask', 3],
      ['write', 3, '\x15'],
      ['sleep', SEND_GAP_MS],
      ['write', 3, '\x7f'],
      ['sleep', SEND_GAP_MS],
      ['write', 3, '!'],
      ['sleep', SEND_GAP_MS],
      ['write', 3, '\x1b[200~git status\x1b[201~\r'],
    ])
  })

  it('refuses an empty command, and types none when Claude has exited', async () => {
    const { steps, pty } = rig()
    await expect(pty.sendBash(3, ' \t ')).rejects.toThrow('nothing to run')
    expect(steps).toEqual([])
    const gone = rig(false)
    await expect(gone.pty.sendBash(3, 'ls')).rejects.toThrow(/no longer running/)
    expect(gone.steps.filter((s) => s[0] === 'write')).toEqual([])
  })

  it('refuses an empty prompt without asking the pane', async () => {
    const { steps, pty } = rig()
    await expect(pty.sendPrompt(3, '  \x07 ')).rejects.toThrow('nothing to send')
    expect(steps).toEqual([])
  })

  it('types nothing when the pane no longer runs Claude', async () => {
    const { steps, pty } = rig(false)
    await expect(pty.sendPrompt(3, 'hello')).rejects.toThrow(/no longer running.*nothing was sent/)
    await expect(pty.answerApproval(3, true)).rejects.toThrow(/no longer running/)
    await expect(pty.answerQuestion(3, 0)).rejects.toThrow(/no longer running/)
    await expect(pty.answerQuestionOther(3, 3, 'x')).rejects.toThrow(/no longer running/)
    expect(steps.filter((s) => s[0] === 'write')).toEqual([])
  })

  it('allows with 1 and denies with Esc', async () => {
    const { steps, pty } = rig()
    await pty.answerApproval(2, true)
    await pty.answerApproval(2, false)
    expect(steps.filter((s) => s[0] === 'write')).toEqual([
      ['write', 2, '1'],
      ['write', 2, '\x1b'],
    ])
  })

  it("answers a question with its option's digit alone", async () => {
    const { steps, pty } = rig()
    await pty.answerQuestion(4, 1)
    expect(steps).toEqual([['ask', 4], ['write', 4, '2']])
  })

  it('refuses an option no key picks, typing nothing', async () => {
    const { steps, pty } = rig()
    await expect(pty.answerQuestion(4, 9)).rejects.toThrow(/1 to 9/)
    expect(steps).toEqual([])
  })

  it('answers in words through the row after the options', async () => {
    const { steps, pty } = rig()
    await pty.answerQuestionOther(4, 3, 'deep purple')
    expect(steps).toEqual([
      ['ask', 4],
      ['write', 4, '4'],
      ['sleep', KEY_GAP_MS],
      ['write', 4, 'deep purple'],
      ['sleep', SUBMIT_GAP_MS],
      ['write', 4, '\r'],
    ])
  })

  it('refuses empty words', async () => {
    const { steps, pty } = rig()
    await expect(pty.answerQuestionOther(4, 3, ' \n ')).rejects.toThrow('nothing to send')
    expect(steps).toEqual([])
  })

  it("never lets a second send's keys land inside the first's", async () => {
    const { steps, sinks } = rig()
    let open!: () => void
    const gate = new Promise<void>((r) => (open = r))
    let first = true
    const pty = makeChatPty({
      ...sinks,
      sleep: async (ms) => {
        steps.push(['sleep', ms])
        if (first) {
          first = false
          await gate
        }
      },
    })
    const a = pty.sendPrompt(1, 'one')
    const b = pty.sendPrompt(1, 'two')
    await new Promise((r) => setTimeout(r, 0))
    expect(steps.filter((s) => s[0] === 'write').map((s) => s[2])).toEqual(['\x15'])
    open()
    await Promise.all([a, b])
    const p = (t: string) => `\x1b[200~${t}\x1b[201~\r`
    expect(steps.filter((s) => s[0] === 'write').map((s) => s[2])).toEqual(['\x15', '\x7f', p('one'), '\x15', '\x7f', p('two')])
  })

  it('a refused send does not hold up the next one on that pane', async () => {
    let asked = 0
    const { steps, pty } = rig(() => ++asked > 1)
    const a = pty.sendPrompt(1, 'x')
    const b = pty.answerQuestion(1, 0)
    await expect(a).rejects.toThrow(/no longer running/)
    await b
    expect(steps.filter((s) => s[0] === 'write')).toEqual([['write', 1, '1']])
  })
})

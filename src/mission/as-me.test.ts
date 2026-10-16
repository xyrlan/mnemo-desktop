import { vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => null) }))

import { attached, boxShows, inputBox, pasteOf, typeAsMe, type AttachSession } from './as-me'
import { DETACH_KEY } from '../cockpit/prompt'

/** The bottom of `claude attach 5a824ae5` on an idle child, as xterm reads it back (captured
 *  2026-09-15 from a real `claude --bg --model haiku` child, Claude Code 2.1.272). */
const IDLE = [
  '⏺ OK6',
  '',
  '✻ Worked for 2s · done 4:16 PM',
  '',
  '────────────────────────────────────────────────────────────────── dialog instruction override attempt ─',
  '❯ ',
  '────────────────────────────────────────────────────────────────────────────────────────────────────────',
  '  [CAVEMAN]',
  '  -- INSERT -- ⏸ manual mode on · ← 4 agents',
]

/** Same child with text another attach had typed and not sent: the input box is shared. */
const HELD = IDLE.map((l) => (l === '❯ ' ? '❯ short draft here' : l))

/** A five-line bracketed paste on top of that text. */
const PASTED = IDLE.map((l) => (l === '❯ ' ? '❯ short draft here[Pasted text #2 +5 lines]' : l)).slice(0, -1).concat('  paste again to expand')

/** `claude attach 0cf48e62` parked on a Bash permission prompt: no input box at all. */
const DIALOG = [
  '❯ Use the Bash tool to run exactly this command: touch probe-file-86b . Do nothing else.',
  '',
  '⏺ Running 1 shell command…',
  '  ⎿  $ touch probe-file-86b',
  '',
  '────────────────────────────────────────────────────────────────────────────────────────────────────────',
  ' Bash command',
  '',
  '   touch probe-file-86b',
  '   Create file probe-file-86b',
  '',
  ' │ Claude requested permissions to edit /Users/me/probe86/probe-file-86b which is a',
  ' │ sensitive file.',
  '',
  ' Do you want to proceed?',
  ' ❯ 1. Yes',
  '   2. Yes, and always allow access to /Users/me/probe86 from this project',
  '   3. No',
  '',
  ' Esc to cancel · Tab to amend',
]

test('inputBox reads the empty box, the text another attach left in it, and a paste placeholder', () => {
  expect(inputBox(IDLE)).toEqual({ text: '', normal: false })
  expect(inputBox(HELD)?.text).toBe('short draft here')
  expect(inputBox(PASTED)?.text).toBe('short draft here[Pasted text #2 +5 lines]')
  expect(inputBox([...IDLE, '', ''])).toEqual({ text: '', normal: false })
})

test('inputBox joins a box that wraps over several lines and sees vim NORMAL mode', () => {
  const rule = '─'.repeat(40)
  expect(inputBox([rule, '❯ yes, push the branch and', '  open the draft PR', rule, '  -- NORMAL --'])).toEqual({ text: 'yes, push the branch and\nopen the draft PR', normal: true })
})

test('inputBox finds nothing on a permission prompt, in a shell, or with the box scrolled up', () => {
  expect(inputBox(DIALOG)).toBeNull()
  expect(inputBox(['~/probe $ exec claude attach 5a824ae5', 'Attaching…'])).toBeNull()
  expect(inputBox(['❯ ls', 'README', '❯ '])).toBeNull()
  expect(inputBox([...IDLE, ...Array.from({ length: 12 }, (_, i) => `line ${i}`)])).toBeNull()
})

test('pasteOf wraps the draft in one bracketed paste and drops keys hidden in it', () => {
  expect(pasteOf('yes\r\npush it')).toBe('\x1b[200~yes\npush it\x1b[201~')
  expect(pasteOf('a\x1b[201~\rb\tc')).toBe('\x1b[200~a[201~\nb\tc\x1b[201~')
})

test('boxShows matches the start of the draft, across wrapping, or a paste placeholder', () => {
  expect(boxShows({ text: 'yes, push the branch and\nopen the draft PR', normal: false }, 'yes, push the branch and open the draft PR')).toBe(true)
  expect(boxShows({ text: '[Pasted text #1 +29 lines]', normal: false }, 'long\ntext')).toBe(true)
  expect(boxShows({ text: 'something else', normal: false }, 'yes')).toBe(false)
  expect(boxShows({ text: '', normal: false }, 'yes')).toBe(false)
})

/** A fake attach whose screen reacts to what is written, like the real one measured above. */
function fakeAttach(opts: { start?: string[]; afterPaste?: (text: string) => string[]; afterEnter?: string[]; drawAfter?: number } = {}) {
  const writes: string[] = []
  let screen: string[] = ['~/ $ ']
  let polls = 0
  let exited = false
  let closed = false
  const session: AttachSession = {
    lines: () => {
      polls++
      if (writes.length === 1 && polls > (opts.drawAfter ?? 1)) screen = opts.start ?? IDLE
      return screen
    },
    write: async (data) => {
      writes.push(data)
      if (data.startsWith('\x1b[200~')) {
        const text = data.slice(6, -6)
        screen = opts.afterPaste ? opts.afterPaste(text) : IDLE.map((l) => (l === '❯ ' ? `❯ ${text}` : l))
      } else if (data === '\r') screen = opts.afterEnter ?? IDLE
      else if (data === DETACH_KEY) exited = true
    },
    exited: () => exited,
    close: async () => {
      closed = true
    },
  }
  return { session, writes, closed: () => closed }
}

const quick = { sleep: async () => {}, timeoutMs: 50, stepMs: 50, waitingFor: async () => null }

test('typeAsMe attaches, pastes the draft as typed, presses Enter, then detaches with Ctrl+Z and closes', async () => {
  const a = fakeAttach()
  await typeAsMe('5a824ae5', 'sim, pode fazer push', { ...quick, open: async () => a.session })
  expect(a.writes).toEqual(['exec claude attach 5a824ae5\r', '\x1b[200~sim, pode fazer push\x1b[201~', '\r', DETACH_KEY])
  expect(a.closed()).toBe(true)
})

test("typeAsMe attaches on the child's own account when it is given the child", async () => {
  const a = fakeAttach()
  const asked: string[] = []
  const work = { id: 'b0b0b0b0', account: 'work', account_env: { config_dir: '/Users/me/.claude-work' } }
  await typeAsMe(work, 'go', { ...quick, waitingFor: async (id) => (asked.push(id), null), open: async () => a.session })
  expect(a.writes[0]).toBe('exec env CLAUDE_CONFIG_DIR=/Users/me/.claude-work claude attach b0b0b0b0\r')
  expect(asked).toEqual(['b0b0b0b0'])
})

test('on Windows the attach is typed for the shell the hidden pane runs, with one account and with two', async () => {
  const work = { id: 'b0b0b0b0', account: 'work', account_env: { config_dir: 'C:\\Users\\Jo Doe\\.claude-work' } }
  const home = { id: 'a1a1a1a1', account: 'default', account_env: { config_dir: null } }
  const first = async (target: Parameters<typeof typeAsMe>[0], shell: 'cmd' | 'powershell') => {
    const a = fakeAttach()
    await typeAsMe(target, 'go', { ...quick, shell, open: async () => a.session })
    expect(a.writes.slice(1)).toEqual(['\x1b[200~go\x1b[201~', '\r', DETACH_KEY])
    return a.writes[0]
  }
  expect(await first('5a824ae5', 'cmd')).toBe('claude attach 5a824ae5 & exit\r')
  expect(await first(work, 'cmd')).toBe('cmd /d /s /c "set "CLAUDE_CONFIG_DIR=C:\\Users\\Jo Doe\\.claude-work"& claude attach b0b0b0b0" & exit\r')
  expect(await first(home, 'cmd')).toBe('cmd /d /s /c "set "CLAUDE_CONFIG_DIR="& claude attach a1a1a1a1" & exit\r')
  expect(await first('5a824ae5', 'powershell')).toBe('claude attach 5a824ae5; exit\r')
  expect(await first(work, 'powershell')).toBe(
    "$mnemoWas = $env:CLAUDE_CONFIG_DIR; $env:CLAUDE_CONFIG_DIR = 'C:\\Users\\Jo Doe\\.claude-work'; try { claude attach b0b0b0b0 } finally { $env:CLAUDE_CONFIG_DIR = $mnemoWas }; exit\r",
  )
})

test('typeAsMe never attaches to a child parked on a prompt', async () => {
  const open = vi.fn()
  await expect(typeAsMe('0cf48e62', 'yes', { ...quick, waitingFor: async () => 'permission prompt', open })).rejects.toThrow('permission prompt')
  expect(open).not.toHaveBeenCalled()
})

test('typeAsMe types nothing when the screen shows a prompt the poll had not seen yet', async () => {
  const a = fakeAttach({ start: DIALOG })
  await expect(typeAsMe('0cf48e62', 'yes', { ...quick, timeoutMs: 1_000, open: async () => a.session })).rejects.toThrow('prompt')
  expect(a.writes).toEqual(['exec claude attach 0cf48e62\r', DETACH_KEY])
  expect(a.closed()).toBe(true)
})

test('typeAsMe refuses an input box that already holds text, which Enter would send with ours', async () => {
  const a = fakeAttach({ start: HELD })
  await expect(typeAsMe('5a824ae5', 'yes', { ...quick, open: async () => a.session })).rejects.toThrow('already holds "short draft here"')
  expect(a.writes).toEqual(['exec claude attach 5a824ae5\r', DETACH_KEY])
})

test('typeAsMe does not press Enter when a prompt opens under the pasted draft', async () => {
  const a = fakeAttach({ afterPaste: () => DIALOG })
  await expect(typeAsMe('5a824ae5', 'yes', { ...quick, open: async () => a.session })).rejects.toThrow('prompt')
  expect(a.writes).not.toContain('\r')
  expect(a.writes.at(-1)).toBe(DETACH_KEY)
})

test('typeAsMe does not press Enter when the box does not show the draft', async () => {
  const a = fakeAttach({ afterPaste: () => HELD })
  await expect(typeAsMe('5a824ae5', 'yes', { ...quick, open: async () => a.session })).rejects.toThrow('the draft showed')
  expect(a.writes).not.toContain('\r')
})

test('typeAsMe reports an attach that never draws its input box, and still closes the PTY', async () => {
  const a = fakeAttach({ drawAfter: Infinity })
  await expect(typeAsMe('nope', 'yes', { ...quick, open: async () => a.session })).rejects.toThrow('input box showed')
  expect(a.writes).toEqual(['exec claude attach nope\r', DETACH_KEY])
  expect(a.closed()).toBe(true)
})

test('typeAsMe takes a prompt right after Enter as the turn having gone through', async () => {
  const a = fakeAttach({ afterEnter: DIALOG })
  await typeAsMe('5a824ae5', 'yes, push', { ...quick, open: async () => a.session })
  expect(a.writes).toContain('\r')
})

test('typeAsMe refuses a reply starting with !, which would put the input in shell mode', async () => {
  const open = vi.fn()
  await expect(typeAsMe('5a824ae5', '  !git push', { ...quick, open })).rejects.toThrow('shell command')
  expect(open).not.toHaveBeenCalled()
})

const GROK = { id: '01a1451f-bfc0-7481-afec-c2286636bc5d', account: 'gw', account_env: { config_dir: '/Users/me/.grok-work', kind: 'grok' as const } }

test("typeAsMe sends a Grok session's turn through its leader, as written, and attaches nothing", async () => {
  const sent: [string, string][] = []
  const open = async (): Promise<AttachSession> => {
    throw new Error('attached to a Grok session')
  }
  const waitingFor = async (): Promise<string | null> => {
    throw new Error('asked claude agents about a Grok session')
  }
  // A leading `!` is no shell mode there: nothing is typed into a terminal.
  await typeAsMe(GROK, '!sim, pode fazer push\nlinha 2', { ...quick, waitingFor, open, send: async (id, text) => void sent.push([id, text]) })
  expect(sent).toEqual([[GROK.id, '!sim, pode fazer push\nlinha 2']])
  await expect(typeAsMe(GROK, '  ', { ...quick, open, send: async () => {} })).rejects.toThrow('nothing to type')
})

test('a hidden attach refuses a Grok session, whose screen it cannot read', async () => {
  const a = fakeAttach()
  const deps = { ...quick, shell: 'posix' as const, open: async () => a.session, send: async () => {} }
  await expect(attached(GROK, deps, async () => 'typed')).rejects.toThrow('Grok session')
  expect(a.writes).toEqual([])
})

test('a Claude child with a kind is attached exactly as one without', async () => {
  const a = fakeAttach()
  const work = { id: 'b0b0b0b0', account: 'work', account_env: { config_dir: '/Users/me/.claude-work', kind: 'claude' as const } }
  await typeAsMe(work, 'go', { ...quick, open: async () => a.session, send: async () => void expect.unreachable() })
  expect(a.writes[0]).toBe('exec env MNEMO_AGENT=claude CLAUDE_CONFIG_DIR=/Users/me/.claude-work claude attach b0b0b0b0\r')
})

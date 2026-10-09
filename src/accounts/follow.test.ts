import { accountLine, createFollow, EOF, ESC, LEAVE_MS, modeFlags, screenState, shellOf, TICK_MS, TRIES, type FollowDeps } from './follow'
import { createAccountsStore, type FollowEnv } from './store'
import { account, fakeClient } from './testing'
import type { AccountsState } from './types'

/** The bottom of an idle Claude Code session as xterm reads it back (captured 2026-09-15 from a
 *  real session through `claude attach`, Claude Code 2.1.272: the same input box a pane shows). */
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
const withBox = (text: string) => IDLE.map((l) => (l === '❯ ' ? `❯ ${text}` : l))
/** A turn under way: the spinner line over the box (written from Claude Code's words, not captured). */
const WORKING = [...IDLE.slice(0, 2), '✻ Pondering… (12s · ↓ 300 tokens · esc to interrupt)', ...IDLE.slice(3)]
/** Parked on a Bash permission prompt (captured with IDLE): no input box at all. */
const DIALOG = [
  '⏺ Running 1 shell command…',
  '  ⎿  $ touch probe-file-86b',
  '',
  '────────────────────────────────────────────────────────────────────────────────────────────────────────',
  ' Bash command',
  '',
  '   touch probe-file-86b',
  '',
  ' Do you want to proceed?',
  ' ❯ 1. Yes',
  '   2. Yes, and always allow access to /Users/me/probe86 from this project',
  '   3. No',
  '',
  ' Esc to cancel · Tab to amend',
]
/** The shell prompt Claude leaves to (zsh, written from Claude Code's exit lines, not captured). */
const SHELL = ['', 'Resume this session with:', 'claude --resume 7f3c2a10-0d1e-4b55-9a77-1c2d3e4f5a6b', '~/github/mnemo-desktop %']

const SID = '7f3c2a10-0d1e-4b55-9a77-1c2d3e4f5a6b'

type Screen = 'idle' | 'working' | 'dialog' | 'shell' | { draft: string } | { status: string }

/** A terminal pane with Claude Code in it, answering keys the way the TUI does: Ctrl+D on an empty
 *  box arms the exit, a second one inside the window leaves to the shell, and `claude --resume`
 *  typed there brings the box back. */
function pane(id: number, screen: Screen = 'idle', sessionId = SID) {
  const p = {
    id,
    sessionId: sessionId as string | undefined,
    screen,
    armed: false,
    /** Ctrl+D is ignored, as by a Claude that did not hear it. */
    deaf: false,
    typed: [] as string[],
    lines(): string[] {
      const s = p.screen
      if (s === 'idle') return p.armed ? [...IDLE.slice(0, -1), '  Press Ctrl-D again to exit'] : IDLE
      if (s === 'working') return WORKING
      if (s === 'dialog') return DIALOG
      if (s === 'shell') return [...SHELL, ...p.typed.filter((t) => t.endsWith('\r')).map((t) => t.trim()), '~/github/mnemo-desktop %']
      if ('draft' in s) return withBox(s.draft)
      return [...IDLE.slice(0, -1), s.status]
    },
    key(data: string) {
      p.typed.push(data)
      const s = p.screen
      if (data === EOF && !p.deaf && (s === 'idle' || (typeof s === 'object' && 'status' in s))) {
        if (p.armed) {
          p.armed = false
          p.screen = 'shell'
        } else p.armed = true
      } else if (p.screen === 'shell' && data.startsWith('claude --resume ')) p.screen = 'idle'
    },
  }
  return p
}
type Pane = ReturnType<typeof pane>

const states: Record<string, AccountsState> = {
  default: { active: 'default', accounts: [account('default'), account('work'), account('side')] },
  work: { active: 'work', accounts: [account('default'), account('work'), account('side')] },
  side: { active: 'side', accounts: [account('default'), account('work'), account('side')] },
}

function world(panes: Pane[], accounts: Record<number, string>, active = 'default') {
  const w = {
    panes,
    accounts,
    active,
    busy: new Set<string>(),
    children: new Set<string>() as Set<string> | null,
    recorded: [] as [number, string][],
    resumed: [] as [number, string][],
    windows: false,
  }
  const at = (id: number) => w.panes.find((p) => p.id === id)
  const deps: FollowDeps = {
    panes: () => w.panes.flatMap((p) => (p.sessionId ? [{ id: p.id, sessionId: p.sessionId }] : [])),
    paneAccounts: async () => ({ ...w.accounts }),
    target: () => states[w.active].accounts.find((a) => a.id === w.active) ?? null,
    record: async (pane, id) => {
      w.recorded.push([pane, id])
      w.accounts[pane] = id
    },
    lines: (id) => at(id)?.lines(),
    write: async (id, data) => at(id)?.key(data),
    runsClaude: async (id) => at(id)?.screen !== 'shell',
    busy: async (sid) => w.busy.has(sid),
    child: async (sid) => (w.children ? w.children.has(sid) : null),
    resumed: (pane, sid) => void w.resumed.push([pane, sid]),
    get windows() {
      return w.windows
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => Date.now(),
  }
  return { w, follow: createFollow(deps) }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

/** Lets the follower look and type for `ms`. */
const run = (ms = 10 * TICK_MS) => vi.advanceTimersByTimeAsync(ms)

test('an idle session on another account leaves, its shell moves, and it resumes there', async () => {
  const p = pane(3)
  const { w, follow } = world([p], { 3: 'default' })
  w.active = 'work'
  await follow.switched()
  await run()
  expect(p.typed).toEqual([EOF, EOF, ' export CLAUDE_CONFIG_DIR=/Users/me/.claude-work\r', `claude --resume ${SID}\r`])
  expect(w.recorded).toEqual([[3, 'work']])
  expect(w.resumed).toEqual([[3, SID]])
  expect(p.screen).toBe('idle')
  expect(follow.pending()).toEqual([])
})

test('to the default account the shell unsets CLAUDE_CONFIG_DIR rather than pointing it at ~/.claude', async () => {
  const p = pane(3)
  const { w, follow } = world([p], { 3: 'work' }, 'work')
  w.active = 'default'
  await follow.switched()
  await run()
  expect(p.typed[2]).toBe(' unset CLAUDE_CONFIG_DIR 2>/dev/null || set -e CLAUDE_CONFIG_DIR\r')
  expect(w.recorded).toEqual([[3, 'default']])
})

test('a working session moves once its turn is done', async () => {
  const p = pane(3, 'working')
  const { w, follow } = world([p], { 3: 'default' })
  w.active = 'work'
  await follow.switched()
  await run()
  expect(p.typed).toEqual([])
  p.screen = 'idle'
  await run()
  expect(w.recorded).toEqual([[3, 'work']])
})

test('a session the app hears is working waits, whatever its screen says', async () => {
  const p = pane(3)
  const { w, follow } = world([p], { 3: 'default' })
  w.busy.add(SID)
  w.active = 'work'
  await follow.switched()
  await run()
  expect(p.typed).toEqual([])
  w.busy.clear()
  await run()
  expect(w.recorded).toEqual([[3, 'work']])
})

test('a session waiting on the maintainer moves after they answer', async () => {
  const p = pane(3, 'dialog')
  const { w, follow } = world([p], { 3: 'default' })
  w.active = 'work'
  await follow.switched()
  await run()
  expect(p.typed).toEqual([])
  p.screen = 'idle'
  await run()
  expect(w.recorded).toEqual([[3, 'work']])
})

test('a draft in the input box is never touched: the session waits until it is sent', async () => {
  const p = pane(3, { draft: 'half a thought' })
  const { w, follow } = world([p], { 3: 'default' })
  w.active = 'work'
  await follow.switched()
  await run(60 * TICK_MS)
  expect(p.typed).toEqual([])
  expect(follow.pending()).toEqual([3])
  p.screen = 'idle'
  await run()
  expect(w.recorded).toEqual([[3, 'work']])
})

test('a draft typed between the two Ctrl+D stops the exit, and the session moves when idle again', async () => {
  const p = pane(3)
  const key = p.key
  p.key = (data) => {
    key(data)
    // The maintainer starts typing right after the first Ctrl+D.
    if (data === EOF && p.typed.length === 1) p.screen = { draft: 'w' }
  }
  const { w, follow } = world([p], { 3: 'default' })
  w.active = 'work'
  await follow.switched()
  await run()
  expect(p.typed).toEqual([EOF])
  p.armed = false
  p.screen = 'idle'
  await run()
  expect(p.typed.slice(1)).toEqual([EOF, EOF, ' export CLAUDE_CONFIG_DIR=/Users/me/.claude-work\r', `claude --resume ${SID}\r`])
})

test('switching back before a pane moved leaves it on its own account', async () => {
  const p = pane(3, 'working')
  const { w, follow } = world([p], { 3: 'default' })
  w.active = 'work'
  await follow.switched()
  await run()
  w.active = 'default'
  await follow.switched()
  p.screen = 'idle'
  await run()
  expect(p.typed).toEqual([])
  expect(follow.pending()).toEqual([])
})

test('switching again before a pane moved takes it to the newest active account', async () => {
  const p = pane(3, 'working')
  const { w, follow } = world([p], { 3: 'default' })
  w.active = 'work'
  await follow.switched()
  await run()
  w.active = 'side'
  await follow.switched()
  p.screen = 'idle'
  await run()
  expect(p.typed[2]).toBe(' export CLAUDE_CONFIG_DIR=/Users/me/.claude-side\r')
  expect(w.recorded).toEqual([[3, 'side']])
})

test('a switch landing while Claude leaves sends the shell to the newest account', async () => {
  const p = pane(3)
  const key = p.key
  const { w, follow } = world([p], { 3: 'default' })
  p.key = (data) => {
    key(data)
    if (p.screen === 'shell') w.active = 'side'
  }
  w.active = 'work'
  await follow.switched()
  await run()
  expect(w.recorded).toEqual([[3, 'side']])
})

test('untouched: panes on the active account, without a Claude session, of no recorded account, or attached to a child', async () => {
  const mine = pane(1)
  const shell = pane(2, 'shell')
  shell.sessionId = undefined
  const unknown = pane(3)
  const attach = pane(4, 'idle', 'c0ffee00-1111-2222-3333-444455556666')
  const { w, follow } = world([mine, shell, unknown, attach], { 1: 'work', 2: 'default', 4: 'default' })
  w.children!.add('c0ffee00-1111-2222-3333-444455556666')
  w.active = 'work'
  await follow.switched()
  await run()
  for (const p of [mine, shell, unknown, attach]) expect(p.typed).toEqual([])
  expect(follow.pending()).toEqual([])
})

test('nothing moves while the app cannot yet tell a session from a background child', async () => {
  const p = pane(3)
  const { w, follow } = world([p], { 3: 'default' })
  w.children = null
  w.active = 'work'
  await follow.switched()
  await run()
  expect(p.typed).toEqual([])
  w.children = new Set()
  await run()
  expect(w.recorded).toEqual([[3, 'work']])
})

test('several panes move, each on its own', async () => {
  const a = pane(3)
  const b = pane(5, 'working', '11111111-2222-3333-4444-555555555555')
  const { w, follow } = world([a, b], { 3: 'default', 5: 'default' })
  w.active = 'work'
  await follow.switched()
  await run()
  expect(w.recorded).toEqual([[3, 'work']])
  b.screen = 'idle'
  await run()
  expect(w.recorded).toEqual([
    [3, 'work'],
    [5, 'work'],
  ])
  expect(b.typed.at(-1)).toBe('claude --resume 11111111-2222-3333-4444-555555555555\r')
})

test('a Claude that does not leave is left running, and tried again only a few times', async () => {
  const p = pane(3)
  p.deaf = true
  const { w, follow } = world([p], { 3: 'default' })
  w.active = 'work'
  await follow.switched()
  await run(TRIES * (LEAVE_MS + 5 * TICK_MS))
  expect(p.typed.filter((t) => t !== EOF)).toEqual([])
  expect(p.typed).toHaveLength(2 * TRIES)
  expect(follow.pending()).toEqual([])
  expect(w.recorded).toEqual([])
})

test('a screen that keeps changing is not idle, even with an empty box', async () => {
  const p = pane(3)
  // A spinner frame between two looks, without the words a turn shows.
  p.lines = () => [`· ${Math.floor(Date.now() / TICK_MS)}`, ...IDLE]
  const { w, follow } = world([p], { 3: 'default' })
  w.active = 'work'
  await follow.switched()
  await run()
  expect(p.typed).toEqual([])
})

test('nothing is typed into the shell while Claude still runs under it, box or no box', async () => {
  const p = pane(3)
  let gone = false
  p.key = (data) => {
    p.typed.push(data)
    if (data === EOF && p.typed.length === 2) gone = true
  }
  p.lines = () => (gone ? ['', '  Saving the session…'] : IDLE)
  const { w, follow } = world([p], { 3: 'default' })
  w.active = 'work'
  await follow.switched()
  await run(LEAVE_MS + 5 * TICK_MS)
  expect(p.typed.filter((t) => t !== EOF)).toEqual([])
})

test('a question Claude asks on its way out is cancelled, and nothing is typed into it', async () => {
  const p = pane(3)
  p.key = (data) => {
    p.typed.push(data)
    if (data === EOF && p.typed.length === 2) p.screen = 'dialog'
    if (data === ESC) p.screen = 'idle'
  }
  const { w, follow } = world([p], { 3: 'default' })
  w.active = 'work'
  await follow.switched()
  await run(LEAVE_MS + 5 * TICK_MS)
  expect(p.typed.slice(0, 3)).toEqual([EOF, EOF, ESC])
  expect(p.typed.some((t) => t.includes('CLAUDE_CONFIG_DIR') || t.startsWith('claude'))).toBe(false)
})

test('the session resumes in the permission mode its status line showed', async () => {
  const p = pane(3, { status: '  ⏵⏵ bypass permissions on (shift+tab to cycle)' })
  const { w, follow } = world([p], { 3: 'default' })
  w.active = 'work'
  await follow.switched()
  await run()
  expect(p.typed.at(-1)).toBe(`claude --resume ${SID} --dangerously-skip-permissions\r`)
})

test('screenState reads the recorded screens', () => {
  expect(screenState(IDLE)).toBe('idle')
  expect(screenState(withBox('a draft'))).toBe('draft')
  expect(screenState(WORKING)).toBe('busy')
  expect(screenState(DIALOG)).toBe('busy')
  expect(screenState(SHELL)).toBe('none')
})

test('modeFlags reads the permission mode under the box', () => {
  expect(modeFlags(IDLE)).toBe('')
  expect(modeFlags([...IDLE.slice(0, -1), '  ⏵⏵ accept edits on (shift+tab to cycle)'])).toBe(' --permission-mode acceptEdits')
  expect(modeFlags([...IDLE.slice(0, -1), '  ⏸ plan mode on (shift+tab to cycle)'])).toBe(' --permission-mode plan')
  // Words above the box are the conversation, not the mode.
  expect(modeFlags(['bypass permissions on', ...IDLE])).toBe('')
})

test('accountLine moves each shell, quoting the dir', () => {
  const work = account('work')
  const def = account('default')
  expect(accountLine({ ...work, configDir: "/Users/o'neil/.claude-work" }, 'posix')).toBe(` export CLAUDE_CONFIG_DIR='/Users/o'\\''neil/.claude-work'`)
  expect(accountLine(def, 'posix')).toBe(' unset CLAUDE_CONFIG_DIR 2>/dev/null || set -e CLAUDE_CONFIG_DIR')
  expect(accountLine({ ...work, configDir: "C:\\Users\\o'neil\\.claude-work" }, 'powershell')).toBe(`$env:CLAUDE_CONFIG_DIR = 'C:\\Users\\o''neil\\.claude-work'`)
  expect(accountLine(def, 'powershell')).toBe('Remove-Item Env:CLAUDE_CONFIG_DIR -ErrorAction SilentlyContinue')
  expect(accountLine({ ...work, configDir: 'C:\\Users\\me\\.claude-work' }, 'cmd')).toBe('set "CLAUDE_CONFIG_DIR=C:\\Users\\me\\.claude-work"')
  expect(accountLine(def, 'cmd')).toBe('set CLAUDE_CONFIG_DIR=')
})

test('shellOf tells PowerShell from cmd by its prompt, on Windows only', () => {
  expect(shellOf(['PS C:\\Users\\me> '], true)).toBe('powershell')
  expect(shellOf(['C:\\Users\\me>'], true)).toBe('cmd')
  expect(shellOf(['PS1 % '], false)).toBe('posix')
})

test('on Windows the shell line is PowerShell when the prompt Claude left to is', async () => {
  const p = pane(3)
  p.lines = () => (p.screen === 'shell' ? ['', 'PS C:\\Users\\me> '] : IDLE)
  const { w, follow } = world([p], { 3: 'default' })
  w.windows = true
  w.active = 'work'
  await follow.switched()
  await run()
  expect(p.typed[2]).toBe(`$env:CLAUDE_CONFIG_DIR = '/Users/me/.claude-work'\r`)
})

describe('the store', () => {
  function env(p: Pane): FollowEnv {
    return {
      panes: () => (p.sessionId ? [{ id: p.id, sessionId: p.sessionId }] : []),
      lines: () => p.lines(),
      write: async (_, data) => p.key(data),
      runsClaude: async () => p.screen !== 'shell',
      busy: async () => false,
      child: async () => false,
      resumed: () => {},
      windows: false,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      now: () => Date.now(),
    }
  }

  async function started(p: Pane, loginMs = 0) {
    const { fake, client } = fakeClient({ state: states.default, panes: { [p.id]: 'default' } })
    const open = client.openTerminal
    client.openTerminal = async (cmd) => {
      await open(cmd)
      await new Promise((r) => setTimeout(r, loginMs))
    }
    const store = createAccountsStore(client, { follow: env(p) })
    store.getState().start()
    await vi.advanceTimersByTimeAsync(0)
    return { fake, store }
  }

  test('a switch moves the open sessions and records them, and the chip reads the new record', async () => {
    const p = pane(3)
    const { fake, store } = await started(p)
    await store.getState().switchTo('work')
    await run()
    expect(fake.called('move')).toEqual([['move', 3, 'work']])
    expect(store.getState().panes).toEqual({ 3: 'work' })
    expect(p.typed.at(-1)).toBe(`claude --resume ${SID}\r`)
  })

  test('accounts://changed from elsewhere moves them too; the first list does not', async () => {
    const p = pane(3)
    const { fake } = await started(p)
    await run()
    expect(p.typed).toEqual([])
    fake.emit(states.work)
    await run()
    expect(fake.called('move')).toEqual([['move', 3, 'work']])
  })

  test('adding an account switches for its login terminal and back, and no session moves', async () => {
    const p = pane(3)
    // The login terminal takes a while to open: long enough for a session to move, were it to.
    const { fake, store } = await started(p, 10 * TICK_MS)
    const adding = store.getState().add('Side')
    await run(20 * TICK_MS)
    await adding
    // accounts-core's own events for the two switches land after the add.
    fake.emit({ ...states.default, active: 'side' })
    fake.emit(states.default)
    await run()
    expect(p.typed).toEqual([])
    expect(fake.called('move')).toEqual([])
  })
})

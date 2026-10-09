import { promptOptions } from '../cockpit/prompt'
import { CONFIG_DIR_VAR, shellWord } from '../mission/account'
import { inputBox } from '../mission/as-me'
import { tail } from '../terminal/buffer'
import type { Account } from './types'

/** Open Claude sessions follow an account switch (spec `2026-10-07-claude-accounts-design.md`,
 *  decision 9). A running `claude` reads its config dir once, at start, so a session cannot change
 *  account in place: Claude leaves, the pane's shell moves to the new account, and the same session
 *  resumes in the same pane. Silently: no prompt, no count, no toast.
 *
 *  Which panes: every terminal pane that runs a Claude session and was spawned on (or last moved
 *  to) another account than the active one, when the active account changes. Background children
 *  stay on their account (decision 5), and so does a pane attached to one.
 *
 *  When: an idle session moves at once; one that is working or waiting on the maintainer, and one
 *  whose input box holds a draft, waits until it is idle with an empty box. Switching again before
 *  a pane moved takes it to the newest active account, or leaves it when that is its own.
 *
 *  The keys, against recorded screens only (no live probe: memory
 *  `live-claude-tui-probes-blocked-in-auto-mode`):
 *  - Claude leaves on Ctrl+D pressed twice on an empty input. On a box holding text Ctrl+D deletes
 *    forward, which at the end of the text deletes nothing, so a draft typed between the two
 *    presses is kept (Ctrl+C would clear it, `/exit` would be typed into it);
 *  - the shell line sets or unsets `CLAUDE_CONFIG_DIR` (decision 1: the default account runs with
 *    it unset, never set to `~/.claude`), then `claude --resume <id>` with the permission mode the
 *    session's status line showed. */

export type FollowPane = { id: number; sessionId: string }

export type FollowDeps = {
  /** Every live terminal pane that knows the Claude session it runs. */
  panes(): FollowPane[]
  /** The account each terminal pane runs on (`accounts_panes`), asked now. */
  paneAccounts(): Promise<Record<number, string>>
  /** Where the sessions go: the active account now; null while unknown. */
  target(): Account | null
  /** Records pane `pane` on account `id` (`accounts_move_pane`). */
  record(pane: number, id: string): Promise<void>
  /** What the pane's terminal shows; undefined while no view of it is mounted. */
  lines(pane: number): string[] | undefined
  write(pane: number, data: string): Promise<void>
  /** Whether a Claude Code process runs under the pane's shell. Never wrongly true; wrongly false
   *  for a session no account's `claude agents` lists. */
  runsClaude(pane: number): Promise<boolean>
  /** The session is working or waiting on the maintainer, as the app last heard. */
  busy(sessionId: string): Promise<boolean>
  /** The session is a background child (a `claude attach` to one shows the same input box); null
   *  while the app cannot tell yet. */
  child(sessionId: string): Promise<boolean | null>
  /** Claude left pane `pane` and session `sessionId` was resumed in it: the pane keeps the id. */
  resumed(pane: number, sessionId: string): void
  /** Panes run cmd.exe or PowerShell rather than a POSIX shell or fish. */
  windows: boolean
  sleep(ms: number): Promise<void>
  now(): number
}

/** How often the panes still to move are looked at. */
export const TICK_MS = 1000
/** Between two keys, so each is read on its own (`SEND_GAP_MS` in `chat-input/pty.ts` is 50), and
 *  well inside the window in which a second Ctrl+D counts as the double press. */
export const KEY_GAP_MS = 100
/** How often a screen is read while waiting for it to change. */
const POLL_MS = 250
/** How long Claude gets to leave once Ctrl+D was pressed twice. */
export const LEAVE_MS = 15_000
/** How long Claude gets to say the first Ctrl+D armed its exit, inside its double-press window. */
export const ARM_MS = 800
/** Claude's word that one more Ctrl+D leaves. */
const ARMED = /again to exit/i
/** How long the shell's screen has to stay still before the lines are typed. */
export const SHELL_SETTLE_MS = 500
/** Tries per pane and switch: a Claude that did not leave is left where it is. */
export const TRIES = 2
const SCREEN_ROWS = 40

export const EOF = '\x04'
export const ESC = '\x1b'

/** A Claude turn in progress: its spinner line says how to interrupt it. */
const WORKING = /esc to interrupt/i
const RULE = /^\s*─{8,}/

/** The flags that resume a session in the permission mode its status line shows, so a session
 *  started with `--dangerously-skip-permissions` does not come back asking for every tool. */
export function modeFlags(lines: string[]): string {
  const screen = tail(lines, SCREEN_ROWS)
  let r = screen.length - 1
  while (r >= 0 && !RULE.test(screen[r])) r--
  const status = screen.slice(r + 1).join('\n')
  if (/bypass permissions on/i.test(status)) return ' --dangerously-skip-permissions'
  if (/accept edits on/i.test(status)) return ' --permission-mode acceptEdits'
  if (/plan mode on/i.test(status)) return ' --permission-mode plan'
  return ''
}

/** The shell the pane fell back to, by its prompt: PowerShell's starts with `PS `. */
export type Shell = 'posix' | 'cmd' | 'powershell'

export function shellOf(lines: string[], windows: boolean): Shell {
  if (!windows) return 'posix'
  const last = tail(lines, SCREEN_ROWS).at(-1) ?? ''
  return /^PS /.test(last) ? 'powershell' : 'cmd'
}

/** The line that moves a shell to `a`: a `claude` typed there afterwards runs on it. On POSIX
 *  shells and fish alike: `export` is a fish function too, and `unset` succeeds wherever it exists,
 *  so fish's `set -e` runs only where `unset` is no command (in bash or zsh `set -e` would turn
 *  on errexit). A leading space keeps it out of history where the shell is set to. */
export function accountLine(a: Pick<Account, 'configDir' | 'isDefault'>, shell: Shell): string {
  switch (shell) {
    case 'posix':
      return a.isDefault ? ` unset ${CONFIG_DIR_VAR} 2>/dev/null || set -e ${CONFIG_DIR_VAR}` : ` export ${CONFIG_DIR_VAR}=${shellWord(a.configDir)}`
    case 'powershell':
      return a.isDefault ? `Remove-Item Env:${CONFIG_DIR_VAR} -ErrorAction SilentlyContinue` : `$env:${CONFIG_DIR_VAR} = '${a.configDir.replace(/'/g, "''")}'`
    case 'cmd':
      return a.isDefault ? `set ${CONFIG_DIR_VAR}=` : `set "${CONFIG_DIR_VAR}=${a.configDir}"`
  }
}

/** A session id as Claude Code writes it: nothing a shell would read as more than a word. */
const SESSION_ID = /^[\w-]+$/

/** What a pane's screen says about the Claude in it. `idle`: the input box is up and empty, no
 *  dialog over it, no turn running. `draft`: the box holds text, which is never touched. */
export function screenState(lines: string[]): 'idle' | 'draft' | 'busy' | 'none' {
  const box = inputBox(lines)
  if (!box) return promptOptions(lines) ? 'busy' : 'none'
  if (WORKING.test(tail(lines, SCREEN_ROWS).join('\n'))) return 'busy'
  return box.text ? 'draft' : 'idle'
}

const still = (lines: string[]) => tail(lines, SCREEN_ROWS).join('\n')

export type Follow = {
  /** The active account changed: every pane on another one that runs Claude is to move. */
  switched(): Promise<void>
  /** Panes still to move. */
  pending(): number[]
  /** Stops looking at the panes; a move under way finishes. */
  stop(): void
}

export function createFollow(d: FollowDeps): Follow {
  /** Panes to move, with the tries each has had since the last switch. */
  const pending = new Map<number, number>()
  /** Each pane's account as last asked, and as moved since. */
  let accounts: Record<number, string> = {}
  /** The screen each pending pane showed at the last tick: idle means still since then. */
  const seen = new Map<number, string>()
  const moving = new Set<number>()
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false

  const schedule = () => {
    if (timer || stopped || pending.size === 0) return
    timer = setTimeout(() => {
      timer = null
      void tick().finally(schedule)
    }, TICK_MS)
  }

  const drop = (pane: number) => {
    pending.delete(pane)
    seen.delete(pane)
  }

  async function tick() {
    const target = d.target()
    if (!target) return
    const live = new Map(d.panes().map((p) => [p.id, p.sessionId]))
    for (const pane of [...pending.keys()]) {
      if (moving.has(pane)) continue
      const session = live.get(pane)
      // Closed, or Claude left it and the pane forgot the session: nothing runs there to move.
      if (!session || !SESSION_ID.test(session)) {
        drop(pane)
        continue
      }
      if (accounts[pane] === target.id) {
        drop(pane)
        continue
      }
      const child = await d.child(session)
      if (child) {
        drop(pane)
        continue
      }
      const lines = d.lines(pane)
      if (child === null || !lines || screenState(lines) !== 'idle' || (await d.busy(session))) {
        seen.delete(pane)
        continue
      }
      // Idle on two looks a tick apart: a spinner between frames, or a box redrawn as a turn
      // starts, is not mistaken for idle.
      const now = still(lines)
      const was = seen.get(pane)
      seen.set(pane, now)
      if (was !== now) continue
      moving.add(pane)
      void move(pane, session)
        .catch((e) => console.warn(`accounts: pane ${pane} did not follow the switch`, e))
        .finally(() => {
          moving.delete(pane)
          schedule()
        })
    }
  }

  /** Reads the screen until `probe` answers, or `ms` pass (null). */
  async function until<T>(ms: number, probe: () => Promise<T | null> | T | null): Promise<T | null> {
    const end = d.now() + ms
    for (;;) {
      const got = await probe()
      if (got !== null) return got
      if (d.now() >= end) return null
      await d.sleep(POLL_MS)
    }
  }

  async function move(pane: number, session: string) {
    const screen = () => d.lines(pane) ?? []
    const flags = modeFlags(screen())
    const tries = (pending.get(pane) ?? 0) + 1
    pending.set(pane, tries)

    // 1. Claude leaves. vim NORMAL mode first goes back to insert, where Ctrl+D is Claude's.
    if (inputBox(screen())?.normal) {
      await d.write(pane, 'i')
      await d.sleep(KEY_GAP_MS)
    }
    const empty = () => {
      const box = inputBox(screen())
      return box !== null && !box.normal && box.text === '' && screenState(screen()) === 'idle'
    }
    if (!empty()) return
    await d.write(pane, EOF)
    // The second Ctrl+D goes only to a Claude that says the first armed its exit. One that leaves
    // on the first already gets none: while it winds down its box is still up, and a second
    // Ctrl+D would reach the shell after it, end it, and close the pane.
    let first: 'armed' | 'left' | null = null
    for (const end = d.now() + ARM_MS; first === null && d.now() < end; ) {
      await d.sleep(KEY_GAP_MS)
      const lines = screen()
      if (!inputBox(lines)) first = 'left'
      else if (ARMED.test(tail(lines, SCREEN_ROWS).join('\n'))) first = 'armed'
    }
    if (first === null) {
      // Not heard, or a key typed in between made a draft: the armed exit lapses on its own.
      if (tries >= TRIES) drop(pane)
      return
    }
    if (first === 'armed') {
      // A key typed in between made a draft: the first Ctrl+D only arms the exit, and lapses.
      if (!empty()) return
      await d.write(pane, EOF)
    }

    let last = ''
    const left = await until(LEAVE_MS, async () => {
      const lines = screen()
      const now = still(lines)
      const steady = now === last
      last = now
      if (!steady || inputBox(lines) || promptOptions(lines)) return null
      return (await d.runsClaude(pane)) ? null : true
    })
    if (!left) {
      // Claude asked something on its way out, or did not hear the keys: leave it running.
      if (promptOptions(screen())) await d.write(pane, ESC)
      if (tries >= TRIES) drop(pane)
      return
    }
    drop(pane)
    await d.sleep(SHELL_SETTLE_MS)

    // 2. The shell moves to the account active now: a switch since may have changed it.
    const target = d.target()
    const moved = !!target && accounts[pane] !== target.id
    if (target && moved) {
      await d.write(pane, `${accountLine(target, shellOf(screen(), d.windows))}\r`)
      await d.sleep(KEY_GAP_MS)
    }
    // 3. The same session resumes in the same pane.
    await d.write(pane, `claude --resume ${session}${flags}\r`)
    d.resumed(pane, session)
    // 4. It is recorded there, and its pane-bar chip goes.
    if (target && moved) {
      await d.record(pane, target.id)
      accounts = { ...accounts, [pane]: target.id }
    }
  }

  return {
    async switched() {
      const target = d.target()
      if (!target || stopped) return
      accounts = await d.paneAccounts()
      // Read again: another switch may have landed while the panes were asked.
      const now = d.target()
      if (!now) return
      for (const p of d.panes()) {
        const of = accounts[p.id]
        // A pane the core recorded on no account is left alone: nothing says where it runs.
        if (!of || of === now.id) drop(p.id)
        else pending.set(p.id, 0)
        seen.delete(p.id)
      }
      schedule()
    },
    pending: () => [...pending.keys()],
    stop() {
      stopped = true
      if (timer) clearTimeout(timer)
      timer = null
    },
  }
}

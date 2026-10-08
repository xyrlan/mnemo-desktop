import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import { store as appStore } from '../layout/app-store'
import { permissionAsk, splitAsk, type ChildSession } from '../mission/types'
import { attachCmd } from '../mission/account'
import { attached, attachDefaults, SETTLE_MS, type Deps } from '../mission/as-me'
import { questionOnScreen } from '../mission/ask'
import { keyFor, promptOnScreen, type Choice, type Prompt } from './prompt'

export type { Choice } from './prompt'

/** Answering a background child's permission prompt. Its inbox socket takes user turns only
 *  and there is no approve CLI (#81), so the key is pressed in a hidden `claude attach <id>` on
 *  the child's own account (`attached`), as `src/mission/ask.ts` answers a dialog: the prompt is
 *  read off the attach's screen and checked to be the call the card shows. Then its option's key
 *  is pressed, and the attach is left once the prompt moved on. Nothing opens in the window. When
 *  the prompt does not show, or shows another call, nothing is pressed and the attach opens in
 *  a terminal instead, to answer by hand. */

export type Answer = { choice: Choice; phase: 'attaching' | 'sent' | 'error'; error?: string; at: number }

export const answerStore = createStore<{ answers: Record<string, Answer> }>(() => ({ answers: {} }))
export const useAnswer = (id: string) => useStore(answerStore, (s) => s.answers[id])

const put = (id: string, a: Answer): Answer => {
  answerStore.setState((s) => ({ answers: { ...s.answers, [id]: a } }))
  return a
}

/** An answer refused for what it is, not for what the screen showed: nothing to do by hand. */
class Refused extends Error {}

/** How much of its end a prompt taller than the screen must show of the card's command. */
const END_CHARS = 200

/** Whether `prompt` asks about `command`, whitespace aside (the terminal wraps and indents it).
 *  A box on screen whole must hold all of the command: a child starts most commands with the same
 *  `cd <worktree> &&`, so a part of one is not enough. A box taller than the screen shows only
 *  its end. A command Claude Code cut short with `…` is compared up to the cut. */
export function asksAbout(prompt: Prompt, command: string): boolean {
  const flat = (s: string) => s.replace(/\s+/g, '')
  const cut = /(…|\.\.\.)$/.test(command.trimEnd())
  const card = flat(command.trimEnd().replace(/(…|\.\.\.)$/, ''))
  const box = flat(prompt.asks)
  if (prompt.whole) return box.includes(card)
  return !cut && box.includes(card.slice(-END_CHARS))
}

async function press(child: ChildSession, choice: Choice, d: Deps) {
  const id = child.id
  const waiting = await d.waitingFor(id)
  if (waiting && !waiting.toLowerCase().includes('permission')) throw new Refused(`${id} is on a ${waiting}, not a permission prompt: nothing was pressed`)
  const ask = permissionAsk(child)
  const command = ask ? splitAsk(ask).command : null

  await attached(child, d, async (s, until) => {
    const shown = () => {
      const lines = s.lines()
      if (questionOnScreen(lines)) throw new Refused(`${id} is showing a question, not a permission prompt: nothing was pressed`)
      return promptOnScreen(lines)
    }
    await until('its permission prompt showed', d.timeoutMs, shown)
    await d.sleep(SETTLE_MS)
    const prompt = await until('its permission prompt showed', d.timeoutMs, shown)
    if (command !== null && !asksAbout(prompt, command)) throw new Error(`the prompt on ${id}'s screen is not the one this card shows, nothing was pressed`)
    const key = keyFor(prompt.options, choice)
    if (key === null) throw new Refused('this prompt does not offer "don\'t ask again": nothing was pressed')
    await s.write(key)
    await until('the prompt took the answer', d.stepMs, () => {
      const now = promptOnScreen(s.lines())
      return now && now.asks === prompt.asks ? null : true
    })
  })
}

/** Answers `child`'s permission prompt with `choice`. Never throws: the outcome lands in
 *  `answerStore` under the child's id. A failure the maintainer can finish by hand opens the
 *  attach in a terminal. */
export async function answerPrompt(child: ChildSession, choice: Choice, deps: Partial<Deps> = {}): Promise<Answer> {
  const d = { ...attachDefaults, ...deps }
  const prior = answerStore.getState().answers[child.id]
  if (prior?.phase === 'attaching') return prior
  put(child.id, { choice, phase: 'attaching', at: Date.now() })
  try {
    await press(child, choice, d)
    return put(child.id, { choice, phase: 'sent', at: Date.now() })
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e)
    if (e instanceof Refused) return put(child.id, { choice, phase: 'error', error: why, at: Date.now() })
    await appStore
      .getState()
      .openCommandTab(child.cwd || undefined, attachCmd(child), child.session_id ?? undefined)
      .catch(() => {})
    return put(child.id, { choice, phase: 'error', error: `${why}: answer it in the attach that opened`, at: Date.now() })
  }
}

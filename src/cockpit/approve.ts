import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import { store as appStore } from '../layout/app-store'
import { paneForSession } from '../layout/tabs'
import { readBuffer, tail } from '../terminal/buffer'
import { tauriPty } from '../pty/client'
import type { ChildSession } from '../mission/types'

/** Answering a background child's permission prompt. Its inbox socket takes user turns only
 *  and there is no approve CLI (#81), so the answer is typed into `claude attach <id>`: open
 *  (or reuse) that terminal, wait until the prompt's option list is on screen, press the key
 *  for the chosen option, and leave the pane open so the user sees the child go on. */

export type Choice = 'yes' | 'always' | 'no'
export type PromptOption = { n: number; text: string }

/** Lines of screen, from the bottom, a live prompt must sit in: older ones are scrollback. */
const SCREEN = 40
const OPTION = /^[\s│|❯>›]*(\d)\.\s+(.+?)\s*$/

/** The numbered options of the permission prompt at the bottom of a terminal (`1. Yes`,
 *  `2. Yes, and don't ask again for …`, `3. No`), or null when none is on screen. */
export function promptOptions(lines: string[]): PromptOption[] | null {
  const screen = tail(lines, SCREEN)
  for (let i = screen.length - 1; i >= 0; i--) {
    const first = OPTION.exec(screen[i])
    if (!first || first[1] !== '1') continue
    const out: PromptOption[] = []
    for (let j = i; j < screen.length; j++) {
      const m = OPTION.exec(screen[j])
      if (!m || Number(m[1]) !== out.length + 1) break
      out.push({ n: Number(m[1]), text: m[2] })
    }
    return out.length >= 2 && out.some((o) => /^yes\b/i.test(o.text)) ? out : null
  }
  return null
}

/** What to type for `choice`: the option's digit, Esc for a deny the list does not name, null
 *  when the prompt does not offer it (not every prompt can be allowed for good). */
export function keyFor(options: PromptOption[], choice: Choice): string | null {
  const pick = (re: RegExp) => options.find((o) => re.test(o.text))
  const o =
    choice === 'yes' ? pick(/^yes\b(?!.*\band\b)/i) ?? pick(/^yes\b/i)
    : choice === 'always' ? pick(/don'?t ask again|always allow|allow all/i)
    : pick(/^no\b/i)
  if (o) return String(o.n)
  return choice === 'no' ? '\x1b' : null
}

/** `claude attach` hands the terminal back to the shell on Ctrl+Z; the child keeps running. */
export const DETACH_KEY = '\x1a'

export type Answer = { choice: Choice; phase: 'attaching' | 'sent' | 'error'; pane: number | null; error?: string; at: number }

export const answerStore = createStore<{ answers: Record<string, Answer> }>(() => ({ answers: {} }))
export const useAnswer = (id: string) => useStore(answerStore, (s) => s.answers[id])

const put = (id: string, a: Answer) => answerStore.setState((s) => ({ answers: { ...s.answers, [id]: a } }))

export type Deps = {
  read: (pane: number) => string[] | undefined
  write: (pane: number, data: string) => Promise<void>
  sleep: (ms: number) => Promise<void>
  /** How long the attached session gets to draw its prompt. */
  timeoutMs: number
}

const defaults: Deps = {
  read: readBuffer,
  write: (pane, data) => tauriPty.write(pane, data),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  timeoutMs: 20_000,
}

const POLL_MS = 250

/** The pane showing `child`'s prompt right now: one tagged with its session (an earlier
 *  attach), or the lone terminal in its cwd. A pane that is not showing the prompt (the attach
 *  was left, the shell is back) is not reused: a digit typed there would go to the shell. */
function paneWithPrompt(child: ChildSession, read: Deps['read']): number | null {
  const pane = paneForSession(appStore.getState(), child)
  if (pane === null || pane <= 0) return null
  const lines = read(pane)
  return lines && promptOptions(lines) ? pane : null
}

/** Answers `child`'s permission prompt with `choice`. Never throws: the outcome lands in
 *  `answerStore` under the child's id, and a failure leaves the pane open to answer by hand. */
export async function answerPrompt(child: ChildSession, choice: Choice, deps: Partial<Deps> = {}): Promise<Answer> {
  const d = { ...defaults, ...deps }
  const prior = answerStore.getState().answers[child.id]
  if (prior?.phase === 'attaching') return prior
  const started = Date.now()
  const fail = (error: string, pane: number | null) => {
    const a: Answer = { choice, phase: 'error', pane, error, at: Date.now() }
    put(child.id, a)
    return a
  }
  put(child.id, { choice, phase: 'attaching', pane: null, at: started })

  let pane = paneWithPrompt(child, d.read)
  if (pane !== null) appStore.getState().goToPane(pane)
  else {
    const before = new Set(Object.keys(appStore.getState().panes))
    await appStore.getState().openCommandTab(child.cwd || undefined, `claude attach ${child.id}`, child.session_id ?? undefined)
    const s = appStore.getState()
    const fresh = Object.keys(s.panes).map(Number).filter((id) => !before.has(String(id)))
    pane = fresh.find((id) => id > 0) ?? s.tabs.find((t) => t.id === s.activeTab)?.focused ?? null
    if (pane === null || pane <= 0) return fail('could not open a terminal for the attach', pane)
  }

  for (;;) {
    const lines = d.read(pane)
    const options = lines && promptOptions(lines)
    if (options) {
      const key = keyFor(options, choice)
      if (key === null) return fail('this prompt does not offer "don\'t ask again" — choose in the attach pane', pane)
      await d.write(pane, key)
      const a: Answer = { choice, phase: 'sent', pane, at: Date.now() }
      put(child.id, a)
      return a
    }
    if (Date.now() - started > d.timeoutMs) return fail('the prompt did not appear in the attach — answer in the attach pane', pane)
    await d.sleep(POLL_MS)
  }
}

/** The attach pane an answer opened, while it is still open in this window. */
export function answerPane(id: string): number | null {
  const pane = answerStore.getState().answers[id]?.pane
  return pane != null && pane > 0 && appStore.getState().panes[pane] ? pane : null
}

/** Leaves the attach an answer opened: the pane goes back to its shell, the child keeps running. */
export function detachAnswer(id: string, write: Deps['write'] = defaults.write) {
  const pane = answerPane(id)
  if (pane === null) return
  void write(pane, DETACH_KEY)
  answerStore.setState((s) => {
    const answers = { ...s.answers }
    delete answers[id]
    return { answers }
  })
}

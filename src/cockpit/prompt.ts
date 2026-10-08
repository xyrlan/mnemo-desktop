import { tail } from '../terminal/buffer'

/** Claude Code's permission prompt as a terminal draws it: read off the screen of a `claude
 *  attach`, and the key that answers it. Imports nothing of the app, so the attach code in
 *  `src/mission/` and the answer in `./approve` both read it without importing each other. */

export type Choice = 'yes' | 'always' | 'no'
export type PromptOption = { n: number; text: string }

/** Lines of screen, from the bottom, a live prompt must sit in: older ones are scrollback. */
const SCREEN = 40
const OPTION = /^[\s│|❯>›]*(\d)\.\s+(.+?)\s*$/
/** The rule a prompt's box opens with, under the conversation. */
const RULE = /^\s*─{8,}/

/** A permission prompt on screen: its options, and what it asks about. */
export type Prompt = {
  options: PromptOption[]
  /** The lines between the rule that opens its box and the options. */
  asks: string
  /** Whether the box's rule is on screen. A box taller than the screen shows only its end. */
  whole: boolean
}

/** The permission prompt at the bottom of a terminal: its numbered options (`1. Yes`,
 *  `2. Yes, and don't ask again for …`, `3. No`), and what it asks about. Null when no prompt is
 *  on screen. */
export function promptOnScreen(lines: string[]): Prompt | null {
  const screen = tail(lines, SCREEN)
  for (let i = screen.length - 1; i >= 0; i--) {
    const first = OPTION.exec(screen[i])
    if (!first || first[1] !== '1') continue
    const options: PromptOption[] = []
    for (let j = i; j < screen.length; j++) {
      const m = OPTION.exec(screen[j])
      if (!m || Number(m[1]) !== options.length + 1) break
      options.push({ n: Number(m[1]), text: m[2] })
    }
    if (options.length < 2 || !options.some((o) => /^yes\b/i.test(o.text))) return null
    let rule = i - 1
    while (rule >= 0 && !RULE.test(screen[rule])) rule--
    return { options, asks: screen.slice(rule + 1, i).join('\n'), whole: rule >= 0 }
  }
  return null
}

/** The prompt's numbered options, or null when none is on screen. */
export function promptOptions(lines: string[]): PromptOption[] | null {
  return promptOnScreen(lines)?.options ?? null
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

// adapted from stablyai/orca src/renderer/src/components/native-chat/native-chat-composer-state.ts
// and use-native-chat-composer-keydown.ts

/** The draft's grammar: a `/command` that opens the draft, and an `@path` anywhere. */

export type Trigger = {
  kind: 'slash' | 'file'
  /** What is typed after the `/` or `@`, up to the caret. */
  query: string
  /** Where the `/` or `@` sits in the draft. */
  start: number
  /** Names this occurrence, so a menu dismissed with Esc stays shut while it is edited. */
  key: string
}

/** The token the caret is in, when it asks for a menu. Only a leading `/` is a command: Claude
 *  Code reads one nowhere else. */
export function triggerAt(draft: string, caret: number): Trigger | null {
  const before = draft.slice(0, caret)
  const slash = /^\/(\S*)$/.exec(before)
  if (slash) return { kind: 'slash', query: slash[1], start: 0, key: 'slash:0' }
  const at = /(?:^|\s)@(\S*)$/.exec(before)
  if (at) {
    const start = before.length - at[1].length - 1
    return { kind: 'file', query: at[1], start, key: `file:${start}` }
  }
  return null
}

/** The draft with the trigger's whole token (through the caret and any word after it) replaced
 *  by `text` and a space, and where the caret goes. */
export function complete(draft: string, trigger: Trigger, caret: number, text: string): { draft: string; caret: number } {
  let end = caret
  while (end < draft.length && !/\s/.test(draft[end])) end++
  const rest = draft.slice(end).replace(/^[^\S\n]+/, '')
  const head = `${draft.slice(0, trigger.start)}${text} `
  return { draft: head + rest, caret: head.length }
}

/** Sent prompts, recalled with ↑ and ↓ as a shell's are. `index` is the entry shown, null when
 *  the draft is the person's own. */
export type History = { entries: readonly string[]; index: number | null }
export const EMPTY_HISTORY: History = { entries: [], index: null }

/** How many sent prompts ↑ reaches back through. */
export const HISTORY_SIZE = 50

export function pushHistory(h: History, sent: string): History {
  if (!sent.trim() || h.entries.at(-1) === sent) return { entries: h.entries, index: null }
  return { entries: [...h.entries, sent].slice(-HISTORY_SIZE), index: null }
}

export function recallPrevious(h: History): { history: History; draft: string } | null {
  if (h.entries.length === 0) return null
  const index = h.index === null ? h.entries.length - 1 : Math.max(0, h.index - 1)
  return { history: { entries: h.entries, index }, draft: h.entries[index] }
}

export function recallNext(h: History): { history: History; draft: string } | null {
  if (h.index === null) return null
  const index = h.index + 1
  if (index >= h.entries.length) return { history: { entries: h.entries, index: null }, draft: '' }
  return { history: { entries: h.entries, index }, draft: h.entries[index] }
}

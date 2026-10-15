// adapted from stablyai/orca src/renderer/src/components/terminal-quick-commands/ (the saved
// command's shape and the save rules; Orca's agent prompts, scopes and "append Enter" are not
// ported: a command here belongs to one repo and always runs). PROJECTS keeps them, and a deck's
// or a dock's menu runs them in a drawer tab.

import { samePath } from '../path/path'

/** One saved command: what the menu shows, and what is typed into the terminal. */
export type QuickCommand = { label: string; command: string }

/** Every repo's commands, by repo root: `Settings['quickCommands']`. */
export type QuickCommands = Record<string, QuickCommand[]>

const NONE: QuickCommand[] = []

/** The key repo `root`'s commands are saved under: `root` itself, else a key naming the same folder
 *  as a path (Windows writes `C:\…` and `c:\…`, either slash), else `root` for a repo with none. */
function keyOf(all: QuickCommands, root: string): string {
  if (Object.hasOwn(all, root)) return root
  return Object.keys(all).find((k) => samePath(k, root)) ?? root
}

/** Repo `root`'s commands, in the order saved, its key compared as a path. The same empty array for
 *  a repo with none, so a selector that returns it does not re-render forever. */
export function commandsFor(all: QuickCommands | undefined, root: string | null): QuickCommand[] {
  return (root !== null && all?.[keyOf(all, root)]) || NONE
}

/** `draft` as it is saved — label trimmed, trailing whitespace off the command — or null when
 *  either is empty (Orca's Save stays disabled then). */
export function cleaned(draft: QuickCommand): QuickCommand | null {
  const label = draft.label.trim()
  const command = draft.command.trimEnd()
  return label && command.trim() ? { label, command } : null
}

/** `all` with `root`'s list replaced, under the key it is saved under already; a repo left with none
 *  is dropped from the record. */
function withList(all: QuickCommands, root: string, list: QuickCommand[]): QuickCommands {
  const next = { ...all }
  const key = keyOf(all, root)
  if (list.length) next[key] = list
  else delete next[key]
  return next
}

export function withAdded(all: QuickCommands, root: string, cmd: QuickCommand): QuickCommands {
  return withList(all, root, [...commandsFor(all, root), cmd])
}

/** `all` with `root`'s command at `index` replaced; unchanged when there is none there. */
export function withEdited(all: QuickCommands, root: string, index: number, cmd: QuickCommand): QuickCommands {
  const list = commandsFor(all, root)
  if (index < 0 || index >= list.length) return all
  return withList(all, root, list.map((c, i) => (i === index ? cmd : c)))
}

export function withRemoved(all: QuickCommands, root: string, index: number): QuickCommands {
  const list = commandsFor(all, root)
  if (index < 0 || index >= list.length) return all
  return withList(all, root, list.filter((_, i) => i !== index))
}

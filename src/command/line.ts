// The command line's state: the text, the row in hand, the batch being asked about, and what
// the last command said. `route.command` says whether it is open; the text is not in the hash,
// so a half-typed command is never restored at the next launch.

import { create } from 'zustand'
import { go, routeStore } from '../world/route'
import type { World } from '../world/types'
import { offers, type Offer } from './complete'
import { bare, parse, type Command, type Parsed } from './parse'
import { run, said } from './run'

export type Row =
  /** The line is whole: Enter runs it (or asks, when it is a batch). */
  | { kind: 'run'; says: string; batch: boolean }
  /** A batch was asked about: Enter runs it, Esc takes it back. */
  | { kind: 'confirm'; says: string }
  | { kind: 'offer'; offer: Offer }
  /** Why the line cannot run yet. Not something to take. */
  | { kind: 'hint'; text: string }

interface LineState {
  text: string
  /** The row in hand. */
  at: number
  asking: { command: Command; says: string } | null
  /** What the last command came to. Kept until the next one is typed. */
  said: { text: string; ok: boolean } | null
  busy: boolean
  /** Counts each request to put the caret in the line, so asking twice works. */
  focus: number
}

const REST: LineState = { text: '', at: 0, asking: null, said: null, busy: false, focus: 0 }

export const lineStore = create<LineState>(() => REST)

const set = (patch: Partial<LineState>) => lineStore.setState(patch)

/** The rows under the line, the first being what Enter does. */
export function rows(state: Pick<LineState, 'text' | 'asking'>, world: World): Row[] {
  if (state.asking) return [{ kind: 'confirm', says: state.asking.says }]
  const parsed = parse(state.text, world)
  const whole = bare(state.text).trim()
  const list: Row[] = offers(state.text, world)
    .filter((o) => !('command' in parsed) || o.fill.trim() !== whole)
    .map((offer) => ({ kind: 'offer', offer }))
  if ('command' in parsed) return [{ kind: 'run', says: parsed.says, batch: parsed.batch }, ...list]
  return list.length ? list : [{ kind: 'hint', text: parsed.error }]
}

/** Opens the line with the caret in it. With `text`, it starts from that. */
export function openCommand(text?: string): void {
  const s = lineStore.getState()
  set({ focus: s.focus + 1, ...(text === undefined ? {} : { text, at: 0, asking: null }) })
  if (!routeStore.getState().route.command) go({ command: true })
}

export function closeCommand(): void {
  set({ text: '', at: 0, asking: null })
  if (routeStore.getState().route.command) go({ command: false })
}

export function type(text: string): void {
  set({ text, at: 0, asking: null, said: null })
}

/** Moves the row in hand, wrapping. */
export function move(by: number, world: World): void {
  const s = lineStore.getState()
  const n = rows(s, world).length
  if (n) set({ at: (s.at + by + n) % n })
}

/** Tab: the row in hand's text into the line, when it has one. */
export function complete(world: World): void {
  const s = lineStore.getState()
  const list = rows(s, world)
  const row = list[s.at]?.kind === 'offer' ? list[s.at] : list.find((r) => r.kind === 'offer')
  if (row?.kind === 'offer') set({ text: row.offer.fill, at: 0, asking: null })
}

async function execute(command: Command, says: string, world: World): Promise<void> {
  set({ busy: true })
  const outcome = await run(command, world)
  if (outcome.ok) {
    set({ ...REST, focus: lineStore.getState().focus, said: { text: said(says, outcome), ok: true } })
    if (routeStore.getState().route.command) go({ command: false })
  } else {
    // A refusal leaves the line as it was typed, so it can be put right.
    set({ busy: false, asking: null, said: { text: said(says, outcome), ok: false } })
  }
}

function proceed(parsed: Parsed, world: World): Promise<void> | void {
  if (!('command' in parsed)) return
  if (parsed.batch) return set({ asking: { command: parsed.command, says: parsed.says }, at: 0 })
  return execute(parsed.command, parsed.says, world)
}

/** Enter: runs the batch asked about; else takes the row in hand, which fills the line, runs
 *  it, or (a batch) asks first. */
export async function enter(world: World): Promise<void> {
  const s = lineStore.getState()
  if (s.busy) return
  if (s.asking) return execute(s.asking.command, s.asking.says, world)
  const row = rows(s, world)[s.at]
  if (!row || row.kind === 'hint' || row.kind === 'confirm') return
  if (row.kind === 'offer') {
    set({ text: row.offer.fill, at: 0, said: null })
    if (row.offer.runs) await proceed(parse(row.offer.fill, world), world)
    return
  }
  await proceed(parse(s.text, world), world)
}

/** Esc: takes back the batch asked about; else closes the line. */
export function escape(): void {
  if (lineStore.getState().asking) set({ asking: null })
  else closeCommand()
}

/** For a test: the line as it is before anything was typed. */
export const resetLine = (): void => lineStore.setState(REST)

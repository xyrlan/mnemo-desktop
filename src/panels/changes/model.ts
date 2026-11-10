// The Changes panel's pure part: a file's two sides as numbered lines, cut to the blocks that
// are drawn, laid side by side when asked; what a key does; which lines a note covers. The line
// diff itself is the app's (`src/nexus/drawer/line-diff.ts`), used where it is.

import type { ChangedFile } from '../../diff/client'
import type { DiffComment } from '../../diff/comment'
import { lineDiff } from '../../nexus/drawer/line-diff'

/** One line of a diff: kept (` `), removed (`-`) or added (`+`), with its number on each side
 *  (null on the side it is not on). Notes are written against `now`, the working side. */
export interface Line {
  sign: ' ' | '-' | '+'
  text: string
  old: number | null
  now: number | null
  /** Its place in the whole diff, which names a fold. */
  at: number
}

/** A file's text without its final newline, which ends the last line and is not one more. */
const body = (text: string) => (text.endsWith('\n') ? text.slice(0, -1) : text)

/** Both sides as one list of numbered lines. */
export function linesOf(original: string, modified: string): Line[] {
  let old = 0
  let now = 0
  return lineDiff(body(original), body(modified)).map((l, at) => ({
    sign: l.sign,
    text: l.text,
    old: l.sign === '+' ? null : ++old,
    now: l.sign === '-' ? null : ++now,
    at,
  }))
}

/** A run of lines that is drawn, after `skipped` kept lines that are not. `fold` names those
 *  skipped lines (the place of the first), so they can be opened. */
export interface Block {
  skipped: number
  fold: number
  lines: Line[]
}

export interface Blocks {
  blocks: Block[]
  /** Kept lines after the last block, not drawn. */
  tail: number
  /** The place of the first of them. */
  tailFold: number
  added: number
  removed: number
}

/** Kept lines drawn around each change. */
export const CONTEXT = 3

/** The lines that are drawn: every change with `CONTEXT` kept lines around it, every line a
 *  note stands on (`noted`, working-side numbers), and every fold in `open`. */
export function blocksOf(lines: Line[], noted: ReadonlySet<number> = new Set(), open: ReadonlySet<number> = new Set(), context = CONTEXT): Blocks {
  const keep = new Uint8Array(lines.length)
  lines.forEach((l, i) => {
    if (l.sign !== ' ') for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++) keep[k] = 1
    else if (l.now !== null && noted.has(l.now)) keep[i] = 1
  })
  // An opened fold is drawn whole: from its first line to the next line that is kept anyway.
  for (const from of open) for (let k = from; k < lines.length && !keep[k]; k++) keep[k] = 2
  const blocks: Block[] = []
  let cur: Block | null = null
  let skipped = 0
  let fold = 0
  lines.forEach((l, i) => {
    if (!keep[i]) {
      if (skipped === 0) fold = i
      skipped++
      cur = null
      return
    }
    if (!cur) {
      cur = { skipped, fold, lines: [] }
      blocks.push(cur)
      skipped = 0
    }
    cur.lines.push(l)
  })
  return {
    blocks,
    tail: skipped,
    tailFold: fold,
    added: lines.filter((l) => l.sign === '+').length,
    removed: lines.filter((l) => l.sign === '-').length,
  }
}

/** A row of the side-by-side view: what was there, and what is. */
export interface Pair {
  left: Line | null
  right: Line | null
}

/** A block's lines side by side: a kept line on both sides, a run of removed lines beside the
 *  run of added ones that follows it, the longer run going on alone. */
export function pairsOf(lines: Line[]): Pair[] {
  const out: Pair[] = []
  let i = 0
  while (i < lines.length) {
    if (lines[i].sign === ' ') {
      out.push({ left: lines[i], right: lines[i] })
      i++
      continue
    }
    const gone: Line[] = []
    const came: Line[] = []
    while (i < lines.length && lines[i].sign === '-') gone.push(lines[i++])
    while (i < lines.length && lines[i].sign === '+') came.push(lines[i++])
    for (let k = 0; k < Math.max(gone.length, came.length); k++) out.push({ left: gone[k] ?? null, right: came[k] ?? null })
  }
  return out
}

/** The most lines of one file that are drawn; a file changed in more says how many are left. */
export const MAX_DRAWN = 1500

/** `blocks` cut to at most `max` lines; `left` counts the drawn lines cut off. */
export function capped(blocks: Block[], max = MAX_DRAWN): { blocks: Block[]; left: number } {
  const out: Block[] = []
  let room = max
  let left = 0
  for (const b of blocks) {
    if (room <= 0) {
      left += b.lines.length
      continue
    }
    if (b.lines.length <= room) out.push(b)
    else {
      out.push({ ...b, lines: b.lines.slice(0, room) })
      left += b.lines.length - room
    }
    room -= b.lines.length
  }
  return { blocks: out, left }
}

/** A file's state as a letter and a word: the letter is the shape, the word is said. */
export const STATUS: Record<ChangedFile['status'], { letter: string; word: string }> = {
  added: { letter: 'A', word: 'added' },
  untracked: { letter: 'U', word: 'untracked' },
  modified: { letter: 'M', word: 'modified' },
  deleted: { letter: 'D', word: 'deleted' },
  renamed: { letter: 'R', word: 'renamed' },
  conflicted: { letter: '!', word: 'conflicted' },
}

export const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')

/** Whether reading the changes failed because the worktree is no longer there: its folder is
 *  gone (git cannot start in it) or is no longer a git tree. As the ship's window read it. */
export function isGone(error: string): boolean {
  return /^git: |not a git repository|no such file or directory|os error (2|3|267)\b|cannot change to/i.test(error)
}

/** What a key asks of the panel while it has the focus. */
export type Act = { kind: 'move'; by: 1 | -1 } | { kind: 'layout' } | { kind: 'read' } | { kind: 'open' } | { kind: 'send' }

type Key = { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }

/** The act a key asks for; null when the key is not the panel's (it goes on to the frame). */
export function actOf(e: Key): Act | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null
  switch (e.key.length === 1 ? e.key.toLowerCase() : e.key) {
    case 'ArrowDown':
    case 'j':
      return { kind: 'move', by: 1 }
    case 'ArrowUp':
    case 'k':
      return { kind: 'move', by: -1 }
    case 'v':
      return { kind: 'layout' }
    case 'u':
      return { kind: 'read' }
    case 'o':
      return { kind: 'open' }
    case 's':
      return { kind: 'send' }
    default:
      return null
  }
}

/** The file after (or before) `path` in `files`, stopping at the ends; the first when `path`
 *  is not listed. Null when nothing is. */
export function movedFile(files: readonly ChangedFile[], path: string | null, by: 1 | -1): string | null {
  if (!files.length) return null
  const at = files.findIndex((f) => f.path === path)
  if (at < 0) return files[0].path
  return files[Math.max(0, Math.min(files.length - 1, at + by))].path
}

/** The lines a note being written covers: the line clicked, or with shift everything from the
 *  line the note was started on through it, in either direction. */
export function rangeOf(anchor: number | null, line: number, shift: boolean): { startLine?: number; lineNumber: number } {
  if (!shift || anchor === null || anchor === line) return { lineNumber: line }
  return { startLine: Math.min(anchor, line), lineNumber: Math.max(anchor, line) }
}

/** The text of working-side lines `from`..`to` as they read now: what a note quotes. */
export function quoteOf(lines: Line[], from: number, to: number): string {
  return lines
    .filter((l) => l.now !== null && l.now >= from && l.now <= to)
    .map((l) => l.text)
    .join('\n')
}

/** A file's notes by the working-side line each is drawn under (its last), oldest first. */
export function notesByLine(comments: readonly DiffComment[], file: string): Map<number, DiffComment[]> {
  const out = new Map<number, DiffComment[]>()
  for (const c of comments) {
    if (c.filePath !== file) continue
    out.set(c.lineNumber, [...(out.get(c.lineNumber) ?? []), c])
  }
  return out
}

/** A file in the worktree as a path to open outside the app. */
export const absolute = (root: string, path: string) => `${root.replace(/[\\/]+$/, '')}/${path}`

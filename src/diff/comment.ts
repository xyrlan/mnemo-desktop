import { useEffect, useRef, type RefObject } from 'react'

/** A note on lines of a changed file, kept until it is sent to the worktree's agent. Named after
 *  Orca's `DiffComment`, whose decorator this feeds; the UI says "note", as Orca's does. */
export type DiffComment = {
  id: string
  /** The worktree the note belongs to (its path). */
  worktreeId: string
  /** The file, relative to the worktree's top level. */
  filePath: string
  /** The last line the note covers, on the working (new) side. */
  lineNumber: number
  /** The first line, when the note covers more than one. */
  startLine?: number
  body: string
  /** The lines as they read when the note was written, so the agent sees what was meant. */
  quote?: string
  createdAt: number
}

/** "Line 12" or "Lines 12-14". */
export function getDiffCommentLineLabel(c: { lineNumber: number; startLine?: number }): string {
  return c.startLine !== undefined && c.startLine !== c.lineNumber ? `Lines ${c.startLine}-${c.lineNumber}` : `Line ${c.lineNumber}`
}

/** Roughly the lines a note's body takes in its card: its own lines, wrapped at ~60 characters.
 *  The view zone's first height comes from this; the card then measures itself. */
export function getCommentBodyLayoutLineCount(body: string): number {
  return body.split('\n').reduce((n, line) => n + Math.max(1, Math.ceil(line.length / 60)), 0)
}

/** Whether the component is still mounted, for an async handler finishing after it left. */
export function useMountedRef(): RefObject<boolean> {
  const ref = useRef(true)
  useEffect(() => {
    ref.current = true
    return () => {
      ref.current = false
    }
  }, [])
  return ref
}

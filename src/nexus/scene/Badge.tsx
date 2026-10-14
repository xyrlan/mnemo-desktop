import { BookOpen, Bot, FilePlus, Globe, ListTodo, Pencil, Plug, Search, Terminal, Wrench, type LucideIcon } from 'lucide-react'
import type { ReactElement } from 'react'
import type { Badge as BadgeKind } from '../types'

/** The badges over a robot's head (spec Q14, Q18), drawn in code as pixel grids on the art's own
 *  grid: one badge pixel is two art pixels. Colour means state only (Q11): `alert` is the
 *  needs-you token and the flags the working (checks running) and done (checks passed) tokens;
 *  `fire` and `zzz` carry no state colour, so they use red and the palette's pale lavender. */
const GRIDS: Record<Exclude<BadgeKind, null>, string[]> = {
  alert: ['..kkk..', '.kOOOk.', 'kOOwOOk', 'kOOwOOk', 'kOOwOOk', 'kOOOOOk', 'kOOwOOk', '.kOOOk.', '..kkk..'],
  zzz: ['.....ZZZZ', '........Z', '.......Z.', '......Z..', '.....ZZZZ', 'ZZZ......', '..Z......', '.Z.......', 'ZZZ......'],
  'flag-pending': ['pkkkkk.', 'pkPPPPk', 'pkPPPPk', 'pkPPPk.', 'pkkkk..', 'p......', 'p......', 'p......', 'pp.....'],
  'flag-ready': ['pkkkkk.', 'pkDDDDk', 'pkDDDDk', 'pkDDDk.', 'pkkkk..', 'p......', 'p......', 'p......', 'pp.....'],
  fire: ['...k...', '..kRk..', '..kRRk.', '.kRRRRk', 'kRRYRRk', 'kRYYYRk', 'kRYYYRk', '.kRYRk.', '..kkk..'],
}

const INK: Record<string, string> = {
  k: 'var(--nexus-ink)',
  w: 'var(--nexus-light)',
  p: 'var(--nexus-light)',
  Z: 'var(--nexus-lavender)',
  O: 'var(--state-needs-you)',
  P: 'var(--state-working)',
  D: 'var(--state-done)',
  R: 'var(--nexus-fire)',
  Y: 'var(--nexus-ember)',
}

/** Art pixels per badge pixel. */
const BADGE_PX = 2

export function Badge({ kind, scale }: { kind: Exclude<BadgeKind, null>; scale: number }) {
  const rows = GRIDS[kind]
  const cols = rows[0].length
  const rects: ReactElement[] = []
  rows.forEach((row, y) =>
    [...row].forEach((c, x) => {
      if (c !== '.') rects.push(<rect key={`${x}.${y}`} x={x} y={y} width={1} height={1} fill={INK[c]} />)
    }),
  )
  return (
    <svg
      className="nexus-badge"
      data-badge={kind}
      viewBox={`0 0 ${cols} ${rows.length}`}
      width={cols * BADGE_PX * scale}
      height={rows.length * BADGE_PX * scale}
      shapeRendering="crispEdges"
      aria-hidden
    >
      {rects}
    </svg>
  )
}

/** The tool a working robot swings, from the timeline's `Running …` (spec Q18). */
const TOOLS: Array<[RegExp, LucideIcon]> = [
  [/^bash|^shell|^powershell/i, Terminal],
  [/^(edit|multiedit|notebookedit)$/i, Pencil],
  [/^write$/i, FilePlus],
  [/^read$/i, BookOpen],
  [/^(grep|glob|toolsearch|ls)$/i, Search],
  [/^web/i, Globe],
  [/^(task|agent)/i, Bot],
  [/^todo/i, ListTodo],
  [/^mcp__/i, Plug],
]

export const toolIcon = (tool: string): LucideIcon => TOOLS.find(([re]) => re.test(tool))?.[1] ?? Wrench

import { BookOpen, Bot, FilePlus, Globe, ListTodo, Pencil, Plug, Search, Terminal, Wrench, type LucideIcon } from 'lucide-react'
import type { ReactElement } from 'react'
import type { Badge as BadgeKind } from '../types'

/** The badges over a robot's head (spec Q14, Q18), drawn in code as pixel grids on the art's own
 *  grid: one badge pixel is two art pixels. Colour means state only (Q11): `alert` is the
 *  needs-you token and the flags the working (checks running) and done (checks passed) tokens;
 *  `fire` and `zzz` carry no state colour, so they use red and the palette's pale lavender, and
 *  `flag-draft` none either: its cloth is an empty outline at half-mast, no state yet.
 *
 *  A badge is layers of one size. `flag-pending` is the pole and an hourglass that hold still,
 *  plus the cloth in two frames, `wave-a` and `wave-b`: the stylesheet swaps them while checks
 *  run, and with reduced motion only `wave-a` shows, so the flag stops and the hourglass stays. */
type Layer = { rows: string[]; part?: 'wave-a' | 'wave-b' }

const one = (rows: string[]): Layer[] => [{ rows }]

const GRIDS: Record<Exclude<BadgeKind, null>, Layer[]> = {
  alert: one(['..kkk..', '.kOOOk.', 'kOOwOOk', 'kOOwOOk', 'kOOwOOk', 'kOOOOOk', 'kOOwOOk', '.kOOOk.', '..kkk..']),
  zzz: one(['.....ZZZZ', '........Z', '.......Z.', '......Z..', '.....ZZZZ', 'ZZZ......', '..Z......', '.Z.......', 'ZZZ......']),
  'flag-pending': [
    { rows: ['p...........', 'p......kkkkk', 'p......kPPPk', 'p.......kPk.', 'p........P..', 'p.......kwk.', 'p......kwPwk', 'p......kPPPk', 'pp.....kkkkk'] },
    { part: 'wave-a', rows: ['.kkkkk......', '.kPPPPk.....', '.kPPPPk.....', '.kPPPk......', '.kkkk.......', '............', '............', '............', '............'] },
    { part: 'wave-b', rows: ['.kkk........', '.kPPkkk.....', '.kPPPPk.....', '.kPPPPk.....', '.kkPPk......', '...kk.......', '............', '............', '............'] },
  ],
  'flag-ready': one(['pkkkkk.', 'pkDDDDk', 'pkDDDDk', 'pkDDDk.', 'pkkkk..', 'p......', 'p......', 'p......', 'pp.....']),
  'flag-draft': one(['p......', 'p......', 'p......', 'pw.w.w.', 'p.....w', 'pw.....', 'p.w.w.w', 'p......', 'pp.....']),
  fire: one(['...k...', '..kRk..', '..kRRk.', '.kRRRRk', 'kRRYRRk', 'kRYYYRk', 'kRYYYRk', '.kRYRk.', '..kkk..']),
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

const pixels = (rows: string[], at: string): ReactElement[] =>
  rows.flatMap((row, y) =>
    [...row].flatMap((c, x) => (c === '.' ? [] : [<rect key={`${at}${x}.${y}`} x={x} y={y} width={1} height={1} fill={INK[c]} />])),
  )

export function Badge({ kind, scale }: { kind: Exclude<BadgeKind, null>; scale: number }) {
  const layers = GRIDS[kind]
  const { rows } = layers[0]
  const cols = rows[0].length
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
      {layers.map((l, i) =>
        l.part ? (
          <g key={l.part} className={`nexus-${l.part}`}>
            {pixels(l.rows, l.part)}
          </g>
        ) : (
          pixels(l.rows, String(i))
        ),
      )}
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

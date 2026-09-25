// adapted from stablyai/orca src/renderer/src/components/tab-group/tab-drop-zone.ts
// (resolvePaneColumnEdgeZone), tab-insertion.ts, tab-drag-drop-commit.ts and
// components/terminal-pane/terminal-tab-strip-drop-target.ts (resolveTabStripInsertion) (MIT, 122b8c25)
import type { TabTarget, WorktreeLayout } from '../layout/store'
import { moveTabIn } from '../layout/groups'
import type { Side } from '../layout/tree'

export type Point = { x: number; y: number }
export type Rect = { left: number; top: number; width: number; height: number }

/** A group as a drag sees it, measured when the drag starts: the whole panel, its tab row, its
 *  body, and its tabs in order. */
export type GroupRects = { group: string; panel: Rect; row: Rect; body: Rect; tabs: { id: string; rect: Rect }[] }

/** Where a dragged tab would land:
 *  - `row`: in that group's row, before the tab at `slot` (the row's length: after the last);
 *  - `body`: the middle of that group's body, at the end of its row;
 *  - `split`: the outer band of that group's body, in a new group on that side. */
export type TabDrop = { kind: 'row'; group: string; slot: number } | { kind: 'body'; group: string } | { kind: 'split'; group: string; side: Side }

/** The share of a body, from each edge, that opens a new group on that side. */
export const EDGE = 0.2

const inside = (r: Rect, p: Point) => p.x >= r.left && p.x <= r.left + r.width && p.y >= r.top && p.y <= r.top + r.height

/** The side of a group's body the point is on the outer band of: the outer 20% of the group's
 *  width on the left and right, and of the body's height at its top and bottom. Never over the
 *  tab row, which is for reordering. Null in the middle or outside the body. */
export function edgeZone(panel: Rect, body: Rect, p: Point): Side | null {
  if (!inside(body, p) || body.height <= 0 || panel.width <= 0) return null
  const x = p.x - panel.left
  if (x < panel.width * EDGE) return 'left'
  if (x > panel.width * (1 - EDGE)) return 'right'
  const y = p.y - body.top
  if (y < body.height * EDGE) return 'up'
  if (y > body.height * (1 - EDGE)) return 'down'
  return null
}

/** The slot a point at `x` falls in among a row's tabs (left to right): before the first tab
 *  whose middle it is left of; after the last when it is past them all. */
export function rowSlot(tabs: readonly Rect[], x: number): number {
  const i = tabs.findIndex((r) => x < r.left + r.width / 2)
  return i < 0 ? tabs.length : i
}

/** Where a tab let go at `p` lands, from the groups' rects alone (no check that it changes
 *  anything). A row first, then a body's outer band, then its middle; null outside every group. */
export function dropAt(groups: readonly GroupRects[], p: Point): TabDrop | null {
  for (const g of groups) {
    if (!inside(g.panel, p)) continue
    if (inside(g.row, p)) return { kind: 'row', group: g.group, slot: rowSlot(g.tabs.map((t) => t.rect), p.x) }
    const side = edgeZone(g.panel, g.body, p)
    if (side) return { kind: 'split', group: g.group, side }
    if (inside(g.body, p)) return { kind: 'body', group: g.group }
  }
  return null
}

/** The move that dropping tab `id` at `drop` asks the store for; null when it asks for none (the
 *  middle of its own group's body, or its own place in its row). A slot in its own row counts the
 *  tab itself, which leaves its place first: `index` is where it ends up. */
export function moveFor(l: Pick<WorktreeLayout, 'groups'>, id: string, drop: TabDrop): TabTarget | null {
  const from = Object.values(l.groups).find((g) => g.tabs.includes(id))
  if (!from || !l.groups[drop.group]) return null
  if (drop.kind === 'split') return { group: drop.group, side: drop.side }
  if (drop.kind === 'body') return drop.group === from.id ? null : { group: drop.group }
  if (drop.group !== from.id) return { group: drop.group, index: drop.slot }
  const at = from.tabs.indexOf(id)
  const index = at < drop.slot ? drop.slot - 1 : drop.slot
  return index === at ? null : { group: drop.group, index }
}

/** Whether `moveTab(id, to)` would change anything: the store's own rule, which also refuses a
 *  group's only tab dropped on its own edge or on the facing edge of the group beside it (Orca). */
export function changes(l: WorktreeLayout, id: string, to: TabTarget): boolean {
  return moveTabIn(l, id, to, () => 'group-probe') !== l
}

/** Where tab `id` let go at `p` lands and the move that makes it, when that move changes the
 *  layout; null otherwise, so nothing is drawn and nothing happens. */
export function resolveTabDrop(l: WorktreeLayout, groups: readonly GroupRects[], id: string, p: Point): { drop: TabDrop; to: TabTarget } | null {
  const drop = dropAt(groups, p)
  const to = drop && moveFor(l, id, drop)
  return drop && to && changes(l, id, to) ? { drop, to } : null
}

/** The half of a group's panel a new group on `side` would take, for the "New split" overlay. */
export function halfOf(panel: Rect, side: Side): Rect {
  const { left, top, width, height } = panel
  if (side === 'left') return { left, top, width: width / 2, height }
  if (side === 'right') return { left: left + width / 2, top, width: width / 2, height }
  if (side === 'up') return { left, top, width, height: height / 2 }
  return { left, top: top + height / 2, width, height: height / 2 }
}

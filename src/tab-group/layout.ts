// adapted from stablyai/orca src/renderer/src/components/tab-group/TabGroupSplitLayout.tsx (SplitNode:
// the edges each group touches, which decide what its row makes room for) (MIT, 122b8c25)
import type { GroupNode } from '../layout/store'
import type { Path } from '../layout/tree'
import { cutBox, FULL, type Box, type DividerBox } from '../chrome/geometry'

/** A group's tab row: as tall as the sidebars' headers, so the rows of the top groups line up
 *  with them as the top band of the window. */
export const ROW_H = 36

/** The workbench's edges a group touches. The top-left group's row makes room for the window's
 *  left controls; the top-right one's ends with the titlebar's right cluster. */
export type Edges = { top: boolean; left: boolean; right: boolean; bottom: boolean }
export type GroupPlace = { group: string; box: Box; edges: Edges }
export type GroupLayout = { groups: GroupPlace[]; seams: DividerBox[] }

const ALL: Edges = { top: true, left: true, right: true, bottom: true }

/** Every group's box (its row and its body) and every seam between groups, flat, as `calc()`
 *  lengths of the workbench: the layout is plain CSS and needs no measuring. The workbench draws
 *  groups and tab layers as siblings keyed by id, so reshaping the tree moves boxes and never
 *  remounts a pane view. */
export function groupLayout(root: GroupNode | null): GroupLayout {
  const out: GroupLayout = { groups: [], seams: [] }
  if (root) walk(root, FULL, [], ALL, out)
  return out
}

function walk(n: GroupNode, box: Box, path: Path, edges: Edges, out: GroupLayout) {
  if (n.kind === 'group') {
    out.groups.push({ group: n.group, box, edges })
    return
  }
  const { a, b, divider } = cutBox(box, n.dir, n.ratio)
  out.seams.push({ path, dir: n.dir, split: box, box: divider })
  const row = n.dir === 'row'
  walk(n.children[0], a, [...path, 0], row ? { ...edges, right: false } : { ...edges, bottom: false }, out)
  walk(n.children[1], b, [...path, 1], row ? { ...edges, left: false } : { ...edges, top: false }, out)
}

/** The group whose row starts the window's top band, and the one whose row ends it. */
export function cornerGroups(l: GroupLayout): { topLeft: string | undefined; topRight: string | undefined } {
  return {
    topLeft: l.groups.find((g) => g.edges.top && g.edges.left)?.group,
    topRight: l.groups.find((g) => g.edges.top && g.edges.right)?.group,
  }
}

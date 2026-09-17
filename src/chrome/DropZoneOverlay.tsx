import { useDrag, type Zone } from './drag'
import type { PaneId } from '../layout/tree'

/** `center` already gets a whole-pane highlight from `.pane.drop-target` (see theme.css); this
 *  only draws the extra strip an edge zone would graft into once round 15 wires it up. */
function edgeOf(zone: Zone | null): Exclude<Zone, 'center'> | null {
  return zone && zone !== 'center' ? zone : null
}

/** Drawn over the pane currently under a dragged bar, showing which edge (if any) the drop
 *  would land in. */
export default function DropZoneOverlay({ pane }: { pane: PaneId }) {
  const zone = useDrag((s) => (s.over === pane ? edgeOf(s.zone) : null))
  if (!zone) return null
  return <div className={`pane-drop-zone zone-${zone}`} aria-hidden />
}

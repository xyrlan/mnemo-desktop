// adapted from stablyai/orca src/renderer/src/components/tab-group/TabGroupDropOverlay.tsx
import { useDrag, type Zone } from './drag'
import type { PaneId } from '../layout/tree'

/** Drawn over the pane a dragged bar is over, covering where the dragged pane would land: the
 *  half on an edge's side (the target splits evenly to hold it), or the whole pane in the
 *  centre, where the two swap. */
export default function DropZoneOverlay({ pane }: { pane: PaneId }) {
  const zone = useDrag((s): Zone | null => (s.from !== null && s.over === pane ? s.zone : null))
  if (!zone) return null
  return (
    <div className={`pane-drop-zone zone-${zone}`} data-zone={zone} aria-hidden>
      {zone === 'center' && <span className="pane-drop-zone-label">Swap</span>}
    </div>
  )
}

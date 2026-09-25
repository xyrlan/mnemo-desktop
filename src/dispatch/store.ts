import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'

/** What each parent workspace's Dispatch tab shows, by the parent's path: kept outside the pane so
 *  `openDispatch` can say it before the pane exists, and so it survives the pane remounting. */

export type DetailTab = 'conversation' | 'diff' | 'checks'

export type DispatchUi = {
  /** The child shown on the right. */
  selected: Record<string, string>
  /** The detail's tab. */
  detail: Record<string, DetailTab>
  /** Folds the user flipped, by `foldKey`: true open, false folded. Absent, a section is folded
   *  when its wave is finished, and a wave's done rows are folded while it has work open. */
  folds: Record<string, boolean>
  /** The last ask to bring a wave or a child into view (`openDispatch`); `seq` makes each ask new. */
  reveal: Record<string, { target: string; seq: number }>
}

export const uiStore = createStore<DispatchUi>(() => ({ selected: {}, detail: {}, folds: {}, reveal: {} }))
export const useUi = <T,>(sel: (s: DispatchUi) => T) => useStore(uiStore, sel)

/** A section's fold (`part: 'wave'`), or the fold of its done rows (`part: 'done'`). */
export const foldKey = (parent: string, wave: string, part: 'wave' | 'done') => `${parent}\n${wave}\n${part}`

let seq = 0

export function select(parent: string, child: string | null) {
  uiStore.setState((s) => {
    const selected = { ...s.selected }
    if (child === null) delete selected[parent]
    else selected[parent] = child
    return { selected }
  })
}

export function setDetail(parent: string, tab: DetailTab) {
  uiStore.setState((s) => ({ detail: { ...s.detail, [parent]: tab } }))
}

export function setFold(key: string, open: boolean) {
  uiStore.setState((s) => ({ folds: { ...s.folds, [key]: open } }))
}

/** Asks the tab of `parent` to unfold and scroll to `target`, a child or a wave's feature. */
export function reveal(parent: string, target: string) {
  uiStore.setState((s) => ({ reveal: { ...s.reveal, [parent]: { target, seq: ++seq } } }))
}

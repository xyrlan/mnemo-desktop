import type { ReactNode } from 'react'
import { missionStore, useMission } from '../mission/app-store'
import { foldsOpen, type Fold } from '../mission/store'
import type { ChildRow, Inbox } from './inbox'
import './cockpit.css'

/** The cockpit's three lists — what needs you, `andando:`, `feito hoje:` — as the sidebar and
 *  the pane both render them. Each surface brings its own needs list (`needs`, shown when there
 *  is any; `empty` otherwise) and its own rows for the two folds; the folds' open state is the
 *  mission store's, so both surfaces agree. */
export default function CockpitBody({ inbox, needs, empty, renderRows }: {
  inbox: Inbox
  needs: ReactNode
  empty: ReactNode
  renderRows: (rows: ChildRow[]) => ReactNode
}) {
  const folds = useMission((s) => s.folds)
  const open = foldsOpen(folds, inbox.needs.length)
  const section = (fold: Fold, title: string, rows: ChildRow[]) =>
    rows.length > 0 && (
      <div className={`ck-section ck-section-${fold}`}>
        <button className="ck-fold" aria-expanded={open[fold]} onClick={() => missionStore.getState().setFold(fold, !open[fold])}>
          {open[fold] ? '▾' : '▸'} {title}: {rows.length}
        </button>
        {open[fold] && renderRows(rows)}
      </div>
    )
  return (
    <>
      {inbox.needs.length > 0 ? needs : empty}
      {section('working', 'working', inbox.working)}
      {section('done', 'done today', inbox.done)}
    </>
  )
}

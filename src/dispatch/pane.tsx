import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft } from 'lucide-react'
import { store as layout, useApp } from '../layout/app-store'
import { leaves, type PaneId } from '../layout/tree'
import { openEditor } from '../editor/actions'
import { openUrl } from '../github/actions'
import { stopChild, takeOver } from './run'
import type { ChildSession } from '../mission/types'
import { useFleet } from '../fleet/store'
import type { PaneViewProps } from '../panes/registry'
import { dispatchTitle, waveOfTarget, type Wave } from './model'
import { knownWorktrees, useWaves } from './live'
import { foldKey, select, setFold, useUi } from './store'
import { WaveList } from './list'
import { Detail, type DetailActions } from './detail'
import './dispatch.css'

/** A title this tab gave itself, which it may change again; any other is the user's. */
const OWN_TITLE = /^Dispatch( · \d+ needs? you)?$/

const norm = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p)
const within = (path: string, dir: string) => path === dir || path.startsWith(dir === '/' ? dir : `${dir}/`)

/** Whether the pane's tab is the one its group shows. Hidden panes of parked workspaces stay
 *  mounted; they poll nothing. */
function useShown(id: PaneId): boolean {
  return useApp((s) => {
    const t = s.tabs.find((x) => leaves(x.root).includes(id))
    return !!t && Object.values(s.groups).some((g) => g.activeTab === t.id)
  })
}

/** Keeps the tab's title the alert (spec decision 3), unless the user named it. */
function useTitle(id: PaneId, waves: Wave[]) {
  const title = dispatchTitle(waves)
  const tab = useApp((s) => s.tabs.find((x) => leaves(x.root).includes(id))?.id ?? null)
  const name = useApp((s) => s.tabs.find((x) => leaves(x.root).includes(id))?.name)
  useEffect(() => {
    if (tab && name !== title && (!name || OWN_TITLE.test(name))) layout.getState().renameTab(tab, title)
  }, [tab, name, title])
}

/** A clock for "3m ago" that moves every half minute. */
function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), ms)
    return () => window.clearInterval(t)
  }, [ms])
  return now
}

/** The Dispatch tab of one parent workspace (spec decisions 3 to 6): its waves on the left,
 *  newest first, the children that need you on top of each with their answer card open; the
 *  selected child on the right. */
export function DispatchPane({ id, props }: PaneViewProps) {
  const parent = norm(String(props.parent ?? ''))
  const waves = useWaves(parent)
  const selected = useUi((s) => s.selected[parent] ?? null)
  const tab = useUi((s) => s.detail[parent] ?? 'conversation')
  const shown = useShown(id)
  const now = useNow()
  const repos = useFleet((f) => f.repos)
  const open = useApp((s) => s.worktrees)
  const list = useRef<HTMLDivElement>(null)
  useTitle(id, waves)

  const row = useMemo(() => waves.flatMap((w) => w.rows).find((r) => r.child?.id === selected) ?? null, [waves, selected])
  // Its answer card is the conversation's foot while the detail shows its conversation.
  const answeringRight = row?.child && tab === 'conversation' ? row.child.id : null

  // `openDispatch` asked for a child or a wave: unfold it and bring it into view, once it is listed.
  const ask = useUi((s) => s.reveal[parent])
  const done = useRef(0)
  useEffect(() => {
    if (!ask || ask.seq === done.current) return
    const w = waveOfTarget(waves, ask.target)
    if (!w) return
    done.current = ask.seq
    setFold(foldKey(parent, w.key, 'wave'), true)
    const r = w.rows.find((x) => x.child?.id === ask.target)
    if (r?.state === 'done' && !w.finished) setFold(foldKey(parent, w.key, 'done'), true)
    const frame = requestAnimationFrame(() => {
      const els = [...(list.current?.querySelectorAll<HTMLElement>(r ? '[data-row]' : '[data-wave]') ?? [])]
      const el = els.find((e) => (r ? e.dataset.row === r.key : e.dataset.wave === w.feature))
      el?.scrollIntoView?.({ block: 'nearest' })
    })
    return () => cancelAnimationFrame(frame)
  }, [ask, waves, parent])

  const actions = useMemo<DetailActions>(() => {
    const worktreeOf = (cwd: string) => {
      const c = norm(cwd)
      return knownWorktrees(repos, open).map(norm).filter((w) => within(c, w)).sort((a, b) => b.length - a.length)[0] ?? c
    }
    return {
      openUrl,
      openFile: (path) => openEditor(layout, path, undefined, 'auto'),
      openWorkspace: (c: ChildSession) => void layout.getState().switchWorktree(worktreeOf(c.cwd)),
      takeOver: (c) => void takeOver(c),
      stop: (c) => void stopChild(c),
      worktreeOf,
    }
  }, [repos, open])

  const name = parent.split('/').pop() || parent
  return (
    <div className="dispatch-pane" data-pane={id} data-dispatch={parent} data-picked={row?.child ? '' : undefined}>
      <div className="dispatch-body">
        <div className="dispatch-list scrollbar-sleek" ref={list}>
          <div className="flex items-baseline gap-1.5 border-b border-border px-3 py-2">
            <span className="text-[12.5px] font-semibold text-foreground">Dispatch</span>
            <span className="truncate text-[11px] text-muted-foreground" title={parent}>
              from {name}
            </span>
          </div>
          <WaveList parent={parent} waves={waves} selected={selected} answeringRight={answeringRight} actions={actions} now={now} />
        </div>
        <div className="dispatch-detail">
          <button type="button" className="dispatch-back items-center gap-1 border-b border-border px-3 py-1.5 text-left text-[11px] text-muted-foreground hover:text-foreground" onClick={() => select(parent, null)} data-back>
            <ChevronLeft className="size-3.5" aria-hidden />
            All waves
          </button>
          <Detail parent={parent} row={row} shown={shown} actions={actions} />
        </div>
      </div>
    </div>
  )
}

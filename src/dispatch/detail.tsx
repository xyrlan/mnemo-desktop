import { useEffect, useMemo, useState } from 'react'
import { FolderOpen, GitBranch, Square, SquareTerminal } from 'lucide-react'
import { Button } from '@/ui'
import { cn } from '@/ui/cn'
import { AgentStateDot } from '../dashboard/AgentStateDot'
import { ChildConversation } from '../mission/conversation'
import { missionStore } from '../mission/app-store'
import { tauriMission } from '../mission/client'
import { statusMarkers } from '../mission/timeline'
import type { ChildSession, TimelineLine } from '../mission/types'
import { ChildDiff } from '../diff/ChildDiff'
import type { Row } from './model'
import { PrLine, rowLook, type ListActions } from './list'
import { setDetail, useUi, type DetailTab } from './store'
import { ChildChecks } from './checks'

/** The tab's right side (spec decision 5): the selected child, with Conversation | Diff | Checks,
 *  and Take over, Stop and Open workspace. */

export type DetailActions = ListActions & {
  /** `claude attach` in a terminal under the tab. */
  takeOver(child: ChildSession): void
  /** `claude stop` in a terminal under the tab. */
  stop(child: ChildSession): void
  /** The child's own worktree, where its files are. */
  worktreeOf(cwd: string): string
}

const TABS: { tab: DetailTab; label: string }[] = [
  { tab: 'conversation', label: 'Conversation' },
  { tab: 'diff', label: 'Diff' },
  { tab: 'checks', label: 'Checks' },
]

/** The child's status lines from its timeline, polled while the detail shows it. */
function useMarkers(id: string, live: boolean) {
  const [lines, setLines] = useState<TimelineLine[]>([])
  useEffect(() => {
    if (!live) return
    let alive = true
    const load = async () => {
      const t = await tauriMission.timeline(id, 0).catch(() => null)
      // The file only grows: an unchanged length keeps the array, so the markers keep theirs.
      if (alive && t) setLines((prev) => (prev.length === t.lines.length ? prev : t.lines))
    }
    void load()
    const timer = window.setInterval(load, 3000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [id, live])
  return useMemo(() => statusMarkers(lines), [lines])
}

export function Detail({ parent, row, shown, actions }: { parent: string; row: Row | null; shown: boolean; actions: DetailActions }) {
  const tab = useUi((s) => s.detail[parent] ?? 'conversation')
  const c = row?.child
  if (!row || !c)
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-center text-xs text-muted-foreground" data-detail-empty>
        <span className="max-w-64">Pick a child on the left to see its conversation, its diff against its base, and its checks.</span>
      </div>
    )
  return <ChildDetail key={c.id} parent={parent} row={row} tab={tab} shown={shown} actions={actions} />
}

function ChildDetail({ parent, row, tab, shown, actions }: { parent: string; row: Row; tab: DetailTab; shown: boolean; actions: DetailActions }) {
  const c = row.child!
  const [confirmStop, setConfirmStop] = useState(false)
  const { dot, word } = rowLook(row)
  const worktree = actions.worktreeOf(c.cwd)
  const conversation = tab === 'conversation'
  const markers = useMarkers(c.id, shown && conversation)

  // Seen once it is on screen, as the mission pane marks it. The length, not the child: every
  // poll deserialises a new object.
  const len = c.timeline_len
  useEffect(() => {
    if (shown && conversation) void missionStore.getState().markLooked(c.id, len)
  }, [c.id, len, shown, conversation])

  const stop = () => {
    if (!confirmStop) {
      setConfirmStop(true)
      window.setTimeout(() => setConfirmStop(false), 4000)
      return
    }
    actions.stop(c)
    setConfirmStop(false)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-detail={c.id}>
      {/* The buttons go under the name when both do not fit: the name is what says who this is. */}
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5 border-b border-border px-3 py-2">
        <div className="flex min-w-56 flex-1 items-start gap-3">
          <AgentStateDot state={dot} className="mt-1" />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-baseline gap-2">
              <span className="truncate text-sm font-medium text-foreground">{row.piece}</span>
              <span className={cn('shrink-0 text-[11px] text-muted-foreground', word === 'needs you' && 'font-medium text-agent-question')}>{word}</span>
              <span className="shrink-0 font-mono text-[11px] text-muted-foreground/70">{c.id}</span>
            </div>
            <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
              {c.branch && (
                <span className="inline-flex min-w-0 items-center gap-1">
                  <GitBranch className="size-3 shrink-0" aria-hidden />
                  <span className="truncate">{c.branch}</span>
                </span>
              )}
              {row.pr && <PrLine pr={row.pr} onOpen={actions.openUrl} />}
              <span>
                {c.model ?? 'default model'} · {c.effort ?? 'default'} effort
              </span>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button type="button" variant="outline" size="xs" title={`Open claude attach ${c.id}`} onClick={() => actions.takeOver(c)} data-take-over>
            <SquareTerminal aria-hidden />
            Take over
          </Button>
          <Button type="button" variant={confirmStop ? 'destructive' : 'ghost'} size="xs" title={confirmStop ? 'Click again to stop the child' : `claude stop ${c.id}`} onClick={stop} data-stop>
            <Square aria-hidden />
            {confirmStop ? 'Really stop?' : 'Stop'}
          </Button>
          <Button type="button" variant="ghost" size="xs" title={`Show its own workspace: ${worktree}`} onClick={() => actions.openWorkspace(c)} data-open-workspace>
            <FolderOpen aria-hidden />
            Open workspace
          </Button>
        </div>
      </div>
      <div className="flex items-center gap-0.5 border-b border-border px-2" role="tablist" aria-label="What to show of the child">
        {TABS.map((t) => (
          <button
            key={t.tab}
            type="button"
            role="tab"
            aria-selected={tab === t.tab}
            onClick={() => setDetail(parent, t.tab)}
            className={cn(
              '-mb-px border-b-2 px-2.5 py-1.5 text-[12px] transition-colors',
              tab === t.tab ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
            data-detail-tab={t.tab}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="dispatch-detail-body" role="tabpanel">
        {tab === 'conversation' && <ChildConversation child={c} markers={markers} onOpenTerminal={() => actions.takeOver(c)} />}
        {tab === 'diff' && <ChildDiff worktree={worktree} />}
        {tab === 'checks' && <ChildChecks worktree={worktree} />}
      </div>
    </div>
  )
}

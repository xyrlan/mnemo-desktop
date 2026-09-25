import { useEffect, useMemo, useState } from 'react'
import { Folder, GitBranch, Square, SquareTerminal } from 'lucide-react'
import { Button } from '@/ui'
import { cn } from '@/ui/cn'
import { registerPaneView, type PaneViewProps } from '../panes/registry'
import { register, registerProvider } from '../actions/registry'
import { missionStore, useMission } from './app-store'
import { tauriMission } from './client'
import { store as appStore } from '../layout/app-store'
import { allChildren, childWord, isRecent, needKind, type TimelineLine } from './types'
import { attachChild, MissionFooter, openMissionPane } from './rows'
import { AgentStateDot, type DotState } from '../dashboard/AgentStateDot'
import { estimateUsd, fmtUsd } from './cost'
import { statusMarkers } from './timeline'
import { ConversationView } from '../conversation/ConversationView'
import type { SessionStatus } from '../conversation/types'
import { settingsStore } from '../settings/app-store'
import { MemoryPanel } from './memory/MemoryPanel'
import { memoryClient } from './memory/client'
import type { ChildMemory } from './memory/types'

function MissionPane({ id: paneId, props }: PaneViewProps) {
  const id = String(props.id ?? '')
  const child = useMission((s) => allChildren(s.snapshot).find((c) => c.id === id))
  const [lines, setLines] = useState<TimelineLine[]>([])
  const [memory, setMemory] = useState<ChildMemory | null>(null)
  const [confirmStop, setConfirmStop] = useState(false)

  useEffect(() => {
    let alive = true
    const load = async () => {
      const t = await tauriMission.timeline(id, 0)
      // The file only grows: an unchanged length keeps the array, so the markers keep theirs.
      if (alive) setLines((prev) => (prev.length === t.lines.length ? prev : t.lines))
    }
    void load()
    const timer = window.setInterval(load, 3000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [id])

  const sessionId = child?.session_id ?? null
  useEffect(() => {
    if (!sessionId) {
      setMemory(null)
      return
    }
    let alive = true
    const load = async () => {
      const m = await memoryClient.childMemory(sessionId)
      if (alive) setMemory(m)
    }
    void load()
    const timer = window.setInterval(load, 5000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [sessionId])

  // Depend on the length, not the child: every poll deserialises a new object graph.
  const timelineLen = child?.timeline_len
  useEffect(() => {
    if (timelineLen !== undefined) void missionStore.getState().markLooked(id, timelineLen)
  }, [id, timelineLen])

  const markers = useMemo(() => statusMarkers(lines), [lines])

  const attach = () => attachChild(id, 'split-col')
  const stop = () => {
    if (!confirmStop) {
      setConfirmStop(true)
      window.setTimeout(() => setConfirmStop(false), 4000)
      return
    }
    appStore.getState().openView('terminal-cmd', { cmd: `claude stop ${id}` }, 'split-col', `stop ${id}`)
    setConfirmStop(false)
  }

  const word = child ? childWord(child) : 'stopped'
  // What the transcript cannot say: the snapshot knows whether the child is working or parked.
  const status: SessionStatus = { busy: word === 'active', waiting: word === 'BLOCKED' && child ? needKind(child) : null }
  const footer = child && <MissionFooter c={child} />
  const folder = child?.cwd.split('/').pop()
  return (
    <div className="ms-pane" data-pane={paneId}>
      <div className="ms-head flex items-start gap-3 border-b border-border px-3 py-2" data-ui>
        <AgentStateDot state={DOT[word]} className="mt-1" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="ms-title truncate text-sm font-medium text-foreground">{child?.name ?? child?.intent ?? id}</span>
            <span className={cn('ms-word shrink-0 text-[11px]', WORD_TONE[word])}>{WORD_LABEL[word]}</span>
            <span className="ms-id shrink-0 font-mono text-[11px] text-muted-foreground/70">{id}</span>
          </div>
          {child && (
            <div className="ms-meta mt-0.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
              {child.branch && (
                <span className="inline-flex min-w-0 items-center gap-1">
                  <GitBranch className="size-3 shrink-0" aria-hidden="true" />
                  <span className="truncate">{child.branch}</span>
                </span>
              )}
              <span className="ms-model">
                {child.model ?? 'default model'} · {child.effort ?? 'default'} effort
              </span>
              <span className="tabular-nums">
                {child.tokens.toLocaleString()} tok · ~{fmtUsd(estimateUsd(child.tokens, child.model))}
              </span>
              {folder && (
                <span className="inline-flex min-w-0 items-center gap-1" title={child.cwd}>
                  <Folder className="size-3 shrink-0" aria-hidden="true" />
                  <span className="truncate">{folder}</span>
                </span>
              )}
            </div>
          )}
        </div>
        <div className="ms-actions flex shrink-0 items-center gap-1.5">
          <Button type="button" variant="outline" size="xs" className="ms-take-over" title={`Open claude attach ${id} beside this pane`} onClick={attach}>
            <SquareTerminal aria-hidden="true" />
            Take over
          </Button>
          <Button
            type="button"
            variant={confirmStop ? 'destructive' : 'ghost'}
            size="xs"
            className="ms-stop"
            title={confirmStop ? 'Click again to stop the child' : `claude stop ${id}`}
            onClick={stop}
          >
            <Square aria-hidden="true" />
            {confirmStop ? 'Really stop?' : 'Stop'}
          </Button>
        </div>
      </div>
      <MemoryPanel memory={memory} hasSession={!!sessionId} />
      <div className="ms-conversation">
        <ConversationView sessionId={sessionId} cwd={child?.cwd ?? ''} status={status} markers={markers} footer={footer} onOpenTerminal={attach} />
      </div>
    </div>
  )
}

type Word = ReturnType<typeof childWord>

/** The fleet's glyph for each word: the same dot a card shows on the dashboard. */
const DOT: Record<Word, DotState> = { active: 'working', BLOCKED: 'needs-you', stalled: 'idle', done: 'done', stopped: 'idle' }
const WORD_LABEL: Record<Word, string> = { active: 'working', BLOCKED: 'needs you', stalled: 'stalled', done: 'done', stopped: 'stopped' }
/** Colour only for state: asking is the question orange, stalled a warning, done green. */
const WORD_TONE: Record<Word, string> = {
  active: 'text-muted-foreground',
  BLOCKED: 'font-medium text-agent-question',
  stalled: 'text-status-warning',
  done: 'text-state-done',
  stopped: 'text-muted-foreground/70',
}

registerPaneView('mission', MissionPane)

void settingsStore.getState().load()
registerProvider(() => {
  const s = settingsStore.getState()
  return [
    {
      id: 'settings.outgoing',
      title: `Outgoing text: ${s.outgoing === 'en' ? 'rewrite in English' : 'send as typed'} (toggle)`,
      run: () => settingsStore.getState().set('outgoing', s.outgoing === 'en' ? 'as-typed' : 'en'),
    },
    {
      id: 'settings.reply-language',
      title: `Children answer in: ${s.replyLanguage} (cycle)`,
      run: () => settingsStore.getState().set('replyLanguage', s.replyLanguage === 'unchanged' ? 'pt' : s.replyLanguage === 'pt' ? 'en' : 'unchanged'),
    },
  ]
})
register({
  id: 'mission.reply-blocked',
  title: 'Reply to the first blocked child',
  run: () => {
    const c = allChildren(missionStore.getState().snapshot).find((x) => childWord(x) === 'BLOCKED')
    if (!c) return
    openMissionPane(c)
    // The pane mounts on the next frame; its composer takes the focus.
    requestAnimationFrame(() => document.querySelector<HTMLElement>('.ms-composer textarea, .ms-composer [contenteditable="true"]')?.focus())
  },
})

registerProvider(() =>
  allChildren(missionStore.getState().snapshot)
    .filter((c) => isRecent(c))
    .map((c) => ({
      id: `mission.open.${c.id}`,
      title: `Open mission: ${c.name ?? c.intent ?? c.id} (${childWord(c)})`,
      run: () => openMissionPane(c),
    })),
)

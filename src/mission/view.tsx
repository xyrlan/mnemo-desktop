import { useEffect, useMemo, useState } from 'react'
import { registerPaneView, type PaneViewProps } from '../panes/registry'
import { register, registerProvider } from '../actions/registry'
import { missionStore, useMission } from './app-store'
import { tauriMission } from './client'
import { store as appStore } from '../layout/app-store'
import { allChildren, childWord, isRecent, needKind, type TimelineLine } from './types'
import { attachChild, openMissionPane, ReplyBox } from './rows'
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

  const word = child ? childWord(child) : 'stopped'
  // What the transcript cannot say: the snapshot knows whether the child is working or parked.
  const status: SessionStatus = { busy: word === 'active', waiting: word === 'BLOCKED' && child ? needKind(child) : null }
  return (
    <div className="mission-pane" data-pane={paneId}>
      <div className="mission-head">
        <div className="mission-title">
          <span className="m-word">{word}</span> {child?.name ?? child?.intent ?? id} <span className="m-id">{id}</span>
        </div>
        <div className="mission-meta">
          {child?.branch && <span>{child.branch}</span>}
          {child && <span className="m-model">{child.model ?? 'default model'} · {child.effort ?? 'default'} effort</span>}
          {child && <span>{child.tokens.toLocaleString()} tok · ~{fmtUsd(estimateUsd(child.tokens, child.model))}</span>}
          {child?.cwd && <span title={child.cwd}>{child.cwd.split('/').pop()}</span>}
        </div>
        <div className="mission-actions">
          <button onClick={attach}>take over</button>
          <button
            onClick={() => {
              if (!confirmStop) {
                setConfirmStop(true)
                window.setTimeout(() => setConfirmStop(false), 4000)
                return
              }
              appStore.getState().openView('terminal-cmd', { cmd: `claude stop ${id}` }, 'split-col', `stop ${id}`)
              setConfirmStop(false)
            }}
          >
            {confirmStop ? 'really stop?' : 'stop'}
          </button>
        </div>
      </div>
      <MemoryPanel memory={memory} hasSession={!!sessionId} />
      <div className="mission-conversation">
        <ConversationView
          sessionId={sessionId}
          cwd={child?.cwd ?? ''}
          status={status}
          markers={markers}
          footer={child && <ReplyBox c={child} rows={3} className="mission-reply" />}
          onOpenTerminal={attach}
        />
      </div>
    </div>
  )
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
register({ id: 'mission.toggle-sidebar', title: 'Toggle mission sidebar', shortcut: '⌘B', run: () => missionStore.getState().toggleSidebar() })
register({
  id: 'mission.reply-blocked',
  title: 'Reply to the first blocked child',
  run: () => {
    const c = allChildren(missionStore.getState().snapshot).find((x) => childWord(x) === 'BLOCKED')
    if (c) document.querySelector<HTMLTextAreaElement>('.m-reply textarea')?.focus()
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

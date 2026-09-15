import { useEffect, useRef, useState } from 'react'
import { registerPaneView, type PaneViewProps } from '../panes/registry'
import { register, registerProvider } from '../actions/registry'
import { missionStore, useMission } from './app-store'
import { tauriMission } from './client'
import { store as appStore } from '../layout/app-store'
import { allChildren, childWord, isRecent, type TimelineLine } from './types'
import { attachChild, openMissionPane, ReplyBox } from './rows'
import { estimateUsd, fmtUsd } from './cost'
import { settingsStore } from '../settings/app-store'

function MissionPane({ id: paneId, props }: PaneViewProps) {
  const id = String(props.id ?? '')
  const child = useMission((s) => allChildren(s.snapshot).find((c) => c.id === id))
  const looked = useMission((s) => s.looked[id])
  // Default outside the selector: a fresh `[]` per read is never Object.is-equal, and
  // useSyncExternalStore then re-renders until React throws and unmounts the app.
  const sentList = useMission((s) => s.sent[id]) ?? []
  const [lines, setLines] = useState<TimelineLine[]>([])
  const [confirmStop, setConfirmStop] = useState(false)
  const seenAtOpen = useRef<number | undefined>(looked)
  const bottom = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    const load = async () => {
      const t = await tauriMission.timeline(id, 0)
      if (alive) setLines(t.lines)
    }
    void load()
    const timer = window.setInterval(load, 3000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [id])

  // Depend on the length, not the child: every poll deserialises a new object graph.
  const timelineLen = child?.timeline_len
  useEffect(() => {
    if (timelineLen !== undefined) void missionStore.getState().markLooked(id, timelineLen)
  }, [id, timelineLen])

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [lines.length])

  const attach = () => attachChild(id, 'split-col')

  const word = child ? childWord(child) : 'stopped'
  const final = [...lines].reverse().find((l) => l.text)
  return (
    <div className="mission-pane" data-pane={paneId}>
      <div className="mission-head">
        <div className="mission-title">
          <span className="m-word">{word}</span> {child?.name ?? child?.intent ?? id} <span className="m-id">{id}</span>
        </div>
        <div className="mission-meta">
          {child?.branch && <span>{child.branch}</span>}
          {child && <span>{child.tokens.toLocaleString()} tok · ~{fmtUsd(estimateUsd(child.tokens, null))}</span>}
          {child?.cwd && <span title={child.cwd}>{child.cwd.split('/').pop()}</span>}
        </div>
        <div className="mission-actions">
          <button onClick={attach}>attach</button>
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
      <div className="mission-timeline">
        {lines.map((l, i) => {
          const fresh = seenAtOpen.current !== undefined && i >= seenAtOpen.current
          const t = l.at ? new Date(l.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''
          return (
            <div key={i} className={`tl-line${fresh ? ' fresh' : ''}`}>
              <span className="tl-at">{t}</span>
              <span className="tl-state">{l.state}</span>
              <span className="tl-detail">{l.detail}</span>
            </div>
          )
        })}
        {sentList.map((m, i) => (
          <div key={`you-${i}`} className="tl-line fresh tl-you">
            <span className="tl-at">{new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
            <span className="tl-state">you</span>
            <span className="tl-detail" title={m.original !== m.text ? `typed: ${m.original}` : undefined}>{m.text}</span>
          </div>
        ))}
        {final && (
          <div className="tl-final">
            <div className="tl-final-head">report</div>
            <pre>{final.text}</pre>
          </div>
        )}
        <div ref={bottom} />
      </div>
      {child && <ReplyBox c={child} rows={3} className="mission-reply" />}
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

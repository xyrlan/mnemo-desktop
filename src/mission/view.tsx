import { useEffect, useRef, useState } from 'react'
import { registerPaneView, type PaneViewProps } from '../panes/registry'
import { register, registerProvider } from '../actions/registry'
import { missionStore, useMission } from './app-store'
import { tauriMission } from './client'
import { store as appStore } from '../layout/app-store'
import { allChildren, childWord, isRecent, type ChildSession, type TimelineLine } from './types'
import { openMissionPane } from './Sidebar'
import { estimateUsd, fmtUsd } from './cost'

function findChild(id: string): ChildSession | undefined {
  return allChildren(missionStore.getState().snapshot).find((c) => c.id === id)
}

function MissionPane({ id: paneId, props }: PaneViewProps) {
  const id = String(props.id ?? '')
  const child = useMission((s) => allChildren(s.snapshot).find((c) => c.id === id))
  const looked = useMission((s) => s.looked[id])
  const draft = useMission((s) => s.drafts[id] ?? '')
  const err = useMission((s) => s.replyErrors[id])
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

  useEffect(() => {
    if (child) void missionStore.getState().markLooked(id, child.timeline_len)
  }, [id, child?.timeline_len, child])

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [lines.length])

  const attach = () => {
    const c = findChild(id)
    appStore.getState().openView('terminal-cmd', { cmd: `claude attach ${id}` }, 'split-col', `attach ${id}`)
    void c
  }

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
        {final && (
          <div className="tl-final">
            <div className="tl-final-head">report</div>
            <pre>{final.text}</pre>
          </div>
        )}
        <div ref={bottom} />
      </div>
      {child && word === 'BLOCKED' && (
        <div className="m-reply mission-reply">
          <div className="m-needs">{child.needs}</div>
          <textarea
            value={draft}
            rows={3}
            placeholder="reply…"
            onChange={(e) => missionStore.getState().setDraft(id, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void missionStore.getState().sendReply(id)
            }}
          />
          <div className="m-reply-actions">
            <button onClick={() => void missionStore.getState().sendReply(id)}>send ⌘↩</button>
            {err && <span className="m-error">{err}</span>}
          </div>
        </div>
      )}
    </div>
  )
}

registerPaneView('mission', MissionPane)

register({ id: 'mission.toggle-sidebar', title: 'Toggle mission sidebar', shortcut: '⌘B', run: () => missionStore.getState().toggleSidebar() })
register({
  id: 'mission.reply-blocked',
  title: 'Reply to the first blocked child',
  run: () => {
    const c = allChildren(missionStore.getState().snapshot).find((x) => childWord(x) === 'BLOCKED')
    if (c) document.querySelector<HTMLTextAreaElement>('.m-blocked textarea')?.focus()
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

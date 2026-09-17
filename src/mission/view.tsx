import { useEffect, useMemo, useRef, useState } from 'react'
import { registerPaneView, type PaneViewProps } from '../panes/registry'
import { register, registerProvider } from '../actions/registry'
import { missionStore, useMission } from './app-store'
import { tauriMission } from './client'
import { store as appStore } from '../layout/app-store'
import { allChildren, childWord, isRecent, type TimelineLine } from './types'
import { attachChild, openMissionPane, ReplyBox } from './rows'
import { estimateUsd, fmtUsd } from './cost'
import { clock, timelineRows } from './timeline'
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
  }, [lines.length, sentList.length])

  const [open, setOpen] = useState<ReadonlySet<number>>(new Set())
  const toggle = (first: number) =>
    setOpen((o) => {
      const n = new Set(o)
      if (!n.delete(first)) n.add(first)
      return n
    })
  const rows = useMemo(() => timelineRows(lines, sentList, seenAtOpen.current), [lines, sentList])

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
      <div className="mission-timeline">
        {rows.map((r) =>
          r.kind === 'you' ? (
            <div key={`you-${r.at}-${r.sent.text}`} className="tl-line fresh tl-you">
              <span className="tl-at">{clock(r.at)}</span>
              <span className="tl-state">you</span>
              <span className="tl-detail" title={r.sent.original !== r.sent.text ? `typed: ${r.sent.original}` : undefined}>{r.sent.text}</span>
            </div>
          ) : r.lines.length === 1 ? (
            <div key={r.lines[0].index} className={`tl-line${r.fresh ? ' fresh' : ''}`}>
              <span className="tl-at">{clock(r.first)}</span>
              <span className="tl-state">{r.state}</span>
              <span className="tl-detail">{r.detail}</span>
            </div>
          ) : (
            <div key={r.lines[0].index} className="tl-run">
              <button
                className={`tl-line tl-run-head${r.fresh ? ' fresh' : ''}`}
                aria-expanded={open.has(r.lines[0].index)}
                onClick={() => toggle(r.lines[0].index)}
              >
                <span className="tl-at">{clock(r.last)}</span>
                <span className="tl-state">{r.state}</span>
                <span className="tl-detail">{r.detail}</span>
                <span className="tl-count">
                  {r.lines.length}× · {clock(r.first, false)}–{clock(r.last, false)}
                </span>
              </button>
              {open.has(r.lines[0].index) &&
                r.lines.map((l) => (
                  <div key={l.index} className="tl-line tl-run-line">
                    <span className="tl-at">{clock(l.ms)}</span>
                    <span className="tl-state">{l.state}</span>
                    <span className="tl-detail">{l.detail}</span>
                  </div>
                ))}
            </div>
          ),
        )}
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

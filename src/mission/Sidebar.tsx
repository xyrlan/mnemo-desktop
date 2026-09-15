import { useEffect, useRef } from 'react'
import { missionStore, useMission } from './app-store'
import { store as appStore, useApp } from '../layout/app-store'
import { childWord, delta, missionSummary, pruneSnapshot, type ChildSession, type Mission, type RepoGroup } from './types'

function focusedCwd(): string | undefined {
  const s = appStore.getState()
  const tab = s.tabs.find((t) => t.id === s.activeTab)
  if (!tab) return undefined
  const pane = s.panes[tab.focused]
  return pane?.view === 'terminal' ? pane.cwd : undefined
}

export function openMissionPane(child: ChildSession) {
  const s = appStore.getState()
  const existing = Object.values(s.panes).find((p) => p.view === 'mission' && p.props?.id === child.id)
  if (existing) {
    const tab = s.tabs.find((t) => t.root && JSON.stringify(t.root).includes(`"pane":${existing.id}`))
    if (tab) {
      appStore.setState({ activeTab: tab.id })
      s.focusPane(existing.id)
    }
  } else {
    s.openView('mission', { id: child.id }, 'auto', child.name ?? child.id)
  }
  void missionStore.getState().markLooked(child.id, child.timeline_len)
}

function ChildRow({ c, label }: { c: ChildSession; label?: string }) {
  const looked = useMission((s) => s.looked)
  const draft = useMission((s) => s.drafts[c.id] ?? '')
  const err = useMission((s) => s.replyErrors[c.id])
  const sending = useMission((s) => s.sending[c.id])
  const word = childWord(c)
  const d = delta(c, looked)
  const blocked = word === 'BLOCKED'
  useEffect(() => {
    if (blocked && draft === '' && c.suggested_reply) missionStore.getState().setDraft(c.id, c.suggested_reply)
  }, [blocked, c.id, c.suggested_reply, draft])
  return (
    <div className={`m-child m-${word.toLowerCase()}`}>
      <div className="m-row" onClick={() => openMissionPane(c)} title={c.cwd}>
        <span className="m-label">{label ?? c.name ?? c.intent ?? c.id}</span>
        <span className="m-id">{c.id}</span>
        <span className="m-word">{word}</span>
        <span className="m-detail">{c.detail}</span>
        {d > 0 && <span className="m-delta">+{d}</span>}
      </div>
      {blocked && (
        <div className="m-reply">
          <div className="m-needs">{c.needs}</div>
          <textarea
            value={draft}
            rows={2}
            placeholder="reply…"
            onChange={(e) => missionStore.getState().setDraft(c.id, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void missionStore.getState().sendReply(c.id)
            }}
          />
          <div className="m-reply-actions">
            <button disabled={sending || !draft.trim()} onClick={() => void missionStore.getState().sendReply(c.id)}>
              {sending ? 'sending…' : 'send ⌘↩'}
            </button>
            {err && <span className="m-error">{err}</span>}
          </div>
        </div>
      )}
    </div>
  )
}

function MissionRow({ m }: { m: Mission }) {
  const sum = missionSummary(m)
  return (
    <div className="m-mission">
      <div className="m-row m-mission-head">
        <span className="m-label">mission {m.feature}</span>
        <span className="m-detail">
          {sum.withPr}/{sum.total} PR · CI <span className={`m-ci m-ci-${sum.ci}`}>{sum.ci === 'pass' ? '✓' : sum.ci === 'fail' ? '✗' : sum.ci === 'pending' ? '…' : '–'}</span> · land: {m.landable ? 'ready' : 'not yet'}
        </span>
      </div>
      {m.pieces.map((p) =>
        p.child ? (
          <ChildRow key={p.name} c={p.child} label={p.name} />
        ) : (
          <div key={p.name} className="m-child m-idle">
            <div className="m-row">
              <span className="m-label">{p.name}</span>
              <span className="m-detail">{p.pr ? `PR #${p.pr.number} ${p.pr.state.toLowerCase()}` : 'no child, no PR'}</span>
            </div>
          </div>
        ),
      )}
    </div>
  )
}

function RepoBlock({ r, focused }: { r: RepoGroup; focused: boolean }) {
  const live = r.children.filter((c) => c.live).length + r.missions.flatMap((m) => m.pieces).filter((p) => p.child?.live).length
  return (
    <div className={`m-repo${focused ? ' focused' : ''}`}>
      <div className="m-row m-repo-head" title={r.root}>
        <span className="m-label">{r.name}</span>
        <span className="m-detail">
          {live} live · {r.parents.length} parent{r.parents.length === 1 ? '' : 's'}
        </span>
      </div>
      {r.parents.map((p) => (
        <div key={p.session_id} className={`m-parent m-${p.status}`}>
          <div className="m-row">
            <span className="m-label">parent</span>
            <span className="m-id">{p.session_id.slice(0, 8)}</span>
            <span className="m-word">{p.status}</span>
            <span className="m-detail">{p.name ?? ''}</span>
          </div>
        </div>
      ))}
      {r.missions.map((m) => (
        <MissionRow key={m.contract_path} m={m} />
      ))}
      {r.children.length > 0 && (
        <div className="m-mission">
          <div className="m-row m-mission-head">
            <span className="m-label">children</span>
          </div>
          {r.children.map((c) => (
            <ChildRow key={c.id} c={c} />
          ))}
        </div>
      )}
    </div>
  )
}

export default function Sidebar() {
  const open = useMission((s) => s.sidebarOpen)
  const width = useMission((s) => s.sidebarWidth)
  const raw = useMission((s) => s.snapshot)
  const err = useMission((s) => s.lastError)
  const snap = pruneSnapshot(raw)
  const activeTab = useApp((s) => s.activeTab)
  const panes = useApp((s) => s.panes)
  const tabs = useApp((s) => s.tabs)
  const ref = useRef<HTMLDivElement>(null)

  // Poll: 3 s focused, 15 s when the window is hidden. PRs every 10th tick.
  useEffect(() => {
    let tick = 0
    let timer: number | undefined
    const loop = async () => {
      const withPrs = tick % 10 === 0
      tick++
      await missionStore.getState().refresh(focusedCwd(), withPrs)
      timer = window.setTimeout(loop, document.hidden ? 15000 : 3000)
    }
    void missionStore.getState().loadLooked()
    void loop()
    return () => window.clearTimeout(timer)
  }, [])

  if (!open) return null
  const tab = tabs.find((t) => t.id === activeTab)
  const cwd = tab ? panes[tab.focused]?.cwd : undefined
  const focusedRoot = snap.repos.find((r) => cwd && (cwd === r.root || cwd.startsWith(r.root + '/')))?.root

  const onDown = (e: React.MouseEvent) => {
    e.preventDefault()
    const move = (ev: MouseEvent) => missionStore.getState().setSidebarWidth(window.innerWidth - ev.clientX)
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  return (
    <div className="sidebar" style={{ width }} ref={ref}>
      <div className="sidebar-grip" onMouseDown={onDown} />
      <div className="sidebar-body">
        {err && <div className="m-error">{err}</div>}
        {snap.errors.map((e, i) => (
          <div key={i} className="m-error">{e}</div>
        ))}
        {snap.repos.length === 0 && !err && <div className="m-empty">no live sessions</div>}
        {snap.repos.map((r) => (
          <RepoBlock key={r.root} r={r} focused={r.root === focusedRoot} />
        ))}
      </div>
    </div>
  )
}

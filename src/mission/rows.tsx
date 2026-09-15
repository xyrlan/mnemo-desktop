import { useEffect } from 'react'
import { missionStore, useMission } from './app-store'
import { store as appStore } from '../layout/app-store'
import { childWord, delta, missionSummary, type ChildSession, type Mission, type ParentSession, type RepoGroup } from './types'
import { childrenOf, fmtTokens, parentTokenLine, parentTokens } from './tokens'
import './mission.css'

/** The rows both the sidebar and the cockpit pane render. `full` drops the one-line
 *  truncation, for a surface with room. */

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

export function ChildRow({ c, label, full = false }: { c: ChildSession; label?: string; full?: boolean }) {
  const looked = useMission((s) => s.looked)
  const draft = useMission((s) => s.drafts[c.id] ?? '')
  const err = useMission((s) => s.replyErrors[c.id])
  const sending = useMission((s) => s.sending[c.id])
  const lastSent = useMission((s) => s.sent[c.id]?.at(-1))
  const word0 = childWord(c)
  const d = delta(c, looked)
  const blocked = word0 === 'BLOCKED'
  const replied = blocked && lastSent !== undefined && Date.now() - lastSent.at < 60_000
  const word = replied ? 'replied' : word0
  useEffect(() => {
    if (blocked && draft === '' && c.suggested_reply) missionStore.getState().setDraft(c.id, c.suggested_reply)
  }, [blocked, c.id, c.suggested_reply, draft])
  return (
    <div className={`m-child m-${word0.toLowerCase()}${replied ? ' m-replied' : ''}`}>
      <div className="m-row" onClick={() => openMissionPane(c)} title={c.cwd}>
        <span className="m-label">{label ?? c.name ?? c.intent ?? c.id}</span>
        <span className="m-id">{c.id}</span>
        <span className="m-word">{word}</span>
        {full && c.tokens > 0 && <span className="m-tokens">{fmtTokens(c.tokens)}</span>}
        <span className="m-detail">{c.detail}</span>
        {d > 0 && <span className="m-delta">+{d}</span>}
      </div>
      {full && c.branch && <div className="m-sub">{c.branch}</div>}
      {blocked && (
        <div className="m-reply">
          <div className="m-needs">{c.needs}</div>
          <textarea
            value={draft}
            rows={full ? 3 : 2}
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
          {lastSent && (
            <div className="m-sent">
              sent ✓ {new Date(lastSent.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · waiting for the child to pick it up… <span className="m-sent-text" title={lastSent.original !== lastSent.text ? `typed: ${lastSent.original}` : undefined}>{lastSent.text}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function MissionRow({ m, full = false }: { m: Mission; full?: boolean }) {
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
          <ChildRow key={p.name} c={p.child} label={p.name} full={full} />
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

export function ParentRow({ p, repo, full = false }: { p: ParentSession; repo: RepoGroup; full?: boolean }) {
  const line = parentTokenLine(p)
  const { cacheRead } = parentTokens(p)
  const linked = full ? childrenOf(repo, p.session_id).length : 0
  return (
    <div className={`m-parent m-${p.status}`}>
      <div className="m-row" title={p.cwd}>
        <span className="m-label">parent</span>
        <span className="m-id">{p.session_id.slice(0, 8)}</span>
        <span className="m-word">{p.status}</span>
        {line && (
          <span className="m-tokens" title={cacheRead ? `cache read ${fmtTokens(cacheRead)}` : undefined}>
            {line}
          </span>
        )}
        <span className="m-detail">{p.name ?? ''}</span>
      </div>
      {full && linked > 0 && (
        <div className="m-sub">
          dispatched {linked} {linked === 1 ? 'child' : 'children'}
        </div>
      )}
    </div>
  )
}

export function RepoBlock({ r, focused, full = false }: { r: RepoGroup; focused: boolean; full?: boolean }) {
  const live = r.children.filter((c) => c.live).length + r.missions.flatMap((m) => m.pieces).filter((p) => p.child?.live).length
  return (
    <div className={`m-repo${focused ? ' focused' : ''}${full ? ' m-full' : ''}`}>
      <div className="m-row m-repo-head" title={r.root}>
        <span className="m-label">{r.name}</span>
        <span className="m-detail">
          {live} live · {r.parents.length} parent{r.parents.length === 1 ? '' : 's'}
        </span>
      </div>
      {r.parents.map((p) => (
        <ParentRow key={p.session_id} p={p} repo={r} full={full} />
      ))}
      {r.missions.map((m) => (
        <MissionRow key={m.contract_path} m={m} full={full} />
      ))}
      {r.children.length > 0 && (
        <div className="m-mission">
          <div className="m-row m-mission-head">
            <span className="m-label">children</span>
          </div>
          {r.children.map((c) => (
            <ChildRow key={c.id} c={c} full={full} />
          ))}
        </div>
      )}
    </div>
  )
}

import { useEffect } from 'react'
import { missionStore, useMission } from './app-store'
import { store as appStore } from '../layout/app-store'
import { childWord, type ChildSession, type Mission, type Pr } from './types'
import './mission.css'

/** What the sidebar's needs-you list, the cockpit canvas and the mission pane do with a
 *  child, a PR or a contract, and the reply box they share. */

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

export function attachChild(id: string, place: 'tab' | 'split-col' = 'tab') {
  appStore.getState().openView('terminal-cmd', { cmd: `claude attach ${id}` }, place, `attach ${id}`)
}

export function openPr(pr: Pr) {
  appStore.getState().openView('browser', { url: pr.url }, 'auto', `PR #${pr.number}`)
}

export function openContract(m: Mission) {
  appStore.getState().openView('editor', { path: m.contract_path }, 'auto', m.contract_path.split('/').pop())
}

/** The blocked child's question, a reply field prefilled with its suggested reply, and what
 *  was last sent. Renders nothing unless the child is BLOCKED. */
export function ReplyBox({ c, rows = 2, className = '' }: { c: ChildSession; rows?: number; className?: string }) {
  const draft = useMission((s) => s.drafts[c.id] ?? '')
  const err = useMission((s) => s.replyErrors[c.id])
  const sending = useMission((s) => s.sending[c.id])
  const lastSent = useMission((s) => s.sent[c.id]?.at(-1))
  const blocked = childWord(c) === 'BLOCKED'
  useEffect(() => {
    if (blocked && draft === '' && c.suggested_reply) missionStore.getState().setDraft(c.id, c.suggested_reply)
  }, [blocked, c.id, c.suggested_reply, draft])
  if (!blocked) return null
  return (
    <div className={`m-reply${className ? ` ${className}` : ''}`}>
      <div className="m-needs">{c.needs}</div>
      <textarea
        value={draft}
        rows={rows}
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
  )
}

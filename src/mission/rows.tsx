import { useEffect } from 'react'
import { missionStore, useMission } from './app-store'
import { store as appStore } from '../layout/app-store'
import { childWord, needKind, permissionAsk, type ChildSession, type Mission, type Pr } from './types'
import { answerPrompt, useAnswer, type Choice } from '../cockpit/approve'
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

/** `Bash: cd … && …` as the tool and what it runs; a bare ask is all command. */
export function splitAsk(ask: string): { tool: string | null; command: string } {
  const m = /^([A-Za-z][\w.:-]*):\s+([\s\S]*)$/.exec(ask)
  return m ? { tool: m[1], command: m[2] } : { tool: null, command: ask }
}

const ANSWERED: Record<Choice, string> = { yes: 'approved', always: 'approved, not asking again', no: 'denied' }

/** A permission prompt: what the child wants to run, in full, and Approve / Deny (`y` / `n`
 *  while the block has focus), answered through `claude attach`. No reply field: a reply
 *  does not answer a prompt. */
export function PermissionBox({ c, className = '' }: { c: ChildSession; className?: string }) {
  const answer = useAnswer(c.id)
  const ask = permissionAsk(c)
  const { tool, command } = splitAsk(ask ?? '')
  const busy = answer?.phase === 'attaching'
  const run = (choice: Choice) => void answerPrompt(c, choice)
  return (
    <div
      className={`m-reply m-permission${className ? ` ${className}` : ''}`}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.metaKey || e.ctrlKey || e.altKey || busy) return
        const k = e.key.toLowerCase()
        if (k !== 'y' && k !== 'n') return
        e.preventDefault()
        e.stopPropagation()
        run(k === 'y' ? (e.shiftKey ? 'always' : 'yes') : 'no')
      }}
    >
      <div className="m-perm-head">
        permission{tool ? <> · <span className="m-perm-tool">{tool}</span></> : null}
      </div>
      {ask ? <pre className="m-perm-cmd">{command}</pre> : <div className="m-needs">{c.waiting_for ?? 'permission prompt'}</div>}
      <div className="m-reply-actions">
        <button className="m-approve" disabled={busy} title="Approve once (y)" onClick={() => run('yes')}>
          Approve
        </button>
        <button disabled={busy} title="Approve and don't ask again, when the prompt offers it (⇧Y)" onClick={() => run('always')}>
          Approve and don't ask again
        </button>
        <button className="m-deny" disabled={busy} title="Deny (n)" onClick={() => run('no')}>
          Deny
        </button>
      </div>
      {answer?.phase === 'attaching' && <div className="m-sent">opening claude attach {c.id}…</div>}
      {answer?.phase === 'sent' && Date.now() - answer.at < 120_000 && <div className="m-sent">{ANSWERED[answer.choice]} ✓ · follow it in the attach pane</div>}
      {answer?.phase === 'error' && <div className="m-error">{answer.error}</div>}
    </div>
  )
}

/** The blocked child's question, a reply field prefilled with its suggested reply, and what
 *  was last sent; a permission prompt gets `PermissionBox` instead. Renders nothing unless the
 *  child is BLOCKED. `attach` adds a link to the child's session, for surfaces that have none. */
export function ReplyBox({ c, rows = 2, className = '', attach = false }: { c: ChildSession; rows?: number; className?: string; attach?: boolean }) {
  const blocked = childWord(c) === 'BLOCKED'
  if (!blocked) return null
  if (needKind(c) === 'permission') return <PermissionBox c={c} className={className} />
  return <QuestionBox c={c} rows={rows} className={className} attach={attach} />
}

function QuestionBox({ c, rows, className, attach }: { c: ChildSession; rows: number; className: string; attach: boolean }) {
  const draft = useMission((s) => s.drafts[c.id] ?? '')
  const err = useMission((s) => s.replyErrors[c.id])
  const sending = useMission((s) => s.sending[c.id])
  const typing = useMission((s) => s.typing[c.id])
  const lastSent = useMission((s) => s.sent[c.id]?.at(-1))
  useEffect(() => {
    if (draft === '' && c.suggested_reply) missionStore.getState().setDraft(c.id, c.suggested_reply)
  }, [c.id, c.suggested_reply, draft])
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
        <button disabled={sending || typing || !draft.trim()} onClick={() => void missionStore.getState().sendReply(c.id)}>
          {sending ? 'sending…' : 'send ⌘↩'}
        </button>
        <button
          className="m-as-me"
          disabled={sending || typing || !draft.trim()}
          title={`Types the draft, as written, into claude attach ${c.id}: the child reads it as you typed it in its terminal, so it can approve a push or a PR`}
          onClick={() => void missionStore.getState().replyAsMe(c.id, c.suggested_reply)}
        >
          {typing ? 'typing…' : 'reply as me'}
        </button>
        {attach && (
          <button className="m-attach-link" title={`claude attach ${c.id}`} onClick={() => attachChild(c.id)}>
            Take over
          </button>
        )}
        {err && <span className="m-error">{err}</span>}
      </div>
      {/* Claude Code delivers socket writes as another session's message, which it tells
          the child is never user approval (#84); only the child's own terminal is the user (#86). */}
      <div className="m-reply-note">send arrives as a message from another session and cannot approve anything; reply as me types it into the child's terminal, as you</div>
      {lastSent && (
        <div className="m-sent">
          {lastSent.asMe ? 'typed as you' : 'sent'} ✓ {new Date(lastSent.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {lastSent.asMe ? 'in its terminal' : 'waiting for the child to pick it up…'} <span className="m-sent-text" title={lastSent.original !== lastSent.text ? `typed: ${lastSent.original}` : undefined}>{lastSent.text}</span>
        </div>
      )}
    </div>
  )
}

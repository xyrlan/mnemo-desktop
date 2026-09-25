import { useEffect, useState } from 'react'
import { MessageCircleQuestion } from 'lucide-react'
import { Button } from '@/ui'
import { cn } from '@/ui/cn'
import { missionStore, useMission } from './app-store'
import { store as appStore } from '../layout/app-store'
import { childWord, needKind, permissionAsk, type ChildSession } from './types'
import { answerPrompt, useAnswer, type Choice } from '../cockpit/approve'
import type { ChatParts } from './chat'
import './mission.css'

/** What the mission pane does with a child, and what sits under its conversation: the chat's
 *  composer and approval card (`MissionFooter`), or, until the chat-input piece lands, the
 *  reply box (`ReplyBox`). */

export function openMissionPane(child: ChildSession) {
  const s = appStore.getState()
  const existing = Object.values(s.panes).find((p) => p.view === 'mission' && p.props?.id === child.id)
  if (existing) {
    s.goToPane(existing.id)
  } else {
    s.openView('mission', { id: child.id }, 'auto', child.name ?? child.id)
  }
  void missionStore.getState().markLooked(child.id, child.timeline_len)
}

export function attachChild(id: string, place: 'tab' | 'split-col' = 'tab') {
  appStore.getState().openView('terminal-cmd', { cmd: `claude attach ${id}` }, place, `attach ${id}`)
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
 *  child is BLOCKED. */
export function ReplyBox({ c, rows = 2, className = '' }: { c: ChildSession; rows?: number; className?: string }) {
  const blocked = childWord(c) === 'BLOCKED'
  if (!blocked) return null
  if (needKind(c) === 'permission') return <PermissionBox c={c} className={className} />
  return <QuestionBox c={c} rows={rows} className={className} />
}

function QuestionBox({ c, rows, className }: { c: ChildSession; rows: number; className: string }) {
  const draft = useMission((s) => s.drafts[c.id] ?? '')
  const lastSent = useMission((s) => s.sent[c.id]?.at(-1))
  useEffect(() => {
    if (draft === '' && c.suggested_reply) missionStore.getState().setDraft(c.id, c.suggested_reply)
  }, [c.id, c.suggested_reply, draft])
  return (
    <div className={`m-reply${className ? ` ${className}` : ''}`}>
      <div className="m-needs">{c.needs}</div>
      <ReplyField c={c} rows={rows} />
      {lastSent && (
        <div className="m-sent">
          {lastSent.asMe ? 'typed as you' : 'sent'} ✓ {sentAt(lastSent.at)} · {lastSent.asMe ? 'in its terminal' : 'waiting for the child to pick it up…'} <span className="m-sent-text" title={lastSent.original !== lastSent.text ? `typed: ${lastSent.original}` : undefined}>{lastSent.text}</span>
        </div>
      )}
    </div>
  )
}

export const sentAt = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/** The draft field, send / reply as me, and what each of them is: what the blocked child's
 *  question box types into. One draft per child. It never prefills: a suggested reply is the
 *  question box's, for a child that asked. */
function ReplyField({ c, rows }: { c: ChildSession; rows: number }) {
  const draft = useMission((s) => s.drafts[c.id] ?? '')
  const err = useMission((s) => s.replyErrors[c.id])
  const sending = useMission((s) => s.sending[c.id])
  const typing = useMission((s) => s.typing[c.id])
  return (
    <>
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
        {err && <span className="m-error">{err}</span>}
      </div>
      {/* Claude Code delivers socket writes as another session's message, which it tells
          the child is never user approval (#84); only the child's own terminal is the user (#86). */}
      <div className="m-reply-note">send arrives as a message from another session and cannot approve anything; reply as me types it into the child's terminal, as you</div>
    </>
  )
}

/** A child's footer in the chat: the approval card while it is parked on a permission prompt,
 *  otherwise the composer. Replies go through the mission reply (or, "as me", its terminal);
 *  approvals through `claude attach`, as the reply box's did. */
export function MissionFooter({ c, parts }: { c: ChildSession; parts: ChatParts }) {
  const word = childWord(c)
  if (word === 'BLOCKED' && needKind(c) === 'permission') return <MissionApproval c={c} Card={parts.ApprovalCard} />
  return <MissionComposer c={c} Composer={parts.ChatComposer} blocked={word === 'BLOCKED'} />
}

/** The first line, and not past `max`: what the card shows before it is expanded. */
function headline(text: string, max = 160): string {
  const first = text.split('\n', 1)[0]
  return first.length > max ? `${first.slice(0, max - 1)}…` : first
}

function MissionApproval({ c, Card }: { c: ChildSession; Card: ChatParts['ApprovalCard'] }) {
  const answer = useAnswer(c.id)
  const ask = permissionAsk(c)
  const { tool, command } = splitAsk(ask ?? '')
  const summary = ask ? headline(command) : c.waiting_for ?? 'permission prompt'
  const busy = answer?.phase === 'attaching'
  // The card shows a failure from the rejection; the line under it says the same for "always".
  const run = async (choice: Choice) => {
    const a = await answerPrompt(c, choice)
    if (a.phase === 'error') throw new Error(a.error)
  }
  return (
    <div className="ms-footer ms-approval flex flex-col gap-1.5 px-3 pt-2 pb-3" data-ui>
      <Card tool={tool ?? 'Permission'} summary={summary} detail={ask && command !== summary ? command : undefined} onAllow={() => run('yes')} onDeny={() => run('no')} />
      <div className="flex min-h-6 flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="ms-always"
          disabled={busy}
          title="Allow and don't ask again, when the prompt offers it"
          onClick={() => void answerPrompt(c, 'always')}
        >
          Allow and don't ask again
        </Button>
        {answer?.phase === 'attaching' && <span className="ms-answer">Opening claude attach {c.id}…</span>}
        {answer?.phase === 'sent' && Date.now() - answer.at < 120_000 && (
          <span className="ms-answer">
            {ANSWERED[answer.choice]} ✓ · follow it in the attach pane
          </span>
        )}
        {answer?.phase === 'error' && <span className="ms-answer text-destructive">{answer.error}</span>}
      </div>
    </div>
  )
}

/** Where a composer's text goes: the child's inbox as a message from another session, or typed
 *  into its own terminal as the user. Only the second can approve a push or a PR (#84, #86). */
type Route = 'message' | 'as-me'

const ROUTES: { route: Route; label: string; title: string }[] = [
  { route: 'message', label: 'Message', title: "Arrives as a message from another session: the child reads it, but it cannot approve anything" },
  { route: 'as-me', label: 'As me', title: "Typed into the child's terminal (claude attach), as you: it can approve a push or a PR" },
]

function MissionComposer({ c, Composer, blocked }: { c: ChildSession; Composer: ChatParts['ChatComposer']; blocked: boolean }) {
  const [route, setRoute] = useState<Route>('message')
  const lastSent = useMission((s) => s.sent[c.id]?.at(-1))
  const err = useMission((s) => s.replyErrors[c.id])
  const sending = useMission((s) => !!s.sending[c.id])
  const typing = useMission((s) => !!s.typing[c.id])
  const busy = sending || typing

  // The store sends its draft: the composer's text becomes it for this one send.
  const send = async (text: string) => {
    const m = missionStore.getState()
    m.setDraft(c.id, text)
    const ok = route === 'as-me' ? await m.replyAsMe(c.id, c.suggested_reply) : await m.sendReply(c.id)
    if (!ok) throw new Error(missionStore.getState().replyErrors[c.id] || 'not sent')
  }
  const sendSuggested = () => {
    if (!c.suggested_reply) return
    missionStore.getState().setDraft(c.id, c.suggested_reply)
    void missionStore.getState().sendReply(c.id)
  }

  const placeholder = !c.live
    ? 'The child is not running: nothing reaches it'
    : route === 'as-me'
      ? `Type into claude attach ${c.id}, as you…`
      : blocked
        ? 'Answer the child…'
        : 'Message the child…'

  return (
    <div className="ms-footer ms-composer flex flex-col gap-1.5 px-3 pt-2 pb-3" data-ui>
      {blocked && (
        <div className="ms-question flex items-start gap-2 rounded-md border border-agent-question/40 bg-agent-question/10 px-2.5 py-1.5 text-xs">
          <MessageCircleQuestion className="mt-0.5 size-3.5 shrink-0 text-agent-question" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <div className="ms-needs whitespace-pre-wrap text-foreground">{c.needs ?? c.waiting_for ?? 'waiting for you'}</div>
            {c.suggested_reply && (
              <div className="mt-1 flex items-center gap-2 text-muted-foreground">
                <span className="ms-suggested min-w-0 truncate" title={c.suggested_reply}>
                  Suggested: {c.suggested_reply}
                </span>
                <Button type="button" variant="outline" size="xs" className="ms-send-suggested" disabled={busy || !c.live} onClick={sendSuggested}>
                  Send it
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
      {/* Once picked up, a reply is a card in the transcript; until then, it is said here. */}
      {blocked && lastSent && (
        <div className="ms-sent truncate text-[11px] text-muted-foreground" title={lastSent.original !== lastSent.text ? `typed: ${lastSent.original}` : lastSent.text}>
          {lastSent.asMe ? 'Typed as you' : 'Sent'} ✓ {sentAt(lastSent.at)} · {lastSent.asMe ? 'in its terminal' : 'waiting for the child to pick it up…'} <span className="text-foreground/80">{lastSent.text}</span>
        </div>
      )}
      <Composer onSend={send} cwd={c.cwd || null} placeholder={placeholder} disabled={!c.live || busy} />
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <div className="ms-route inline-flex rounded-md border border-border p-0.5" role="radiogroup" aria-label="Send as">
          {ROUTES.map((r) => (
            <button
              key={r.route}
              type="button"
              role="radio"
              aria-checked={route === r.route}
              data-route={r.route}
              title={r.title}
              className={cn('rounded-sm px-2 py-0.5 transition-colors hover:text-foreground', route === r.route && 'bg-accent text-foreground')}
              onClick={() => setRoute(r.route)}
            >
              {r.label}
            </button>
          ))}
        </div>
        <span className="ms-route-note min-w-0 flex-1 truncate">{ROUTES.find((r) => r.route === route)!.title}</span>
        {typing && <span>typing into its terminal…</span>}
        {err && <span className="ms-error text-destructive">{err}</span>}
      </div>
    </div>
  )
}

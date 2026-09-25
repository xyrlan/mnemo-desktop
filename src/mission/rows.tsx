import { useState } from 'react'
import { MessageCircleQuestion } from 'lucide-react'
import { Button } from '@/ui'
import { cn } from '@/ui/cn'
import { missionStore, useMission } from './app-store'
import { store as appStore } from '../layout/app-store'
import { childWord, needKind, permissionAsk, type ChildSession } from './types'
import { answerPrompt, useAnswer, type Choice } from '../cockpit/approve'
import { ChatComposer } from '../chat-input/Composer'
import { ApprovalCard } from '../chat-input/ApprovalCard'
import './mission.css'

/** What the mission pane does with a child, and what sits under its conversation: the chat's
 *  composer and approval card (`MissionFooter`). */

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

const sentAt = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/** A child's footer in the chat: the approval card while it is parked on a permission prompt,
 *  otherwise the composer. Replies go through the mission reply (or, "as me", its terminal);
 *  approvals through `claude attach`. */
export function MissionFooter({ c }: { c: ChildSession }) {
  const word = childWord(c)
  if (word === 'BLOCKED' && needKind(c) === 'permission') return <MissionApproval c={c} />
  return <MissionComposer c={c} blocked={word === 'BLOCKED'} />
}

/** The first line, and not past `max`: what the card shows before it is expanded. */
function headline(text: string, max = 160): string {
  const first = text.split('\n', 1)[0]
  return first.length > max ? `${first.slice(0, max - 1)}…` : first
}

function MissionApproval({ c }: { c: ChildSession }) {
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
      <ApprovalCard tool={tool ?? 'Permission'} summary={summary} detail={ask && command !== summary ? command : undefined} onAllow={() => run('yes')} onDeny={() => run('no')} />
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

function MissionComposer({ c, blocked }: { c: ChildSession; blocked: boolean }) {
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
      <ChatComposer onSend={send} cwd={c.cwd || null} placeholder={placeholder} disabled={!c.live || busy} />
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

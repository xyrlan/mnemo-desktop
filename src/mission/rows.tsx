import { createContext, useContext } from 'react'
import { MessageCircleQuestion } from 'lucide-react'
import { Button } from '@/ui'
import { cn } from '@/ui/cn'
import { missionStore, useMission } from './app-store'
import { store as appStore } from '../layout/app-store'
import { childWord, permissionAsk, type ChildSession } from './types'
import { childStatus, setRoute, useRoute, type Route } from './agent'
import { answerPrompt, useAnswer, type Choice } from '../cockpit/approve'
import { ChatComposer } from '../chat-input/Composer'
import { ApprovalCard } from '../chat-input/ApprovalCard'
import type { ComposerProps } from '../conversation/chat-input'
import type { Parked } from '../conversation/Foot'
import './mission.css'

/** What the mission pane does with a child, and what sits beside its conversation: the
 *  composer the chat's foot draws for it (`ChildComposer`) and the line under the foot's
 *  approval card (`MissionFooter`). */

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

/** What sits under a child's chat, beside the foot's cards (`ChildConversation`). On a
 *  permission prompt the foot's card allows or denies; this line offers "don't ask again" and
 *  says how the answer went. When the transcript has not written the call yet, the foot has no
 *  card, so the approval card here answers it from what the snapshot says it asks. */
export function MissionFooter({ c, parked }: { c: ChildSession; parked: Parked }) {
  if (childStatus(c).waiting !== 'permission') return null
  if (parked?.kind === 'permission') return <MissionAnswerLine c={c} className="ms-footer px-3 pt-2 pb-3" />
  return <MissionApproval c={c} />
}

/** The first line, and not past `max`: what the card shows before it is expanded. */
function headline(text: string, max = 160): string {
  const first = text.split('\n', 1)[0]
  return first.length > max ? `${first.slice(0, max - 1)}…` : first
}

function MissionApproval({ c }: { c: ChildSession }) {
  const ask = permissionAsk(c)
  const { tool, command } = splitAsk(ask ?? '')
  const summary = ask ? headline(command) : c.waiting_for ?? 'permission prompt'
  // The card shows a failure from the rejection; the line under it says the same for "always".
  const run = async (choice: Choice) => {
    const a = await answerPrompt(c, choice)
    if (a.phase === 'error') throw new Error(a.error)
  }
  return (
    <div className="ms-footer ms-approval flex flex-col gap-1.5 px-3 pt-2 pb-3" data-ui>
      <ApprovalCard tool={tool ?? 'Permission'} summary={summary} detail={ask && command !== summary ? command : undefined} onAllow={() => run('yes')} onDeny={() => run('no')} />
      <MissionAnswerLine c={c} />
    </div>
  )
}

/** "Allow and don't ask again", which the approval card does not offer, and how the last
 *  answer typed into `claude attach` went. */
function MissionAnswerLine({ c, className }: { c: ChildSession; className?: string }) {
  const answer = useAnswer(c.id)
  const busy = answer?.phase === 'attaching'
  return (
    <div className={cn('ms-answer-line flex min-h-6 flex-wrap items-center gap-2 text-[11px] text-muted-foreground', className)} data-ui>
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
  )
}

const ROUTES: { route: Route; label: string; title: string }[] = [
  { route: 'as-me', label: 'As me', title: "Typed into the child's terminal (claude attach), as you: it can approve a push or a PR" },
  { route: 'message', label: 'Message', title: 'Arrives as a message from another session: the child reads it, but it cannot approve anything' },
]

/** The child the composer in a `ChildConversation` answers. */
export const ChildContext = createContext<ChildSession | null>(null)

/** The chat's composer for a child (`ChildConversation` hands it to the foot): what the child
 *  asked as it ended its turn above it, and under it the route its text takes, "as me" unless
 *  another is picked. The foot's `onSend` is the child's agent, which reads the same route. It
 *  gets no `onBash`: a child has no shell mode, so `!` is only a character. */
export function ChildComposer({ onSend, cwd }: ComposerProps) {
  const c = useContext(ChildContext)
  const id = c?.id ?? ''
  const route = useRoute(id)
  const err = useMission((s) => s.replyErrors[id])
  const sending = useMission((s) => !!s.sending[id])
  const typing = useMission((s) => !!s.typing[id])
  if (!c) return null
  const busy = sending || typing
  const blocked = childWord(c) === 'BLOCKED'

  const sendSuggested = () => {
    if (!c.suggested_reply) return
    missionStore.getState().setDraft(c.id, c.suggested_reply)
    void missionStore.getState().sendReply(c.id)
  }

  const placeholder = !c.live
    ? 'The child is not running: nothing reaches it'
    : route === 'as-me'
      ? blocked
        ? 'Answer the child, as you…'
        : `Type into claude attach ${c.id}, as you…`
      : blocked
        ? 'Answer the child…'
        : 'Message the child…'

  return (
    <div className="ms-composer flex flex-col gap-1.5" data-ui>
      {blocked && (
        <div className="ms-question mx-3 flex items-start gap-2 rounded-md border border-agent-question/40 bg-agent-question/10 px-2.5 py-1.5 text-xs">
          <MessageCircleQuestion className="mt-0.5 size-3.5 shrink-0 text-agent-question" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <div className="ms-needs whitespace-pre-wrap text-foreground">{c.needs ?? c.waiting_for ?? 'waiting for you'}</div>
            {c.suggested_reply && (
              <div className="mt-1 flex items-center gap-2 text-muted-foreground">
                <span className="ms-suggested min-w-0 truncate" title={c.suggested_reply}>
                  Suggested: {c.suggested_reply}
                </span>
                <Button type="button" variant="outline" size="xs" className="ms-send-suggested" title="Sent as a message: the child's own suggestion is not your consent" disabled={busy || !c.live} onClick={sendSuggested}>
                  Send it
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
      <ChatComposer onSend={onSend} cwd={cwd} placeholder={placeholder} disabled={!c.live || busy} />
      {/* The composer pads itself; its bottom padding is this row's gap. */}
      <div className="-mt-3 flex flex-wrap items-center gap-2 px-3 text-[11px] text-muted-foreground">
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
              onClick={() => setRoute(c.id, r.route)}
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

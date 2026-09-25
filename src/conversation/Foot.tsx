// adapted from stablyai/orca src/renderer/src/components/native-chat/NativeChatInteractiveCard.tsx
// (dismiss-on-answer) and the foot of NativeChatResolvedView.tsx
import { useCallback, useContext, useState, type ReactNode } from 'react'
import { TriangleAlert } from 'lucide-react'
import type { SessionStatus } from './types'
import type { Pending, ToolCard } from './stream'
import { approvalDetail, approvalSummary, askQuestions, toolLabel } from './run'
import type { ChatAgent } from './agent'
import { ChatInputContext } from './chat-input'

/** What the session is parked on, when the transcript can say. */
export type Parked = { tool: ToolCard; kind: Pending } | null

/** The foot's line when the session waits on something no card can answer: a dialog, or a
 *  prompt whose call the transcript has not written yet. Typing would answer it blind (Enter
 *  picks "Yes"), so the composer steps aside for the terminal. */
function Waiting({ text, onOpenTerminal }: { text: string; onOpenTerminal?: () => void }) {
  return (
    <div className="cv-foot-waiting flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground" role="status">
      <span className="min-w-0 flex-1">{text}</span>
      {onOpenTerminal && (
        <button type="button" onClick={onOpenTerminal} className="shrink-0 rounded-md px-1.5 py-0.5 text-foreground hover:bg-accent">
          Open terminal
        </button>
      )}
    </div>
  )
}

/** The chat's foot: while the session waits on a permission or a question, the card that
 *  answers it; otherwise the composer. An answered card stays down until the session is parked
 *  on something else — its status can lag the answer by a poll — and a question of several
 *  asks them one at a time. What failed to go through is said above it, and the card or the
 *  composer keeps what was in it. */
export function Foot({
  agent,
  cwd,
  status,
  parked,
  onOpenTerminal,
}: {
  agent: ChatAgent
  cwd: string | null
  status: SessionStatus | undefined
  parked: Parked
  onOpenTerminal?: () => void
}) {
  const { Composer, ApprovalCard, QuestionCard } = useContext(ChatInputContext)
  const [error, setError] = useState<string | null>(null)
  /** How far the reader got through the prompt at `key`: 1 past its last question is done. */
  const [answered, setAnswered] = useState<{ key: string; step: number } | null>(null)
  /** Bumped on a failure, so a card that went into its sending state comes back fresh. */
  const [attempt, setAttempt] = useState(0)

  const run = useCallback(async (write: () => Promise<void>, then?: () => void) => {
    setError(null)
    try {
      await write()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setAttempt((n) => n + 1)
      throw e instanceof Error ? e : new Error(String(e))
    }
    then?.()
  }, [])

  const waiting = status?.waiting ?? null
  const key = parked && waiting ? `${parked.tool.id}:${parked.kind}` : null
  const step = key && answered?.key === key ? answered.step : 0
  const advance = (to: number) => key && setAnswered({ key, step: to })

  let body: ReactNode
  if (waiting && parked?.kind === 'permission' && step === 0 && ApprovalCard) {
    const t = parked.tool
    body = (
      <ApprovalCard
        key={`${key}:${attempt}`}
        tool={toolLabel(t.name)}
        summary={approvalSummary(t, cwd)}
        detail={approvalDetail(t)}
        onAllow={() => run(agent.allow, () => advance(1))}
        onDeny={() => run(agent.deny, () => advance(1))}
      />
    )
  } else if (waiting && parked?.kind === 'question' && QuestionCard && step < askQuestions(parked.tool.input).length) {
    const q = askQuestions(parked.tool.input)[step]
    const other = agent.other
    body = (
      <QuestionCard
        key={`${key}:${step}:${attempt}`}
        question={q.question}
        options={q.options}
        onAnswer={(i) => run(() => agent.answer(i), () => advance(step + 1))}
        onOther={other ? (text) => run(() => other(text), () => advance(step + 1)) : undefined}
      />
    )
  } else if (waiting && step === 0) {
    const what = waiting === 'question' ? 'your answer' : 'approval'
    body = <Waiting text={parked ? `Waiting for ${what}: answer it in the terminal.` : `Claude Code is waiting for ${what}. The transcript does not say on what yet.`} onOpenTerminal={onOpenTerminal} />
  } else if (status?.parked) {
    body = <Waiting text="Claude Code is showing a dialog: answer it in the terminal." onOpenTerminal={onOpenTerminal} />
  } else {
    // Never remounted: a prompt that did not go through stays in it to send again.
    body = Composer ? <Composer cwd={cwd} placeholder="Message Claude…" onSend={(text) => run(() => agent.send(text))} /> : null
  }

  return (
    <div className="cv-foot shrink-0 px-3 pb-3 sm:px-4">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-2">
        {error && (
          <div className="cv-foot-error flex items-start gap-1.5 text-xs text-destructive" role="alert">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span className="min-w-0 break-words">{error}</span>
          </div>
        )}
        {body}
      </div>
    </div>
  )
}

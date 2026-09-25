// adapted from stablyai/orca src/renderer/src/components/native-chat/NativeChatQuestionCard.tsx
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Check, Loader2, MessageCircleQuestion, Pencil, TriangleAlert } from 'lucide-react'
import { cn } from '@/ui/cn'

export type QuestionCardProps = {
  question: string
  options: string[]
  /** Picks option `index` (0-based). */
  onAnswer(index: number): Promise<void>
  /** Answers in words instead; without it the card offers only the options. */
  onOther?(text: string): Promise<void>
}

type Phase =
  | { at: 'open' }
  | { at: 'sending' | 'sent'; pick: number | 'other' }
  | { at: 'failed'; message: string }

/** Claude asking a question (AskUserQuestion): a click on an option answers it, as its number
 *  does while the card has focus; the last row answers in words. What was sent stays marked
 *  until the card's owner takes it down; a refused answer is shown and the card works again. */
export function QuestionCard({ question, options, onAnswer, onOther }: QuestionCardProps) {
  const [phase, setPhase] = useState<Phase>({ at: 'open' })
  const [other, setOther] = useState('')
  const alive = useRef(true)
  useEffect(
    () => () => {
      alive.current = false
    },
    [],
  )
  const busy = phase.at === 'sending' || phase.at === 'sent'

  const run = async (pick: number | 'other', send: () => Promise<void>) => {
    if (busy) return
    setPhase({ at: 'sending', pick })
    try {
      await send()
      if (alive.current) setPhase({ at: 'sent', pick })
    } catch (e) {
      if (alive.current) setPhase({ at: 'failed', message: e instanceof Error ? e.message : String(e) })
    }
  }
  const pick = (i: number) => void run(i, () => onAnswer(i))
  const sendOther = () => {
    const text = other.trim()
    if (text && onOther) void run('other', () => onOther(text))
  }

  // An option's number answers it while focus is on the card, not in its text field.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return
    const n = Number(e.key)
    if (Number.isInteger(n) && n >= 1 && n <= options.length) {
      e.preventDefault()
      pick(n - 1)
    }
  }

  const marked = (p: number | 'other') => (phase.at === 'sending' || phase.at === 'sent') && phase.pick === p
  return (
    <div data-ui data-chat-question className="shrink-0 bg-background" aria-busy={phase.at === 'sending'}>
      <div className="mx-auto w-full max-w-4xl px-3 pt-2 pb-3">
        <div role="group" aria-label={question} onKeyDown={onKeyDown} className="overflow-hidden rounded-lg border border-input bg-card shadow-xs">
          <div className="flex items-start gap-2 px-3.5 py-2.5">
            <MessageCircleQuestion className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <p className="min-w-0 flex-1 break-words text-sm font-semibold text-foreground">{question}</p>
          </div>
          <div className="scrollbar-sleek max-h-[50vh] divide-y divide-border/60 overflow-y-auto border-t border-border">
            {options.map((label, i) => (
              <button
                key={`${i}:${label}`}
                type="button"
                disabled={busy}
                aria-pressed={marked(i)}
                onClick={() => pick(i)}
                className={cn(
                  'flex w-full items-start gap-3 px-3.5 py-2.5 text-left transition-colors disabled:pointer-events-none',
                  marked(i) ? 'bg-accent' : 'hover:bg-accent',
                  busy && !marked(i) && 'opacity-60',
                )}
              >
                <span
                  className={cn(
                    'flex size-6 shrink-0 items-center justify-center rounded-md text-xs font-medium',
                    marked(i) ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
                  )}
                >
                  {marked(i) ? phase.at === 'sent' ? <Check className="size-3.5" strokeWidth={3} /> : <Loader2 className="size-3.5 animate-spin" /> : i + 1}
                </span>
                <span className="min-w-0 break-words pt-0.5 text-sm text-foreground">{label}</span>
              </button>
            ))}
            {onOther ? (
              <div className={cn('flex items-center gap-3 px-3.5 py-2.5', marked('other') && 'bg-accent')}>
                <span className={cn('flex size-6 shrink-0 items-center justify-center rounded-md', marked('other') ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>
                  {marked('other') ? phase.at === 'sent' ? <Check className="size-3.5" strokeWidth={3} /> : <Loader2 className="size-3.5 animate-spin" /> : <Pencil className="size-3.5" />}
                </span>
                <input
                  value={other}
                  disabled={busy}
                  aria-label="Answer in your own words"
                  placeholder="Or type your answer"
                  onChange={(e) => setOther(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                      e.preventDefault()
                      sendOther()
                    }
                  }}
                  className="min-w-0 flex-1 bg-transparent font-sans text-sm text-foreground outline-none placeholder:text-muted-foreground/60 disabled:opacity-50"
                />
                <button
                  type="button"
                  disabled={busy || !other.trim()}
                  onClick={sendOther}
                  className={cn(
                    'shrink-0 whitespace-nowrap rounded-md px-3 py-1 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-50',
                    other.trim() ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'text-muted-foreground',
                  )}
                >
                  Send
                </button>
              </div>
            ) : null}
          </div>
        </div>
        {phase.at === 'failed' ? (
          <p role="alert" className="mt-1.5 flex items-center gap-1.5 text-xs text-destructive">
            <TriangleAlert className="size-3.5 shrink-0" />
            <span className="min-w-0 break-words">{phase.message}</span>
          </p>
        ) : phase.at === 'sent' ? (
          <p className="mt-1.5 text-xs text-muted-foreground">Answered — waiting on Claude</p>
        ) : null}
      </div>
    </div>
  )
}

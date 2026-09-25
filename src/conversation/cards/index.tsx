// adapted from stablyai/orca src/renderer/src/components/native-chat/NativeChatMessageRow.tsx,
// NativeChatNoticeRow.tsx, NativeChatAwaitingInputRow.tsx, NativeChatSubagentRun.tsx and
// NativeChatMessageTimestamp.tsx
import type { ReactNode } from 'react'
import { Check, ChevronRight, Info, LoaderCircle, TriangleAlert } from 'lucide-react'
import { cn } from '@/ui/cn'
import { Markdown } from '../../vault/Markdown'
import { openUrl } from '../../github/actions'
import type { Card } from '../types'
import type { Outgoing } from '../outbox'
import type { Pending, ToolCard } from '../stream'
import { askQuestions } from '../run'
import { useCards } from './context'
import { CopyButton } from './copy'
import { ToolIcon } from './icons'
import { Thumbs } from './image'
import { RuleChips } from './rules'
import { Answers, Denied, Out, ToolLine } from './tool'
import { AwaitingRow } from './ToolRun'

/** Transcript text as the vault renders a page: `[[slug]]` opens the rule, a link opens in the
 *  browser pane. Laid out as the chat's body copy by `.cv-md` (conversation.css). */
export function Md({ text, className }: { text: string; className?: string }) {
  const { rules } = useCards()
  return (
    <div className={cn('cv-md', className)}>
      <Markdown text={text} onWiki={(slug) => rules.open(slug)} onLink={(href) => openUrl(href, href)} />
    </div>
  )
}

const clock = (at: string) => {
  const d = new Date(at)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

/** When a row was said, shown while the row is hovered or holds focus. */
function Stamp({ at, className }: { at: string; className?: string }) {
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return null
  return (
    <time
      dateTime={d.toISOString()}
      title={d.toLocaleString()}
      className={cn(
        'cv-stamp text-xs whitespace-nowrap text-muted-foreground tabular-nums opacity-0 transition-opacity select-none group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100',
        className,
      )}
    >
      {clock(at)}
    </time>
  )
}

/** A notice: a line of its own in the transcript's quieter voice. */
function Notice({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex items-start gap-2 text-xs text-muted-foreground', className)}>{children}</div>
}

/** A line across the transcript with a word in it: a compaction, a `/clear`. */
export function Separator({ label, className }: { label: string; className?: string }) {
  return (
    <div role="separator" aria-label={label} className={cn('flex items-center gap-3 py-1 text-xs text-muted-foreground', className)}>
      <span className="h-px flex-1 bg-border" />
      <span>{label}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  )
}

function SessionBlock({ card, k }: { card: Extract<Card, { kind: 'session' }>; k: string }) {
  const { isOpen, toggle } = useCards()
  const open = isOpen(`${k}:briefing`)
  const learned = card.rules.filter((r) => r.channel === 'learned')
  const other = card.rules.filter((r) => r.channel !== 'learned')
  return (
    <div className="cv-session rounded-md border border-border bg-muted/20 px-3 py-2 text-sm">
      <div className="cv-session-head flex items-center gap-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Session {card.source || 'start'}</span>
        <span className="tabular-nums">{clock(card.at)}</span>
      </div>
      {card.briefing && (
        <>
          <button type="button" className="cv-more mt-1 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" aria-expanded={open} onClick={() => toggle(`${k}:briefing`)}>
            <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} aria-hidden />
            Briefing
          </button>
          {open && (
            <div className="cv-briefing scrollbar-sleek mt-1 max-h-96 overflow-auto border-l-2 border-border/60 pl-3">
              <Md text={card.briefing} />
            </div>
          )}
        </>
      )}
      <RuleChips rules={other} label="briefing" />
      <RuleChips rules={learned} label="learned" />
    </div>
  )
}

/** A subagent: one row that says what it was sent to do and whether it reported, opening to
 *  its report. */
function AgentRow({ card, k }: { card: Extract<Card, { kind: 'agent' }>; k: string }) {
  const { isOpen, toggle } = useCards()
  const open = isOpen(k)
  const done = card.report !== null
  return (
    <div className="cv-agent">
      <button type="button" className="group/agent flex min-h-6 w-full min-w-0 items-center gap-1.5 py-0.5 text-left" aria-expanded={open} onClick={() => toggle(k)}>
        <ToolIcon kind="agent" />
        <span className="shrink-0 text-sm text-muted-foreground group-hover/agent:text-foreground/80">Agent{card.agentType ? ` · ${card.agentType}` : ''}</span>
        <span className="min-w-0 truncate text-sm text-foreground/85">{card.description}</span>
        {done ? (
          <Check aria-label="reported" className="size-3 shrink-0 text-muted-foreground" />
        ) : (
          <LoaderCircle aria-label="running" className="size-3 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" />
        )}
        <ChevronRight className={cn('size-3.5 shrink-0 text-muted-foreground transition-all', open ? 'rotate-90 opacity-100' : 'opacity-0 group-hover/agent:opacity-100')} aria-hidden />
      </button>
      {open && (
        <div className="mt-1 ml-2 border-l-2 border-border/60 pl-3">
          {done ? <Md text={card.report!} /> : <div className="text-xs text-muted-foreground">No report yet</div>}
        </div>
      )}
    </div>
  )
}

/** An AskUserQuestion: the question in plain words instead of the tool's input, and once
 *  answered, what was picked. */
function AskRow({ card, pending }: { card: ToolCard; pending: Pending | null }) {
  const qs = askQuestions(card.input)
  const subject = qs.length === 1 ? qs[0].question : qs.length > 1 ? `${qs.length} questions` : card.summary || null
  const o = card.outcome
  return (
    <div className="cv-ask" data-tool={card.name}>
      {pending ? (
        <AwaitingRow kind="question" subject={subject} />
      ) : (
        <div className="flex min-h-6 w-full items-center gap-1.5 py-0.5 text-sm leading-relaxed text-muted-foreground">
          <ToolIcon kind="ask" />
          <span className="shrink-0">Asked</span>
          <span className="min-w-0 truncate text-foreground/85">{subject}</span>
        </div>
      )}
      {o?.kind === 'answers' && (
        <div className="py-1 pl-5">
          <Answers answers={o.answers} />
        </div>
      )}
      {o?.kind === 'denied' && (
        <div className="py-1 pl-5">
          <Denied o={o} />
        </div>
      )}
      <RuleChips rules={card.rules} />
    </div>
  )
}

/** ExitPlanMode: the plan as a card to read, and how it was answered. */
function PlanCard({ card, pending }: { card: ToolCard; pending: Pending | null }) {
  const plan = typeof card.input.plan === 'string' ? card.input.plan : ''
  const o = card.outcome
  return (
    <div className="cv-plan rounded-xl border border-border bg-card py-3 shadow-xs" data-tool={card.name}>
      <div className="px-4 text-sm font-semibold text-foreground">Plan</div>
      {plan && <Md text={plan} className="px-4 pt-2" />}
      <div className="px-4 pt-2">
        {pending ? (
          <AwaitingRow kind="permission" subject="Approve this plan?" />
        ) : o?.kind === 'denied' ? (
          <Denied o={o} />
        ) : o ? (
          <div className="text-xs text-muted-foreground">{o.kind === 'error' ? 'Not approved' : 'Approved'}</div>
        ) : null}
      </div>
    </div>
  )
}

const COMMAND_CHIP = 'cv-command rounded-md bg-muted px-2 py-1 font-mono text-xs text-foreground'

/** Colour codes a command printed, which the chat cannot draw. */
const plain = (s: string) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')

/** A `!` command run in Claude Code's shell mode, and what it printed once that is in: shown
 *  open, as the terminal shows it. */
function ShellCommand({ card }: { card: Extract<Card, { kind: 'command' }> }) {
  const out = card.output
  return (
    <div className="cv-command-row cv-shell flex flex-col items-end gap-1">
      <span className={COMMAND_CHIP}>
        !{card.args && <span className="text-muted-foreground"> {card.args}</span>}
      </span>
      {out && (
        <div className="cv-shell-out w-full max-w-[85%] space-y-1">
          <Out text={plain(out.stdout)} />
          <Out text={plain(out.stderr)} err />
          {!out.stdout.trim() && !out.stderr.trim() && <div className="text-right text-[11px] text-muted-foreground">No output</div>}
        </div>
      )}
    </div>
  )
}

/** A message the chat sent, drawn as its record will be until the transcript has it; one that
 *  was not delivered is marked, its reason under the composer that got its text back. */
export function OutgoingView({ out }: { out: Outgoing }) {
  const failed = out.state === 'failed'
  const note = failed && (
    <div className="cv-not-sent flex items-center gap-1 text-[11px] text-destructive" title={out.error}>
      <TriangleAlert className="size-3 shrink-0" aria-hidden />
      Not sent
    </div>
  )
  if (out.kind === 'bash')
    return (
      <div className="cv-command-row cv-outgoing flex flex-col items-end gap-1" data-state={out.state}>
        <span className={cn(COMMAND_CHIP, failed && 'outline outline-destructive/60')}>
          !<span className="text-muted-foreground"> {out.text}</span>
        </span>
        {note}
      </div>
    )
  return (
    <div className="cv-outgoing group relative flex flex-col items-end gap-0.5" data-state={out.state}>
      <div className={cn('cv-bubble max-w-[85%] rounded-lg rounded-tr-sm bg-muted px-3.5 py-2.5 text-sm text-foreground', failed && 'outline outline-destructive/60')}>
        <Md text={out.text} />
      </div>
      {note}
    </div>
  )
}

/** One card of the stream. `k` is its row key: where its folds are remembered. */
export function CardView({ card, pending, k }: { card: Card; pending: Pending | null; k: string }) {
  switch (card.kind) {
    case 'user':
      return (
        <div className="cv-user group relative flex flex-col items-end gap-0.5">
          {/* A distinct muted fill, so the prompt reads apart from the agent's body copy. */}
          <div className={cn('cv-bubble max-w-[85%] rounded-lg rounded-tr-sm bg-muted px-3.5 py-2.5 text-sm text-foreground', card.queued && 'cv-queued border border-dashed border-border bg-muted/50')}>
            {card.queued && <div className="cv-badge mb-1 text-[11px] text-muted-foreground">Queued</div>}
            {card.text && <Md text={card.text} />}
            <Thumbs images={card.images} />
          </div>
          <RuleChips rules={card.rules} className="justify-end" />
          <Stamp at={card.at} />
        </div>
      )
    case 'assistant':
      return (
        <div className="cv-assistant group relative max-w-full text-sm leading-relaxed text-foreground select-text">
          <Md text={card.text} />
          {/* Hover or keyboard focus shows them; touch keeps them. Hung below the row (Orca's
              -mb-5), they take no height of their own. */}
          <div className="mt-1 -mb-5 flex w-fit items-center gap-1 opacity-0 transition-opacity select-none group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
            <CopyButton text={card.text} label="Copy message" />
            <Stamp at={card.at} className="opacity-100" />
          </div>
        </div>
      )
    case 'thinking':
      return <Thinking card={card} k={k} />
    case 'tool':
      if (card.name === 'AskUserQuestion') return <AskRow card={card} pending={pending} />
      if (card.name === 'ExitPlanMode') return <PlanCard card={card} pending={pending} />
      return <ToolLine tool={card} k={k} pending={pending} />
    case 'agent':
      return <AgentRow card={card} k={k} />
    case 'peer':
      return (
        <div className="cv-peer rounded-md border border-border bg-muted/20 p-3 text-sm">
          <div className="cv-peer-from mb-1 text-xs text-muted-foreground">From {card.from}</div>
          <Md text={card.text} />
        </div>
      )
    case 'notification':
      return card.text === 'conversation compacted' ? (
        <Separator label="Context compacted" className="cv-notification" />
      ) : (
        <Notice className="cv-notification">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <p className="min-w-0 break-words whitespace-pre-wrap" title={card.text}>
            {card.text}
          </p>
        </Notice>
      )
    case 'command':
      if (card.name === '!') return <ShellCommand card={card} />
      return (
        <div className="cv-command-row flex justify-end">
          <span className="cv-command rounded-md bg-muted px-2 py-1 font-mono text-xs text-foreground">
            {card.name === '!' ? '!' : `/${card.name.replace(/^\//, '')}`}
            {card.args && <span className="text-muted-foreground"> {card.args}</span>}
          </span>
        </div>
      )
    case 'session':
      return <SessionBlock card={card} k={k} />
    case 'unknown':
      return (
        <Notice>
          <span className="cv-unknown rounded-full bg-muted px-2 py-0.5 font-mono text-[11px]" title="A record type this app does not know yet">
            unknown {card.type}
          </span>
        </Notice>
      )
  }
}

/** The model thinking aloud: a quieter italic aside, cut to a few lines until opened. */
function Thinking({ card, k }: { card: Extract<Card, { kind: 'thinking' }>; k: string }) {
  const { isOpen, toggle } = useCards()
  const open = isOpen(k)
  return (
    <button
      type="button"
      className="cv-thinking block w-full border-l-2 border-border/60 pl-3 text-left text-sm leading-relaxed text-muted-foreground italic hover:text-foreground/80"
      aria-expanded={open}
      title={open ? 'Fold' : 'Show all of it'}
      onClick={() => toggle(k)}
    >
      <span className={cn('block break-words whitespace-pre-wrap', !open && 'line-clamp-3')}>{card.text}</span>
    </button>
  )
}

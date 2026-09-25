// adapted from stablyai/orca src/renderer/src/components/native-chat/NativeChatToolRun.tsx and
// NativeChatAwaitingInputRow.tsx
import { Check, ChevronRight } from 'lucide-react'
import { cn } from '@/ui/cn'
import type { Item } from '../stream'
import type { RuleChip } from '../types'
import { approvalSummary, describeCall, relativeTo, runCategory, runOutcome, runSentence, toolCategory } from '../run'
import { useCards } from './context'
import { ToolIcon } from './icons'
import { RuleChips } from './rules'
import { ToolLine } from './tool'

type RunItem = Extract<Item, { kind: 'run' }>

/** The row a waiting session draws under the call it is parked on: what it waits for, in
 *  words, and the terminal where it can be answered too, unless the chat's foot answers it and
 *  its head leads to the terminal. Only the label breathes. */
export function AwaitingRow({ kind, subject }: { kind: 'permission' | 'question'; subject: string | null }) {
  const { onOpenTerminal: open, foot } = useCards()
  const onOpenTerminal = foot ? undefined : open
  return (
    <div className="cv-pending-bar flex min-h-6 w-full items-center gap-1.5 py-0.5 text-sm leading-relaxed text-muted-foreground" role="status" data-awaiting={kind}>
      <ToolIcon kind="ask" className="text-agent-question-text" />
      <span className="shrink-0 animate-pulse text-agent-question-text motion-reduce:animate-none">{kind === 'question' ? 'Waiting for your answer' : 'Waiting for approval'}</span>
      {subject && <span className="min-w-0 truncate text-foreground/85">{subject}</span>}
      {onOpenTerminal && (
        <button type="button" onClick={onOpenTerminal} className="ml-auto shrink-0 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground">
          Open terminal
        </button>
      )}
    </div>
  )
}

const union = (lists: RuleChip[][]) => {
  const out: RuleChip[] = []
  for (const l of lists) for (const r of l) if (!out.some((x) => x.slug === r.slug && x.channel === r.channel)) out.push(r)
  return out
}

/** A run of tool calls folded to one line: the run in words, present tense while it is the
 *  live one, past once settled, with the latest call beside it. Opens to one line per call.
 *  The run a session is parked in opens by itself. The mnemo rules that reached its calls stay
 *  in sight while it is folded. */
export function ToolRun({ item, busy }: { item: RunItem; busy: boolean }) {
  const { isOpen, toggle, foot, cwd } = useCards()
  const { tools, pending, key } = item
  const live = busy && item.trailing && !pending
  const open = isOpen(key, !!pending)
  // A run parked on a call has not done it: it speaks in the present, and its opened line
  // names the call.
  const sentence = runSentence(tools, live || !!pending)
  const { succeeded, failedCount } = runOutcome(tools)
  const latest = live ? tools.at(-1) : undefined
  // A lone call that is not a command keeps what it touched beside its sentence: "Read 1 file"
  // says less than the file.
  const single = !live && !pending && tools.length === 1 && toolCategory(tools[0].name) !== 'command' ? tools[0].summary : ''
  const aside = latest ? describeCall(latest, cwd) : relativeTo(single, cwd)
  const parked = pending ? tools.find((t) => t.id === pending.id) : undefined
  return (
    <div className="cv-run" data-run-state={live ? 'live' : 'settled'}>
      <button
        type="button"
        onClick={() => toggle(key)}
        className="group/tool-run flex min-h-6 w-full min-w-0 items-center gap-1.5 rounded-md py-0.5 text-left focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:outline-none focus-visible:ring-inset"
        aria-expanded={open}
        aria-live="polite"
      >
        <ToolIcon kind={runCategory(tools)} />
        <span
          className={cn(
            'cv-run-sentence truncate text-sm leading-relaxed transition-colors',
            live ? 'max-w-[72%] shrink-0 animate-pulse text-foreground/85 motion-reduce:animate-none' : 'min-w-0 shrink text-muted-foreground group-hover/tool-run:text-foreground/80',
            // The sentence is the command itself.
            !live && !pending && tools.length === 1 && toolCategory(tools[0].name) === 'command' && 'font-mono text-xs',
          )}
          title={sentence}
        >
          {sentence}
        </span>
        {failedCount > 0 && (
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground" aria-label={`${failedCount} failed`}>
            {failedCount} failed
          </span>
        )}
        {!live && succeeded && <Check aria-label="done" className="size-3 shrink-0 text-muted-foreground" />}
        {aside && <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">{aside}</span>}
        <ChevronRight className={cn('size-3.5 shrink-0 text-muted-foreground transition-all', open ? 'rotate-90 opacity-100' : 'opacity-0 group-hover/tool-run:opacity-100')} aria-hidden />
      </button>
      {pending && !foot && <AwaitingRow kind={pending.kind} subject={parked ? approvalSummary(parked, cwd) : null} />}
      {open && (
        // Indented under the header: nothing else marks where the run ends.
        <div className="mt-1 pl-4">
          {tools.map((t) => (
            <ToolLine key={t.id} tool={t} k={`${key}:${t.id}`} pending={pending?.id === t.id ? pending.kind : null} live={busy && item.trailing && t === tools.at(-1)} />
          ))}
        </div>
      )}
      <RuleChips rules={union(tools.map((t) => t.rules))} />
    </div>
  )
}

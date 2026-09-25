// adapted from stablyai/orca src/renderer/src/components/native-chat/NativeChatToolLine.tsx
import { ChevronRight, LoaderCircle } from 'lucide-react'
import { cn } from '@/ui/cn'
import type { ToolOutcome } from '../types'
import type { Pending, ToolCard } from '../stream'
import { failed, proposedHunks, relativeTo, toolCategory, toolLabel } from '../run'
import { useCards } from './context'
import { CopyButton } from './copy'
import { DiffCard } from './diff'
import { ToolIcon } from './icons'
import { Thumbs } from './image'

/** Past this, a tool's text output is cut: a `cat` of a big file would otherwise lay out
 *  megabytes in one row. */
export const OUTPUT_CAP = 20_000

const cap = (s: string) => (s.length > OUTPUT_CAP ? `${s.slice(0, OUTPUT_CAP)}\n… ${s.length - OUTPUT_CAP} more characters not shown` : s)

const PRE = 'scrollbar-sleek max-h-64 overflow-auto rounded bg-accent p-2 font-mono text-[11px] break-words whitespace-pre-wrap'

function Out({ text, err }: { text: string; err?: boolean }) {
  return text ? <pre className={cn('cv-out', PRE, err ? 'cv-err text-destructive' : 'text-foreground/80')}>{cap(text)}</pre> : null
}

export function Denied({ o }: { o: Extract<ToolOutcome, { kind: 'denied' }> }) {
  return (
    <div className="cv-denied text-xs text-destructive">
      Denied{o.reason ? ` · ${o.reason}` : ''}
      {o.feedback && <blockquote className="mt-1 border-l-2 border-border pl-2 text-foreground">{o.feedback}</blockquote>}
    </div>
  )
}

export function Answers({ answers }: { answers: Record<string, string> }) {
  return (
    <dl className="cv-answers space-y-1 text-xs">
      {Object.entries(answers).map(([q, a]) => (
        <div key={q}>
          <dt className="text-muted-foreground">{q}</dt>
          <dd className="ml-3 text-foreground">{a}</dd>
        </div>
      ))}
    </dl>
  )
}

/** What a call returned, under its line. */
function Outcome({ o }: { o: ToolOutcome }) {
  switch (o.kind) {
    case 'text':
      return <Out text={o.text} />
    case 'error':
      return <Out text={o.text} err />
    case 'bash':
      return (
        <>
          <Out text={o.stdout} />
          <Out text={o.stderr} err />
          {!o.stdout && !o.stderr && <div className="text-[11px] text-muted-foreground">No output</div>}
        </>
      )
    case 'diff':
      return null
    case 'denied':
      return <Denied o={o} />
    case 'answers':
      return <Answers answers={o.answers} />
  }
}

/** The word on a line's end for how it went, when that is not plainly "done". */
function Mark({ o, pending, live }: { o: ToolOutcome | null; pending: Pending | null; live: boolean }) {
  if (pending)
    return (
      <span className="shrink-0 animate-pulse text-[11px] text-agent-question-text motion-reduce:animate-none" data-mark="pending">
        {pending === 'question' ? 'waiting for your answer' : 'waiting for approval'}
      </span>
    )
  if (!o) return live ? <LoaderCircle aria-label="running" className="size-3 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" /> : null
  if (!failed(o)) return null
  const word = o.kind === 'denied' ? 'denied' : o.kind === 'bash' ? 'interrupted' : 'failed'
  return (
    <span className="shrink-0 font-mono text-[11px] text-destructive" data-mark={word}>
      {word}
    </span>
  )
}

/** One call of an open run: `▸ Name  preview` that opens in place to what it was asked and
 *  what it returned. A finished edit is its diff card instead; one waiting on approval opens to
 *  the change it asks to make. A denial and an answer are short and matter, so they show
 *  folded too. */
export function ToolLine({ tool, k, pending = null, live = false }: { tool: ToolCard; k: string; pending?: Pending | null; live?: boolean }) {
  const { isOpen, toggle, cwd } = useCards()
  const o = tool.outcome
  if (o?.kind === 'diff') {
    return (
      <div className="cv-tool" data-tool={tool.name}>
        <DiffCard filePath={o.filePath} hunks={o.hunks} verb={o.created ? 'added' : 'edited'} k={`${k}:diff`} />
        <Thumbs images={tool.images} />
      </div>
    )
  }
  const open = isOpen(k, !!pending)
  const command = typeof tool.input.command === 'string' ? tool.input.command : null
  const proposed = o === null ? proposedHunks(tool.name, tool.input) : null
  // A Write's input carries the whole file: laid out only once the line is open.
  const input = open && Object.keys(tool.input).length ? JSON.stringify(tool.input, null, 2) : null
  const always = o?.kind === 'denied' || o?.kind === 'answers'
  const filePath = typeof tool.input.file_path === 'string' ? tool.input.file_path : tool.summary
  return (
    <div className={cn('cv-tool', pending && 'cv-pending')} data-tool={tool.name}>
      <button
        type="button"
        onClick={() => toggle(k)}
        className="group/tool-line flex w-full min-w-0 items-center gap-1.5 py-0.5 text-left"
        aria-expanded={open}
      >
        <ToolIcon kind={toolCategory(tool.name)} />
        <code className="shrink-0 font-mono text-xs font-semibold text-foreground/90 transition-colors group-hover/tool-line:text-foreground">{toolLabel(tool.name)}</code>
        {tool.summary && (
          <span className="cv-tool-summary min-w-0 truncate font-mono text-[11px] text-muted-foreground transition-colors group-hover/tool-line:text-foreground/70" title={tool.summary}>
            {relativeTo(tool.summary, cwd)}
          </span>
        )}
        <Mark o={o} pending={pending} live={live} />
        <ChevronRight className={cn('size-3.5 shrink-0 text-muted-foreground transition-all', open ? 'rotate-90 opacity-100' : 'opacity-0 group-hover/tool-line:opacity-100')} aria-hidden />
      </button>
      {open && (
        <div className="space-y-1.5 py-1 pl-5">
          {command !== null ? (
            <div className="flex items-start gap-1">
              <pre className={cn('cv-cmd min-w-0 flex-1', PRE, 'text-foreground/90')}>$ {command}</pre>
              <CopyButton text={command} label="Copy command" />
            </div>
          ) : proposed ? (
            <DiffCard filePath={filePath} hunks={proposed} verb="proposed" k={`${k}:diff`} />
          ) : (
            input && <pre className={cn('cv-input', PRE, 'text-muted-foreground')}>{cap(input)}</pre>
          )}
          {o && <Outcome o={o} />}
        </div>
      )}
      {!open && always && o && (
        <div className="py-1 pl-5">
          <Outcome o={o} />
        </div>
      )}
      <Thumbs images={tool.images} />
    </div>
  )
}

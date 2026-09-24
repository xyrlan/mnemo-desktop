import { useState } from 'react'
import type { Card, ToolOutcome } from '../types'
import type { Pending } from '../stream'
import { useCards } from './context'
import { DiffBody, diffCounts } from './diff'
import { Thumbs } from './image'
import { RuleChips } from './rules'

type ToolCardT = Extract<Card, { kind: 'tool' }>

/** Past this, a tool's text output is cut: a `cat` of a big file would otherwise lay out
 *  megabytes in one row. */
export const OUTPUT_CAP = 20_000

/** `mcp__mnemo__read_mnemo_rule` → `mnemo · read_mnemo_rule`. */
export function toolLabel(name: string): string {
  const m = /^mcp__(.+?)__(.+)$/.exec(name)
  return m ? `${m[1]} · ${m[2]}` : name
}

function mark(o: ToolOutcome | null): [string, string] {
  if (!o) return ['…', 'no result yet']
  if (o.kind === 'error') return ['✗', 'failed']
  if (o.kind === 'denied') return ['⊘', 'denied']
  if (o.kind === 'bash' && o.interrupted) return ['⏹', 'interrupted']
  return ['✓', 'done']
}

/** Lines of a Bash command shown before it folds. A heredoc (`git commit -m "$(cat <<'EOF'`,
 *  `cat > f <<'EOF'`) opens with the command itself, then its body: four lines keep the command
 *  and the start of the body (a commit's subject and first line) readable, and hold the card
 *  to about the height of the output toggle under it. A command folds only when at least two
 *  lines would hide: hiding one behind a one-line control saves nothing. */
export const CMD_FOLD = 4

const cap = (s: string) => (s.length > OUTPUT_CAP ? `${s.slice(0, OUTPUT_CAP)}\n… ${s.length - OUTPUT_CAP} more characters not shown` : s)
const lineCount = (s: string) => (s ? s.replace(/\n$/, '').split('\n').length : 0)

function Out({ text, err }: { text: string; err?: boolean }) {
  return text ? <pre className={`cv-out${err ? ' cv-err' : ''}`}>{cap(text)}</pre> : null
}

function Denied({ o }: { o: Extract<ToolOutcome, { kind: 'denied' }> }) {
  return (
    <div className="cv-denied">
      denied{o.reason ? ` · ${o.reason}` : ''}
      {o.feedback && <blockquote>{o.feedback}</blockquote>}
    </div>
  )
}

function Answers({ answers }: { answers: Record<string, string> }) {
  return (
    <dl className="cv-answers">
      {Object.entries(answers).map(([q, a]) => (
        <div key={q}>
          <dt>{q}</dt>
          <dd>{a}</dd>
        </div>
      ))}
    </dl>
  )
}

/** What a tool returned, when it is not already on the card's face. */
function Outcome({ o, k }: { o: ToolOutcome; k: string }) {
  const { isOpen, toggle } = useCards()
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
        </>
      )
    case 'diff':
      return <DiffBody hunks={o.hunks} open={isOpen(`${k}:diff`)} onToggle={() => toggle(`${k}:diff`)} />
    case 'denied':
      return <Denied o={o} />
    case 'answers':
      return <Answers answers={o.answers} />
  }
}

function PendingBar({ kind }: { kind: Pending }) {
  const { onOpenTerminal } = useCards()
  return (
    <div className="cv-pending-bar" role="status">
      <span>{kind === 'question' ? 'waiting for your answer' : 'waiting for approval'}</span>
      {onOpenTerminal && (
        <button className="cv-btn" onClick={onOpenTerminal}>
          open terminal
        </button>
      )}
    </div>
  )
}

/** Edit/Write: the path, its counts and the diff inline. */
function DiffTool({ card, o, k }: { card: ToolCardT; o: Extract<ToolOutcome, { kind: 'diff' }>; k: string }) {
  const { isOpen, toggle } = useCards()
  const { additions, deletions } = diffCounts(o.hunks)
  return (
    <>
      <div className="cv-tool-head">
        <span className="cv-tool-name">{card.name}</span>
        <span className="cv-tool-summary" title={o.filePath}>
          {o.filePath}
        </span>
        {o.created && <span className="cv-badge">created</span>}
        <span className="rv-counts">
          <span className="rv-plus">+{additions}</span> <span className="rv-minus">−{deletions}</span>
        </span>
      </div>
      <DiffBody hunks={o.hunks} open={isOpen(`${k}:diff`)} onToggle={() => toggle(`${k}:diff`)} />
    </>
  )
}

/** Copies `text` whole, whatever the card shows of it. */
function CopyButton({ text }: { text: string }) {
  const [said, setSaid] = useState<'copy' | 'copied' | 'copy failed'>('copy')
  const copy = () =>
    navigator.clipboard.writeText(text).then(
      () => setSaid('copied'),
      () => setSaid('copy failed'),
    )
  return (
    <button className="cv-link cv-copy" title="copy the whole command" onClick={() => void copy()} onBlur={() => setSaid('copy')}>
      {said}
    </button>
  )
}

/** Bash: the command on the card, folded past `CMD_FOLD` lines, its output folded under it. */
function BashTool({ card, k }: { card: ToolCardT; k: string }) {
  const { isOpen, toggle } = useCards()
  const o = card.outcome
  const command = typeof card.input.command === 'string' ? card.input.command : card.summary
  const open = isOpen(k)
  const [m, what] = mark(o)
  const lines = o?.kind === 'bash' ? lineCount(o.stdout) + lineCount(o.stderr) : 0
  const cmdLines = command.split('\n')
  const hidden = cmdLines.length > CMD_FOLD + 1 ? cmdLines.length - CMD_FOLD : 0
  const cmdOpen = isOpen(`${k}:cmd`)
  return (
    <>
      <div className="cv-tool-head">
        <span className="cv-tool-mark" title={what}>
          {m}
        </span>
        <code className="cv-bash-cmd">$ {hidden && !cmdOpen ? cmdLines.slice(0, CMD_FOLD).join('\n') : command}</code>
        <CopyButton text={command} />
      </div>
      {hidden > 0 && (
        <button className="cv-more cv-cmd-more" aria-expanded={cmdOpen} onClick={() => toggle(`${k}:cmd`)}>
          {cmdOpen ? '▾ fold command' : `▸ ${hidden} more lines of command`}
        </button>
      )}
      {o?.kind === 'bash' ? (
        <>
          {o.interrupted && <span className="cv-badge">interrupted</span>}
          {lines ? (
            <button className="cv-more" aria-expanded={open} onClick={() => toggle(k)}>
              {open ? '▾' : '▸'} output · {lines} {lines === 1 ? 'line' : 'lines'}
            </button>
          ) : (
            <span className="cv-muted">no output</span>
          )}
          {open && <Outcome o={o} k={k} />}
        </>
      ) : (
        o && <Outcome o={o} k={k} />
      )}
    </>
  )
}

/** Any other tool: one line, expandable to its input and what it returned. A denial or an
 *  answer is short and matters, so it shows folded too. */
function ChipTool({ card, k }: { card: ToolCardT; k: string }) {
  const { isOpen, toggle } = useCards()
  const o = card.outcome
  const open = isOpen(k)
  const [m, what] = mark(o)
  const always = o?.kind === 'denied' || o?.kind === 'answers'
  return (
    <>
      <button className="cv-tool-head cv-chip-head" aria-expanded={open} onClick={() => toggle(k)}>
        <span className="cv-caret">{open ? '▾' : '▸'}</span>
        <span className="cv-tool-name">{toolLabel(card.name)}</span>
        <span className="cv-tool-summary" title={card.summary}>
          {card.summary}
        </span>
        <span className="cv-tool-mark" title={what}>
          {m}
        </span>
      </button>
      {open && Object.keys(card.input).length > 0 && <pre className="cv-out cv-input">{cap(JSON.stringify(card.input, null, 2))}</pre>}
      {o && (open || always) && <Outcome o={o} k={k} />}
    </>
  )
}

/** One tool call. `pending`: the session is parked on it, so it says what it waits for and
 *  offers the terminal, where the prompt is answered. */
export function ToolCard({ card, pending, k }: { card: ToolCardT; pending: Pending | null; k: string }) {
  const o = card.outcome
  return (
    <div className={`cv-card cv-tool${pending ? ' cv-pending' : ''}`} data-tool={card.name}>
      {o?.kind === 'diff' ? <DiffTool card={card} o={o} k={k} /> : card.name === 'Bash' || o?.kind === 'bash' ? <BashTool card={card} k={k} /> : <ChipTool card={card} k={k} />}
      <Thumbs images={card.images} />
      <RuleChips rules={card.rules} />
      {pending && <PendingBar kind={pending} />}
    </div>
  )
}

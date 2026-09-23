import { Markdown } from '../../vault/Markdown'
import { openUrl } from '../../github/actions'
import type { Card } from '../types'
import type { Pending } from '../stream'
import { useCards } from './context'
import { Thumbs } from './image'
import { RuleChips } from './rules'
import { ToolCard } from './tool'
import '../../vault/vault.css'

/** Transcript text as the vault renders a page: `[[slug]]` opens the rule, a link opens in the
 *  browser pane. */
function Md({ text }: { text: string }) {
  const { rules } = useCards()
  return <Markdown text={text} onWiki={(slug) => rules.open(slug)} onLink={(href) => openUrl(href, href)} />
}

const clock = (at: string) => {
  const d = new Date(at)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function SessionBlock({ card, k }: { card: Extract<Card, { kind: 'session' }>; k: string }) {
  const { isOpen, toggle } = useCards()
  const open = isOpen(`${k}:briefing`)
  const learned = card.rules.filter((r) => r.channel === 'learned')
  const other = card.rules.filter((r) => r.channel !== 'learned')
  return (
    <div className="cv-card cv-session">
      <div className="cv-session-head">
        session {card.source || 'start'} <span className="cv-muted">{clock(card.at)}</span>
      </div>
      {card.briefing && (
        <>
          <button className="cv-more" aria-expanded={open} onClick={() => toggle(`${k}:briefing`)}>
            {open ? '▾' : '▸'} briefing
          </button>
          {open && (
            <div className="cv-briefing">
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

function AgentCard({ card, k }: { card: Extract<Card, { kind: 'agent' }>; k: string }) {
  const { isOpen, toggle } = useCards()
  const open = isOpen(k)
  return (
    <div className="cv-card cv-agent">
      <button className="cv-tool-head cv-chip-head" aria-expanded={open} onClick={() => toggle(k)}>
        <span className="cv-caret">{open ? '▾' : '▸'}</span>
        <span className="cv-tool-name">agent{card.agentType ? ` · ${card.agentType}` : ''}</span>
        <span className="cv-tool-summary">{card.description}</span>
        <span className="cv-tool-mark" title={card.report === null ? 'running' : 'reported'}>
          {card.report === null ? '…' : '✓'}
        </span>
      </button>
      {open && (card.report === null ? <div className="cv-muted">no report yet</div> : <Md text={card.report} />)}
    </div>
  )
}

/** One card of the stream. `k` is its row key: where its folds are remembered. */
export function CardView({ card, pending, k }: { card: Card; pending: Pending | null; k: string }) {
  switch (card.kind) {
    case 'user':
      return (
        <div className={`cv-card cv-user${card.queued ? ' cv-queued' : ''}`}>
          {card.queued && <span className="cv-badge">queued</span>}
          {card.text && <Md text={card.text} />}
          <Thumbs images={card.images} />
          <RuleChips rules={card.rules} />
        </div>
      )
    case 'assistant':
      return (
        <div className="cv-card cv-assistant">
          <Md text={card.text} />
        </div>
      )
    case 'tool':
      return <ToolCard card={card} pending={pending} k={k} />
    case 'agent':
      return <AgentCard card={card} k={k} />
    case 'peer':
      return (
        <div className="cv-card cv-peer">
          <div className="cv-peer-from">from {card.from}</div>
          <Md text={card.text} />
        </div>
      )
    case 'notification':
      return (
        <div className="cv-thin cv-notification" title={card.text}>
          {card.text}
        </div>
      )
    case 'command':
      return (
        <div className="cv-line-chip">
          <span className="cv-chip cv-command">
            /{card.name.replace(/^\//, '')}
            {card.args && <span className="cv-muted"> {card.args}</span>}
          </span>
        </div>
      )
    case 'session':
      return <SessionBlock card={card} k={k} />
    case 'unknown':
      return (
        <div className="cv-line-chip">
          <span className="cv-chip cv-unknown" title="A record type this app does not know yet">
            unknown {card.type}
          </span>
        </div>
      )
  }
}
